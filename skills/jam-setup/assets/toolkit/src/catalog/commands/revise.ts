// Correcting a submission after it was made: its words and its framing, never its frozen
// evidence (different files are a new submission that supersedes this one). A correction is
// allowed only while nobody has decided on what it changes, so a verdict always answers what the
// person saw. Withdrawing takes a submission out of everyone's queue and keeps it readable.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ExpectedRevision, optional, priorRequest, Text, write } from "../action.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { isNonEmpty } from "../../kernel/hash.ts"
import { nowIso } from "../../kernel/Ids.ts"
import type { Actor, FrozenView, SubmissionItem, SubmissionRecord } from "../model/types.ts"
import type { Projection } from "../Projection.ts"
import { submissionView } from "../queries/reviews.ts"
import { Records } from "../Records.ts"
import { SUBMISSION_TEXT, validCamera, validViewState } from "../records/schemas.ts"
import { Linked, SubmissionView, Written } from "../results.ts"

const CLEAR = "Send \"\" to clear it"
const Vec3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])
const ViewEdit = Schema.Struct({
  id: Text.annotate({ description: "A view id of the item (vw_…)" }),
  caption: optional(Schema.String),
  camera: optional(Schema.Struct({ position: optional(Vec3), target: optional(Vec3) })).annotate({ description: "Replaces the view's camera; {} clears it" }),
  state: optional(Schema.Unknown).annotate({ description: "Replaces the viewer state (mode, animation, isolate, texture); {} clears it" })
})
const ItemEdit = Schema.Struct({
  id: Text.annotate({ description: "An item id of the submission (it_…)" }),
  title: optional(Schema.String),
  text: optional(Schema.String).annotate({ description: `Markdown about this item alone. ${CLEAR}` }),
  views: optional(Schema.Array(ViewEdit))
})
export const UpdateInput = Schema.Struct({
  submission: Text,
  title: optional(Schema.String),
  ask: optional(Schema.String).annotate({ description: `One line. ${CLEAR}` }),
  brief: optional(Schema.String).annotate({ description: `Markdown. ${CLEAR}` }),
  changes: optional(Schema.String).annotate({ description: `Markdown. ${CLEAR}` }),
  limits: optional(Schema.String).annotate({ description: `Markdown. ${CLEAR}` }),
  items: optional(Schema.Array(ItemEdit)),
  expectedRevision: ExpectedRevision
})
export const WithdrawInput = Schema.Struct({
  submission: Text,
  reason: Schema.String.annotate({ description: "Why it is withdrawn, for whoever opens it later" }),
  expectedRevision: ExpectedRevision
})
const Revised = Linked({ ...Written({ submission: SubmissionView }).fields })

const findSubmission = (p: Projection, id: string): Effect.Effect<SubmissionRecord, ToolError> => {
  const found = p.records.submission.find((candidate) => candidate.id === id)
  return found ? Effect.succeed(found) : fail("not_found", `submission ${id} not found`)
}

/** A person may correct or withdraw any submission; an agent only one it submitted. */
const mayRevise = (actor: Actor, submission: SubmissionRecord): Effect.Effect<void, ToolError> =>
  actor.kind === "human" || (submission.by.kind === "agent" && submission.by.name === actor.name)
    ? Effect.void
    : fail("forbidden", `submission ${submission.id} was made by ${submission.by.name}; an agent changes only submissions it made`, {
      fix: "ask its submitter or the person, or submit your own with supersedes"
    })

const decided = (p: Projection, item: SubmissionItem): boolean => (p.decisionsByItem.get(item.id) ?? []).length > 0
const undecidedOnly = (what: string) => fail("conflict", `${what} already has a decision, so it is shown as the person saw it`, {
  fix: "submit a corrected one with supersedes; the decision stays on this one"
})

/** A text field: unchanged when not given, cleared by "", else trimmed within its limit. */
const field = (value: string | null | undefined, max: number, name: string, required = false): Effect.Effect<string | null | undefined, ToolError> => {
  if (value == null) return Effect.succeed(undefined)
  if (!isNonEmpty(value)) return required ? fail("invalid", `${name} cannot be empty`) : Effect.succeed(null)
  return value.length > max ? fail("invalid", `${name} must be text of at most ${max} characters`) : Effect.succeed(value.trim())
}

const set = <K extends string>(key: K, value: string | null | undefined): Partial<Record<K, string>> =>
  value == null ? {} : ({ [key]: value } as Record<K, string>)

