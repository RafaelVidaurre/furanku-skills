// The review projection: for a unit or collection, the current verdict of each part across every
// submission that targets it, and whether the content changed since that verdict saw it.
import { digest } from "../../kernel/hash.ts"
import { shortRef } from "../../kernel/Ids.ts"
import { collectionParts, reviewAttrs, unitParts } from "../model/parts.ts"
import type { Collection, FrozenPart, Part, SubmissionItem, SubmissionRecord, Target, DecisionRecord } from "../model/types.ts"
import { decisionVerdicts, resolveParts, type Rollup, summarize } from "../model/verdicts.ts"
import { type DecisionSummary, factsOf, type ItemRef, type Projection, targetKey, type TargetReview, typeOf } from "../Projection.ts"

export const BUILTIN_PREVIEW = "assembled-mesh"

export const partsOf = (p: Projection, target: Target): ReadonlyArray<Part> => {
  if (target.kind === "unit") {
    const unit = p.snapshot.unitsById.get(target.id)
    return unit ? unitParts(unit, typeOf(p, unit)) : []
  }
  const collection = p.collectionsById.get(target.id)
  return collection ? collectionParts(collection, p.snapshot.unitsById, p.snapshot.schema) : []
}

export interface PreviewSpec {
  readonly module: string
  /** SHA-256 of a project module, "missing" when declared but absent, null for a built-in. */
  readonly moduleSha: string | null
  readonly label: string
  readonly represents: string
  readonly roles: ReadonlyArray<string>
  readonly config: Record<string, unknown>
  readonly base: string | null
  readonly baseDeclared: string | null
  /** Unit id to the member parts the preview shows. */
  readonly members: Readonly<Record<string, ReadonlyArray<{ readonly part: string; readonly asset: string; readonly role: string }>>>
}

/** A collection preview's inputs as its kind declares them: module, config, base and member roles. */
export const previewSpec = (p: Projection, collection: Collection): PreviewSpec | null => {
  const preview = collection.kind ? p.snapshot.schema.collectionKinds[collection.kind]?.preview : null
  if (!preview) return null
  const roles = Array.isArray(preview.roles) && preview.roles.length > 0 ? preview.roles : ["model"]
  const members: Record<string, Array<{ part: string; asset: string; role: string }>> = {}
  for (const member of collection.members) {
    const unit = p.snapshot.unitsById.get(member.unit)
    if (!unit) continue
    members[member.unit] = unitParts(unit, typeOf(p, unit)).flatMap((part) =>
      part.asset !== undefined && part.role !== undefined && roles.includes(part.role) ? [{ part: part.id, asset: part.asset, role: part.role }] : []
    )
  }
  const module = preview.module ?? BUILTIN_PREVIEW
  const declared = p.browserModules.has(module)
  return {
    module,
    moduleSha: declared ? p.browserModules.get(module) ?? "missing" : null,
    label: preview.label ?? "Preview",
    represents: preview.represents ?? "complete",
    roles,
    config: preview.config && typeof preview.config === "object" && !Array.isArray(preview.config) ? preview.config : {},
    base: preview.base !== undefined && p.snapshot.assetsById.has(preview.base) ? preview.base : null,
    baseDeclared: preview.base ?? null,
    members
  }
}

/** The module's identity (its bytes, or the built-in name) is part of what a preview verdict saw. */
export const previewDigest = (spec: PreviewSpec, shaOf: (asset: string) => string | null): string =>
  digest({
    module: spec.module,
    moduleSha: spec.moduleSha ?? `builtin:${spec.module}`,
    config: spec.config,
    roles: spec.roles,
    base: spec.base ? shaOf(spec.base) : null,
    members: Object.fromEntries(Object.entries(spec.members).map(([unit, parts]) => [unit, Object.fromEntries(parts.map((part) => [part.part, shaOf(part.asset)]))]))
  })

/** The assets whose bytes make up a part's current content (none for attributes). */
export const partAssets = (p: Projection, target: Target, partId: string): Array<string> => {
  const ofUnit = (unitId: string, only?: string): Array<string> => {
    const unit = p.snapshot.unitsById.get(unitId)
    if (!unit) return []
    return unitParts(unit, typeOf(p, unit)).flatMap((part) => (part.asset !== undefined && (only === undefined || part.id === only) ? [part.asset] : []))
  }
  if (target.kind === "unit") return ofUnit(target.id, partId)
  const collection = p.collectionsById.get(target.id)
  if (!collection) return []
  if (partId === "preview") {
    const spec = previewSpec(p, collection)
    return spec ? [...Object.values(spec.members).flatMap((parts) => parts.map((part) => part.asset)), ...(spec.base ? [spec.base] : [])] : []
  }
  return ofUnit(partId.replace(/^member:/, ""))
}

