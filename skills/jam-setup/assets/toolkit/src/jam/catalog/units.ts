// Runs as catalog content. Pure: from the runs of a project, their recipes and their live status
// to what a catalog source returns.
//
// One unit per subject, never per run folder: notes and verdicts are kept by unit id and part id,
// so they stay with the subject through every attempt and into its delivery. Everything the
// workflow knows (step states, gates, jobs, measurements) is a derived field: shown beside the
// content, never part of what a verdict approved.
import type { FieldInput, LinkInput, ProblemInput, RoleInput, SourceOutput, TypeInput, UnitInput } from "../../catalog/plugin.ts"
import { extensionOf, isUnder } from "../../kernel/hash.ts"
import { parentOf } from "../../kernel/Stamps.ts"
import type { MediaKind, ResolvedRecipe, ResolvedStep } from "../recipes/schema.ts"
import type { RunRef } from "../runs/Runs.ts"
import { type Run, type StepRecord, UNRESOLVED } from "../runs/schema.ts"
import type { RunStatus, StepStatus } from "../runs/status.ts"
import { words } from "./note.ts"
import { INPUTS, MADE_FROM } from "./plugin.ts"

/** The role that holds what a step's reviewer looks at. */
export const EVIDENCE_ROLE = "evidence"

const CATALOG_KINDS = ["image", "video", "model", "audio"] as const
type CatalogKind = typeof CATALOG_KINDS[number]

// What the catalog's own media kinds show. A recorded file of another format (an FBX, a PSD)
// stays in the run record and is never replaced by a different file that happens to be showable.
const SHOWN: Readonly<Record<string, CatalogKind>> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
  mp4: "video", webm: "video",
  glb: "model",
  wav: "audio", ogg: "audio", flac: "audio", mp3: "audio"
}
const KINDS_OF: Readonly<Record<MediaKind, ReadonlyArray<CatalogKind>>> = {
  image: ["image"], video: ["video"], model: ["model"], audio: ["audio"], any: CATALOG_KINDS, text: [], data: []
}
const RECORDS = /(^|\/)(\.git|\.catalog)(\/|$)/

const shownKind = (path: string): CatalogKind | null => (RECORDS.test(path) ? null : SHOWN[extensionOf(path)] ?? null)

/**
 * Whether a recorded file can be shown as a capture: media of a kind the catalog shows, anywhere in
 * the checkout but Git's own folder (the catalog's own captures live under .catalog/.local).
 */
export const capturable = (path: string): boolean => !/(^|\/)\.git(\/|$)/.test(path) && SHOWN[extensionOf(path)] !== undefined

/** One run of a subject with the recipe it follows. */
export interface Attempt {
  readonly ref: RunRef
  readonly recipe: ResolvedRecipe
}

export interface Subject {
  readonly id: string
  /** Its runs, the current one first. */
  readonly attempts: ReadonlyArray<Attempt>
  /** Where the current run stands, or why that could not be judged. */
  readonly status: RunStatus | { readonly error: string }
}

const time = (run: Run): number => {
  const at = Date.parse(run.created)
  return Number.isFinite(at) ? at : 0
}

/** The newest run is current; a delivery beats the scratch run it was copied from. */
export const byCurrency = (a: RunRef, b: RunRef): number =>
  time(b.run) - time(a.run) || b.run.n - a.run.n || Number(b.delivered) - Number(a.delivered) || b.path.localeCompare(a.path)

/** A step's current record: its latest, unless the step was skipped since. */
export const currentRecord = (run: Run, step: string): StepRecord | undefined => {
  const log = run.steps[step]
  return log === undefined || log.skip !== undefined ? undefined : log.records.at(-1)
}

// ---- Types

const many = (step: ResolvedStep, role: string): boolean =>
  step.produces.some((output) => output.role === role && (output.keys !== undefined || output.max === undefined || output.max > 1))

