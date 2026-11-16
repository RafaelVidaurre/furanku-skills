// The shape of every record under .catalog. A file that does not decode is excluded and listed as
// a problem; nothing is repaired or guessed. Structure is declared as schemas (also published as
// JSON Schema); rules that tie fields together are filters with a message naming what is wrong.
import * as Schema from "effect/Schema"
import { isRecord } from "../../kernel/hash.ts"
import type { RecordKind } from "../model/types.ts"
import { CAPTURE_PART, DECISION_PART } from "../model/parts.ts"
import { VERDICTS } from "../model/verdicts.ts"
import { EVIDENCE_PATH } from "./layout.ts"

export const TAG = /^[a-z0-9][a-z0-9:._/+-]{0,63}$/u
export const CATEGORY = /^[^/\s][^/]{0,63}(\/[^/\s][^/]{0,63}){0,7}$/u
export const PART_NOTE_MAX = 5000
export const isTag = (value: unknown): value is string => typeof value === "string" && TAG.test(value)
export const isCategory = (value: unknown): value is string => typeof value === "string" && CATEGORY.test(value)

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max
const isHex = (value: unknown, length = 64): value is string => typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value)
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isVec3 = (value: unknown): boolean => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n))
const optionalText = (value: unknown, max: number): boolean => value == null || isText(value, max)

const text = (max: number) =>
  Schema.String.check(Schema.makeFilter((value) => isText(value, max) || `expected non-empty text of at most ${max} characters`))
const nullable = <S extends Schema.Top>(schema: S) => Schema.optionalKey(Schema.NullOr(schema))
const Iso = Schema.String.check(Schema.makeFilter((value) => (/Z$/.test(value) && !Number.isNaN(Date.parse(value))) || "expected a UTC ISO-8601 time"))
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const Hex64 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u))
const Actor = Schema.Struct({ name: text(200), kind: Schema.Literals(["human", "agent"]) })
const Tags = Schema.Array(Schema.String.check(Schema.isPattern(TAG))).check(
  Schema.makeFilter((tags) => new Set(tags).size === tags.length || "a tag appears twice")
)
const Category = Schema.String.check(Schema.isPattern(CATEGORY))
const Binding = Schema.Struct({ action: text(100), digest: Hex64, context: text(1000) })
const VerdictValue = Schema.Literals(VERDICTS)

/** A request id and its binding come together or not at all. */
const requestPair = (id: unknown, binding: unknown): boolean => (id == null ? binding == null : binding != null)

// ---- Evidence: references must be complete, so a read can always verify what it returns.

/** A store path named by the digest, or a Git blob with its commit and path. */
export const validRef = (ref: unknown, sha: unknown): boolean => {
  if (!isRecord(ref) || !isHex(sha)) return false
  if (ref["store"] !== undefined) {
    const match = EVIDENCE_PATH.exec(String(ref["store"]))
    return Object.keys(ref).length === 1 && typeof ref["store"] === "string" && !!match && match[2] === sha && match[1] === sha.slice(0, 2)
  }
  const git = ref["git"]
  if (git !== undefined) {
    return Object.keys(ref).length === 1 && isRecord(git) && (isHex(git["commit"], 40) || isHex(git["commit"], 64)) &&
      (isHex(git["blob"], 40) || isHex(git["blob"], 64)) && isText(git["path"], 1000)
  }
  return false
}

/** Frozen attributes, or frozen media of any kind with its reference (and, for a capture, who rendered it). */
export const validLeaf = (leaf: unknown): boolean => {
  if (!isRecord(leaf)) return false
  if (leaf["kind"] === "attributes") return isRecord(leaf["attrs"]) && isHex(leaf["digest"])
  return isText(leaf["kind"], 100) && isHex(leaf["sha256"]) && leaf["digest"] === leaf["sha256"] && isText(leaf["asset"], 500) &&
    isText(leaf["path"], 1000) && isCount(leaf["size"]) && optionalText(leaf["mime"], 100) && validRef(leaf["ref"], leaf["sha256"]) &&
    optionalText(leaf["renderer"], 100)
}

