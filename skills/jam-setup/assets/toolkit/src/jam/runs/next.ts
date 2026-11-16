// "What do I do now?" for one run: the step to work, everything needed to do it, and the exact
// command that records it.
import * as Effect from "effect/Effect"
import type { ToolError } from "../../kernel/errors.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { resolveGuide } from "../recipes/guides.ts"
import type { Produces, ResolvedStep } from "../recipes/schema.ts"
import { Toolkit } from "../Toolkit.ts"
import type { ReviewRequest } from "./ReviewDesk.ts"
import type { RunContext } from "./Runs.ts"
import type { Next, RunStatus, StepStatus } from "./status.ts"

export interface NextStep {
  readonly id: string
  readonly title: string
  readonly state: StepStatus["state"]
  readonly reason?: string
  readonly skill?: string
  readonly guide?: { readonly path: string; readonly anchor: string | null }
  /** Base recipes' guides for the same step, read after `guide`. */
  readonly baseGuides: ReadonlyArray<{ readonly path: string; readonly anchor: string | null }>
  readonly reviewer?: string
  readonly needs: ReadonlyArray<string>
  readonly outputs: ReadonlyArray<Produces>
  readonly checks: ReadonlyArray<string>
  readonly gate: StepStatus["gate"]
  readonly paid: boolean
  readonly optional: boolean
  readonly condition?: StepStatus["condition"]
  /** The review a person was asked for, with its link. */
  readonly review?: ReviewRequest
}

/** "waiting for <name>'s review: <link>", the same words wherever a run waits on a person. */
export const waitingText = (review: ReviewRequest, reviewer?: string): string =>
  `waiting for ${review.reviewer ?? reviewer ?? "a person"}'s review: ${review.url ?? review.route}`

export interface NextReport {
  readonly id: string
  readonly n: number
  readonly run: string
  readonly action: Next["action"]
  readonly summary: string
  readonly step?: NextStep
  /** Commands that move the run on, most likely first, each with when it applies. */
  readonly commands: ReadonlyArray<{ readonly when: string; readonly command: string }>
}

const fileFlags = (step: ResolvedStep): string =>
  step.produces.map((output) =>
    output.keys !== undefined
      ? output.keys.map((key) => `--file ${output.role}:${key}=<${output.kind}>`).join(" ")
      : `--file ${step.produces.length === 1 ? "" : `${output.role}=`}<${output.kind}>`).join(" ")

export const outputText = (output: Produces): string =>
  output.keys !== undefined
    ? `${output.role}: one ${output.kind} file per key (${output.keys.join(", ")})`
    : `${output.role}: ${output.max === 1 ? "exactly 1" : `${output.min ?? 1} or more`}${output.max !== undefined && output.max > 1 ? `, at most ${output.max}` : ""} ${output.kind} file${output.max === 1 ? "" : "s"}`

export const describeNext = (context: RunContext, status: RunStatus): Effect.Effect<NextReport, ToolError, ProjectFiles | Toolkit> =>
  Effect.gen(function*() {
    const { id } = context.ref.run
    const base = { id, n: context.ref.run.n, run: context.ref.path, action: status.next.action }
    const next = status.next
    if (next.action === "settle-jobs") {
      return { ...base, summary: `provider jobs ${next.jobs.join(", ")} are not settled`, commands: next.jobs.map((job) => ({ when: "once the provider's outcome is known", command: `jam job done ${id} ${job} --actual <charge> --evidence <reference>` })) }
    }
    if (next.action === "deliver") return { ...base, summary: "every step is settled; the run can be delivered", commands: [{ when: "to deliver", command: `jam run deliver ${id}` }] }
    if (next.action === "done") return { ...base, summary: next.why, commands: [] }
    const step = context.recipe.steps.find((candidate) => candidate.id === next.step)!
    const state = status.steps.find((candidate) => candidate.step === step.id)!
    const guide = step.guide === undefined ? undefined : yield* resolveGuide(step.guide)
    const baseGuides: Array<{ path: string; anchor: string | null }> = []
    for (const reference of step.baseGuides) {
      const resolved = yield* resolveGuide(reference)
      baseGuides.push({ path: resolved.path, anchor: resolved.anchor })
    }
    const detail: NextStep = {
      id: step.id,
      title: step.title,
      state: state.state,
      ...(state.reason === undefined ? {} : { reason: state.reason }),
      ...(step.skill === undefined ? {} : { skill: step.skill }),
      ...(guide === undefined ? {} : { guide: { path: guide.path, anchor: guide.anchor } }),
      baseGuides,
      ...(step.reviewer === undefined ? {} : { reviewer: step.reviewer }),
      needs: step.needs,
      outputs: step.produces,
      checks: step.checks,
      gate: state.gate,
      paid: step.paid,
      optional: step.optional,
      ...(state.condition === undefined ? {} : { condition: state.condition }),
      ...(state.review === undefined ? {} : { review: state.review })
    }
    if (next.action === "review") {
      const human = next.gate === "human"
      const asked = human ? state.review : undefined
      return {
        ...base,
        step: detail,
        summary: asked !== undefined
          ? `${step.id} is ${waitingText(asked, step.reviewer)}${asked.url === undefined && asked.hint !== undefined ? `\n${asked.hint}` : ""}`
          : human ? `${step.id} waits for ${step.reviewer ?? "a person"}'s acceptance` : `${step.id} waits for review`,
        commands: [
          ...(human
            ? [
              asked !== undefined
                ? { when: "to see whether they decided", command: `jam run status ${id}` }
                : { when: "to ask the person in the catalog", command: `jam run request-review ${id} ${step.id}` },
              { when: "when the person answered you directly", command: `jam run review ${id} ${step.id} --accept --relay "<where they answered>: <their words>"` }
            ]
            : [{ when: "when it passes against its evidence", command: `jam run review ${id} ${step.id} --accept --reason "<why it passes>"` }]),
          { when: "when it must change", command: `jam run review ${id} ${step.id} --revise --reason "<what must change>"` }
        ]
      }
    }
    const substituted = step.run?.map((token) => token.replaceAll("{id}", id).replaceAll("{run}", context.ref.path).replaceAll("{dir}", context.ref.dir))
    const entering = context.ref.run.entry === step.id
    const record = `jam run record ${id} ${step.id} ${[fileFlags(step), "--evidence <path>", `--note "<what was done>"`, entering ? "--source <origin> --source-evidence <path>" : `--tool "<tool and version>"`].filter((part) => part !== "").join(" ")}`
    return {
      ...base,
      step: detail,
      summary: `${step.id} (${step.title}): ${next.why}`,
      commands: [
        ...(substituted === undefined ? [] : [{
          when: substituted.some((token) => /<[^>]+>/.test(token)) ? "to do it with the toolkit, filling in the <...> parts" : "to have the toolkit do and record it",
          command: `jam ${substituted.map((token) => (/\s/.test(token) && !token.startsWith("\"") ? JSON.stringify(token) : token)).join(" ")}`
        }]),
        { when: substituted === undefined ? "when the work is done" : "when it was done by hand", command: record },
        // A step the toolkit does itself opens and settles its own jobs.
        ...(step.paid && substituted === undefined ? [{ when: "before submitting anything to a paid provider", command: `jam job open ${id} ${step.id} --provider <id> --operation "<model and operation>" --estimate <n> --request <file> --price-source "<where the estimate came from>"` }] : []),
        ...(step.optional ? [{ when: "when this run does not need the step", command: `jam run skip ${id} ${step.id} --reason "<why>"` }] : [])
      ]
    }
  })
