// Categories and tags. A source's own tags and category are project-owned and read-only here;
// what people set in the catalog is stored separately in organization records and layered on top.
import type { Asset, Collection, OrganizationRecord, Unit } from "../model/types.ts"
import type { Projection } from "../Projection.ts"
import { unique } from "../support.ts"

export type OrganizedKind = "unit" | "asset" | "collection"

export interface Organization {
  readonly category: string | null
  readonly tags: ReadonlyArray<string>
  readonly projectTags: ReadonlyArray<string>
  readonly projectCategory: string | null
  readonly revision: number | null
  readonly owner?: "project" | "catalog"
}

const ofCollection = (collection: Collection): Organization => ({
  category: collection.category ?? null,
  tags: collection.tags,
  projectTags: collection.adapterTags,
  projectCategory: collection.adapterCategory,
  revision: collection.revision ?? null,
  owner: collection.owner
})

/** The organization of an entity given its organization record (or none). */
export const organizationWith = (entity: Unit | Asset | undefined, record: Pick<OrganizationRecord, "category" | "tags" | "revision"> | undefined): Organization => ({
  category: record?.category ?? entity?.adapterCategory ?? null,
  tags: record?.tags ?? [],
  projectTags: entity?.adapterTags ?? [],
  projectCategory: entity?.adapterCategory ?? null,
  revision: record?.revision ?? null
})

export const organizationOf = (p: Projection, kind: OrganizedKind, id: string): Organization => {
  if (kind === "collection") {
    const collection = p.collectionsById.get(id)
    if (collection) return ofCollection(collection)
  }
  const entity = kind === "unit" ? p.snapshot.unitsById.get(id) : kind === "asset" ? p.snapshot.assetsById.get(id) : undefined
  return organizationWith(entity, p.organization.get(`${kind}:${id}`))
}

export const allTags = (p: Projection, kind: OrganizedKind, id: string): Array<string> => {
  const organization = organizationOf(p, kind, id)
  return unique([...organization.projectTags, ...organization.tags])
}

/** Every category and tag with how many units, collections and assets carry it. */
export const organizationList = (p: Projection) => {
  const { assets, units } = p.snapshot
  const counts = (matches: (kind: OrganizedKind, id: string) => boolean) => ({
    units: units.filter((unit) => matches("unit", unit.id)).length,
    collections: p.collections.filter((collection) => matches("collection", collection.id)).length,
    assets: assets.filter((asset) => matches("asset", asset.id)).length
  })
  const categories = [...p.categories].sort().map((path) => ({
    path,
    ...counts((kind, id) => {
      const category = organizationOf(p, kind, id).category
      return category === path || !!category?.startsWith(`${path}/`)
    })
  }))
  const every = [
    ...units.map((unit) => allTags(p, "unit", unit.id)),
    ...p.collections.map((collection) => allTags(p, "collection", collection.id)),
    ...assets.map((asset) => allTags(p, "asset", asset.id))
  ]
  const projectTags = new Set([...units.flatMap((unit) => unit.adapterTags), ...assets.flatMap((asset) => asset.adapterTags), ...p.collections.flatMap((collection) => collection.adapterTags)])
  const tags = unique(every.flat()).sort().map((tag) => ({ tag, projectOwned: projectTags.has(tag), ...counts((kind, id) => allTags(p, kind, id).includes(tag)) }))
  return { categories, tags }
}
