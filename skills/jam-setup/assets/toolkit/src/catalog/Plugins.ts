// The plugins of the current checkout and the registries they fill. Plugins are trusted project
// code named by catalog.config.json; they are loaded again when the configuration or one of the
// project modules changes (a branch switch, an edit), so a running catalog follows the checkout.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as nodePath from "node:path"
import { pathToFileURL } from "node:url"
import { fail, type ToolError, toolError } from "../kernel/errors.ts"
import { digest, isRecord, sha256 } from "../kernel/hash.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import { Changes, concerns } from "./Changes.ts"
import { CatalogConfig, CatalogSetup, CONFIG_FILE, type PluginRef, type ResolvedConfig } from "./CatalogConfig.ts"
import type { Problem } from "./model/types.ts"
import { RESOLVERS, type Resolver } from "./model/verdicts.ts"
import { RESERVED_SECTIONS } from "./routes.ts"
import type { Check, MediaKind, Plugin, PluginAction, PluginContext, Probe, Relation, ScopeInput, Source } from "./plugin.ts"
import { importsOf, pluginUrl } from "./pluginImports.ts"
import { manifest } from "./plugins/manifest.ts"
import { mediaCore } from "./plugins/media-core.ts"
import { message, pluginContext } from "./support.ts"

/** The split used when no plugin registers its own. */
export const DEFAULT_SCOPES: ReadonlyArray<ScopeInput> = [
  { id: "main", label: "Content", description: "What the project is made of, by type" },
  { id: "material", label: "Source material", description: "The files content is made from: engine assets, imports, references" }
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
  readonly scopes: ReadonlyArray<ScopeInput>
  readonly resolvers: Readonly<Record<string, Resolver>>
  /** Browser module name to its declaration: inspector, panel and preview modules (see browserModules.ts). */
  readonly browserModules: Readonly<Record<string, string>>
  /** Media kind id to the declared browser module that registers its viewer. */
  readonly kindModules: Readonly<Record<string, string>>
  /** Project files that are code: configuration and modules. A change reloads everything. */
  readonly moduleFiles: ReadonlyArray<string>
  readonly problems: ReadonlyArray<Problem>
}

