// `jam run …` and `jam job …`.
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Effect from "effect/Effect"
import { Output } from "../../kernel/cli.ts"
import { fail } from "../../kernel/errors.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { csv, described, flag, many, maybe, text } from "../cliSupport.ts"
import type { EngineAsset } from "../engine/schema.ts"
import { lines, pairs, table } from "../text.ts"
import { deliverRun } from "./deliver.ts"
import { listJobs, openJob, updateJobState } from "./jobs.ts"
import { describeNext, outputText, waitingText } from "./next.ts"
import { recordSteps } from "./record.ts"
import { requestReview, reviewedStatus, reviewStep, skipStep } from "./review.ts"
import { Runs } from "./Runs.ts"
import { runKey } from "./schema.ts"
import { setRun, startRun } from "./start.ts"
import type { RunStatus, StepStatus } from "./status.ts"

const runId = Argument.String("id").pipe(Argument.withDescription("The run's subject id (the newest attempt); <id>:<n> names an earlier attempt"))
const stepArg = Argument.String("step").pipe(Argument.withDescription("A step of the run's recipe"))

const gateText = (status: RunStatus["steps"][number]): string => {
  const who = status.gate.required === "human" && status.reviewer !== undefined ? ` by ${status.reviewer}` : ""
  return status.gate.because === undefined ? `${status.gate.required}${who}` : `${status.gate.required}${who} (recipe: ${status.gate.recipe})`
}

/** Who accepted a step, when a person did: the channel is part of the answer. */
const acceptedBy = (step: StepStatus): string | undefined => {
  const decided = step.decided
  if (step.state !== "accepted" || decided === undefined || decided.actor !== "human") return undefined
  const who = decided.by ?? "a person"
  return decided.via === "catalog" ? `accepted by ${who} in the catalog` : decided.via === "relay" ? `accepted by ${who}, relayed${decided.channel === undefined ? "" : ` from ${decided.channel}`}` : `accepted by ${who}`
}

/** One line per catalog server hint, however many steps wait on it. */
const hintsOf = (steps: ReadonlyArray<StepStatus>): ReadonlyArray<string> =>
  [...new Set(steps.flatMap((step) => (step.state === "review" && step.review?.hint !== undefined ? [step.review.hint] : [])))]

const statusText = (status: RunStatus): string =>
  lines(
    `${status.id}:${status.n}  recipe ${status.recipe}${status.budget === null ? "" : `  budget ${status.budget}`}${status.delivered ? "  delivered" : ""}`,
    status.run,
    table(["step", "state", "gate", "why"], status.steps.map((step) => [
      step.step,
      step.state,
      gateText(step),
      [
        step.state === "review" && step.review !== undefined ? waitingText(step.review, step.reviewer) : undefined,
        step.reason,
        acceptedBy(step),
        step.condition === undefined ? undefined : `when ${step.condition.when}: ${step.condition.met ? "holds" : "does not hold"}`
      ].filter((part) => part !== undefined).join("; ")
    ])),
    status.unsettledJobs.length > 0 ? `unsettled jobs: ${status.unsettledJobs.join(", ")}` : null,
    ...hintsOf(status.steps),
    status.delivered ? `delivered; a change starts a new attempt: jam run start ${status.recipe} ${status.id} --brief <file>` : `next: jam run next ${status.id}`
  )

const start = Command.make("start", {
  recipe: Argument.String("recipe").pipe(Argument.withDescription("Recipe id; \"jam recipe list\" says what each is for")),
  id: Argument.String("id").pipe(Argument.withDescription("Subject id: what is being made, e.g. oak-barrel")),
  brief: text("brief", "File that says what is wanted"),
  briefText: text("brief-text", "The brief itself, written to brief.md in the run folder"),
  budget: text("budget", "Budget name from jam.config.json (default: the recipe's)"),
  human: text("human", "Comma-separated steps a person must accept in this run, whatever the recipe says"),
  from: text("from", "Start at this step from existing work; the steps before it are not needed"),
  dir: text("dir", "Run folder (default: <scratch root>/<id>/<n>)")
}, (input) =>
  Effect.gen(function*() {
    const result = yield* startRun({
      recipe: input.recipe,
      id: input.id,
      brief: maybe(input.brief),
      briefText: maybe(input.briefText),
      budget: maybe(input.budget),
      human: csv(input.human),
      from: maybe(input.from),
      dir: maybe(input.dir)
    })
    yield* (yield* Output).emit(result, lines(`started ${result.id}:${result.n} with recipe ${result.recipe}`, result.run, ...result.notes.map((note) => `note: ${note}`), `next: ${result.next}`))
  })).pipe(described(
    "Start a run: one attempt of a recipe for one subject. Give the brief as a file or as text.",
    `jam run start prop oak-barrel --brief-text "A weathered oak barrel, about 1 m tall"`
  ))

