import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import assert from "node:assert/strict"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { ProjectFiles } from "../../src/kernel/ProjectFiles.ts"
import { requestReview, reviewStep, skipStep } from "../../src/jam/runs/review.ts"
import { ReviewDesk, type Verdict } from "../../src/jam/runs/ReviewDesk.ts"
import { Runs } from "../../src/jam/runs/Runs.ts"
import { setRun, startRun } from "../../src/jam/runs/start.ts"
import { CONFIG, glb, jam, jamFailure, jamProject, png, PROP_BUDGET, readJson, write } from "./fixtures.ts"
import { AGENT_MODE, makeFiles, record, recordFailure, review, reviewFailure, runFile, start, stateOf, status, stepStatus, throughTexture } from "./flow.ts"

const setConfig = (root: string, change: Record<string, unknown>): void =>
  writeFileSync(join(root, "jam.config.json"), JSON.stringify({ ...readJson(root, "jam.config.json"), ...change }, null, 2))

describe("starting and finding runs", () => {
  it("writes <scratch root>/<id>/<n>/run.json, numbers attempts, and finds the newest by subject id", async () => {
    const root = jamProject()
    const first = await start(root, "prop", "oak-barrel")
    assert.equal(first.run, "work/.scratch/oak-barrel/1/run.json")
    assert.equal(readFileSync(join(root, "work/.scratch/oak-barrel/1/brief.md"), "utf8"), "Brief for oak-barrel\n")
    assert.equal(first.budget, "prop")
    const second = await start(root, "prop", "oak-barrel")
    assert.equal(second.n, 2)
    const found = await jam(root, Effect.flatMap(Runs, (runs) => Effect.all([runs.find("oak-barrel"), runs.find("oak-barrel:1")])))
    assert.deepEqual(found.map((ref) => ref.run.n), [2, 1])
    const missing = await jamFailure(root, Effect.flatMap(Runs, (runs) => runs.find("ghost")))
    assert.equal(missing.code, "not_found")
    assert.match(missing.fix!, /known subjects: oak-barrel.*jam run start <recipe> ghost/)
  })

  it("refuses a start that cannot work, naming the field and the fix", async () => {
    const root = jamProject()
    const fails = (input: Parameters<typeof startRun>[0]) => jamFailure(root, startRun(input))
    assert.match((await fails({ recipe: "prop", id: "a", human: [] })).message, /--brief <file> or --brief-text/)
    assert.match((await fails({ recipe: "prop", id: "a", briefText: "x", brief: "b.md", human: [] })).message, /one of them/)
    assert.match((await fails({ recipe: "nope", id: "a", briefText: "x", human: [] })).fix!, /use one of: .*prop/)
    assert.match((await fails({ recipe: "prop", id: "a", briefText: "x", human: ["polish"] })).message, /step polish is not in recipe prop/)
    assert.match((await fails({ recipe: "prop", id: "a", briefText: "x", human: [], budget: "huge" })).fix!, /use one of: prop, character/)
    assert.match((await fails({ recipe: "prop", id: "bad id", briefText: "x", human: [] })).message, /id: expected a file-name-safe id/)
    // No style document: the run starts, and says it is not bound to an art direction.
    const bare = jamProject({ config: { style: { document: null, references: [] } } })
    const unstyled = await jam(bare, startRun({ recipe: "prop", id: "a", briefText: "x", human: [] }))
    assert.match(unstyled.notes.join(" "), /not bound to an art direction/)
    // A style document that is named but missing is a broken setting.
    const dangling = jamProject({ config: { style: { document: "work/missing-style.md", references: [] } } })
    assert.match((await jamFailure(dangling, startRun({ recipe: "prop", id: "a", briefText: "x", human: [] }))).message, /does not exist/)
    assert.equal((await start(bare, "image", "a")).recipe, "image")
  })

  it("starts with a budget that is not defined yet, and says so", async () => {
    const root = jamProject({ config: { budgets: {} } })
    const started = await start(root, "prop", "crate")
    assert.match(started.notes[0]!, /budget prop is not defined yet/)
  })
})

