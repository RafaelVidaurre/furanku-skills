// The built-in actions. Queries and commands live in their own modules; this file is the list
// that names them, describes them and declares their inputs.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { fail } from "../kernel/errors.ts"
import { digest } from "../kernel/hash.ts"
import { dirtyCount, Empty, optional, Page, read, refOf, Text, write } from "./action.ts"
import { collectionActions } from "./commands/collections.ts"
import { decideActions } from "./commands/decide.ts"
import { removeAction } from "./commands/remove.ts"
import { noteActions } from "./commands/notes.ts"
import { organizationActions } from "./commands/organization.ts"
import { submitAction } from "./commands/submit.ts"
import { reviseActions } from "./commands/revise.ts"
import { doctor, doctorFix } from "./doctor.ts"
import { Evidence } from "./Evidence.ts"
import { Facts } from "./Facts.ts"
import type { Projection } from "./Projection.ts"
import { compare } from "./queries/compare.ts"
import { assetGet, collectionGet, unitGet } from "./queries/detail.ts"
import { inbox, problemsOf } from "./queries/inbox.ts"
import { noteList } from "./queries/notes.ts"
import { organizationList } from "./queries/organization.ts"
import { reviewGet, reviewList, submissionView } from "./queries/reviews.ts"
import { assetSearch, collectionSearch, unitSearch } from "./queries/search.ts"
import { moduleUrl } from "./queries/summaries.ts"
import { Comparison, FrozenRef } from "./viewerActions.ts"
import { NoteRecord } from "./records/schemas.ts"
import { Records } from "./Records.ts"
import {
  Actor,
  AssetDetail,
  AssetHit,
  Checkout,
  CollectionDetail,
  CollectionHit,
  DecisionSummary,
  Linked,
  MaybeRoute,
  NoteView,
  Paging,
  Problem,
  ProjectSchema,
  Route,
  SearchFields,
  SubmissionDetailFields,
  SubmissionView,
  UnitDetail,
  UnitHit,
  Written
} from "./results.ts"


const counts = (p: Projection) => ({
  units: p.snapshot.units.length,
  collections: p.collections.length,
  assets: p.snapshot.assets.length,
  openNotes: p.records.note.filter((note) => !note.resolved).length,
  submissions: p.records.submission.length,
  waiting: p.records.submission.filter((submission) => submissionView(p, submission).counts.waiting > 0).length
})

/**
 * Where the browser loads a media kind's module from: the declared file, by kind id, versioned by
 * its bytes. A kind without one is shown by the page's built-in viewers or as a plain file.
 */
const kindModuleOf = (p: Projection, kind: string): { web: string | null; webError?: string } => {
  if (!p.kindModules.has(kind)) return { web: null }
  const digest = p.kindModules.get(kind) ?? null
  return digest === null
    ? { web: null, webError: `the browser module of media kind ${kind} is declared but its file is missing` }
    : { web: `/project/kind/${encodeURIComponent(kind)}?v=${digest.slice(0, 16)}` }
}

/**
 * What a client keys its copy of `schema` by: the sources and media as loaded, plus the browser
 * modules plugins declare (their addresses are part of the schema).
 */
const versionOf = (p: Projection): string =>
  p.kindModules.size + p.browserModules.size === 0 && !p.plugins.config.display.pixelArt
    ? p.snapshot.version
    : `${p.snapshot.version}${digest([[...p.kindModules], [...p.browserModules], p.plugins.config.display]).slice(0, 4)}`

/** What rarely changes and is large: clients fetch it once per `version`, not with every poll. */
const describeProject = (p: Projection) => ({
  version: versionOf(p),
  project: p.snapshot.project,
  schema: p.snapshot.schema,
  scopes: p.plugins.scopes,
  mediaKinds: Object.fromEntries(p.plugins.mediaKinds.map((kind) => [kind.id, { label: kind.label, extensions: kind.extensions, ...kindModuleOf(p, kind.id) }])),
  relations: p.plugins.relations.map((relation) => ({ name: relation.name, label: relation.label, inverseLabel: relation.inverseLabel })),
  probes: p.plugins.probes.map(({ plugin, value }) => ({ name: value.name, plugin, version: value.version, mediaKinds: value.mediaKinds, fields: value.fields ?? [] })),
  // Where each declared browser module (inspectors, panels, previews) loads from; null when its file is missing.
  browserModules: Object.fromEntries([...p.browserModules].map(([name, sha256]) => [name, sha256 === null ? null : moduleUrl(name, sha256)])),
  // For types without a display of their own.
  display: p.plugins.config.display,
  unitScopes: Object.fromEntries(p.snapshot.units.map((unit) => [unit.id, unit.scope]))
})

