// The built-in actions. Queries and commands live in their own modules; this file is the list
// that names them, describes them and declares their inputs.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { fail } from "../kernel/errors.ts"
import { digest } from "../kernel/hash.ts"
import { type ActionDef, dirtyCount, Empty, optional, Page, read, targetOf, Text, UnitOrCollection, write } from "./action.ts"
import { collectionActions } from "./commands/collections.ts"
import { decideActions } from "./commands/decide.ts"
import { noteActions } from "./commands/notes.ts"
import { organizationActions } from "./commands/organization.ts"
import { submitAction } from "./commands/submit.ts"
import { doctor, doctorFix } from "./doctor.ts"
import { Evidence } from "./Evidence.ts"
import { Facts } from "./Facts.ts"
import type { Projection } from "./Projection.ts"
import { compare } from "./queries/compare.ts"
import { assetGet, collectionGet, unitGet } from "./queries/detail.ts"
import { inbox, problemsOf } from "./queries/inbox.ts"
import { notesList } from "./queries/notes.ts"
import { organizationList } from "./queries/organization.ts"
import { reviewGet, reviewsList, submissionView } from "./queries/reviews.ts"
import { search } from "./queries/search.ts"
import { Records } from "./Records.ts"

const FrozenRef = Schema.Struct({ submission: Text, item: Text, part: Text })

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
  p.kindModules.size + p.previewModules.size === 0 ? p.snapshot.version : `${p.snapshot.version}${digest([[...p.kindModules], [...p.previewModules]]).slice(0, 4)}`

/** What rarely changes and is large: clients fetch it once per `version`, not with every poll. */
const describeProject = (p: Projection) => ({
  version: versionOf(p),
  project: p.snapshot.project,
  schema: p.snapshot.schema,
  scopes: p.plugins.scopes,
  mediaKinds: Object.fromEntries(p.plugins.mediaKinds.map((kind) => [kind.id, { label: kind.label, extensions: kind.extensions, ...kindModuleOf(p, kind.id) }])),
  relations: p.plugins.relations.map((relation) => ({ name: relation.name, label: relation.label, inverseLabel: relation.inverseLabel })),
  probes: p.plugins.probes.map(({ plugin, value }) => ({ name: value.name, plugin, version: value.version, kinds: value.kinds, fields: value.fields ?? [] })),
  previews: Object.keys(p.plugins.previews),
  unitScopes: Object.fromEntries(p.snapshot.units.map((unit) => [unit.id, unit.scope]))
})