describe("recording a step", () => {
  it("takes facts as flags: the tool hashes files, measures images and models, and binds the record to what it was built on", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await throughTexture(root, "barrel")
    const run = runFile(root, "barrel")
    const concept = run.steps["concept"]!.records[0]!
    assert.equal(concept.files[0]!.role, "concept", "the role defaults when the step has one")
    assert.deepEqual(concept.files[0]!.size, [16, 16])
    assert.match(concept.files[0]!.sha256, /^[0-9a-f]{64}$/)
    assert.deepEqual(concept.provenance, { kind: "tool", tool: "test tool 1.0" })
    const topology = run.steps["topology"]!.records[0]!
    assert.equal(topology.metrics!.triangles, 1000)
    assert.equal(topology.metrics!.basis, "measured")
    assert.equal(topology.metrics!.model, made.model)
    assert.deepEqual(topology.dependencies, { mesh: run.steps["mesh"]!.records[0]!.id })
    assert.deepEqual(topology.checks.map((check) => check.id), ["budget-geometry"])
    assert.deepEqual(run.steps["texture"]!.records[0]!.dependencies, { uv: run.steps["uv"]!.records[0]!.id }, "steps recorded together are bound to each other")
    assert.equal((await status(root, "barrel")).next.action, "work")
    assert.deepEqual((await status(root, "barrel")).steps.map((step) => step.state), ["accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "ready"])
  })

  it("refuses a record that does not match what the step produces, saying which flag to write", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    assert.match((await recordFailure(root, "barrel", "concept", { files: [made.concept], note: " " })).message, /--note is required/)
    assert.match((await recordFailure(root, "barrel", "concept", { files: [made.model] })).message, /model\.glb is not an image file/)
    assert.match((await recordFailure(root, "barrel", "concept", { files: [] })).message, /needs at least 1 file with role concept/)
    assert.match((await recordFailure(root, "barrel", "concept", { files: [made.concept], tool: undefined })).fix!, /--tool .*--job .*--source/)
    assert.match((await recordFailure(root, "barrel", "concept", { files: [made.concept], tool: "a", job: "j1" })).message, /--job is the whole origin/)
    assert.match((await recordFailure(root, "barrel", "concept", { files: [made.concept], tool: "a", source: "b" })).message, /--source needs --source-evidence/)
    assert.match((await recordFailure(root, "barrel", "concept", { files: [`${made.dir}/missing.png`] })).message, /missing\.png does not exist/)
    assert.match((await recordFailure(root, "barrel", "mesh", { files: [made.model] })).message, /needs turnaround accepted first; turnaround is waiting/)
    assert.match((await recordFailure(root, "barrel", "polish", {})).message, /step polish is not in recipe asset/)
    await record(root, "barrel", "concept", { files: [made.concept], accept: "ok" })
    assert.match((await recordFailure(root, "barrel", "turnaround", { files: [made.views[0]!.split("=")[1]!] })).fix!, /--file view:<front\|left\|back\|right\|three-quarter>=/)
    assert.match((await recordFailure(root, "barrel", "turnaround", { files: made.views.slice(0, 4), symmetric: true })).message, /needs a view file for each of: three-quarter/)
    assert.equal(runFile(root, "barrel").steps["turnaround"], undefined, "a refused record writes nothing")
  })

  it("measures what it records: a supplied metric that disagrees is refused, and one with nothing measured behind it too", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await throughTexture(root, "barrel")
    const wrong = await recordFailure(root, "barrel", "topology", { files: [`model=${made.model}`], metrics: ["triangles=999"] })
    assert.match(wrong.message, /--metric triangles=999 disagrees with the measured value 1000/)
    await record(root, "barrel", "topology", { files: [`model=${made.model}`], metrics: ["triangles=1000", "materials=1"], accept: "agrees" })
    assert.match((await recordFailure(root, "barrel", "concept", { files: [made.concept], metrics: ["triangles=5"] })).message, /nothing measured backs it/)
  })

  it("holds a result to its budget when recorded and names the excess", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await throughTexture(root, "barrel")
    write(root, `${made.dir}/heavy.glb`, await glb({ triangles: 2001, materials: 2 }))
    const over = await recordFailure(root, "barrel", "topology", { files: [`model=${made.dir}/heavy.glb`] })
    assert.match(over.message, /2001 triangles is over the budget of 2000/)
    // Materials are judged with the surface: topology takes a two-material model, texture does not.
    assert.equal((over.details as { problems: Array<unknown> }).problems.length, 1)
    write(root, `${made.dir}/two-materials.glb`, await glb({ triangles: 1000, materials: 2 }))
    assert.match((await recordFailure(root, "barrel", "texture", { files: [`model=${made.dir}/two-materials.glb`] })).message, /2 materials is over the budget of 1/)
    write(root, `${made.dir}/big-texture.glb`, await glb({ triangles: 10, texture: 2048 }))
    assert.match((await recordFailure(root, "barrel", "texture", { files: [`model=${made.dir}/big-texture.glb`] })).message, /texture 2048x2048 is over the budget of 1024 per side/)
    // A run with no budget cannot be judged; the record says how to name one.
    await start(root, "asset", "loose")
    const loose = await makeFiles(root, "loose")
    await record(root, "loose", "concept", { files: [loose.concept], accept: "ok" })
    await record(root, "loose", "turnaround", { files: loose.views, symmetric: true, accept: "ok" })
    await record(root, "loose", "mesh", { files: [loose.model], accept: "ok" })
    assert.match((await recordFailure(root, "loose", "topology", { files: [`model=${loose.model}`] })).message, /this run has no budget.*jam run set loose --budget <name>/)
    await jam(root, setRun({ run: "loose", budget: "prop", human: [] }))
    await record(root, "loose", "topology", { files: [`model=${loose.model}`], accept: "ok" })
  })

  it("records several steps of one operation together, each with its own checks and gate, or none at all", async () => {
    const root = jamProject()
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    await record(root, "barrel", "concept", { files: [made.concept] })
    await review(root, "barrel", "concept", { relay: "chat: yes" })
    await record(root, "barrel", "turnaround", { files: made.views, symmetric: true })
    await review(root, "barrel", "turnaround", { relay: "chat: yes" })
    await record(root, "barrel", "mesh", { files: [made.model], accept: "ok" })
    // The texture budget fails for one of four steps: nothing is written for any of them.
    write(root, `${made.dir}/big.glb`, await glb({ triangles: 10, texture: 2048 }))
    const refused = await recordFailure(root, "barrel", ["delivery", "texture", "uv", "topology"], { files: [`model=${made.dir}/big.glb`] })
    assert.match(refused.message, /step texture did not pass its checks/)
    assert.deepEqual(Object.keys(runFile(root, "barrel").steps).sort(), ["concept", "mesh", "turnaround"])
    // Given in any order, they are written in the order they need each other.
    const result = await record(root, "barrel", ["delivery", "texture", "uv", "topology"], { files: [`model=${made.model}`], accept: "one finalize script produced all four" })
    assert.deepEqual(result.records.map((entry) => [entry.step, entry.state]), [["topology", "accepted"], ["uv", "accepted"], ["texture", "accepted"], ["delivery", "review"]])
    assert.match(result.records[3]!.note!, /--accept did not apply: this step needs a person/)
    const run = runFile(root, "barrel")
    assert.equal(run.steps["delivery"]!.records[0]!.reviews.length, 0)
    assert.deepEqual(Object.keys(run.steps["delivery"]!.records[0]!.dependencies), ["topology", "uv", "texture"])
  })
})

