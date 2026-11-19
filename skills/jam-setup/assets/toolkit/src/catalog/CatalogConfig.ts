// catalog.config.json: which plugins describe the project and how reviews resolve. The file is
// project policy and follows the checkout, so it is read again for every action and decoded only
// when its bytes changed.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { decode } from "../kernel/decode.ts"
import { fail, type ToolError } from "../kernel/errors.ts"
import { isRecord, sha256 } from "../kernel/hash.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import type { Problem } from "./model/types.ts"
import type { Plugin } from "./plugin.ts"

export const CONFIG_FILE = "catalog.config.json"

const NonEmpty = Schema.String.check(Schema.isNonEmpty())

const Review = Schema.Struct({
  resolver: Schema.optionalKey(NonEmpty).annotate({ description: "Verdict resolver: latest (default), strictest, or one a plugin registers" }),
  referenceRoles: Schema.optionalKey(Schema.Array(NonEmpty)).annotate({ description: "Roles that are supporting material, not approval targets" }),
  verdicts: Schema.optionalKey(Schema.Array(Schema.Literals(["approved", "changes", "rejected"]))).annotate({ description: "Verdicts reviewers may give" })
})

const Display = Schema.Struct({
  pixelArt: Schema.optionalKey(Schema.Boolean).annotate({ description: "Keep hard texels and show whole images in thumbnails and image viewers (pixel art). A type's own display wins" })
}).annotate({ description: "How images are shown, for types that do not say" })

const PluginEntry = Schema.Union([
  NonEmpty.annotate({ description: "A built-in name (manifest, jam) or a project-relative module (./catalog/plugin.ts)" }),
  Schema.Struct({
    plugin: NonEmpty.annotate({ description: "A built-in name or a project-relative module" }),
    options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)).annotate({ description: "This plugin's options" })
  })
])

/** The file. Older versions are refused with the migration that moves them to this one. */
export const CatalogConfigFile = Schema.Struct({
  $schema: Schema.optionalKey(Schema.String),
  version: Schema.Literal(3),
  plugins: Schema.optionalKey(Schema.Array(PluginEntry)).annotate({
    description: 'Plugins in load order: a built-in name or a project-relative module path, or { "plugin": <name or path>, "options": { … } }'
  }),
  review: Schema.optionalKey(Review),
  display: Schema.optionalKey(Display)
}).annotate({ identifier: "CatalogConfig", title: "catalog.config.json", description: "Catalog plugins with their options, review policy and display" })

export interface PluginRef {
  /** A built-in name or a project-relative module path. */
  readonly ref: string
  /** The options of its entry (empty when it has none). */
  readonly options: Readonly<Record<string, unknown>>
}

/** The configuration with its defaults applied. */
export interface ResolvedConfig {
  readonly version: 3
  readonly plugins: ReadonlyArray<PluginRef>
  readonly review: {
    readonly resolver: string
    readonly referenceRoles: ReadonlyArray<string>
    readonly verdicts: ReadonlyArray<string>
  }
  /** How images are shown for types that do not say. */
  readonly display: { readonly pixelArt: boolean }
}

/** What the composition root adds to a catalog: plugins by name, and command-line overrides. */
export interface Setup {
  /** Plugins that live outside src/catalog, selectable by name in `plugins` (for example `jam`). */
  readonly plugins: Readonly<Record<string, Plugin>>
  /**
   * Plugins of a project with no catalog.config.json, in place of `["manifest"]`. A plugin named
   * here is used only when the project has what it reads; the composition root decides.
   */
  readonly defaults?: ReadonlyArray<string> | undefined
  readonly overrides: {
    readonly plugins?: ReadonlyArray<string> | undefined
    /** Options by plugin entry (name or path), in place of the entry's own. */
    readonly options?: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined
    readonly resolver?: string | undefined
  }
}

export const CatalogSetup = Context.Reference<Setup>("jam/catalog/Setup", { defaultValue: () => ({ plugins: {}, overrides: {} }) })

