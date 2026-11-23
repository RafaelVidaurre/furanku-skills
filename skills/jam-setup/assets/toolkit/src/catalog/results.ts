// The shapes of action results. Every built-in and viewer action declares its `output` with these
// pieces; `actions` publishes it as JSON Schema, and with `CatalogOutputCheck` on (the tests) every
// result is decoded against it with unknown fields refused. A result is what a caller receives:
// a `url` beside each `route` while a server runs, else one `hint`; `replayed` on a repeated write.
import * as Schema from "effect/Schema"
import { NoteRecord } from "./records/schemas.ts"

/** A result field that may be absent (or undefined in a result that was not serialised yet). */
export const opt = <S extends Schema.Top>(schema: S) => Schema.optional(schema)
const Str = Schema.String
const Num = Schema.Number
const Bool = Schema.Boolean
const Nullable = <S extends Schema.Top>(schema: S) => Schema.NullOr(schema)
const Strings = Schema.Array(Str)
export const Open = Schema.Record(Str, Schema.Unknown)

/** A write's result; `replayed` marks a repeat of an earlier request id. */
export const Written = <F extends Schema.Struct.Fields>(fields: F) => Schema.Struct({ ...fields, replayed: opt(Schema.Literal(true)) })
/** A result that names a page: `hint` says how to get links while no server runs. */
export const Linked = <F extends Schema.Struct.Fields>(fields: F) => Schema.Struct({ ...fields, hint: opt(Str) })
/** A page's route, with its clickable `url` while a server for the checkout runs. */
export const Route = { route: Str, url: opt(Str) }
/** A route that is null when the page's subject is not in this checkout. */
export const RouteOrNull = { route: Nullable(Str), url: opt(Str) }
/** A route present only when the page's subject is in this checkout. */
export const MaybeRoute = { route: opt(Str), url: opt(Str) }
/**
 * A record under .catalog as a result carries it. Records are read open (a newer toolkit may have
 * added fields), so beside the fields its schema names a record keeps any others it holds.
 */
export const OpenRecord = <F extends Schema.Struct.Fields>(fields: F) => Schema.StructWithRest(Schema.Struct(fields), [Open])

/** The envelope of a paged list or search: `<entities>` beside these. */
export const Paging = { total: Num, page: Num, pages: Num, pageSize: Num }

export const Actor = Schema.Struct({ name: Str, kind: Schema.Literals(["human", "agent"]) })
export const Checkout = Schema.Struct({ root: Str, name: Str, git: Bool, branch: Nullable(Str), head: Nullable(Str), detached: Bool, worktree: Str, key: Str })
/** Something the catalog could not use: where it comes from (`origin`) and what it is about (`subject`, a path or a unit id). */
export const Problem = Schema.Struct({ origin: Schema.Literals(["project", "sources", "records"]), subject: Str, error: Str, recovery: Nullable(Str) })
const ReviewState = Schema.Literals(["none", "undecided", "approved", "partial", "changes", "rejected", "mixed"])
export const Rollup = Schema.Struct({ total: Num, approved: Num, changes: Num, rejected: Num, undecided: Num, changed: Num, state: ReviewState })
export const Relay = Schema.Struct({ by: Str, channel: Str, words: Str })

export const AssetRef = Schema.Struct({
  id: Str,
  path: Str,
  kind: Nullable(Str),
  state: Schema.Literals(["ok", "missing", "invalid", "unsupported", "forbidden"]),
  error: Nullable(Str),
  sha256: Nullable(Str),
  version: Nullable(Str),
  size: Nullable(Num),
  mime: Nullable(Str),
  url: Nullable(Str)
})

// ---- Project schema

