// The paid-operation ledger. A job is opened before anything is submitted, so a lost response is
// a known state and never a silent second charge.
import * as Effect from "effect/Effect"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { nowIso } from "../../kernel/Ids.ts"
import { Stamps } from "../../kernel/Stamps.ts"
import { Checks } from "../checks/Checks.ts"
import { Engine } from "../engine/Engine.ts"
import { Providers } from "../providers/Providers.ts"
import { capProblem, spendState } from "../providers/spend.ts"
import { stepOf } from "../recipes/resolve.ts"
import { updateJob } from "./edit.ts"
import { type RunContext, type RunRef, Runs } from "./Runs.ts"
import { type Job, type JobState, type Run, runKey, UNRESOLVED } from "./schema.ts"
import { computeStatus, contextProblem, isSettled } from "./status.ts"

export interface OpenJobInput {
  readonly run: string
  readonly step: string
  readonly provider: string
  readonly operation: string
  readonly estimate: number
  /** Project file holding the request as it will be sent, without credentials or signed URLs. */
  readonly request: string
  readonly price: "quote" | "list" | "estimate"
  readonly priceSource?: string | undefined
  /** Who approved this spending, when, in their words. Defaults to the provider's standing authorization. */
  readonly authorized?: string | undefined
  readonly transport?: string | undefined
  readonly scope?: string | undefined
}

/** One run per attempt: the delivered copy of a run repeats its jobs and must not count twice. */
const distinctRuns = (refs: ReadonlyArray<RunRef>): ReadonlyArray<RunRef> => {
  const byKey = new Map<string, RunRef>()
  for (const ref of refs) {
    const key = runKey(ref.run)
    if (!byKey.has(key) || ref.delivered) byKey.set(key, ref)
  }
  return [...byKey.values()]
}

