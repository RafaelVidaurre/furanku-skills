// Recording decisions: `whole` covers every reviewable part of an item with one verdict plus
// explicit exceptions, `parts` covers only the parts it names. A recorded decision can be edited
// or deleted; an agent changes only decisions it recorded itself, never a person's.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { type ActionServices, ExpectedRevision, optional, priorRequest, refOf, requestFields, Text, write, type WriteEnv } from "../action.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { isNonEmpty } from "../../kernel/hash.ts"
import { ensureHashed, targetAssets } from "../hashes.ts"
import { Ids, nowIso, shortRef } from "../../kernel/Ids.ts"
import type { Actor, SubmissionItem, SubmissionRecord, DecisionRecord } from "../model/types.ts"
import { decisionVerdicts } from "../model/verdicts.ts"
import { type Projection, targetKey } from "../Projection.ts"
import { findItem } from "../queries/evidence.ts"
import { currentDigest, decisionSummary, itemState, partsOf, summaryOf } from "../queries/review.ts"
import { Records } from "../Records.ts"
import { reviewRoute } from "../routes.ts"
import { DecisionSummary, Linked, Rollup, Route, Written } from "../results.ts"
import { PART_COMMENT_MAX } from "../records/schemas.ts"
import { targetExists } from "./notes.ts"
import { submit } from "./submit.ts"

const VERDICT_WORDS = "approved, changes or rejected (or the project's own review.verdicts)"
const Decision = {
  whole: optional(Schema.String).annotate({ description: `One verdict for every reviewable part of the item: ${VERDICT_WORDS}`, examples: ["approved"] }),
  exceptions: optional(Schema.Record(Schema.String, Schema.String)).annotate({ description: `With whole: part id → a different verdict (${VERDICT_WORDS})` }),
  verdicts: optional(Schema.Record(Schema.String, Schema.String)).annotate({ description: `Instead of whole: part id → verdict (${VERDICT_WORDS}) for the named parts only` }),
  comment: optional(Schema.String).annotate({ description: "About the whole decision" }),
  partComments: optional(Schema.Record(Schema.String, Schema.String)).annotate({ description: "A comment per part this decision decides" }),
  relay: optional(Schema.Struct({
    by: Text.annotate({ description: "The person whose decision this is" }),
    channel: Text.annotate({ description: "Where they gave it: chat, call, a notification answer" }),
    words: Text.annotate({ description: "What they said, verbatim" })
  })).annotate({ description: "An agent recording a decision a person made outside the catalog. The agent declares itself as the actor; the decision covers only the parts the person's words cover." })
}
export const DecideInput = Schema.Struct({ submission: Text, item: Text, ...Decision })
export const DecideCurrentInput = Schema.Struct({ target: refOf(["unit", "collection"]), ...Decision })
const DecisionId = Text.annotate({ description: "The decision's id (dc_…), as review.get lists it under decisions" })
export const DecisionEditInput = Schema.Struct({ id: DecisionId, ...Decision, expectedRevision: ExpectedRevision })
export const DecisionDeleteInput = Schema.Struct({ id: DecisionId, expectedRevision: ExpectedRevision })
const Decided = {
  decision: DecisionSummary,
  item: Schema.optional(Rollup).annotate({ description: "The item's state after this decision (absent when a request is repeated)" }),
  ...Route
}
export const DecideOutput = Linked({ ...Written(Decided).fields })
export const DecideCurrentOutput = Linked({
  ...Written(Decided).fields,
  submission: Schema.Struct({ id: Schema.String, ref: Schema.String }),
  createdSubmission: Schema.Boolean
})
export const DecisionDeleteOutput = Linked({
  ...Written({ deleted: Schema.String, item: Rollup.annotate({ description: "The item's state without this decision" }), ...Route }).fields
})
type DecisionInput = Pick<typeof DecideInput.Type, keyof typeof Decision>
type Covered = Pick<DecisionRecord, "covers" | "verdict" | "exceptions" | "verdicts" | "partComments">

