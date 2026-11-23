// Submitting units, collections and work for review. A submission is validated completely
// (targets, parts, captures, views, media availability) before anything is frozen, and frozen
// before it is recorded. Work is what is not catalog content (lighting, tooling, a proposal): an
// item without a target that holds captures, text, or both.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { type ActionServices, dirtyCount, optional, priorRequest, refOf, Text, write, type WriteEnv } from "../action.ts"
import { assetFiles } from "../assetFiles.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { digest, isNonEmpty } from "../../kernel/hash.ts"
import { Ids, nowIso } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Evidence } from "../Evidence.ts"
import { collectionParts, ITEM_PART, unitParts, workPartId } from "../model/parts.ts"
import type { Collection, FrozenPart, FrozenView, LeafEvidence, Part, SubmissionItem, SubmissionRecord, Unit } from "../model/types.ts"
import { factsOf, typeOf } from "../Projection.ts"
import { type PreviewSpec, previewDigest, previewSpec } from "../queries/review.ts"
import { submissionView } from "../queries/reviews.ts"
import { Records } from "../Records.ts"
import { SUBMISSION_TEXT } from "../records/schemas.ts"
import { Linked, SubmissionView, Written } from "../results.ts"
import { type BeforePlan, freezeBefores, planBefore } from "./before.ts"
import { CaptureInput, captureKind, captureLeaves, freezeCapture, type PlannedCapture, planCaptures } from "./captures.ts"
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
  target: optional(refOf(["unit", "collection"])).annotate({ description: "A unit or collection. Leave it out for work that is not catalog content; the item then needs a title and captures or text" }),
  title: optional(Schema.String),
  text: optional(Schema.String).annotate({ description: "Markdown shown above this item's evidence: only what differs for this item (at most 4000 characters). Work with text and no captures is a proposal, decided as one part, item" }),
  parts: optional(Schema.Array(Schema.String)).annotate({ description: "Content part ids to decide (default: every reviewable part; [] for none)" }),
  decide: optional(Schema.Array(Schema.Struct({
    id: Schema.String.annotate({ description: "Lowercase letters, digits and hyphens; becomes part item:<id>" }),
    label: Schema.String
  }))).annotate({ description: "What the person decides beyond content parts, for example [{id: \"design\", label: \"Design\"}]. An item with nothing to decide otherwise is decided as one part, item" }),
  captures: optional(Schema.Array(CaptureInput)).annotate({
    description: "Ways of showing the item, rendered outside the catalog: {label, file} or {label, before, after, labels?}, where a file is a checkout path or {revision, path}. Each is shown as a view and names the part it shows; it is never decided itself. renderer names who rendered it"
  }),
  views: optional(Schema.Array(ViewInput))
})
export const SubmitInput = Schema.Struct({
  title: optional(Schema.String).annotate({ description: "What the submission holds, as a name (\"Creature remakes, 14 designs\"); the request goes in ask" }),
  ask: optional(Schema.String).annotate({ description: "The one question the person answers, in a sentence (at most 300 characters)" }),
  brief: optional(Schema.String).annotate({ description: "Markdown for every item: how the work was made, how to read the views (at most 5000 characters)" }),
  changes: optional(Schema.String).annotate({ description: "Markdown: what changed since the person last looked, and why (at most 2000 characters)" }),
  limits: optional(Schema.String).annotate({ description: "Markdown: known defects and what is not done (at most 2000 characters)" }),
  items: Schema.Array(ItemInput),
  supersedes: optional(Schema.String).annotate({ description: "The submission this one replaces" })
})
type ItemSpec = typeof ItemInput.Type
type ViewSpec = typeof ViewInput.Type