const next = Command.make("next", { id: runId }, ({ id }) =>
  Effect.gen(function*() {
    const { context, status } = yield* reviewedStatus(yield* (yield* Runs).open(id))
    const report = yield* describeNext(context, status)
    const step = report.step
    yield* (yield* Output).emit(report, lines(
      `${report.id}:${report.n}  ${report.summary}`,
      step === undefined ? null : pairs([
        ["skill", step.skill],
        ["guide", step.guide === undefined ? undefined : `${step.guide.path}${step.guide.anchor === null ? "" : `#${step.guide.anchor}`}`],
        ["then", step.baseGuides.map((guide) => `${guide.path}${guide.anchor === null ? "" : `#${guide.anchor}`}`).join(", ") || undefined],
        ["needs", step.needs.join(", ") || undefined],
        ["outputs", step.outputs.map(outputText).join("; ") || undefined],
        ["checks", step.checks.join(", ") || undefined],
        ["gate", `${step.gate.required}${step.gate.required === "human" && step.reviewer !== undefined ? ` by ${step.reviewer}` : ""}${step.gate.because === undefined ? "" : ` (${step.gate.because})`}`],
        ["paid", step.paid ? "may open provider jobs" : undefined],
        ["when", step.condition?.when]
      ]),
      ...report.commands.map((entry) => `${entry.when}:\n  ${entry.command}`)
    ))
  })).pipe(described(
    "Say what to do next for a run: the step, its skill and guide, required outputs, checks, gate, and the command that records it.",
    "jam run next oak-barrel"
  ))

const status = Command.make("status", { id: runId.pipe(Argument.optional) }, ({ id }) =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const output = yield* Output
    const one = maybe(id)
    if (one !== undefined) {
      const result = (yield* reviewedStatus(yield* runs.open(one))).status
      return yield* output.emit(result, statusText(result))
    }
    const scan = yield* runs.scan
    const open: Array<RunStatus> = []
    for (const ref of scan.runs) {
      if (ref.delivered || ref.run.deliveredTo !== undefined) continue
      const reviewed = yield* runs.open(runKey(ref.run)).pipe(Effect.flatMap(reviewedStatus), Effect.catch(() => Effect.succeed(null)))
      if (reviewed !== null) open.push(reviewed.status)
    }
    // A run waiting on a person says where they decide, so nobody has to ask for the link.
    const waitingOn = (run: RunStatus): string => {
      const next = run.next
      const step = next.action === "review" ? run.steps.find((candidate) => candidate.step === next.step) : undefined
      return step?.review === undefined ? "" : waitingText(step.review)
    }
    yield* output.emit({ runs: open, unreadable: scan.unreadable }, lines(
      table(["run", "recipe", "next", "step", "why"], open.map((run) => [`${run.id}:${run.n}`, run.recipe, run.next.action, "step" in run.next ? run.next.step : "", waitingOn(run)])),
      ...hintsOf(open.flatMap((run) => run.steps)),
      ...scan.unreadable.map((file) => `unreadable: ${file.path} (${file.message})`)
    ))
  })).pipe(described(
    "Show every step of a run with its state and reason. Without an id: every run that is not delivered.",
    "jam run status oak-barrel"
  ))

const where = Command.make("where", { id: runId }, ({ id }) =>
  Effect.gen(function*() {
    const ref = yield* (yield* Runs).find(id)
    yield* (yield* Output).emit({ id: ref.run.id, n: ref.run.n, run: ref.path, dir: ref.dir, delivered: ref.delivered }, ref.path)
  })).pipe(described("Print the path of a run's record file.", "jam run where oak-barrel"))

const engineAssetOf = (spec: string): EngineAsset => {
  const at = spec.indexOf("=")
  return at > 0 && /^[a-z0-9-]+$/.test(spec.slice(0, at)) ? { kind: spec.slice(0, at), id: spec.slice(at + 1) } : { kind: "asset", id: spec }
}

const record = Command.make("record", {
  id: runId,
  steps: Argument.String("step").pipe(Argument.withDescription("The step recorded; several when one operation produced them all (they share the files)"), Argument.variadic({ min: 1 })),
  file: many("file", "Output file as [role[:key]=]path; the role may be left out when the step has one. Repeat per file."),
  evidence: many("evidence", "What a reviewer looks at, as [label=]path. Repeat per file."),
  input: many("input", "A file the step consumed beyond the steps it needs. Repeat per file."),
  note: text("note", "What was done, or why existing files suffice (required)"),
  tool: text("tool", "Local work: the tool and its version"),
  job: text("job", "Paid result: the succeeded job it came from (<job>, or <run>/<job> for another run's)"),
  source: text("source", "Imported work: where it came from (needs --source-evidence)"),
  sourceEvidence: text("source-evidence", "Imported work: a document showing the origin and the right to use it"),
  accept: text("accept", "Agent self-review reason; applies to each step whose gate allows agent review"),
  metric: many("metric", "A measured value you expect, as name=value; refused when the tool measures otherwise"),
  symmetric: flag("symmetric", "The subject's sides are identical, so a turnaround may reuse one side view"),
  engineAsset: many("engine-asset", "Engine asset id of work imported by hand, as [kind=]id")
}, (input) =>
  Effect.gen(function*() {
    const result = yield* recordSteps({
      run: input.id,
      steps: input.steps,
      files: input.file,
      evidence: input.evidence,
      inputs: input.input,
      note: maybe(input.note),
      tool: maybe(input.tool),
      job: maybe(input.job),
      source: maybe(input.source),
      sourceEvidence: maybe(input.sourceEvidence),
      accept: maybe(input.accept),
      metrics: input.metric,
      symmetric: input.symmetric,
      engineAssets: input.engineAsset.map(engineAssetOf)
    })
    yield* (yield* Output).emit(result, lines(
      table(["step", "state", "gate", "record"], result.records.map((entry) => [entry.step, entry.state, entry.gate.required, entry.record])),
      ...result.records.flatMap((entry) => (entry.note === undefined ? [] : [`note: ${entry.step}: ${entry.note}`])),
      result.metrics?.triangles === undefined ? null : `measured: ${result.metrics.triangles} triangles, ${result.metrics.materials} materials, ${(result.metrics.textureMiB ?? 0).toFixed(2)} MiB of textures`,
      `next: ${result.next}`
    ))
  })).pipe(described(
    "Record a step's result. You state facts with flags; the tool hashes the files, measures models and images, runs the step's checks and refuses the record if any fails. Nothing is written unless everything passes.",
    `jam run record oak-barrel concept --file concept.png --note "Generated from the brief" --tool "image model v2"`
  ))

const skip = Command.make("skip", { id: runId, step: stepArg, reason: text("reason", "Why this run does not need the step (required)") }, (input) =>
  Effect.gen(function*() {
    const result = yield* skipStep({ run: input.id, step: input.step, reason: maybe(input.reason) ?? "" })
    yield* (yield* Output).emit(result, `${result.id}: ${result.step} skipped\nnext: jam run next ${result.id}`)
  })).pipe(described("Skip an optional step, with the reason on record. Later steps treat it as satisfied.", `jam run skip oak-barrel collision --reason "decorative, never touched by the player"`))

const review = Command.make("review", {
  id: runId,
  step: stepArg,
  accept: flag("accept", "Accept the step's current record"),
  revise: flag("revise", "Send it back for changes"),
  reject: flag("reject", "Reject it"),
  reason: text("reason", "What was checked, or what must change (required unless --relay carries it)"),
  relay: text("relay", "A person's decision passed on by an agent, as \"<where they answered>: <their words>\""),
  by: text("by", "Who decided, when that is not whoever runs the command"),
  record: text("record", "Refuse unless this is still the step's current record id")
}, (input) =>
  Effect.gen(function*() {
    const chosen = ([["accept", input.accept], ["revise", input.revise], ["reject", input.reject]] as const).filter(([, on]) => on).map(([name]) => name)
    if (chosen.length !== 1) return yield* fail("invalid", "give exactly one of --accept, --revise, --reject")
    const result = yield* reviewStep({ run: input.id, step: input.step, decision: chosen[0]!, reason: maybe(input.reason), relay: maybe(input.relay), by: maybe(input.by), record: maybe(input.record) })
    yield* (yield* Output).emit(result, `${result.id}: ${result.step} ${result.decision} by ${result.actor}${result.via === "relay" ? " (relayed)" : ""}; now ${result.state}\nnext: jam run next ${result.id}`)
  })).pipe(described(
    "Decide a step's gate. An agent accepts with --accept --reason. A person's decision passed on by an agent is recorded as a relay with the channel and their words; a human gate takes nothing less.",
    `jam run review oak-barrel concept --accept --relay "chat: yes, go with the second one"`
  ))

const request = Command.make("request-review", { id: runId, step: stepArg }, (input) =>
  Effect.gen(function*() {
    const result = yield* requestReview({ run: input.id, step: input.step })
    // The link stands on its own line, so it can be passed on as it is.
    yield* (yield* Output).emit(result, lines(`${result.id}: ${result.step} is waiting for ${result.reviewer === undefined ? "a person" : result.reviewer}'s review at`, result.url ?? result.route, result.url === undefined ? result.hint : null))
  })).pipe(described(
    "Submit a step that needs a person's acceptance to the catalog, and print the review link on its own line (url with --json; without a running catalog server, the route and how to start one). Asking again returns the same review. \"jam run status\" reads the person's decision.",
    "jam run request-review oak-barrel concept"
  ))

const deliver = Command.make("deliver", { id: runId }, ({ id }) =>
  Effect.gen(function*() {
    const result = yield* deliverRun(id)
    yield* (yield* Output).emit(result, `${result.id}:${result.n} delivered to ${result.delivered} (${result.files} files, each verified against its recorded hash)\ncommit that folder when the person wants it versioned`)
  })).pipe(described(
    "Copy everything a finished run stands on into the delivered root, verify each copy against its recorded hash, and refuse anything Git would ignore.",
    "jam run deliver oak-barrel"
  ))

const set = Command.make("set", {
  id: runId,
  budget: text("budget", "Budget name from jam.config.json"),
  human: text("human", "Comma-separated steps a person must accept; added to those already required")
}, (input) =>
  Effect.gen(function*() {
    const result = yield* setRun({ run: input.id, budget: maybe(input.budget), human: csv(input.human) })
    yield* (yield* Output).emit(result, `${result.id}: budget ${result.budget ?? "none"}; a person must accept: ${result.human.join(", ") || "what the recipe says"}`)
  })).pipe(described("Name a run's budget, or require a person for more of its steps. Requirements are only added.", "jam run set oak-barrel --budget prop"))

const unlock = Command.make("unlock", { id: runId }, ({ id }) =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const ref = yield* runs.find(id)
    const holder = yield* (yield* ProjectFiles).breakLock(runs.lockPath(ref.path))
    yield* (yield* Output).emit({ id: ref.run.id, unlocked: true, holder }, `${ref.run.id}: removed the lock left by process ${holder.pid} (${holder.at})`)
  })).pipe(described("Remove a run's lock after a crash. Refused while the process that holds it is alive or cannot be verified.", "jam run unlock oak-barrel"))