const DisplayDef = Schema.Struct({ pixelArt: Bool })
export const RoleDef = Schema.Struct({ key: Str, label: Str, mediaKinds: Strings, many: Bool, expected: Bool, help: Nullable(Str) })
const FieldDef = Schema.Struct({ key: Str, label: Str, kind: Str, unit: Nullable(Str), help: Nullable(Str), group: Nullable(Str), filter: Bool, derived: Bool, summary: Bool })
const MountFields = { key: Str, label: Str, module: Str, export: Str, help: Nullable(Str) }
const MountDef = Schema.Struct(MountFields)
const InspectorDef = Schema.Struct({ ...MountFields, default: Bool })
export const TypeDef = Schema.Struct({
  scope: Str,
  label: Str,
  roles: Schema.Array(RoleDef),
  fields: Schema.Array(FieldDef),
  thumb: Nullable(Str),
  help: Nullable(Str),
  audioTranscript: Schema.Unknown,
  reviewAttributes: Bool,
  inspectors: Schema.Array(InspectorDef),
  panels: Schema.Array(MountDef),
  display: Nullable(DisplayDef)
})
const CollectionKind = Schema.Struct({
  label: Str,
  preview: Nullable(Schema.Struct({ label: opt(Str), module: opt(Str), roles: opt(Strings), base: opt(Str), config: opt(Open), represents: opt(Str) })),
  memberField: Nullable(Str),
  memberExtra: Nullable(Schema.Struct({ key: opt(Str), format: opt(Schema.Literals(["count", "text"])) }))
})
/** Where a declared browser module loads from, or why it cannot. */
const ModuleAddress = { url: Nullable(Str), error: Nullable(Str) }

export const ProjectSchema = Schema.Struct({
  version: Str,
  project: Nullable(Str),
  schema: Schema.Struct({ types: Schema.Record(Str, TypeDef), collectionKinds: Schema.Record(Str, CollectionKind) }),
  scopes: Schema.Array(Schema.Struct({ id: Str, label: Str, description: Str })),
  mediaKinds: Schema.Record(Str, Schema.Struct({ label: Str, extensions: Strings, web: Nullable(Str), webError: opt(Str) })),
  relations: Schema.Array(Schema.Struct({ name: Str, label: Str, inverseLabel: Str })),
  probes: Schema.Array(Schema.Struct({ name: Str, plugin: Str, version: Str, mediaKinds: Strings, fields: Schema.Array(Schema.Struct({ key: Str, label: Str, unit: opt(Str) })) })),
  browserModules: Schema.Record(Str, Nullable(Str)).annotate({ description: "Each declared browser module's address (/project/module/<name>?v=<digest>), or null when its file is missing" }),
  display: DisplayDef,
  unitScopes: Schema.Record(Str, Str)
})

// ---- Reviews

/** One decision as results show it. */
export const DecisionSummary = Schema.Struct({
  id: Str,
  submission: Str,
  ref: Nullable(Str),
  item: Str,
  by: Actor,
  at: Str,
  covers: Schema.Literals(["whole", "parts"]),
  verdicts: Schema.Record(Str, Str),
  comment: Str,
  partComments: Schema.Record(Str, Str),
  relay: opt(Relay),
  revision: Num.annotate({ description: "Pass as expectedRevision to review.decision.edit or review.decision.delete" }),
  editedAt: opt(Str),
  editedBy: opt(Actor)
})
/** A content part with its current verdict and the decision that gave it. */
export const PartReview = Schema.Struct({
  id: Str,
  label: Str,
  role: opt(Str),
  asset: opt(Str),
  member: opt(Str),
  reviewable: Bool,
  verdict: Nullable(Str),
  decision: Nullable(DecisionSummary),
  changed: Bool
})
export const TargetReview = Schema.Struct({ parts: Schema.Array(PartReview), summary: Rollup })
const ReviewStatus = Schema.Struct({ state: ReviewState, summary: Rollup, parts: Schema.Array(Schema.Struct({ id: Str, label: Str, verdict: Nullable(Str), changed: Bool })) })
/** Decisions on a unit or collection, each with the content parts that changed since. */
export const History = Schema.Struct({ ...DecisionSummary.fields, title: Str, partLabels: Schema.Record(Str, Str), changedParts: Strings })
/** Submission items on a unit or collection that still have undecided parts. */
export const OpenItem = Schema.Struct({ submission: Str, ref: Str, title: Str, item: Str, state: Rollup })

const ItemTarget = Schema.Struct({ kind: Schema.Literals(["unit", "collection"]), id: Str })
const ItemHeaderFields = {
  id: Str,
  target: Nullable(ItemTarget),
  targetScope: Nullable(Str),
  targetType: Nullable(Str),
  title: Str,
  text: Nullable(Str),
  targetExists: Nullable(Bool),
  state: ReviewState,
  summary: Rollup
}
const SubmissionFields = {
  id: Str,
  ref: Str,
  ...Route,
  title: Str,
  by: Actor,
  at: Str,
  checkout: Schema.Struct({ branch: opt(Nullable(Str)), head: opt(Nullable(Str)), dirty: opt(Nullable(Num)) }),
  supersedes: Nullable(Str),
  ask: Nullable(Str),
  brief: Nullable(Str),
  changes: Nullable(Str),
  limits: Nullable(Str),
  counts: Schema.Struct({ items: Num, waiting: Num, approved: Num, changes: Num, rejected: Num })
}
/** A submission with each item's state and counts, without evidence. */
export const SubmissionView = Schema.Struct({ ...SubmissionFields, items: Schema.Array(Schema.Struct(ItemHeaderFields)) })

