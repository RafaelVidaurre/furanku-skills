// The catalog as other code uses it: run an action, list the actions, read media. The CLI, the
// HTTP server and tests all go through this one service, so people and agents get the same
// validation, the same attribution and the same answers.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { decode } from "../kernel/decode.ts"
import { fail, type ToolError } from "../kernel/errors.ts"
import { type Checkout, Git } from "../kernel/Git.ts"
import { digest, isNonEmpty, isRecord } from "../kernel/hash.ts"
import { Ids } from "../kernel/Ids.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import { type ActionDef, type ActionServices, priorRequest, type ReadEnv, type WriteEnv } from "./action.ts"
import type { ActionName, ActionOutput, InputArgs, OtherAction } from "./actionMap.ts"
import { type ActionInfo, Actions, CatalogOutputCheck, checkOutput, unknownActionFix } from "./Actions.ts"
import { assetFiles } from "./assetFiles.ts"
import { type BrowserModule, moduleDigests, readBrowserModule } from "./browserModules.ts"
import { Changes, concerns } from "./Changes.ts"
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

export type { ActionInput, ActionMap, ActionName, ActionOutput } from "./actionMap.ts"

/** Who is acting and how a write is identified. Reads need none of it. */
export interface RunMeta {
  /** Required for writes. A declaration, not proof of identity. */
  readonly actor?: { readonly name?: unknown; readonly kind?: unknown } | undefined
  /** Makes a write repeatable: the same id with the same input records once and returns the first result. */
  readonly requestId?: string | undefined
  /** The checkout key a write was prepared in (`checkout.key`); the write fails `checkout_changed` when the checkout has moved. */
  readonly checkoutKey?: string | undefined
}

export interface AssetFile {
  /** Absolute path, confined to the asset roots after resolving symbolic links. */
  readonly file: string
  readonly mime: string
  /** The file's version token (size and modification time): the `v` of its URL. Serving never hashes. */
  readonly version: string
  readonly size: number
}

/** Counters that show how much work actions caused; the performance rules are tested with them. */
export interface CatalogStats {
  readonly projections: number
  readonly recordScans: number
  readonly recordsParsed: number
  readonly sourceLoads: Readonly<Record<string, number>>
  /** Times a source's inputs were read to tell whether they changed. */
  readonly inputChecks: number
  readonly filesHashed: number
  readonly probesMeasured: number
}

/** Runs an action by name: typed for a built-in or viewer action, untyped for any other (a plugin's). */
export interface RunCatalogAction {
  <A extends ActionName>(action: A, ...args: InputArgs<A, [meta?: RunMeta]>): Effect.Effect<ActionOutput<A>, ToolError>
  <N extends string>(action: OtherAction<N>, input?: unknown, meta?: RunMeta): Effect.Effect<unknown, ToolError>
}

/** How much work the catalog has done, for tests and diagnostics; not part of using the catalog. */
export class CatalogDiagnostics extends Context.Service<CatalogDiagnostics, {
  readonly stats: Effect.Effect<CatalogStats>
}>()("jam/catalog/CatalogDiagnostics") {}