/** The roles of a recipe: each role its steps produce, once, then the evidence role. */
const rolesOf = (recipe: ResolvedRecipe): ReadonlyArray<RoleInput> => {
  const roles = new Map<string, { kinds: Set<string>; many: boolean }>()
  for (const step of recipe.steps) {
    for (const output of step.produces) {
      const kinds = KINDS_OF[output.kind]
      if (kinds.length === 0) continue
      const role = roles.get(output.role) ?? { kinds: new Set<string>(), many: false }
      for (const kind of kinds) role.kinds.add(kind)
      role.many ||= many(step, output.role)
      roles.set(output.role, role)
    }
  }
  const evidence = roles.get(EVIDENCE_ROLE) ?? { kinds: new Set<string>(), many: true }
  for (const kind of CATALOG_KINDS) evidence.kinds.add(kind)
  roles.set(EVIDENCE_ROLE, { kinds: evidence.kinds, many: true })
  return [...roles].map(([key, role]): RoleInput => ({
    key,
    label: words(key),
    kinds: CATALOG_KINDS.filter((kind) => role.kinds.has(kind)),
    many: role.many,
    ...(key === EVIDENCE_ROLE ? { help: "What each step's reviewer looks at: renders, captures, recordings." } : {})
  }))
}

const FIELDS: ReadonlyArray<FieldInput> = [
  { key: "state", label: "Run state", filter: true, help: "Where the subject's current run stands." },
  { key: "next", label: "Next" },
  { key: "people", label: "A person accepts", help: "Steps whose gate needs a person's acceptance in this run." },
  { key: "budget", label: "Budget", filter: true },
  { key: "triangles", label: "Triangles", kind: "number", group: "Measured" },
  { key: "materials", label: "Materials", kind: "number", group: "Measured" },
  { key: "textureMiB", label: "Texture memory", kind: "number", unit: "MiB", group: "Measured", help: "Decoded RGBA8 with full mip chains; a conservative estimate, not engine memory." },
  { key: MADE_FROM, label: "Made from", kind: "refs", group: "Provenance" },
  { key: INPUTS, label: "Inputs", kind: "code", group: "Provenance", help: "Files the steps consumed beyond the steps they need." },
  { key: "provider", label: "Provider", group: "Provenance" },
  { key: "jobs", label: "Paid jobs", group: "Provenance" },
  { key: "engineAsset", label: "Engine asset", kind: "code", group: "Provenance" },
  { key: "attempt", label: "Attempt", kind: "number", group: "Run" },
  { key: "run", label: "Run record", kind: "code", group: "Run" },
  { key: "delivered", label: "Delivered to", kind: "code", group: "Run" },
  { key: "created", label: "Started", group: "Run" }
]

const stepField = (step: string): string => `step.${step}`

const typeOf = (recipe: ResolvedRecipe): TypeInput => {
  const roles = rolesOf(recipe)
  const help = recipe.when ?? recipe.description
  return {
    label: recipe.title,
    scope: recipe.catalog.scope ?? "assets",
    ...(help === undefined ? {} : { help }),
    roles,
    thumb: (roles.find((role) => role.key !== EVIDENCE_ROLE && role.kinds.includes("image")) ?? roles[0])?.key ?? null,
    // Every field is a fact of the workflow, so none is reviewed: a gate that opens or a job that
    // settles must not mark an approved model as changed.
    fields: [
      ...FIELDS,
      ...recipe.steps.map((step): FieldInput => ({ key: stepField(step.id), label: step.title, group: "Steps" }))
    ].map((field) => ({ ...field, derived: true })),
    reviewAttributes: false
  }
}

// ---- Links

/**
 * The files a unit shows. A role several steps produce (the model of mesh, topology, texture…)
 * shows the latest step's result. That step's recorded files decide alone: when its model is in a
 * format the catalog cannot show, the role is empty and no earlier model stands in for it.
 */
