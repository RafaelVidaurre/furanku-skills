// A paid audio call through the run ledger: the job is opened with its estimate before anything is
// sent, and settled with what became of it. A lost answer stops the work; it is never sent again.
import * as Effect from "effect/Effect"
import { fail, type ToolError, toolError } from "../../kernel/errors.ts"
import { canonical, sha256 } from "../../kernel/hash.ts"
import type { Ids } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import type { Stamps } from "../../kernel/Stamps.ts"
import type { Checks } from "../checks/Checks.ts"
import type { Stamp } from "../common.ts"
import type { Engine } from "../engine/Engine.ts"
import type { Measure } from "../measure/Measure.ts"
import type { Providers } from "../providers/Providers.ts"
import type { Recipes } from "../recipes/Recipes.ts"
import type { ResolvedStep } from "../recipes/schema.ts"
import { openJob, updateJobState } from "../runs/jobs.ts"
import { type RecordResult, recordSteps } from "../runs/record.ts"
import { type RunContext, Runs } from "../runs/Runs.ts"
import { type Job, latestRecord, runKey } from "../runs/schema.ts"
import type { Estimate, Generated, ResolvedProvider } from "./AudioProvider.ts"

export interface PaidCall {
  /** The run whose ledger pays. */
  readonly run: string
  /** The recipe step that allows provider jobs. */
  readonly step: string
  readonly provider: ResolvedProvider
  /** The model and operation, for the ledger. */
  readonly operation: string
  readonly estimate: Estimate
  /** The request as sent, without credentials or signed URLs. Its hash is the duplicate guard. */
  readonly request: Readonly<Record<string, unknown>>
  /** Who approved the spending, when, in their words (default: the provider's standing authorization). */
  readonly authorized?: string | undefined
  readonly call: Effect.Effect<Generated, ToolError>
}

export type PaidResult =
  | {
    readonly status: "ok"
    readonly job: Job
    /** The run that paid, as `<id>:<n>`. */
    readonly run: string
    readonly request: Stamp
    readonly audio: Uint8Array
    readonly extension: string
    readonly charge: number
    /** Whether the charge is the provider's own figure or the estimate standing in for it. */
    readonly chargeBasis: "provider" | "estimate"
  }
  | { readonly status: "refused"; readonly job: Job; readonly message: string }

type Needs = Runs | Providers | Stamps | Checks | Engine | ProjectFiles
export type RecordNeeds = Runs | Recipes | Stamps | Measure | Checks | Ids | ProjectFiles | Engine