// ---- Inputs and outputs (exported for the typed action map, `actionMap.ts`)

const Counts = Schema.Struct({ units: Schema.Number, collections: Schema.Number, assets: Schema.Number, openNotes: Schema.Number, submissions: Schema.Number, waiting: Schema.Number })
export const SummaryOutput = Schema.Struct({
  project: Schema.String,
  plugins: Schema.Array(Schema.String),
  actor: Schema.String,
  checkout: Checkout,
  version: Schema.String,
  records: Schema.String,
  counts: Counts,
  problems: Schema.Number,
  resolver: Schema.String,
  verdicts: Schema.Array(Schema.String)
})
export const CheckoutOutput = Schema.Struct({ checkout: Schema.Struct({ ...Checkout.fields, dirty: Schema.Number }) })
export const ProblemsOutput = Schema.Struct({ problems: Schema.Array(Problem) })
export const InboxInput = Schema.Struct({ limit: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))).annotate({ description: "Most entries per list (default 50)" }) })
export const InboxOutput = Linked({
  counts: Schema.Struct({ waiting: Schema.Number, notes: Schema.Number, changed: Schema.Number, problems: Schema.Number }),
  waiting: Schema.Array(Schema.Struct({ submission: Schema.String, ref: Schema.String, title: Schema.String, by: Actor, at: Schema.String, waiting: Schema.Number, items: Schema.Number, ...Route })),
  notes: Schema.Array(Schema.Struct({
    id: Schema.String,
    target: NoteRecord.fields.target,
    targetName: Schema.String,
    targetExists: Schema.Boolean,
    partLabel: Schema.NullOr(Schema.String),
    body: Schema.String,
    by: Actor,
    at: Schema.String,
    ...MaybeRoute
  })),
  changed: Schema.Array(Schema.Struct({
    target: Schema.Struct({ kind: Schema.String, id: Schema.String }),
    ...MaybeRoute,
    name: Schema.String,
    parts: Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String, verdict: Schema.NullOr(Schema.String), submission: Schema.NullOr(Schema.String), ref: Schema.NullOr(Schema.String) }))
  })),
  problems: Schema.Array(Problem)
})
export const DoctorInput = Schema.Struct({ fix: optional(Schema.Boolean).annotate({ description: "Refused when true: a read cannot repair. Use doctor.fix" }) })
const DoctorFields = {
  ok: Schema.Boolean,
  summary: Schema.Struct({ problems: Schema.Number, info: Schema.Number, fixable: Schema.Number, fixed: Schema.Number }),
  checks: Schema.Array(Schema.Struct({
    name: Schema.String,
    label: Schema.String,
    plugin: Schema.String,
    problems: Schema.Array(Schema.Struct({ message: Schema.String, subject: Schema.NullOr(Schema.String), severity: Schema.Literals(["problem", "info"]), fix: Schema.NullOr(Schema.String), fixable: Schema.Boolean }))
  })),
  fixed: Schema.Array(Schema.Struct({ check: Schema.String, subject: Schema.NullOr(Schema.String), fix: Schema.String, error: Schema.NullOr(Schema.String) }))
}
export const DoctorOutput = Schema.Struct(DoctorFields)
export const DoctorFixOutput = Written(DoctorFields)

const SearchText = {
  q: optional(Schema.String),
  filters: optional(Schema.Record(Schema.String, Schema.Array(Schema.String))).annotate({ description: "Facet key to selected values" }),
  ids: optional(Schema.Boolean).annotate({ description: "false: answer with an empty ids list (counts and pages only)" }),
  ...Page
}
export const UnitSearchInput = Schema.Struct({ scope: optional(Schema.String).annotate({ description: "A scope id (see schema)" }), ...SearchText })
export const UnitSearchOutput = Schema.Struct({ units: Schema.Array(UnitHit), scope: Schema.NullOr(Schema.String), ...SearchFields })
export const CollectionSearchInput = Schema.Struct({ scope: optional(Schema.String).annotate({ description: "A scope id (see schema): collections with a member in it" }), ...SearchText })
export const CollectionSearchOutput = Schema.Struct({ collections: Schema.Array(CollectionHit), scope: Schema.NullOr(Schema.String), ...SearchFields })
export const AssetSearchInput = Schema.Struct(SearchText)
export const AssetSearchOutput = Schema.Struct({ assets: Schema.Array(AssetHit), ...SearchFields })

