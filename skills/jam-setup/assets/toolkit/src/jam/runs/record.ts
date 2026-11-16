// Recording a step: the caller states facts with flags; the tool hashes, measures and validates.
import * as Effect from "effect/Effect"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { digest, isRecord } from "../../kernel/hash.ts"
import { Ids, nowIso } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Stamps } from "../../kernel/Stamps.ts"
import { Checks } from "../checks/Checks.ts"
import { type Problem, problemText } from "../common.ts"
import { Engine } from "../engine/Engine.ts"
import type { EngineAsset } from "../engine/schema.ts"
import { canMeasureImage, canMeasureModel, Measure, type Measurement } from "../measure/Measure.ts"
import { Recipes } from "../recipes/Recipes.ts"
import { inNeedOrder, stepOf } from "../recipes/resolve.ts"
import type { ResolvedStep } from "../recipes/schema.ts"
import { appendRecord, setSkip } from "./edit.ts"
import { type GateInfo, gateFor } from "./gates.ts"
import { kindProblem } from "./media.ts"
import { type RunContext, Runs } from "./Runs.ts"
import { type Evidence, type FileEntry, type Metrics, type Provenance, type Review, type Run, runKey, type StepRecord } from "./schema.ts"
import { computeStatus, contextProblem, isSettled, type RunStatus, type StepState } from "./status.ts"

export interface RecordInput {
  readonly run: string
  /** One step, or several when a single operation produced all of them; they share the files. */
  readonly steps: ReadonlyArray<string>
  /** `[role[:key]=]path`. */
  readonly files: ReadonlyArray<string>
  /** `[label=]path`. */
  readonly evidence: ReadonlyArray<string>
  readonly inputs: ReadonlyArray<string>
  readonly note: string | undefined
  readonly tool?: string | undefined
  readonly job?: string | undefined
  readonly source?: string | undefined
  readonly sourceEvidence?: string | undefined
  /** `name=value`, checked against what the tool measures. */
  readonly metrics?: ReadonlyArray<string>
  readonly symmetric?: boolean
  readonly engineAssets?: ReadonlyArray<EngineAsset>
  /** Arguments an engine adapter's command was given to perform the step, files left out. */
  readonly arguments?: ReadonlyArray<string>
  /** Agent self-review reason, applied to each step whose gate allows agent review. */
  readonly accept?: string | undefined
}

export interface RecordedStep {
  readonly step: string
  readonly record: string
  readonly state: StepState
  readonly gate: GateInfo
  /** Set when --accept was given but this step needs a person. */
  readonly note?: string
}

export interface RecordResult {
  readonly id: string
  readonly records: ReadonlyArray<RecordedStep>
  readonly metrics?: Metrics
  readonly next: string
}

const ROLE = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?::([a-z0-9]+(?:-[a-z0-9]+)*))?=(.+)$/
const DEFAULT_ROLE = "file"
const MEASUREMENT = "measurement"

interface FileSpec {
  readonly role: string
  readonly key?: string
  readonly path: string
}

