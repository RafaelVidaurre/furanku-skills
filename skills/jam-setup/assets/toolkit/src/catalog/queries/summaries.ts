// The short forms of units, collections and assets that lists and cards show.
import type { Sheet } from "../model/sheet.ts"
import { isRecord } from "../../kernel/hash.ts"
import type { Asset, Collection, FieldDef, RoleDef, Unit } from "../model/types.ts"
import { factsOf, type Projection, typeOf } from "../Projection.ts"
import { allTags, organizationOf } from "./organization.ts"
import { reviewOf } from "./review.ts"

/**
 * Where the server serves an asset's current bytes. `v` is the file's version token (size and
 * modification time), so the URL changes with the file and its response can be cached for good
 * without the file ever being hashed for a list.
 */
export const assetUrl = (id: string, version: string): string => `/media/asset/${encodeURIComponent(id)}?v=${version}`
export const evidenceUrl = (submission: string, item: string, part: string, leaf: string): string =>
  `/media/evidence/${encodeURIComponent(submission)}/${encodeURIComponent(item)}/${encodeURIComponent(part)}${leaf ? `?leaf=${encodeURIComponent(leaf)}` : ""}`

export const assetRef = (p: Projection, asset: Asset) => {
  const facts = factsOf(p, asset.id)
  return {
    id: asset.id,
    path: asset.path,
    kind: asset.kind,
    state: facts.state,
    error: facts.error ?? null,
    /** Known on detail pages and wherever a verdict is checked; null in lists, which never hash. */
    sha256: facts.sha256 ?? null,
    /** Changes whenever the file does; what a client caches thumbnails and decoded media by. */
    version: facts.token ?? null,
    size: facts.size ?? null,
    mime: facts.mime ?? null,
    url: facts.state === "ok" && facts.token !== undefined ? assetUrl(asset.id, facts.token) : null
  }
}
/** An asset as lists and pages refer to it; a thumbnail of an animation also carries its sheet. */
export type AssetRef = ReturnType<typeof assetRef> & { readonly sheet?: Sheet }

const assetRefById = (p: Projection, id: string): AssetRef | null => {
  const asset = p.snapshot.assetsById.get(id)
  return asset ? assetRef(p, asset) : null
}

/** The picture that stands for a unit: its type's thumbnail role, else an image, else its first link. */
export const thumbOf = (p: Projection, unit: Unit): AssetRef | null => {
  const type = typeOf(p, unit)
  const link = unit.links.find((candidate) => candidate.role === type.thumb) ??
    unit.links.find((candidate) => p.snapshot.assetsById.get(candidate.asset)?.kind === "image") ?? unit.links[0]
  if (!link) return null
  const ref = assetRefById(p, link.asset)
  // An animation's thumbnail is its first frame, not the whole sheet.
  return ref && link.sheet ? { ...ref, sheet: link.sheet } : ref
}

export const openNotes = (p: Projection, kind: string, id: string): number =>
  (p.notesByTarget.get(`${kind}:${id}`) ?? []).filter((note) => !note.resolved).length

export const missingRoles = (p: Projection, unit: Unit): Array<RoleDef> =>
  typeOf(p, unit).roles.filter((role) => role.expected && !unit.links.some((link) => link.role === role.key))

export const roleLabel = (p: Projection, key: string): string =>
  Object.values(p.snapshot.schema.types).flatMap((type) => type.roles).find((role) => role.key === key)?.label ?? key

export const formatValue = (p: Projection, value: unknown, field?: FieldDef): unknown => {
  if (field?.kind === "refs") return (Array.isArray(value) ? value : [value]).map((id) => p.snapshot.unitsById.get(String(id))?.name ?? id).join(", ")
  if (Array.isArray(value)) return value.join(", ")
  if (isRecord(value)) return JSON.stringify(value)
  return value
}

