// Gates: accepting, returning and skipping steps, and reading a person's verdict from the review desk.
import * as Effect from "effect/Effect"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { nowIso } from "../../kernel/Ids.ts"
import { Stamps } from "../../kernel/Stamps.ts"
import { Checks } from "../checks/Checks.ts"
import { Engine } from "../engine/Engine.ts"
import { stepOf } from "../recipes/resolve.ts"
import { setSkip, updateLatest } from "./edit.ts"
import { type GateInfo, gateFor } from "./gates.ts"
import { PENDING, ReviewDesk, type ReviewRequest } from "./ReviewDesk.ts"
import { type RunContext, Runs } from "./Runs.ts"
import { type Decision, latestRecord, type Review, type Run, runKey } from "./schema.ts"
import { computeStatus, type RunStatus, type StepState } from "./status.ts"

export interface ReviewInput {
  readonly run: string
  readonly step: string
  readonly decision: Decision
  readonly reason?: string | undefined
  /** `<channel>: <the person's words>`. */
  readonly relay?: string | undefined
  readonly by?: string | undefined
  /** Refuse unless this is still the step's current record. */
  readonly record?: string | undefined
}

export interface ReviewResult {
  readonly id: string
  readonly step: string
  readonly record: string
  readonly decision: Decision
  readonly actor: "human" | "agent"
  readonly via: Review["via"]
  readonly state: StepState
  readonly gate: GateInfo
}

const REVIEWABLE: ReadonlyArray<StepState> = ["review", "accepted", "revise", "rejected"]

const parseRelay = (relay: string): Effect.Effect<{ channel: string; words: string }, ToolError> => {
  const at = relay.indexOf(":")
  const channel = at === -1 ? "" : relay.slice(0, at).trim()
  const words = at === -1 ? "" : relay.slice(at + 1).trim()
  return channel === "" || words === ""
    ? fail("invalid", `--relay ${JSON.stringify(relay)}: expected "<where they answered>: <their words, verbatim>"`, { fix: `for example --relay "chat: yes, ship the barrel"` })
    : Effect.succeed({ channel, words })
}

const delivered = (context: RunContext): Effect.Effect<void, ToolError> =>
  context.ref.delivered || context.ref.run.deliveredTo !== undefined
    ? fail("conflict", `run ${runKey(context.ref.run)} is delivered and no longer changes`, { fix: `start a new attempt: jam run start ${context.ref.run.recipe} ${context.ref.run.id} --brief <file>` })
    : Effect.void