/** A capture: one frozen file, or a before/after pair with its two labels. */
const validCapture = (part: Record<string, unknown>, evidence: Record<string, unknown>): boolean => {
  if (!optionalText(part["renderer"], 100) || !optionalText(evidence["renderer"], 100)) return false
  if (evidence["pair"] === undefined) return validLeaf(evidence) && evidence["kind"] !== "attributes"
  const pair = evidence["pair"]
  const labels = evidence["labels"]
  return isRecord(pair) && validLeaf(pair["before"]) && validLeaf(pair["after"]) &&
    Array.isArray(labels) && labels.length === 2 && labels.every((label) => isText(label, 100))
}

const validDefinition = (definition: unknown): boolean =>
  isRecord(definition) && isHex(definition["sha256"]) && validRef(definition["ref"], definition["sha256"])
const leafMap = (map: unknown): boolean => isRecord(map) && Object.entries(map).every(([key, leaf]) => isText(key, 600) && validLeaf(leaf))

const validPartEvidence = (part: { readonly id: string; readonly evidence: unknown }): boolean => {
  const evidence = part.evidence
  if (!isRecord(evidence) || !isHex(evidence["digest"])) return false
  if (CAPTURE_PART.test(part.id)) return validCapture(part as unknown as Record<string, unknown>, evidence)
  if (part.id === "preview") {
    const roles = evidence["roles"]
    return isRecord(evidence["members"]) && Object.entries(evidence["members"]).every(([unit, leaves]) => isText(unit, 500) && leafMap(leaves)) &&
      (evidence["base"] == null || validLeaf(evidence["base"])) && (evidence["module"] == null || isText(evidence["module"], 100)) &&
      (evidence["config"] == null || isRecord(evidence["config"])) && (roles == null || (Array.isArray(roles) && roles.every((role) => isText(role, 100))))
  }
  if (part.id.startsWith("member:")) return isText(evidence["unit"], 500) && validDefinition(evidence["definition"]) && leafMap(evidence["parts"])
  return validLeaf(evidence)
}

export const validCamera = (camera: unknown): boolean =>
  camera == null || (isRecord(camera) && (camera["position"] == null || isVec3(camera["position"])) && (camera["target"] == null || isVec3(camera["target"])))

const VIEW_STATE_KEYS = ["mode", "animation", "isolate", "texture"]
export const validViewState = (state: unknown): boolean => {
  if (state == null) return true
  if (!isRecord(state)) return false
  if (state["mode"] != null && !["textured", "clay", "wireframe"].includes(state["mode"] as string)) return false
  const animation = state["animation"]
  if (animation != null) {
    if (!isRecord(animation)) return false
    if (animation["clip"] != null && !isText(animation["clip"], 200)) return false
    if (animation["time"] != null && !(typeof animation["time"] === "number" && animation["time"] >= 0)) return false
    if (animation["playing"] != null && typeof animation["playing"] !== "boolean") return false
  }
  if (state["isolate"] != null && !(typeof state["isolate"] === "string" || isCount(state["isolate"]))) return false
  if (state["texture"] != null && !isText(state["texture"], 300)) return false
  return Object.keys(state).every((key) => VIEW_STATE_KEYS.includes(key))
}

/** A view's before side: frozen media, optionally naming the earlier submission it came from. */
const validBefore = (view: Record<string, unknown>): boolean => {
  const before = view["before"]
  if (before == null) return view["afterLabel"] == null
  if (!isRecord(before) || !isText(before["label"], 100) || !isText(view["afterLabel"], 100)) return false
  const evidence = before["evidence"]
  if (!validLeaf(evidence) || (evidence as { kind?: unknown }).kind === "attributes") return false
  const from = before["from"]
  return from == null || (isRecord(from) && /^sub_[a-z0-9]+$/.test(String(from["submission"] ?? "")) && /^it_[a-z0-9]+$/.test(String(from["item"] ?? "")) &&
    isText(from["part"], 600) && optionalText(from["leaf"], 1200))
}