const linksOf = (run: Run, recipe: ResolvedRecipe): ReadonlyArray<LinkInput> => {
  const declared = new Map<string, { step: ResolvedStep; record: StepRecord; many: boolean }>()
  const roleMany = new Map(rolesOf(recipe).map((role) => [role.key, role.many === true]))
  for (const step of recipe.steps) {
    const record = currentRecord(run, step.id)
    if (record === undefined) continue
    for (const output of step.produces) {
      if (KINDS_OF[output.kind].length > 0 && record.files.some((file) => file.role === output.role)) {
        declared.set(output.role, { step, record, many: roleMany.get(output.role) ?? false })
      }
    }
  }
  const links: Array<LinkInput> = []
  for (const [role, { many: isMany, record, step }] of declared) {
    const files = record.files.filter((file) => file.role === role)
    // The measured model is the one the step selected; other files in the role are its sources.
    const selected = role === "model" && record.metrics?.model !== undefined ? files.filter((file) => file.path === record.metrics?.model) : files
    const accepts = new Set(step.produces.flatMap((output) => (output.role === role ? KINDS_OF[output.kind] : [])))
    selected.forEach((file, index) => {
      const kind = shownKind(file.path)
      if (kind === null || !accepts.has(kind)) return
      links.push({
        role,
        asset: file.path,
        // A stable key, so a file that moves into a delivery keeps its review part.
        ...(isMany ? { key: file.key ?? String(index + 1) } : {}),
        meta: { step: step.id, ...(file.size === undefined ? {} : { width: file.size[0], height: file.size[1] }) }
      })
    })
  }
  const keys = new Set<string>()
  for (const step of recipe.steps) {
    const record = currentRecord(run, step.id)
    record?.evidence.forEach((file, index) => {
      if (shownKind(file.path) === null) return
      const base = `${step.id}-${file.label ?? index + 1}`
      const key = keys.has(base) ? `${base}-${index + 1}` : base
      keys.add(key)
      links.push({ role: EVIDENCE_ROLE, asset: file.path, key, meta: { step: step.id, ...(file.label === undefined ? {} : { label: file.label }) } })
    })
  }
  return links
}

// ---- Derived facts

const stepText = (status: StepStatus): string => {
  if (status.state === "review") {
    const waits = status.gate.required === "human" ? (status.review === undefined ? "waiting for a person's acceptance" : "waiting for a person's review in the catalog") : "waiting for review"
    return status.reason === undefined ? waits : `${waits} (${status.reason})`
  }
  return status.reason === undefined ? status.state : `${status.state}: ${status.reason}`
}

const stateOf = (status: RunStatus): { readonly state: string; readonly next: string } => {
  const next = status.next
  if (status.delivered) return { state: "delivered", next: "nothing: the run is delivered" }
  if (next.action === "work") {
    const fresh = status.steps.find((step) => step.step === next.step)?.state === "ready"
    return { state: fresh ? "in progress" : "needs rework", next: `${next.step}: ${next.why}` }
  }
  if (next.action === "review") return next.gate === "human" ? { state: "waiting for a person", next: `${next.step} waits for a person's acceptance` } : { state: "waiting for review", next: `${next.step} waits for review` }
  if (next.action === "settle-jobs") return { state: "jobs unsettled", next: `provider jobs ${next.jobs.join(", ")} are not settled` }
  if (next.action === "deliver") return { state: "ready to deliver", next: "every step is settled; the run can be delivered" }
  return { state: "done", next: next.why }
}

const unique = <A>(values: Iterable<A>): Array<A> => [...new Set(values)]

/** Which subject each recorded file belongs to: its outputs and evidence in any of its runs. */
const ownersOf = (subjects: ReadonlyArray<Subject>): (path: string) => string | undefined => {
  const byPath = new Map<string, string>()
  const dirs: Array<readonly [string, string]> = []
  for (const subject of subjects) {
    for (const { ref } of subject.attempts) {
      dirs.push([ref.dir, subject.id])
      for (const log of Object.values(ref.run.steps)) {
        for (const record of log.records) for (const file of [...record.files, ...record.evidence]) if (!byPath.has(file.path)) byPath.set(file.path, subject.id)
      }
    }
  }
  return (path) => byPath.get(path) ?? dirs.find(([dir]) => isUnder(dir, path))?.[1]
}