export const openJob = (input: OpenJobInput): Effect.Effect<{ id: string; job: Job; next: string }, ToolError, Runs | Providers | Stamps | Checks | Engine> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const stamps = yield* Stamps
    const opened = yield* runs.open(input.run)
    const step = yield* Effect.try({ try: () => stepOf(opened.recipe, input.step), catch: (cause) => cause as ToolError })
    const descriptor = yield* (yield* Providers).get(input.provider)
    if (!step.paid) {
      return yield* fail("forbidden", `step ${step.id} of recipe ${opened.recipe.id} does not allow provider jobs`, { fix: `steps that do: ${opened.recipe.steps.filter((other) => other.paid).map((other) => other.id).join(", ") || "none"}` })
    }
    if (!(Number.isFinite(input.estimate) && input.estimate >= 0)) return yield* fail("invalid", `--estimate ${input.estimate}: expected the expected charge as a number of ${descriptor.unit.label}, 0 or more`)
    if (input.operation.trim() === "") return yield* fail("invalid", "--operation is required: the model and operation being run")
    const spend = opened.config.spend[descriptor.id]
    const state = spendState(descriptor, spend)
    const authorization = input.authorized?.trim() || state.standing || (state.paid ? "" : "not billed per job")
    if (authorization === "") {
      return yield* fail("invalid", `--authorized is required: who approved spending ${descriptor.unit.label} on this, when, in their words`, {
        fix: `add --authorized "<person, date: their words>"; a standing approval belongs in spend.${descriptor.id}.standing`
      })
    }
    if (state.paid && (input.priceSource ?? "").trim() === "") {
      return yield* fail("invalid", "--price-source is required: where the estimate came from (a dry run, a quote, a price page)", {
        fix: descriptor.quote === undefined ? `add --price-source "<...>"` : `this provider: ${descriptor.quote.how}`
      })
    }

    // The ledger lock covers the scan of every run, so two runs cannot both reserve one request.
    const job = yield* Effect.scoped(Effect.gen(function*() {
      yield* runs.ledgerLock
      return yield* runs.mutate(opened.ref.path, (run) =>
        Effect.gen(function*() {
          const context: RunContext = { ...opened, ref: { ...opened.ref, run } }
          if (opened.ref.delivered || run.deliveredTo !== undefined) return yield* fail("conflict", `run ${runKey(run)} is delivered and no longer changes`)
          const changed = yield* contextProblem(context)
          if (changed !== null) return yield* fail("conflict", `${changed}; this run no longer stands on it`, { fix: `start a new attempt: jam run start ${run.recipe} ${run.id} --brief <file>` })
          const status = yield* computeStatus(context)
          const unmet = step.needs.map((need) => status.steps.find((other) => other.step === need)).find((need) => need !== undefined && !isSettled(need.state))
          if (unmet !== undefined) {
            return yield* fail("conflict", `paid work on ${step.id} needs ${unmet.step} accepted first; it is ${unmet.state}`, { fix: `"jam run next ${run.id}" says what to do` })
          }
          const own = run.jobs.filter((other) => other.step === step.id)
          if (step.maxJobs !== undefined && own.length >= step.maxJobs) {
            return yield* fail("forbidden", `step ${step.id} allows ${step.maxJobs} provider job${step.maxJobs === 1 ? "" : "s"} per run and has ${own.length}`)
          }
          const request = yield* stamps.stamp(input.request)
          const others = distinctRuns([...(yield* runs.scan).runs.filter((ref) => ref.path !== opened.ref.path), context.ref])
          for (const other of others) {
            const same = other.run.jobs.find((candidate) => candidate.request.sha256 === request.sha256 && UNRESOLVED.includes(candidate.state))
            if (same !== undefined) {
              return yield* fail("conflict", `the same request is still unsettled as job ${same.id} (${same.state}) of run ${runKey(other.run)}`, {
                fix: `find out what became of it and settle it (jam job submitted|done|failed|cancelled ${other.run.id} ${same.id} ...); a second submission could be charged twice`
              })
            }
          }
          const refused = capProblem({ descriptor, spend, estimate: input.estimate, runJobs: run.jobs, allJobs: others.flatMap((other) => other.run.jobs) })
          if (refused !== null) return yield* Effect.fail(refused)
          const at = yield* nowIso
          const created: Job = {
            id: `j${run.jobs.length + 1}`,
            step: step.id,
            provider: descriptor.id,
            operation: input.operation.trim(),
            request,
            estimate: input.estimate,
            unit: descriptor.unit.id,
            price: { kind: input.price, source: input.priceSource?.trim() || "not billed per job", date: at.slice(0, 10) },
            authorization,
            ...(input.transport === undefined ? {} : { transport: input.transport }),
            ...(input.scope === undefined ? {} : { scope: input.scope }),
            state: "open",
            created: at,
            history: [{ state: "open", at }]
          }
          return [{ ...run, jobs: [...run.jobs, created] } as Run, created] as const
        }))
    }))
    const id = opened.ref.run.id
    return { id, job, next: `submit it once, then at once: jam job submitted ${id} ${job.id} --provider-job <the provider's id>; if the response is lost: jam job lost ${id} ${job.id}` }
  })

/**
 * Why jobs of this total size could not be opened in a run now, by the spending caps alone, or
 * null. Opens nothing: a batch asks before its first job, and each job is still checked as it opens.
 */
export const spendProblem = (input: { readonly run: string; readonly provider: string; readonly estimate: number }): Effect.Effect<ToolError | null, ToolError, Runs | Providers> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const opened = yield* runs.open(input.run)
    const descriptor = yield* (yield* Providers).get(input.provider)
    const all = distinctRuns([...(yield* runs.scan).runs.filter((ref) => ref.path !== opened.ref.path), opened.ref])
    return capProblem({ descriptor, spend: opened.config.spend[descriptor.id], estimate: input.estimate, runJobs: opened.ref.run.jobs, allJobs: all.flatMap((other) => other.run.jobs) })
  })

export interface JobUpdate {
  readonly run: string
  readonly job: string
  readonly to: "submitted" | "lost" | "succeeded" | "failed" | "cancelled"
  readonly providerJob?: string | undefined
  readonly actual?: number | undefined
  readonly evidence?: string | undefined
}

const FROM: Readonly<Record<JobUpdate["to"], ReadonlyArray<JobState>>> = {
  submitted: ["open", "lost"],
  lost: ["open"],
  succeeded: ["submitted"],
  failed: ["submitted"],
  cancelled: ["open", "lost", "submitted"]
}

