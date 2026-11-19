// The SHA-256 of media files, computed when something needs it. A project can hold gigabytes of
// media; lists and browse pages identify a file by its cheap version token, and only the files an
// answer really depends on (a detail page, a frozen part, a verdict to check against) are read.
import * as Effect from "effect/Effect"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import { assetFiles } from "./assetFiles.ts"
import { MediaKinds } from "./MediaKinds.ts"
import { decisionVerdicts } from "./model/verdicts.ts"
import type { Target } from "./model/types.ts"
import type { Projection } from "./Projection.ts"
import { partAssets } from "./queries/review.ts"

/**
 * Make the digests of these assets known to the projection. Files already hashed at their current
 * size and modification time cost a lookup; a file that cannot be read stays without a digest.
 */
export const ensureHashed = (p: Projection, assets: Iterable<string>): Effect.Effect<void, never, MediaKinds | ProjectFiles> =>
  Effect.gen(function*() {
    const { assetsById, facts } = p.snapshot
    const wanted = [...new Set(assets)].filter((id) => {
      const known = facts.get(id)
      return known !== undefined && known.state === "ok" && known.sha256 === undefined
    })
    if (wanted.length === 0) return
    const media = yield* MediaKinds
    const within = assetFiles((yield* ProjectFiles).root, p.snapshot.assetRoots)
    yield* Effect.forEach(wanted, (id) =>
      Effect.map(media.hash(assetsById.get(id)!.path, within), (sha256) => {
        const known = facts.get(id)
        if (sha256 !== null && known !== undefined) facts.set(id, { ...known, sha256 })
      }), { concurrency: 4, discard: true })
    yield* media.persist
  })

/** Every asset a target's parts show: what must be hashed to compare the target with frozen evidence. */
export const targetAssets = (p: Projection, target: Target): Array<string> => {
  const parts = target.kind === "unit"
    ? (p.snapshot.unitsById.get(target.id)?.links ?? []).map((link) => link.asset)
    : target.kind === "collection"
    ? ["preview", ...(p.collectionsById.get(target.id)?.members ?? []).map((member) => `member:${member.unit}`)].flatMap((part) => partAssets(p, target, part))
    : target.kind === "asset" ? [target.id] : []
  return [...new Set(parts)]
}

/**
 * The assets behind every part that has a verdict. "Changed since its verdict" compares the
 * digest a verdict saw with the current one, so these are the only files a list ever needs hashed.
 */
export const decidedAssets = (p: Projection): Array<string> => {
  const out = new Set<string>()
  for (const events of p.decisionsByTarget.values()) {
    // Events are grouped by target, so the item of each one has a target.
    const target = p.items.get(events[0]!.item)!.item.target!
    const parts = new Set(events.flatMap((event) => Object.keys(decisionVerdicts(event))))
    for (const part of parts) for (const asset of partAssets(p, target, part)) out.add(asset)
  }
  return [...out]
}
