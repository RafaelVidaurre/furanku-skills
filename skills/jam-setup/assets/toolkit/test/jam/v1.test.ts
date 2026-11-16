import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { openJob, updateJobState } from "../../src/jam/runs/jobs.ts"
import { Runs } from "../../src/jam/runs/Runs.ts"
import type { Run } from "../../src/jam/runs/schema.ts"
import { sha256 } from "../../src/kernel/hash.ts"
import { CONFIG, glb, jam, jamFailure, jamProject, png, PROP_BUDGET, readJson, write } from "./fixtures.ts"
import { record, review, stateOf, status, stepStatus } from "./flow.ts"

const DIR = "work/.scratch/table/v3"
const stamp = (root: string, path: string) => ({ path, sha256: sha256(readFileSync(join(root, path))) })

/** A version 1 run.json as version 1 wrote it: accepted concept, turnaround, mesh and topology, one paid job. */
const v1Project = async (config: Record<string, unknown> = {}, run: Record<string, unknown> = {}) => {
  const root = jamProject({ config: { spend: { meshy: { perRun: 50 } }, ...config } })
  const views = ["front", "left", "back", "right", "three-quarter"]
  write(root, `${DIR}/brief.md`, "A tavern table")
  write(root, `${DIR}/concept.png`, png(8, 8))
  write(root, `${DIR}/request.json`, "{}")
  write(root, `${DIR}/crops.json`, "{}")
  write(root, `${DIR}/origin.md`, "origin")
  views.forEach((view, index) => write(root, `${DIR}/${view}.png`, png(8, 8, [index * 30, 10, 10])))
  write(root, `${DIR}/mesh.glb`, await glb({ triangles: 1800 }))
  write(root, `${DIR}/final.glb`, await glb({ triangles: 1000 }))
  const human = (id: string) => [{ record: id, actor: "human", by: "Sam", source: "chat 2026-11-10", decision: "accept", reason: "approved", at: "2026-11-10T10:00:00.000Z" }]
  const base = { inputs: [], evidence: [stamp(root, `${DIR}/origin.md`)], note: "made", metrics: {}, reviews: [] as Array<unknown> }
  write(root, `${DIR}/run.json`, JSON.stringify({
    version: 1,
    id: "table",
    profile: "prop",
    created: "2026-11-10T09:00:00.000Z",
    exploration: false,
    context: { profile: {}, style: { revision: null, document: stamp(root, "work/style.md"), references: [] } },
    brief: stamp(root, `${DIR}/brief.md`),
    humanStages: ["delivery"],
    stages: {
      concept: [{ ...base, id: "c-1", created: "2026-11-10T09:10:00.000Z", files: [stamp(root, `${DIR}/concept.png`)], dependencies: {}, provenance: { provider: "meshy", model: "image-1", transport: "cli", job: "job-uuid-1" }, inputs: [stamp(root, `${DIR}/request.json`)], reviews: human("c-1") }],
      turnaround: [{ ...base, id: "t-1", created: "2026-11-10T09:20:00.000Z", files: views.map((view) => stamp(root, `${DIR}/${view}.png`)), views: Object.fromEntries(views.map((view) => [view, `${DIR}/${view}.png`])), evidence: [stamp(root, `${DIR}/crops.json`)], dependencies: { concept: "c-1" }, provenance: { provider: "local", model: "crop tool", transport: "python" }, reviews: human("t-1") }],
      mesh: [{ ...base, id: "m-1", created: "2026-11-10T09:30:00.000Z", files: [stamp(root, `${DIR}/mesh.glb`)], runtimeModel: `${DIR}/mesh.glb`, dependencies: { turnaround: "t-1" }, provenance: { provider: "local", model: "Blender 4.2", transport: "blender-mcp" }, reviews: [{ record: "m-1", actor: "agent", by: "worker", source: "self", decision: "accept", reason: "ok", at: "2026-11-10T09:31:00.000Z" }] }],
      topology: [{ ...base, id: "p-1", created: "2026-11-10T09:40:00.000Z", files: [stamp(root, `${DIR}/final.glb`)], runtimeModel: `${DIR}/final.glb`, dependencies: { mesh: "m-1" }, metrics: { triangles: 1000, materials: 1, textureDimensions: [], textureMiB: 0 }, provenance: { provider: "local", model: "Blender 4.2", transport: "blender-mcp" }, reviews: human("p-1") }]
    },
    jobs: [
      { id: "job-uuid-1", stage: "concept", provider: "meshy", transport: "cli", scope: "team", operation: "image", request: stamp(root, `${DIR}/request.json`), estimate: 5, unit: "credits", priceKind: "estimate", priceSource: "price page", priceDate: "2026-11-10", authorization: "Sam approved", state: "succeeded", created: "2026-11-10T09:05:00.000Z", jobId: "task-1", actual: 4, history: [{ state: "submitted", jobId: "task-1", evidence: "accepted", at: "2026-11-10T09:06:00.000Z" }, { state: "succeeded", actual: 4, evidence: "billing", at: "2026-11-10T09:09:00.000Z" }] },
      { id: "job-uuid-2", stage: "mesh", provider: "meshy", transport: "cli", scope: "team", operation: "mesh", request: stamp(root, `${DIR}/origin.md`), estimate: 20, unit: "credits", priceKind: "quote", priceSource: "dry run", priceDate: "2026-11-10", authorization: "Sam approved", state: "unknown", created: "2026-11-10T09:25:00.000Z", history: [{ state: "unknown", evidence: "response lost", at: "2026-11-10T09:26:00.000Z" }] }
    ],
    ...run
  }))
  return root
}

