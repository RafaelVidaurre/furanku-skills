// What state each step of a run is in, and what to do next. Reading status changes nothing.
import * as Effect from "effect/Effect"
import type { ToolError } from "../../kernel/errors.ts"
import { Stamps } from "../../kernel/Stamps.ts"
import { Checks } from "../checks/Checks.ts"
import type { Problem } from "../common.ts"
import type { JamConfig } from "../config/schema.ts"
import { Engine } from "../engine/Engine.ts"
import type { EngineAsset } from "../engine/schema.ts"
import { type ConditionFacts, type ConditionState, evaluateCondition } from "../recipes/conditions.ts"
import { ancestorsOf } from "../recipes/resolve.ts"
import type { Gate, ResolvedRecipe, ResolvedStep } from "../recipes/schema.ts"
import { type GateInfo, gateFor } from "./gates.ts"
import type { ReviewRequest } from "./ReviewDesk.ts"
import type { RunContext } from "./Runs.ts"
import { latestRecord, type Review, type Run, UNRESOLVED } from "./schema.ts"

export type StepState =
  | "waiting" // nothing recorded; a needed step is not accepted yet
  | "ready" // nothing recorded; can be worked now
  | "skipped" // optional, skipped with a reason
  | "bypassed" // not needed: a later step entered the run as imported work
  | "stale" // a file, the brief, the style revision or a dependency changed
  | "over-budget"
  | "check-failed"
  | "blocked" // recorded, but a step it was built on is no longer accepted
  | "review" // waiting for its gate
  | "revise"
  | "rejected"
  | "accepted"

export interface StepStatus {
  readonly step: string
  readonly title: string
  readonly state: StepState
  readonly reason?: string
  readonly gate: GateInfo
  /** Who decides the step's human gate, as the recipe names them. */
  readonly reviewer?: string
  readonly optional: boolean
  readonly record?: string
  readonly problems?: ReadonlyArray<Problem>
  /** The step's `when` condition and whether it holds now. */
  readonly condition?: ConditionState
  /** The latest decision on the step's current record: who made it and through which channel. */
  readonly decided?: Pick<Review, "decision" | "actor" | "via" | "by" | "channel">
  /**
   * The catalog review requested for the step's current record. Commands that ask the review
   * desk add where it can be opened now (`url`, or a `hint`) and who is expected to decide.
   */
  readonly review?: ReviewRequest
  readonly engineAssets?: ReadonlyArray<EngineAsset>
}

export type Next =
  | { readonly action: "work"; readonly step: string; readonly why: string }
  | { readonly action: "review"; readonly step: string; readonly gate: Gate }
  | { readonly action: "settle-jobs"; readonly jobs: ReadonlyArray<string> }
  | { readonly action: "deliver" }
  | { readonly action: "done"; readonly why: string }

export interface RunStatus {
  readonly id: string
  readonly n: number
  readonly run: string
  readonly recipe: string
  readonly budget: string | null
  readonly delivered: boolean
  readonly deliveredTo?: string
  readonly steps: ReadonlyArray<StepStatus>
  readonly unsettledJobs: ReadonlyArray<string>
  /** Every step is accepted, skipped or bypassed. */
  readonly settled: boolean
  readonly next: Next
}

const SETTLED: ReadonlyArray<StepState> = ["accepted", "skipped", "bypassed"]
const REDO: ReadonlyArray<StepState> = ["ready", "stale", "over-budget", "check-failed", "revise", "rejected"]

export const isSettled = (state: StepState): boolean => SETTLED.includes(state)

/** Steps that, directly or through others, need `step`. */
const dependants = (recipe: ResolvedRecipe, step: string): ReadonlyArray<ResolvedStep> => {
  const out = new Map<string, ResolvedStep>()
  const visit = (id: string): void => {
    for (const candidate of recipe.steps) {
      if (candidate.needs.includes(id) && !out.has(candidate.id)) {
        out.set(candidate.id, candidate)
        visit(candidate.id)
      }
    }
  }
  visit(step)
  return [...out.values()]
}

