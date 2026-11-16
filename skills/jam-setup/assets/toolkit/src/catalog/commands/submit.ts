// Submitting units and collections for review. A submission is validated completely (targets,
// parts, views, media availability) before anything is frozen, and frozen before it is recorded.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { type ActionServices, dirtyCount, optional, priorRequest, Text, UnitOrCollection, write, type WriteEnv } from "../action.ts"
import { assetFiles } from "../assetFiles.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { digest, isNonEmpty } from "../../kernel/hash.ts"
import { Ids, nowIso } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Evidence } from "../Evidence.ts"
import { collectionParts, unitParts } from "../model/parts.ts"
import type { Collection, FrozenPart, FrozenView, LeafEvidence, Part, SubmissionItem, SubmissionRecord, Unit } from "../model/types.ts"
import { factsOf, typeOf } from "../Projection.ts"
import { type PreviewSpec, previewDigest, previewSpec } from "../queries/review.ts"
import { submissionView } from "../queries/reviews.ts"
import { Records } from "../Records.ts"
import { type BeforePlan, freezeBefores, planBefore } from "./before.ts"
import { freezeAsset, freezeDefinition, type FreezeEnv, freezeUnitParts } from "./freeze.ts"

const Vec3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])
const ViewInput = Schema.Struct({
  part: Schema.String.annotate({ description: "A part id of this item" }),
  leaf: optional(Schema.String).annotate({ description: "For a collection member or preview: <unit>/<part>, or base" }),
  caption: optional(Schema.String),
  camera: optional(Schema.Struct({ position: optional(Vec3), target: optional(Vec3) })),
  state: optional(Schema.Struct({
    mode: optional(Schema.Literals(["textured", "clay", "wireframe"])),
    animation: optional(Schema.Struct({ clip: optional(Text), time: optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))), playing: optional(Schema.Boolean) })),
    isolate: optional(Schema.Union([Schema.String, Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))])),
    texture: optional(Text)
  })),
  before: optional(Schema.Struct({
    path: optional(Schema.String).annotate({ description: "A project file under the asset roots" }),
    submission: optional(Schema.String),
    item: optional(Schema.String),
    part: optional(Schema.String),
    leaf: optional(Schema.String),
    label: optional(Schema.String)
  })).annotate({ description: "Show this view against a project file ({path}) or earlier frozen evidence ({submission, item, part, leaf?})" }),
  afterLabel: optional(Schema.String)
})
const ItemInput = Schema.Struct({
  target: UnitOrCollection,
  title: optional(Schema.String),
  parts: optional(Schema.Array(Schema.String)).annotate({ description: "Part ids to submit (default: every reviewable part)" }),
  views: optional(Schema.Array(ViewInput))
})
export const SubmitInput = Schema.Struct({
  title: optional(Schema.String),
  note: optional(Schema.String).annotate({ description: "Markdown shown to the reviewer beside the items" }),
  items: Schema.Array(ItemInput),
  supersedes: optional(Schema.String).annotate({ description: "The submission this one replaces" })
})
type ItemSpec = typeof ItemInput.Type
type ViewSpec = typeof ViewInput.Type

interface Plan {
  readonly spec: ItemSpec
  readonly chosen: ReadonlyArray<Part>
  readonly befores: ReadonlyArray<BeforePlan | null> | undefined
  readonly unit?: Unit
  readonly collection?: Collection
  readonly preview?: PreviewSpec | null
}

type Freezing<A> = Effect.Effect<A, ToolError, ActionServices>

const checkViews = (views: ItemSpec["views"], parts: ReadonlyArray<Part>, leafKeys: (part: string) => ReadonlyArray<string>): Effect.Effect<void, ToolError> =>
  Effect.gen(function*() {
    if (views == null) return
    if (views.length === 0 || views.length > 50) return yield* fail("invalid", "views must be a list of 1-50 views")
    for (const view of views) {
      if (!parts.some((part) => part.id === view.part)) return yield* fail("invalid", `view part ${view.part} is not in this item`)
      if (view.caption != null && view.caption.length > 300) return yield* fail("invalid", "view caption must be text (at most 300 characters)")
      if (view.leaf != null && !leafKeys(view.part).includes(view.leaf)) return yield* fail("invalid", `view leaf ${view.leaf} is not part of ${view.part}`)
      if (view.afterLabel != null && view.before == null) return yield* fail("invalid", "afterLabel needs a before")
    }
  })