export const reviewStep = (input: ReviewInput): Effect.Effect<ReviewResult, ToolError, Runs | Stamps | Checks | Engine> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const opened = yield* runs.open(input.run)
    const step = yield* Effect.try({ try: () => stepOf(opened.recipe, input.step), catch: (cause) => cause as ToolError })
    const relay = input.relay === undefined ? null : yield* parseRelay(input.relay)
    const result = yield* runs.mutate(opened.ref.path, (run) =>
      Effect.gen(function*() {
        const context: RunContext = { ...opened, ref: { ...opened.ref, run } }
        yield* delivered(context)
        const status = (yield* computeStatus(context)).steps.find((candidate) => candidate.step === step.id)!
        const record = latestRecord(run, step.id)
        if (record === undefined || !REVIEWABLE.includes(status.state)) {
          return yield* fail("conflict", `step ${step.id} cannot be reviewed: it is ${status.state}${status.reason === undefined ? "" : ` (${status.reason})`}`, {
            fix: record === undefined ? `record it first: jam run record ${run.id} ${step.id} ...` : `"jam run next ${run.id}" says what it needs`
          })
        }
        if (input.record !== undefined && input.record !== record.id) {
          return yield* fail("conflict", `--record ${input.record} is not the current record of ${step.id} (${record.id}); the step was recorded again`, { fix: "review the current candidate, or drop --record" })
        }
        const gate = gateFor(context.config.review.mode, step.review, run.human.includes(step.id))
        if (input.decision === "accept" && gate.required === "human" && relay === null) {
          return yield* fail("forbidden", `step ${step.id} needs a person's acceptance${gate.because === undefined ? "" : ` (${gate.because})`}`, {
            fix: `ask them in the catalog (jam run request-review ${run.id} ${step.id}) or relay their answer: --accept --relay "<where they answered>: <their words>"`
          })
        }
        const reason = input.reason?.trim() || relay?.words || ""
        if (reason === "") {
          return yield* fail("invalid", "--reason is required: what was checked, or what must change", { fix: `add --reason "<...>"` })
        }
        const review: Review = {
          decision: input.decision,
          actor: relay === null ? "agent" : "human",
          via: relay === null ? "direct" : "relay",
          reason,
          ...(input.by === undefined ? {} : { by: input.by }),
          ...(relay === null ? {} : { channel: relay.channel, words: relay.words }),
          at: yield* nowIso
        }
        const next = updateLatest(run, step.id, (current) => ({ ...current, reviews: [...current.reviews, review] }))
        return [next, { record: record.id, review, gate, context: { ...context, ref: { ...context.ref, run: next } } }] as const
      }))
    const after = yield* computeStatus(result.context)
    return {
      id: opened.ref.run.id,
      step: step.id,
      record: result.record,
      decision: input.decision,
      actor: result.review.actor,
      via: result.review.via,
      state: after.steps.find((candidate) => candidate.step === step.id)?.state ?? "review",
      gate: result.gate
    }
  })

export const skipStep = (input: { readonly run: string; readonly step: string; readonly reason: string }): Effect.Effect<{ id: string; step: string; state: "skipped" }, ToolError, Runs> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const opened = yield* runs.open(input.run)
    const step = yield* Effect.try({ try: () => stepOf(opened.recipe, input.step), catch: (cause) => cause as ToolError })
    if (!step.optional) {
      return yield* fail("forbidden", `step ${step.id} of recipe ${opened.recipe.id} is not optional`, {
        fix: `do the step, or make it optional for this project: jam recipe set ${opened.recipe.id} ${step.id} --optional true`
      })
    }
    if (input.reason.trim() === "") return yield* fail("invalid", "--reason is required: why this run does not need the step")
    yield* delivered(opened)
    yield* runs.mutate(opened.ref.path, (run) => Effect.map(nowIso, (at) => [setSkip(run, step.id, { reason: input.reason.trim(), at }), null] as const))
    return { id: opened.ref.run.id, step: step.id, state: "skipped" as const }
  })

export interface Synced {
  readonly context: RunContext
  /** By step: the reviews no person has decided yet, with where each can be opened now. */
  readonly waiting: ReadonlyMap<string, ReviewRequest>
}

/**
 * Bring a person's catalog decisions into the run record, so the ledger shows who accepted what
 * even where the catalog is not at hand. A verdict is written once per submission. A desk that
 * cannot be reached leaves the step waiting.
 */