/** Why the run as a whole no longer stands on what it started from, or null. */
export const contextProblem = (context: RunContext): Effect.Effect<string | null, never, Stamps> =>
  Effect.gen(function*() {
    const { run } = context.ref
    if (!(yield* (yield* Stamps).unchanged(run.brief))) return `the brief (${run.brief.path}) changed since the run started`
    const revision = context.config.style.revision ?? null
    if (context.recipe.style && revision !== run.style.revision) {
      return `the style revision changed from ${run.style.revision ?? "the first"} to ${revision ?? "none"}`
    }
    return null
  })

const nextOf = (context: RunContext, steps: ReadonlyArray<StepStatus>, unsettledJobs: ReadonlyArray<string>): Next => {
  const redo = steps.find((status) => REDO.includes(status.state))
  if (redo) return { action: "work", step: redo.step, why: redo.state === "ready" ? "nothing is recorded yet" : `${redo.state}${redo.reason === undefined ? "" : `: ${redo.reason}`}` }
  const review = steps.find((status) => status.state === "review")
  if (review) return { action: "review", step: review.step, gate: review.gate.required }
  if (unsettledJobs.length > 0) return { action: "settle-jobs", jobs: unsettledJobs }
  if (context.ref.delivered || context.ref.run.deliveredTo !== undefined) return { action: "done", why: "the run is delivered" }
  return context.recipe.deliverable ? { action: "deliver" } : { action: "done", why: `recipe ${context.recipe.id} is not delivered` }
}

/** What step conditions are judged against: the engine adapter's commands and the run's budget. */
export const conditionFacts = (config: JamConfig, name: string | null): Effect.Effect<ConditionFacts, never, Engine> =>
  Effect.gen(function*() {
    const budget = name === null ? null : config.budgets[name] ?? null
    const engine = yield* (yield* Engine).resolved.pipe(
      Effect.map((adapter) => ({
        id: adapter.id,
        chosen: adapter.source !== "default",
        commands: new Set<string>(adapter.provides),
        kinds: new Map(Object.entries(adapter.adapter.commands ?? {}).flatMap(([name, command]) => (command?.kinds === undefined ? [] : [[name, command.kinds] as const])))
      })),
      Effect.catch((error) => Effect.succeed({ id: config.engine.adapter ?? "", chosen: true, commands: new Set<string>(), kinds: new Map<string, ReadonlyArray<string>>(), problem: error.message }))
    )
    return { engine, budgetName: name, budget }
  })

