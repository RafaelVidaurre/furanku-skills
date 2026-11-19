// Retention: removing reviews a project no longer keeps. Records stay immutable (a submission or
// decision is never edited), but they can be retired. What is removed is always consistent: a
// submission goes with its decisions and the notes on it, and frozen evidence goes only when no
// record that stays still points at it. Archiving reviews first is the project's policy; the dry
// run lists exactly what would go so nothing is removed unarchived.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { optional, Text, write } from "../action.ts"
import { fail } from "../../kernel/errors.ts"
import { digest } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import type { AnyRecord, DecisionRecord, NoteRecord, SubmissionRecord } from "../model/types.ts"
import { EVIDENCE_PATH } from "../records/layout.ts"
import { Records } from "../Records.ts"
import { DecisionRecord as DecisionRecordSchema, NoteRecord as NoteRecordSchema } from "../records/schemas.ts"
import { Open, OpenRecord, Written } from "../results.ts"

export const RemoveInput = Schema.Struct({
  submissions: Schema.NonEmptyArray(Schema.String.check(Schema.isPattern(/^sub_[a-z0-9]+$/u))).annotate({ description: "Submission ids to remove" }),
  reason: Text.annotate({ description: "Why these reviews are removed; returned with the result for the project's own records" }),
  dryRun: optional(Schema.Boolean).annotate({ description: "List exactly what would be removed, with its plan fingerprint, and change nothing" }),
  expectedPlan: optional(Text).annotate({
    description: "The plan fingerprint a dry run returned. Removal is refused when anything it covers changed since (a new decision, a note, an edit), so what was archived is what goes."
  })
})

export const RemoveOutput = Written({
  removed: Schema.Boolean,
  plan: Schema.String,
  reason: Schema.String,
  submissions: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String, items: Schema.Number })),
  decisions: Schema.Array(Schema.String),
  notes: Schema.Array(Schema.String),
  evidence: Schema.Array(Schema.String),
  records: Schema.optional(Schema.Struct({
    submissions: Schema.Array(Open).annotate({ description: "Submission records (catalog-submission.schema.json)" }),
    decisions: Schema.Array(OpenRecord(DecisionRecordSchema.fields)),
    notes: Schema.Array(OpenRecord(NoteRecordSchema.fields))
  })).annotate({ description: "The removed records in full (absent in a dry run)" })
})

/** Every evidence-store path a record points at, wherever in the record it sits. */
const storedEvidence = (record: unknown, into: Set<string>): Set<string> => {
  if (typeof record === "string") {
    if (EVIDENCE_PATH.test(record)) into.add(record)
  } else if (Array.isArray(record)) {
    for (const value of record) storedEvidence(value, into)
  } else if (record !== null && typeof record === "object") {
    for (const value of Object.values(record)) storedEvidence(value, into)
  }
  return into
}

/** Submissions a kept submission depends on: the one it supersedes, and earlier frozen sides of its views. */
const dependsOn = (submission: SubmissionRecord): ReadonlyArray<string> => {
  const found = new Set<string>()
  if (submission.supersedes) found.add(submission.supersedes)
  for (const item of submission.items) {
    for (const view of item.views) {
      const from = view.before?.from?.submission
      if (typeof from === "string") found.add(from)
    }
  }
  found.delete(submission.id)
  return [...found]
}

export const removeAction = write(
  "review.remove",
  "Remove submissions with their decisions and the notes on them, and delete frozen evidence no remaining record uses. dryRun lists what would go.",
  RemoveInput,
  RemoveOutput,
  "reviews",
  (input, env) =>
    Effect.gen(function*() {
      const p = env.projection
      const named = new Set(input.submissions)
      const submissions = p.records.submission.filter((submission) => named.has(submission.id))
      const missing = [...named].filter((id) => !submissions.some((submission) => submission.id === id))
      if (missing.length > 0) return yield* fail("not_found", `no submission ${missing.join(", ")}`, { fix: "list submissions with review.list" })
      // A submission that stays may depend on one being removed; removing it would break the one that stays.
      const blocked = p.records.submission
        .filter((kept) => !named.has(kept.id))
        .flatMap((kept) => dependsOn(kept).filter((id) => named.has(id)).map((id) => `${kept.id} depends on ${id}`))
      if (blocked.length > 0) {
        return yield* fail("conflict", `submissions that stay depend on ones being removed: ${blocked.join("; ")}`, { fix: "remove those submissions too, or keep the ones they depend on" })
      }
      const decisions: ReadonlyArray<DecisionRecord> = p.records.decision.filter((decision) => named.has(decision.submission))
      const notes: ReadonlyArray<NoteRecord> = p.records.note.filter((note) => note.target.kind === "submission" && named.has(note.target.id))
      const removedRecords: ReadonlyArray<AnyRecord> = [...submissions, ...decisions, ...notes]
      const keptEvidence = new Set<string>()
      for (const kind of ["submission", "decision", "note", "collection", "organization", "categories"] as const) {
        for (const record of p.records[kind] as ReadonlyArray<AnyRecord>) if (!removedRecords.includes(record)) storedEvidence(record, keptEvidence)
      }
      const evidence = [...storedEvidence(submissions, new Set())].filter((path) => !keptEvidence.has(path)).sort()
      // The fingerprint covers every record that would go, as it is now (notes carry their revision).
      const fingerprint = digest({ submissions, decisions, notes, evidence })
      if (input.expectedPlan != null && input.dryRun !== true && input.expectedPlan !== fingerprint) {
        return yield* fail("conflict", "what these submissions hold changed since the plan was made (a decision, note or edit was added)", {
          fix: "run the dry run again, archive what it lists, and remove with its new plan",
          details: { plan: fingerprint }
        })
      }
      const plan = {
        plan: fingerprint,
        reason: input.reason,
        submissions: submissions.map((submission) => ({ id: submission.id, title: submission.title, items: submission.items.length })),
        decisions: decisions.map((decision) => decision.id),
        notes: notes.map((note) => note.id),
        evidence
      }
      if (input.dryRun === true) return { removed: false, ...plan }
      const records = yield* Records
      yield* records.apply([
        ...decisions.map((record) => ({ type: "remove" as const, kind: "decision" as const, record })),
        ...notes.map((record) => ({ type: "remove" as const, kind: "note" as const, record })),
        ...submissions.map((record) => ({ type: "remove" as const, kind: "submission" as const, record }))
      ])
      // Records first: a failure part-way leaves unreferenced evidence behind, never a record without its evidence.
      const files = yield* ProjectFiles
      for (const path of evidence) yield* files.remove(path, { noFollow: true })
      // The removed records themselves, so nothing is lost even when a caller archived too little.
      return { removed: true, ...plan, records: { submissions, decisions, notes } }
    })
)