export const syncVerdicts = (context: RunContext): Effect.Effect<Synced, ToolError, Runs | ReviewDesk> =>
  Effect.gen(function*() {
    const desk = yield* ReviewDesk
    const runs = yield* Runs
    const decided: Array<{ step: string; record: string; review: Review }> = []
    const waiting = new Map<string, ReviewRequest>()
    for (const step of context.recipe.steps) {
      const record = latestRecord(context.ref.run, step.id)
      const submission = record?.submission
      if (record === undefined || submission === undefined || record.reviews.some((review) => review.submission === submission.id)) continue
      const verdict = yield* desk.verdict(submission.id).pipe(Effect.catch(() => Effect.succeed(PENDING)))
      if (verdict.state === "pending") {
        waiting.set(step.id, verdict.request ?? { submission: submission.id, route: submission.route })
        continue
      }
      const at = yield* nowIso
      // A verdict an agent relayed into the catalog stays a relay here too, with the person's words.
      const who = verdict.relay === undefined
        ? { actor: "human", via: "catalog", by: verdict.by, submission: submission.id, at } as const
        : { actor: "human", via: "relay", by: verdict.by, channel: verdict.relay.channel, words: verdict.relay.words, submission: submission.id, at } as const
      decided.push({
        step: step.id,
        record: record.id,
        review: verdict.state === "accepted"
          ? { decision: "accept", reason: verdict.comment ?? "approved in the catalog", ...who }
          : { decision: verdict.rejected ? "reject" : "revise", reason: verdict.reason, ...who }
      })
    }
    if (decided.length === 0) return { context, waiting }
    const apply = (run: Run): Run =>
      decided.reduce((next, entry) => updateLatest(next, entry.step, (record) => (record.id === entry.record ? { ...record, reviews: [...record.reviews, entry.review] } : record)), run)
    // A run that another command holds is judged with the verdicts all the same; they are written next time.
    const written = yield* runs.mutate(context.ref.path, (run) => Effect.succeed([apply(run), apply(run)] as const)).pipe(
      Effect.catch(() => Effect.succeed(apply(context.ref.run)))
    )
    return { context: { ...context, ref: { ...context.ref, run: written } }, waiting }
  })

/** A run's status with a person's catalog decisions applied and, for reviews still waiting, where to open them. */
export const reviewedStatus = (context: RunContext): Effect.Effect<{ readonly context: RunContext; readonly status: RunStatus }, ToolError, Runs | ReviewDesk | Stamps | Checks | Engine> =>
  Effect.gen(function*() {
    const synced = yield* syncVerdicts(context)
    const status = yield* computeStatus(synced.context)
    return {
      context: synced.context,
      status: {
        ...status,
        steps: status.steps.map((step) => {
          const open = synced.waiting.get(step.step)
          return open === undefined || step.review?.submission !== open.submission ? step : { ...step, review: open }
        })
      }
    }
  })

export interface ReviewRequested extends ReviewRequest {
  readonly id: string
  readonly step: string
  readonly record: string
}

/** Ask a person to review a step in the catalog. Asking again for the same record is the same request. */
export const requestReview = (input: { readonly run: string; readonly step: string }): Effect.Effect<ReviewRequested, ToolError, Runs | Stamps | Checks | Engine | ReviewDesk> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const desk = yield* ReviewDesk
    // A decision the person already made is applied first, so a decided step is not asked about again.
    const { context: opened, status: all } = yield* reviewedStatus(yield* runs.open(input.run))
    const { id } = opened.ref.run
    const step = yield* Effect.try({ try: () => stepOf(opened.recipe, input.step), catch: (cause) => cause as ToolError })
    const status = all.steps.find((candidate) => candidate.step === step.id)!
    const record = latestRecord(opened.ref.run, step.id)
    if (record === undefined || status.state !== "review") {
      return yield* fail("conflict", `step ${step.id} is not waiting for review: it is ${status.state}${status.reason === undefined ? "" : ` (${status.reason})`}`, { fix: `"jam run next ${id}" says what it needs` })
    }
    // The desk is where people decide. A gate that needs no person is never put in front of one.
    if (status.gate.required !== "human") {
      return yield* fail("conflict", `step ${step.id} does not wait for a person: its gate is ${status.gate.required}${status.gate.because === undefined ? "" : ` (${status.gate.because})`}`, {
        fix: `review it against its evidence: jam run review ${id} ${step.id} --accept --reason "<why it passes>"; to have a person decide it in this run: jam run set ${id} --human ${step.id}`
      })
    }
    if (status.review !== undefined) return { id, step: step.id, record: record.id, ...status.review }
    const submitted = yield* desk.submit(opened, step, record)
    const at = yield* nowIso
    yield* runs.mutate(opened.ref.path, (run) =>
      Effect.succeed([updateLatest(run, step.id, (current) => (current.id === record.id ? { ...current, submission: { id: submitted.submission, route: submitted.route, at } } : current)), null] as const))
    return { id, step: step.id, record: record.id, ...submitted }
  })
