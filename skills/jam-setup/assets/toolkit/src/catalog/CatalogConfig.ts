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

/** The current form of the file. */
export const ConfigV2 = Schema.Struct({
  $schema: Schema.optionalKey(Schema.String),
  version: Schema.Literal(2),
  plugins: Schema.optionalKey(Schema.Array(NonEmpty)).annotate({
    description: "Plugins in load order: a built-in name (manifest, jam) or a project-relative module (./jam/catalog/game.ts)"
  }),
  options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))).annotate({
    description: "Options per plugin name"
  }),
  review: Schema.optionalKey(Review),
  display: Schema.optionalKey(Display)
}).annotate({ identifier: "CatalogConfig", title: "catalog.config.json", description: "Catalog plugins, review policy and display" })

/** Version 1: one adapter. Still read, never written. Unknown fields were always ignored. */
export const ConfigV1 = Schema.Struct({
  version: Schema.Literal(1),
  adapter: Schema.optionalKey(NonEmpty),
  options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  previewModules: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  review: Schema.optionalKey(Schema.Struct({
    resolver: Schema.optionalKey(NonEmpty),
    resolverModule: Schema.optionalKey(NonEmpty),
    referenceRoles: Schema.optionalKey(Schema.Array(NonEmpty)),
    verdicts: Schema.optionalKey(Schema.Array(Schema.String))
  })),
  display: Schema.optionalKey(Display)
})

export interface PluginRef {
  /** A built-in name or a project-relative module path. */
  readonly ref: string
  /** Version 1 adapters take the whole `options` object; plugins take their own entry. */
  readonly adapterOptions?: Record<string, unknown>
}

/** The configuration in one form, whichever version the file is. */
export interface ResolvedConfig {
  readonly version: 1 | 2
  readonly plugins: ReadonlyArray<PluginRef>
  readonly options: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly review: {
    readonly resolver: string
    readonly resolverModule: string | null
    readonly referenceRoles: ReadonlyArray<string>
    readonly verdicts: ReadonlyArray<string>
  }
  /** Version 1 `previewModules`; version 2 registers previews through plugins. */
  readonly previewModules: Readonly<Record<string, string>>
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
    readonly options?: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined
    readonly resolver?: string | undefined
  }
}

export const CatalogSetup = Context.Reference<Setup>("jam/catalog/Setup", { defaultValue: () => ({ plugins: {}, overrides: {} }) })

const strip = (path: string): string => path.replace(/^\.\//, "")

const fromV1 = (file: typeof ConfigV1.Type): ResolvedConfig => {
  const adapter = file.adapter ?? "manifest"
  const options = file.options ?? {}
  // The manifest adapter's one option was the manifest path; the plugin calls it `file`.
  const manifest = typeof options["manifest"] === "string" ? { manifest: { file: options["manifest"] } } : {}
  return {
    version: 1,
    plugins: [adapter === "manifest" ? { ref: "manifest" } : { ref: adapter, adapterOptions: options }],
    options: adapter === "manifest" ? manifest : { [adapter]: options },
    review: {
      resolver: file.review?.resolver ?? "latest",
      resolverModule: file.review?.resolverModule === undefined ? null : strip(file.review.resolverModule),
      referenceRoles: file.review?.referenceRoles ?? [],
      verdicts: file.review?.verdicts ?? ["approved", "changes", "rejected"]
    },
    previewModules: Object.fromEntries(Object.entries(file.previewModules ?? {}).map(([name, path]) => [name, strip(path)])),
    display: { pixelArt: file.display?.pixelArt === true }
  }
}

const fromV2 = (file: typeof ConfigV2.Type): ResolvedConfig => ({
  version: 2,
  plugins: (file.plugins ?? ["manifest"]).map((ref) => ({ ref })),
  options: file.options ?? {},
  review: {
    resolver: file.review?.resolver ?? "latest",
    resolverModule: null,
    referenceRoles: file.review?.referenceRoles ?? [],
    verdicts: file.review?.verdicts ?? ["approved", "changes", "rejected"]
  },
  previewModules: {},
  display: { pixelArt: file.display?.pixelArt === true }
})

const withOverrides = (config: ResolvedConfig, overrides: Setup["overrides"]): ResolvedConfig => ({
  ...config,
  plugins: overrides.plugins?.map((ref) => ({ ref })) ?? config.plugins,
  options: { ...config.options, ...overrides.options },
  review: { ...config.review, resolver: overrides.resolver ?? config.review.resolver }
})

/** Decode the parsed file. Exported for the tests of both versions. */
export const resolveConfig = (value: unknown): Effect.Effect<ResolvedConfig, ToolError> =>
  Effect.gen(function*() {
    const version = isRecord(value) ? value["version"] : undefined
    if (version === 1) return fromV1(yield* decode(ConfigV1, { what: CONFIG_FILE, strict: false })(value))
    if (version === 2) return fromV2(yield* decode(ConfigV2, { what: CONFIG_FILE })(value))
    return yield* fail("invalid", `${CONFIG_FILE}: unsupported version`, { fix: 'set "version": 2' })
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
          ? Effect.succeed(fromV2({ version: 2, ...(setup.defaults === undefined ? {} : { plugins: [...setup.defaults] }) }))
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
            source: CONFIG_FILE,
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