// ---- Records

export const NoteRecord = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^nt_[a-z0-9]+$/u)),
  target: Schema.Struct({
    kind: Schema.Literals(["unit", "collection", "asset", "submission"]),
    id: text(500),
    item: nullable(text(200)),
    part: nullable(text(600))
  }),
  body: text(20000),
  by: Actor,
  at: Iso,
  revision: Revision,
  editedAt: nullable(Iso),
  resolved: nullable(Schema.Struct({ by: Actor, at: Iso, explanation: nullable(Schema.String) })),
  requestId: nullable(text(300)),
  requestBinding: nullable(Binding),
  lastRequestId: nullable(text(300)),
  lastRequestBinding: nullable(Binding)
}).check(Schema.makeFilter((note) =>
  (requestPair(note.requestId, note.requestBinding) && requestPair(note.lastRequestId, note.lastRequestBinding)) || "request binding is invalid"
)).annotate({ identifier: "NoteRecord", description: "A standalone note on a unit, collection, asset or submission" })

export const LabelRecord = Schema.Struct({
  target: Schema.Struct({ kind: Schema.Literals(["unit", "asset", "collection"]), id: text(500) }),
  category: nullable(Category),
  tags: Tags,
  revision: Revision
}).annotate({ identifier: "LabelRecord", description: "Category and tags of one unit, asset or project collection" })

const MemberValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])
export const CollectionRecord = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9/_-]{0,119}$/u)),
  name: text(200),
  kind: nullable(text(100)),
  category: nullable(Category),
  tags: Tags,
  members: Schema.Array(Schema.Record(Schema.String, MemberValue).check(Schema.makeFilter((member) => isText(member["unit"], 500) || "members are invalid"))).check(
    Schema.makeFilter((members) => new Set(members.map((member) => member["unit"])).size === members.length || "a unit appears twice in members")
  ),
  revision: Revision,
  createdBy: nullable(Actor),
  createdAt: nullable(Schema.String),
  requestId: nullable(text(300)),
  requestBinding: nullable(Binding)
}).check(Schema.makeFilter((collection) => requestPair(collection.requestId, collection.requestBinding) || "request binding is invalid"))
  .annotate({ identifier: "CollectionRecord", description: "A catalog-owned collection: ordered references to units" })

export const CategoriesRecord = Schema.Struct({ categories: Schema.Array(Category), revision: Revision })
  .annotate({ identifier: "CategoriesRecord", description: "Registered category paths" })

const FrozenPart = Schema.Struct({ id: text(600), label: text(600), evidence: Schema.Unknown })
const SubmissionItem = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^it_[a-z0-9]+$/u)),
  // Null for work that is not catalog content (lighting, tooling, a proposal).
  target: Schema.NullOr(Schema.Struct({ kind: Schema.Literals(["unit", "collection"]), id: text(500) })),
  title: text(300),
  text: nullable(text(4000)),
  kind: Schema.optionalKey(Schema.Literals(["unit", "collection", "work"])),
  definition: Schema.Unknown,
  parts: Schema.NonEmptyArray(FrozenPart),
  views: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  preview: nullable(Schema.Struct({ module: text(100) }))
}).check(Schema.makeFilter((item) => {
  if (!validDefinition(item.definition)) return "item definition evidence is invalid"
  if (!item.parts.every(validPartEvidence)) return `item ${item.id} parts or evidence are invalid`
  // Work holds only its own evidence: captures, or the one decision part of a text-only item.
  if (item.target === null && !item.parts.every((part) => CAPTURE_PART.test(part.id) || part.id === DECISION_PART)) return `item ${item.id} has no target, so it holds only captures or a decision`
  if (new Set(item.parts.map((part) => part.id)).size !== item.parts.length) return "duplicate part ids"
  const viewsValid = item.views.every((view) =>
    /^vw_[a-z0-9]+$/.test(String(view["id"] ?? "")) && isText(view["caption"], 300) && item.parts.some((part) => part.id === view["part"]) &&
    (view["leaf"] == null || isText(view["leaf"], 1200)) && validCamera(view["camera"]) && validViewState(view["state"]) && validBefore(view)
  )
  return viewsValid || `item ${item.id} views are invalid`
}))