/** Check a decision against an item's part ids and shape what the record will hold. */
const decision = (p: Projection, partIds: ReadonlyArray<string>, input: DecisionInput): Effect.Effect<Covered, ToolError> =>
  Effect.gen(function*() {
    const allowed = p.policy.verdicts
    const known = (entries: Readonly<Record<string, string>>, what: string): Effect.Effect<void, ToolError> =>
      Effect.gen(function*() {
        for (const [part, verdict] of Object.entries(entries)) {
          if (!partIds.includes(part)) return yield* fail("invalid", `part ${part} is not in this item`)
          if (!allowed.includes(verdict)) return yield* fail("invalid", `invalid ${what} for ${part}`)
        }
      })
    let covered: Covered
    if (input.whole != null) {
      if (input.verdicts != null) return yield* fail("invalid", "give either whole (+ exceptions) or verdicts, not both")
      if (!allowed.includes(input.whole)) return yield* fail("invalid", `verdict must be one of ${allowed.join(", ")}`)
      const exceptions = input.exceptions ?? {}
      yield* known(exceptions, "verdict")
      covered = { covers: { kind: "whole", parts: partIds }, verdict: input.whole, exceptions: Object.fromEntries(Object.entries(exceptions).filter(([, verdict]) => verdict !== input.whole)) }
    } else {
      if (input.exceptions != null) return yield* fail("invalid", "exceptions need a whole verdict")
      if (!input.verdicts || Object.keys(input.verdicts).length === 0) return yield* fail("invalid", "give whole (+ exceptions) or verdicts for specific parts")
      yield* known(input.verdicts, "verdict")
      covered = { covers: { kind: "parts", parts: Object.keys(input.verdicts) }, verdicts: { ...input.verdicts } }
    }
    // Each part comment addresses one part this decision gives a verdict; blank comments are dropped.
    const decided = decisionVerdicts(covered as DecisionRecord)
    const comments: Record<string, string> = {}
    for (const [part, text] of Object.entries(input.partComments ?? {})) {
      if (!partIds.includes(part)) return yield* fail("invalid", `part ${part} is not in this item`)
      if (text.length > PART_COMMENT_MAX) return yield* fail("invalid", `comment for ${part} must be text of at most ${PART_COMMENT_MAX} characters`)
      if (!isNonEmpty(text)) continue
      if (!decided[part]) return yield* fail("invalid", `comment for ${part} needs a verdict for that part`)
      comments[part] = text.trim()
    }
    return Object.keys(comments).length > 0 ? { ...covered, partComments: comments } : covered
  })

const reviewableIds = (p: Projection, item: SubmissionItem): Array<string> => item.parts.filter(p.policy.reviewable).map((part) => part.id)

/** Record a decision on an item. The caller holds the reviews lock. */
const decideOn = (env: WriteEnv, submission: SubmissionRecord, item: SubmissionItem, input: DecisionInput): Effect.Effect<Record<string, unknown>, ToolError, ActionServices> =>
  Effect.gen(function*() {
    const p = env.projection
    if (input.relay != null && env.actor.kind !== "agent") {
      return yield* fail("invalid", "relay is for an agent recording a person's decision; a person deciding for themselves leaves it out", { fix: "declare --actor-kind agent with relay, or drop relay" })
    }
    const covered = yield* decision(p, reviewableIds(p, item), input)
    const record: DecisionRecord = {
      id: yield* (yield* Ids).next("dc"),
      submission: submission.id,
      item: item.id,
      by: env.actor,
      at: yield* nowIso,
      ...(isNonEmpty(input.comment) ? { comment: input.comment.trim() } : {}),
      ...(input.relay == null ? {} : { relay: { by: input.relay.by.trim(), channel: input.relay.channel.trim(), words: input.relay.words.trim() } }),
      ...requestFields(env),
      ...covered
    }
    yield* (yield* Records).apply([{ type: "create", kind: "decision", record }])
    // The item's new state is the recorded decisions plus this one; no second read is needed.
    return { decision: decisionSummary(record, submission), item: itemState(p, submission, item, [...(p.decisionsByItem.get(item.id) ?? []), record]).summary, route: reviewRoute(submission.id, item.id) }
  })

const getDecision = (p: Projection, id: string): Effect.Effect<DecisionRecord, ToolError> => {
  const found = p.records.decision.find((candidate) => candidate.id === id)
  return found ? Effect.succeed(found) : fail("not_found", `decision ${id} not found`, { fix: "list an item's decisions with review.get" })
}

/** A person may change any decision; an agent only one it recorded itself. */
const mayChange = (actor: Actor, decision: DecisionRecord): Effect.Effect<void, ToolError> =>
  actor.kind === "human" || (decision.by.kind === "agent" && decision.by.name === actor.name)
    ? Effect.void
    : fail("forbidden", `decision ${decision.id} was recorded by ${decision.by.name}; an agent changes only decisions it recorded`, {
      fix: "the person changes it in the catalog, or relay what they said as a new decision with review.decide"
    })

/** The decisions an item holds once `id` is replaced by `next` (or removed when next is null). */
const without = (p: Projection, decision: DecisionRecord, next: DecisionRecord | null): Array<DecisionRecord> =>
  (p.decisionsByItem.get(decision.item) ?? []).flatMap((d) => (d.id === decision.id ? (next ? [next] : []) : [d]))

