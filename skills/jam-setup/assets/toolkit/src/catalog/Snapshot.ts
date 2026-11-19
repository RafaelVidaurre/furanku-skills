// What the project's sources say right now: units, media, collections and types, merged across
// plugins. A source is loaded again only when one of its declared inputs changed, and the merged
// result is rebuilt only when some source was. Media facts follow the files by size and
// modification time; opening a project reads the head of each media file and hashes none.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"
import { fail, type ToolError } from "../kernel/errors.ts"
import { sha256 } from "../kernel/hash.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import { assetFiles } from "./assetFiles.ts"
import { CONFIG_FILE } from "./CatalogConfig.ts"
import { Changes, concerns } from "./Changes.ts"
import { fingerprint } from "./fingerprint.ts"
import { kindByExtension, MediaKinds } from "./MediaKinds.ts"
import { applyPatch, mergeSources } from "./model/merge.ts"
import { normalize, type Normalized } from "./model/normalize.ts"
import type { Asset, MediaFacts, Problem, Unit } from "./model/types.ts"
import type { Owned, PluginSet } from "./Plugins.ts"
import type { ProblemInput, Relation, Source, SourceOutput } from "./plugin.ts"
import { fromPlugin } from "./support.ts"

export interface RelationIndex {
  readonly defs: ReadonlyArray<Relation>
  /** Unit id to relation name to the ids it refers to. */
  readonly out: ReadonlyMap<string, ReadonlyMap<string, ReadonlyArray<string>>>
  /** Unit id to relation name to the ids that refer to it. */
  readonly in: ReadonlyMap<string, ReadonlyMap<string, ReadonlyArray<string>>>
}

export interface SnapshotData extends Normalized {
  /** Changes whenever a source or a media file did. */
  readonly version: string
  readonly unitsById: ReadonlyMap<string, Unit>
  readonly assetsById: ReadonlyMap<string, Asset>
  /**
   * Facts of every asset's file, by asset id. An entry gains its `sha256` when the digest is
   * first needed (see `ensureHashed`); nothing else about a snapshot changes after it is built.
   */
  readonly facts: Map<string, MediaFacts>
  readonly relations: RelationIndex
}

interface SourceState {
  fingerprint: string
  output: SourceOutput
  /** Set while the last load failed and an earlier output is still shown. */
  failure: ProblemInput | null
  /** Where the change feed stood when `fingerprint` was taken, and the inputs it was taken of. */
  mark: number
  inputs: string
  concerns: (changed: ReadonlySet<string>) => boolean
  /** Whether changes concern the folders its inputs are found in; null when it does not say. */
  scanned: ((changed: ReadonlySet<string>) => boolean) | null
}

interface Core {
  readonly signature: string
  readonly data: Omit<SnapshotData, "version" | "facts">
}

const sourceId = (source: Owned<Source>): string => `${source.plugin}/${source.value.name}`

const relate = (defs: ReadonlyArray<Relation>, units: ReadonlyArray<Unit>, problems: Array<Problem>): RelationIndex => {
  const out = new Map<string, Map<string, ReadonlyArray<string>>>()
  const into = new Map<string, Map<string, Array<string>>>()
  for (const def of defs) {
    for (const unit of units) {
      let ids: ReadonlyArray<string>
      try {
        ids = [...new Set(def.from(unit).filter((id) => typeof id === "string" && id !== unit.id))]
      } catch (cause) {
        problems.push({ subject: `relation ${def.name}`, error: `${unit.id}: ${cause instanceof Error ? cause.message : String(cause)}`, recovery: null })
        continue
      }
      if (ids.length === 0) continue
      out.set(unit.id, (out.get(unit.id) ?? new Map()).set(def.name, ids))
      for (const id of ids) {
        const reverse = into.get(id) ?? new Map<string, Array<string>>()
        reverse.set(def.name, [...(reverse.get(def.name) ?? []), unit.id])
        into.set(id, reverse)
      }
    }
  }
  return { defs, out, in: into }
}