const BUILTIN: Readonly<Record<string, Plugin>> = { manifest, "media-core": mediaCore }
const isModuleRef = (ref: string): boolean => ref.startsWith("./") || /\.(m?js|ts|mts)$/.test(ref)
const modulePath = (ref: string): string => ref.replace(/^\.\//, "")

/**
 * A field of an earlier plugin contract. Nothing old is read, so a plugin still declaring one
 * fails to load, naming the field and what replaced it.
 */
const retiredField = (plugin: Readonly<Record<string, unknown>>): { readonly field: string; readonly fix: string } | null => {
  for (const key of ["views", "previews"]) {
    if (plugin[key] !== undefined) return { field: `${key} is no longer read; it was renamed browserModules`, fix: "declare inspector, panel and preview modules under browserModules (see docs/catalog-migration.md)" }
  }
  const actions = Array.isArray(plugin["actions"]) ? plugin["actions"] : []
  const old = actions.find((action) => isRecord(action) && action["kind"] !== undefined)
  if (isRecord(old)) return { field: `action ${String(old["name"])}: kind is no longer read; it was renamed access`, fix: 'declare access: "read" or "write" (see docs/catalog-migration.md)' }
  return null
}

const collect = (config: ResolvedConfig, loaded: ReadonlyArray<{ plugin: Plugin; context: PluginContext }>, extra: {
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
        problems.push({ subject: CONFIG_FILE, error: `plugin ${entry.owner}: ${what} ${entry.name} is already registered by ${earlier}`, recovery: "rename it or remove one of the plugins" })
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
    if (refused !== null) problems.push({ subject: CONFIG_FILE, error: `plugin ${entry.plugin.name}: scope id ${JSON.stringify(value.id)} ${refused}`, recovery: "rename the scope" })
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
    // A plugin's resolver returns one of the decisions it was given, so it returns the engine's records.
    resolvers: { ...RESOLVERS, ...(Object.assign({}, ...loaded.map((entry) => entry.plugin.resolvers ?? {})) as Record<string, Resolver>) },
    browserModules: Object.fromEntries(firstByName("browser module", loaded.flatMap((entry) =>
      Object.entries(entry.plugin.browserModules ?? {}).map(([name, path]) => ({ owner: entry.plugin.name, name, value: [name, path] as const }))
    ))),
    kindModules: Object.fromEntries(mediaKinds.flatMap((kind) => (typeof kind.web === "string" ? [[kind.id, kind.web]] : []))),
    moduleFiles: extra.moduleFiles,
    problems
  }
}

export class Plugins extends Context.Service<Plugins, {
  /** The plugin set of the current checkout, reloaded when its configuration or modules changed. */
  readonly current: Effect.Effect<PluginSet, ToolError>
}>()("jam/catalog/Plugins") {
  static readonly layerNoDeps: Layer.Layer<Plugins, never, CatalogConfig | ProjectFiles | Changes> = Layer.effect(
    Plugins,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const configs = yield* CatalogConfig
      const changes = yield* Changes
      const setup = yield* CatalogSetup
      const builtin: Readonly<Record<string, Plugin>> = { ...BUILTIN, ...setup.plugins }
      let last: PluginSet | null = null

      const moduleFilesOf = (config: ResolvedConfig): Array<string> =>
        config.plugins.filter((p) => !builtin[p.ref] && isModuleRef(p.ref)).map((p) => modulePath(p.ref))
      // Code is fingerprinted by its bytes every time: an edit that keeps size and timestamp
      // must still reload it.
      const moduleHash = (path: string): Effect.Effect<string | null> =>
        files.readBytes(path).pipe(Effect.map((bytes) => sha256(bytes)), Effect.catch(() => Effect.succeed(null)))

      // The project modules each plugin module imported when it last loaded (absolute paths).
      const imports = new Map<string, ReadonlyArray<string>>()
      const importsHash = (path: string): Effect.Effect<string> =>
        Effect.map(
          Effect.forEach(imports.get(path) ?? [], (absolute) =>
            files.relative(absolute).pipe(Effect.flatMap(moduleHash), Effect.catch(() => Effect.succeed(null)))),
          (hashes) => digest(hashes)
        )

      const importModule = (path: string, what: string): Effect.Effect<Record<string, unknown>, ToolError> =>
        Effect.gen(function*() {
          const full = yield* files.resolve(path)
          const bytes = yield* files.readBytes(path).pipe(
            Effect.mapError((error) => (error.code === "not_found" ? toolError("unavailable", `${what} module not found: ${path}`) : error))
          )
          // The version in the URL makes Node import the module, and the project modules it
          // imports, again when any of their bytes change.
          const version = sha256(`${sha256(bytes)}:${yield* importsHash(path)}`).slice(0, 16)
          const loaded = yield* Effect.tryPromise({
            try: () => import(pluginUrl(pathToFileURL(full).href, version)) as Promise<Record<string, unknown>>,
            catch: (cause) => toolError("invalid", `${what} module ${path} could not be loaded: ${message(cause)}`)
          })
          imports.set(path, importsOf(version))
          return loaded
        })

      const loadOne = (ref: PluginRef): Effect.Effect<{ plugin: Plugin; context: PluginContext }, ToolError> =>
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
            exported = module["default"]
          }
          if (!isRecord(exported) || typeof exported["name"] !== "string" || exported["name"] === "") {
            return yield* fail("invalid", `plugin ${ref.ref} has no default export with a name`, {
              fix: 'export default definePlugin({ name: "…", … }) from the module'
            })
          }
          const retired = retiredField(exported)
          if (retired !== null) return yield* fail("invalid", `plugin ${exported["name"]}: ${retired.field}`, { fix: retired.fix })
          const plugin = exported as unknown as Plugin
          return { plugin, context: pluginContext(files, ref.options) }
        })

      const load = (config: ResolvedConfig, signature: string): Effect.Effect<PluginSet, ToolError> =>
        Effect.gen(function*() {
          const refs: Array<PluginRef> = [{ ref: "media-core", options: {} }, ...config.plugins.filter((p) => p.ref !== "media-core")]
          const loaded: Array<{ plugin: Plugin; context: PluginContext }> = []
          for (const ref of refs) {
            const entry = yield* loadOne(ref)
            if (loaded.some((other) => other.plugin.name === entry.plugin.name)) {
              return yield* fail("invalid", `${CONFIG_FILE}: plugin ${entry.plugin.name} is listed twice`)
            }
            loaded.push(entry)
          }
          const set = { signature, ...collect(config, loaded, { moduleFiles: [CONFIG_FILE, ...moduleFilesOf(config)] }) }
          if (!set.resolvers[config.review.resolver]) return yield* fail("invalid", `unknown verdict resolver ${config.review.resolver}`)
          return set
        })

      const signatureOf = (state: { readonly config: ResolvedConfig; readonly signature: string }): Effect.Effect<string> =>
        Effect.map(
          Effect.forEach(moduleFilesOf(state.config), (path) => Effect.zipWith(moduleHash(path), importsHash(path), (own, imported) => `${own}:${imported}`)),
          (hashes) => digest({ config: state.signature, modules: hashes })
        )

      // The last answer, where the change feed stood when it was read, and the files it was read from.
      let answered: { mark: number; readonly concerns: (changed: ReadonlySet<string>) => boolean; readonly set: PluginSet } | null = null
      const current = Effect.gen(function*() {
        const mark = yield* changes.mark
        if (answered !== null) {
          const changed = yield* changes.since(answered.mark)
          if (changed !== null && !answered.concerns(changed)) {
            answered.mark = mark
            return answered.set
          }
        }
        const set = yield* read
        const code = moduleFilesOf(set.config).flatMap((path) => [path, ...(imports.get(path) ?? []).map((absolute) => nodePath.relative(files.root, absolute).split(nodePath.sep).join("/"))])
        answered = { mark, concerns: concerns([CONFIG_FILE, ...code.filter((path) => !path.startsWith("../") && !nodePath.isAbsolute(path))]), set }
        return set
      })
      const read = Effect.gen(function*() {
        const state = yield* configs.current
        const signature = yield* signatureOf(state)
        const configProblems = state.problem ? [state.problem] : []
        if (last?.signature === signature) return configProblems.length > 0 ? { ...last, problems: [...configProblems, ...last.problems] } : last
        const next = yield* Effect.result(load(state.config, signature))
        if (next._tag === "Success") {
          // The modules a plugin imports are known only once it loaded: signed again with them,
          // the next action finds this same set instead of loading every plugin a second time.
          last = { ...next.success, signature: yield* signatureOf(state) }
          return configProblems.length > 0 ? { ...last, problems: [...configProblems, ...last.problems] } : last
        }
        if (!last) return yield* Effect.fail(next.failure)
        const problem: Problem = { subject: CONFIG_FILE, error: next.failure.message, recovery: "fix the plugin or its configuration; the previous plugins stay in use until then" }
        return { ...last, problems: [problem, ...configProblems, ...last.problems] }
      })
      return { current }
    })
  )
}
