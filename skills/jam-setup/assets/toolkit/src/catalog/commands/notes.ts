// Standalone notes on units, collections, assets and submissions.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ExpectedRevision, optional, priorRequest, refOf, requestFields, Text, write, type WriteEnv } from "../action.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { isNonEmpty } from "../../kernel/hash.ts"
import { Ids, nowIso } from "../../kernel/Ids.ts"
import type { NoteRecord, NoteTarget } from "../model/types.ts"
import { type Projection, typeOf } from "../Projection.ts"
import { partsOf } from "../queries/review.ts"
import { Records } from "../Records.ts"
import { NoteRecord as NoteRecordSchema } from "../records/schemas.ts"
import { OpenRecord, Written } from "../results.ts"

/** Whether something a note, label or review names exists in this checkout. */
export const targetExists = (p: Projection, target: { readonly kind: string; readonly id: string }): boolean =>
  target.kind === "unit"
    ? p.snapshot.unitsById.has(target.id)
    : target.kind === "asset"
    ? p.snapshot.assetsById.has(target.id)
    : target.kind === "collection"
    ? p.collectionsById.has(target.id)
    : target.kind === "submission"
    ? p.records.submission.some((submission) => submission.id === target.id)
    : false

const NoteTargetInput = refOf(["unit", "collection", "asset", "submission"], { item: true, part: true })

const checkPart = (p: Projection, target: typeof NoteTargetInput.Type): Effect.Effect<void, ToolError> =>
  Effect.gen(function*() {
    if (target.kind === "submission" && target.item) {
      const item = p.records.submission.find((submission) => submission.id === target.id)?.items.find((candidate) => candidate.id === target.item)
      if (!item) return yield* fail("not_found", "item not in submission")
      if (target.part && !item.parts.some((part) => part.id === target.part)) return yield* fail("not_found", "part not in item")
      return
    }
    if (!target.part) return
    const unit = target.kind === "unit" ? p.snapshot.unitsById.get(target.id) : undefined
    const known = (target.kind === "unit" || target.kind === "collection") && partsOf(p, { kind: target.kind, id: target.id }).some((part) => part.id === target.part)
    // A note may name a role that has no asset linked yet ("the model is missing").
    if (!known && !(unit && typeOf(p, unit).roles.some((role) => role.key === target.part))) return yield* fail("invalid", `unknown part ${target.part}`)
  })

const getNote = (p: Projection, id: string): Effect.Effect<NoteRecord, ToolError> => {
  const note = p.records.note.find((candidate) => candidate.id === id)
  return note ? Effect.succeed(note) : fail("not_found", `note ${id} not found`)
}

/** Change one note under its own lock, with the edit guarded by the revision that was read. */
const change = (id: string, expectedRevision: number | null | undefined, env: WriteEnv, edit: (note: NoteRecord, at: string) => NoteRecord) =>
  Effect.gen(function*() {
    const records = yield* Records
    const note = yield* getNote(env.projection, id)
    if (yield* priorRequest(env.projection, "note", env.requestId, env.requestBinding, "lastRequestId")) return { note, replayed: true }
    // The record remembers only the request that last changed it.
    const { lastRequestBinding: _binding, lastRequestId: _id, ...edited } = edit(note, yield* nowIso)
    const next: NoteRecord = env.requestId !== null && env.requestBinding ? { ...edited, lastRequestId: env.requestId, lastRequestBinding: env.requestBinding } : edited
    const [updated] = yield* records.apply([{ type: "update", kind: "note", record: next, expectedRevision }])
    return { note: updated }
  })

const noteLock = (input: { readonly id: string }): string => `note:${input.id}`

export const NoteCreateInput = Schema.Struct({ target: NoteTargetInput, body: Schema.String })
export const NoteEditInput = Schema.Struct({ id: Text, body: Schema.String, expectedRevision: ExpectedRevision })
export const NoteResolveInput = Schema.Struct({ id: Text, explanation: optional(Schema.String), expectedRevision: ExpectedRevision })
export const NoteIdInput = Schema.Struct({ id: Text, expectedRevision: ExpectedRevision })
/** A note as written. */
export const NoteOutput = Written({ note: OpenRecord(NoteRecordSchema.fields) })
export const DeletedOutput = Written({ deleted: Schema.String })

export const noteActions = [
  write(
    "note.create",
    "Create a standalone note on a unit, collection, asset or submission (optionally an item/part)",
    NoteCreateInput,
    NoteOutput,
    "notes",
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        const { target } = input
        if (!targetExists(p, target)) return yield* fail("not_found", `${target.kind} ${target.id} is not in this checkout`)
        if (!isNonEmpty(input.body)) return yield* fail("invalid", "note text is required")
        yield* checkPart(p, target)
        const prior = yield* priorRequest(p, "note", env.requestId, env.requestBinding)
        if (prior) return { note: prior, replayed: true }
        const noteTarget: NoteTarget = { kind: target.kind, id: target.id, ...(target.item != null ? { item: target.item } : {}), ...(target.part != null ? { part: target.part } : {}) }
        const note: NoteRecord = { id: yield* (yield* Ids).next("nt"), target: noteTarget, body: input.body.trim(), by: env.actor, at: yield* nowIso, revision: 1, ...requestFields(env) }
        const [created] = yield* (yield* Records).apply([{ type: "create", kind: "note", record: note }])
        return { note: created }
      })
  ),
  write(
    "note.edit",
    "Edit note text (expectedRevision guards concurrent edits)",
    NoteEditInput,
    NoteOutput,
    noteLock,
    (input, env) =>
      isNonEmpty(input.body)
        ? change(input.id, input.expectedRevision, env, (note, at) => ({ ...note, body: input.body.trim(), editedAt: at }))
        : fail("invalid", "note text is required")
  ),
  write(
    "note.resolve",
    "Mark a note dealt with, with an optional explanation",
    NoteResolveInput,
    NoteOutput,
    noteLock,
    (input, env) =>
      change(input.id, input.expectedRevision, env, (note, at) => ({
        ...note,
        resolved: { by: env.actor, at, ...(isNonEmpty(input.explanation) ? { explanation: input.explanation.trim() } : {}) }
      }))
  ),
  write(
    "note.reopen",
    "Return a dealt-with note to the open list",
    NoteIdInput,
    NoteOutput,
    noteLock,
    (input, env) =>
      change(input.id, input.expectedRevision, env, (note) => {
        const { resolved: _resolved, ...rest } = note
        return rest
      })
  ),
  write(
    "note.delete",
    "Clear (delete) a note",
    NoteIdInput,
    DeletedOutput,
    noteLock,
    (input, env) =>
      Effect.gen(function*() {
        const note = yield* getNote(env.projection, input.id)
        yield* (yield* Records).apply([{ type: "remove", kind: "note", record: note, expectedRevision: input.expectedRevision }])
        return { deleted: input.id }
      })
  )
]
