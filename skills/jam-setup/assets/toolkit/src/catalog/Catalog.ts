// The catalog as other code uses it: run an action, list the actions, read media. The CLI, the
// HTTP server and tests all go through this one service, so people and agents get the same
// validation, the same attribution and the same answers.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { decode } from "../kernel/decode.ts"
import { fail, type ToolError } from "../kernel/errors.ts"
import { type Checkout, Git } from "../kernel/Git.ts"
import { digest, isNonEmpty, isRecord } from "../kernel/hash.ts"
import { Ids } from "../kernel/Ids.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import { type ActionDef, type ActionServices, priorRequest, type ReadEnv, type WriteEnv } from "./action.ts"
import { type ActionInfo, Actions } from "./Actions.ts"
import { assetFiles } from "./assetFiles.ts"
import { type BrowserModule, moduleDigests, readBrowserModule } from "./browserModules.ts"
import { CatalogConfig, CatalogSetup, type ResolvedConfig, type Setup } from "./CatalogConfig.ts"
import { Evidence } from "./Evidence.ts"
import { Facts } from "./Facts.ts"
import { decidedAssets, ensureHashed } from "./hashes.ts"
import { MediaKinds } from "./MediaKinds.ts"
import type { Actor, RequestBinding } from "./model/types.ts"
import { Plugins, type PluginSet } from "./Plugins.ts"
import { buildProjection, factsOf, type Projection } from "./Projection.ts"
import { beforeMedia, evidenceMedia, type Media } from "./queries/evidence.ts"
import { Records } from "./Records.ts"
import { hasRoutes, linked } from "./routes.ts"
import { type ServerRecord, ServerState } from "./ServerState.ts"
import { ReviewPolicy } from "./ReviewPolicy.ts"
import { Snapshot } from "./Snapshot.ts"

/** Who is acting and how a write is identified. Reads need none of it. */
export interface RunMeta {
  /** Required for writes. A declaration, not proof of identity. */
  readonly actor?: { readonly name?: unknown; readonly kind?: unknown } | undefined
  /** Makes a write repeatable: the same id with the same input records once and returns the first result. */
  readonly requestId?: string | undefined
  /** The checkout key a write was prepared in; the write is refused when the checkout has moved. */
  readonly context?: string | undefined
}

export interface AssetFile {
  /** Absolute path, confined to the asset roots after resolving symbolic links. */
  readonly file: string
  readonly mime: string
  /** The file's version token (size and modification time): the `v` of its URL. Serving never hashes. */
  readonly version: string
  readonly size: number
}

/** A declared browser module, for serving. */
export type PreviewModule = BrowserModule

/** Counters that show how much work actions caused; the performance rules are tested with them. */
export interface CatalogStats {
  readonly projections: number
  readonly recordScans: number
  readonly recordsParsed: number
  readonly sourceLoads: Readonly<Record<string, number>>
  readonly filesHashed: number
  readonly probesMeasured: number
}

