// Search and filtering of units, collections and assets: ranked matches, facet counts that apply
// every other filter, and bounded pages.
import { fail } from "../../kernel/errors.ts"
import * as Effect from "effect/Effect"
import type { Asset, Collection, Unit } from "../model/types.ts"
import { type Rank, rankDoc, type SearchDoc } from "../model/search.ts"
import { type ReviewState, STATE_LABEL } from "../model/verdicts.ts"
import { ancestors, factsOf, type Projection, typeOf } from "../Projection.ts"
import { paginate, unique } from "../support.ts"
import { allTags, organizationOf, type OrganizedKind } from "./organization.ts"
import { reviewOf } from "./review.ts"
import { assetSummary, collectionSummary, missingRoles, openNotes, roleLabel, unitSummary } from "./summaries.ts"

export type Section = "units" | "collections" | "assets"
type Entry = Unit | Collection | Asset

interface Facet<E> {
  readonly label: string
  readonly tree?: boolean
  values(entry: E): ReadonlyArray<string>
  name(value: string): string
}

const MAX_PAGE = 200
const KIND: Record<Section, OrganizedKind> = { units: "unit", collections: "collection", assets: "asset" }
const FILE_STATE: Record<string, string> = { ok: "Available", missing: "Missing", invalid: "Invalid", unsupported: "Unsupported", forbidden: "Outside asset roots" }
const USE: Record<string, string> = { unused: "Unused", single: "One unit", shared: "Shared" }

const facetsFor = (p: Projection, section: Section): Record<string, Facet<never>> => {
  const { schema, unitsById } = p.snapshot
  const kind = KIND[section]
  const category: Facet<Entry> = { label: "Category", tree: true, values: (entry) => ancestors(organizationOf(p, kind, entry.id).category), name: (value) => value.split("/").join(" / ") }
  const tag: Facet<Entry> = { label: "Tag", values: (entry) => allTags(p, kind, entry.id), name: (value) => value }
  const review = (target: "unit" | "collection"): Facet<Entry> => ({
    label: "Review",
    values: (entry) => {
      const summary = reviewOf(p, { kind: target, id: entry.id }).summary
      return [summary.state, ...(summary.changed ? ["changed"] : [])]
    },
    name: (value) => (value === "changed" ? "Changed since verdict" : STATE_LABEL[value as ReviewState])
  })
  const notes: Facet<Entry> = { label: "Notes", values: (entry) => (openNotes(p, kind, entry.id) ? ["open"] : []), name: () => "Open notes" }
  const users = (asset: Asset): Array<string> => unique((p.usage.get(asset.id) ?? []).map((use) => use.unit))

  if (section === "units") {
    const attributeFacets = Object.values(schema.types).flatMap((type) => type.fields).filter((field) => field.filter).map((field): [string, Facet<Unit>] => [`attr.${field.key}`, {
      label: field.label,
      values: (unit) => (typeOf(p, unit).fields.some((own) => own.key === field.key && own.filter) && unit.attrs[field.key] != null ? [String(unit.attrs[field.key])] : []),
      name: (value) => value
    }])
    const facets: Record<string, Facet<Unit>> = {
      type: { label: "Type", values: (unit) => [unit.type], name: (value) => schema.types[value]?.label ?? value },
      cat: category,
      tag,
      review: review("unit"),
      role: {
        label: "Roles",
        values: (unit) => [
          ...new Set(unit.links.map((link) => link.role)),
          ...missingRoles(p, unit).map((role) => `missing:${role.key}`),
          ...(unit.links.some((link) => factsOf(p, link.asset).state !== "ok") ? ["error"] : []),
          ...(unit.links.length > 0 ? [] : ["none"])
        ],
        name: (value) => value === "none" ? "None" : value === "error" ? "Unavailable file" : value.startsWith("missing:") ? `Missing ${roleLabel(p, value.slice(8)).toLowerCase()}` : roleLabel(p, value)
      },
      in: { label: "Collection", values: (unit) => p.memberships.get(unit.id) ?? [], name: (value) => p.collectionsById.get(value)?.name ?? value },
      notes,
      ...Object.fromEntries(attributeFacets)
    }
    return facets as Record<string, Facet<never>>
  }
  if (section === "collections") {
    const facets: Record<string, Facet<Collection>> = {
      cat: category,
      tag,
      kind: { label: "Kind", values: (collection) => [collection.kind ?? "none"], name: (value) => schema.collectionKinds[value]?.label ?? "Unspecified" },
      contains: {
        label: "Contains",
        values: (collection) => unique(collection.members.flatMap((member) => { const type = unitsById.get(member.unit)?.type; return type ? [type] : [] })),
        name: (value) => schema.types[value]?.label ?? value
      },
      review: review("collection"),
      notes
    }
    return facets as Record<string, Facet<never>>
  }
  const kindLabels = new Map(p.plugins.mediaKinds.map((mediaKind) => [mediaKind.id, mediaKind.label]))
  const facets: Record<string, Facet<Asset>> = {
    kind: { label: "Kind", values: (asset) => [asset.kind ?? "unknown"], name: (value) => kindLabels.get(value) ?? "Unknown" },
    use: { label: "Use", values: (asset) => { const n = users(asset).length; return [n === 0 ? "unused" : n === 1 ? "single" : "shared"] }, name: (value) => USE[value] ?? value },
    role: { label: "Role", values: (asset) => unique((p.usage.get(asset.id) ?? []).map((use) => use.role)), name: (value) => roleLabel(p, value) },
    state: { label: "File", values: (asset) => [factsOf(p, asset.id).state], name: (value) => FILE_STATE[value] ?? value },
    cat: category,
    tag,
    notes
  }
  return facets as Record<string, Facet<never>>
}