const planBefores = (env: FreezeEnv, views: ItemSpec["views"], shownKind: (view: ViewSpec) => string | null): Freezing<ReadonlyArray<BeforePlan | null> | undefined> =>
  views == null
    ? Effect.succeed(undefined)
    : Effect.forEach(views, (view) => (view.before != null ? planBefore(env, { part: view.part, before: view.before, afterLabel: view.afterLabel }, shownKind(view)) : Effect.succeed(null)))

const choose = (name: string, all: ReadonlyArray<Part>, wanted: ItemSpec["parts"]): Effect.Effect<ReadonlyArray<Part>, ToolError> =>
  Effect.gen(function*() {
    for (const id of wanted ?? []) if (!all.some((part) => part.id === id)) return yield* fail("invalid", `${name} has no part ${id}`)
    const chosen = wanted ? all.filter((part) => wanted.includes(part.id)) : all
    return chosen.length > 0 ? chosen : yield* fail("invalid", `no reviewable parts selected for ${name}`)
  })

/** Validate one item request completely, without any effect on the project. */
const planItem = (env: FreezeEnv, spec: ItemSpec): Freezing<Plan> =>
  Effect.gen(function*() {
    const p = env.projection
    const { assetsById, unitsById } = p.snapshot
    if (spec.title != null && spec.title.length > 300) return yield* fail("invalid", "item title must be text")
    const kindOf = (asset: string | undefined): string | null => (asset === undefined ? null : factsOf(p, asset).kind ?? null)
    const available = (asset: string, what: string): Effect.Effect<void, ToolError> => {
      const facts = factsOf(p, asset)
      return facts.state === "ok" ? Effect.void : fail("invalid", `cannot submit ${what}: ${facts.error ?? facts.state}`)
    }
    if (spec.target.kind === "unit") {
      const unit = unitsById.get(spec.target.id)
      if (!unit) return yield* fail("not_found", `content ${spec.target.id} is not in this checkout`)
      const chosen = yield* choose(unit.name, unitParts(unit, typeOf(p, unit)).filter(p.policy.reviewable), spec.parts)
      yield* checkViews(spec.views, chosen, () => [""])
      for (const part of chosen) if (part.asset !== undefined) yield* available(part.asset, `${unit.name} · ${part.label}`)
      const befores = yield* planBefores(env, spec.views, (view) => kindOf(chosen.find((part) => part.id === view.part)?.asset))
      return { spec, chosen, befores, unit }
    }
    const collection = p.collectionsById.get(spec.target.id)
    if (!collection) return yield* fail("not_found", `collection ${spec.target.id} is not in this checkout`)
    const chosen = yield* choose(collection.name, collectionParts(collection, unitsById, p.snapshot.schema), spec.parts)
    const preview = chosen.some((part) => part.id === "preview") ? previewSpec(p, collection) : null
    const partsOfUnit = (unitId: string): ReadonlyArray<Part> => {
      const unit = unitsById.get(unitId)
      return unit ? unitParts(unit, typeOf(p, unit)) : []
    }
    const leafKeys = (partId: string): Array<string> =>
      partId === "preview"
        ? [...Object.entries(preview?.members ?? {}).flatMap(([unit, parts]) => parts.map((part) => `${unit}/${part.part}`)), ...(preview?.base ? ["base"] : [])]
        : partsOfUnit(partId.replace(/^member:/, "")).map((part) => `${partId.replace(/^member:/, "")}/${part.id}`)
    yield* checkViews(spec.views, chosen, leafKeys)
    const needed = new Set<string>()
    for (const part of chosen) {
      if (part.id === "preview" && preview) {
        if (preview.baseDeclared && !preview.base) return yield* fail("invalid", `preview base ${preview.baseDeclared} is not an asset in this checkout`)
        for (const parts of Object.values(preview.members)) for (const member of parts) needed.add(member.asset)
        if (preview.base) needed.add(preview.base)
      } else if (part.member !== undefined) {
        const unit = unitsById.get(part.member)
        if (!unit) return yield* fail("not_found", `member ${part.member} is not in this checkout`)
        for (const link of unit.links) needed.add(link.asset)
      }
    }
    for (const id of needed) {
      const facts = factsOf(p, id)
      if (facts.state !== "ok") return yield* fail("invalid", `cannot submit ${collection.name}: ${assetsById.get(id)?.path ?? id} is ${facts.error ?? facts.state}`)
    }
    // A member view compares its one named leaf (<unit>/<part>); a preview has no single media.
    const shownKind = (view: ViewSpec): string | null => {
      if (view.part === "preview" || !view.leaf) return null
      const cut = view.leaf.lastIndexOf("/")
      return kindOf(partsOfUnit(view.leaf.slice(0, cut)).find((part) => part.id === view.leaf!.slice(cut + 1))?.asset)
    }
    return { spec, chosen, befores: yield* planBefores(env, spec.views, shownKind), collection, preview }
  })