export const IdInput = Schema.Struct({ id: Text })
export const OrganizationListOutput = Schema.Struct({
  categories: Schema.Array(Schema.Struct({ path: Schema.String, units: Schema.Number, collections: Schema.Number, assets: Schema.Number })),
  tags: Schema.Array(Schema.Struct({ tag: Schema.String, projectOwned: Schema.Boolean, units: Schema.Number, collections: Schema.Number, assets: Schema.Number }))
})
export const NoteListInput = Schema.Struct({
  state: optional(Schema.Literals(["open", "resolved", "all"])),
  targetKind: optional(Schema.String),
  target: optional(refOf(["unit", "collection", "asset", "submission"], { item: true, part: true })),
  by: optional(Schema.String),
  q: optional(Schema.String),
  ...Page
})
export const NoteListOutput = Linked({
  notes: Schema.Array(NoteView),
  ...Paging,
  counts: Schema.Struct({ open: Schema.Number, resolved: Schema.Number, all: Schema.Number }),
  authors: Schema.Array(Schema.String)
})
export const ReviewListInput = Schema.Struct({ state: optional(Schema.Literals(["all", "waiting", "changes", "rejected", "approved"])), q: optional(Schema.String), ...Page, target: optional(refOf(["unit", "collection"])) })
export const ReviewListOutput = Linked({
  submissions: Schema.Array(SubmissionView),
  ...Paging,
  counts: Schema.Struct({ all: Schema.Number, waiting: Schema.Number, changes: Schema.Number, rejected: Schema.Number, approved: Schema.Number })
})
export const ReviewGetInput = Schema.Struct({ submission: Text })
export const ReviewGetOutput = Linked({
  ...SubmissionDetailFields,
  decisions: Schema.Array(DecisionSummary),
  observations: Schema.Array(NoteView),
  supersededBy: Schema.Array(Schema.Struct({ id: Schema.String, ref: Schema.String }))
})
export const EvidenceCompareInput = Comparison
const Side = Schema.Struct({
  status: Schema.String,
  error: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.optional(Schema.NullOr(Schema.String)),
  sha256: Schema.optional(Schema.NullOr(Schema.String)),
  digest: Schema.optional(Schema.String),
  mime: Schema.optional(Schema.NullOr(Schema.String)),
  size: Schema.optional(Schema.NullOr(Schema.Number)),
  asset: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  attrs: Schema.optional(Schema.Unknown),
  crop: Schema.optional(Schema.Tuple([Schema.Int, Schema.Int, Schema.Int, Schema.Int])),
  sheet: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({ description: "How this side's image is cut into animation frames, when it is shown as an animation" })
})
const ComparedPart = Schema.Struct({ ...FrozenRef.fields, label: Schema.String })
export const EvidenceCompareOutput = Schema.Struct({
  title: Schema.String,
  a: ComparedPart,
  b: Schema.Union([Schema.Literal("current"), ComparedPart]),
  rows: Schema.Array(Schema.Struct({ key: Schema.String, label: Schema.String, a: Side, b: Side, identical: Schema.Boolean })),
  identical: Schema.Boolean
})
export const LockListOutput = Schema.Struct({
  locks: Schema.Array(Schema.Struct({
    file: Schema.String,
    name: Schema.optional(Schema.String),
    pid: Schema.optional(Schema.Number),
    host: Schema.optional(Schema.String),
    at: Schema.optional(Schema.String),
    alive: Schema.NullOr(Schema.Boolean)
  }))
})
export const LockRemoveInput = Schema.Struct({ lock: Text })
export const LockRemoveOutput = Written({ removed: Schema.String })