export const paidCall = (input: PaidCall): Effect.Effect<PaidResult, ToolError, Needs> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const ref = yield* (yield* Runs).find(input.run)
    const id = ref.run.id
    const unit = input.provider.descriptor.unit.label
    // One file per distinct request, named by its content, so a recorded request never changes.
    const body = `${JSON.stringify(JSON.parse(canonical(input.request)), null, 2)}\n`
    const request = `${ref.dir}/requests/${sha256(body).slice(0, 16)}.json`
    if (!(yield* files.exists(request))) yield* files.writeText(request, body)
    const opened = yield* openJob({
      run: input.run,
      step: input.step,
      provider: input.provider.id,
      operation: input.operation,
      estimate: input.estimate.amount,
      request,
      price: input.estimate.kind,
      priceSource: input.estimate.basis,
      authorized: input.authorized,
      transport: "cli"
    })
    const job = opened.job.id
    const outcome = yield* input.call
    if (outcome.status === "lost") {
      yield* updateJobState({ run: input.run, job, to: "lost" })
      return yield* fail("unavailable", `job ${job} of run ${runKey(ref.run)}: no answer was read from ${input.provider.id} (${outcome.message.slice(0, 300)}). It may have been made and charged, so it was not sent again.`, {
        fix: `find out what became of it${input.provider.descriptor.recovery === undefined ? " in the provider's own history" : `: ${input.provider.descriptor.recovery}`}. Made: jam job submitted ${id} ${job} --provider-job <its id>, then jam job done ${id} ${job} --actual <charge> --evidence "<where it shows>". Not made: jam job cancelled ${id} ${job} --evidence "<how that was confirmed>". The same request stays blocked until then.`
      })
    }
    if (outcome.status === "refused") {
      const settled = yield* updateJobState({ run: input.run, job, to: "cancelled", evidence: `the provider refused the request and made nothing: ${outcome.message.slice(0, 400)}` })
      return { status: "refused", job: settled.job, message: outcome.message }
    }
    const digest = sha256(outcome.audio)
    yield* updateJobState({ run: input.run, job, to: "submitted", providerJob: outcome.providerJob ?? `unreported (audio sha256 ${digest.slice(0, 16)})` })
    const known = outcome.charge !== undefined && outcome.charge !== null
    const charge = known ? outcome.charge! : input.estimate.amount
    const settled = yield* updateJobState({
      run: input.run,
      job,
      to: "succeeded",
      actual: charge,
      evidence: known
        ? `the account's usage moved by ${charge} ${unit} across the call; audio sha256 ${digest}`
        : `the provider reported no usage figure, so the estimate (an upper bound) is recorded as the charge; audio sha256 ${digest}`
    })
    return { status: "ok", job: settled.job, run: runKey(ref.run), request: opened.job.request, audio: outcome.audio, extension: outcome.extension, charge, chargeBasis: known ? "provider" : "estimate" }
  })

/** The step of a run's recipe that may open provider jobs for audio: the named one when the recipe has it, else its only paid step. */
export const paidStep = (context: RunContext, preferred: string): Effect.Effect<ResolvedStep, ToolError> => {
  const paid = context.recipe.steps.filter((step) => step.paid)
  const step = paid.find((candidate) => candidate.id === preferred) ?? (paid.length === 1 ? paid[0] : undefined)
  return step !== undefined
    ? Effect.succeed(step)
    : fail("conflict", `recipe ${context.recipe.id} of run ${runKey(context.ref.run)} has ${paid.length === 0 ? "no step that allows provider jobs" : `no paid step named ${preferred}`}`, {
      fix: `start a run of a recipe with such a step: jam run start <recipe> <id> --brief-text "<what is wanted>" ("jam recipe list" shows them)`
    })
}

/** The run a command pays through, or how to start one. */
export const openRun = (reference: string, recipe: string): Effect.Effect<RunContext, ToolError, Runs> =>
  Effect.flatMap(Runs, (runs) =>
    runs.open(reference).pipe(Effect.mapError((error) =>
      error.code === "not_found"
        ? toolError("not_found", `there is no run ${reference} to pay through: paid generation is opened, capped and settled in a run's ledger`, {
          fix: `start one, then run this again: jam run start ${recipe} ${reference.split(":")[0]} --brief-text "<what is wanted and where it is used>"`
        })
        : error)))

/**
 * Record a paid step with the originals it received. Originals the step's current record already
 * holds stay, so one run can gather several sounds or lines.
 */
export const recordReceived = (input: { readonly context: RunContext; readonly step: ResolvedStep; readonly originals: ReadonlyArray<string>; readonly job: string; readonly note: string }): Effect.Effect<RecordResult, ToolError, RecordNeeds> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const run = (yield* (yield* Runs).read(input.context.ref.path)).run
    const role = input.step.produces.find((output) => output.kind === "audio")?.role ?? input.step.produces[0]?.role ?? "original"
    const kept: Array<string> = []
    for (const file of latestRecord(run, input.step.id)?.files ?? []) {
      if (file.role === role && (yield* files.exists(file.path))) kept.push(file.path)
    }
    return yield* recordSteps({
      run: runKey(run),
      steps: [input.step.id],
      files: [...new Set([...kept, ...input.originals])].map((path) => `${role}=${path}`),
      evidence: [],
      inputs: [],
      note: input.note,
      job: input.job
    })
  })