export const parseFiles = (step: ResolvedStep, specs: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<FileSpec>, ToolError> =>
  Effect.forEach(specs, (spec) => {
    const match = ROLE.exec(spec)
    if (match) return Effect.succeed<FileSpec>({ role: match[1]!, ...(match[2] === undefined ? {} : { key: match[2] }), path: match[3]! })
    const declared = step.produces
    if (declared.length === 0) return Effect.succeed<FileSpec>({ role: DEFAULT_ROLE, path: spec })
    const only = declared.length === 1 ? declared[0]! : undefined
    if (only !== undefined && only.keys === undefined) return Effect.succeed<FileSpec>({ role: only.role, path: spec })
    return fail("invalid", `--file ${spec}: step ${step.id} needs to know which output this is`, {
      fix: only !== undefined
        ? `write --file ${only.role}:<${only.keys!.join("|")}>=${spec}`
        : `write --file <role>=${spec} with one of: ${declared.map((output) => output.role).join(", ")}`
    })
  })

const producesProblems = (step: ResolvedStep, files: ReadonlyArray<FileSpec>): ReadonlyArray<Problem> => {
  const problems: Array<Problem> = []
  for (const output of step.produces) {
    const given = files.filter((file) => file.role === output.role)
    for (const file of given) {
      const wrong = kindProblem(output.kind, file.path)
      if (wrong !== null) problems.push({ message: `--file ${output.role}: ${wrong}` })
    }
    if (output.keys !== undefined) {
      const keys = given.map((file) => file.key)
      const absent = output.keys.filter((key) => !keys.includes(key))
      const unknown = given.filter((file) => file.key === undefined || !output.keys!.includes(file.key))
      const twice = output.keys.filter((key) => keys.filter((other) => other === key).length > 1)
      if (absent.length > 0) problems.push({ message: `step ${step.id} needs a ${output.role} file for each of: ${absent.join(", ")}`, fix: `add ${absent.map((key) => `--file ${output.role}:${key}=<path>`).join(" ")}` })
      if (unknown.length > 0) problems.push({ message: `--file ${output.role}: ${unknown.map((file) => file.path).join(", ")} ${unknown.length === 1 ? "has" : "have"} no valid key`, fix: `keys are: ${output.keys.join(", ")}` })
      if (twice.length > 0) problems.push({ message: `--file ${output.role}: ${twice.join(", ")} given more than once` })
      continue
    }
    const min = output.min ?? 1
    if (given.length < min) problems.push({ message: `step ${step.id} needs at least ${min} file${min === 1 ? "" : "s"} with role ${output.role} (got ${given.length})`, fix: `add --file ${step.produces.length === 1 ? "" : `${output.role}=`}<path>` })
    if (output.max !== undefined && given.length > output.max) {
      problems.push({ message: `step ${step.id} takes at most ${output.max} file${output.max === 1 ? "" : "s"} with role ${output.role} (got ${given.length})`, fix: "record the one chosen result; give supporting files another role, e.g. --file source=<path>" })
    }
  }
  return problems
}

const parseMetrics = (pairs: ReadonlyArray<string>): Effect.Effect<Record<string, unknown>, ToolError> =>
  Effect.gen(function*() {
    const out: Record<string, unknown> = {}
    for (const pair of pairs) {
      const at = pair.indexOf("=")
      if (at <= 0) return yield* fail("invalid", `--metric ${pair}: expected name=value, e.g. triangles=2840`)
      const text = pair.slice(at + 1)
      try {
        out[pair.slice(0, at)] = JSON.parse(text) as unknown
      } catch {
        return yield* fail("invalid", `--metric ${pair}: expected a number or JSON value after =`)
      }
    }
    return out
  })

/** A job named as `<job>` (this run) or `<run>/<job>` (another run's ledger). */
const boundJob = (context: RunContext, reference: string): Effect.Effect<{ provenance: Provenance; request: string }, ToolError, Runs | Recipes | Stamps> =>
  Effect.gen(function*() {
    const slash = reference.lastIndexOf("/")
    const other = slash === -1 ? null : yield* (yield* Runs).find(reference.slice(0, slash))
    const id = slash === -1 ? reference : reference.slice(slash + 1)
    const owner = other === null || other.path === context.ref.path ? context.ref : other
    if (owner !== context.ref && !(yield* (yield* Recipes).get(owner.run.recipe)).deliverable) {
      return yield* fail("forbidden", `--job ${reference}: run ${runKey(owner.run)} is a test or exploration; its results cannot be used as content`, { fix: "generate the result in a production run" })
    }
    const job = owner.run.jobs.find((candidate) => candidate.id === id)
    if (job === undefined) {
      return yield* fail("not_found", `--job ${reference}: run ${runKey(owner.run)} has no job ${id}`, { fix: `jobs there: ${owner.run.jobs.map((candidate) => candidate.id).join(", ") || "none"}; a job of another run is written <run>/<job>` })
    }
    if (job.state !== "succeeded") {
      return yield* fail("conflict", `--job ${reference}: the job is ${job.state}; a paid result binds to a succeeded job`, { fix: `settle it first: jam job done ${owner.run.id} ${job.id} --actual <charge> --evidence <reference>` })
    }
    if (!(yield* (yield* Stamps).unchanged(job.request))) {
      return yield* fail("conflict", `--job ${reference}: its request file ${job.request.path} changed after submission, so the result no longer matches what was paid for`, { fix: "restore the request file as submitted" })
    }
    return {
      provenance: { kind: "job", job: job.id, provider: job.provider, ...(owner === context.ref ? {} : { run: runKey(owner.run) }) },
      request: job.request.path
    }
  })

const provenanceOf = (context: RunContext, step: ResolvedStep, input: RecordInput): Effect.Effect<{ provenance?: Provenance; request?: string }, ToolError, Runs | Recipes | Stamps> =>
  Effect.gen(function*() {
    // A paid result is its own origin. Imported work may also name the local tool that processed it
    // (a bought mesh decimated in a DCC); the import stays the provenance kind.
    if (input.job !== undefined && (input.tool !== undefined || input.source !== undefined)) {
      return yield* fail("invalid", "--job is the whole origin of a paid result; drop --tool and --source", { fix: "--tool for local work, --job for a paid result, --source with --source-evidence for imported work (optionally with --tool)" })
    }
    if (input.sourceEvidence !== undefined && input.source === undefined) return yield* fail("invalid", "--source-evidence needs --source <where the work came from>")
    if (input.job !== undefined) return yield* boundJob(context, input.job)
    if (input.source !== undefined) {
      if (input.sourceEvidence === undefined) {
        return yield* fail("invalid", "--source needs --source-evidence <path>: a document showing where the work came from and the right to use it", { fix: "add --source-evidence <path>" })
      }
      return { provenance: { kind: "imported", source: input.source, sourceEvidence: input.sourceEvidence, ...(input.tool === undefined ? {} : { tool: input.tool }) } }
    }
    if (input.tool !== undefined) return { provenance: { kind: "tool", tool: input.tool } }
    if (input.files.length > 0) {
      return yield* fail("invalid", `step ${step.id}: say how these files came to be`, { fix: `add --tool "<tool and version>", --job <job> for a paid result, or --source <origin> --source-evidence <path> for imported work` })
    }
    return {}
  })

const reportMetrics = (path: string, files: ReadonlyArray<FileEntry>): Effect.Effect<Metrics, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    const report = yield* (yield* ProjectFiles).readJson(path)
    const model = isRecord(report) && isRecord(report["model"]) ? report["model"] : {}
    const bound = files.find((file) => file.path === model["path"] && file.sha256 === model["sha256"])
    if (!isRecord(report) || bound === undefined || typeof report["tool"] !== "string" || typeof report["command"] !== "string" || !isRecord(report["metrics"])) {
      return yield* fail("invalid", `measurement report ${path}: expected {"model": {"path", "sha256"}, "tool", "command", "metrics"} naming one of this record's files by its exact hash`, {
        fix: "produce the report with the DCC's measuring tool for the file you are recording"
      })
    }
    return { ...(report["metrics"] as Metrics), model: bound.path, basis: "report" }
  })

