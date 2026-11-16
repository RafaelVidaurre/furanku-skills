// Recording verdicts. A verdict event is immutable: `whole` covers every reviewable part of an
// item with one verdict plus explicit exceptions, `parts` covers only the parts it names.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { type ActionServices, optional, priorRequest, requestFields, Text, write, type WriteEnv } from "../action.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { isNonEmpty } from "../../kernel/hash.ts"
import { ensureHashed, targetAssets } from "../hashes.ts"
import { Ids, nowIso, shortRef } from "../../kernel/Ids.ts"
import type { SubmissionItem, SubmissionRecord, VerdictRecord } from "../model/types.ts"
import { eventVerdicts } from "../model/verdicts.ts"
import { type Projection, targetKey } from "../Projection.ts"
import { findItem } from "../queries/evidence.ts"
import { currentDigest, eventSummary, itemState, partsOf, summaryOf } from "../queries/review.ts"
import { Records } from "../Records.ts"
import { reviewRoute } from "../routes.ts"
import { PART_NOTE_MAX } from "../records/schemas.ts"
import { targetExists } from "./notes.ts"
import { submit } from "./submit.ts"

const VERDICT_WORDS = "approved, changes or rejected (or the project's own review.verdicts)"
const Decision = {
  whole: optional(Schema.String).annotate({ description: `One verdict for every reviewable part of the item: ${VERDICT_WORDS}`, examples: ["approved"] }),
  exceptions: optional(Schema.Record(Schema.String, Schema.String)).annotate({ description: `With whole: part id → a different verdict (${VERDICT_WORDS})` }),
  verdicts: optional(Schema.Record(Schema.String, Schema.String)).annotate({ description: `Instead of whole: part id → verdict (${VERDICT_WORDS}) for the named parts only` }),
  comment: optional(Schema.String).annotate({ description: "About the whole decision" }),
  partNotes: optional(Schema.Record(Schema.String, Schema.String)).annotate({ description: "A note per part this event decides" }),
  relay: optional(Schema.Struct({
    by: Text.annotate({ description: "The person whose decision this is" }),
    channel: Text.annotate({ description: "Where they gave it: chat, call, a notification answer" }),
    words: Text.annotate({ description: "What they said, verbatim" })
  })).annotate({ description: "An agent recording a decision a person made outside the catalog. The agent declares itself as the actor; the decision covers only the parts the person's words cover." })
}
const DecideInput = Schema.Struct({ submission: Text, item: Text, ...Decision })
const DecideCurrentInput = Schema.Struct({ target: Schema.Struct({ kind: Schema.String, id: Schema.String }), ...Decision })
type DecisionInput = Pick<typeof DecideInput.Type, keyof typeof Decision>
type Scope = Pick<VerdictRecord, "scope" | "verdict" | "exceptions" | "verdicts" | "partNotes">

/** Check a decision against an item's part ids and shape what the event will record. */
const decision = (p: Projection, partIds: ReadonlyArray<string>, input: DecisionInput): Effect.Effect<Scope, ToolError> =>
  Effect.gen(function*() {
    const allowed = p.policy.verdicts
    const known = (entries: Readonly<Record<string, string>>, what: string): Effect.Effect<void, ToolError> =>
      Effect.gen(function*() {
        for (const [part, verdict] of Object.entries(entries)) {
          if (!partIds.includes(part)) return yield* fail("invalid", `part ${part} is not in this item`)
          if (!allowed.includes(verdict)) return yield* fail("invalid", `invalid ${what} for ${part}`)
        }
      })
    let scope: Scope
    if (input.whole != null) {
      if (input.verdicts != null) return yield* fail("invalid", "give either whole (+ exceptions) or verdicts, not both")
      if (!allowed.includes(input.whole)) return yield* fail("invalid", `verdict must be one of ${allowed.join(", ")}`)
      const exceptions = input.exceptions ?? {}
      yield* known(exceptions, "verdict")
      scope = { scope: { kind: "whole", parts: partIds }, verdict: input.whole, exceptions: Object.fromEntries(Object.entries(exceptions).filter(([, verdict]) => verdict !== input.whole)) }
    } else {
      if (input.exceptions != null) return yield* fail("invalid", "exceptions need a whole verdict")
      if (!input.verdicts || Object.keys(input.verdicts).length === 0) return yield* fail("invalid", "give whole (+ exceptions) or verdicts for specific parts")
      yield* known(input.verdicts, "verdict")
      scope = { scope: { kind: "parts", parts: Object.keys(input.verdicts) }, verdicts: { ...input.verdicts } }
    }
    // Each part note addresses one part this event gives a verdict; blank notes are dropped.
    const decided = eventVerdicts(scope as VerdictRecord)
    const notes: Record<string, string> = {}
    for (const [part, text] of Object.entries(input.partNotes ?? {})) {
      if (!partIds.includes(part)) return yield* fail("invalid", `part ${part} is not in this item`)
      if (text.length > PART_NOTE_MAX) return yield* fail("invalid", `note for ${part} must be text of at most ${PART_NOTE_MAX} characters`)
      if (!isNonEmpty(text)) continue
      if (!decided[part]) return yield* fail("invalid", `note for ${part} needs a verdict for that part`)
      notes[part] = text.trim()
    }
    return Object.keys(notes).length > 0 ? { ...scope, partNotes: notes } : scope
  })

