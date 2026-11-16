// Delivery: copy everything an accepted run stands on into the delivered root, with a run record
// that names the copies. Approval carries over because every copy is verified against the hash
// that was reviewed; nothing is registered or approved a second time.
import * as Effect from "effect/Effect"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { Git } from "../../kernel/Git.ts"
import { nowIso } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Stamps } from "../../kernel/Stamps.ts"
import { Checks } from "../checks/Checks.ts"
import { Engine } from "../engine/Engine.ts"
import { closureOf } from "./closure.ts"
import { ReviewDesk } from "./ReviewDesk.ts"
import { syncVerdicts } from "./review.ts"
import { Runs } from "./Runs.ts"
import { type Run, runKey, type StepLog, type StepRecord, UNRESOLVED } from "./schema.ts"
import { computeStatus, isSettled } from "./status.ts"

export interface DeliverResult {
  readonly id: string
  readonly n: number
  readonly delivered: string
  readonly run: string
  readonly files: number
  readonly from: string
}

const rewriteRecord = (record: StepRecord, to: (path: string) => string): StepRecord => ({
  ...record,
  files: record.files.map((file) => ({ ...file, path: to(file.path) })),
  inputs: record.inputs.map((file) => ({ ...file, path: to(file.path) })),
  evidence: record.evidence.map((file) => ({ ...file, path: to(file.path) })),
  ...(record.metrics?.model === undefined ? {} : { metrics: { ...record.metrics, model: to(record.metrics.model) } }),
  ...(record.provenance?.sourceEvidence === undefined ? {} : { provenance: { ...record.provenance, sourceEvidence: to(record.provenance.sourceEvidence) } })
})

export const deliverRun = (reference: string): Effect.Effect<DeliverResult, ToolError, Runs | Stamps | Checks | Engine | Git | ProjectFiles | ReviewDesk> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const stamps = yield* Stamps
    const files = yield* ProjectFiles
    const git = yield* Git
    const { context } = yield* syncVerdicts(yield* runs.open(reference))
    const { run } = context.ref
    const id = runKey(run)
    if (context.ref.delivered) return yield* fail("conflict", `run ${id} is already delivered at ${context.ref.dir}`)
    if (run.deliveredTo !== undefined && (yield* files.exists(run.deliveredTo))) return yield* fail("conflict", `run ${id} is already delivered at ${run.deliveredTo}`)
    if (!context.recipe.deliverable) {
      return yield* fail("forbidden", `recipe ${context.recipe.id} is for exploration or tests; its runs are not delivered`, { fix: "start a run of a production recipe and record the reusable work there" })
    }
    const status = yield* computeStatus(context)
    const open = status.steps.filter((step) => !isSettled(step.state))
    if (open.length > 0) {
      return yield* fail("conflict", `run ${id} is not finished: ${open.map((step) => `${step.step} is ${step.state}${step.reason === undefined ? "" : ` (${step.reason})`}`).join("; ")}`, {
        fix: `"jam run next ${run.id}" says what to do; an optional step is closed with "jam run skip ${run.id} <step> --reason ..."`
      })
    }
    const unsettled = run.jobs.filter((job) => UNRESOLVED.includes(job.state))
    if (unsettled.length > 0) {
      return yield* fail("conflict", `run ${id} has unsettled provider jobs: ${unsettled.map((job) => `${job.id} (${job.state})`).join(", ")}`, { fix: `settle each: jam job done|failed|cancelled ${run.id} <job> ...` })
    }
    const closure = closureOf(context)
    if (yield* files.exists(closure.runFile)) return yield* fail("conflict", `${closure.runFile} already exists`, { fix: "that attempt was delivered before; start a new attempt for new work" })

    // Every source must still be the bytes that were recorded and reviewed.
    const recorded = new Map<string, string>([[run.brief.path, run.brief.sha256]])
    for (const log of Object.values(run.steps)) {
      const record = log.records.at(-1)
      for (const file of record === undefined ? [] : [...record.files, ...record.inputs, ...record.evidence]) recorded.set(file.path, file.sha256)
    }
    for (const job of run.jobs) recorded.set(job.request.path, job.request.sha256)
    for (const entry of closure.entries) {
      const now = yield* stamps.stamp(entry.from)
      if (now.sha256 !== recorded.get(entry.from)) return yield* fail("conflict", `${entry.from} changed since it was recorded`, { fix: `"jam run status ${run.id}" shows what became stale` })
    }
    const ignored = yield* git.ignored([closure.runFile, ...closure.entries.map((entry) => entry.to)])
    if (ignored.length > 0) {
      return yield* fail("forbidden", `Git would ignore delivered files: ${ignored.join(", ")}`, { fix: "change .gitignore so the delivered root is tracked; nothing was copied" })
    }

    const moved = new Map(closure.entries.map((entry) => [entry.from, entry.to]))
    const to = (path: string): string => moved.get(path) ?? path
    for (const entry of closure.entries) {
      if (entry.from === entry.to) continue
      yield* files.copy(entry.from, entry.to)
      if ((yield* stamps.stamp(entry.to)).sha256 !== recorded.get(entry.from)) {
        return yield* fail("internal", `${entry.to} does not match ${entry.from} after copying`, { fix: "check the disk, remove the delivered folder and deliver again" })
      }
    }
    const at = yield* nowIso
    const steps: Record<string, StepLog> = {}
    for (const state of status.steps) {
      const log = run.steps[state.step]
      const record = log?.records.at(-1)
      // The delivered record holds what the delivery stands on: each step's current record, or why it has none.
      if (state.state === "skipped") steps[state.step] = { records: [], skip: log?.skip ?? { reason: state.reason ?? "its condition does not hold", at, auto: true } }
      else if (record !== undefined) steps[state.step] = { records: [rewriteRecord(record, to)] }
    }
    const delivered: Run = {
      ...run,
      brief: { ...run.brief, path: to(run.brief.path) },
      steps,
      jobs: run.jobs.map((job) => ({ ...job, request: { ...job.request, path: to(job.request.path) } })),
      delivered: { at, from: context.ref.path, files: closure.entries.length }
    }
    yield* runs.create(closure.dir, delivered)
    yield* runs.mutate(context.ref.path, (current) => Effect.succeed([{ ...current, deliveredTo: closure.runFile }, null] as const))
    return { id: run.id, n: run.n, delivered: closure.dir, run: closure.runFile, files: closure.entries.length, from: context.ref.path }
  })