export class Catalog extends Context.Service<Catalog, {
  /** Run an action by name. Reads need only input; writes need `meta.actor`. */
  readonly run: RunCatalogAction
  /** Every action of this checkout (built-in and from plugins) with its input and output as JSON Schema. */
  readonly discover: Effect.Effect<ReadonlyArray<ActionInfo>, ToolError>
  /** Which worktree and branch this is. Runs no `git status`. */
  readonly checkout: Effect.Effect<Checkout>
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
  /** A browser module a plugin declares by name (inspectors, panels, previews): trusted project code for the page. */
  browserModule(name: string): Effect.Effect<BrowserModule, ToolError>
  /** The declared browser module of a media kind: what registers its viewer, thumbnail and comparer. */
  kindModule(kind: string): Effect.Effect<BrowserModule, ToolError>
  /** The server of this checkout, when one is running (see `ServerState`). */
  readonly server: Effect.Effect<ServerRecord | null>
  /** Write a machine-local file such as a capture (`captures/<name>.png`); returns its project path. */
  writeLocal(relative: string, bytes: Uint8Array): Effect.Effect<string, ToolError>
  /**
   * Follow the checkout by the file changes the system reports, until the scope closes: an action
   * then re-reads only inputs that changed instead of checking every one. For a process that
   * keeps running (the server); without it every action checks everything.
   */
  readonly follow: Effect.Effect<void, never, Scope.Scope>
}>()("jam/catalog/Catalog") {
  /** Toolkit-internal: the facade over services the caller provides. Use `layer` or `layerWith`. */
  static readonly layerNoDeps: Layer.Layer<Catalog | CatalogDiagnostics, never, Actions | Plugins | CatalogConfig | Snapshot | ReviewPolicy | ServerState | Changes | ActionServices> = Layer.effectContext(
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
      const checked = yield* CatalogOutputCheck
      const changes = yield* Changes
      let lastProjection: { readonly made: string; readonly value: Projection } | null = null
      let projections = 0
      // The digests of the declared browser modules in the project, while none of their files
      // changed. A module beside a plugin outside the project is read every time: no event reports it.
      let digests: { mark: number; readonly declared: string; readonly concerns: (changed: ReadonlySet<string>) => boolean; readonly modules: Map<string, string | null>; readonly kinds: Map<string, string | null> } | null = null
      const outside = (declared: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(declared).filter(([, reference]) => reference.startsWith("file:")))
      const inside = (declared: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(declared).filter(([, reference]) => !reference.startsWith("file:")))
      const moduleVersions = (set: PluginSet): Effect.Effect<{ readonly modules: Map<string, string | null>; readonly kinds: Map<string, string | null> }> =>
        Effect.gen(function*() {
          const mark = yield* changes.mark
          const declared = JSON.stringify([set.browserModules, set.kindModules])
          let known = digests !== null && digests.declared === declared ? digests : null
          if (known !== null) {
            const changed = yield* changes.since(known.mark)
            if (changed === null || known.concerns(changed)) known = null
          }
          if (known === null) {
            known = {
              mark,
              declared,
              concerns: concerns([...Object.values(inside(set.browserModules)), ...Object.values(inside(set.kindModules))]),
              modules: yield* moduleDigests(files, inside(set.browserModules), "browser module"),
              kinds: yield* moduleDigests(files, inside(set.kindModules), "media kind module")
            }
          }
          known.mark = mark
          digests = known
          const order = (all: Readonly<Record<string, string>>, ...parts: ReadonlyArray<Map<string, string | null>>) =>
            new Map(Object.keys(all).map((name) => [name, parts.find((part) => part.has(name))?.get(name) ?? null]))
          return {
            modules: order(set.browserModules, known.modules, yield* moduleDigests(files, outside(set.browserModules), "browser module")),
            kinds: order(set.kindModules, known.kinds, yield* moduleDigests(files, outside(set.kindModules), "media kind module"))
          }
        })

      // The Git user rarely changes while a catalog runs; asking once keeps `summary` free of it.
      const defaultActor = yield* Effect.cached(Effect.map(git.userName, (name): Actor => ({ name: name ?? "Local user", kind: "human" })))

      // Only what a plugin declared is ever read for the browser.
      const browserModule = (set: PluginSet, name: string): Effect.Effect<BrowserModule, ToolError> => {
        const reference = Object.hasOwn(set.browserModules, name) ? set.browserModules[name] : undefined
        return typeof reference === "string" ? readBrowserModule(files, reference, `browser module ${name}`) : fail("not_found", `no browser module ${name}`)
      }
      const kindModule = (set: PluginSet, kind: string): Effect.Effect<BrowserModule, ToolError> => {
        const reference = Object.hasOwn(set.kindModules, kind) ? set.kindModules[kind] : undefined
        return typeof reference === "string" ? readBrowserModule(files, reference, `browser module of media kind ${kind}`) : fail("not_found", `media kind ${kind} declares no browser module`)
      }

      /** The one projection of an action: current sources, current records, current policy. */
      const project = (set: PluginSet): Effect.Effect<Projection, ToolError> =>
        Effect.gen(function*() {
          const actions = registry.for(set)
          const effective = actions.problems.length > 0 ? { ...set, problems: [...set.problems, ...actions.problems] } : set
          const snapshot = yield* snapshots.current(set)
          const view = yield* records.view
          const { modules, kinds } = yield* moduleVersions(set)
          // Nothing it is made of changed: the same projection (and what it already computed) serves again.
          const made = JSON.stringify([set.signature, effective.problems, [...modules], [...kinds]])
          if (lastProjection && lastProjection.made === made && lastProjection.value.snapshot === snapshot && lastProjection.value.records === view) return lastProjection.value
          projections++
          const projection = buildProjection(snapshot, view, policies.for(set), effective, { modules, kinds })
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
          if (!action) return yield* fail("not_found", `unknown action ${name}`, { fix: unknownActionFix(name) })
          // A schema's decoding services are unknown to the type of the registry; action inputs need none.
          const input = (yield* (decode(action.input, { what: `input of ${name}` })(rawInput ?? {}) as Effect.Effect<unknown, ToolError>)) as never
          const handle = (env: WriteEnv): Effect.Effect<unknown, ToolError> => Effect.provideContext(action.run(input, env), services)
          const actor = yield* defaultActor
          // A read may run other reads (a plugin check asking the catalog); never a write.
          const runRead: ReadEnv["run"] = (other, otherInput) =>
            registry.for(set).actions.get(other)?.access === "write" ? fail("forbidden", `only read actions can be run from here; ${other} is a write action`) : run(other, otherInput)
          const base = (projection: Projection, nested: ReadEnv["run"]): ReadEnv => ({
            projection,
            currentCheckout: git.checkout,
            defaultActor: actor,
            run: nested,
            runRead,
            // What the action changed so far is read now.
            refresh: Effect.andThen(changes.settle, project(set))
          })

          if (action.access === "read") return yield* handle(base(yield* project(set), runRead) as WriteEnv)
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
          if (meta.checkoutKey && meta.checkoutKey !== checkout.key) {
            return yield* fail("checkout_changed", `this checkout changed to ${checkout.branch ?? `detached ${checkout.head?.slice(0, 8)}`}; reload before saving`, { details: { checkout } })
          }
          const requestId = meta.requestId ?? null
          if (requestId !== null && (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 200)) {
            return yield* fail("invalid", "requestId must be a non-empty string")
          }
          const actor = yield* actorOf(meta)
          // The binding uses the input as it was sent, so a retry is recognised byte for byte.
          const bound = { input: rawInput, actor }
          const requestBinding: RequestBinding | undefined = requestId === null ? undefined : { action: name, digest: digest(bound), checkout: checkout.key }
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
              for (const kind of ["note", "submission", "decision", "collection"] as const) yield* priorRequest(projection, kind, requestId, requestBinding)
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
      // Every way in starts by settling the change feed, so an answer reflects the files as they
      // were when it was asked for. Nested runs inside an action do not settle again.
      const current = Effect.andThen(changes.settle, plugins.current)
      const withProjection = <A>(use: (projection: Projection, set: PluginSet) => Effect.Effect<A, ToolError>): Effect.Effect<A, ToolError> =>
        Effect.gen(function*() {
          const set = yield* current
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
        Effect.flatMap(Effect.andThen(changes.settle, run(name, input, meta)), (result) => {
          const answer = hasRoutes(result) ? Effect.map(servers.known, (server) => linked(result, server?.url ?? null)) : Effect.succeed(result)
          if (!checked) return answer
          // What the caller receives is what the action declares, field for field.
          return Effect.flatMap(answer, (value) =>
            Effect.flatMap(plugins.current, (set) => {
              const action = registry.for(set).actions.get(name)
              return action ? checkOutput(name, action.output, value) : Effect.succeed(value)
            }))
        })

      const catalog: Catalog["Service"] = {
        run: runLinked as RunCatalogAction,
        discover: Effect.map(current, (set) => registry.for(set).info),
        checkout: git.checkout,
        defaultActor,
        config: Effect.map(configs.current, (state) => state.config),
        assetFile,
        evidenceMedia: (submission, item, part, leaf = "") => withProjection((projection) => evidenceMedia(projection, evidence, submission, item, part, leaf)),
        beforeMedia: (submission, item, view) => withProjection((projection) => beforeMedia(projection, evidence, submission, item, view)),
        browserModule: (name) => Effect.flatMap(current, (set) => browserModule(set, name)),
        kindModule: (kind) => Effect.flatMap(current, (set) => kindModule(set, kind)),
        server: servers.known,
        writeLocal: records.writeLocal,
        follow: changes.watch
      }
      const diagnostics: CatalogDiagnostics["Service"] = {
        stats: Effect.gen(function*() {
          const recordStats = yield* records.stats
          return {
            projections,
            recordScans: recordStats.scans,
            recordsParsed: recordStats.parsed,
            sourceLoads: yield* snapshots.loads,
            inputChecks: yield* snapshots.checks,
            filesHashed: yield* media.hashed,
            probesMeasured: yield* facts.measured
          }
        })
      }
      return Context.make(Catalog, catalog).pipe(Context.add(CatalogDiagnostics, diagnostics))
    })
  )

  /**
   * The whole engine for one project, with its diagnostics. Needs the kernel's ProjectFiles, Git
   * and Ids for that project. Keep the returned value: a layer is one catalog, and building it
   * twice builds two.
   */
  static readonly layer: Layer.Layer<Catalog | CatalogDiagnostics, never, ProjectFiles | Git | Ids> = Catalog.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(ReviewPolicy.layerNoDeps, Actions.layer)),
    Layer.provide(Layer.mergeAll(Plugins.layerNoDeps, Snapshot.layerNoDeps, Evidence.layerNoDeps)),
    Layer.provide(Layer.mergeAll(MediaKinds.layerNoDeps, Records.layerNoDeps, Facts.layerNoDeps, CatalogConfig.layerNoDeps, ServerState.layerNoDeps)),
    Layer.provide(Changes.layerNoDeps)
  )

  /** The engine with plugins registered by name and command-line overrides (see `Setup`). */
  static readonly layerWith = (setup: Partial<Setup>): Layer.Layer<Catalog | CatalogDiagnostics, never, ProjectFiles | Git | Ids> =>
    Catalog.layer.pipe(Layer.provide(Layer.succeed(CatalogSetup, { plugins: setup.plugins ?? {}, defaults: setup.defaults, overrides: setup.overrides ?? {} })))
}