describe("staleness is narrow", () => {
  it("only a changed file, brief, style revision or replaced dependency makes work stale; editing the style document, adding references or a budget does not", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await throughTexture(root, "barrel")
    const states = async () => Object.fromEntries((await status(root, "barrel")).steps.map((step) => [step.step, step.state]))
    // Editing the style document and adding a reference image: nothing changes.
    write(root, "work/style.md", "style, extended with a new hero shot")
    write(root, "work/hero.png", png(4, 4))
    setConfig(root, { style: { document: "work/style.md", references: ["work/hero.png"] } })
    assert.equal((await states())["texture"], "accepted")
    // Editing a budget re-checks the measured result instead of invalidating it.
    setConfig(root, { budgets: { ...CONFIG.budgets, prop: { ...PROP_BUDGET, triangles: { target: 500, max: 900 } } } })
    const tight = await stepStatus(root, "barrel", "topology")
    assert.equal(tight.state, "over-budget")
    assert.match(tight.reason!, /1000 triangles is over the budget of 900/)
    assert.equal((await states())["uv"], "blocked", "what was built on it waits")
    assert.equal((await states())["concept"], "accepted")
    setConfig(root, { budgets: CONFIG.budgets })
    assert.equal((await states())["texture"], "accepted")
    // Replacing a step makes its consumers stale, and only them.
    await record(root, "barrel", "mesh", { files: [made.model], note: "second candidate", accept: "ok" })
    assert.deepEqual(await states(), { concept: "accepted", turnaround: "accepted", mesh: "accepted", topology: "stale", uv: "blocked", texture: "blocked", delivery: "waiting" })
    assert.match((await stepStatus(root, "barrel", "topology")).reason!, /mesh was replaced/)
    await record(root, "barrel", ["topology", "uv", "texture"], { files: [`model=${made.model}`], accept: "ok" })
    // A new art direction makes the whole run stale; so does a changed brief.
    setConfig(root, { style: { document: "work/style.md", revision: "v002", references: [] } })
    assert.match((await stepStatus(root, "barrel", "concept")).reason!, /style revision changed from the first to v002/)
    assert.equal((await states())["texture"], "stale")
    assert.match((await recordFailure(root, "barrel", "concept", { files: [made.concept] })).fix!, /start a new attempt/)
    setConfig(root, { style: { document: "work/style.md", references: [] } })
    assert.equal((await states())["texture"], "accepted")
    write(root, `${made.dir}/brief.md`, "A different brief")
    assert.match((await stepStatus(root, "barrel", "mesh")).reason!, /the brief .* changed since the run started/)
  })

  it("a changed output, input or evidence file makes that record stale and blocks what was built on it", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    write(root, `${made.dir}/notes.md`, "evidence")
    write(root, `${made.dir}/reference.png`, png(4, 4))
    await record(root, "barrel", "concept", { files: [made.concept], evidence: [`${made.dir}/notes.md`], inputs: [`${made.dir}/reference.png`], accept: "ok" })
    await record(root, "barrel", "turnaround", { files: made.views, symmetric: true, accept: "ok" })
    for (const path of [`${made.dir}/notes.md`, `${made.dir}/reference.png`, made.concept]) {
      const before = readFileSync(join(root, path))
      write(root, path, "changed")
      const concept = await stepStatus(root, "barrel", "concept")
      assert.equal(concept.state, "stale", path)
      assert.match(concept.reason!, new RegExp(`${path.split("/").at(-1)!.replace(".", "\\.")} changed or is missing`))
      assert.equal(await stateOf(root, "barrel", "turnaround"), "blocked", path)
      write(root, path, before)
      assert.equal(await stateOf(root, "barrel", "turnaround"), "accepted", `${path} restored`)
    }
  })
})

