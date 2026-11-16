// Reading frozen evidence out of submissions: the leaves of a part, their verified status, and
// their bytes. A frozen side is never replaced by current content.
import * as Effect from "effect/Effect"
import { fail, type ToolError } from "../../kernel/errors.ts"
import type { Evidence } from "../Evidence.ts"
import { sniffWith } from "../MediaKinds.ts"
import type { FrozenPart, FrozenView, LeafEvidence, PartEvidence, SubmissionItem } from "../model/types.ts"
import type { ItemRef, Projection } from "../Projection.ts"
import { evidenceUrl, roleLabel } from "./summaries.ts"

export interface Leaf {
  /** Empty for a part with one byte stream; `<unit>/<part>` or `base` inside a member or preview. */
  readonly key: string
  readonly label: string
  readonly evidence: LeafEvidence
  readonly unit?: string
  readonly part?: string
}

export interface Media {
  readonly bytes: Uint8Array
  readonly mime: string | undefined
  readonly sha256: string
}

type EvidenceService = Evidence["Service"]

/** Leaf evidence of a frozen part; member parts expand to the member's own part evidence. */
export const leaves = (p: Projection, evidence: PartEvidence | undefined, label: string): ReadonlyArray<Leaf> => {
  if (!evidence) return []
  const ofUnit = (unit: string, parts: Readonly<Record<string, LeafEvidence>>): Array<Leaf> =>
    Object.entries(parts).map(([part, leaf]) => ({
      key: `${unit}/${part}`,
      label: `${p.snapshot.unitsById.get(unit)?.name ?? unit} · ${part === "attributes" ? "Attributes" : roleLabel(p, part.split(":")[0] ?? part)}`,
      evidence: leaf,
      unit,
      part
    }))
  if (evidence.parts && evidence.unit !== undefined) return ofUnit(evidence.unit, evidence.parts)
  if (evidence.members) {
    return [...Object.entries(evidence.members).flatMap(([unit, parts]) => ofUnit(unit, parts)), ...(evidence.base ? [{ key: "base", label: "Base", evidence: evidence.base }] : [])]
  }
  // A before/after capture: its two files, labelled as the submitter named them.
  if (evidence.pair) {
    const [before = "Before", after = "After"] = evidence.labels ?? []
    return [{ key: "before", label: `${label} · ${before}`, evidence: evidence.pair.before }, { key: "after", label: `${label} · ${after}`, evidence: evidence.pair.after }]
  }
  return [{ key: "", label, evidence }]
}

export const findItem = (p: Projection, submission: string, item: string): Effect.Effect<ItemRef, ToolError> => {
  const found = p.items.get(item)
  return found && found.submission.id === submission ? Effect.succeed(found) : fail("not_found", `item ${item} is not in submission ${submission}`)
}

export const frozenPart = (p: Projection, submission: string, item: string, part: string): Effect.Effect<{ readonly item: SubmissionItem; readonly part: FrozenPart }, ToolError> =>
  Effect.flatMap(findItem(p, submission, item), (found) => {
    const frozen = found.item.parts.find((candidate) => candidate.id === part)
    return frozen ? Effect.succeed({ item: found.item, part: frozen }) : fail("not_found", `part ${part} is not part of item ${item}`)
  })

export const publicEvidence = (evidence: PartEvidence) => ({
  digest: evidence.digest,
  asset: evidence.asset ?? null,
  path: evidence.path ?? null,
  kind: evidence.kind ?? null,
  mime: evidence.mime ?? null,
  size: evidence.size ?? null,
  sha256: evidence.sha256 ?? null,
  storage: storageOf(evidence),
  unit: evidence.unit ?? null
})

const storageOf = (evidence: LeafEvidence): "git" | "catalog" | null =>
  evidence.ref ? ("git" in evidence.ref ? "git" : "store" in evidence.ref ? "catalog" : null) : null

export const leafView = (evidence: EvidenceService, submission: string, item: string, part: string, leaf: Leaf) =>
  Effect.gen(function*() {
    const frozen = leaf.evidence
    if (frozen.kind === "attributes") return { key: leaf.key, label: leaf.label, kind: "attributes", status: "ok", attrs: frozen.attrs }
    if (!frozen.ref) return { key: leaf.key, label: leaf.label, kind: frozen.kind ?? null, status: "missing", error: "no evidence recorded" }
    const status = yield* evidence.status(frozen)
    return {
      key: leaf.key,
      label: leaf.label,
      kind: frozen.kind,
      path: frozen.path,
      asset: frozen.asset,
      sha256: frozen.sha256,
      unit: leaf.unit ?? null,
      part: leaf.part ?? null,
      renderer: frozen.renderer ?? null,
      storage: storageOf(frozen) ?? "catalog",
      ...status,
      url: status.status === "ok" ? evidenceUrl(submission, item, part, leaf.key) : null
    }
  })

const mediaOf = (p: Projection, evidence: EvidenceService, frozen: LeafEvidence): Effect.Effect<Media, ToolError> =>
  Effect.gen(function*() {
    const read = yield* evidence.readRef(frozen.ref, frozen.sha256)
    if (read.status !== "ok") return yield* fail(read.status === "corrupt" ? "malformed" : "unavailable", read.error)
    // The served type comes from the bytes, never from what the record claims.
    return { bytes: read.bytes, mime: sniffWith(p.plugins.mediaKinds, read.bytes.subarray(0, 64))?.mime ?? frozen.mime, sha256: read.sha256 }
  })

/** Bytes of a frozen evidence leaf, verified against its digest. */
export const evidenceMedia = (p: Projection, evidence: EvidenceService, submission: string, item: string, part: string, leafKey: string): Effect.Effect<Media, ToolError> =>
  Effect.gen(function*() {
    const frozen = yield* frozenPart(p, submission, item, part)
    const leaf = leaves(p, frozen.part.evidence, frozen.part.label).find((candidate) => candidate.key === leafKey)
    if (!leaf?.evidence.ref) return yield* fail("not_found", "no media evidence for this part")
    return yield* mediaOf(p, evidence, leaf.evidence)
  })

/** The public form of a stored view: its before side's verified status and media URL. */
export const viewOf = (evidence: EvidenceService, submission: string, item: string, view: FrozenView) =>
  Effect.gen(function*() {
    if (!view.before) return view
    const frozen = view.before.evidence
    const status = yield* evidence.status(frozen)
    return {
      ...view,
      before: {
        label: view.before.label,
        from: view.before.from ?? null,
        kind: frozen.kind,
        path: frozen.path,
        sha256: frozen.sha256,
        storage: storageOf(frozen) ?? "catalog",
        ...status,
        url: status.status === "ok" ? `/media/before/${encodeURIComponent(submission)}/${encodeURIComponent(item)}/${encodeURIComponent(view.id)}` : null
      }
    }
  })

/** Bytes of a view's frozen before side. */
export const beforeMedia = (p: Projection, evidence: EvidenceService, submission: string, item: string, viewId: string): Effect.Effect<Media, ToolError> =>
  Effect.gen(function*() {
    const found = yield* findItem(p, submission, item)
    const view = found.item.views.find((candidate) => candidate.id === viewId)
    if (!view?.before) return yield* fail("not_found", "this view has no before evidence")
    return yield* mediaOf(p, evidence, view.before.evidence)
  })