export const recordSteps = (input: RecordInput): Effect.Effect<RecordResult, ToolError, Runs | Recipes | Stamps | Measure | Checks | Ids | ProjectFiles | Engine> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const stamps = yield* Stamps
    const measure = yield* Measure
    const checks = yield* Checks
    const opened = yield* runs.open(input.run)
    const named = yield* Effect.try({ try: () => [...new Set(input.steps)].map((id) => stepOf(opened.recipe, id)), catch: (cause) => cause as ToolError })
    if (named.length === 0) return yield* fail("invalid", "name the step being recorded", { fix: `one of: ${opened.recipe.steps.map((step) => step.id).join(", ")}` })
    const steps = inNeedOrder(opened.recipe, named.map((step) => step.id))
    const note = input.note?.trim() ?? ""
    if (note === "") return yield* fail("invalid", "--note is required: say what was done, or why existing files suffice")

    // Shared by every step of the call, so a file is measured once.
    const measurements = new Map<string, Measurement>()
    const measureOnce = (path: string): Effect.Effect<Measurement, ToolError> => {
      const known = measurements.get(path)
      return known !== undefined ? Effect.succeed(known) : Effect.tap(measure.file(path), (found) => Effect.sync(() => void measurements.set(path, found)))
    }

    const build = (context: RunContext, step: ResolvedStep, batch: ReadonlyMap<string, string>, at: string): Effect.Effect<{ record: StepRecord; gate: GateInfo; autoSkips: ReadonlyArray<{ step: string; reason: string }>; note?: string }, ToolError, Runs | Recipes | Stamps | Checks | Ids | ProjectFiles | Engine> =>
      Effect.gen(function*() {
        const run = context.ref.run
        const specs = yield* parseFiles(step, input.files)
        const shape = producesProblems(step, specs)
        if (shape.length > 0) return yield* fail("invalid", `step ${step.id}: ${shape.map(problemText).join("; ")}`, { details: { problems: shape } })
        const { provenance, request } = yield* provenanceOf(context, step, input)
        if (run.entry === step.id && provenance?.kind !== "imported") {
          return yield* fail("invalid", `run ${runKey(run)} starts at ${step.id} from existing work, so this record must say where that work came from`, {
            fix: "add --source <origin> --source-evidence <path to a document showing the origin and the right to use it>"
          })
        }
        const gate = gateFor(context.config.review.mode, step.review, run.human.includes(step.id))

        // What this record is built on: the exact record of each needed step.
        const dependencies: Record<string, string> = {}
        const autoSkips: Array<{ step: string; reason: string }> = []
        let imported = false
        let before: RunStatus | undefined
        for (const need of step.needs) {
          const together = batch.get(need)
          if (together !== undefined) {
            dependencies[need] = together
            continue
          }
          before ??= yield* computeStatus(context)
          const state = before.steps.find((status) => status.step === need)
          if (state?.state === "accepted" && state.record !== undefined) dependencies[need] = state.record
          else if (state?.state === "skipped") {
            dependencies[need] = "skipped"
            // A skip the tool made (the step's condition does not hold) is written down with its reason.
            if (run.steps[need]?.skip === undefined) autoSkips.push({ step: need, reason: state.reason ?? "its condition does not hold" })
          }
          else if (state?.state === "bypassed") continue
          else if (provenance?.kind === "imported") imported = true
          else {
            return yield* fail("conflict", `step ${step.id} needs ${need} accepted first; ${need} is ${state?.state ?? "missing"}${state?.reason === undefined ? "" : ` (${state.reason})`}`, {
              fix: `"jam run next ${run.id}" says what to do; when one operation produced both, record them together (jam run record ${run.id} ${need} ${step.id} ...); work from outside the run enters with --source <origin> --source-evidence <path>`
            })
          }
        }

        const files: Array<FileEntry> = []
        for (const spec of specs) {
          const stamp = yield* stamps.stamp(spec.path)
          let size: readonly [number, number] | undefined
          if (canMeasureImage(spec.path)) {
            const image = yield* measureOnce(spec.path)
            if (image.sha256 !== stamp.sha256) return yield* fail("conflict", `${spec.path} changed while it was measured`, { fix: "record finished files; run the command again" })
            if (image.kind === "image") size = image.size
          }
          files.push({ role: spec.role, ...(spec.key === undefined ? {} : { key: spec.key }), ...stamp, ...(size === undefined ? {} : { size }) })
        }
        const evidence: Array<Evidence> = []
        const origin = input.sourceEvidence === undefined || input.evidence.some((item) => item === input.sourceEvidence || item.endsWith(`=${input.sourceEvidence}`)) ? [] : [`origin=${input.sourceEvidence}`]
        for (const spec of [...input.evidence, ...origin]) {
          const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)=(.+)$/.exec(spec)
          evidence.push({ ...(match ? { label: match[1]! } : {}), ...(yield* stamps.stamp(match ? match[2]! : spec)) })
        }
        const inputs = yield* Effect.forEach([...new Set([...input.inputs, ...(request === undefined ? [] : [request])])], (path) => stamps.stamp(path))

        // Measured facts come from the tool. A number the caller supplies must agree with them.
        let metrics: Metrics | undefined
        const models = files.filter((file) => file.role === "model" && canMeasureModel(file.path))
        const report = evidence.find((file) => file.label === MEASUREMENT)
        if (models.length === 1) {
          const model = models[0]!
          const facts = yield* measureOnce(model.path)
          if (facts.sha256 !== model.sha256) return yield* fail("conflict", `${model.path} changed while it was measured`, { fix: "record finished files; run the command again" })
          if (facts.kind === "model") {
            const { kind: _kind, sha256: _sha, ...rest } = facts
            metrics = { model: model.path, basis: "measured", ...rest }
          }
        } else if (report !== undefined) metrics = yield* reportMetrics(report.path, files)
        for (const [name, value] of Object.entries(yield* parseMetrics(input.metrics ?? []))) {
          const actual = (metrics as Record<string, unknown> | undefined)?.[name]
          if (actual === undefined) {
            return yield* fail("invalid", `--metric ${name}: nothing measured backs it, so it cannot be recorded`, { fix: "drop --metric; the tool measures a .glb recorded as --file model=<path>, or reads --evidence measurement=<report.json>" })
          }
          if (digest(actual) !== digest(value)) {
            return yield* fail("invalid", `--metric ${name}=${JSON.stringify(value)} disagrees with the ${metrics?.basis ?? "measured"} value ${JSON.stringify(actual)}`, { fix: "drop --metric; the measured value is recorded" })
          }
        }

        const accepting = input.accept !== undefined && gate.required !== "human"
        const reviews: Array<Review> = accepting ? [{ decision: "accept", actor: "agent", via: "direct", reason: input.accept!, at }] : []
        const draft: StepRecord = {
          id: yield* (yield* Ids).next("rec"),
          at,
          files,
          inputs,
          evidence,
          dependencies,
          ...(imported ? { entry: "imported" as const } : {}),
          note,
          ...(provenance === undefined ? {} : { provenance }),
          ...(metrics === undefined ? {} : { metrics }),
          ...(input.symmetric === true ? { symmetric: true } : {}),
          checks: [],
          ...(input.engineAssets === undefined || input.engineAssets.length === 0 ? {} : { engineAssets: input.engineAssets }),
          ...(input.arguments === undefined || input.arguments.length === 0 ? {} : { arguments: input.arguments }),
          reviews
        }
        const candidate: RunContext = { ...context, ref: { ...context.ref, run: appendRecord(run, step.id, draft) } }
        const problems: Array<Problem> = []
        for (const id of step.checks) problems.push(...(yield* checks.run(id, { context: candidate, step, record: draft })))
        if (problems.length > 0) {
          return yield* fail("invalid", `step ${step.id} did not pass its checks: ${problems.map(problemText).join("; ")}`, { fix: "nothing was recorded; fix the problems and record again", details: { step: step.id, problems } })
        }
        return {
          record: { ...draft, checks: step.checks.map((id) => ({ id, at })) },
          gate,
          autoSkips,
          ...(input.accept !== undefined && !accepting ? { note: "--accept did not apply: this step needs a person's acceptance" } : {})
        }
      })

    const result = yield* runs.mutate(opened.ref.path, (current) =>
      Effect.gen(function*() {
        let context: RunContext = { ...opened, ref: { ...opened.ref, run: current } }
        if (opened.ref.delivered || current.deliveredTo !== undefined) {
          return yield* fail("conflict", `run ${runKey(current)} is delivered and no longer changes`, { fix: `start a new attempt: jam run start ${current.recipe} ${current.id} --brief <file>` })
        }
        const changed = yield* contextProblem(context)
        if (changed !== null) return yield* fail("conflict", `${changed}; this run no longer stands on it`, { fix: `start a new attempt and record the reusable work there: jam run start ${current.recipe} ${current.id} --brief <file>` })
        const at = yield* nowIso
        const batch = new Map<string, string>()
        const written: Array<{ step: ResolvedStep; record: StepRecord; gate: GateInfo; note?: string }> = []
        // All or nothing: the file is only replaced when every step's record passed its checks.
        for (const step of steps) {
          const built = yield* build(context, step, batch, at)
          const skipped = built.autoSkips.reduce((run, skip) => setSkip(run, skip.step, { reason: skip.reason, at, auto: true }), context.ref.run)
          context = { ...context, ref: { ...context.ref, run: appendRecord(skipped, step.id, built.record) } }
          batch.set(step.id, built.record.id)
          written.push({ step, ...built })
        }
        return [context.ref.run as Run, { written, context }] as const
      }))

    const after = yield* computeStatus(result.context)
    const id = result.context.ref.run.id
    const records = result.written.map((entry): RecordedStep => ({
      step: entry.step.id,
      record: entry.record.id,
      state: after.steps.find((status) => status.step === entry.step.id)?.state ?? "review",
      gate: entry.gate,
      ...(entry.note === undefined ? {} : { note: entry.note })
    }))
    const metrics = result.written.find((entry) => entry.record.metrics !== undefined)?.record.metrics
    const waiting = records.find((entry) => !isSettled(entry.state))
    return {
      id,
      records,
      ...(metrics === undefined ? {} : { metrics }),
      next: waiting === undefined
        ? `jam run next ${id}`
        : waiting.gate.required === "human"
        ? `a person must accept ${waiting.step}: jam run request-review ${id} ${waiting.step}, or relay their answer with jam run review ${id} ${waiting.step} --accept --relay "<channel>: <their words>"`
        : `review ${waiting.step} against its evidence, then: jam run review ${id} ${waiting.step} --accept --reason "<why it passes>"`
    }
  })