const unitOf = (subject: Subject, owner: (path: string) => string | undefined): UnitInput => {
  const current = subject.attempts[0]!
  const { recipe, ref } = current
  const run = ref.run
  const records = recipe.steps.flatMap((step) => {
    const record = currentRecord(run, step.id)
    return record === undefined ? [] : [{ step, record }]
  })
  const requests = new Set(run.jobs.map((job) => job.request.path))
  const inputs = unique(records.flatMap(({ record }) => record.inputs.map((file) => file.path))).filter((path) => !requests.has(path))
  const madeFrom = unique([
    ...inputs.map(owner),
    // A paid result taken from another subject's run.
    ...records.map(({ record }) => record.provenance?.run?.split(":")[0])
  ]).filter((id): id is string => id !== undefined && id !== subject.id)
  const measured = (records.findLast(({ record }) => record.metrics !== undefined && record.files.some((file) => file.role === "model" && file.path === record.metrics?.model)) ??
    records.findLast(({ record }) => record.metrics !== undefined))?.record.metrics
  const unsettled = run.jobs.filter((job) => UNRESOLVED.includes(job.state))
  const delivery = subject.attempts.find((attempt) => attempt.ref.delivered)
  const status = subject.status
  const live: Record<string, unknown> = "error" in status
    ? { state: "unknown", next: status.error }
    : {
      ...stateOf(status),
      people: status.steps.filter((step) => step.gate.required === "human").map((step) => step.step).join(", "),
      ...Object.fromEntries(status.steps.map((step) => [stepField(step.step), stepText(step)]))
    }
  const attrs: Record<string, unknown> = {
    ...live,
    budget: run.budget,
    triangles: measured?.triangles,
    materials: measured?.materials,
    textureMiB: measured?.textureMiB === undefined ? undefined : Math.round(measured.textureMiB * 100) / 100,
    [MADE_FROM]: madeFrom,
    [INPUTS]: inputs,
    provider: unique([...run.jobs.map((job) => job.provider), ...records.flatMap(({ record }) => (record.provenance?.provider === undefined ? [] : [record.provenance.provider]))]).join(", "),
    jobs: run.jobs.length === 0 ? undefined : unsettled.length === 0 ? `${run.jobs.length}` : `${run.jobs.length} (${unsettled.map((job) => `${job.id} ${job.state}`).join(", ")})`,
    engineAsset: unique(records.flatMap(({ record }) => (record.engineAssets ?? []).map((asset) => asset.id))).join(", "),
    attempt: run.n,
    run: ref.path,
    delivered: delivery?.ref.dir,
    created: run.created
  }
  for (const [key, value] of Object.entries(attrs)) if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) delete attrs[key]
  return {
    id: subject.id,
    type: recipe.id,
    name: subject.id,
    attrs,
    links: linksOf(run, recipe),
    search: [recipe.id, recipe.title, ...(run.budget === null ? [] : [run.budget])],
    sources: subject.attempts.map((attempt) => attempt.ref.path)
  }
}

export interface RunsOutput {
  readonly subjects: ReadonlyArray<Subject>
  /** Folders runs live in; media may be anywhere under them. */
  readonly roots: ReadonlyArray<string>
  readonly problems: ReadonlyArray<ProblemInput>
}

/** What the `runs` source returns. */
export const sourceOutput = ({ problems, roots, subjects }: RunsOutput): SourceOutput => {
  const owner = ownersOf(subjects)
  const units = subjects.map((subject) => unitOf(subject, owner))
  const types: Record<string, TypeInput> = {}
  for (const subject of subjects) types[subject.attempts[0]!.recipe.id] ??= typeOf(subject.attempts[0]!.recipe)
  // A run may name files outside the run folders (a shared reference); their folders are media too.
  const outside = units.flatMap((unit) => (unit.links ?? []).map((link) => link.asset)).filter((path) => !roots.some((root) => isUnder(root, path))).map(parentOf)
  const named = unique([...roots, ...outside])
  return {
    types,
    assetRoots: named.filter((root) => !named.some((other) => other !== root && isUnder(other, root))),
    units,
    problems
  }
}