const ItemPart = Schema.Struct({
  id: Str,
  label: Str,
  reviewable: Bool,
  verdict: Nullable(Str),
  decision: Nullable(DecisionSummary),
  role: opt(Str),
  member: opt(Str),
  asset: opt(Str),
  renderer: opt(Str),
  shows: opt(Nullable(Str)),
  pairLabels: opt(Strings),
  evidence: Schema.Struct({
    digest: Str,
    asset: Nullable(Str),
    path: Nullable(Str),
    kind: Nullable(Str),
    mime: Nullable(Str),
    size: Nullable(Num),
    sha256: Nullable(Str),
    storage: Nullable(Schema.Literals(["git", "catalog"])),
    unit: Nullable(Str)
  }),
  leaves: Schema.Array(Open).annotate({ description: "Each frozen byte stream or attribute set of the part with its verified status and media URL" })
})
/** One submission in full: items with frozen parts, their evidence status and views. */
export const SubmissionDetailFields = {
  ...SubmissionFields,
  items: Schema.Array(Schema.Struct({
    ...ItemHeaderFields,
    parts: Schema.Array(ItemPart),
    views: Schema.Array(Open).annotate({ description: "Captioned views of the item's parts, with a verified before side when they have one" }),
    attributes: Schema.Unknown,
    kind: opt(Schema.Literals(["unit", "collection", "work"])),
    preview: Nullable(Open)
  }))
}

// ---- Notes, summaries, organization

export const NoteView = OpenRecord({ ...NoteRecord.fields, targetName: Str, targetExists: Bool, partLabel: Nullable(Str), viewLabel: Nullable(Str), thumb: Nullable(AssetRef), ...RouteOrNull })

export const Organization = Schema.Struct({
  category: Nullable(Str),
  tags: Strings,
  projectTags: Strings,
  projectCategory: Nullable(Str),
  revision: Nullable(Num),
  owner: opt(Schema.Literals(["project", "catalog"]))
})

const RoleShown = { key: Str, label: Str, kind: opt(Str) }
export const UnitSummaryFields = {
  id: Str,
  scope: Str,
  name: Str,
  type: Str,
  typeLabel: Str,
  thumb: Nullable(AssetRef),
  roles: Schema.Array(Schema.Struct({ ...RoleShown, shared: Bool })),
  missing: Schema.Array(Schema.Struct(RoleShown)),
  attrsPreview: Nullable(Schema.Array(Schema.Struct({ label: Str, value: Str }))),
  status: ReviewStatus,
  notes: Num,
  category: Nullable(Str),
  tags: Strings
}
export const CollectionSummaryFields = {
  id: Str,
  name: Str,
  kind: Nullable(Str),
  kindLabel: Nullable(Str),
  owner: Schema.Literals(["project", "catalog"]),
  category: Nullable(Str),
  tags: Strings,
  memberCount: Num,
  thumbs: Schema.Array(Schema.Struct({ unit: Str, name: Str, typeLabel: Str, thumb: Nullable(AssetRef) })),
  status: ReviewStatus,
  notes: Num
}
export const AssetSummaryFields = { ...AssetRef.fields, label: Nullable(Str), usedBy: Num, roles: Strings, notes: Num, category: Nullable(Str), tags: Strings }

/** Why a search hit matched: the member that made a collection match. */
const Match = { match: Nullable(Schema.Struct({ member: opt(Nullable(Schema.Struct({ id: Str, name: Str }))) })) }
export const Facets = Schema.Record(Str, Schema.Struct({
  label: Str,
  tree: Bool,
  values: Schema.Array(Schema.Struct({ value: Str, label: Str, count: Num, selected: Bool }))
}))
/** What every search returns beside its entities. */
export const SearchFields = { ...Paging, q: Str, filters: Schema.Record(Str, Strings), all: Num, facets: Facets, ids: Strings }
export const UnitHit = Schema.Struct({ ...UnitSummaryFields, ...Match })
export const CollectionHit = Schema.Struct({ ...CollectionSummaryFields, ...Match })
export const AssetHit = Schema.Struct({ ...AssetSummaryFields, ...Match })

