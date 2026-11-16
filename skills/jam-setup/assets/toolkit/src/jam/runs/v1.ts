// Reading a version 1 run.json as a run of the version 1 recipe. Pure: the caller supplies which
// recipe a version 1 run maps to. Nothing is rewritten until the run is next changed.
import { raise } from "../../kernel/errors.ts"
import { isNonEmpty, isRecord } from "../../kernel/hash.ts"
import type { Evidence, FileEntry, Job, JobState, Provenance, Review, Run, StepRecord } from "./schema.ts"

export interface LegacyRecipes {
  /** The recipe for a production run, given its profile. */
  production(profile: string | null): string
  readonly exploration: string
  readonly providerTest: string
  /** The single step of the provider-test recipe. */
  readonly providerTestStep: string
}

const VIEW_ROLE = "view"
const MODEL = /\.(glb|gltf|fbx|obj|blend)$/i

const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback)
const list = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])
const stamps = (value: unknown): Array<{ path: string; sha256: string }> =>
  list(value).filter(isRecord).map((row) => ({ path: text(row["path"]), sha256: text(row["sha256"]) }))

const JOB_STATE: Record<string, JobState> = { intent: "open", unknown: "lost" }

const provenanceOf = (raw: unknown, paidProviders: ReadonlySet<string>): Provenance | undefined => {
  if (!isRecord(raw)) return undefined
  const provider = text(raw["provider"])
  if (provider === "imported") {
    return { kind: "imported", source: text(raw["source"]), ...(isNonEmpty(raw["sourceEvidence"]) ? { sourceEvidence: raw["sourceEvidence"] } : {}) }
  }
  const tool = [text(raw["model"]), text(raw["transport"])].filter((part) => part !== "").join(" via ")
  if (paidProviders.has(provider) && isNonEmpty(raw["job"])) return { kind: "job", job: raw["job"], provider, tool }
  return { kind: "tool", tool: tool === "" ? provider : tool }
}

const reviewOf = (raw: Record<string, unknown>): Review => ({
  decision: raw["decision"] === "reject" ? "reject" : raw["decision"] === "revise" ? "revise" : "accept",
  actor: raw["actor"] === "human" ? "human" : "agent",
  via: "v1",
  reason: text(raw["reason"]),
  ...(isNonEmpty(raw["by"]) ? { by: raw["by"] } : {}),
  ...(isNonEmpty(raw["source"]) ? { channel: raw["source"] } : {}),
  at: text(raw["at"])
})