export const computeStatus = (context: RunContext): Effect.Effect<RunStatus, ToolError, Stamps | Checks | Engine> =>
  Effect.gen(function*() {
    const stamps = yield* Stamps
    const checks = yield* Checks
    const { recipe, config } = context
    const run: Run = context.ref.run
    const facts = yield* conditionFacts(config, run.budget)
    const stale = yield* contextProblem(context)
    const memo = new Map<string, StepStatus>()

    const beforeEntry = run.entry === undefined ? new Set<string>() : ancestorsOf(recipe, run.entry)
    // Why a step with nothing recorded is not needed, or null when it is.
    const bypassedBecause = (step: ResolvedStep): string | null => {
      if (beforeEntry.has(step.id)) return `the run starts at ${run.entry} from existing work`
      const imported = dependants(recipe, step.id).find((other) => latestRecord(run, other.id)?.entry === "imported")
      return imported === undefined ? null : `${imported.id} was imported with origin evidence`
    }

    const evaluate = (step: ResolvedStep, path: ReadonlyArray<string>): Effect.Effect<StepStatus, ToolError> =>
      Effect.gen(function*() {
        const cached = memo.get(step.id)
        if (cached) return cached
        const result = yield* judge(step, path)
        memo.set(step.id, result)
        return result
      })

    const stateOf = (id: string, path: ReadonlyArray<string>): Effect.Effect<StepState, ToolError> => {
      const step = recipe.steps.find((candidate) => candidate.id === id)
      // A record may name a step the recipe has since dropped; it cannot be accepted any more.
      return step === undefined || path.includes(id) ? Effect.succeed<StepState>("blocked") : Effect.map(evaluate(step, path), (status) => status.state)
    }

    const judge = (step: ResolvedStep, path: ReadonlyArray<string>): Effect.Effect<StepStatus, ToolError> =>
      Effect.gen(function*() {
        const gate = gateFor(config.review.mode, step.review, run.human.includes(step.id))
        const condition = step.when === undefined ? undefined : evaluateCondition(step.when, facts)
        const base = { step: step.id, title: step.title, gate, optional: step.optional, ...(step.reviewer === undefined ? {} : { reviewer: step.reviewer }), ...(condition === undefined ? {} : { condition }) }
        const log = run.steps[step.id]
        // A skip someone chose stands; one the tool made stands only while its condition is unmet.
        if (log?.skip !== undefined && log.skip.auto !== true) return { ...base, state: "skipped", reason: log.skip.reason }
        const record = log?.skip === undefined ? log?.records.at(-1) : undefined
        if (record === undefined && condition !== undefined && !condition.met) return { ...base, state: "skipped", reason: condition.reason ?? "its condition does not hold" }
        if (record === undefined) {
          const bypassed = bypassedBecause(step)
          if (bypassed !== null) return { ...base, state: "bypassed", reason: bypassed }
          for (const need of step.needs) {
            const state = yield* stateOf(need, [...path, step.id])
            if (!isSettled(state)) return { ...base, state: "waiting", reason: `needs ${need} (${state})` }
          }
          return { ...base, state: "ready" }
        }
        const last = record.reviews.at(-1)
        const recorded = {
          ...base,
          record: record.id,
          ...(record.engineAssets === undefined ? {} : { engineAssets: record.engineAssets }),
          ...(last === undefined ? {} : { decided: { decision: last.decision, actor: last.actor, via: last.via, ...(last.by === undefined ? {} : { by: last.by }), ...(last.channel === undefined ? {} : { channel: last.channel }) } }),
          ...(record.submission === undefined ? {} : { review: { submission: record.submission.id, route: record.submission.route } })
        }
        if (stale !== null) return { ...recorded, state: "stale", reason: stale }
        for (const file of [...record.files, ...record.inputs, ...record.evidence]) {
          if (!(yield* stamps.unchanged(file))) return { ...recorded, state: "stale", reason: `${file.path} changed or is missing` }
        }
        const problems: Array<Problem> = []
        let overBudget = false
        for (const id of step.checks) {
          if ((yield* checks.when(id)) !== "status") continue
          const found = yield* checks.run(id, { context, step, record })
          if (found.length > 0 && id.startsWith("budget-")) overBudget = true
          problems.push(...found)
        }
        if (problems.length > 0) {
          return { ...recorded, state: overBudget ? "over-budget" : "check-failed", reason: problems.map((problem) => problem.message).join("; "), problems }
        }
        for (const [dependency, id] of Object.entries(record.dependencies)) {
          const current = latestRecord(run, dependency)
          if (id === "skipped") {
            const worked = current !== undefined && run.steps[dependency]?.skip === undefined
            if (worked) return { ...recorded, state: "stale", reason: `${dependency} was skipped when this was recorded and has been worked since` }
            continue
          }
          if (current?.id !== id) return { ...recorded, state: "stale", reason: `${dependency} was replaced` }
          const state = yield* stateOf(dependency, [...path, step.id])
          if (state !== "accepted") return { ...recorded, state: "blocked", reason: `${dependency} is ${state}` }
        }
        if (gate.required === "none") return { ...recorded, state: "accepted" }
        const review = record.reviews.at(-1)
        if (review === undefined) return { ...recorded, state: "review" }
        if (review.decision !== "accept") return { ...recorded, state: review.decision === "reject" ? "rejected" : "revise", reason: review.reason }
        if (gate.required === "human" && review.actor !== "human") return { ...recorded, state: "review", reason: "accepted by an agent; a person must accept it" }
        return { ...recorded, state: "accepted" }
      })

    const steps: Array<StepStatus> = []
    for (const step of recipe.steps) steps.push(yield* evaluate(step, []))
    const unsettledJobs = run.jobs.filter((job) => UNRESOLVED.includes(job.state)).map((job) => job.id)
    return {
      id: run.id,
      n: run.n,
      run: context.ref.path,
      recipe: recipe.id,
      budget: run.budget,
      delivered: context.ref.delivered,
      ...(run.deliveredTo === undefined ? {} : { deliveredTo: run.deliveredTo }),
      steps,
      unsettledJobs,
      settled: steps.every((status) => isSettled(status.state)),
      next: nextOf(context, steps, unsettledJobs)
    }
  })

export const statusOf = (status: RunStatus, step: string): StepStatus | undefined => status.steps.find((candidate) => candidate.step === step)