const searchDoc = (p: Projection, section: Section, entry: Entry): SearchDoc => {
  const category = organizationOf(p, KIND[section], entry.id).category ?? ""
  if (section === "units") {
    const unit = entry as Unit
    const attributes = Object.values(unit.attrs).flat().filter((value) => typeof value === "string" || typeof value === "number").map(String)
    return { name: unit.name, id: unit.id, aliases: unit.aliases, facts: [...unit.search, ...allTags(p, "unit", unit.id), category, typeOf(p, unit).label, ...attributes] }
  }
  if (section === "collections") {
    const collection = entry as Collection
    return {
      name: collection.name,
      id: collection.id,
      aliases: [],
      facts: [...allTags(p, "collection", collection.id), category, collection.kind ?? ""],
      members: collection.members.map((member) => ({ id: member.unit, name: p.snapshot.unitsById.get(member.unit)?.name ?? member.unit }))
    }
  }
  const asset = entry as Asset
  return { name: asset.id.split("/").pop() ?? asset.id, id: asset.id, aliases: asset.label ? [asset.label] : [], facts: [...allTags(p, "asset", asset.id), category, asset.kind ?? ""] }
}

export interface SearchInput {
  readonly scope?: string | null | undefined
  readonly q?: string | null | undefined
  readonly filters?: Readonly<Record<string, ReadonlyArray<string>>> | null | undefined
  readonly page?: number | null | undefined
  readonly pageSize?: number | null | undefined
}