const recordOf = (stage: string, raw: Record<string, unknown>, paidProviders: ReadonlySet<string>): StepRecord => {
  const views = isRecord(raw["views"]) ? Object.entries(raw["views"]).filter((entry): entry is [string, string] => typeof entry[1] === "string") : []
  const runtimeModel = text(raw["runtimeModel"])
  const files: Array<FileEntry> = stamps(raw["files"]).map((stamp) => {
    const view = views.find(([, path]) => path === stamp.path)
    if (view) return { role: VIEW_ROLE, key: view[0], ...stamp }
    return { role: stamp.path === runtimeModel || (runtimeModel === "" && MODEL.test(stamp.path)) ? "model" : stage === "concept" ? "concept" : "file", ...stamp }
  })
  const evidence: Array<Evidence> = stamps(raw["evidence"])
  const dependencies = Object.fromEntries(
    Object.entries(isRecord(raw["dependencies"]) ? raw["dependencies"] : {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  )
  const provenance = provenanceOf(raw["provenance"], paidProviders)
  const metrics = isRecord(raw["metrics"]) && Object.keys(raw["metrics"]).length > 0
    // Version 1 also stored the measured model's hash among the metrics; the record's file stamps
    // carry it now, so it is dropped rather than kept as a second copy.
    ? { ...(Object.fromEntries(Object.entries(raw["metrics"]).filter(([key]) => key !== "sha256")) as StepRecord["metrics"]), ...(runtimeModel === "" ? {} : { model: runtimeModel }) }
    : undefined
  return {
    id: text(raw["id"]),
    at: text(raw["created"]),
    files,
    inputs: stamps(raw["inputs"]),
    evidence,
    dependencies,
    // Version 1 let any stage but the first stand alone when it was imported with origin evidence.
    ...(provenance?.kind === "imported" && Object.keys(dependencies).length === 0 && stage !== "concept" ? { entry: "imported" as const } : {}),
    note: text(raw["note"]),
    ...(provenance === undefined ? {} : { provenance }),
    ...(metrics === undefined ? {} : { metrics }),
    checks: [],
    reviews: list(raw["reviews"]).filter(isRecord).map(reviewOf)
  }
}

const jobOf = (raw: Record<string, unknown>, step: string): Job => {
  const state = text(raw["state"])
  return {
    id: text(raw["id"]),
    step,
    provider: text(raw["provider"]),
    operation: text(raw["operation"]),
    request: stamps([raw["request"]])[0] ?? { path: "", sha256: "" },
    estimate: typeof raw["estimate"] === "number" ? raw["estimate"] : 0,
    unit: text(raw["unit"]),
    price: {
      kind: raw["priceKind"] === "quote" ? "quote" : "estimate",
      source: text(raw["priceSource"]),
      date: text(raw["priceDate"])
    },
    authorization: text(raw["authorization"]),
    ...(isNonEmpty(raw["transport"]) ? { transport: raw["transport"] } : {}),
    ...(isNonEmpty(raw["scope"]) ? { scope: raw["scope"] } : {}),
    state: JOB_STATE[state] ?? (state as JobState),
    ...(isNonEmpty(raw["jobId"]) ? { providerJob: raw["jobId"] } : {}),
    ...(typeof raw["actual"] === "number" ? { actual: raw["actual"] } : {}),
    created: text(raw["created"]),
    history: list(raw["history"]).filter(isRecord).map((row) => ({
      state: JOB_STATE[text(row["state"])] ?? (text(row["state"]) as JobState),
      at: text(row["at"]),
      ...(isNonEmpty(row["evidence"]) ? { evidence: row["evidence"] } : {}),
      ...(isNonEmpty(row["jobId"]) ? { providerJob: row["jobId"] } : {}),
      ...(typeof row["actual"] === "number" ? { actual: row["actual"] } : {})
    }))
  }
}

/** The attempt number a version 1 run folder stands for: the digits in its name (`v2`, `003`), else 1. */
const attemptOf = (path: string): number => {
  const folder = path.split("/").at(-2) ?? ""
  const digits = /(\d+)/.exec(folder)?.[1]
  const n = digits === undefined ? 1 : Number.parseInt(digits, 10)
  return Number.isSafeInteger(n) && n > 0 ? n : 1
}

export const isV1Run = (raw: unknown): raw is Record<string, unknown> => isRecord(raw) && raw["version"] === 1 && isRecord(raw["stages"])

export const fromV1 = (raw: Record<string, unknown>, path: string, recipes: LegacyRecipes): Run => {
  if (!isNonEmpty(raw["id"])) raise("malformed", `${path} is a version 1 run without an id`)
  const profile = isNonEmpty(raw["profile"]) ? raw["profile"] : null
  const providerTest = raw["providerTest"] === true
  const exploration = raw["exploration"] === true
  const jobsRaw = list(raw["jobs"]).filter(isRecord)
  const paidProviders = new Set(jobsRaw.map((job) => text(job["provider"])))
  const context = isRecord(raw["context"]) ? raw["context"] : {}
  // Runs recorded before style revisions existed stored a list of stamps: the unnamed first revision.
  const style = isRecord(context["style"]) ? context["style"] : {}
  const steps: Record<string, { records: Array<StepRecord> }> = {}
  for (const [stage, records] of Object.entries(raw["stages"] as Record<string, unknown>)) {
    steps[stage] = { records: list(records).filter(isRecord).map((record) => recordOf(stage, record, paidProviders)) }
  }
  return {
    version: 2,
    id: raw["id"] as string,
    n: attemptOf(path),
    recipe: providerTest ? recipes.providerTest : exploration ? recipes.exploration : recipes.production(profile),
    budget: profile,
    created: text(raw["created"]),
    brief: stamps([raw["brief"]])[0] ?? { path: "", sha256: "" },
    style: { revision: isNonEmpty(style["revision"]) ? style["revision"] : null },
    human: list(raw["humanStages"]).filter((stage): stage is string => typeof stage === "string"),
    steps,
    jobs: jobsRaw.map((job) => jobOf(job, providerTest ? recipes.providerTestStep : text(job["stage"]))),
    migratedFrom: 1
  }
}