export const UnitRef = Schema.Struct({ id: Str, name: Str, exists: Bool, thumb: Nullable(AssetRef) })

// ---- Detail reads

export const UnitDetail = Linked({
  ...Route,
  unit: Schema.Struct({ id: Str, scope: Str, name: Str, type: Str, attrs: Open, aliases: Strings, sources: Strings, explain: Open }),
  type: TypeDef,
  organization: Organization,
  tags: Strings,
  links: Schema.Array(Schema.Struct({
    role: Str,
    roleLabel: Str,
    asset: AssetRef,
    alsoUsedBy: Schema.Array(Schema.Struct({ unit: Str, role: Str, name: opt(Str), roleLabel: Str })),
    key: opt(Str),
    meta: Nullable(Open),
    facts: Schema.Record(Str, Open).annotate({ description: "Probe name to { facts } or { error }" })
  })),
  missing: Schema.Array(RoleDef),
  review: TargetReview,
  history: Schema.Array(History),
  memberships: Schema.Array(Schema.Struct({ id: Str, name: Str, category: Nullable(Str), verdict: Nullable(Str), position: Num, count: Num })),
  notes: Schema.Array(NoteView),
  refs: Schema.Record(Str, Schema.Array(UnitRef)),
  relations: Schema.Array(Schema.Struct({ name: Str, direction: Schema.Literals(["out", "in"]), label: Str, units: Schema.Array(UnitRef) })),
  waiting: Schema.Array(OpenItem),
  inspectors: Schema.Array(Schema.Struct({ ...InspectorDef.fields, ...ModuleAddress })),
  panels: Schema.Array(Schema.Struct({ ...MountFields, ...ModuleAddress })),
  display: DisplayDef
})

export const CollectionDetail = Linked({
  ...Route,
  collection: Schema.Struct({ id: Str, name: Str, kind: Nullable(Str), kindLabel: Nullable(Str), owner: Schema.Literals(["project", "catalog"]), revision: Nullable(Num), createdBy: Nullable(Actor) }),
  organization: Organization,
  tags: Strings,
  members: Schema.Array(Schema.Union([
    Schema.Struct({ id: Str, name: Str, missingTarget: Schema.Literal(true), position: Num }),
    Schema.Struct({ ...UnitSummaryFields, position: Num, extra: Schema.Unknown, inCollection: Nullable(PartReview) })
  ])),
  preview: Nullable(Schema.Struct({
    label: Str,
    module: Str,
    moduleUrl: Nullable(Str),
    moduleError: Nullable(Str),
    represents: Str,
    config: Open,
    roles: Strings,
    base: Nullable(Schema.Union([AssetRef, Schema.Struct({ id: Str, state: Schema.Literal("missing"), error: Str })])),
    members: Schema.Array(Schema.Struct({ unit: Str, part: Str, role: Str, asset: AssetRef }))
  })),
  review: TargetReview,
  history: Schema.Array(History),
  notes: Schema.Array(NoteView),
  waiting: Schema.Array(OpenItem)
})

const Target = Schema.Struct({ kind: Str, id: Str })
export const AssetDetail = Linked({
  ...Route,
  asset: Schema.Struct({ ...AssetRef.fields, label: Nullable(Str) }),
  organization: Organization,
  tags: Strings,
  usage: Schema.Array(Schema.Struct({ unit: Str, name: Str, typeLabel: Str, role: Str, roleLabel: Str, part: Str, thumb: Nullable(AssetRef) })),
  versions: Schema.Array(Schema.Union([
    Schema.Struct({ sha256: Str, size: Nullable(Num), current: Schema.Literal(true) }),
    Schema.Struct({
      sha256: Str,
      size: opt(Num),
      firstSeen: Str,
      submissions: Schema.Array(Schema.Struct({ submission: Str, ref: Str, item: Str, part: Str, leaf: Str, url: Str }))
    })
  ])),
  verdicts: Schema.Array(Schema.Struct({
    decision: Str,
    submission: Str,
    ref: Str,
    item: Str,
    part: Str,
    partLabel: Str,
    target: Nullable(Target),
    targetName: Str,
    verdict: Str,
    partComment: Str,
    by: Actor,
    at: Str,
    sha256: Str
  })),
  facts: Schema.Record(Str, Open).annotate({ description: "Probe name to { facts } or { error }" }),
  notes: Schema.Array(NoteView)
})