const reads: ReadonlyArray<ActionDef> = [
  read("context", "Project, checkout, counts and problem count. Cheap enough to poll: no file status, no schema", Empty, (_input, env) =>
    Effect.map(env.currentCheckout, (checkout) => {
      const p = env.projection
      return {
        project: p.snapshot.project ?? checkout.name,
        plugins: p.plugins.names,
        actor: env.defaultActor.name,
        context: checkout,
        version: versionOf(p),
        records: p.records.signature.slice(0, 12),
        counts: counts(p),
        problems: problemsOf(p).length,
        resolver: p.policy.resolverName,
        verdicts: p.policy.verdicts
      }
    })),
  read("schema", "Types, collection kinds, scopes, media kinds, relations and probes of this project; changes only when `version` does", Empty, (_input, env) =>
    Effect.succeed(describeProject(env.projection))),
  read("checkout", "The checkout with its count of uncommitted changes outside .catalog (runs git status)", Empty, (_input, env) =>
    Effect.gen(function*() {
      return { context: { ...(yield* env.currentCheckout), dirty: yield* dirtyCount } }
    })),
  read("problems", "Unreadable sources, plugin failures and malformed or conflicted records", Empty, (_input, env) => Effect.succeed({ problems: problemsOf(env.projection) })),
  read(
    "inbox",
    "What is waiting on someone: reviews with undecided parts, open notes, parts changed since their verdict, problems",
    Schema.Struct({ limit: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))).annotate({ description: "Most entries per list (default 50)" }) }),
    (input, env) => Effect.succeed(inbox(env.projection, input.limit ?? 50))
  ),
  read(
    "doctor",
    "Run every check (media, Git LFS pointers, unlinked files, waiting reviews, plugin checks) and report; changes nothing. Repairs are applied by doctor.fix",
    Schema.Struct({ fix: optional(Schema.Boolean).annotate({ description: "Refused when true: a read cannot repair. Use doctor.fix" }) }),
    (input, env) =>
      input.fix === true
        ? fail("invalid", "doctor only reads and cannot fix; repairs are applied by the write action doctor.fix", { fix: "run `jam catalog doctor --fix`, or the action doctor.fix with an actor" })
        : doctor(env)
  ),
  read(
    "catalog.search",
    "Search and filter units, collections or assets with facet counts and bounded pages",
    Schema.Struct({
      section: optional(Schema.Literals(["units", "collections", "assets"])),
      scope: optional(Schema.String).annotate({ description: "A scope id (see schema); units only" }),
      q: optional(Schema.String),
      filters: optional(Schema.Record(Schema.String, Schema.Array(Schema.String))).annotate({ description: "Facet key to selected values" }),
      ...Page
    }),
    (input, env) => search(env.projection, input)
  ),
  read("unit.get", "Inspect one catalog entry: attributes, visuals, relations, review projection, notes, memberships", Schema.Struct({ id: Text }), (input, env) =>
    Effect.flatMap(Facts, (facts) => unitGet(env.projection, facts, input.id))),
  read("collection.get", "Inspect one collection: members, preview, review projection, notes", Schema.Struct({ id: Text }), (input, env) => collectionGet(env.projection, input.id)),
  read("asset.get", "Inspect one media asset: usage, versions, verdicts referencing it, measured facts, notes", Schema.Struct({ id: Text }), (input, env) =>
    Effect.flatMap(Facts, (facts) => assetGet(env.projection, facts, input.id))),
  read("organization.list", "Categories and tags with usage counts", Empty, (_input, env) => Effect.succeed(organizationList(env.projection))),
  read(
    "notes.list",
    "List notes; state open (default), resolved or all; optional target filter",
    Schema.Struct({
      state: optional(Schema.Literals(["open", "resolved", "all"])),
      targetKind: optional(Schema.String),
      target: optional(targetOf(["unit", "collection", "asset", "submission"])),
      by: optional(Schema.String),
      q: optional(Schema.String),
      ...Page
    }),
    (input, env) => Effect.succeed(notesList(env.projection, input))
  ),
  read(
    "reviews.list",
    "Review submissions with item counts (waiting, approved, changes, rejected); optional target filter",
    Schema.Struct({ state: optional(Schema.Literals(["all", "waiting", "changes", "rejected", "approved"])), q: optional(Schema.String), ...Page, target: optional(UnitOrCollection) }),
    (input, env) => Effect.succeed(reviewsList(env.projection, input))
  ),
  read("review.get", "One submission by id or short reference: items, parts, views, verdict projection, events, observations", Schema.Struct({ submission: Text }), (input, env) =>
    Effect.flatMap(Evidence, (evidence) => reviewGet(env.projection, evidence, input.submission))),
  read(
    "evidence.compare",
    "Compare frozen evidence of a part with current content or another frozen part; each side resolves independently",
    Schema.Struct({ a: FrozenRef, b: optional(Schema.Union([Schema.Literal("current"), FrozenRef])) }),
    (input, env) => Effect.flatMap(Evidence, (evidence) => compare(env.projection, evidence, input.a, input.b))
  ),
  read("locks.list", "Record locks held on this machine", Empty, () => Effect.map(Effect.flatMap(Records, (records) => records.locks), (locks) => ({ locks })))
]

const unlock = write("unlock", "Remove a lock whose owning process has exited on this machine", Schema.Struct({ lock: Text }), null, (input) =>
  Effect.flatMap(Records, (records) => records.unlock(input.lock)))

// One repair run at a time: fixes act on project files, outside the record locks.
const doctorFixAction = write("doctor.fix", "Apply the repairs that checks declare (for example fetching Git LFS files), then check again and report what is still wrong", Empty, "doctor", (_input, env) => doctorFix(env))

export const builtinActions: ReadonlyArray<ActionDef> = [...reads, ...collectionActions, ...noteActions, ...organizationActions, submitAction, ...decideActions, unlock, doctorFixAction]