const reads = [
  read("summary", "Project, checkout, counts and problem count. Cheap enough to poll: no file status, no schema", Empty, SummaryOutput, (_input, env) =>
    Effect.map(env.currentCheckout, (checkout) => {
      const p = env.projection
      return {
        project: p.snapshot.project ?? checkout.name,
        plugins: p.plugins.names,
        actor: env.defaultActor.name,
        checkout,
        version: versionOf(p),
        records: p.records.signature.slice(0, 12),
        counts: counts(p),
        problems: problemsOf(p).length,
        resolver: p.policy.resolverName,
        verdicts: p.policy.verdicts
      }
    })),
  read("schema", "Types, collection kinds, scopes, media kinds, relations, probes, view modules and display policy of this project; changes only when `version` does", Empty, ProjectSchema, (_input, env) =>
    Effect.succeed(describeProject(env.projection))),
  read("checkout", "The checkout with its count of uncommitted changes outside .catalog (runs git status)", Empty, CheckoutOutput, (_input, env) =>
    Effect.gen(function*() {
      return { checkout: { ...(yield* env.currentCheckout), dirty: yield* dirtyCount } }
    })),
  read("problems", "Unreadable sources, plugin failures and malformed or conflicted records", Empty, ProblemsOutput, (_input, env) => Effect.succeed({ problems: problemsOf(env.projection) })),
  read(
    "inbox",
    "What is waiting on someone: reviews with undecided parts, open notes, parts changed since their verdict, problems",
    InboxInput,
    InboxOutput,
    (input, env) => Effect.succeed(inbox(env.projection, input.limit ?? 50))
  ),
  read(
    "doctor",
    "Run every check (media, Git LFS pointers, unlinked files, waiting reviews, plugin checks) and report; changes nothing. Repairs are applied by doctor.fix",
    DoctorInput,
    DoctorOutput,
    (input, env) =>
      input.fix === true
        ? fail("invalid", "doctor only reads and cannot fix; repairs are applied by the write action doctor.fix", { fix: "run `jam catalog doctor --fix`, or the action doctor.fix with an actor" })
        : doctor(env)
  ),
  read("unit.search", "Search and filter units with facet counts and bounded pages", UnitSearchInput, UnitSearchOutput, (input, env) => unitSearch(env.projection, input)),
  read("collection.search", "Search and filter collections with facet counts and bounded pages", CollectionSearchInput, CollectionSearchOutput, (input, env) => collectionSearch(env.projection, input)),
  read("asset.search", "Search and filter media assets with facet counts and bounded pages", AssetSearchInput, AssetSearchOutput, (input, env) => assetSearch(env.projection, input)),
  read("unit.get", "Inspect one unit: attributes, linked assets, relations, review projection, notes, memberships, inspectors", IdInput, UnitDetail, (input, env) =>
    Effect.flatMap(Facts, (facts) => unitGet(env.projection, facts, input.id))),
  read("collection.get", "Inspect one collection: members, preview, review projection, notes", IdInput, CollectionDetail, (input, env) => collectionGet(env.projection, input.id)),
  read("asset.get", "Inspect one media asset: usage, versions, verdicts referencing it, measured facts, notes", IdInput, AssetDetail, (input, env) =>
    Effect.flatMap(Facts, (facts) => assetGet(env.projection, facts, input.id))),
  read("organization.list", "Categories and tags with usage counts", Empty, OrganizationListOutput, (_input, env) => Effect.succeed(organizationList(env.projection))),
  read("note.list", "List notes; state open (default), resolved or all; optional target filter", NoteListInput, NoteListOutput, (input, env) => Effect.succeed(noteList(env.projection, input))),
  read(
    "review.list",
    "Review submissions with item counts (waiting, approved, changes, rejected); optional target filter",
    ReviewListInput,
    ReviewListOutput,
    (input, env) => Effect.succeed(reviewList(env.projection, input))
  ),
  read("review.get", "One submission by id or short reference: items, parts, views, verdict projection, decisions, observations", ReviewGetInput, ReviewGetOutput, (input, env) =>
    Effect.flatMap(Evidence, (evidence) => reviewGet(env.projection, evidence, input.submission))),
  read(
    "evidence.compare",
    "Compare frozen evidence of a part with current content or another frozen part; each side resolves independently",
    EvidenceCompareInput,
    EvidenceCompareOutput,
    (input, env) => Effect.flatMap(Evidence, (evidence) => compare(env.projection, evidence, input.a, input.b))
  ),
  read("lock.list", "Record locks held on this machine", Empty, LockListOutput, () => Effect.map(Effect.flatMap(Records, (records) => records.locks), (locks) => ({ locks })))
]

const lockRemove = write("lock.remove", "Remove a lock whose owning process has exited on this machine", LockRemoveInput, LockRemoveOutput, null, (input) =>
  Effect.flatMap(Records, (records) => records.unlock(input.lock)))

// One repair run at a time: fixes act on project files, outside the record locks.
const doctorFixAction = write("doctor.fix", "Apply the repairs that checks declare (for example fetching Git LFS files), then check again and report what is still wrong", Empty, DoctorFixOutput, "doctor", (_input, env) => doctorFix(env))

/** Every built-in action. Not annotated, so each keeps its name and schemas for `actionMap.ts`. */
export const builtinActions = [...reads, ...collectionActions, ...noteActions, ...organizationActions, submitAction, ...reviseActions, ...decideActions, removeAction, lockRemove, doctorFixAction]