export class Catalog extends Context.Service<Catalog, {
  /** Run an action by name. Reads need only input; writes need `meta.actor`. */
  run(action: string, input?: unknown, meta?: RunMeta): Effect.Effect<unknown, ToolError>
  /** Every action of this checkout (built-in and from plugins) with its input as JSON Schema. */
  readonly discover: Effect.Effect<ReadonlyArray<ActionInfo>, ToolError>
  /** Which worktree and branch this is. Runs no `git status`. */
  readonly context: Effect.Effect<Checkout>
  /** The actor a browser user is taken to be: the local Git user, as a human. */
  readonly defaultActor: Effect.Effect<Actor>
  /** The configuration in effect (reloaded when catalog.config.json or a project module changed). */
  readonly config: Effect.Effect<ResolvedConfig, ToolError>
  /** The current file of an asset, for serving. Fails `forbidden` or `unavailable` when it must not or cannot be served. */
  assetFile(id: string): Effect.Effect<AssetFile, ToolError>
  /** Bytes of frozen evidence, verified against the recorded digest. `leaf` is empty for a simple part. */
  evidenceMedia(submission: string, item: string, part: string, leaf?: string): Effect.Effect<Media, ToolError>
  /** Bytes of the frozen before side of a submission view. */
  beforeMedia(submission: string, item: string, view: string): Effect.Effect<Media, ToolError>
  /** A declared collection preview module (trusted project code for the browser). */
  previewModule(name: string): Effect.Effect<PreviewModule, ToolError>
  /** The declared browser module of a media kind: what registers its viewer, thumbnail and comparer. */
  kindModule(kind: string): Effect.Effect<BrowserModule, ToolError>
  /** A declared module of type views and panels. */
  viewModule(name: string): Effect.Effect<BrowserModule, ToolError>
  /** The server of this checkout, when one is running (see `ServerState`). */
  readonly server: Effect.Effect<ServerRecord | null>
  /** Write a machine-local file such as a capture (`captures/<name>.png`); returns its project path. */
  writeLocal(relative: string, bytes: Uint8Array): Effect.Effect<string, ToolError>
  readonly stats: Effect.Effect<CatalogStats>
}>()("jam/catalog/Catalog") {
  static readonly layerNoDeps: Layer.Layer<Catalog, never, Actions | Plugins | CatalogConfig | Snapshot | ReviewPolicy | ServerState | ActionServices> = Layer.effect(
    Catalog,
    Effect.gen(function*() {
      const services = yield* Effect.context<ActionServices>()
      const registry = yield* Actions
      const plugins = yield* Plugins
      const configs = yield* CatalogConfig
      const snapshots = yield* Snapshot
      const policies = yield* ReviewPolicy
      const records = yield* Records
      const evidence = yield* Evidence
      const facts = yield* Facts
      const media = yield* MediaKinds
      const git = yield* Git
      const files = yield* ProjectFiles
      const servers = yield* ServerState
      let lastProjection: { readonly made: string; readonly value: Projection } | null = null
      let projections = 0

      // The Git user rarely changes while a catalog runs; asking once keeps `context` free of it.
      const defaultActor = yield* Effect.cached(Effect.map(git.userName, (name): Actor => ({ name: name ?? "Local user", kind: "human" })))

      // Only what a plugin or the configuration declared is ever read for the browser.
      const previewModule = (set: PluginSet, name: string): Effect.Effect<PreviewModule, ToolError> => {
        const reference = Object.hasOwn(set.previews, name) ? set.previews[name] : undefined
        return typeof reference === "string" ? readBrowserModule(files, reference, "preview module") : fail("not_found", `no project preview module ${name}`)
      }
      const kindModule = (set: PluginSet, kind: string): Effect.Effect<BrowserModule, ToolError> => {
        const reference = Object.hasOwn(set.kindModules, kind) ? set.kindModules[kind] : undefined
        return typeof reference === "string" ? readBrowserModule(files, reference, `browser module of media kind ${kind}`) : fail("not_found", `media kind ${kind} declares no browser module`)
      }

      const viewModule = (set: PluginSet, name: string): Effect.Effect<BrowserModule, ToolError> => {
        const reference = Object.hasOwn(set.viewModules, name) ? set.viewModules[name] : undefined
        return typeof reference === "string" ? readBrowserModule(files, reference, "view module") : fail("not_found", `no view module ${name}`)
      }

      /** The one projection of an action: current sources, current records, current policy. */
      const project = (set: PluginSet): Effect.Effect<Projection, ToolError> =>
        Effect.gen(function*() {
          const actions = registry.for(set)
          const effective = actions.problems.length > 0 ? { ...set, problems: [...set.problems, ...actions.problems] } : set
          const snapshot = yield* snapshots.current(set)
          const view = yield* records.view
          const previews = yield* moduleDigests(files, set.previews, "preview module")
          const kinds = yield* moduleDigests(files, set.kindModules, "media kind module")
          const views = yield* moduleDigests(files, set.viewModules, "view module")
          // Nothing it is made of changed: the same projection (and what it already computed) serves again.
          const made = JSON.stringify([set.signature, effective.problems, [...previews], [...kinds], [...views]])
          if (lastProjection && lastProjection.made === made && lastProjection.value.snapshot === snapshot && lastProjection.value.records === view) return lastProjection.value
          projections++
          const projection = buildProjection(snapshot, view, policies.for(set), effective, { previews, kinds, views })
          // "Changed since its verdict" compares digests, so the files behind decided parts are
          // hashed here (once per file version on this machine). Nothing else is read in full.
          yield* Effect.provideContext(ensureHashed(projection, decidedAssets(projection)), services)
          lastProjection = { made, value: projection }
          return projection
        })

      const actorOf = (meta: RunMeta): Effect.Effect<Actor, ToolError> => {
        const actor = meta.actor
        return isRecord(actor) && isNonEmpty(actor["name"]) && (actor["kind"] === "human" || actor["kind"] === "agent")
          ? Effect.succeed({ name: actor["name"].trim().slice(0, 200), kind: actor["kind"] })
          : fail("invalid", "declare the actor: name and kind (human or agent)", { fix: "pass --actor-kind human|agent and --actor-name <name>" })
      }

      const run = (name: string, rawInput: unknown = {}, meta: RunMeta = {}): Effect.Effect<unknown, ToolError> =>
        Effect.gen(function*() {
          const set = yield* plugins.current
          const action = registry.for(set).actions.get(name)
          if (!action) return yield* fail("not_found", `unknown action ${name}`, { fix: "list the actions with: jam catalog actions" })
          // A schema's decoding services are unknown to the type of the registry; action inputs need none.
          const input = (yield* (decode(action.input, { what: `input of ${name}` })(rawInput ?? {}) as Effect.Effect<unknown, ToolError>)) as never
          const handle = (env: WriteEnv): Effect.Effect<unknown, ToolError> => Effect.provideContext(action.run(input, env), services)
          const actor = yield* defaultActor
          // A read may run other reads (a plugin check asking the catalog); never a write.
          const runRead: ReadEnv["run"] = (other, otherInput) =>
            registry.for(set).actions.get(other)?.kind === "write" ? fail("forbidden", `only read actions can be run from here; ${other} is a write action`) : run(other, otherInput)
          const base = (projection: Projection, nested: ReadEnv["run"]): ReadEnv => ({
            projection,
            currentCheckout: git.checkout,
            defaultActor: actor,
            run: nested,
            runRead,
            refresh: project(set)
          })

          if (action.kind === "read") return yield* handle(base(yield* project(set), runRead) as WriteEnv)
          return yield* writeAction(set, action, name, input, rawInput ?? {}, meta, handle, base)
        })

      const writeAction = (
        set: PluginSet,
        action: ActionDef,
        name: string,
        input: never,
        rawInput: unknown,
        meta: RunMeta,
        handle: (env: WriteEnv) => Effect.Effect<unknown, ToolError>,
        base: (projection: Projection, nested: ReadEnv["run"]) => ReadEnv
      ): Effect.Effect<unknown, ToolError> =>
        Effect.gen(function*() {
          const checkout = yield* git.checkout
          if (meta.context && meta.context !== checkout.key) {
            return yield* fail("context_changed", `this checkout changed to ${checkout.branch ?? `detached ${checkout.head?.slice(0, 8)}`}; reload before saving`, { details: { context: checkout } })
          }
          const requestId = meta.requestId ?? null
          if (requestId !== null && (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 200)) {
            return yield* fail("invalid", "requestId must be a non-empty string")
          }
          const actor = yield* actorOf(meta)
          // The binding uses the input as it was sent, so a retry is recognised byte for byte.
          const bound = { input: rawInput, actor }
          const requestBinding: RequestBinding | undefined = requestId === null ? undefined : { action: name, digest: digest(bound), context: checkout.key }
          let nestedCount = 0
          // Writes made on behalf of this one keep its actor and get request ids derived from its own.
          const nested: ReadEnv["run"] = (other, otherInput) =>
            run(other, otherInput, { actor, ...(requestId === null ? {} : { requestId: `${requestId}:${other}:${++nestedCount}` }) })

          // The lock is taken first and the projection read under it, so the handler decides on
          // records no other writer can change underneath it.
          const body = Effect.gen(function*() {
            const projection = yield* project(set)
            if (requestId !== null) {
              // A record already carrying this id must have been made by this same request.
              for (const kind of ["note", "submission", "verdict", "collection"] as const) yield* priorRequest(projection, kind, requestId, requestBinding)
              yield* priorRequest(projection, "note", requestId, requestBinding, "lastRequestId")
            }
            return yield* handle({ ...base(projection, nested), actor, checkout, requestId, requestBinding })
          })
          const exec = action.lock ? records.withLock(action.lock(input), body) : body
          if (requestId === null) return yield* exec
          // One request id, one effect: the replay check and the write run under the same lock.
          return yield* records.withLock(`request:${requestId}`, Effect.gen(function*() {
            const prior = yield* records.replay(requestId, name, bound, checkout.key)
            if (prior) return { ...(prior.result as object), replayed: true }
            const result = yield* exec
            yield* records.remember(requestId, name, bound, checkout.key, result)
            return result
          }))
        })
      const withProjection = <A>(use: (projection: Projection, set: PluginSet) => Effect.Effect<A, ToolError>): Effect.Effect<A, ToolError> =>
        Effect.gen(function*() {
          const set = yield* plugins.current
          return yield* use(yield* project(set), set)
        })

      const assetFile = (id: string): Effect.Effect<AssetFile, ToolError> =>
        withProjection((projection) =>
          Effect.gen(function*() {
            const asset = projection.snapshot.assetsById.get(id)
            if (!asset) return yield* fail("not_found", "asset not found")
            const known = factsOf(projection, id)
            const { mime, size, token } = known
            if (known.state !== "ok" || mime === undefined || token === undefined || size === undefined) {
              return yield* fail(known.state === "forbidden" ? "forbidden" : "unavailable", known.error ?? known.state)
            }
            const located = yield* Effect.promise(() => assetFiles(files.root, projection.snapshot.assetRoots).locate(asset.path))
            if ("code" in located) return yield* Effect.fail(located)
            return { file: located.full, mime, version: token, size }
          }))

      // A result that names a review or a page says where to find it: a link when a server runs.
      const runLinked = (name: string, input?: unknown, meta?: RunMeta): Effect.Effect<unknown, ToolError> =>
        Effect.flatMap(run(name, input, meta), (result) =>
          hasRoutes(result) ? Effect.map(servers.known, (server) => linked(result, server?.url ?? null)) : Effect.succeed(result))

      return {
        run: runLinked,
        discover: Effect.map(plugins.current, (set) => registry.for(set).info),
        context: git.checkout,
        defaultActor,
        config: Effect.map(configs.current, (state) => state.config),
        assetFile,
        evidenceMedia: (submission, item, part, leaf = "") => withProjection((projection) => evidenceMedia(projection, evidence, submission, item, part, leaf)),
        beforeMedia: (submission, item, view) => withProjection((projection) => beforeMedia(projection, evidence, submission, item, view)),
        previewModule: (name) => Effect.flatMap(plugins.current, (set) => previewModule(set, name)),
        kindModule: (kind) => Effect.flatMap(plugins.current, (set) => kindModule(set, kind)),
        viewModule: (name) => Effect.flatMap(plugins.current, (set) => viewModule(set, name)),
        server: servers.known,
        writeLocal: records.writeLocal,
        stats: Effect.gen(function*() {
          const recordStats = yield* records.stats
          return {
            projections,
            recordScans: recordStats.scans,
            recordsParsed: recordStats.parsed,
            sourceLoads: yield* snapshots.loads,
            filesHashed: yield* media.hashed,
            probesMeasured: yield* facts.measured
          }
        })
      }
    })
  )

  /**
   * The whole engine for one project. Needs the kernel's ProjectFiles, Git and Ids for that project.
   * Keep the returned value: a layer is one catalog, and building it twice builds two.
   */
  static readonly layer: Layer.Layer<Catalog, never, ProjectFiles | Git | Ids> = Catalog.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(ReviewPolicy.layerNoDeps, Actions.layer)),
    Layer.provide(Layer.mergeAll(Plugins.layerNoDeps, Snapshot.layerNoDeps, Evidence.layerNoDeps)),
    Layer.provide(Layer.mergeAll(MediaKinds.layerNoDeps, Records.layerNoDeps, Facts.layerNoDeps, CatalogConfig.layerNoDeps, ServerState.layerNoDeps))
  )

  /** The engine with plugins registered by name and command-line overrides (see `Setup`). */
  static readonly layerWith = (setup: Partial<Setup>): Layer.Layer<Catalog, never, ProjectFiles | Git | Ids> =>
    Catalog.layer.pipe(Layer.provide(Layer.succeed(CatalogSetup, { plugins: setup.plugins ?? {}, overrides: setup.overrides ?? {} })))
}