export class Snapshot extends Context.Service<Snapshot, {
  /** The snapshot for a plugin set. The same object is returned while nothing it depends on changed. */
  current(plugins: PluginSet): Effect.Effect<SnapshotData>
  /** How many times each source (`plugin/source`) was loaded since this service started. */
  readonly loads: Effect.Effect<Readonly<Record<string, number>>>
  /** How many times a source's inputs were fingerprinted (read to tell whether they changed). */
  readonly checks: Effect.Effect<number>
}>()("jam/catalog/Snapshot") {
  static readonly layerNoDeps: Layer.Layer<Snapshot, never, ProjectFiles | MediaKinds | Changes> = Layer.effect(
    Snapshot,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const media = yield* MediaKinds
      const changes = yield* Changes
      const loads: Record<string, number> = {}
      let checks = 0
      const fingerprinted = (inputs: ReadonlyArray<string>): Effect.Effect<string> => Effect.suspend(() => (checks++, fingerprint(files, inputs)))
      let pluginSignature: string | null = null
      let states = new Map<string, SourceState>()
      let core: Core | null = null
      let last: SnapshotData | null = null
      // The media facts of `last`: where the change feed stood when they were read, and which paths they cover.
      let factsOf: { readonly core: Core; readonly mark: number; readonly concerns: (changed: ReadonlySet<string>) => boolean } | null = null

      const scansOf = (source: Owned<Source>): Effect.Effect<((changed: ReadonlySet<string>) => boolean) | null> => {
        const scans = source.value.scans
        if (scans === undefined) return Effect.succeed(null)
        return fromPlugin(`scans of source ${source.value.name}`, () => scans.call(source.value, source.context)).pipe(
          Effect.map((folders) => (Array.isArray(folders) && folders.every((folder) => typeof folder === "string") ? concerns(folders as ReadonlyArray<string>) : null)),
          Effect.catch(() => Effect.succeed(null))
        )
      }
      const inputsOf = (source: Owned<Source>): Effect.Effect<ReadonlyArray<string>, ToolError> =>
        fromPlugin(`inputs of source ${source.value.name}`, () => source.value.inputs(source.context)).pipe(
          Effect.flatMap((inputs) =>
            Array.isArray(inputs) && inputs.every((input) => typeof input === "string")
              ? Effect.succeed(inputs as ReadonlyArray<string>)
              : fail("invalid", `inputs of source ${source.value.name}: expected a list of project-relative paths`))
        )

      /** A source that could not say what it reads or could not load: its last output stays, with a problem. */
      const failed = (id: string, source: Owned<Source>, state: SourceState | undefined, print: string, what: string, seen: Seen): boolean => {
        const error = `source ${source.value.name} failed: ${what}`
        // Keep showing what loaded last; an empty catalog would hide every note and review.
        states.set(id, state
          ? { ...state, ...seen, fingerprint: print, failure: { subject: id, error, recovery: "showing the last successfully loaded content; fix the source's input and refresh" } }
          : { ...seen, fingerprint: print, output: {}, failure: { subject: id, error, recovery: `check ${CONFIG_FILE} and the source's files` } })
        return true
      }
      type Seen = Pick<SourceState, "mark" | "inputs" | "concerns" | "scanned">
      const seenAt = (mark: number, inputs: ReadonlyArray<string>, scanned: SourceState["scanned"]): Seen => ({ mark, inputs: inputs.join("\n"), concerns: concerns(inputs), scanned })

      /** Bring one source up to date; true when its output changed. */
      const refresh = (source: Owned<Source>): Effect.Effect<boolean> =>
        Effect.gen(function*() {
          const id = sourceId(source)
          const state = states.get(id)
          const mark = yield* changes.mark
          // Nothing changed that its inputs, or the folders they are found in, could follow from:
          // what it would declare and read is what it did last time.
          if (state !== undefined) {
            const changed = yield* changes.since(state.mark)
            if (changed !== null && (changed.size === 0 || (state.scanned !== null && !state.scanned(changed) && !state.concerns(changed)))) {
              state.mark = mark
              return false
            }
          }
          const scanned = yield* scansOf(source)
          const declared = yield* Effect.result(inputsOf(source))
          if (declared._tag === "Failure") {
            // Without its inputs a source cannot be told fresh from stale: it is a problem, never an empty list.
            const print = `inputs failed: ${declared.failure.message}`
            return state?.fingerprint === print ? false : failed(id, source, state, print, declared.failure.message, seenAt(mark, [], null))
          }
          const before = declared.success
          // Nothing it reads changed since it was last fingerprinted: the same, without reading a file.
          if (state !== undefined && state.inputs === before.join("\n")) {
            const changed = yield* changes.since(state.mark)
            if (changed !== null && !state.concerns(changed)) {
              state.mark = mark
              state.scanned = scanned
              return false
            }
          }
          const print = yield* fingerprinted(before)
          if (state?.fingerprint === print) {
            states.set(id, { ...state, ...seenAt(mark, before, scanned) })
            return false
          }
          loads[id] = (loads[id] ?? 0) + 1
          const loaded = yield* Effect.result(fromPlugin(`source ${source.value.name}`, () => source.value.load(source.context)))
          if (loaded._tag === "Failure") return failed(id, source, state, print, loaded.failure.message.replace(`source ${source.value.name}: `, ""), seenAt(mark, before, scanned))
          // What a source reads may depend on what it loaded (a manifest naming its folders).
          const after = yield* Effect.result(inputsOf(source))
          if (after._tag === "Failure") return failed(id, source, { ...seenAt(mark, before, scanned), fingerprint: print, output: loaded.success ?? {}, failure: null }, print, after.failure.message, seenAt(mark, before, scanned))
          // The inputs are fingerprinted again after the load: a source that refreshes a file it
          // reads (an engine inventory written in place) would otherwise look changed on every action.
          states.set(id, { ...seenAt(mark, after.success, scanned), fingerprint: yield* fingerprinted(after.success), output: loaded.success ?? {}, failure: null })
          return true
        })

      const build = (plugins: PluginSet): Effect.Effect<Core["data"]> =>
        Effect.gen(function*() {
          const outputs = plugins.sources.map((source) => ({ source: source.value.name, output: states.get(sourceId(source))?.output ?? {} }))
          let merged = mergeSources(outputs)
          const reported: Array<ProblemInput> = [...merged.problems]
          for (const source of plugins.sources) {
            const failure = states.get(sourceId(source))?.failure
            if (failure) reported.push(failure)
          }
          for (const enricher of plugins.enrichers) {
            const patch = yield* Effect.result(fromPlugin(`enrich by ${enricher.plugin}`, () => enricher.value(merged.sources, enricher.context)))
            if (patch._tag === "Failure") {
              reported.push({ subject: `plugin ${enricher.plugin}`, error: patch.failure.message, recovery: "the plugin's changes are left out until it runs" })
              continue
            }
            merged = applyPatch(merged.sources, patch.success, enricher.plugin)
            reported.push(...merged.problems)
          }
          const within = assetFiles(files.root, merged.sources.assetRoots.filter((root) => typeof root === "string"))
          const normalized = yield* normalize(merged.sources, reported, {
            scopes: plugins.scopes.map((scope) => scope.id),
            kinds: plugins.mediaKinds.map((kind) => kind.id),
            kindOf: (path) => kindByExtension(plugins.mediaKinds, path),
            confine: (path) => Effect.map(Effect.promise(() => within.locate(path)), (located) => ("code" in located ? located.message : null))
          })
          const problems = [...normalized.problems]
          const relations = relate(plugins.relations, normalized.units, problems)
          return {
            ...normalized,
            problems,
            relations,
            unitsById: new Map(normalized.units.map((unit) => [unit.id, unit])),
            assetsById: new Map(normalized.assets.map((asset) => [asset.id, asset]))
          }
        })

      // Refreshes share the source states, so actions arriving together take turns. A caller that
      // waited while a check ran takes the result of a check that began after it arrived, so a
      // burst (a page fetching its thumbnails) costs at most two checks and every answer still
      // reflects the files as they were when it was asked for.
      const turn = Semaphore.makeUnsafe(1)
      let begun = 0
      let finished: { readonly round: number; readonly signature: string } | null = null
      const current = (plugins: PluginSet): Effect.Effect<SnapshotData> =>
        Effect.suspend(() => {
          const arrived = begun
          return turn.withPermit(Effect.suspend(() =>
            last !== null && finished !== null && finished.round > arrived && finished.signature === plugins.signature
              ? Effect.succeed(last)
              : Effect.suspend(() => {
                const round = ++begun
                return Effect.tap(check(plugins), () => Effect.sync(() => void (finished = { round, signature: plugins.signature })))
              })
          ))
        })
      const check = (plugins: PluginSet): Effect.Effect<SnapshotData> =>
        Effect.gen(function*() {
          if (pluginSignature !== plugins.signature) {
            // New plugin objects: nothing loaded by the old ones can be trusted to match.
            pluginSignature = plugins.signature
            states = new Map()
            core = null
          }
          const changed = yield* Effect.forEach(plugins.sources, refresh, { concurrency: 4 })
          if (core === null || changed.some(Boolean)) {
            const signature = sha256(plugins.sources.map((source) => `${sourceId(source)}:${states.get(sourceId(source))?.fingerprint}`).join("\n"))
            core = { signature: sha256(`${plugins.signature}\n${signature}`), data: yield* build(plugins) }
          }
          const { data, signature } = core
          const factsMark = yield* changes.mark
          // No media file (nor a folder holding one) changed since their facts were read: they still hold.
          if (last !== null && factsOf !== null && factsOf.core === core) {
            const changed = yield* changes.since(factsOf.mark)
            if (changed !== null && !factsOf.concerns(changed)) {
              factsOf = { ...factsOf, mark: factsMark }
              return last
            }
          }
          const within = assetFiles(files.root, data.assetRoots)
          const facts = yield* Effect.forEach(data.assets, (asset) => media.facts(asset, plugins.mediaKinds, within), { concurrency: 16 })
          yield* media.persist
          const mediaSignature = sha256(data.assets.map((asset, index) => {
            const fact = facts[index]!
            return `${asset.id}:${fact.state}:${fact.token ?? ""}:${fact.error ?? ""}`
          }).join("\n"))
          const version = `${signature.slice(0, 6)}${mediaSignature.slice(0, 6)}`
          factsOf = { core, mark: factsMark, concerns: factsOf?.core === core ? factsOf.concerns : concerns(data.assets.map((asset) => asset.path)) }
          if (last !== null && last.version === version && last.units === data.units) return last
          last = { ...data, version, facts: new Map(data.assets.map((asset, index) => [asset.id, facts[index]!])) }
          return last
        })

      return { current, loads: Effect.sync(() => ({ ...loads })), checks: Effect.sync(() => checks) }
    })
  )
}