export const SubmissionRecord = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^sub_[a-z0-9]+$/u)),
  title: text(300),
  by: Actor,
  at: Iso,
  context: Schema.Struct({
    branch: nullable(text(300)),
    head: nullable(Schema.String.check(Schema.isPattern(/^([0-9a-f]{40}|[0-9a-f]{64})$/u))),
    dirty: nullable(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
  }),
  supersedes: nullable(Schema.String.check(Schema.isPattern(/^sub_[a-z0-9]+$/u))),
  note: nullable(text(5000)),
  items: Schema.NonEmptyArray(SubmissionItem),
  requestId: nullable(text(300)),
  requestBinding: nullable(Binding)
}).check(Schema.makeFilter((submission) => requestPair(submission.requestId, submission.requestBinding) || "request binding is invalid"))
  .annotate({ identifier: "SubmissionRecord", description: "A review submission: items with frozen parts, evidence and views" })

export const VerdictRecord = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^vd_[a-z0-9]+$/u)),
  submission: Schema.String.check(Schema.isPattern(/^sub_[a-z0-9]+$/u)),
  item: Schema.String.check(Schema.isPattern(/^it_[a-z0-9]+$/u)),
  by: Actor,
  at: Iso,
  comment: nullable(Schema.String),
  scope: Schema.Struct({ kind: Schema.Literals(["whole", "parts"]), parts: Schema.NonEmptyArray(text(600)) }),
  verdict: Schema.optionalKey(VerdictValue),
  exceptions: Schema.optionalKey(Schema.Record(Schema.String, VerdictValue)),
  verdicts: Schema.optionalKey(Schema.Record(Schema.String, VerdictValue)),
  partNotes: nullable(Schema.Record(Schema.String, text(PART_NOTE_MAX))),
  // An agent recording what a person decided elsewhere. The agent stays the actor; the person's
  // words are kept verbatim, so nobody mistakes the record for the person's own click.
  relay: Schema.optionalKey(Schema.Struct({ by: text(200), channel: text(300), words: text(PART_NOTE_MAX) })),
  requestId: nullable(text(300)),
  requestBinding: nullable(Binding)
}).check(Schema.makeFilter((event) => {
  if (!requestPair(event.requestId, event.requestBinding)) return "request binding is invalid"
  if (event.relay !== undefined && event.by.kind !== "agent") return "only an agent relays a person's verdict"
  const parts: ReadonlyArray<string> = event.scope.parts
  let decided = parts
  if (event.scope.kind === "whole") {
    if (event.verdict === undefined) return "whole verdict is invalid"
    if (!event.exceptions || !Object.entries(event.exceptions).every(([part, verdict]) => parts.includes(part) && verdict !== event.verdict)) return "exceptions are invalid"
  } else {
    if (!event.verdicts || Object.keys(event.verdicts).sort().join("\n") !== [...parts].sort().join("\n")) return "part verdicts are invalid"
    decided = Object.keys(event.verdicts)
  }
  // Part notes may only address parts this event decides.
  return !event.partNotes || Object.keys(event.partNotes).every((part) => decided.includes(part)) || "part notes are invalid"
})).annotate({ identifier: "VerdictRecord", description: "One verdict event on a submission item" })

export const RECORD_SCHEMAS: Readonly<Record<RecordKind, Schema.Top>> = {
  note: NoteRecord,
  label: LabelRecord,
  collection: CollectionRecord,
  categories: CategoriesRecord,
  submission: SubmissionRecord,
  verdict: VerdictRecord
}
