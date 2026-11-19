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

/** Every category and tag with how many units, collections and assets carry it. One pass over the entities. */
export const organizationList = (p: Projection) => {
  type Counts = { units: number; collections: number; assets: number }
  const field = { unit: "units", collection: "collections", asset: "assets" } as const
  const zero = (): Counts => ({ units: 0, collections: 0, assets: 0 })
  const byCategory = new Map([...p.categories].map((path) => [path, zero()]))
  const byTag = new Map<string, Counts>()
  const projectTags = new Set<string>()
  const count = (kind: OrganizedKind, id: string): void => {
    const organization = organizationOf(p, kind, id)
    for (const tag of organization.projectTags) projectTags.add(tag)
    // A category counts what it holds directly and what its subcategories hold.
    const category = organization.category
    if (category) {
      for (let end = category.length; end > 0; end = category.lastIndexOf("/", end - 1)) {
        const counts = byCategory.get(category.slice(0, end))
        if (counts) counts[field[kind]]++
      }
    }
    for (const tag of unique([...organization.projectTags, ...organization.tags])) {
      const counts = byTag.get(tag) ?? zero()
      counts[field[kind]]++
      byTag.set(tag, counts)
    }
  }
  for (const unit of p.snapshot.units) count("unit", unit.id)
  for (const collection of p.collections) count("collection", collection.id)
  for (const asset of p.snapshot.assets) count("asset", asset.id)
  return {
    categories: [...byCategory.keys()].sort().map((path) => ({ path, ...byCategory.get(path)! })),
    tags: [...byTag.keys()].sort().map((tag) => ({ tag, projectOwned: projectTags.has(tag), ...byTag.get(tag)! }))
  }
}