const reviseRecord = (submission: SubmissionRecord, input: typeof UpdateInput.Type, p: Projection) =>
  Effect.gen(function*() {
    const top = {
      title: yield* field(input.title, 300, "title", true),
      ask: yield* field(input.ask, SUBMISSION_TEXT.ask, "ask"),
      brief: yield* field(input.brief, SUBMISSION_TEXT.brief, "brief"),
      changes: yield* field(input.changes, SUBMISSION_TEXT.changes, "changes"),
      limits: yield* field(input.limits, SUBMISSION_TEXT.limits, "limits")
    }
    if (top.ask != null && top.ask.includes("\n")) return yield* fail("invalid", "ask must be one sentence on one line", { fix: "put the background in brief" })
    const touchesAll = Object.values(top).some((value) => value !== undefined)
    if (touchesAll && submission.items.some((item) => decided(p, item))) return yield* undecidedOnly("an item of this submission")
    const edits = input.items ?? []
    for (const edit of edits) if (!submission.items.some((item) => item.id === edit.id)) return yield* fail("not_found", `item ${edit.id} is not in this submission`)
    const items: Array<SubmissionItem> = []
    for (const item of submission.items) {
      const edit = edits.find((candidate) => candidate.id === item.id)
      if (!edit) {
        items.push(item)
        continue
      }
      if (decided(p, item)) return yield* undecidedOnly(`item ${item.title}`)
      const title = yield* field(edit.title, 300, `item ${item.id} title`, true)
      const text = yield* field(edit.text, 4000, `item ${item.id} text`)
      const views: Array<FrozenView> = []
      for (const view of item.views) {
        const change = edit.views?.find((candidate) => candidate.id === view.id)
        if (!change) {
          views.push(view)
          continue
        }
        const caption = yield* field(change.caption, 300, `view ${view.id} caption`, true)
        const camera = change.camera == null ? undefined : Object.keys(change.camera).length === 0 ? null : change.camera
        const state = change.state == null ? undefined : typeof change.state === "object" && Object.keys(change.state as object).length === 0 ? null : change.state
        if (camera !== undefined && !validCamera(camera)) return yield* fail("invalid", `view ${view.id} camera must be {position: [x, y, z], target: [x, y, z]}`)
        if (state !== undefined && !validViewState(state)) return yield* fail("invalid", `view ${view.id} state is invalid`)
        views.push({ ...view, ...(caption ? { caption } : {}), ...(camera !== undefined ? { camera } : {}), ...(state !== undefined ? { state } : {}) } as FrozenView)
      }
      for (const change of edit.views ?? []) if (!item.views.some((view) => view.id === change.id)) return yield* fail("not_found", `view ${change.id} is not in item ${item.id}`)
      const { text: _text, ...rest } = item
      items.push({ ...rest, ...(title ? { title } : {}), ...(text === undefined ? (item.text ? { text: item.text } : {}) : text === null ? {} : { text }), views })
    }
    const cleared = (Object.entries(top) as Array<[keyof typeof top, string | null | undefined]>).filter(([, value]) => value === null).map(([key]) => key)
    const { ...base } = submission as unknown as Record<string, unknown>
    for (const key of cleared) delete base[key]
    return {
      ...(base as unknown as SubmissionRecord),
      ...set("title", top.title),
      ...set("ask", top.ask),
      ...set("brief", top.brief),
      ...set("changes", top.changes),
      ...set("limits", top.limits),
      items
    } satisfies SubmissionRecord
  })

const stamp = (record: SubmissionRecord, actor: Actor, at: string, requestId: string | null, binding: unknown): SubmissionRecord => {
  const { lastRequestId: _id, lastRequestBinding: _binding, ...rest } = record
  return { ...rest, editedAt: at, editedBy: actor, ...(requestId !== null && binding ? { lastRequestId: requestId, lastRequestBinding: binding as SubmissionRecord["requestBinding"] } : {}) } as SubmissionRecord
}

export const reviseActions = [
  write(
    "review.update",
    "Correct a submission's words and framing: title, ask, brief, changes, limits, and per item its title, text and views' caption, camera and state. Allowed for its submitter or a person, only while nobody has decided on what the edit changes. Frozen evidence never changes: different files are a new submission with supersedes",
    UpdateInput,
    Revised,
    "reviews",
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        const current = yield* findSubmission(p, input.submission)
        if (yield* priorRequest(p, "submission", env.requestId, env.requestBinding, "lastRequestId")) return { submission: submissionView(p, current), replayed: true }
        yield* mayRevise(env.actor, current)
        if (current.withdrawn) return yield* fail("conflict", `submission ${current.id} is withdrawn`)
        const next = stamp(yield* reviseRecord(current, input, p), env.actor, yield* nowIso, env.requestId, env.requestBinding)
        const [updated] = yield* (yield* Records).apply([{ type: "update", kind: "submission", record: next, expectedRevision: input.expectedRevision }])
        return { submission: submissionView(p, updated as SubmissionRecord) }
      })
  ),
  write(
    "review.withdraw",
    "Withdraw a submission: it leaves every queue and stays readable with its decisions. Allowed for its submitter or a person",
    WithdrawInput,
    Revised,
    "reviews",
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        const current = yield* findSubmission(p, input.submission)
        if (yield* priorRequest(p, "submission", env.requestId, env.requestBinding, "lastRequestId")) return { submission: submissionView(p, current), replayed: true }
        yield* mayRevise(env.actor, current)
        if (current.withdrawn) return yield* fail("conflict", `submission ${current.id} is already withdrawn`)
        if (!isNonEmpty(input.reason) || input.reason.length > 2000) return yield* fail("invalid", "reason must be text of at most 2000 characters")
        const at = yield* nowIso
        const next = stamp({ ...current, withdrawn: { by: env.actor, at, reason: input.reason.trim() } }, env.actor, at, env.requestId, env.requestBinding)
        const [updated] = yield* (yield* Records).apply([{ type: "update", kind: "submission", record: next, expectedRevision: input.expectedRevision }])
        return { submission: submissionView(p, updated as SubmissionRecord) }
      })
  )
]
