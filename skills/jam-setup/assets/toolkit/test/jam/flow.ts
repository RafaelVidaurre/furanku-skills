// Shorthand for driving a run in tests through the same operations the commands call.
import * as Effect from "effect/Effect"
import type { JamOptions } from "../../src/jam/layers.ts"
import { type RecordInput, recordSteps } from "../../src/jam/runs/record.ts"
import { type ReviewInput, reviewStep } from "../../src/jam/runs/review.ts"
import { Runs } from "../../src/jam/runs/Runs.ts"
import type { Run } from "../../src/jam/runs/schema.ts"
import { type StartInput, startRun } from "../../src/jam/runs/start.ts"
import { computeStatus, type RunStatus, type StepStatus } from "../../src/jam/runs/status.ts"
import { glb, jam, jamFailure, png, readJson, turnaround, write } from "./fixtures.ts"

export const start = (root: string, recipe: string, id: string, extra: Partial<StartInput> = {}, options?: JamOptions) =>
  jam(root, startRun({ recipe, id, briefText: `Brief for ${id}`, human: [], ...extra }), options)

const recordInput = (id: string, steps: string | ReadonlyArray<string>, input: Partial<RecordInput>): RecordInput => ({
  run: id,
  steps: typeof steps === "string" ? [steps] : steps,
  files: [],
  evidence: [],
  inputs: [],
  note: "done",
  ...(input.files === undefined || input.files.length === 0 || input.job !== undefined || input.source !== undefined ? {} : { tool: "test tool 1.0" }),
  ...input
})

export const record = (root: string, id: string, steps: string | ReadonlyArray<string>, input: Partial<RecordInput> = {}, options?: JamOptions) =>
  jam(root, recordSteps(recordInput(id, steps, input)), options)

export const recordFailure = (root: string, id: string, steps: string | ReadonlyArray<string>, input: Partial<RecordInput> = {}, options?: JamOptions) =>
  jamFailure(root, recordSteps(recordInput(id, steps, input)), options)

export const review = (root: string, id: string, step: string, input: Partial<ReviewInput> = {}, options?: JamOptions) =>
  jam(root, reviewStep({ run: id, step, decision: "accept", reason: "checked against its evidence", ...input }), options)

export const reviewFailure = (root: string, id: string, step: string, input: Partial<ReviewInput> = {}) =>
  jamFailure(root, reviewStep({ run: id, step, decision: "accept", reason: "checked against its evidence", ...input }))

export const status = (root: string, id: string, options?: JamOptions): Promise<RunStatus> =>
  jam(root, Effect.gen(function*() {
    return yield* computeStatus(yield* (yield* Runs).open(id))
  }), options)

export const stepStatus = async (root: string, id: string, step: string, options?: JamOptions): Promise<StepStatus> =>
  (await status(root, id, options)).steps.find((candidate) => candidate.step === step)!

export const stateOf = async (root: string, id: string, step: string, options?: JamOptions): Promise<string> => (await stepStatus(root, id, step, options)).state

export const runFile = (root: string, id: string, n = 1): Run => readJson<Run>(root, `work/.scratch/${id}/${n}/run.json`)

export interface Made {
  readonly dir: string
  readonly concept: string
  readonly views: ReadonlyArray<string>
  readonly model: string
}

/** Write the files of a small asset into a run folder. */
export const makeFiles = async (root: string, id: string, n = 1, triangles = 1000): Promise<Made> => {
  const dir = `work/.scratch/${id}/${n}`
  write(root, `${dir}/concept.png`, png(16, 16))
  write(root, `${dir}/model.glb`, await glb({ triangles, texture: 4 }))
  return { dir, concept: `${dir}/concept.png`, views: turnaround(root, `${dir}/views`), model: `${dir}/model.glb` }
}

/**
 * Take a run from concept through texture with agent self-review (the project must allow it:
 * review.mode "agent"). The turnaround is declared symmetric so no image tool is needed.
 */
export const throughTexture = async (root: string, id: string, options?: JamOptions): Promise<Made> => {
  const made = await makeFiles(root, id)
  await record(root, id, "concept", { files: [made.concept], accept: "matches the brief" }, options)
  await record(root, id, "turnaround", { files: made.views, symmetric: true, accept: "five consistent views" }, options)
  await record(root, id, "mesh", { files: [made.model], accept: "watertight" }, options)
  await record(root, id, ["topology", "uv", "texture"], { files: [`model=${made.model}`], accept: "within budget" }, options)
  return made
}

export const AGENT_MODE = { review: { mode: "agent" } }
