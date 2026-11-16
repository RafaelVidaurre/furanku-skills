// Comparing frozen evidence of a part with current content or with another frozen part. Each
// side resolves on its own: a side that is missing or corrupt says so and is never filled in
// from the other.
import * as Effect from "effect/Effect"
import type { ToolError } from "../../kernel/errors.ts"
import { digest } from "../../kernel/hash.ts"
import type { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import type { Evidence } from "../Evidence.ts"
import { ensureHashed, targetAssets } from "../hashes.ts"
import type { MediaKinds } from "../MediaKinds.ts"
import { reviewAttrs, unitParts } from "../model/parts.ts"
import type { LeafEvidence } from "../model/types.ts"
import { factsOf, type Projection, typeOf } from "../Projection.ts"
import { frozenPart, type Leaf, leaves } from "./evidence.ts"
import { previewSpec } from "./review.ts"
import { assetUrl, evidenceUrl } from "./summaries.ts"

export interface FrozenRef {
  readonly submission: string
  readonly item: string
  readonly part: string
}

/** Current content standing in for one side: what the working tree holds for the same identity. */
type Current = { readonly current: true; readonly kind: string | null; readonly asset: string; readonly path: string; readonly sha256: string | null; readonly token: string | undefined; readonly size: number | undefined; readonly mime: string | undefined; readonly state: string; readonly error: string | undefined }
type Side = LeafEvidence | Current | null

const MISSING = { status: "missing", error: "not present on this side" } as const

const currentAsset = (p: Projection, assetId: string): Current | null => {
  const asset = p.snapshot.assetsById.get(assetId)
  if (!asset) return null
  const facts = factsOf(p, asset.id)
  return { current: true, kind: asset.kind, asset: asset.id, path: asset.path, sha256: facts.sha256 ?? null, token: facts.token, size: facts.size, mime: facts.mime, state: facts.state, error: facts.error }
}

const currentLeaf = (p: Projection, unitId: string, partId: string): Side => {
  const unit = p.snapshot.unitsById.get(unitId)
  if (!unit) return null
  const type = typeOf(p, unit)
  if (partId === "attributes") {
    const attrs = reviewAttrs(unit, type)
    return { kind: "attributes", attrs, digest: digest(attrs) }
  }
  const part = unitParts(unit, type).find((candidate) => candidate.id === partId)
  return part?.asset === undefined ? null : currentAsset(p, part.asset)
}

const sideView = (evidence: Evidence["Service"], side: Side, url: string | null) =>
  Effect.gen(function*() {
    if (!side) return MISSING
    if ("current" in side) {
      return side.state === "ok" && side.sha256 !== null && side.token !== undefined
        ? { status: "ok", kind: side.kind, sha256: side.sha256, mime: side.mime, size: side.size, asset: side.asset, path: side.path, url: assetUrl(side.asset, side.token) }
        : { status: side.state, error: side.error, kind: side.kind, asset: side.asset, path: side.path }
    }
    if (side.attrs !== undefined || side.kind === "attributes") return { status: "ok", kind: "attributes", attrs: side.attrs }
    if (!side.ref) return { status: "ok", kind: "composite", digest: side.digest }
    const read = yield* evidence.readRef(side.ref, side.sha256)
    return read.status === "ok"
      ? { status: "ok", kind: side.kind, mime: side.mime, sha256: side.sha256, size: side.size, path: side.path, asset: side.asset, url }
      : { status: read.status, error: read.error, kind: side.kind, path: side.path, asset: side.asset, sha256: side.sha256 }
  })

export const compare = (p: Projection, evidence: Evidence["Service"], a: FrozenRef, b: FrozenRef | "current" | null | undefined): Effect.Effect<unknown, ToolError, MediaKinds | ProjectFiles> =>
  Effect.gen(function*() {
    const left = yield* frozenPart(p, a.submission, a.item, a.part)
    const right = b && b !== "current" ? yield* frozenPart(p, b.submission, b.item, b.part) : null
    const target = left.item.target
    // The current side is compared by digest, so its files are hashed now if they never were.
    if (!right) yield* ensureHashed(p, targetAssets(p, target))
    const rows = new Map<string, { a?: Leaf; b?: { readonly label: string; readonly evidence: Side } }>()
    for (const leaf of leaves(p, left.part.evidence, left.part.label)) rows.set(leaf.key, { a: leaf })
    if (right) {
      for (const leaf of leaves(p, right.part.evidence, right.part.label)) rows.set(leaf.key, { ...rows.get(leaf.key), b: leaf })
    } else {
      // The current side resolves the same identity (unit and part) from the working checkout.
      for (const [key, row] of rows) {
        const leaf = row.a!
        if (key === "base") {
          const collection = target.kind === "collection" ? p.collectionsById.get(target.id) : undefined
          const spec = collection ? previewSpec(p, collection) : null
          row.b = { label: "Base", evidence: spec?.base ? currentAsset(p, spec.base) : null }
          continue
        }
        const unitId = leaf.unit ?? (target.kind === "unit" ? target.id : null)
        row.b = { label: leaf.label, evidence: unitId === null ? null : currentLeaf(p, unitId, leaf.unit !== undefined ? leaf.part ?? "" : a.part) }
      }
    }
    const out = []
    for (const [key, row] of rows) {
      const sideA = row.a ? yield* sideView(evidence, row.a.evidence, evidenceUrl(a.submission, a.item, a.part, key)) : MISSING
      const sideB = row.b ? yield* sideView(evidence, row.b.evidence, right && b && b !== "current" ? evidenceUrl(b.submission, b.item, b.part, key) : null) : MISSING
      const bothOk = sideA.status === "ok" && sideB.status === "ok"
      const identical = bothOk && ("attrs" in sideA
        ? digest(sideA.attrs) === digest((sideB as { attrs?: unknown }).attrs)
        : "sha256" in sideA && !!sideA.sha256 && sideA.sha256 === (sideB as { sha256?: unknown }).sha256)
      out.push({ key, label: (row.a ?? row.b)!.label, a: sideA, b: sideB, identical })
    }
    return {
      title: `${left.item.title} · ${left.part.label}`,
      a: { ...a, label: left.part.label },
      b: right ? { ...(b as FrozenRef), label: right.part.label } : "current",
      rows: out,
      identical: out.length > 0 && out.every((row) => row.identical)
    }
  })