export const updateJobState = (input: JobUpdate): Effect.Effect<{ id: string; job: Job }, ToolError, Runs> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const ref = yield* runs.find(input.run)
    const job = yield* runs.mutate(ref.path, (run) =>
      Effect.gen(function*() {
        const current = run.jobs.find((candidate) => candidate.id === input.job)
        if (current === undefined) {
          return yield* fail("not_found", `run ${runKey(run)} has no job ${input.job}`, { fix: `jobs: ${run.jobs.map((candidate) => `${candidate.id} (${candidate.state})`).join(", ") || "none"}` })
        }
        if (!FROM[input.to].includes(current.state)) {
          return yield* fail("conflict", `job ${current.id} is ${current.state}; it cannot become ${input.to}`, {
            fix: current.state === "open" || current.state === "lost"
              ? `from ${current.state}: "jam job submitted" once the provider's job id is known, or "jam job cancelled" with evidence that the provider has no such job`
              : current.state === "submitted" ? `from submitted: "jam job done", "jam job failed" or "jam job cancelled", each with --actual and --evidence` : "the job is settled"
          })
        }
        // Never-submitted work cost nothing; anything the provider saw needs its real charge.
        const neverSent = input.to === "cancelled" && current.state !== "submitted"
        const terminal = input.to === "succeeded" || input.to === "failed" || input.to === "cancelled"
        if (input.to === "submitted" && (input.providerJob ?? "").trim() === "") return yield* fail("invalid", "--provider-job is required: the id the provider gave the job")
        if (terminal && (input.evidence ?? "").trim() === "") {
          return yield* fail("invalid", "--evidence is required: where the outcome can be seen (a file, a task id, a billing entry)", {
            fix: neverSent ? "say how the provider confirmed that no job exists; never assume it" : `add --evidence "<...>"`
          })
        }
        if (terminal && !neverSent && !(input.actual !== undefined && Number.isFinite(input.actual) && input.actual >= 0)) {
          return yield* fail("invalid", "--actual is required: what the provider charged, from the provider", { fix: "keep the job submitted until the real charge is known; a failure is not proof of a refund" })
        }
        if (input.actual !== undefined && (!terminal || neverSent)) return yield* fail("invalid", "--actual belongs to a job the provider ran and settled")
        const state: JobState = neverSent ? "not-submitted" : input.to
        const at = yield* nowIso
        const next = updateJob(run, current.id, (existing) => ({
          ...existing,
          state,
          ...(input.providerJob === undefined ? {} : { providerJob: input.providerJob }),
          ...(neverSent ? { actual: 0 } : input.actual === undefined ? {} : { actual: input.actual }),
          history: [...existing.history, {
            state,
            at,
            ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
            ...(input.providerJob === undefined ? {} : { providerJob: input.providerJob }),
            ...(input.actual === undefined ? {} : { actual: input.actual })
          }]
        }))
        return [next, next.jobs.find((candidate) => candidate.id === current.id)!] as const
      }))
    return { id: ref.run.id, job }
  })

export interface JobRow {
  readonly run: string
  readonly job: string
  readonly step: string
  readonly provider: string
  readonly state: JobState
  readonly estimate: number
  readonly actual: number | null
  readonly unit: string
  readonly operation: string
  readonly providerJob: string | null
}

export const listJobs = (options: { readonly open: boolean; readonly run?: string | undefined }): Effect.Effect<ReadonlyArray<JobRow>, ToolError, Runs> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const refs = options.run === undefined ? distinctRuns((yield* runs.scan).runs) : [yield* runs.find(options.run)]
    return refs.flatMap((ref) =>
      ref.run.jobs.filter((job) => !options.open || UNRESOLVED.includes(job.state)).map((job): JobRow => ({
        run: runKey(ref.run),
        job: job.id,
        step: job.step,
        provider: job.provider,
        state: job.state,
        estimate: job.estimate,
        actual: job.actual ?? null,
        unit: job.unit,
        operation: job.operation,
        providerJob: job.providerJob ?? null
      })))
  })