const fromFile = (file: typeof CatalogConfigFile.Type): ResolvedConfig => ({
  version: 3,
  plugins: (file.plugins ?? ["manifest"]).map((entry) => (typeof entry === "string" ? { ref: entry, options: {} } : { ref: entry.plugin, options: entry.options ?? {} })),
  review: {
    resolver: file.review?.resolver ?? "latest",
    referenceRoles: file.review?.referenceRoles ?? [],
    verdicts: file.review?.verdicts ?? ["approved", "changes", "rejected"]
  },
  display: { pixelArt: file.display?.pixelArt === true }
})

const withOverrides = (config: ResolvedConfig, overrides: Setup["overrides"]): ResolvedConfig => {
  const plugins = overrides.plugins?.map((ref): PluginRef => ({ ref, options: config.plugins.find((entry) => entry.ref === ref)?.options ?? {} })) ?? config.plugins
  return {
    ...config,
    plugins: plugins.map((entry) => ({ ...entry, options: overrides.options?.[entry.ref] ?? entry.options })),
    review: { ...config.review, resolver: overrides.resolver ?? config.review.resolver }
  }
}

/** Decode the parsed file. Exported for the tests. */
export const resolveConfig = (value: unknown): Effect.Effect<ResolvedConfig, ToolError> =>
  Effect.gen(function*() {
    const version = isRecord(value) ? value["version"] : undefined
    if (version === 1 || version === 2) {
      return yield* fail("unsupported", `${CONFIG_FILE} was written by an older toolkit (version ${version})`, { fix: "run: jam catalog migrate" })
    }
    if (version !== 3) return yield* fail("invalid", `${CONFIG_FILE}: unsupported version`, { fix: 'set "version": 3' })
    return fromFile(yield* decode(CatalogConfigFile, { what: CONFIG_FILE })(value))
  })

export interface ConfigState {
  readonly config: ResolvedConfig
  /** Changes whenever the effective configuration does. */
  readonly signature: string
  /** Set while the file is broken and the last good configuration is still in use. */
  readonly problem: Problem | null
}

export class CatalogConfig extends Context.Service<CatalogConfig, {
  /** The configuration of the current checkout. A broken file keeps the last good one in use. */
  readonly current: Effect.Effect<ConfigState, ToolError>
}>()("jam/catalog/CatalogConfig") {
  static readonly layerNoDeps: Layer.Layer<CatalogConfig, never, ProjectFiles> = Layer.effect(
    CatalogConfig,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const setup = yield* CatalogSetup
      let last: { readonly text: string | null; readonly state: ConfigState } | null = null

      const read: Effect.Effect<string | null, ToolError> = files.readText(CONFIG_FILE).pipe(
        Effect.catch((error) => (error.code === "not_found" ? Effect.succeed(null) : Effect.fail(error)))
      )
      const parse = (text: string | null): Effect.Effect<ResolvedConfig, ToolError> =>
        text === null
          ? Effect.succeed(fromFile({ version: 3, ...(setup.defaults === undefined ? {} : { plugins: [...setup.defaults] }) }))
          : Effect.try({
            try: () => JSON.parse(text) as unknown,
            catch: (cause) => ({ cause })
          }).pipe(
            Effect.catch(({ cause }) => fail("malformed", `${CONFIG_FILE}: ${(cause as Error).message}`)),
            Effect.flatMap(resolveConfig)
          )

      const current = Effect.gen(function*() {
        const text = yield* read
        if (last && last.text === text) return last.state
        const loaded = yield* Effect.result(parse(text))
        if (loaded._tag === "Failure") {
          if (!last) return yield* Effect.fail(loaded.failure)
          // Keep serving the last good settings; say so until the file is fixed.
          const problem: Problem = {
            subject: CONFIG_FILE,
            error: loaded.failure.message,
            recovery: "fix the configuration; the previous project settings stay in use until then"
          }
          return { ...last.state, problem }
        }
        const config = withOverrides(loaded.success, setup.overrides)
        const state: ConfigState = { config, signature: sha256(JSON.stringify(config)), problem: null }
        last = { text, state }
        return state
      })
      return { current }
    })
  )
}
