// Before/after views. A submission view may show its evidence against a "before" side: a project
// file under the asset roots, or an earlier submission's frozen media. Both sides are the same
// kind of media. The before side is frozen like part evidence but is never a reviewable part: it
// only changes how the view is shown.
import * as Effect from "effect/Effect"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { isNonEmpty } from "../../kernel/hash.ts"
import { Evidence } from "../Evidence.ts"
import { MediaKinds } from "../MediaKinds.ts"
import type { FrozenView, LeafEvidence, MediaFacts, ViewBefore } from "../model/types.ts"
import { frozenPart, leaves } from "../queries/evidence.ts"
import { type FreezeEnv, freezeFile } from "./freeze.ts"

export interface BeforeInput {
  readonly path?: string | null | undefined
  readonly submission?: string | null | undefined
  readonly item?: string | null | undefined
  readonly part?: string | null | undefined
  readonly leaf?: string | null | undefined
  readonly label?: string | null | undefined
}

export interface BeforePlan {
  readonly label: string
  readonly afterLabel: string
  readonly file?: { readonly path: string; readonly facts: MediaFacts }
  readonly from?: NonNullable<ViewBefore["from"]>
  readonly evidence?: LeafEvidence
}

const LEAF_KEYS = ["digest", "asset", "path", "kind", "mime", "size", "sha256", "ref"] as const

const label = (value: string | null | undefined, what: string, fallback: string): Effect.Effect<string, ToolError> =>
  value == null ? Effect.succeed(fallback) : isNonEmpty(value) && value.length <= 100 ? Effect.succeed(value.trim()) : fail("invalid", `${what} must be text (at most 100 characters)`)

/** Check one requested before side against the media kind its view shows. Writes nothing. */
export const planBefore = (
  env: FreezeEnv,
  view: { readonly part: string; readonly before: BeforeInput; readonly afterLabel?: string | null | undefined },
  shownKind: string | null
): Effect.Effect<BeforePlan, ToolError, Evidence | MediaKinds> =>
  Effect.gen(function*() {
    const before = view.before
    if ((before.path != null) === (before.submission != null)) return yield* fail("invalid", "view before needs either a path or submission, item and part")
    const labels = { label: yield* label(before.label, "before label", "Before"), afterLabel: yield* label(view.afterLabel, "afterLabel", "After") }
    if (!shownKind) return yield* fail("invalid", `view of ${view.part} shows no single image, video or model to compare with`)
    const mismatch = (kind: string | undefined) => fail("invalid", `before is ${kind} but the view of ${view.part} shows ${shownKind}; compare like with like`)
    if (before.path != null) {
      const path = before.path
      if (!isNonEmpty(path)) return yield* fail("invalid", "before path must be a project file path")
      const kinds = env.projection.plugins.mediaKinds
      // Any file under the asset roots may be a before side; its kind is whatever its bytes are.
      const facts = yield* (yield* MediaKinds).facts({ path, kind: null }, kinds, env.within)
      if (facts.state !== "ok") return yield* fail(facts.state === "forbidden" ? "forbidden" : "invalid", `cannot use ${path} as before: ${facts.error ?? facts.state}`)
      if (facts.kind !== shownKind) return yield* mismatch(facts.kind)
      return { ...labels, file: { path, facts } }
    }
    if (!isNonEmpty(before.submission) || !isNonEmpty(before.item) || !isNonEmpty(before.part)) {
      return yield* fail("invalid", "view before needs submission, item and part (leaf is optional)")
    }
    const earlier = yield* frozenPart(env.projection, before.submission, before.item, before.part)
    const leaf = leaves(env.projection, earlier.part.evidence, earlier.part.label).find((candidate) => candidate.key === (before.leaf ?? ""))?.evidence
    if (!leaf?.ref) return yield* fail("invalid", `${before.part}${before.leaf ? ` leaf ${before.leaf}` : ""} in ${before.submission} has no single image, video or model`)
    const read = yield* (yield* Evidence).readRef(leaf.ref, leaf.sha256)
    if (read.status !== "ok") return yield* fail("invalid", `earlier evidence is not readable: ${read.error}`)
    if (leaf.kind !== shownKind) return yield* mismatch(leaf.kind)
    const source = leaf as unknown as Record<string, unknown>
    return {
      ...labels,
      from: { submission: before.submission, item: before.item, part: before.part, ...(before.leaf ? { leaf: before.leaf } : {}) },
      evidence: Object.fromEntries(LEAF_KEYS.filter((key) => source[key] != null).map((key) => [key, source[key]])) as unknown as LeafEvidence
    }
  })

/** Attach planned before sides to built views (same order as requested). */
export const freezeBefores = (env: FreezeEnv, views: ReadonlyArray<FrozenView>, plans: ReadonlyArray<BeforePlan | null> | undefined): Effect.Effect<Array<FrozenView>, ToolError, Evidence | MediaKinds> =>
  Effect.forEach(views, (view, index) =>
    Effect.gen(function*() {
      const plan = plans?.[index]
      if (!plan) return view
      const evidence = plan.file ? yield* freezeFile(env, plan.file.path, plan.file.path, plan.file.facts.kind ?? null, plan.file.facts) : plan.evidence!
      return { ...view, before: { label: plan.label, evidence, ...(plan.from ? { from: plan.from } : {}) }, afterLabel: plan.afterLabel }
    }))