export const run = Command.make("run").pipe(
  Command.withDescription("Runs: start, see what is next, record steps, review, deliver"),
  Command.withSubcommands([start, next, status, where, record, skip, review, request, deliver, set, unlock])
)

const jobArg = Argument.String("job").pipe(Argument.withDescription("The job's id in the run, e.g. j1"))
const evidenceFlag = text("evidence", "Where the outcome can be seen: a file, the provider's task id, a billing entry")
const actualFlag = Flag.Finite("actual").pipe(Flag.withDescription("What the provider charged, in its own unit"), Flag.optional)

const jobText = (id: string, job: { id: string; state: string; provider: string; estimate: number; actual?: number | undefined; unit: string }): string =>
  `${id}: job ${job.id} is ${job.state} (${job.provider}, ${job.actual ?? job.estimate} ${job.unit}${job.actual === undefined ? " estimated" : " charged"})`

const jobOpen = Command.make("open", {
  id: runId,
  step: stepArg,
  provider: Flag.String("provider").pipe(Flag.withDescription("Provider id; \"jam provider list\" shows them")),
  operation: Flag.String("operation").pipe(Flag.withDescription("The model and operation being run")),
  estimate: Flag.Finite("estimate").pipe(Flag.withDescription("Expected charge in the provider's own unit")),
  request: Flag.String("request").pipe(Flag.withDescription("Project file holding the request as it will be sent, without credentials or signed URLs")),
  quote: flag("quote", "The estimate is an exact quote from the provider"),
  listPrice: flag("list-price", "The estimate is a published list price"),
  priceSource: text("price-source", "Where the estimate came from (a dry run, a quote, a price page)"),
  authorized: text("authorized", "Who approved this spending, when, in their words (default: the provider's standing authorization)"),
  transport: text("transport", "How it will be submitted: cli, mcp, browser"),
  scope: text("scope", "The account, team or project it is billed to")
}, (input) =>
  Effect.gen(function*() {
    if (input.quote && input.listPrice) return yield* fail("invalid", "give --quote or --list-price, not both")
    const result = yield* openJob({
      run: input.id,
      step: input.step,
      provider: input.provider,
      operation: input.operation,
      estimate: input.estimate,
      request: input.request,
      price: input.quote ? "quote" : input.listPrice ? "list" : "estimate",
      priceSource: maybe(input.priceSource),
      authorized: maybe(input.authorized),
      transport: maybe(input.transport),
      scope: maybe(input.scope)
    })
    yield* (yield* Output).emit(result, `${jobText(result.id, result.job)}\nnext: ${result.next}`)
  })).pipe(described(
    "Open a provider job before submitting anything. Refused when the provider is disabled, a cap would be passed, or the same request is still unsettled in any run.",
    `jam job open oak-barrel mesh --provider <provider> --operation "multiview to 3D" --estimate 20 --request mesh-request.json --price-source "dry run"`
  ))