/**
 * The digest of a part's current content, comparable with the digest frozen in a submission.
 * It reads the digests the projection knows: hash the part's assets first (`ensureHashed`).
 */
export const currentDigest = (p: Projection, target: Target, partId: string): string | null => {
  const shaOf = (asset: string): string | null => factsOf(p, asset).sha256 ?? null
  if (target.kind === "unit") {
    const unit = p.snapshot.unitsById.get(target.id)
    if (!unit) return null
    const type = typeOf(p, unit)
    if (partId === "attributes") return digest(reviewAttrs(unit, type))
    const part = unitParts(unit, type).find((candidate) => candidate.id === partId)
    return part?.asset === undefined ? null : shaOf(part.asset)
  }
  const collection = p.collectionsById.get(target.id)
  if (!collection) return null
  if (partId === "preview") {
    const spec = previewSpec(p, collection)
    return spec ? previewDigest(spec, shaOf) : null
  }
  const unitId = partId.replace(/^member:/, "")
  if (!collection.members.some((member) => member.unit === unitId)) return null
  const unit = p.snapshot.unitsById.get(unitId)
  if (!unit) return null
  return digest(Object.fromEntries(unitParts(unit, typeOf(p, unit)).map((part) => [part.id, currentDigest(p, { kind: "unit", id: unitId }, part.id)])))
}

export const decisionSummary = (decision: DecisionRecord, submission: SubmissionRecord | undefined): DecisionSummary => ({
  id: decision.id,
  submission: decision.submission,
  ref: submission ? shortRef(submission.id) : null,
  item: decision.item,
  by: decision.by,
  at: decision.at,
  covers: decision.covers.kind,
  verdicts: decisionVerdicts(decision),
  comment: decision.comment ?? "",
  partComments: decision.partComments ?? {},
  ...(decision.relay === undefined ? {} : { relay: decision.relay })
})
export const summaryOf = (p: Projection, decision: DecisionRecord): DecisionSummary => decisionSummary(decision, p.items.get(decision.item)?.submission)

/**
 * Latest (configured) verdict per current part across every submission whose item targets this
 * entity. Verdicts never cascade between a collection and its members.
 */
export const reviewOf = (p: Projection, target: Target): TargetReview => {
  const key = targetKey(target)
  const known = p.reviews.get(key)
  if (known) return known
  const parts = partsOf(p, target).map((part) => ({ ...part, reviewable: p.policy.reviewable(part) }))
  const resolved = resolveParts(p.decisionsByTarget.get(key) ?? [], parts.map((part) => part.id), p.policy.resolver)
  const out = parts.map((part) => {
    const hit = resolved[part.id]
    if (!hit) return { ...part, verdict: null, decision: null, changed: false }
    const frozen = p.items.get(hit.decision.item)?.item.parts.find((candidate) => candidate.id === part.id)?.evidence
    return { ...part, verdict: hit.verdict, decision: summaryOf(p, hit.decision), changed: !!frozen && frozen.digest !== currentDigest(p, target, part.id) }
  })
  const value: TargetReview = { parts: out, summary: summarize(out.filter((part) => part.reviewable)) }
  p.reviews.set(key, value)
  return value
}

export interface ItemPartState {
  readonly id: string
  readonly label: string
  readonly reviewable: boolean
  readonly verdict: string | null
  readonly decision: DecisionSummary | null
}

/** Where one submission item stands, from the decisions recorded on it. */
export const itemState = (
  p: Projection,
  submission: SubmissionRecord,
  item: SubmissionItem,
  decisions: ReadonlyArray<DecisionRecord> = p.decisionsByItem.get(item.id) ?? []
): { readonly parts: ReadonlyArray<ItemPartState>; readonly summary: Rollup } => {
  const resolved = resolveParts(decisions, item.parts.map((part) => part.id), p.policy.resolver)
  const parts = item.parts.map((part: FrozenPart): ItemPartState => {
    const hit = resolved[part.id]
    return { id: part.id, label: part.label, reviewable: p.policy.reviewable(part), verdict: hit?.verdict ?? null, decision: hit ? decisionSummary(hit.decision, submission) : null }
  })
  return { parts, summary: summarize(parts.filter((part) => part.reviewable)) }
}

/** Submission items targeting this entity that still have undecided parts. */
export const openItemsFor = (p: Projection, target: Target) =>
  (p.itemsByTarget.get(targetKey(target)) ?? [])
    .map(({ item, submission }: ItemRef) => ({ submission: submission.id, ref: shortRef(submission.id), title: submission.title, item: item.id, state: itemState(p, submission, item).summary }))
    .filter((entry) => entry.state.undecided > 0)
