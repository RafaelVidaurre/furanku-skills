// The plugins of the current checkout and the registries they fill. Plugins are trusted project
// code named by catalog.config.json; they are loaded again when the configuration or one of the
// project modules changes (a branch switch, an edit), so a running catalog follows the checkout.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { pathToFileURL } from "node:url"
import { fail, type ToolError, toolError } from "../kernel/errors.ts"
import { digest, isRecord, sha256 } from "../kernel/hash.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import { CatalogConfig, CatalogSetup, CONFIG_FILE, type PluginRef, type ResolvedConfig } from "./CatalogConfig.ts"
import type { Problem } from "./model/types.ts"
import { RESOLVERS, type Resolver } from "./model/verdicts.ts"
import { RESERVED_SECTIONS } from "./routes.ts"
import type { AdapterFactory, Check, MediaKind, Plugin, PluginAction, PluginContext, Probe, Relation, ScopeDef, Source } from "./plugin.ts"
import { manifest } from "./plugins/manifest.ts"
import { mediaCore } from "./plugins/media-core.ts"
import { adapterPlugin } from "./plugins/v1.ts"
import { message, pluginContext } from "./support.ts"

/** The split used when no plugin registers its own. */
export const DEFAULT_SCOPES: ReadonlyArray<ScopeDef> = [
  { id: "content", label: "Content", description: "Entries that make up the project" },
  { id: "assets", label: "Assets", description: "Source material and media entries" }
]

export interface Owned<A> {
  readonly plugin: string
  readonly context: PluginContext
  readonly value: A
}

export interface PluginSet {
  /** Changes whenever the configuration or a project module does. */
  readonly signature: string
  readonly config: ResolvedConfig
  readonly names: ReadonlyArray<string>
  readonly sources: ReadonlyArray<Owned<Source>>
  readonly enrichers: ReadonlyArray<Owned<NonNullable<Plugin["enrich"]>>>
  readonly relations: ReadonlyArray<Relation>
  readonly mediaKinds: ReadonlyArray<MediaKind>
  readonly probes: ReadonlyArray<Owned<Probe>>
  readonly checks: ReadonlyArray<Owned<Check>>
  readonly actions: ReadonlyArray<Owned<PluginAction>>
  readonly scopes: ReadonlyArray<ScopeDef>
  readonly resolvers: Readonly<Record<string, Resolver>>
  /** Preview module name to its declared browser module (see browserModules.ts). */
  readonly previews: Readonly<Record<string, string>>
  /** Media kind id to the declared browser module that registers its viewer. */
  readonly kindModules: Readonly<Record<string, string>>
  /** Project files that are code: configuration and modules. A change reloads everything. */
  readonly moduleFiles: ReadonlyArray<string>
  readonly problems: ReadonlyArray<Problem>
}

