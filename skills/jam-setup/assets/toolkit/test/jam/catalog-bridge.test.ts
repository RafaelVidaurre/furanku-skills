// The review bridge: a step with a human gate goes to the catalog, a person decides there, and the
// run reads the decision. One place where a person approves anything; an agent's verdict in the
// catalog never opens a human gate.
import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { hostname } from "node:os"
import { describe, it } from "node:test"
import { requestReview } from "../../src/jam/runs/review.ts"
import { Git } from "../../src/kernel/Git.ts"
import { agent, bridge, bridgedStep, bridgeFailure, catalogProject, human, openCatalog, WORKER } from "./catalog-support.ts"
import { setRun } from "../../src/jam/runs/start.ts"
import { cli, jam, png, write } from "./fixtures.ts"
import { makeFiles, record, review, runFile, start } from "./flow.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const HINT = /^No catalog server is running for this checkout\. Run `jam catalog open`/
// The Git user these tests run as (test/catalog/helpers.ts sets it for every Git process):
// whoever works in the checkout is who a review waits for.
// Who a review waits for comes from the recipe; these runs' recipes name nobody.
const REVIEWER = "a person"

/** A barrel whose concept (two images, one evidence render) waits for a person. */
const waitingConcept = async (config: Record<string, unknown> = {}) => {
  const root = catalogProject({ config })
  await start(root, "asset", "barrel", { budget: "prop", briefText: "A weathered oak barrel, about 1 m tall" })
  const dir = "work/.scratch/barrel/1"
  write(root, `${dir}/a.png`, png(64, 32, [120, 80, 40]))
  write(root, `${dir}/b.png`, png(64, 32, [40, 80, 120]))
  write(root, `${dir}/lineup.png`, png(128, 32))
  write(root, `${dir}/prompt.md`, "the prompt")
  const recorded = await record(root, "barrel", "concept", { files: [`${dir}/a.png`, `${dir}/b.png`], evidence: [`side-by-side=${dir}/lineup.png`, `${dir}/prompt.md`], note: "Two directions: iron hoops, and rope.", tool: "image model 2" })
  return { root, dir, record: recorded.records[0]!.record }
}

const decide = (app: ReturnType<typeof openCatalog>, review: Any, decision: Record<string, unknown>, actor: { name: string; kind: "human" | "agent" } = human) =>
  app.run("review.decide", { submission: review.submission, item: review.item, ...decision }, { actor })

/** Ask for the review and read the submission as the reviewer's page does. */
const ask = async (root: string) => {
  const asked = await bridge(root, requestReview({ run: "barrel", step: "concept" }))
  const app = openCatalog(root)
  const submission = await app.run("review.get", { submission: asked.submission })
  return { asked, app, submission, review: { submission: asked.submission, item: submission.items[0].id as string } }
}