describe("gates", () => {
  it("recipe mode: a human gate takes a person's decision, by relay with channel and words; an agent cannot stand in", async () => {
    const root = jamProject()
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    const recorded = await record(root, "barrel", "concept", { files: [made.concept], accept: "looks right to me" })
    assert.equal(recorded.records[0]!.state, "review")
    assert.match(recorded.next, /request-review barrel concept.*--relay/)
    const refused = await reviewFailure(root, "barrel", "concept")
    assert.equal(refused.code, "forbidden")
    assert.match(refused.fix!, /--accept --relay "<where they answered>: <their words>"/)
    assert.match((await reviewFailure(root, "barrel", "concept", { relay: "yes" })).message, /expected "<where they answered>: <their words, verbatim>"/)
    const accepted = await review(root, "barrel", "concept", { relay: "notifai: yes, ship the barrel", reason: undefined, by: "Sam" })
    assert.deepEqual([accepted.actor, accepted.via, accepted.state], ["human", "relay", "accepted"])
    const stored = runFile(root, "barrel").steps["concept"]!.records[0]!.reviews[0]!
    assert.deepEqual({ ...stored, at: "" }, { decision: "accept", actor: "human", via: "relay", reason: "yes, ship the barrel", by: "Sam", channel: "notifai", words: "yes, ship the barrel", at: "" })
  })

  it("an agent gate is satisfied at record time or by review; revise and reject send work back; a new record needs a new decision", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    const first = await record(root, "barrel", "concept", { files: [made.concept] })
    assert.equal(first.records[0]!.state, "review")
    assert.match((await reviewFailure(root, "barrel", "concept", { reason: " " })).message, /--reason is required/)
    assert.equal((await review(root, "barrel", "concept", { decision: "revise", reason: "too clean, weather it" })).state, "revise")
    assert.equal((await status(root, "barrel")).next.action, "work")
    assert.equal((await review(root, "barrel", "concept")).state, "accepted", "a later decision replaces an earlier one")
    const second = await record(root, "barrel", "concept", { files: [made.concept], note: "weathered" })
    assert.equal(second.records[0]!.state, "review", "the earlier acceptance does not carry to a new candidate")
    assert.match((await reviewFailure(root, "barrel", "concept", { record: first.records[0]!.record })).message, /is not the current record of concept/)
    assert.equal((await review(root, "barrel", "concept", { decision: "reject", reason: "wrong object" })).state, "rejected")
    assert.match((await reviewFailure(root, "barrel", "turnaround")).message, /cannot be reviewed: it is waiting/)
  })

  it("the crunch switch lowers gates in one visible setting and keeps who decided; a run's own --human still holds", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop", human: ["turnaround"] })
    const made = await makeFiles(root, "barrel")
    const concept = await record(root, "barrel", "concept", { files: [made.concept], accept: "matches the brief" })
    assert.deepEqual(concept.records[0]!.gate, { required: "agent", recipe: "human", because: `review.mode is "agent" in jam.config.json` })
    assert.equal(concept.records[0]!.state, "accepted")
    assert.equal(runFile(root, "barrel").steps["concept"]!.records[0]!.reviews[0]!.actor, "agent", "provenance says an agent accepted it")
    const turnaround = await record(root, "barrel", "turnaround", { files: made.views, symmetric: true, accept: "ok" })
    assert.equal(turnaround.records[0]!.state, "review")
    assert.deepEqual(turnaround.records[0]!.gate, { required: "human", recipe: "human" }, "the lowered mode does not reach a step the run reserved for a person")
    assert.equal((await reviewFailure(root, "barrel", "turnaround")).code, "forbidden")
    // Raising the gates again applies to what was already accepted by an agent.
    setConfig(root, { review: { mode: "recipe" } })
    const raised = await stepStatus(root, "barrel", "concept")
    assert.deepEqual([raised.state, raised.reason], ["review", "accepted by an agent; a person must accept it"])
    // No gate at all: work is recorded and stands, except where the run asked for a person.
    setConfig(root, { review: { mode: "none" } })
    assert.equal(await stateOf(root, "barrel", "concept"), "accepted")
    assert.equal(await stateOf(root, "barrel", "turnaround"), "review")
    await review(root, "barrel", "turnaround", { relay: "call: fine" })
    const mesh = await record(root, "barrel", "mesh", { files: [made.model] })
    assert.deepEqual([mesh.records[0]!.state, mesh.records[0]!.gate.required], ["accepted", "none"])
    assert.equal(runFile(root, "barrel").steps["mesh"]!.records[0]!.reviews.length, 0)
    // --human only ever adds.
    const set = await jam(root, setRun({ run: "barrel", human: ["mesh"] }))
    assert.deepEqual(set.human, ["turnaround", "mesh"])
    const reserved = await stepStatus(root, "barrel", "mesh")
    assert.deepEqual([reserved.state, reserved.gate.because], ["review", "this run was started with --human for this step"])
  })

  it("without the catalog bridge a review request fails with what to do instead; with a desk the person's verdict decides", async () => {
    const root = jamProject()
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    await record(root, "barrel", "concept", { files: [made.concept] })
    const none = await jamFailure(root, requestReview({ run: "barrel", step: "concept" }))
    assert.equal(none.code, "unavailable")
    assert.match(none.message, /catalog review bridge is not connected/)
    assert.match(none.fix!, /jam run review barrel concept --accept --relay/)

    const verdicts = new Map<string, Verdict>()
    const where = (submission: string) => ({ submission, route: `#/reviews/s/${submission}`, url: `http://127.0.0.1:4600/#/reviews/s/${submission}`, reviewer: "Sam" })
    const desk = Layer.succeed(ReviewDesk, {
      submit: (_run, _step, submitted) => Effect.succeed(where(`sub-${submitted.id}`)),
      verdict: (submission) => Effect.succeed(verdicts.get(submission) ?? { state: "pending", request: where(submission) })
    })
    const { reviewedStatus } = await import("../../src/jam/runs/review.ts")
    const read = () => jam(root, Effect.gen(function*() {
      return (yield* reviewedStatus(yield* (yield* Runs).open("barrel"))).status.steps[0]!
    }), { desk })
    const submitted = await jam(root, requestReview({ run: "barrel", step: "concept" }), { desk })
    assert.match(submitted.url!, /^http:\/\/127\.0\.0\.1:4600\/#\/reviews\/s\/sub-rec_/)
    assert.deepEqual(await jam(root, requestReview({ run: "barrel", step: "concept" }), { desk }), submitted, "asking twice is the same request")
    assert.deepEqual(runFile(root, "barrel").steps["concept"]!.records[0]!.submission?.route, submitted.route, "the run keeps the route, which is the same on every machine")
    const waiting = await read()
    assert.deepEqual([waiting.state, waiting.review], ["review", where(submitted.submission)])
    verdicts.set(submitted.submission, { state: "returned", by: "Sam", reason: "the hoops should be iron, not brass", rejected: false })
    assert.deepEqual([(await read()).state, (await read()).reason], ["revise", "the hoops should be iron, not brass"])
    verdicts.set(submitted.submission, { state: "accepted", by: "Sam" })
    assert.equal(runFile(root, "barrel").steps["concept"]!.records[0]!.reviews.length, 1, "a verdict is written to the run once")
    await record(root, "barrel", "concept", { files: [made.concept], note: "iron hoops" })
    const again = await jam(root, requestReview({ run: "barrel", step: "concept" }), { desk })
    verdicts.set(again.submission, { state: "accepted", by: "Sam" })
    const accepted = await read()
    assert.deepEqual([accepted.state, accepted.decided], ["accepted", { decision: "accept", actor: "human", via: "catalog", by: "Sam" }])
    const stored = runFile(root, "barrel").steps["concept"]!.records[1]!.reviews[0]!
    assert.deepEqual([stored.actor, stored.via, stored.by, stored.submission], ["human", "catalog", "Sam", again.submission])
    // The desk is for gates that need a person: an agent's gate is never put in front of one.
    await record(root, "barrel", "turnaround", { files: made.views, symmetric: true })
    await jam(root, reviewStep({ run: "barrel", step: "turnaround", decision: "accept", relay: "chat: fine" }))
    await record(root, "barrel", "mesh", { files: [made.model] })
    const agentGate = await jamFailure(root, requestReview({ run: "barrel", step: "mesh" }), { desk })
    assert.equal(agentGate.code, "conflict")
    assert.match(agentGate.message, /mesh does not wait for a person: its gate is agent/)
    assert.match(agentGate.fix!, /jam run review barrel mesh --accept --reason .* jam run set barrel --human mesh/)
  })
})

