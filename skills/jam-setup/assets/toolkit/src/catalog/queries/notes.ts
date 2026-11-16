// Notes as people read them: each with the name of what it is about, whether that still exists,
// and a thumbnail.
import { shortRef } from "../../kernel/Ids.ts"
import { collectionParts, unitParts } from "../model/parts.ts"
import type { NoteRecord, Target } from "../model/types.ts"
import { type Projection, typeOf } from "../Projection.ts"
import { targetRoute } from "../routes.ts"
import { paginate, unique } from "../support.ts"
import { assetRef, thumbOf } from "./summaries.ts"

/** A note is never retargeted: when its target is gone it stays, marked as such. */
export const noteView = (p: Projection, note: NoteRecord) => {
  const { assetsById, schema, unitsById } = p.snapshot
  const target = note.target
  const part = target.part
  let exists = true
  let name = target.id
  let partLabel: string | null = null
  let thumb: ReturnType<typeof assetRef> | null = null
  if (target.kind === "unit") {
    const unit = unitsById.get(target.id)
    exists = !!unit
    name = unit?.name ?? target.id
    if (unit) {
      thumb = thumbOf(p, unit)
      const type = typeOf(p, unit)
      if (part) partLabel = unitParts(unit, type).find((candidate) => candidate.id === part)?.label ?? type.roles.find((role) => role.key === part)?.label ?? part
    }
  } else if (target.kind === "collection") {
    const collection = p.collectionsById.get(target.id)
    exists = !!collection
    name = collection?.name ?? target.id
    if (part && collection) partLabel = collectionParts(collection, unitsById, schema).find((candidate) => candidate.id === part)?.label ?? part
  } else if (target.kind === "asset") {
    const asset = assetsById.get(target.id)
    exists = !!asset
    name = target.id.split("/").pop() ?? target.id
    if (asset) thumb = assetRef(p, asset)
  } else {
    const submission = p.records.submission.find((candidate) => candidate.id === target.id)
    exists = !!submission
    if (submission) name = `${submission.title} · ${shortRef(submission.id)}`
    const item = submission?.items.find((candidate) => candidate.id === target.item)
    if (item) {
      name += ` · ${item.title}`
      if (part) partLabel = item.parts.find((candidate) => candidate.id === part)?.label ?? part
    }
  }
  // Where the note's subject is shown; null when it is no longer in this checkout.
  return { ...note, targetName: name, targetExists: exists, partLabel, thumb, route: exists ? targetRoute(p, target) : null }
}

export interface NotesListInput {
  readonly state?: string | null | undefined
  readonly targetKind?: string | null | undefined
  readonly target?: Target | null | undefined
  readonly by?: string | null | undefined
  readonly q?: string | null | undefined
  readonly page?: number | null | undefined
  readonly pageSize?: number | null | undefined
}

export const notesList = (p: Projection, input: NotesListInput) => {
  const { by, target, targetKind } = input
  const state = input.state ?? "open"
  const q = (input.q ?? "").toLowerCase()
  let views = [...p.records.note]
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((note) => (!targetKind || note.target.kind === targetKind) && (!target || (note.target.kind === target.kind && note.target.id === target.id)) && (!by || note.by.name === by))
    .map((note) => noteView(p, note))
  if (q) views = views.filter((note) => `${note.body} ${note.targetName}`.toLowerCase().includes(q))
  const counts = { open: views.filter((note) => !note.resolved).length, resolved: views.filter((note) => note.resolved).length, all: views.length }
  views = views.filter((note) => (state === "open" ? !note.resolved : state === "resolved" ? !!note.resolved : true))
  const page = paginate(views, input.page, input.pageSize, 100, 500)
  return { total: views.length, counts, page: page.page, pages: page.pages, authors: unique(p.records.note.map((note) => note.by.name)), notes: page.items }
}