const BUILTIN: Readonly<Record<string, Plugin>> = { manifest, "media-core": mediaCore }
const isModuleRef = (ref: string): boolean => ref.startsWith("./") || /\.(m?js|ts|mts)$/.test(ref)
const modulePath = (ref: string): string => ref.replace(/^\.\//, "")

const collect = (config: ResolvedConfig, loaded: ReadonlyArray<{ plugin: Plugin; context: PluginContext }>, extra: {
  readonly resolvers: Record<string, Resolver>
  readonly moduleFiles: ReadonlyArray<string>
}): Omit<PluginSet, "signature"> => {
  const problems: Array<Problem> = []
  const own = <A>(entry: { plugin: Plugin; context: PluginContext }, value: A): Owned<A> => ({ plugin: entry.plugin.name, context: entry.context, value })
  // A second registration under a taken name is dropped and reported: which one wins must not
  // depend on reading the plugin list twice.
  const firstByName = <A>(what: string, entries: ReadonlyArray<{ owner: string; name: string; value: A }>): Array<A> => {
    const seen = new Map<string, string>()
    const out: Array<A> = []
    for (const entry of entries) {
      const earlier = seen.get(entry.name)
      if (earlier !== undefined) {
        problems.push({ source: CONFIG_FILE, error: `plugin ${entry.owner}: ${what} ${entry.name} is already registered by ${earlier}`, recovery: "rename it or remove one of the plugins" })
        continue
      }
      seen.set(entry.name, entry.owner)
      out.push(entry.value)
    }
    return out
  }
  const each = <A>(pick: (plugin: Plugin) => ReadonlyArray<A> | undefined) =>
    loaded.flatMap((entry) => (pick(entry.plugin) ?? []).map((value) => ({ entry, value })))
  // A scope is a section of the page and a segment of its addresses.
  const usable = each((p) => p.scopes).filter(({ entry, value }) => {
    const refused = RESERVED_SECTIONS.includes(value.id) ? "is a section of the catalog page" : /^[a-z0-9][a-z0-9-]*$/.test(value.id) ? null : "must be lower-case letters, digits and hyphens"
    if (refused !== null) problems.push({ source: CONFIG_FILE, error: `plugin ${entry.plugin.name}: scope id ${JSON.stringify(value.id)} ${refused}`, recovery: "rename the scope" })
    return refused === null
  })
  const scopes = firstByName("scope", usable.map(({ entry, value }) => ({ owner: entry.plugin.name, name: value.id, value })))
  const mediaKinds = firstByName("media kind", each((p) => p.mediaKinds).map(({ entry, value }) => ({ owner: entry.plugin.name, name: value.id, value })))
  return {
    config,
    names: loaded.map((entry) => entry.plugin.name),
    sources: each((p) => p.sources).map(({ entry, value }) => own(entry, value)),
    enrichers: loaded.flatMap((entry) => (entry.plugin.enrich ? [own(entry, entry.plugin.enrich.bind(entry.plugin))] : [])),
    relations: firstByName("relation", each((p) => p.relations).map(({ entry, value }) => ({ owner: entry.plugin.name, name: value.name, value }))),
    mediaKinds,
    probes: firstByName("probe", each((p) => p.probes).map(({ entry, value }) => ({ owner: entry.plugin.name, name: value.name, value: own(entry, value) }))),
    checks: firstByName("check", each((p) => p.checks).map(({ entry, value }) => ({ owner: entry.plugin.name, name: value.name, value: own(entry, value) }))),
    actions: firstByName("action", each((p) => p.actions).map(({ entry, value }) => ({ owner: entry.plugin.name, name: value.name, value: own(entry, value) }))),
    scopes: scopes.length > 0 ? scopes : DEFAULT_SCOPES,
    resolvers: { ...RESOLVERS, ...Object.assign({}, ...loaded.map((entry) => entry.plugin.resolvers ?? {})), ...extra.resolvers },
    previews: { ...Object.assign({}, ...loaded.map((entry) => entry.plugin.previews ?? {})), ...config.previewModules },
    kindModules: Object.fromEntries(mediaKinds.flatMap((kind) => (typeof kind.web === "string" ? [[kind.id, kind.web]] : []))),
    moduleFiles: extra.moduleFiles,
    problems
  }
}

export class Plugins extends Context.Service<Plugins, {
  /** The plugin set of the current checkout, reloaded when its configuration or modules changed. */
  readonly current: Effect.Effect<PluginSet, ToolError>
}>()("jam/catalog/Plugins") {
  static readonly layerNoDeps: Layer.Layer<Plugins, never, CatalogConfig | ProjectFiles> = Layer.effect(
    Plugins,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const configs = yield* CatalogConfig
      const setup = yield* CatalogSetup
      const builtin: Readonly<Record<string, Plugin>> = { ...BUILTIN, ...setup.plugins }
      let last: PluginSet | null = null

      const moduleFilesOf = (config: ResolvedConfig): Array<string> => [
        ...config.plugins.filter((p) => !builtin[p.ref] && isModuleRef(p.ref)).map((p) => modulePath(p.ref)),
        ...(config.review.resolverModule === null ? [] : [config.review.resolverModule])
      ]
      // Code is fingerprinted by its bytes every time: an edit that keeps size and timestamp
      // must still reload it.
      const moduleHash = (path: string): Effect.Effect<string | null> =>
        files.readBytes(path).pipe(Effect.map((bytes) => sha256(bytes)), Effect.catch(() => Effect.succeed(null)))

      const importModule = (path: string, what: string): Effect.Effect<Record<string, unknown>, ToolError> =>
        Effect.gen(function*() {
          const full = yield* files.resolve(path)
          const bytes = yield* files.readBytes(path).pipe(
            Effect.mapError((error) => (error.code === "not_found" ? toolError("unavailable", `${what} module not found: ${path}`) : error))
          )
          // The query string makes Node import the module again when its bytes change.
          const href = `${pathToFileURL(full).href}?v=${sha256(bytes).slice(0, 16)}`
          return yield* Effect.tryPromise({
            try: () => import(href) as Promise<Record<string, unknown>>,
            catch: (cause) => toolError("invalid", `${what} module ${path} could not be loaded: ${message(cause)}`)
          })
        })

      const loadOne = (ref: PluginRef, config: ResolvedConfig): Effect.Effect<{ plugin: Plugin; context: PluginContext }, ToolError> =>
        Effect.gen(function*() {
          const known = builtin[ref.ref]
          let exported: unknown = known
          if (!known) {
            if (!isModuleRef(ref.ref)) {
              return yield* fail("invalid", `${CONFIG_FILE}: unknown plugin ${ref.ref}`, {
                fix: `use one of ${Object.keys(builtin).join(", ")} or a project-relative module path such as ./catalog/plugin.ts`
              })
            }
            const module = yield* importModule(modulePath(ref.ref), "plugin")
            exported = module["default"] ?? module["createAdapter"]
          }
          if (typeof exported === "function") {
            const options = ref.adapterOptions ?? config.options[ref.ref] ?? {}
            const context = pluginContext(files, options)
            const plugin = yield* Effect.try({
              try: () => adapterPlugin(ref.ref, exported as AdapterFactory, { ...options })(context),
              catch: (cause) => toolError("invalid", `adapter ${ref.ref} could not be created: ${message(cause)}`)
            })
            return { plugin, context }
          }
          if (!isRecord(exported) || typeof exported["name"] !== "string" || exported["name"] === "") {
            return yield* fail("invalid", `plugin ${ref.ref} has no default export with a name`, {
              fix: 'export default definePlugin({ name: "…", … }) from the module'
            })
          }
          const plugin = exported as unknown as Plugin
          return { plugin, context: pluginContext(files, config.options[plugin.name] ?? {}) }
        })

      const load = (config: ResolvedConfig, signature: string): Effect.Effect<PluginSet, ToolError> =>
        Effect.gen(function*() {
          const refs: Array<PluginRef> = [{ ref: "media-core" }, ...config.plugins.filter((p) => p.ref !== "media-core")]
          const loaded: Array<{ plugin: Plugin; context: PluginContext }> = []
          for (const ref of refs) {
            const entry = yield* loadOne(ref, config)
            if (loaded.some((other) => other.plugin.name === entry.plugin.name)) {
              return yield* fail("invalid", `${CONFIG_FILE}: plugin ${entry.plugin.name} is listed twice`)
            }
            loaded.push(entry)
          }
          const resolvers: Record<string, Resolver> = {}
          if (config.review.resolverModule !== null) {
            const module = yield* importModule(config.review.resolverModule, "resolver")
            if (typeof module["default"] === "function") resolvers[config.review.resolver] ??= module["default"] as Resolver
          }
          const set = { signature, ...collect(config, loaded, { resolvers, moduleFiles: [CONFIG_FILE, ...moduleFilesOf(config)] }) }
          if (!set.resolvers[config.review.resolver]) return yield* fail("invalid", `unknown verdict resolver ${config.review.resolver}`)
          return set
        })

      const current = Effect.gen(function*() {
        const state = yield* configs.current
        const hashes = yield* Effect.forEach(moduleFilesOf(state.config), moduleHash)
        const signature = digest({ config: state.signature, modules: hashes })
        const configProblems = state.problem ? [state.problem] : []
        if (last?.signature === signature) return configProblems.length > 0 ? { ...last, problems: [...configProblems, ...last.problems] } : last
        const next = yield* Effect.result(load(state.config, signature))
        if (next._tag === "Success") {
          last = next.success
          return configProblems.length > 0 ? { ...last, problems: [...configProblems, ...last.problems] } : last
        }
        if (!last) return yield* Effect.fail(next.failure)
        const problem: Problem = { source: CONFIG_FILE, error: next.failure.message, recovery: "fix the plugin or its configuration; the previous plugins stay in use until then" }
        return { ...last, problems: [problem, ...configProblems, ...last.problems] }
      })
      return { current }
    })
  )
}
