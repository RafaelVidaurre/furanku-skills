// What a reviewer can give a verdict on. Part identity is explicit: it never depends on a label or
// on the order of links, so a rename or a reorder keeps verdicts where they were.
import type { CatalogSchema, Collection, Part, TypeDef, Unit } from "./types.ts"

const stem = (path: string): string => (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "")

/** The attributes a verdict covers: derived fields are live facts, not approved content. */
export const reviewAttrs = (unit: Unit, type: TypeDef): Record<string, unknown> => {
  const derived = new Set(type.fields.filter((field) => field.derived).map((field) => field.key))
  return Object.fromEntries(Object.entries(unit.attrs).filter(([key]) => !derived.has(key)))
}

/**
 * A unit's parts: each linked visual, keyed by role (single) or role plus link key or asset
 * (many), then its attributes.
 */
export const unitParts = (unit: Unit, type: TypeDef): ReadonlyArray<Part> => {
  const parts: Array<Part> = []
  for (const role of type.roles) {
    const links = unit.links.filter((link) => link.role === role.key)
    for (const link of links) {
      parts.push({
        id: role.many ? `${role.key}:${link.key ?? link.asset}` : role.key,
        label: role.many && links.length > 1 ? `${role.label} · ${stem(link.asset)}` : role.label,
        role: role.key,
        asset: link.asset
      })
    }
  }
  const hasAttributes = type.fields.some((field) => !field.derived) || Object.keys(reviewAttrs(unit, type)).length > 0
  if (type.reviewAttributes && hasAttributes) parts.push({ id: "attributes", label: "Attributes" })
  return parts
}

/**
 * A collection's parts: each member in this collection's context, plus a combined preview when
 * the collection kind declares one.
 */
export const collectionParts = (
  collection: Collection,
  unitsById: ReadonlyMap<string, Unit>,
  schema: CatalogSchema
): ReadonlyArray<Part> => {
  const parts: Array<Part> = collection.members.map((member) => ({
    id: `member:${member.unit}`,
    label: unitsById.get(member.unit)?.name ?? member.unit,
    member: member.unit
  }))
  const kind = collection.kind ? schema.collectionKinds[collection.kind] : undefined
  if (kind?.preview) parts.push({ id: "preview", label: kind.preview.label ?? "Preview" })
  return parts
}

/** A capture part: externally rendered evidence frozen with one submission item. */
export const CAPTURE_PART = /^capture:[1-9][0-9]*$/
/** The one part of a work item that has text and no captures. */
export const DECISION_PART = "decision"

/**
 * Parts that belong to one submission item and to no content: captures and a work item's
 * decision. They have no current version, so they never count as content that changed.
 */
export const isItemEvidence = (partId: string): boolean => CAPTURE_PART.test(partId) || partId === DECISION_PART

/** The role a part belongs to, for deciding whether it is reference material. */
export const partRole = (part: { readonly id: string; readonly role?: string | null | undefined }): string =>
  part.role ?? part.id.split(":")[0] ?? part.id
