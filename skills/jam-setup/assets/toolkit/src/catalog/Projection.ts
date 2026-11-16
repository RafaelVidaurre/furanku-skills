// One immutable view of the project for one action: what the sources say (snapshot), what the
// records say, and the review policy, with the indexes every query needs. It is built once per
// action and passed down explicitly, so every row and facet of an answer reads the same state.
import type { SnapshotData } from "./Snapshot.ts"
import type { PluginSet } from "./Plugins.ts"
import type { RecordsView } from "./Records.ts"
import type { Policy } from "./ReviewPolicy.ts"
import type { Collection, LabelRecord, MediaFacts, NoteRecord, SubmissionItem, SubmissionRecord, Target, TypeDef, Unit, VerdictRecord } from "./model/types.ts"
import type { Rollup } from "./model/verdicts.ts"
import { groupBy } from "./support.ts"

export interface ItemRef {
  readonly submission: SubmissionRecord
  readonly item: SubmissionItem
}

export interface EventSummary {
  readonly id: string
  readonly submission: string
  readonly ref: string | null
  readonly item: string
  readonly by: VerdictRecord["by"]
  readonly at: string
  readonly scope: "whole" | "parts"
  readonly verdicts: Record<string, string>
  readonly comment: string
  readonly partNotes: Readonly<Record<string, string>>
  /** Recorded by an agent from a person's words given elsewhere. */
  readonly relay?: { readonly by: string; readonly channel: string; readonly words: string }
}

export interface PartReview {
  readonly id: string
  readonly label: string
  readonly role?: string
  readonly asset?: string
  readonly member?: string
  readonly reviewable: boolean
  readonly verdict: string | null
  readonly event: EventSummary | null
  /** The frozen evidence the verdict saw differs from the current content. */
  readonly changed: boolean
}

export interface TargetReview {
  readonly parts: ReadonlyArray<PartReview>
  readonly summary: Rollup
}

export interface Projection {
  readonly signature: string
  readonly snapshot: SnapshotData
  readonly records: RecordsView
  readonly policy: Policy
  readonly plugins: PluginSet
  /** Declared preview modules: the SHA-256 of the file, or null when the file is missing. */
  readonly previewModules: ReadonlyMap<string, string | null>
  /** Declared media kind browser modules, by kind id: the SHA-256 of the file, or null when it is missing. */
  readonly kindModules: ReadonlyMap<string, string | null>
  readonly labels: ReadonlyMap<string, LabelRecord>
  readonly collections: ReadonlyArray<Collection>
  readonly collectionsById: ReadonlyMap<string, Collection>
  /** Asset id to the units and roles that link it. */
  readonly usage: ReadonlyMap<string, ReadonlyArray<{ readonly unit: string; readonly role: string }>>
  /** Unit id to the collections it is a member of. */
  readonly memberships: ReadonlyMap<string, ReadonlyArray<string>>
  readonly notesByTarget: ReadonlyMap<string, ReadonlyArray<NoteRecord>>
  readonly items: ReadonlyMap<string, ItemRef>
  readonly itemsByTarget: ReadonlyMap<string, ReadonlyArray<ItemRef>>
  /** Verdict events whose submission and item agree; any other event decides nothing. */
  readonly events: ReadonlyArray<VerdictRecord>
  readonly eventsByTarget: ReadonlyMap<string, ReadonlyArray<VerdictRecord>>
  readonly eventsByItem: ReadonlyMap<string, ReadonlyArray<VerdictRecord>>
  readonly categories: ReadonlySet<string>
  /** Review projections computed so far, by target. A cache of a pure function of the rest. */
  readonly reviews: Map<string, TargetReview>
}

export const targetKey = (target: Target): string => `${target.kind}:${target.id}`
export const ancestors = (category: string | null | undefined): Array<string> =>
  category ? category.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/")) : []

export const typeOf = (projection: Projection, unit: Unit): TypeDef => projection.snapshot.schema.types[unit.type]!
const MISSING: MediaFacts = { state: "missing", error: "not an asset in this checkout" }
export const factsOf = (projection: Projection, assetId: string | null | undefined): MediaFacts =>
  (assetId == null ? undefined : projection.snapshot.facts.get(assetId)) ?? MISSING

export const buildProjection = (
  snapshot: SnapshotData,
  records: RecordsView,
  policy: Policy,
  plugins: PluginSet,
  previewModules: ReadonlyMap<string, string | null>,
  kindModules: ReadonlyMap<string, string | null> = new Map()
): Projection => {
  const labels = new Map(records.label.map((label) => [targetKey(label.target), label]))
  const sourceIds = new Set(snapshot.collections.map((collection) => collection.id))
  const collections: Array<Collection> = [
    ...snapshot.collections.map((collection): Collection => {
      const label = labels.get(`collection:${collection.id}`)
      return { ...collection, owner: "adapter", category: label?.category ?? collection.adapterCategory, tags: label?.tags ?? [], revision: label?.revision ?? null }
    }),
    // A source collection shadows a catalog record with the same id.
    ...records.collection.filter((record) => !sourceIds.has(record.id)).map((record): Collection => ({
      id: record.id,
      name: record.name,
      kind: record.kind ?? null,
      members: record.members,
      owner: "catalog",
      adapterTags: [],
      adapterCategory: null,
      category: record.category ?? null,
      tags: record.tags,
      revision: record.revision,
      createdBy: record.createdBy
    }))
  ]
  const usage = new Map<string, Array<{ unit: string; role: string }>>()
  for (const unit of snapshot.units) {
    for (const link of unit.links) usage.set(link.asset, [...(usage.get(link.asset) ?? []), { unit: unit.id, role: link.role }])
  }
  const memberships = new Map<string, Array<string>>()
  for (const collection of collections) {
    for (const member of collection.members) memberships.set(member.unit, [...(memberships.get(member.unit) ?? []), collection.id])
  }
  const items = new Map<string, ItemRef>()
  const itemsByTarget = new Map<string, Array<ItemRef>>()
  for (const submission of records.submission) {
    for (const item of submission.items) {
      items.set(item.id, { submission, item })
      const key = targetKey(item.target)
      itemsByTarget.set(key, [...(itemsByTarget.get(key) ?? []), { submission, item }])
    }
  }
  const events = records.verdict.filter((event) => items.get(event.item)?.submission.id === event.submission)
  const categories = new Set([
    ...(records.categories[0]?.categories ?? []),
    ...records.label.map((label) => label.category),
    ...collections.map((collection) => collection.category),
    ...snapshot.units.map((unit) => unit.adapterCategory),
    ...snapshot.assets.map((asset) => asset.adapterCategory)
  ].filter((category): category is string => !!category).flatMap(ancestors))
  return {
    signature: `${snapshot.version}|${records.signature}|${plugins.signature}`,
    snapshot,
    records,
    policy,
    plugins,
    previewModules,
    kindModules,
    labels,
    collections,
    collectionsById: new Map(collections.map((collection) => [collection.id, collection])),
    usage,
    memberships,
    notesByTarget: groupBy(records.note, (note) => targetKey(note.target)),
    items,
    itemsByTarget,
    events,
    eventsByTarget: groupBy(events, (event) => targetKey(items.get(event.item)!.item.target)),
    eventsByItem: groupBy(events, (event) => event.item),
    categories,
    reviews: new Map()
  }
}
