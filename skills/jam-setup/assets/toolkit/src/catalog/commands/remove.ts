// Retention: removing reviews a project no longer keeps. Records stay immutable (a submission or
// verdict is never edited), but they can be retired. What is removed is always consistent: a
// submission goes with its verdict events and the notes on it, and frozen evidence goes only when
// no record that stays still points at it. Archiving decisions first is the project's policy; the
// dry run lists exactly what would go so nothing is removed unarchived.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { optional, Text, write } from "../action.ts"
import { fail } from "../../kernel/errors.ts"
import { digest } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import type { AnyRecord, NoteRecord, SubmissionRecord, VerdictRecord } from "../model/types.ts"
import { EVIDENCE_PATH } from "../records/layout.ts"
import { Records } from "../Records.ts"

const RemoveInput = Schema.Struct({
  submissions: Schema.NonEmptyArray(Schema.String.check(Schema.isPattern(/^sub_[a-z0-9]+$/u))).annotate({ description: "Submission ids to remove" }),
  reason: Text.annotate({ description: "Why these reviews are removed; returned with the result for the project's own records" }),
  dryRun: optional(Schema.Boolean).annotate({ description: "List exactly what would be removed, with its plan fingerprint, and change nothing" }),
  expectedPlan: optional(Text).annotate({
    description: "The plan fingerprint a dry run returned. Removal is refused when anything it covers changed since (a new verdict, a note, an edit), so what was archived is what goes."
  })
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
  "Remove submissions with their verdict events and the notes on them, and delete frozen evidence no remaining record uses. dryRun lists what would go.",
  RemoveInput,
  "reviews",
  (input, env) =>
    Effect.gen(function*() {
      const p = env.projection
      const named = new Set(input.submissions)
      const submissions = p.records.submission.filter((submission) => named.has(submission.id))
      const missing = [...named].filter((id) => !submissions.some((submission) => submission.id === id))
      if (missing.length > 0) return yield* fail("not_found", `no submission ${missing.join(", ")}`, { fix: "list submissions with reviews.list" })
      // A submission that stays may depend on one being removed; removing it would break the one that stays.
      const blocked = p.records.submission
        .filter((kept) => !named.has(kept.id))
        .flatMap((kept) => dependsOn(kept).filter((id) => named.has(id)).map((id) => `${kept.id} depends on ${id}`))
      if (blocked.length > 0) {
        return yield* fail("conflict", `submissions that stay depend on ones being removed: ${blocked.join("; ")}`, { fix: "remove those submissions too, or keep the ones they depend on" })
      }
      const verdicts: ReadonlyArray<VerdictRecord> = p.records.verdict.filter((verdict) => named.has(verdict.submission))
      const notes: ReadonlyArray<NoteRecord> = p.records.note.filter((note) => note.target.kind === "submission" && named.has(note.target.id))
      const removedRecords: ReadonlyArray<AnyRecord> = [...submissions, ...verdicts, ...notes]
      const keptEvidence = new Set<string>()
      for (const kind of ["submission", "verdict", "note", "collection", "label", "categories"] as const) {
        for (const record of p.records[kind] as ReadonlyArray<AnyRecord>) if (!removedRecords.includes(record)) storedEvidence(record, keptEvidence)
      }
      const evidence = [...storedEvidence(submissions, new Set())].filter((path) => !keptEvidence.has(path)).sort()
      // The fingerprint covers every record that would go, as it is now (notes carry their revision).
      const fingerprint = digest({ submissions, verdicts, notes, evidence })
      if (input.expectedPlan != null && input.dryRun !== true && input.expectedPlan !== fingerprint) {
        return yield* fail("conflict", "what these submissions hold changed since the plan was made (a verdict, note or edit was added)", {
          fix: "run the dry run again, archive what it lists, and remove with its new plan",
          details: { plan: fingerprint }
        })
      }
      const plan = {
        plan: fingerprint,
        reason: input.reason,
        submissions: submissions.map((submission) => ({ id: submission.id, title: submission.title, items: submission.items.length })),
        verdicts: verdicts.map((verdict) => verdict.id),
        notes: notes.map((note) => note.id),
        evidence
      }
      if (input.dryRun === true) return { removed: false, ...plan }
      const records = yield* Records
      yield* records.apply([
        ...verdicts.map((record) => ({ type: "remove" as const, kind: "verdict" as const, record })),
        ...notes.map((record) => ({ type: "remove" as const, kind: "note" as const, record })),
        ...submissions.map((record) => ({ type: "remove" as const, kind: "submission" as const, record }))
      ])
      // Records first: a failure part-way leaves unreferenced evidence behind, never a record without its evidence.
      const files = yield* ProjectFiles
      for (const path of evidence) yield* files.remove(path, { noFollow: true })
      // The removed records themselves, so nothing is lost even when a caller archived too little.
      return { removed: true, ...plan, records: { submissions, verdicts, notes } }
    })
)
