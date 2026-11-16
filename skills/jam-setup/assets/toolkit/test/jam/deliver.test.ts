import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { deliverRun } from "../../src/jam/runs/deliver.ts"
import { openJob, updateJobState } from "../../src/jam/runs/jobs.ts"
import type { Run } from "../../src/jam/runs/schema.ts"
import { sha256 } from "../../src/kernel/hash.ts"
import { git } from "../support.ts"
import { jam, jamFailure, jamProject, readJson, write } from "./fixtures.ts"
import { AGENT_MODE, record, recordFailure, review, start, stateOf, status, throughTexture } from "./flow.ts"

const project = (config: Record<string, unknown> = {}) => jamProject({ git: true, config: { ...AGENT_MODE, ...config } })

/** A finished asset run whose brief lives outside the run folder. */
const finished = async (root: string, id = "barrel") => {
  write(root, "design/barrel.md", "A weathered oak barrel")
  await start(root, "asset", id, { budget: "prop", brief: "design/barrel.md", briefText: undefined })
  const made = await throughTexture(root, id)
  await record(root, id, "delivery", { files: [`model=${made.model}`], evidence: [made.concept] })
  await review(root, id, "delivery", { relay: "chat: approved, deliver it" })
  return made
}

describe("delivery", () => {
  it("copies the accepted closure into the delivered root, rewrites record paths, verifies every hash and keeps the approvals", async () => {
    const root = project()
    const made = await finished(root)
    const scratch = readJson<Run>(root, "work/.scratch/barrel/1/run.json")
    const result = await jam(root, deliverRun("barrel"))
    assert.deepEqual([result.delivered, result.run, result.from], ["work/assets/barrel/1", "work/assets/barrel/1/run.json", "work/.scratch/barrel/1/run.json"])
    const delivered = readJson<Run>(root, result.run)
    // Files of the run folder keep their place; files from elsewhere are copied in under external/.
    assert.equal(delivered.brief.path, "work/assets/barrel/1/external/design/barrel.md")
    const model = delivered.steps["delivery"]!.records[0]!
    assert.equal(model.files[0]!.path, "work/assets/barrel/1/model.glb")
    assert.equal(model.metrics!.model, "work/assets/barrel/1/model.glb")
    assert.equal(model.evidence[0]!.path, "work/assets/barrel/1/concept.png")
    for (const log of Object.values(delivered.steps)) {
      for (const file of log.records.flatMap((entry) => [...entry.files, ...entry.inputs, ...entry.evidence])) {
        assert.ok(file.path.startsWith("work/assets/barrel/1/"), file.path)
        assert.equal(sha256(readFileSync(join(root, file.path))), file.sha256, `${file.path} is the reviewed bytes`)
      }
    }
    assert.equal(sha256(readFileSync(join(root, model.files[0]!.path))), sha256(readFileSync(join(root, made.model))))
    // The same records, with the same ids and the same decisions: nothing is approved twice.
    assert.equal(model.id, scratch.steps["delivery"]!.records.at(-1)!.id)
    assert.deepEqual(model.reviews, scratch.steps["delivery"]!.records.at(-1)!.reviews)
    assert.equal(model.reviews[0]!.words, "approved, deliver it")
    assert.equal(delivered.delivered!.files, result.files)
    // The delivered run is self-contained, tracked, and now what the subject id resolves to.
    const untracked = git(root, "status", "--porcelain", "--untracked-files=all", "--", "work").split("\n").map((line) => line.slice(3))
    assert.ok(untracked.includes(result.run) && untracked.includes(model.files[0]!.path), "Git sees the delivered files")
    assert.ok(!untracked.some((path) => path.startsWith("work/.scratch/")), "and still ignores scratch")
    const now = await status(root, "barrel")
    assert.deepEqual([now.run, now.delivered, now.settled, now.next.action], [result.run, true, true, "done"])
    assert.equal(readJson<Run>(root, "work/.scratch/barrel/1/run.json").deliveredTo, result.run)
    assert.equal((await jamFailure(root, deliverRun("barrel"))).code, "conflict")
    assert.match((await recordFailure(root, "barrel", "concept", { files: [made.concept] })).message, /is delivered and no longer changes/)
  })

  it("refuses an unfinished run, unsettled jobs, changed files and anything Git would ignore, and copies nothing", async () => {
    const root = project({ spend: { meshy: { perRun: 10 } } })
    write(root, "design/barrel.md", "A weathered oak barrel")
    await start(root, "asset", "barrel", { budget: "prop", brief: "design/barrel.md", briefText: undefined })
    const made = await throughTexture(root, "barrel")
    const unfinished = await jamFailure(root, deliverRun("barrel"))
    assert.match(unfinished.message, /run barrel:1 is not finished: delivery is ready/)
    await record(root, "barrel", "delivery", { files: [`model=${made.model}`] })
    assert.match((await jamFailure(root, deliverRun("barrel"))).message, /delivery is review/)
    await review(root, "barrel", "delivery", { relay: "chat: yes" })

    write(root, "work/requests/retexture.json", "{}")
    await jam(root, openJob({ run: "barrel", step: "texture", provider: "meshy", operation: "retexture", estimate: 1, request: "work/requests/retexture.json", price: "estimate", priceSource: "price page", authorized: "Sam: fine" }))
    const delivery = await import("./flow.ts").then((flow) => flow.stepStatus(root, "barrel", "delivery"))
    assert.equal(delivery.state, "check-failed")
    assert.match(delivery.reason!, /provider job j1 is not settled/)
    await jam(root, updateJobState({ run: "barrel", job: "j1", to: "cancelled", evidence: "never sent" }))

    // Git would ignore the delivered model: the closure check says so before anything moves.
    write(root, ".gitignore", "work/.scratch/\nwork/assets/**/*.glb\n")
    assert.equal(await stateOf(root, "barrel", "delivery"), "check-failed")
    const ignored = await jamFailure(root, deliverRun("barrel"))
    assert.match(ignored.message, /Git would ignore delivered file work\/assets\/barrel\/1\/model\.glb/)
    assert.equal(existsSync(join(root, "work/assets")), false, "nothing was copied")
    write(root, ".gitignore", "work/.scratch/\n")

    write(root, made.model, "tampered after review")
    assert.match((await jamFailure(root, deliverRun("barrel"))).message, /is not finished: .*model\.glb changed or is missing/)
    assert.equal(existsSync(join(root, "work/assets")), false)
  })

  it("exploration and test recipes are never delivered", async () => {
    const root = project({ style: { document: null, references: [] } })
    await start(root, "image", "moodboard")
    write(root, "work/.scratch/moodboard/1/a.png", (await import("./fixtures.ts")).png(4, 4))
    await record(root, "moodboard", "concept", { files: ["work/.scratch/moodboard/1/a.png"], accept: "ok" })
    assert.deepEqual((await status(root, "moodboard")).next, { action: "done", why: "recipe image is not delivered" })
    const error = await jamFailure(root, deliverRun("moodboard"))
    assert.equal(error.code, "forbidden")
    assert.match(error.message, /recipe image is for exploration or tests/)
  })
})