interface Plan {
  readonly spec: ItemSpec
  /** Content parts (none for work). */
  readonly chosen: ReadonlyArray<Part>
  readonly captures: ReadonlyArray<PlannedCapture>
  /** What each capture shows, in capture order: a part id, or null for the whole item. */
  readonly shows: ReadonlyArray<string | null>
  /** Parts decided on their own merits (`item`, `item:<id>`). */
  readonly work: ReadonlyArray<Part>
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

/** The content parts to decide. `parts: []` decides none of them. */
const choose = (name: string, all: ReadonlyArray<Part>, wanted: ItemSpec["parts"]): Effect.Effect<ReadonlyArray<Part>, ToolError> =>
  Effect.gen(function*() {
    for (const id of wanted ?? []) if (!all.some((part) => part.id === id)) return yield* fail("invalid", `${name} has no part ${id}`)
    const chosen = wanted ? all.filter((part) => wanted.includes(part.id)) : all
    return chosen.length > 0 || wanted?.length === 0 ? chosen : yield* fail("invalid", `no reviewable parts selected for ${name}`)
  })

const WORK_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
/**
 * The decide entries as parts. With nothing else to decide, the item is decided as one part `item`,
 * named after it, as long as it shows or says something.
 */
const workParts = (spec: ItemSpec, content: ReadonlyArray<Part>, name: string, captures: number): Effect.Effect<ReadonlyArray<Part>, ToolError> =>
  Effect.gen(function*() {
    const declared = spec.decide ?? []
    if (declared.length === 0 && content.length === 0 && captures === 0 && !isNonEmpty(spec.text)) return yield* fail("invalid", `nothing to decide or show for ${name}`, { fix: "choose parts, add captures, or name what is decided with decide" })
    if (declared.length > 50) return yield* fail("invalid", "decide lists at most 50 parts")
    for (const entry of declared) {
      if (!WORK_ID.test(entry.id)) return yield* fail("invalid", `decide id ${JSON.stringify(entry.id)} must be lowercase letters, digits and hyphens (at most 40)`)
      if (!isNonEmpty(entry.label) || entry.label.length > 300) return yield* fail("invalid", `decide ${entry.id} needs a label of at most 300 characters`)
    }
    if (new Set(declared.map((entry) => entry.id)).size !== declared.length) return yield* fail("invalid", "a decide id appears twice")
    const parts = declared.map((entry): Part => ({ id: workPartId(entry.id), label: entry.label.trim() }))
    return parts.length > 0 || content.length > 0 ? parts : [{ id: ITEM_PART, label: name }]
  })

/** What each capture shows: the part it names, else the item's only part, else the whole item. */
const resolveShows = (captures: ReadonlyArray<PlannedCapture>, decided: ReadonlyArray<Part>): Effect.Effect<ReadonlyArray<string | null>, ToolError> =>
  Effect.forEach(captures, (capture) => {
    if (capture.shows === null) return Effect.succeed(decided.length === 1 ? decided[0]!.id : null)
    const part = decided.find((candidate) => candidate.id === capture.shows || candidate.id === workPartId(capture.shows!))
    return part ? Effect.succeed(part.id) : fail("invalid", `${capture.id} (${capture.label}) shows ${capture.shows}, which is not a part this item decides`, { fix: `use one of: ${decided.map((candidate) => candidate.id).join(", ")}` })
  })

const capturePart = (capture: PlannedCapture): Part => ({ id: capture.id, label: capture.label })

/** Validate one item request completely, without any effect on the project. */
const planItem = (env: FreezeEnv, spec: ItemSpec): Freezing<Plan> =>
  Effect.gen(function*() {
    const p = env.projection
    const { assetsById, unitsById } = p.snapshot
    if (spec.title != null && spec.title.length > 300) return yield* fail("invalid", "item title must be text")
    if (spec.text != null && spec.text.length > 4000) return yield* fail("invalid", "item text must be text of at most 4000 characters")
    const captures = yield* planCaptures(env, spec.captures)
    const captureOf = (partId: string): PlannedCapture | undefined => captures.find((capture) => capture.id === partId)
    // Views of captures name `before` or `after` of a pair; a view of one capture file may add a before side.
    const withCaptures = (leafKeys: (part: string) => ReadonlyArray<string>) => (part: string) => {
      const capture = captureOf(part)
      return capture ? captureLeaves(capture) : leafKeys(part)
    }
    const shownWithCaptures = (shown: (view: ViewSpec) => string | null) => (view: ViewSpec) => {
      const capture = captureOf(view.part)
      return capture ? captureKind(capture, view.leaf) : shown(view)
    }
    if (spec.target == null) {
      if (!isNonEmpty(spec.title)) return yield* fail("invalid", "an item without a target needs a title")
      if (captures.length === 0 && !isNonEmpty(spec.text)) return yield* fail("invalid", "an item without a target needs captures or text")
      if (spec.parts != null) return yield* fail("invalid", "parts select content parts, and this item has no target; name what is decided with decide")
      const work = yield* workParts(spec, [], spec.title.trim(), captures.length)
      yield* checkViews(spec.views, captures.map(capturePart), withCaptures(() => [""]))
      return { spec, chosen: [], work, captures, shows: yield* resolveShows(captures, work), befores: yield* planBefores(env, spec.views, shownWithCaptures(() => null)) }
    }
    const kindOf = (asset: string | undefined): string | null => (asset === undefined ? null : factsOf(p, asset).kind ?? null)
    const available = (asset: string, what: string): Effect.Effect<void, ToolError> => {
      const facts = factsOf(p, asset)
      return facts.state === "ok" ? Effect.void : fail("invalid", `cannot submit ${what}: ${facts.error ?? facts.state}`)
    }
    if (spec.target.kind === "unit") {
      const unit = unitsById.get(spec.target.id)
      if (!unit) return yield* fail("not_found", `unit ${spec.target.id} is not in this checkout`)
      const chosen = yield* choose(unit.name, unitParts(unit, typeOf(p, unit)).filter(p.policy.reviewable), spec.parts)
      const work = yield* workParts(spec, chosen, isNonEmpty(spec.title) ? spec.title.trim() : unit.name, captures.length)
      yield* checkViews(spec.views, [...captures.map(capturePart), ...chosen], withCaptures(() => [""]))
      for (const part of chosen) if (part.asset !== undefined) yield* available(part.asset, `${unit.name} · ${part.label}`)
      const befores = yield* planBefores(env, spec.views, shownWithCaptures((view) => kindOf(chosen.find((part) => part.id === view.part)?.asset)))
      return { spec, chosen, work, captures, shows: yield* resolveShows(captures, [...chosen, ...work]), befores, unit }
    }
    const collection = p.collectionsById.get(spec.target.id)
    if (!collection) return yield* fail("not_found", `collection ${spec.target.id} is not in this checkout`)
    const chosen = yield* choose(collection.name, collectionParts(collection, unitsById, p.snapshot.schema), spec.parts)
    const work = yield* workParts(spec, chosen, isNonEmpty(spec.title) ? spec.title.trim() : collection.name, captures.length)
    const preview = chosen.some((part) => part.id === "preview") ? previewSpec(p, collection) : null
    const partsOfUnit = (unitId: string): ReadonlyArray<Part> => {
      const unit = unitsById.get(unitId)
      return unit ? unitParts(unit, typeOf(p, unit)) : []
    }
    const leafKeys = (partId: string): Array<string> =>
      partId === "preview"
        ? [...Object.entries(preview?.members ?? {}).flatMap(([unit, parts]) => parts.map((part) => `${unit}/${part.part}`)), ...(preview?.base ? ["base"] : [])]
        : partsOfUnit(partId.replace(/^member:/, "")).map((part) => `${partId.replace(/^member:/, "")}/${part.id}`)
    yield* checkViews(spec.views, [...captures.map(capturePart), ...chosen], withCaptures(leafKeys))
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
    return { spec, chosen, work, captures, shows: yield* resolveShows(captures, [...chosen, ...work]), befores: yield* planBefores(env, spec.views, shownWithCaptures(shownKind)), collection, preview }
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
    const text = isNonEmpty(spec.text) ? { text: spec.text.trim() } : {}
    // Captures come first: they are what the item was submitted to show.
    const captured = yield* Effect.forEach(plan.captures, (capture, index) => freezeCapture(env, capture, plan.shows[index] ?? null))
    // Work parts hold what was asked; the item part of a text-only item keeps its text as before.
    const work = plan.work.map((part): FrozenPart => {
      const attrs = part.id === ITEM_PART && isNonEmpty(spec.text) ? { text: spec.text.trim() } : { label: part.label }
      return { id: part.id, label: part.label, evidence: { kind: "attributes", attrs, digest: digest(attrs) } }
    })
    const captureOf = (part: FrozenPart): PlannedCapture | undefined => plan.captures.find((capture) => capture.id === part.id)
    const captionOf = (fallback: (part: FrozenPart) => string) => (part: FrozenPart): string => {
      const capture = captureOf(part)
      return capture ? capture.caption ?? capture.label : fallback(part)
    }
    const viewsOf = (fallback: (part: FrozenPart) => ReadonlyArray<ViewSeed>) => (part: FrozenPart): ReadonlyArray<ViewSeed> => {
      const capture = captureOf(part)
      return capture ? [{ part: part.id, caption: capture.caption ?? capture.label }] : fallback(part)
    }
    if (spec.target == null) {
      const title = titled("")
      const parts: Array<FrozenPart> = [...captured, ...work]
      const definition = yield* evidence.freezeJson({
        title,
        ...text,
        decide: plan.work.map((part) => ({ part: part.id, label: part.label })),
        captures: plan.captures.map((capture, index) => ({ part: capture.id, label: capture.label, caption: capture.caption, renderer: capture.renderer, shows: plan.shows[index] ?? null }))
      })
      const views = yield* buildViews(spec.views, parts, captionOf((part) => part.label), viewsOf(() => []))
      return { id, target: null, title, ...text, kind: "work", definition, parts, views: yield* freezeBefores(env, views, plan.befores) }
    }
    if (plan.unit) {
      const unit = plan.unit
      const frozen = yield* freezeUnitParts(env, unit, plan.chosen.map((part) => part.id))
      const parts = [...captured, ...plan.chosen.map((part): FrozenPart => ({ id: part.id, label: part.label, role: part.role ?? null, asset: part.asset ?? null, evidence: frozen[part.id]! })), ...work]
      const views = yield* buildViews(spec.views, parts, captionOf((part) => `${unit.name} · ${part.label}`), viewsOf((part) => (part.asset ? [{ part: part.id, caption: `${unit.name} · ${part.label}` }] : [])))
      return { id, target: { kind: "unit", id: unit.id }, title: titled(unit.name), ...text, kind: "unit", definition: yield* freezeDefinition(env, unit), parts, views: yield* freezeBefores(env, views, plan.befores) }
    }
    const collection = plan.collection!
    const preview = plan.preview ?? null
    const { unitsById } = p.snapshot
    const parts: Array<FrozenPart> = [...captured]
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
    parts.push(...work)
    const definition = yield* evidence.freezeJson({ id: collection.id, name: collection.name, kind: collection.kind, members: collection.members })
    const views = yield* buildViews(spec.views, parts, captionOf((part) => `${collection.name} · ${part.label}`), viewsOf((part) => {
      if (part.id === "preview") return [{ part: "preview", caption: `${collection.name} · ${part.label}` }]
      // A member is shown by its thumbnail asset, addressed as a leaf of the member part.
      const unit = unitsById.get(part.member ?? "")
      if (!unit) return []
      const type = typeOf(p, unit)
      const link = unit.links.find((candidate) => candidate.role === type.thumb) ?? unit.links[0]
      const shown = link && unitParts(unit, type).find((own) => own.asset === link.asset && own.role === link.role)
      return shown ? [{ part: part.id, leaf: `${unit.id}/${shown.id}`, caption: `${unit.name} · ${type.roles.find((role) => role.key === link.role)?.label ?? link.role}` }] : []
    }))
    return {
      id,
      target: { kind: "collection", id: collection.id },
      title: titled(collection.name),
      ...text,
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
    for (const field of ["ask", "brief", "changes", "limits"] as const) {
      const max = SUBMISSION_TEXT[field]
      if ((input[field]?.length ?? 0) > max) return yield* fail("invalid", `${field} must be text of at most ${max} characters`)
    }
    if (input.ask != null && input.ask.trim().includes("\n")) return yield* fail("invalid", "ask must be one sentence on one line", { fix: "put the background in brief" })
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
      checkout: { branch: env.checkout.branch, head: env.checkout.head, dirty: yield* dirtyCount },
      supersedes: input.supersedes ?? null,
      ...(isNonEmpty(input.ask) ? { ask: input.ask.trim() } : {}),
      brief: isNonEmpty(input.brief) ? input.brief.trim() : null,
      ...(isNonEmpty(input.changes) ? { changes: input.changes.trim() } : {}),
      ...(isNonEmpty(input.limits) ? { limits: input.limits.trim() } : {}),
      items,
      ...(requestId !== null && env.requestBinding ? { requestId, requestBinding: env.requestBinding } : {})
    }
    const [created] = yield* (yield* Records).apply([{ type: "create", kind: "submission", record }])
    return created as SubmissionRecord
  })

/** The submission as created, with its route. */
export const SubmitOutput = Linked({ ...Written({ submission: SubmissionView }).fields })

export const submitAction = write(
  "review.submit",
  "Explicitly submit units, collections or work for review; freezes definitions and file bytes. title names what is submitted; ask is the question the person answers; brief, changes and limits are Markdown that apply to every item, shown on the review's overview. Items are only what the person decides, and an item's text holds only what differs for it. An item may carry captures (evidence rendered outside the catalog, each its own part capture:<n>) and text; an item without a target is work and holds captures, text or both. A view may add before ({path} of a project file under the asset roots, or {submission, item, part, leaf?} of earlier evidence; optional label) and afterLabel to show its evidence as a before/after comparison",
  SubmitInput,
  SubmitOutput,
  "reviews",
  (input, env) =>
    Effect.gen(function*() {
      const prior = yield* priorRequest(env.projection, "submission", env.requestId, env.requestBinding)
      if (prior) return { submission: submissionView(env.projection, prior), replayed: true }
      return { submission: submissionView(env.projection, yield* submit(input, env)) }
    })
)