export const decideActions = [
  write(
    "review.decide",
    "Record a decision on a submission item: whole (+exceptions) or specific parts, with an optional comment and optional comments per decided part",
    DecideInput,
    DecideOutput,
    "reviews",
    (input, env) =>
      Effect.gen(function*() {
        const prior = yield* priorRequest(env.projection, "decision", env.requestId, env.requestBinding)
        if (prior) return { decision: summaryOf(env.projection, prior), replayed: true, route: reviewRoute(prior.submission, prior.item) }
        const { item, submission } = yield* findItem(env.projection, input.submission, input.item)
        return yield* decideOn(env, submission, item, input)
      })
  ),
  write(
    "review.decision.edit",
    "Change a recorded decision: its verdicts (whole + exceptions, or specific parts), comment and part comments replace what it held; it keeps its place in the order",
    DecisionEditInput,
    DecideOutput,
    "reviews",
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        const current = yield* getDecision(p, input.id)
        if (yield* priorRequest(p, "decision", env.requestId, env.requestBinding, "lastRequestId")) return { decision: summaryOf(p, current), replayed: true, route: reviewRoute(current.submission, current.item) }
        yield* mayChange(env.actor, current)
        if (input.relay != null && env.actor.kind !== "agent") return yield* fail("invalid", "relay is for an agent recording a person's decision; a person editing leaves it out")
        const { item, submission } = yield* findItem(p, current.submission, current.item)
        const covered = yield* decision(p, reviewableIds(p, item), input)
        // Everything the decision says is replaced; who recorded it, when, and why it exists stay.
        const { verdict: _v, exceptions: _e, verdicts: _vs, partComments: _pc, comment: _c, relay: _r, lastRequestId: _l, lastRequestBinding: _lb, ...kept } = current
        const relay = input.relay != null
          ? { relay: { by: input.relay.by.trim(), channel: input.relay.channel.trim(), words: input.relay.words.trim() } }
          : current.relay && env.actor.kind === "agent" ? { relay: current.relay } : {}
        const next: DecisionRecord = {
          ...kept,
          ...covered,
          ...(isNonEmpty(input.comment) ? { comment: input.comment.trim() } : {}),
          ...relay,
          editedAt: yield* nowIso,
          editedBy: env.actor,
          ...(env.requestId !== null && env.requestBinding ? { lastRequestId: env.requestId, lastRequestBinding: env.requestBinding } : {})
        }
        const [updated] = yield* (yield* Records).apply([{ type: "update", kind: "decision", record: next, expectedRevision: input.expectedRevision }])
        const saved = updated as DecisionRecord
        return { decision: decisionSummary(saved, submission), item: itemState(p, submission, item, without(p, current, saved)).summary, route: reviewRoute(submission.id, item.id) }
      })
  ),
  write(
    "review.decision.delete",
    "Delete a recorded decision; the item's parts fall back to the decisions that remain",
    DecisionDeleteInput,
    DecisionDeleteOutput,
    "reviews",
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        const current = yield* getDecision(p, input.id)
        yield* mayChange(env.actor, current)
        const { item, submission } = yield* findItem(p, current.submission, current.item)
        yield* (yield* Records).apply([{ type: "remove", kind: "decision", record: current, expectedRevision: input.expectedRevision }])
        return { deleted: current.id, item: itemState(p, submission, item, without(p, current, null)).summary, route: reviewRoute(submission.id, item.id) }
      })
  ),
  // Catalog "Review": record on a still-waiting item whose frozen evidence equals current
  // content; otherwise submit the current content as a new one-item submission and record on
  // that. Revising an earlier decision on a decided item goes through review.decide.
  write(
    "review.decideCurrent",
    "Review current content: decide on a matching waiting item or submit current content and decide (same comment and part comments as review.decide)",
    DecideCurrentInput,
    DecideCurrentOutput,
    "reviews",
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        const target = input.target
        if (!targetExists(p, target)) return yield* fail("not_found", "review target not found")
        const partIds = partsOf(p, target).filter(p.policy.reviewable).map((part) => part.id)
        // Checked in full before anything is submitted or frozen.
        yield* decision(p, partIds, input)
        const prior = yield* priorRequest(p, "decision", env.requestId, env.requestBinding)
        if (prior) return { decision: summaryOf(p, prior), replayed: true, route: reviewRoute(prior.submission, prior.item), submission: { id: prior.submission, ref: shortRef(prior.submission) }, createdSubmission: false }
        // "Equals current content" is a comparison of digests: hash what this target shows.
        yield* ensureHashed(p, targetAssets(p, target))
        const current = [...partIds].sort().join("\n")
        const waiting = [...(p.itemsByTarget.get(targetKey(target)) ?? [])]
          .sort((a, b) => b.submission.at.localeCompare(a.submission.at))
          .find(({ item, submission }) => {
            const frozen = item.parts.filter(p.policy.reviewable)
            return itemState(p, submission, item).summary.undecided > 0 && frozen.map((part) => part.id).sort().join("\n") === current &&
              frozen.every((part) => part.evidence.digest === currentDigest(p, target, part.id))
          })
        let submission = waiting?.submission
        let created = false
        if (!submission) {
          // A retry after the submission was recorded but before the decision was: use that submission.
          const submissionRequest = env.requestId === null ? null : `${env.requestId}:submission`
          submission = yield* priorRequest(p, "submission", submissionRequest, env.requestBinding)
          if (!submission) {
            submission = yield* submit({ items: [{ target }] }, env, submissionRequest)
            created = true
          }
        }
        const item = waiting?.item ?? submission.items[0]!
        const result = yield* decideOn(env, submission, item, input)
        return { ...result, submission: { id: submission.id, ref: shortRef(submission.id) }, createdSubmission: created }
      })
  )
]