describe("starting in the middle, and skipping", () => {
  it("--from starts at a step from existing work: earlier steps are bypassed and the entry record must say where the work came from", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "scan", { budget: "prop", from: "topology" })
    assert.deepEqual((await status(root, "scan")).steps.map((step) => step.state), ["bypassed", "bypassed", "bypassed", "ready", "waiting", "waiting", "waiting"])
    assert.deepEqual((await status(root, "scan")).next, { action: "work", step: "topology", why: "nothing is recorded yet" })
    write(root, "work/.scratch/scan/1/scan.glb", await glb({ triangles: 1500 }))
    write(root, "work/.scratch/scan/1/origin.md", "Scanned in the studio on 2026-11-02; ours to use.")
    const model = "model=work/.scratch/scan/1/scan.glb"
    assert.match((await recordFailure(root, "scan", "topology", { files: [model] })).fix!, /--source <origin> --source-evidence/)
    assert.match((await recordFailure(root, "scan", "topology", { files: [model], source: "studio scan" })).message, /--source needs --source-evidence/)
    // Imported work processed locally names both: where it came from, and the tool that cleaned it up.
    await record(root, "scan", ["topology", "uv", "texture"], { files: [model], source: "studio scan", sourceEvidence: "work/.scratch/scan/1/origin.md", tool: "DCC 5.1 decimate", accept: "cleaned up" })
    const topology = runFile(root, "scan").steps["topology"]!.records[0]!
    assert.deepEqual(topology.provenance, { kind: "imported", source: "studio scan", sourceEvidence: "work/.scratch/scan/1/origin.md", tool: "DCC 5.1 decimate" })
    assert.deepEqual(topology.evidence.map((file) => file.label), ["origin"])
    assert.deepEqual(topology.dependencies, {})
    assert.deepEqual((await status(root, "scan")).steps.map((step) => step.state), ["bypassed", "bypassed", "bypassed", "accepted", "accepted", "accepted", "ready"])
  })

  it("imported work may also enter an ordinary run at any step; work made in the run may not jump its needs", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "bought", { budget: "prop" })
    const made = await makeFiles(root, "bought")
    write(root, `${made.dir}/licence.md`, "Bought from the asset store, licence 4411.")
    // Naming an unrelated accepted step does not open the way past the turnaround.
    await record(root, "bought", "concept", { files: [made.concept], accept: "ok" })
    assert.match((await recordFailure(root, "bought", "mesh", { files: [made.model] })).message, /needs turnaround accepted first/)
    assert.match((await recordFailure(root, "bought", "topology", { files: [`model=${made.model}`] })).message, /needs mesh accepted first/)
    await record(root, "bought", "mesh", { files: [made.model], source: "asset store", sourceEvidence: `${made.dir}/licence.md`, accept: "ok" })
    const mesh = runFile(root, "bought").steps["mesh"]!.records[0]!
    assert.equal(mesh.entry, "imported")
    const turnaround = await stepStatus(root, "bought", "turnaround")
    assert.deepEqual([turnaround.state, turnaround.reason], ["bypassed", "mesh was imported with origin evidence"])
    assert.equal((await status(root, "bought")).next.action === "work" && (await status(root, "bought")).steps.find((step) => step.state === "ready")!.step, "topology")
  })

  it("only an optional step can be skipped, with a reason, and later steps then treat it as satisfied", async () => {
    const root = jamProject({ config: { ...AGENT_MODE, engine: { adapter: "web", facts: {} } }, files: { "jam/recipes/crate.json": JSON.stringify({ version: 1, id: "crate", extends: "builtin:asset", budget: "prop", steps: [{ id: "decals", after: "texture", needs: ["texture"], optional: true, produces: [{ role: "decal", kind: "image", min: 1 }] }, { id: "delivery", needs: ["texture", "decals"] }] }) } })
    await start(root, "crate", "crate")
    const made = await throughTexture(root, "crate")
    assert.equal((await jamFailure(root, skipStep({ run: "crate", step: "texture", reason: "no" }))).code, "forbidden")
    assert.match((await jamFailure(root, skipStep({ run: "crate", step: "decals", reason: " " }))).message, /--reason is required/)
    assert.equal(await stateOf(root, "crate", "delivery"), "waiting")
    await jam(root, skipStep({ run: "crate", step: "decals", reason: "plain crate, no markings" }))
    const decals = await stepStatus(root, "crate", "decals")
    assert.deepEqual([decals.state, decals.reason], ["skipped", "plain crate, no markings"])
    await record(root, "crate", "delivery", { files: [`model=${made.model}`] })
    assert.deepEqual(runFile(root, "crate").steps["delivery"]!.records[0]!.dependencies["decals"], "skipped")
    // Doing the step after all makes what skipped it stale.
    write(root, `${made.dir}/decal.png`, png(4, 4))
    await record(root, "crate", "decals", { files: [`${made.dir}/decal.png`], accept: "ok" })
    assert.match((await stepStatus(root, "crate", "delivery")).reason!, /decals was skipped when this was recorded and has been worked since/)
  })
})