describe("asking a person", () => {
  it("submits the step's parts and evidence under the record's request id, with a note written for the reviewer", async () => {
    const { record: recordId, root } = await waitingConcept()
    const { app, asked, submission } = await ask(root)
    assert.deepEqual({ ...asked, hint: "" }, { id: "barrel", step: "concept", record: recordId, submission: asked.submission, route: `#/reviews/s/${asked.submission}`, hint: "" })
    assert.match(asked.hint!, HINT)
    assert.deepEqual([submission.title, submission.by], ["barrel · Concept image", { name: WORKER, kind: "agent" }])
    assert.deepEqual(submission.items.map((item: Any) => item.target), [{ kind: "unit", id: "barrel" }])
    assert.deepEqual(submission.items[0].parts.map((part: Any) => [part.id, part.verdict]), [["concept:1", null], ["concept:2", null], ["evidence:concept-side-by-side", null]])
    assert.deepEqual(submission.items[0].views.map((view: Any) => [view.part, view.caption]), [
      ["concept:1", "Concept image: Concept · a"],
      ["concept:2", "Concept image: Concept · b"],
      ["evidence:concept-side-by-side", "Evidence: Side by side"]
    ])
    assert.equal(submission.note, [
      "**Concept image** of `barrel`, 3D asset.",
      "",
      "**Asked for**",
      "",
      "> A weathered oak barrel, about 1 m tall",
      "",
      "**Done**",
      "",
      "Two directions: iron hoops, and rope.",
      "",
      "- Made with image model 2.",
      "- 2 images at 64 × 32 px.",
      "",
      "**To decide:** Concept · a, Concept · b. Supporting evidence: Side by side."
    ].join("\n"))
    assert.ok(!/rec_|sha256|\.scratch/.test(submission.note), "no record ids, hashes or paths")

    // Asking again is the same request: one submission, in the run and in the catalog.
    const again = await bridge(root, requestReview({ run: "barrel", step: "concept" }))
    assert.deepEqual(again, asked)
    assert.equal((await app.run("reviews.list", {})).total, 1)
    assert.deepEqual(runFile(root, "barrel").steps["concept"]!.records[0]!.submission?.route, asked.route)
    // Even when the run lost its note of the submission, the record's id finds it again.
    const direct = await app.run("review.submit", { items: [{ target: { kind: "unit", id: "barrel" } }] }, { actor: { name: WORKER, kind: "agent" }, requestId: `jam:${recordId}` }).catch((error: Any) => error)
    assert.equal(direct.code, "conflict", "the request id is taken by the step's submission")
  })

  it("a decision an agent relays into the catalog is recorded as a relay, with the person's words; a person cannot relay", async () => {
    const { root } = await waitingConcept()
    const { app, review } = await ask(root)
    const refused = await decide(app, review, { whole: "approved", relay: { by: "Rae Tester", channel: "chat", words: "barrel looks great" } }).catch((error: Any) => error)
    assert.match(refused.message, /relay is for an agent recording a person's decision/)
    await decide(app, review, { whole: "approved", relay: { by: "Rae Tester", channel: "chat", words: "barrel looks great" } }, agent)
    const step = await bridgedStep(root, "barrel", "concept")
    assert.deepEqual([step.state, step.decided], ["accepted", { decision: "accept", actor: "human", via: "relay", by: "Rae Tester", channel: "chat" }])
    const stored = runFile(root, "barrel").steps["concept"]!.records[0]!.reviews[0]!
    assert.deepEqual([stored.via, stored.channel, stored.words], ["relay", "chat", "barrel looks great"])
    const events = (await app.run("review.get", { submission: review.submission })) as Any
    const event = events.items[0].parts.find((part: Any) => part.event !== null).event
    assert.deepEqual([event.by.kind, event.relay.by], ["agent", "Rae Tester"], "the catalog keeps the agent as the actor")
  })

  it("a person's approval of every part accepts the step, with their name and the channel on record; an agent's approval does not", async () => {
    const { root } = await waitingConcept()
    const { app, asked, review } = await ask(root)
    let step = await bridgedStep(root, "barrel", "concept")
    assert.deepEqual([step.state, step.review], ["review", { submission: asked.submission, route: asked.route, hint: asked.hint }])

    await decide(app, review, { whole: "approved" }, agent)
    step = await bridgedStep(root, "barrel", "concept")
    assert.deepEqual([step.state, step.decided], ["review", undefined], "an agent's verdict in the catalog decides nothing")
    assert.equal(runFile(root, "barrel").steps["concept"]!.records[0]!.reviews.length, 0)

    // Part by part: the step waits until a person has approved all of them.
    await decide(app, review, { verdicts: { "concept:1": "approved", "concept:2": "approved" } })
    assert.equal((await bridgedStep(root, "barrel", "concept")).state, "review")
    await decide(app, review, { verdicts: { "evidence:concept-side-by-side": "approved" }, comment: "Go with the iron hoops" })
    step = await bridgedStep(root, "barrel", "concept")
    assert.deepEqual([step.state, step.decided], ["accepted", { decision: "accept", actor: "human", via: "catalog", by: "Rae Tester" }])
    const stored = runFile(root, "barrel").steps["concept"]!.records[0]!.reviews
    assert.deepEqual(stored.map((entry) => [entry.decision, entry.actor, entry.via, entry.by, entry.reason, entry.submission]), [["accept", "human", "catalog", "Rae Tester", "Go with the iron hoops", asked.submission]])
    // Written once: reading again, or a later change of mind in the catalog, adds nothing.
    await decide(app, review, { whole: "changes" })
    assert.equal((await bridgedStep(root, "barrel", "concept")).state, "accepted")
    assert.equal(runFile(root, "barrel").steps["concept"]!.records[0]!.reviews.length, 1)

    const status = cli(root, "run", "status", "barrel")
    assert.match(status.stdout, /concept +accepted +human +accepted by Rae Tester in the catalog/)
    const json = cli(root, "run", "status", "barrel", "--json").json<{ steps: ReadonlyArray<{ step: string; state: string; decided?: unknown }> }>()
    assert.deepEqual(json.steps[0], { ...json.steps[0]!, step: "concept", state: "accepted", decided: { decision: "accept", actor: "human", via: "catalog", by: "Rae Tester" } })
  })

  it("changes return the step with the reviewer's comment and part notes; a rejection rejects it; a new record is a new request", async () => {
    const { dir, root } = await waitingConcept()
    const first = await ask(root)
    await decide(first.app, first.review, { whole: "approved", exceptions: { "concept:2": "changes" }, comment: "Hoops yes.", partNotes: { "concept:2": "the rope reads as a belt" } })
    let step = await bridgedStep(root, "barrel", "concept")
    assert.deepEqual([step.state, step.reason, step.decided], ["revise", "Hoops yes. Concept · b: the rope reads as a belt", { decision: "revise", actor: "human", via: "catalog", by: "Rae Tester" }])
    assert.equal((await bridgeFailure(root, requestReview({ run: "barrel", step: "concept" }))).code, "conflict", "a returned step is reworked, not asked about again")

    write(root, `${dir}/b.png`, png(64, 32, [200, 200, 40]))
    await record(root, "barrel", "concept", { files: [`${dir}/a.png`, `${dir}/b.png`], evidence: [`side-by-side=${dir}/lineup.png`], note: "Rope replaced by a second hoop." })
    const second = await ask(root)
    assert.notEqual(second.asked.submission, first.asked.submission)
    assert.equal((await second.app.run("reviews.list", {})).total, 2)
    await decide(second.app, second.review, { whole: "rejected", comment: "Wrong object entirely" })
    step = await bridgedStep(root, "barrel", "concept")
    assert.deepEqual([step.state, step.reason, step.decided?.decision], ["rejected", "Wrong object entirely", "reject"])
  })

  it("a project that keeps evidence as reference material is asked about the produced parts only", async () => {
    const { root } = await waitingConcept()
    write(root, "catalog.config.json", JSON.stringify({ version: 2, plugins: ["jam"], review: { referenceRoles: ["evidence"] } }))
    const { app, review, submission } = await ask(root)
    assert.deepEqual(submission.items[0].parts.map((part: Any) => part.id), ["concept:1", "concept:2"])
    assert.match(submission.note, /\*\*To decide:\*\* Concept · a, Concept · b\.$/)
    await decide(app, review, { whole: "approved" })
    assert.equal((await bridgedStep(root, "barrel", "concept")).state, "accepted")
  })

  it("the commands print the link on its own line, and status and next say who is waited for and where", async () => {
    const { root } = await waitingConcept()
    const asked = cli(root, "run", "request-review", "barrel", "concept")
    assert.equal(asked.status, 0, asked.stderr)
    const [line, link, hint] = asked.stdout.trimEnd().split("\n")
    assert.equal(line, `barrel: concept is waiting for ${REVIEWER}'s review at`)
    assert.match(link!, /^#\/reviews\/s\/sub_[a-z0-9]+$/)
    assert.match(hint!, HINT)
    const json = cli(root, "run", "request-review", "barrel", "concept", "--json").json<{ route: string; url?: string; hint: string; submission: string }>()
    assert.deepEqual([json.route, json.url], [link, undefined], "the same request, and no address is invented without a server")

    // With a server known for this checkout, every answer carries the address itself.
    const worktree = (await bridge(root, Effect.flatMap(Git, (git) => git.checkout))).worktree
    write(root, ".catalog/.local/server.json", JSON.stringify({ pid: process.pid, host: hostname(), port: 4612, url: "http://127.0.0.1:4612/", checkout: worktree, toolkit: "2.0.0", startedAt: "2026-11-16T10:00:00.000Z" }))
    const url = `http://127.0.0.1:4612/${link}`
    assert.equal(cli(root, "run", "request-review", "barrel", "concept", "--json").json<{ url: string }>().url, url)
    assert.equal(cli(root, "run", "request-review", "barrel", "concept").stdout.trimEnd().split("\n")[1], url)
    const waiting = `waiting for ${REVIEWER}'s review: ${url}`
    const status = cli(root, "run", "status", "barrel")
    assert.ok(status.stdout.includes(`concept     review   human  ${waiting}`), status.stdout)
    assert.ok(!status.stdout.includes("jam catalog open"), "no hint when the link works")
    assert.deepEqual(cli(root, "run", "status", "barrel", "--json").json<{ steps: ReadonlyArray<{ review: unknown }> }>().steps[0]!.review, { submission: json.submission, route: link, url })
    assert.ok(cli(root, "run", "status").stdout.includes(`barrel:1  asset   review  concept  ${waiting}`))
    const next = cli(root, "run", "next", "barrel", "--json").json<{ summary: string; commands: ReadonlyArray<{ command: string }>; step: { review: { url: string } } }>()
    assert.equal(next.summary, `concept is ${waiting}`)
    assert.deepEqual([next.step.review.url, next.commands[0]!.command], [url, "jam run status barrel"])

    // A recipe that names who decides the gate: every answer says so, and nothing is guessed from Git.
    assert.equal(cli(root, "recipe", "set", "asset", "concept", "--reviewer", "art lead").status, 0)
    assert.ok(cli(root, "run", "status", "barrel").stdout.includes("human by art lead  waiting for art lead's review: "), cli(root, "run", "status", "barrel").stdout)
  })
})

describe("what is never submitted", () => {
  it("review.mode agent and none: no gate needs a person, so nothing reaches the catalog", async () => {
    for (const mode of ["agent", "none"] as const) {
      const { root } = await waitingConcept({ review: { mode } })
      const refused = await bridgeFailure(root, requestReview({ run: "barrel", step: "concept" }))
      assert.equal(refused.code, "conflict", mode)
      assert.match(refused.message, mode === "agent" ? /concept does not wait for a person: its gate is agent \(review\.mode is "agent" in jam\.config\.json\)/ : /concept is not waiting for review: it is accepted/)
      assert.equal((await openCatalog(root).run("reviews.list", {})).total, 0, mode)
      assert.equal(runFile(root, "barrel").steps["concept"]!.records[0]!.submission, undefined)
    }
  })

  it("an agent's gate unless the run requires a person for it; a step with nothing to show", async () => {
    const root = catalogProject({ files: { "jam/recipes/memo.json": JSON.stringify({ version: 1, id: "memo", title: "Memo", steps: [{ id: "write", produces: [{ role: "text", kind: "text" }], review: "human" }] }) } })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    await record(root, "barrel", "concept", { files: [made.concept] })
    await review(root, "barrel", "concept", { relay: "chat: yes" })
    await record(root, "barrel", "turnaround", { files: made.views, symmetric: true })
    await review(root, "barrel", "turnaround", { relay: "chat: yes" })
    await record(root, "barrel", "mesh", { files: [made.model] })
    const agentGate = await bridgeFailure(root, requestReview({ run: "barrel", step: "mesh" }))
    assert.match(agentGate.message, /^step mesh does not wait for a person: its gate is agent$/)
    assert.match(agentGate.fix!, /jam run set barrel --human mesh/)
    await jam(root, setRun({ run: "barrel", human: ["mesh"] }))
    const asked = await bridge(root, requestReview({ run: "barrel", step: "mesh" }))
    const app = openCatalog(root)
    assert.deepEqual((await app.run("review.get", { submission: asked.submission })).items[0].parts.map((part: Any) => part.id), ["model:1"])

    await start(root, "memo", "readme")
    write(root, "work/.scratch/readme/1/memo.md", "words")
    await record(root, "readme", "write", { files: ["work/.scratch/readme/1/memo.md"] })
    const nothing = await bridgeFailure(root, requestReview({ run: "readme", step: "write" }))
    assert.equal(nothing.code, "unsupported")
    assert.match(nothing.message, /^nothing of step write can be shown in the catalog/)
    assert.match(nothing.fix!, /--evidence <path>.*--relay/)
    assert.equal((await app.run("reviews.list", {})).total, 1, "only the mesh was submitted")
  })
})

describe("what the subject's unit cannot show", () => {
  it("work the catalog does not list (an exploration) is reviewed as work, its files and evidence as captures", async () => {
    const root = catalogProject()
    await start(root, "image", "moodboard")
    write(root, "work/.scratch/moodboard/1/a.png", png(8, 8, [10, 20, 30]))
    write(root, "work/.scratch/moodboard/1/board.png", png(16, 8))
    write(root, "work/.scratch/moodboard/1/notes.md", "why")
    await record(root, "moodboard", "concept", { files: ["work/.scratch/moodboard/1/a.png"], evidence: [`board=work/.scratch/moodboard/1/board.png`, "work/.scratch/moodboard/1/notes.md"] })
    const asked = await bridge(root, requestReview({ run: "moodboard", step: "concept" }))
    const app = openCatalog(root)
    const submission = await app.run("review.get", { submission: asked.submission })
    const item = submission.items[0]
    assert.deepEqual([item.target, item.title], [null, "moodboard · Concept image"])
    assert.deepEqual(item.parts.map((part: Any) => [part.id, part.label]), [["capture:1", "Concept · a"], ["capture:2", "Board"]])
    assert.deepEqual(item.views.map((view: Any) => view.caption), ["Concept image: Concept · a", "Evidence: Board"])
    assert.match(submission.note, /\*\*To decide:\*\* Concept · a\. Supporting evidence: Board\.$/)
    // A person decides there, and the run reads it like any other review.
    await app.run("review.decide", { submission: asked.submission, item: item.id, whole: "approved" }, { actor: human })
    assert.equal((await bridgedStep(root, "moodboard", "concept")).state, "accepted")
  })

  it("evidence the catalog's own viewer captured (under .catalog/.local) is a capture beside the unit's parts", async () => {
    const { dir, root } = await waitingConcept()
    write(root, ".catalog/.local/captures/turntable.png", png(32, 32, [90, 90, 200]))
    await record(root, "barrel", "concept", { files: [`${dir}/a.png`, `${dir}/b.png`], evidence: [`side-by-side=${dir}/lineup.png`, "turntable=.catalog/.local/captures/turntable.png"], note: "Again, with a turntable.", tool: "image model 2" })
    const { app, review, submission } = await ask(root)
    assert.deepEqual(submission.items[0].target, { kind: "unit", id: "barrel" })
    assert.deepEqual(submission.items[0].parts.map((part: Any) => part.id), ["capture:1", "concept:1", "concept:2", "evidence:concept-side-by-side"])
    assert.deepEqual(submission.items[0].views.map((view: Any) => [view.part, view.caption]), [
      ["concept:1", "Concept image: Concept · a"],
      ["concept:2", "Concept image: Concept · b"],
      ["evidence:concept-side-by-side", "Evidence: Side by side"],
      ["capture:1", "Evidence: Turntable"]
    ])
    assert.equal(submission.items[0].parts[0].leaves[0].storage, "catalog", "machine-local bytes are frozen into the catalog's store")
    assert.deepEqual((await app.run("problems", {})).problems, [], "the capture is never a catalog asset, so nothing is reported")
    await decide(app, review, { whole: "approved" })
    assert.equal((await bridgedStep(root, "barrel", "concept")).state, "accepted")
  })
})

describe("a later step of the same role", () => {
  it("is reviewed on its own model, and a person's approval of the delivery is what delivers", async () => {
    const root = catalogProject()
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    const relay = (step: string) => review(root, "barrel", step, { relay: "chat: fine" })
    await record(root, "barrel", "concept", { files: [made.concept] })
    await relay("concept")
    await record(root, "barrel", "turnaround", { files: made.views, symmetric: true })
    await relay("turnaround")
    await record(root, "barrel", "mesh", { files: [made.model], accept: "watertight" })
    await record(root, "barrel", ["topology", "uv", "texture"], { files: [`model=${made.model}`], accept: "within budget" })
    await record(root, "barrel", "delivery", { files: [`model=${made.model}`], evidence: [`turntable=${made.dir}/views/front.png`] })
    const asked = await bridge(root, requestReview({ run: "barrel", step: "delivery" }))
    const app = openCatalog(root)
    const submission = await app.run("review.get", { submission: asked.submission })
    assert.deepEqual(submission.items[0].parts.map((part: Any) => part.id), ["model:1", "evidence:delivery-turntable"], "the delivery's model and its evidence, not the concept or the views")
    assert.match(submission.note, /- Measured: 1,000 triangles, 1 material, 0\.00 MiB of textures\. Budget prop allows 2,000 triangles, 1 material and 8 MiB\./)
    await app.run("review.decide", { submission: asked.submission, item: submission.items[0].id, whole: "approved" }, { actor: human })
    const delivered = cli(root, "run", "deliver", "barrel", "--json")
    assert.equal(delivered.status, 0, delivered.stderr)
    const stored = runFile(root, "barrel").steps["delivery"]!.records[0]!.reviews[0]!
    assert.deepEqual([stored.via, stored.by, stored.actor], ["catalog", "Rae Tester", "human"])
    // The delivered copy carries the approval; the catalog still shows one barrel, approved and unchanged.
    const detail = await app.run("unit.get", { id: "barrel" })
    assert.deepEqual(detail.review.parts.filter((part: Any) => part.verdict !== null).map((part: Any) => [part.id, part.verdict, part.changed]), [["model:1", "approved", false], ["evidence:delivery-turntable", "approved", false]])
    assert.equal(detail.unit.attrs.state, "delivered")
  })
})