interface ViewSeed {
  readonly part: string
  readonly leaf?: string | undefined
  readonly caption: string
}

/** The views of an item: the requested ones, or one default view per part that shows media. */
const buildViews = (requested: ItemSpec["views"], parts: ReadonlyArray<FrozenPart>, caption: (part: FrozenPart) => string, defaults: (part: FrozenPart) => ReadonlyArray<ViewSeed>): Effect.Effect<Array<FrozenView>, never, Ids> =>
  Effect.gen(function*() {
    const ids = yield* Ids
    const seeds = requested
      ? requested.map((view) => ({ part: view.part, leaf: view.leaf ?? null, caption: isNonEmpty(view.caption) ? view.caption.trim() : caption(parts.find((part) => part.id === view.part)!), camera: view.camera ?? null, state: view.state ?? null }))
      : parts.flatMap(defaults).map((view) => ({ part: view.part, leaf: view.leaf ?? null, caption: view.caption, camera: null, state: null }))
    return yield* Effect.forEach(seeds, (seed) => Effect.map(ids.next("vw"), (id): FrozenView => ({ id, ...seed })))
  })

const freezeItem = (env: FreezeEnv, plan: Plan): Freezing<SubmissionItem> =>
  Effect.gen(function*() {
    const p = env.projection
    const { spec } = plan
    const id = yield* (yield* Ids).next("it")
    const evidence = yield* Evidence
    const titled = (fallback: string): string => (isNonEmpty(spec.title) ? spec.title.trim() : fallback)
    if (plan.unit) {
      const unit = plan.unit
      const frozen = yield* freezeUnitParts(env, unit, plan.chosen.map((part) => part.id))
      const parts = plan.chosen.map((part): FrozenPart => ({ id: part.id, label: part.label, role: part.role ?? null, asset: part.asset ?? null, evidence: frozen[part.id]! }))
      const views = yield* buildViews(spec.views, parts, (part) => `${unit.name} · ${part.label}`, (part) => (part.asset ? [{ part: part.id, caption: `${unit.name} · ${part.label}` }] : []))
      return { id, target: { kind: "unit", id: unit.id }, title: titled(unit.name), kind: "unit", definition: yield* freezeDefinition(env, unit), parts, views: yield* freezeBefores(env, views, plan.befores) }
    }
    const collection = plan.collection!
    const preview = plan.preview ?? null
    const { unitsById } = p.snapshot
    const parts: Array<FrozenPart> = []
    for (const part of plan.chosen) {
      if (part.id === "preview" && preview) {
        const members: Record<string, Record<string, LeafEvidence>> = {}
        for (const [unit, shown] of Object.entries(preview.members)) {
          members[unit] = {}
          for (const member of shown) members[unit]![member.part] = yield* freezeAsset(env, member.asset)
        }
        const base = preview.base ? yield* freezeAsset(env, preview.base) : null
        if (preview.moduleSha === "missing") return yield* fail("invalid", `preview module ${preview.module} is declared but its file is missing`)
        const frozen = [...Object.values(members).flatMap((leaves) => Object.values(leaves)), ...(base ? [base] : [])]
        const shaOf = (asset: string): string | null => frozen.find((leaf) => leaf.asset === asset)?.sha256 ?? null
        parts.push({
          id: "preview",
          label: part.label,
          evidence: { digest: previewDigest(preview, shaOf), module: preview.module, config: preview.config, roles: preview.roles, base, members, ...(preview.moduleSha ? { moduleSha: preview.moduleSha } : {}) }
        })
        continue
      }
      const unit = unitsById.get(part.member ?? "")!
      const leaves = yield* freezeUnitParts(env, unit, unitParts(unit, typeOf(p, unit)).map((own) => own.id))
      parts.push({
        id: part.id,
        label: part.label,
        member: unit.id,
        evidence: { digest: digest(Object.fromEntries(Object.entries(leaves).map(([key, leaf]) => [key, leaf.digest]))), unit: unit.id, definition: yield* freezeDefinition(env, unit), parts: leaves }
      })
    }
    const definition = yield* evidence.freezeJson({ id: collection.id, name: collection.name, kind: collection.kind, members: collection.members })
    const views = yield* buildViews(spec.views, parts, (part) => `${collection.name} · ${part.label}`, (part) => {
      if (part.id === "preview") return [{ part: "preview", caption: `${collection.name} · ${part.label}` }]
      // A member is shown by its thumbnail visual, addressed as a leaf of the member part.
      const unit = unitsById.get(part.member ?? "")
      if (!unit) return []
      const type = typeOf(p, unit)
      const link = unit.links.find((candidate) => candidate.role === type.thumb) ?? unit.links[0]
      const shown = link && unitParts(unit, type).find((own) => own.asset === link.asset && own.role === link.role)
      return shown ? [{ part: part.id, leaf: `${unit.id}/${shown.id}`, caption: `${unit.name} · ${type.roles.find((role) => role.key === link.role)?.label ?? link.role}` }] : []
    })
    return {
      id,
      target: { kind: "collection", id: collection.id },
      title: titled(collection.name),
      kind: "collection",
      definition,
      parts,
      views: yield* freezeBefores(env, views, plan.befores),
      preview: preview ? { module: preview.module, label: preview.label, represents: preview.represents } : null
    }
  })