const reviewableIds = (p: Projection, item: SubmissionItem): Array<string> => item.parts.filter(p.policy.reviewable).map((part) => part.id)

/** Record a verdict event on an item. The caller holds the reviews lock. */
const decideOn = (env: WriteEnv, submission: SubmissionRecord, item: SubmissionItem, input: DecisionInput): Effect.Effect<Record<string, unknown>, ToolError, ActionServices> =>
  Effect.gen(function*() {
    const p = env.projection
    if (input.relay != null && env.actor.kind !== "agent") {
      return yield* fail("invalid", "relay is for an agent recording a person's decision; a person deciding for themselves leaves it out", { fix: "declare --actor-kind agent with relay, or drop relay" })
    }
    const scope = yield* decision(p, reviewableIds(p, item), input)
    const event: VerdictRecord = {
      id: yield* (yield* Ids).next("vd"),
      submission: submission.id,
      item: item.id,
      by: env.actor,
      at: yield* nowIso,
      ...(isNonEmpty(input.comment) ? { comment: input.comment.trim() } : {}),
      ...(input.relay == null ? {} : { relay: { by: input.relay.by.trim(), channel: input.relay.channel.trim(), words: input.relay.words.trim() } }),
      ...requestFields(env),
      ...scope
    }
    yield* (yield* Records).apply([{ type: "create", kind: "verdict", record: event }])
    // The item's new state is the recorded events plus this one; no second read is needed.
    return { event: eventSummary(event, submission), item: itemState(p, submission, item, [...(p.eventsByItem.get(item.id) ?? []), event]).summary, route: reviewRoute(submission.id, item.id) }
  })

export const decideActions = [
  write(
    "review.decide",
    "Record a verdict event on a submission item: whole (+exceptions) or specific parts, with an optional comment and optional notes per decided part",
    DecideInput,
    "reviews",
    (input, env) =>
      Effect.gen(function*() {
        const prior = yield* priorRequest(env.projection, "verdict", env.requestId, env.requestBinding)
        if (prior) return { event: summaryOf(env.projection, prior), replayed: true, route: reviewRoute(prior.submission, prior.item) }
        const { item, submission } = yield* findItem(env.projection, input.submission, input.item)
        return yield* decideOn(env, submission, item, input)
      })
  ),
  // Catalog "Review": record on a still-waiting item whose frozen evidence equals current
  // content; otherwise submit the current content as a new one-item submission and record on
  // that. Revising an earlier decision on a decided item goes through review.decide.
  write(
    "review.decideCurrent",
    "Review current content: decide on a matching waiting item or submit current content and decide (same comment and part notes as review.decide)",
    DecideCurrentInput,
    "reviews",
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        const kind = input.target.kind
        if ((kind !== "unit" && kind !== "collection") || !targetExists(p, input.target)) return yield* fail("not_found", "review target not found")
        const target = { kind, id: input.target.id } as const
        const partIds = partsOf(p, target).filter(p.policy.reviewable).map((part) => part.id)
        // Checked in full before anything is submitted or frozen.
        yield* decision(p, partIds, input)
        const prior = yield* priorRequest(p, "verdict", env.requestId, env.requestBinding)
        if (prior) return { event: summaryOf(p, prior), replayed: true, route: reviewRoute(prior.submission, prior.item), submission: { id: prior.submission, ref: shortRef(prior.submission) }, createdSubmission: false }
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
          // A retry after the submission was recorded but before the verdict was: use that submission.
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