const statusOf = (p: Projection, kind: "unit" | "collection", id: string) => {
  const review = reviewOf(p, { kind, id })
  return {
    state: review.summary.state,
    summary: review.summary,
    parts: review.parts.map((part) => ({ id: part.id, label: part.label, verdict: part.verdict, changed: part.changed }))
  }
}

export const unitSummary = (p: Projection, unit: Unit) => {
  const type = typeOf(p, unit)
  // A role is shared when its asset is linked by more than one unit.
  const shared = new Set(unit.links.filter((link) => new Set((p.usage.get(link.asset) ?? []).map((use) => use.unit)).size > 1).map((link) => link.role))
  return {
    id: unit.id,
    scope: unit.scope,
    name: unit.name,
    type: unit.type,
    typeLabel: type.label,
    thumb: thumbOf(p, unit),
    roles: type.roles.filter((role) => unit.links.some((link) => link.role === role.key)).map((role) => ({ key: role.key, label: role.label, kind: role.mediaKinds[0], shared: shared.has(role.key) })),
    missing: missingRoles(p, unit).map((role) => ({ key: role.key, label: role.label, kind: role.mediaKinds[0] })),
    attrsPreview: unit.links.length > 0 ? null : type.fields.filter((field) => !field.derived && field.summary && unit.attrs[field.key] != null).slice(0, 2).map((field) => ({
      label: field.label,
      value: `${formatValue(p, unit.attrs[field.key], field)}${field.unit ? ` ${field.unit}` : ""}`
    })),
    status: statusOf(p, "unit", unit.id),
    notes: openNotes(p, "unit", unit.id),
    category: organizationOf(p, "unit", unit.id).category,
    tags: allTags(p, "unit", unit.id)
  }
}

export const collectionSummary = (p: Projection, collection: Collection) => ({
  id: collection.id,
  name: collection.name,
  kind: collection.kind,
  kindLabel: collection.kind ? p.snapshot.schema.collectionKinds[collection.kind]?.label ?? collection.kind : null,
  owner: collection.owner,
  category: organizationOf(p, "collection", collection.id).category,
  tags: allTags(p, "collection", collection.id),
  memberCount: collection.members.length,
  thumbs: collection.members.slice(0, 4).flatMap((member) => {
    const unit = p.snapshot.unitsById.get(member.unit)
    return unit ? [{ unit: unit.id, name: unit.name, typeLabel: typeOf(p, unit).label, thumb: thumbOf(p, unit) }] : []
  }),
  status: statusOf(p, "collection", collection.id),
  notes: openNotes(p, "collection", collection.id)
})

export const assetSummary = (p: Projection, asset: Asset) => {
  const uses = p.usage.get(asset.id) ?? []
  return {
    ...assetRef(p, asset),
    label: asset.label,
    usedBy: new Set(uses.map((use) => use.unit)).size,
    roles: [...new Set(uses.map((use) => use.role))],
    notes: openNotes(p, "asset", asset.id),
    category: organizationOf(p, "asset", asset.id).category,
    tags: allTags(p, "asset", asset.id)
  }
}

/** The address of a declared browser module, pinned to the revision with this SHA-256. */
export const moduleUrl = (name: string, sha256: string): string => `/project/module/${encodeURIComponent(name)}?v=${sha256.slice(0, 16)}`

/**
 * Where the page loads a declared browser module of an inspector or panel: by name, pinned to its
 * bytes. A module no plugin declares, or whose file is missing, is an error to show, never a substitute.
 */
export const browserModuleOf = (p: Projection, name: string): { readonly url: string | null; readonly error: string | null } => {
  if (!p.browserModules.has(name)) return { url: null, error: `browser module "${name}" is not declared by any plugin (a plugin lists it under browserModules)` }
  const digest = p.browserModules.get(name) ?? null
  return digest === null
    ? { url: null, error: `browser module "${name}" is declared but its file is missing` }
    : { url: moduleUrl(name, digest), error: null }
}
