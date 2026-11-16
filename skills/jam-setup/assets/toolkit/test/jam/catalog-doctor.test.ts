// What `jam catalog doctor` says about runs. Each check reports and advises; none changes a file.
import assert from "node:assert/strict"
import { appendFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { deliverRun } from "../../src/jam/runs/deliver.ts"
import { openJob, updateJobState } from "../../src/jam/runs/jobs.ts"
import { requestReview } from "../../src/jam/runs/review.ts"
import { bridge, catalogProject, human, openCatalog } from "./catalog-support.ts"
import { cli, jam, type JamProject, write } from "./fixtures.ts"
import { AGENT_MODE, makeFiles, record, start, throughTexture } from "./flow.ts"

interface Found {
  readonly message: string
  readonly subject: string | null
  readonly severity: string
  readonly fix: string | null
  readonly fixable: boolean
}
type App = ReturnType<typeof openCatalog>

const check = async (app: App, name: string): Promise<ReadonlyArray<Found>> =>
  ((await app.run("doctor", {})).checks as ReadonlyArray<{ name: string; plugin: string; problems: ReadonlyArray<Found> }>).find((entry) => entry.name === name && entry.plugin === "jam")!.problems

const delivered = async (options: JamProject = {}, extra: Parameters<typeof record>[3] = {}) => {
  const root = catalogProject({ ...options, config: { ...AGENT_MODE, ...options.config } })
  await start(root, "asset", "barrel", { budget: "prop" })
  const made = await throughTexture(root, "barrel")
  await record(root, "barrel", "delivery", { files: [`model=${made.model}`], accept: "within budget", ...extra })
  await jam(root, deliverRun("barrel"))
  return root
}

describe("doctor", () => {
  it("a delivered run whose files are missing or ignored by Git is a problem", async () => {
    const root = await delivered()
    const app = openCatalog(root)
    assert.deepEqual(await check(app, "jam-delivered-files"), [])
    rmSync(join(root, "work/assets/barrel/1/views/left.png"))
    appendFileSync(join(root, ".gitignore"), "work/assets/barrel/1/model.glb\n")
    const found = await check(app, "jam-delivered-files")
    assert.deepEqual(found.map((problem) => [problem.subject, problem.severity]), [["work/assets/barrel/1/run.json", "problem"], ["work/assets/barrel/1/run.json", "problem"]])
    assert.match(found[0]!.message, /^barrel:1 is delivered at work\/assets\/barrel\/1, but a file it stands on is missing: work\/assets\/barrel\/1\/views\/left\.png$/)
    assert.match(found[1]!.message, /but Git ignores work\/assets\/barrel\/1\/model\.glb: another checkout will not have it$/)
    assert.match(found[1]!.fix!, /\.gitignore/)
    assert.equal((await app.run("doctor", {})).ok, false)
  })

  it("an unsettled provider job is listed; a lost one is a problem with the commands that settle it", async () => {
    const root = catalogProject({ config: AGENT_MODE, files: { "work/requests/concept.json": JSON.stringify({ prompt: "a barrel" }) } })
    await start(root, "asset", "barrel", { budget: "prop" })
    const app = openCatalog(root)
    assert.deepEqual(await check(app, "jam-unsettled-jobs"), [])
    await jam(root, openJob({ run: "barrel", step: "concept", provider: "meshy", operation: "text to image", estimate: 7, request: "work/requests/concept.json", price: "estimate", priceSource: "dry run", authorized: "Sam: go ahead" }))
    let found = await check(app, "jam-unsettled-jobs")
    assert.deepEqual(found.map((problem) => [problem.subject, problem.severity, problem.fixable]), [["barrel:1", "info", false]])
    assert.match(found[0]!.message, /^barrel:1: job j1 \(meshy, text to image\) is open; its 7 credits stay reserved until it is settled$/)
    await jam(root, updateJobState({ run: "barrel", job: "j1", to: "lost" }))
    found = await check(app, "jam-unsettled-jobs")
    assert.equal(found[0]!.severity, "problem")
    assert.match(found[0]!.fix!, /jam job submitted barrel j1 --provider-job <ref>.*jam job cancelled barrel j1 --evidence/)
    assert.equal((await app.run("unit.get", { id: "barrel" })).unit.attrs.jobs, "1 (j1 lost)")
  })

  it("a step that waits on a person nobody asked is listed with the command that asks; an asked one is not", async () => {
    const root = catalogProject()
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    const app = openCatalog(root)
    assert.deepEqual(await check(app, "jam-review-not-requested"), [])
    await record(root, "barrel", "concept", { files: [made.concept] })
    assert.deepEqual(await check(app, "jam-review-not-requested"), [{
      subject: "barrel",
      severity: "info",
      message: "barrel: concept waits for a person's acceptance and no review was requested",
      fix: "jam run request-review barrel concept",
      fixable: false
    }])
    assert.equal((await app.run("doctor", {})).ok, true, "work waiting on a person is information, not a fault")
    await bridge(root, requestReview({ run: "barrel", step: "concept" }))
    assert.deepEqual(await check(app, "jam-review-not-requested"), [])
    assert.equal((await app.run("unit.get", { id: "barrel" })).unit.attrs["step.concept"], "waiting for a person's review in the catalog")
  })

  const IMPORTER = {
    "jam/engines/fake/adapter.json": JSON.stringify({ id: "fake", label: "Fake engine", facts: { unitsPerMeter: 100, up: "+Z", forward: "+X", handedness: "left" }, commands: { import: { run: ["node", "commands/import.mjs"], kinds: ["static"] } } }),
    "jam/engines/fake/commands/import.mjs": "console.log('{}')\n"
  }

  it("a delivered subject without an engine asset id is a problem once the engine adapter can import", async () => {
    const plain = openCatalog(await delivered())
    assert.deepEqual(await check(plain, "jam-not-imported"), [], "no adapter imports, so nothing is missing")

    const root = await delivered({ config: { engine: { adapter: "fake", facts: {} } }, files: IMPORTER })
    const found = await check(openCatalog(root), "jam-not-imported")
    assert.deepEqual(found.map((problem) => [problem.subject, problem.severity]), [["barrel", "problem"]])
    assert.match(found[0]!.message, /^barrel is delivered at work\/assets\/barrel\/1 but has no engine asset id, and engine adapter fake can import$/)
    assert.match(found[0]!.fix!, /jam run start asset barrel --brief <file>/)

    const imported = await delivered({ config: { engine: { adapter: "fake", facts: {} } }, files: IMPORTER }, { engineAssets: [{ kind: "static", id: "/Game/Props/SM_Barrel" }] })
    const app = openCatalog(imported)
    assert.deepEqual(await check(app, "jam-not-imported"), [])
    assert.equal((await app.run("unit.get", { id: "barrel" })).unit.attrs.engineAsset, "/Game/Props/SM_Barrel")
  })

  it("a scratch run superseded by a delivery is listed with its folder, and nothing deletes it", async () => {
    const root = await delivered()
    const app = openCatalog(root)
    const found = await check(app, "jam-superseded-scratch")
    assert.deepEqual(found, [{
      subject: "work/.scratch/barrel/1",
      severity: "info",
      message: "work/.scratch/barrel/1 holds scratch run barrel:1, superseded by the delivery at work/assets/barrel/1",
      fix: "delete the folder when nothing in it is still wanted: work/.scratch/barrel/1",
      fixable: false
    }])
    const fixed = await app.run("doctor.fix", {}, { actor: human })
    assert.equal(fixed.summary.fixed, 0)
    assert.ok(existsSync(join(root, "work/.scratch/barrel/1/run.json")), "the folder is the person's to delete")

    // A newer attempt is work in progress, and a folder another run still reads from is not offered.
    await start(root, "asset", "barrel", { budget: "prop" })
    write(root, "work/.scratch/barrel/2/concept.png", "not yet")
    assert.deepEqual((await check(app, "jam-superseded-scratch")).map((problem) => problem.subject), ["work/.scratch/barrel/1"])
    await start(root, "asset", "crate", { budget: "prop" })
    const crate = await makeFiles(root, "crate")
    await record(root, "crate", "concept", { files: [crate.concept], inputs: ["work/.scratch/barrel/1/concept.png"], accept: "ok" })
    assert.deepEqual(await check(app, "jam-superseded-scratch"), [])
  })

  it("the command prints the checks under their headings and exits 1 only for problems", async () => {
    const root = await delivered()
    const clean = cli(root, "catalog", "doctor")
    assert.equal(clean.status, 0, clean.stderr)
    assert.match(clean.stdout, /Scratch runs superseded by a delivery \(1\)\n {2}- work\/\.scratch\/barrel\/1 holds scratch run barrel:1/)
    rmSync(join(root, "work/assets/barrel/1/model.glb"))
    const broken = cli(root, "catalog", "doctor")
    assert.equal(broken.status, 1)
    assert.match(broken.stdout, /Delivered runs with missing or Git-ignored files \(1\)\n {2}! barrel:1 is delivered at work\/assets\/barrel\/1, but a file it stands on is missing/)
  })
})