describe("version 1 runs", () => {
  it("are read as runs of the asset recipe, with their records, decisions and jobs intact", async () => {
    const root = await v1Project()
    const ref = await jam(root, Effect.flatMap(Runs, (runs) => runs.find("table")))
    assert.deepEqual([ref.path, ref.run.recipe, ref.run.n, ref.run.budget, ref.run.migratedFrom], [`${DIR}/run.json`, "asset", 3, "prop", 1])
    assert.deepEqual(ref.run.human, ["delivery"])
    const concept = ref.run.steps["concept"]!.records[0]!
    assert.deepEqual(concept.provenance, { kind: "job", job: "job-uuid-1", provider: "meshy", tool: "image-1 via cli" })
    assert.deepEqual(concept.reviews[0], { decision: "accept", actor: "human", via: "v1", reason: "approved", by: "Sam", channel: "chat 2026-11-10", at: "2026-11-10T10:00:00.000Z" })
    assert.deepEqual(ref.run.steps["turnaround"]!.records[0]!.files.map((file) => `${file.role}:${file.key}`), ["view:front", "view:left", "view:back", "view:right", "view:three-quarter"])
    assert.deepEqual(ref.run.jobs.map((job) => [job.id, job.step, job.state, job.price.kind, job.providerJob ?? null]), [["job-uuid-1", "concept", "succeeded", "estimate", "task-1"], ["job-uuid-2", "mesh", "lost", "quote", null]])
    // The policy in force is the recipe's: mesh and topology are agent gates here, the others need the recorded human decisions.
    const now = await status(root, "table")
    assert.deepEqual(now.steps.map((step) => [step.step, step.state]), [["concept", "accepted"], ["turnaround", "accepted"], ["mesh", "accepted"], ["topology", "accepted"], ["uv", "ready"], ["texture", "waiting"], ["delivery", "waiting"]])
    assert.deepEqual(now.unsettledJobs, ["job-uuid-2"])
    assert.equal(readJson<{ version: number }>(root, `${DIR}/run.json`).version, 1, "reading rewrites nothing")
  })

  it("follow the same rules as new runs: measured budgets, staleness, and the duplicate-request block", async () => {
    const root = await v1Project()
    write(root, "jam.config.json", JSON.stringify({ ...CONFIG, spend: { meshy: { perRun: 50 } }, budgets: { prop: { ...PROP_BUDGET, triangles: { target: 500, max: 900 } } } }))
    assert.match((await stepStatus(root, "table", "topology")).reason!, /1000 triangles is over the budget of 900/)
    write(root, "jam.config.json", JSON.stringify({ ...CONFIG, spend: { meshy: { perRun: 50 } } }))
    write(root, `${DIR}/concept.png`, png(8, 8, [1, 2, 3]))
    assert.equal(await stateOf(root, "table", "concept"), "stale")
    assert.equal(await stateOf(root, "table", "turnaround"), "blocked")
    // A lost version 1 job still blocks the same request in a new run.
    const { start } = await import("./flow.ts")
    await start(root, "asset", "chair", { budget: "prop" })
    const blocked = await jamFailure(root, openJob({ run: "chair", step: "concept", provider: "meshy", operation: "image", estimate: 1, request: `${DIR}/origin.md`, price: "estimate", priceSource: "x", authorized: "Sam" }))
    assert.match(blocked.message, /still unsettled as job job-uuid-2 \(lost\) of run table:3/)
  })

  it("continue under the new commands; the file is upgraded when it is first changed", async () => {
    const root = await v1Project({ review: { mode: "agent" } })
    await record(root, "table", ["uv", "texture"], { files: [`model=${DIR}/final.glb`], accept: "unwrapped and textured" })
    const run = readJson<Run>(root, `${DIR}/run.json`)
    assert.deepEqual([run.version, run.migratedFrom, run.recipe], [2, 1, "asset"])
    assert.equal(run.steps["topology"]!.records[0]!.id, "p-1", "earlier records keep their ids")
    assert.deepEqual(run.steps["uv"]!.records[0]!.dependencies, { topology: "p-1" })
    assert.match((await (await import("./flow.ts")).recordFailure(root, "table", "delivery", { files: [`model=${DIR}/final.glb`] })).message, /provider job job-uuid-2 is not settled/)
    await jam(root, updateJobState({ run: "table", job: "job-uuid-2", to: "cancelled", evidence: "task list shows no such task" }))
    await record(root, "table", "delivery", { files: [`model=${DIR}/final.glb`], accept: "final" })
    assert.equal(await stateOf(root, "table", "delivery"), "review", "the run asked for a person on delivery under version 1, and still does")
    await review(root, "table", "delivery", { relay: "chat: ship it" })
    assert.equal((await status(root, "table")).settled, true)
  })

  it("map to the recipe the migration wrote for their profile, with steps version 1 never had read as skipped", async () => {
    const root = await v1Project({}, {})
    write(root, "jam/recipes/prop.json", JSON.stringify({ version: 1, id: "prop", extends: "builtin:prop", budget: "prop", steps: [{ id: "uv", review: "human" }] }))
    const now = await status(root, "table")
    assert.equal(now.recipe, "prop")
    assert.deepEqual(now.steps.filter((step) => ["collision", "import"].includes(step.step)).map((step) => [step.state, step.reason]), [
      ["skipped", "this run was started with toolkit version 1, which had no such step"],
      ["skipped", "this run was started with toolkit version 1, which had no such step"]
    ])
    assert.equal(now.steps.find((step) => step.step === "uv")!.gate.required, "human")
  })

  it("exploration and provider-test runs keep their limits", async () => {
    const explore = await v1Project({}, { profile: undefined, exploration: true, context: { exploration: true }, stages: {}, jobs: [] })
    assert.deepEqual((await status(explore, "table")).steps.map((step) => step.step), ["concept"])
    assert.equal((await status(explore, "table")).recipe, "image")
    const test = await v1Project({}, { profile: undefined, providerTest: true, context: { providerTest: true }, stages: {} })
    const ref = await jam(test, Effect.flatMap(Runs, (runs) => runs.find("table")))
    assert.deepEqual([ref.run.recipe, ref.run.jobs.map((job) => job.step)], ["provider-test", ["test", "test"]])
    // A run recorded before style revisions existed belongs to the unnamed first revision.
    const legacy = await v1Project({}, { context: { profile: {}, style: [{ path: "work/style.md", sha256: "old" }] } })
    assert.equal(await stateOf(legacy, "table", "concept"), "accepted")
  })
})
