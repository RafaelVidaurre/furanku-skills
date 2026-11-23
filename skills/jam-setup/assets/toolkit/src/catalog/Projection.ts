// One immutable view of the project for one action: what the sources say (snapshot), what the
// records say, and the review policy, with the indexes every query needs. It is built once per
// action and passed down explicitly, so every row and facet of an answer reads the same state.
import type { SnapshotData } from "./Snapshot.ts"
import type { PluginSet } from "./Plugins.ts"
import type { RecordsView } from "./Records.ts"
import type { Policy } from "./ReviewPolicy.ts"
import type { Collection, CollectionRecord, OrganizationRecord, MediaFacts, NoteRecord, Problem, SubmissionItem, SubmissionRecord, Target, TypeDef, Unit, DecisionRecord } from "./model/types.ts"
import { KINDS, RECORDS_DIR } from "./records/layout.ts"
import type { Rollup } from "./model/verdicts.ts"
import { groupBy } from "./support.ts"

export interface ItemRef {
  readonly submission: SubmissionRecord
  readonly item: SubmissionItem
}

export interface DecisionSummary {
  readonly id: string
  readonly submission: string
  readonly ref: string | null
  readonly item: string
  readonly by: DecisionRecord["by"]
  readonly at: string
  readonly covers: "whole" | "parts"
  readonly verdicts: Record<string, string>
  readonly comment: string
  readonly partComments: Readonly<Record<string, string>>
  /** Recorded by an agent from a person's words given elsewhere. */
  readonly relay?: { readonly by: string; readonly channel: string; readonly words: string }
  /** What review.decision.edit and review.decision.delete take as expectedRevision. */
  readonly revision: number
  readonly editedAt?: string
  readonly editedBy?: DecisionRecord["by"]
}

export interface PartReview {
  readonly id: string
  readonly label: string
  readonly role?: string
  readonly asset?: string
  readonly member?: string
  readonly reviewable: boolean
  readonly verdict: string | null
  readonly decision: DecisionSummary | null
  /** The frozen evidence the deciding decision saw differs from the current content. */
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
  /** Declared browser modules (inspectors, panels, previews) by name: the SHA-256 of the file, or null when the file is missing. */
  readonly browserModules: ReadonlyMap<string, string | null>
  /** Declared media kind browser modules, by kind id, likewise. */
  readonly kindModules: ReadonlyMap<string, string | null>
  /** Organization records by target key. */
  readonly organization: ReadonlyMap<string, OrganizationRecord>
  readonly collections: ReadonlyArray<Collection>
  readonly collectionsById: ReadonlyMap<string, Collection>
  /** Asset id to the units and roles that link it. */
  readonly usage: ReadonlyMap<string, ReadonlyArray<{ readonly unit: string; readonly role: string }>>
  /** Unit id to the collections it is a member of. */
  readonly memberships: ReadonlyMap<string, ReadonlyArray<string>>
  readonly notesByTarget: ReadonlyMap<string, ReadonlyArray<NoteRecord>>
  readonly items: ReadonlyMap<string, ItemRef>
  readonly itemsByTarget: ReadonlyMap<string, ReadonlyArray<ItemRef>>
  /** Decisions whose submission and item agree; any other decision decides nothing. */
  readonly decisions: ReadonlyArray<DecisionRecord>
  readonly decisionsByTarget: ReadonlyMap<string, ReadonlyArray<DecisionRecord>>
  readonly decisionsByItem: ReadonlyMap<string, ReadonlyArray<DecisionRecord>>
  readonly categories: ReadonlySet<string>
  /**
   * Records that are valid on their own but cannot be used beside the others: a decision whose
   * submission or item does not exist, a catalog-owned collection hidden by a project-owned one.
   */
  readonly recordProblems: ReadonlyArray<Problem>
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

/** The digests of the declared browser modules, by kind of module. */
export interface ModuleDigests {
  readonly modules: ReadonlyMap<string, string | null>
  readonly kinds: ReadonlyMap<string, string | null>
}

export const buildProjection = (
  snapshot: SnapshotData,
  records: RecordsView,
  policy: Policy,
  plugins: PluginSet,
  modules: ModuleDigests
): Projection => {
  const organization = new Map(records.organization.map((record) => [targetKey(record.target), record]))
  const sourceIds = new Set(snapshot.collections.map((collection) => collection.id))
  const collections: Array<Collection> = [
    ...snapshot.collections.map((collection): Collection => {
      const own = organization.get(`collection:${collection.id}`)
      return { ...collection, owner: "project", category: own?.category ?? collection.adapterCategory, tags: own?.tags ?? [], revision: own?.revision ?? null }
    }),
    // A source collection shadows a catalog record with the same id (reported below).
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
      // Work items target no content: they are found through their submission only.
      if (item.target === null) continue
      const key = targetKey(item.target)
      itemsByTarget.set(key, [...(itemsByTarget.get(key) ?? []), { submission, item }])
    }
  }
  const decisions = records.decision.filter((decision) => items.get(decision.item)?.submission.id === decision.submission)
  const fileOf = (kind: "decision" | "collection", record: DecisionRecord | CollectionRecord): string => `${RECORDS_DIR}/${KINDS[kind].file(record as never)}`
  const submissionIds = new Set(records.submission.map((submission) => submission.id))
  const recordProblems: Array<Problem> = [
    ...records.decision.filter((decision) => items.get(decision.item)?.submission.id !== decision.submission).map((decision): Problem => ({
      subject: fileOf("decision", decision),
      error: submissionIds.has(decision.submission)
        ? `decision names item ${decision.item}, which submission ${decision.submission} does not have`
        : `decision belongs to submission ${decision.submission}, which does not exist`,
      recovery: "remove this file, or restore the submission it belongs to"
    })),
    ...records.collection.filter((record) => sourceIds.has(record.id)).map((record): Problem => ({
      subject: fileOf("collection", record),
      error: `collection ${record.id} is also defined by the project's sources; this catalog-owned record is hidden`,
      recovery: "create it again under another id with collection.create and delete this one with collection.delete, or remove the collection from the project's sources"
    }))
  ]
  const categories = new Set([
    ...(records.categories[0]?.categories ?? []),
    ...records.organization.map((record) => record.category),
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
    browserModules: modules.modules,
    kindModules: modules.kinds,
    organization,
    collections,
    collectionsById: new Map(collections.map((collection) => [collection.id, collection])),
    usage,
    memberships,
    notesByTarget: groupBy(records.note, (note) => targetKey(note.target)),
    items,
    itemsByTarget,
    decisions,
    decisionsByTarget: groupBy(decisions.filter((decision) => items.get(decision.item)!.item.target !== null), (decision) => targetKey(items.get(decision.item)!.item.target!)),
    decisionsByItem: groupBy(decisions, (decision) => decision.item),
    categories,
    recordProblems,
    reviews: new Map()
  }
}