/** Validate, freeze and record a submission. The caller holds the reviews lock. */
export const submit = (input: typeof SubmitInput.Type, env: WriteEnv, requestId: string | null = env.requestId): Freezing<SubmissionRecord> =>
  Effect.gen(function*() {
    const p = env.projection
    if (input.items.length === 0 || input.items.length > 200) return yield* fail("invalid", "a submission needs 1-200 items")
    if (input.title != null && input.title.length > 300) return yield* fail("invalid", "title must be text")
    if (input.note != null && input.note.length > 5000) return yield* fail("invalid", "note must be text")
    if (input.supersedes && !p.records.submission.some((submission) => submission.id === input.supersedes)) return yield* fail("not_found", `submission ${input.supersedes} not found`)
    const freezing: FreezeEnv = { ...env, within: assetFiles((yield* ProjectFiles).root, p.snapshot.assetRoots) }
    // Every item is checked before the first byte is frozen.
    const plans = yield* Effect.forEach(input.items, (spec) => planItem(freezing, spec))
    const items = yield* Effect.forEach(plans, (plan) => freezeItem(freezing, plan))
    const first = items[0]!
    const record: SubmissionRecord = {
      id: yield* (yield* Ids).next("sub"),
      title: isNonEmpty(input.title) ? input.title.trim() : items.length === 1 ? first.title : `${first.title} and ${items.length - 1} more`,
      by: env.actor,
      at: yield* nowIso,
      context: { branch: env.checkout.branch, head: env.checkout.head, dirty: yield* dirtyCount },
      supersedes: input.supersedes ?? null,
      note: isNonEmpty(input.note) ? input.note.trim() : null,
      items,
      ...(requestId !== null && env.requestBinding ? { requestId, requestBinding: env.requestBinding } : {})
    }
    const [created] = yield* (yield* Records).apply([{ type: "create", kind: "submission", record }])
    return created as SubmissionRecord
  })

export const submitAction = write(
  "review.submit",
  "Explicitly submit units/collections for review; freezes definitions and asset bytes. note is Markdown shown to the reviewer beside the items. A view may add before ({path} of a project file under the asset roots, or {submission, item, part, leaf?} of earlier evidence; optional label) and afterLabel to show its evidence as a before/after comparison",
  SubmitInput,
  "reviews",
  (input, env) =>
    Effect.gen(function*() {
      const prior = yield* priorRequest(env.projection, "submission", env.requestId, env.requestBinding)
      if (prior) return { submission: submissionView(env.projection, prior), replayed: true }
      return { submission: submissionView(env.projection, yield* submit(input, env)) }
    })
)