describe("one writer per run", () => {
  it("a held run refuses a second writer, and its lock is removed only when its process is verified gone", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    const lock = "work/.scratch/barrel/1/run.json.lock"
    // A live writer on this machine: this very process.
    write(root, lock, JSON.stringify({ pid: process.pid, host: hostname(), at: "2026-11-16T10:00:00.000Z" }))
    const held = await recordFailure(root, "barrel", "concept", { files: [made.concept] })
    assert.equal(held.code, "locked")
    assert.match(held.fix!, /jam run unlock <id>/)
    assert.equal(runFile(root, "barrel").steps["concept"], undefined)
    const unlock = Effect.gen(function*() {
      const runs = yield* Runs
      return yield* (yield* ProjectFiles).breakLock(runs.lockPath((yield* runs.find("barrel")).path))
    })
    assert.match((await jamFailure(root, unlock)).message, /held by running process/)
    write(root, lock, JSON.stringify({ pid: 1, host: "another-machine", at: "2026-11-16T10:00:00.000Z" }))
    assert.match((await jamFailure(root, unlock)).message, /held from another machine/)
    // A writer that crashed.
    write(root, lock, JSON.stringify({ pid: 2 ** 22 + 11, host: hostname(), at: "2026-11-16T10:00:00.000Z" }))
    assert.equal((await recordFailure(root, "barrel", "concept", { files: [made.concept] })).code, "locked", "no automatic recovery by elapsed time")
    await jam(root, unlock)
    assert.equal(existsSync(join(root, lock)), false)
    await record(root, "barrel", "concept", { files: [made.concept], accept: "ok" })
    assert.equal(existsSync(join(root, lock)), false, "the lock is released after each write")
  })
})