const transition = (name: string, to: "submitted" | "lost" | "succeeded" | "failed" | "cancelled", description: string, example: string) =>
  Command.make(name, { id: runId, job: jobArg, providerJob: text("provider-job", "The id the provider gave the job"), actual: actualFlag, evidence: evidenceFlag }, (input) =>
    Effect.gen(function*() {
      const result = yield* updateJobState({ run: input.id, job: input.job, to, providerJob: maybe(input.providerJob), actual: maybe(input.actual), evidence: maybe(input.evidence) })
      yield* (yield* Output).emit(result, jobText(result.id, result.job))
    })).pipe(described(description, example))

const jobList = Command.make("list", { open: flag("open", "Only jobs that are not settled"), run: text("run", "Only this run's jobs") }, (input) =>
  Effect.gen(function*() {
    const rows = yield* listJobs({ open: input.open, run: maybe(input.run) })
    yield* (yield* Output).emit({ jobs: rows }, table(
      ["run", "job", "step", "provider", "state", "charge", "operation"],
      rows.map((row) => [row.run, row.job, row.step, row.provider, row.state, `${row.actual ?? `~${row.estimate}`} ${row.unit}`, row.operation])
    ))
  })).pipe(described("List provider jobs across all runs.", "jam job list --open"))

export const job = Command.make("job").pipe(
  Command.withDescription("The paid-operation ledger: open a job before submitting, then record what became of it"),
  Command.withSubcommands([
    jobOpen,
    transition("submitted", "submitted", "Record the provider's job id as soon as the submission is accepted (also when a lost job is found again).", "jam job submitted oak-barrel j1 --provider-job task_8841"),
    transition("done", "succeeded", "Record a finished job with what it really cost.", `jam job done oak-barrel j1 --actual 20 --evidence "task_8841 billing"`),
    transition("failed", "failed", "Record a failed job with what it really cost (a failure is not proof of a refund).", `jam job failed oak-barrel j1 --actual 0 --evidence "task_8841: refunded per billing page"`),
    transition("cancelled", "cancelled", "Record a cancelled job. One that was never submitted needs evidence that the provider has no such job and costs nothing; one the provider cancelled needs --actual.", `jam job cancelled oak-barrel j1 --evidence "task list checked 14:02: no matching task"`),
    transition("lost", "lost", "Record that a submission's response was lost. The job keeps its estimate and blocks a resubmission until it is found or confirmed absent.", "jam job lost oak-barrel j1"),
    jobList
  ])
)