const searchIn = (p: Projection, section: Section, input: SearchInput) =>
  Effect.gen(function*() {
    const scope = input.scope ?? null
    const q = input.q ?? ""
    const filters = input.filters ?? {}
    if (scope !== null && !p.plugins.scopes.some((known) => known.id === scope)) {
      return yield* fail("invalid", `scope must be one of ${p.plugins.scopes.map((known) => known.id).join(", ")}`)
    }
    const { assets, units, unitsById } = p.snapshot
    const inScope = (entry: Entry): boolean =>
      scope === null || (section === "units" ? (entry as Unit).scope === scope : section === "collections" ? (entry as Collection).members.some((member) => unitsById.get(member.unit)?.scope === scope) : true)
    const all = ((section === "units" ? units : section === "collections" ? p.collections : assets) as ReadonlyArray<Entry>).filter(inScope)
    const facets = facetsFor(p, section) as unknown as Record<string, Facet<Entry>>
    for (const key of Object.keys(filters)) if (!facets[key]) return yield* fail("invalid", `unknown filter ${key}`)

    const ranked = new Map<Entry, Rank>()
    for (const entry of all) {
      const rank = rankDoc(q, searchDoc(p, section, entry))
      if (rank) ranked.set(entry, rank)
    }
    const cache = new Map<string, ReadonlySet<string>>()
    const values = (entry: Entry, key: string): ReadonlySet<string> => {
      const id = `${key}\0${entry.id}`
      let known = cache.get(id)
      if (!known) cache.set(id, known = new Set(facets[key]!.values(entry)))
      return known
    }
    const selected = Object.entries(filters)
    const passes = (entry: Entry, except?: string): boolean =>
      ranked.has(entry) && selected.every(([key, wanted]) => key === except || wanted.length === 0 || wanted.some((value) => values(entry, key).has(value)))
    const nameOf = (entry: Entry): string => (entry as { name?: string }).name ?? entry.id
    const matched = all.filter((entry) => passes(entry)).sort((a, b) => (ranked.get(b)!.score - ranked.get(a)!.score) || nameOf(a).localeCompare(nameOf(b)))

    // A facet's counts apply every filter except its own, so its other values stay choosable.
    const facetOut: Record<string, { label: string; tree: boolean; values: Array<{ value: string; label: string; count: number; selected: boolean }> }> = {}
    for (const [key, facet] of Object.entries(facets)) {
      const counts = new Map<string, number>()
      for (const entry of all) if (passes(entry, key)) for (const value of values(entry, key)) counts.set(value, (counts.get(value) ?? 0) + 1)
      for (const value of filters[key] ?? []) if (!counts.has(value)) counts.set(value, 0)
      // An attribute filter of types this section does not hold is not offered here.
      if (key.startsWith("attr.") && counts.size === 0) continue
      facetOut[key] = {
        label: facet.label,
        tree: !!facet.tree,
        values: [...counts].map(([value, count]) => ({ value, label: facet.name(value), count, selected: (filters[key] ?? []).includes(value) }))
          .sort((a, b) => (facet.tree ? a.value.localeCompare(b.value) : a.label.localeCompare(b.label)))
      }
    }
    const page = paginate(matched, input.page, input.pageSize, 60, MAX_PAGE)
    const match = (entry: Entry) => {
      const member = ranked.get(entry)?.member
      return { match: member ? { member } : null }
    }
    return {
      scope,
      q,
      filters,
      total: matched.length,
      all: all.length,
      page: page.page,
      pages: page.pages,
      pageSize: page.pageSize,
      hits: page.items.map((entry) => ({ entry, ...match(entry) })),
      facets: facetOut,
      ids: matched.map((entry) => entry.id)
    }
  })

/** `unit.search`: units, optionally of one scope. */
export const unitSearch = (p: Projection, input: SearchInput) =>
  Effect.map(searchIn(p, "units", input), ({ hits, ...found }) => ({ units: hits.map(({ entry, match }) => ({ ...unitSummary(p, entry as Unit), match })), ...found }))

/** `collection.search`: collections, optionally those with a member in one scope. */
export const collectionSearch = (p: Projection, input: SearchInput) =>
  Effect.map(searchIn(p, "collections", input), ({ hits, ...found }) => ({ collections: hits.map(({ entry, match }) => ({ ...collectionSummary(p, entry as Collection), match })), ...found }))

/** `asset.search`: assets; scopes split units, so an asset search has none. */
export const assetSearch = (p: Projection, input: Omit<SearchInput, "scope">) =>
  Effect.map(searchIn(p, "assets", input), ({ hits, scope: _scope, ...found }) => ({ assets: hits.map(({ entry, match }) => ({ ...assetSummary(p, entry as Asset), match })), ...found }))
