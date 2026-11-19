// Review submissions as lists and as one opened submission.
import * as Effect from "effect/Effect"
import { fail } from "../../kernel/errors.ts"
import { shortRef } from "../../kernel/Ids.ts"
import type { Evidence } from "../Evidence.ts"
import type { FrozenPart, SubmissionItem, SubmissionRecord, Target } from "../model/types.ts"
import { decisionOrder } from "../model/verdicts.ts"
import type { Projection } from "../Projection.ts"
import { reviewRoute } from "../routes.ts"
import { paginate } from "../support.ts"
import { leafView, leaves, publicEvidence, viewOf } from "./evidence.ts"
import { noteView } from "./notes.ts"
import { BUILTIN_PREVIEW, itemState, summaryOf } from "./review.ts"
import { moduleUrl } from "./summaries.ts"

const MAX_PAGE = 200

/**
 * The frozen preview declaration of an item. A project module is offered only at the exact
 * revision that was submitted; otherwise the preview is reported unavailable, never replaced.
 */
const framePreview = (p: Projection, item: SubmissionItem) => {
  const part = item.parts.find((candidate) => candidate.id === "preview")
  if (!part) return null
  const evidence = part.evidence
  const module = evidence.module ?? BUILTIN_PREVIEW
  const base = { module, label: part.label, config: evidence.config ?? {}, roles: evidence.roles ?? ["model"] }
  const submitted = evidence.moduleSha
  if (!submitted) return { ...base, moduleUrl: null, moduleChanged: false, moduleError: null }
  const current = p.browserModules.get(module) ?? null
  if (current === submitted) {
    return { ...base, moduleSha: submitted, moduleUrl: moduleUrl(module, submitted), moduleChanged: false, moduleError: null }
  }
  return {
    ...base,
    moduleSha: submitted,
    moduleUrl: null,
    moduleChanged: true,
    moduleError: current
      ? `Preview module "${module}" changed since this submission (submitted ${submitted.slice(0, 12)}, now ${current.slice(0, 12)}); the submitted revision is not available to render`
      : `Preview module "${module}" (submitted ${submitted.slice(0, 12)}) is not available in this checkout`
  }
}

const itemHeader = (p: Projection, submission: SubmissionRecord, item: SubmissionItem) => {
  const state = itemState(p, submission, item)
  const { unitsById } = p.snapshot
  const target = item.target
  return {
    state,
    view: {
      id: item.id,
      target,
      targetScope: target?.kind === "unit" ? unitsById.get(target.id)?.scope ?? null : null,
      targetType: target?.kind === "unit" ? unitsById.get(target.id)?.type ?? null : null,
      title: item.title,
      text: item.text ?? null,
      // Null for work, which targets no content.
      targetExists: target === null ? null : target.kind === "unit" ? unitsById.has(target.id) : p.collectionsById.has(target.id),
      state: state.summary.state,
      summary: state.summary
    }
  }
}

type ItemView = ReturnType<typeof itemHeader>["view"]

const frame = <I extends ItemView>(submission: SubmissionRecord, items: ReadonlyArray<I>) => ({
  id: submission.id,
  ref: shortRef(submission.id),
  route: reviewRoute(submission.id),
  title: submission.title,
  by: submission.by,
  at: submission.at,
  checkout: submission.checkout,
  supersedes: submission.supersedes ?? null,
  brief: submission.brief ?? null,
  counts: {
    items: items.length,
    waiting: items.filter((item) => item.summary.undecided > 0).length,
    approved: items.filter((item) => item.state === "approved").length,
    changes: items.filter((item) => ["changes", "mixed"].includes(item.state) && item.summary.changes).length,
    rejected: items.filter((item) => item.summary.rejected).length
  },
  items
})

/** A submission with each item's state and counts, without evidence. */
export const submissionView = (p: Projection, submission: SubmissionRecord) =>
  frame(submission, submission.items.map((item) => itemHeader(p, submission, item).view))
export type SubmissionView = ReturnType<typeof submissionView>

