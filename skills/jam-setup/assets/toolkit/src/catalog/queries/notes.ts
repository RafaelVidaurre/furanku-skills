// Notes as people read them: each with the name of what it is about, whether that still exists,
// and a thumbnail.
import { shortRef } from "../../kernel/Ids.ts"
import { collectionParts, unitParts } from "../model/parts.ts"
import type { NoteRecord, NoteTarget } from "../model/types.ts"
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
  let viewLabel: string | null = null
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
      if (target.view) viewLabel = item.views.find((candidate) => candidate.id === target.view)?.caption ?? target.view
    }
  }
  // Where the note's subject is shown; null when it is no longer in this checkout.
  return { ...note, targetName: name, targetExists: exists, partLabel, viewLabel, thumb, route: exists ? targetRoute(p, target) : null }
}

export interface NoteListInput {
  readonly state?: string | null | undefined
  readonly targetKind?: string | null | undefined
  readonly target?: { readonly kind: NoteTarget["kind"]; readonly id: string; readonly item?: string | null | undefined; readonly part?: string | null | undefined } | null | undefined
  readonly by?: string | null | undefined
  readonly q?: string | null | undefined
  readonly page?: number | null | undefined
  readonly pageSize?: number | null | undefined
}

/** A note matches a target filter on its kind and id, and on the item and part when the filter names them. */
const matches = (note: NoteTarget, target: NonNullable<NoteListInput["target"]>): boolean =>
  note.kind === target.kind && note.id === target.id && (target.item == null || note.item === target.item) && (target.part == null || note.part === target.part)

export const noteList = (p: Projection, input: NoteListInput) => {
  const { by, target, targetKind } = input
  const state = input.state ?? "open"
  const q = (input.q ?? "").toLowerCase()
  let views = [...p.records.note]
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((note) => (!targetKind || note.target.kind === targetKind) && (!target || matches(note.target, target)) && (!by || note.by.name === by))
    .map((note) => noteView(p, note))
  if (q) views = views.filter((note) => `${note.body} ${note.targetName}`.toLowerCase().includes(q))
  const counts = { open: views.filter((note) => !note.resolved).length, resolved: views.filter((note) => note.resolved).length, all: views.length }
  views = views.filter((note) => (state === "open" ? !note.resolved : state === "resolved" ? !!note.resolved : true))
  const page = paginate(views, input.page, input.pageSize, 100, 500)
  return { notes: page.items, total: views.length, page: page.page, pages: page.pages, pageSize: page.pageSize, counts, authors: unique(p.records.note.map((note) => note.by.name)) }
}
