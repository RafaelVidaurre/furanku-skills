// Measured facts of media files. A probe runs once per file version: its result is stored under
// .catalog/.local/facts by probe name, probe version and the file's SHA-256, so the same bytes are
// never measured twice on a machine, across commands and restarts.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { isRecord } from "../kernel/hash.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import type { Asset, MediaFacts } from "./model/types.ts"
import type { Owned } from "./Plugins.ts"
import type { Probe } from "./plugin.ts"
import { ensureLocal } from "./records/files.ts"
import { fileKey, LOCAL_DIR } from "./records/layout.ts"
import { fromPlugin } from "./support.ts"

/** What one probe says about one file: its facts, or why it could not measure. */
export type ProbeResult = { readonly facts: Readonly<Record<string, unknown>> } | { readonly error: string }

export class Facts extends Context.Service<Facts, {
  /** Results of every probe that measures this asset's kind, by probe name. Empty unless the file is readable. */
  forAsset(asset: Asset, facts: MediaFacts, probes: ReadonlyArray<Owned<Probe>>): Effect.Effect<Readonly<Record<string, ProbeResult>>>
  /** How many times a probe actually ran (not served from the cache) since this service started. */
  readonly measured: Effect.Effect<number>
}>()("jam/catalog/Facts") {
  static readonly layerNoDeps: Layer.Layer<Facts, never, ProjectFiles> = Layer.effect(
    Facts,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const memory = new Map<string, ProbeResult>()
      let measured = 0

      const cachePath = (probe: Probe, sha256: string): string => `${LOCAL_DIR}/facts/${fileKey(probe.name)}/${fileKey(probe.version)}/${sha256}.json`

      const one = (asset: Asset, facts: MediaFacts & { sha256: string; kind: string }, owned: Owned<Probe>): Effect.Effect<ProbeResult> =>
        Effect.gen(function*() {
          const probe = owned.value
          const path = cachePath(probe, facts.sha256)
          const known = memory.get(path)
          if (known) return known
          const stored = yield* files.readJson(path, { noFollow: true }).pipe(Effect.catch(() => Effect.succeed(null)))
          if (isRecord(stored) && isRecord(stored["facts"])) {
            const result: ProbeResult = { facts: stored["facts"] }
            memory.set(path, result)
            return result
          }
          measured++
          const full = yield* files.resolve(asset.path).pipe(Effect.catch(() => Effect.succeed(asset.path)))
          const run = yield* Effect.result(fromPlugin(`probe ${probe.name} on ${asset.path}`, () =>
            probe.measure({ asset: asset.id, path: asset.path, absolutePath: full, sha256: facts.sha256, size: facts.size ?? 0, mime: facts.mime ?? "", kind: facts.kind }, owned.context)))
          // A failure is reported and not stored: the next read tries again.
          if (run._tag === "Failure") return { error: run.failure.message }
          const result: ProbeResult = { facts: isRecord(run.success) ? run.success : {} }
          memory.set(path, result)
          // The cache is an optimisation; a checkout that cannot be written still gets its facts.
          yield* ensureLocal(files).pipe(
            Effect.andThen(files.writeText(path, JSON.stringify({ probe: probe.name, version: probe.version, sha256: facts.sha256, facts: result.facts }), { noFollow: true })),
            Effect.catch(() => Effect.void)
          )
          return result
        })

      const forAsset = (asset: Asset, facts: MediaFacts, probes: ReadonlyArray<Owned<Probe>>) =>
        Effect.gen(function*() {
          const { kind, sha256, state } = facts
          if (state !== "ok" || sha256 === undefined || kind === undefined) return {}
          const applicable = probes.filter((probe) => probe.value.kinds.includes(kind))
          const results = yield* Effect.forEach(applicable, (probe) => one(asset, { ...facts, sha256, kind }, probe))
          return Object.fromEntries(applicable.map((probe, index) => [probe.value.name, results[index]!]))
        })

      return { forAsset, measured: Effect.sync(() => measured) }
    })
  )
}