const pick = (part: FrozenPart) => ({
  ...(part.role != null ? { role: part.role } : {}),
  ...(part.member != null ? { member: part.member } : {}),
  ...(part.asset != null ? { asset: part.asset } : {}),
  // A capture: who rendered it, and the two labels of a before/after pair.
  ...(part.renderer != null ? { renderer: part.renderer } : {}),
  ...(part.evidence.pair ? { pairLabels: part.evidence.labels ?? ["Before", "After"] } : {})
})

const submissionDetail = (p: Projection, evidence: Evidence["Service"], submission: SubmissionRecord) =>
  Effect.map(
    Effect.forEach(submission.items, (item) =>
      Effect.gen(function*() {
        const { state, view } = itemHeader(p, submission, item)
        const parts = yield* Effect.forEach(state.parts, (part) =>
          Effect.gen(function*() {
            const frozen = item.parts.find((candidate) => candidate.id === part.id)!
            const partLeaves = yield* Effect.forEach(leaves(p, frozen.evidence, frozen.label), (leaf) => leafView(evidence, submission.id, item.id, part.id, leaf))
            return { ...part, ...pick(frozen), evidence: publicEvidence(frozen.evidence), leaves: partLeaves }
          }))
        const views = yield* Effect.forEach(item.views, (frozen) => viewOf(evidence, submission.id, item.id, frozen))
        return { ...view, parts, views, attributes: item.attributes ?? null, kind: item.kind, preview: framePreview(p, item) }
      })),
    (items) => frame(submission, items)
  )

export interface ReviewListInput {
  readonly state?: string | null | undefined
  readonly q?: string | null | undefined
  readonly page?: number | null | undefined
  readonly pageSize?: number | null | undefined
  readonly target?: Target | null | undefined
}

export const reviewList = (p: Projection, input: ReviewListInput) => {
  const { target } = input
  const q = (input.q ?? "").toLowerCase()
  let list = p.records.submission
    .filter((submission) => !target || submission.items.some((item) => item.target?.kind === target.kind && item.target.id === target.id))
    .map((submission) => submissionView(p, submission))
    .sort((a, b) => b.at.localeCompare(a.at))
  if (q) list = list.filter((submission) => `${submission.title} ${submission.ref} ${submission.items.map((item) => item.title).join(" ")}`.toLowerCase().includes(q))
  const filters: Record<string, (submission: SubmissionView) => boolean> = {
    waiting: (submission) => submission.counts.waiting > 0,
    changes: (submission) => submission.counts.changes > 0,
    rejected: (submission) => submission.counts.rejected > 0,
    approved: (submission) => submission.counts.approved === submission.counts.items
  }
  const counts = { all: list.length, ...Object.fromEntries(Object.entries(filters).map(([name, matches]) => [name, list.filter(matches).length])) }
  const wanted = filters[input.state ?? "all"]
  if (wanted) list = list.filter(wanted)
  const page = paginate(list, input.page, input.pageSize, 50, MAX_PAGE)
  return { submissions: page.items, total: list.length, page: page.page, pages: page.pages, pageSize: page.pageSize, counts }
}

/** One submission by id or short reference: items, parts, views, verdict projection, decisions, observations. */
export const reviewGet = (p: Projection, evidence: Evidence["Service"], reference: string) =>
  Effect.gen(function*() {
    const submission = p.records.submission.find((candidate) => candidate.id === reference || shortRef(candidate.id) === reference.toUpperCase())
    if (!submission) return yield* fail("not_found", `submission ${reference} not found`)
    const view = yield* submissionDetail(p, evidence, submission)
    return {
      ...view,
      decisions: p.records.decision.filter((decision) => decision.submission === submission.id).sort(decisionOrder).reverse().map((decision) => summaryOf(p, decision)),
      observations: (p.notesByTarget.get(`submission:${submission.id}`) ?? []).map((note) => noteView(p, note)).sort((a, b) => b.at.localeCompare(a.at)),
      supersededBy: p.records.submission.filter((other) => other.supersedes === submission.id).map((other) => ({ id: other.id, ref: shortRef(other.id) }))
    }
  })
