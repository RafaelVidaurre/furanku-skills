// Runs as catalog content, through the catalog's public actions on real projects. Each test is a
// fault the jam project hit with the earlier adapter, or a rule of the plugin's mapping.
import assert from "node:assert/strict"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { deliverRun } from "../../src/jam/runs/deliver.ts"
import { sha256 } from "../../src/kernel/hash.ts"
import { catalogProject, human, openCatalog } from "./catalog-support.ts"
import { glb, jam, png, write } from "./fixtures.ts"
import { AGENT_MODE, makeFiles, record, review, start, throughTexture } from "./flow.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const BARREL = { kind: "unit", id: "barrel" }
const ids = async (app: ReturnType<typeof openCatalog>): Promise<ReadonlyArray<string>> =>
  ((await app.run("unit.search", {})).units as ReadonlyArray<{ id: string }>).map((item) => item.id).sort()
const part = (detail: Any, id: string): Any => detail.review.parts.find((candidate: Any) => candidate.id === id)
const link = (detail: Any, role: string): Any => detail.links.find((candidate: Any) => candidate.role === role)

describe("identity", () => {
  it("a subject is one unit through a delivery and a new attempt; its notes and verdicts stay with it", async () => {
    const root = catalogProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await throughTexture(root, "barrel")
    const app = openCatalog(root)
    await app.run("note.create", { target: { ...BARREL, part: "concept:1" }, body: "Keep this silhouette" }, { actor: human })
    await app.run("review.decideCurrent", { target: BARREL, whole: "changes" }, { actor: human })
    assert.deepEqual((await app.run("unit.get", { id: "barrel" })).unit.sources, ["work/.scratch/barrel/1/run.json"])

    // Delivery copies the files to other paths. The parts keep their keys, so nothing reads as changed.
    await record(root, "barrel", "delivery", { files: [`model=${made.model}`], accept: "within budget" })
    await jam(root, deliverRun("barrel"))
    let detail = await app.run("unit.get", { id: "barrel" })
    assert.deepEqual(await ids(app), ["barrel"], "the scratch run and its delivery are one unit")
    assert.deepEqual(detail.unit.sources, ["work/assets/barrel/1/run.json", "work/.scratch/barrel/1/run.json"], "every run is a source; the delivery is current")
    assert.equal(link(detail, "concept").asset.path, "work/assets/barrel/1/concept.png")
    assert.deepEqual(detail.review.parts.map((entry: Any) => entry.id), ["concept:1", "view:front", "view:left", "view:back", "view:right", "view:three-quarter", "model:1"])
    assert.ok(detail.review.parts.every((entry: Any) => entry.verdict === "changes" && entry.changed === false), JSON.stringify(detail.review.parts))
    assert.equal((await app.run("note.list", { target: BARREL })).notes.length, 1)
    assert.deepEqual([detail.unit.attrs.state, detail.unit.attrs.delivered, detail.unit.attrs.attempt], ["delivered", "work/assets/barrel/1", 1])

    // Another clone has only the delivery.
    rmSync(join(root, "work/.scratch"), { recursive: true })
    detail = await app.run("unit.get", { id: "barrel" })
    assert.deepEqual([detail.unit.sources, part(detail, "concept:1").verdict], [["work/assets/barrel/1/run.json"], "changes"])

    // Newer work is never hidden by an older delivery.
    await start(root, "asset", "barrel", { budget: "prop" })
    write(root, "work/.scratch/barrel/2/concept.png", png(16, 16, [10, 20, 30]))
    await record(root, "barrel", "concept", { files: ["work/.scratch/barrel/2/concept.png"], accept: "new direction" })
    detail = await app.run("unit.get", { id: "barrel" })
    assert.deepEqual(await ids(app), ["barrel"])
    assert.deepEqual(detail.unit.sources, ["work/.scratch/barrel/2/run.json", "work/assets/barrel/1/run.json"])
    assert.deepEqual([part(detail, "concept:1").verdict, part(detail, "concept:1").changed], ["changes", true], "other bytes under the same part")
    assert.deepEqual([detail.unit.attrs.attempt, detail.unit.attrs.delivered, detail.unit.attrs.state], [2, "work/assets/barrel/1", "in progress"])
    assert.equal((await app.run("note.list", { target: BARREL })).notes.length, 1)
  })

  it("only deliverable work is content: provider tests and explorations are not listed", async () => {
    const root = catalogProject()
    await start(root, "asset", "barrel", { budget: "prop" })
    await start(root, "provider-test", "meshy-check")
    await start(root, "image", "moodboard")
    write(root, "work/.scratch/moodboard/1/a.png", png(8, 8))
    await record(root, "moodboard", "concept", { files: ["work/.scratch/moodboard/1/a.png"] })
    const app = openCatalog(root)
    assert.deepEqual(await ids(app), ["barrel"])
    assert.deepEqual((await app.run("problems", {})).problems, [])
  })

  it("a subject id another plugin also registers is one unit and one named problem: the first plugin listed supplies it", async () => {
    const manifest = { version: 2, assetRoots: ["kit"], types: { piece: { label: "Kit piece" } }, units: [{ id: "barrel", type: "piece", name: "Kit barrel" }] }
    for (const [plugins, type] of [[["manifest", "jam"], "piece"], [["jam", "manifest"], "asset"]] as const) {
      const root = catalogProject({ plugins, files: { "catalog.manifest.json": JSON.stringify(manifest) } })
      await start(root, "asset", "barrel", { budget: "prop" })
      const app = openCatalog(root)
      assert.deepEqual(await ids(app), ["barrel"])
      assert.equal((await app.run("unit.get", { id: "barrel" })).unit.type, type)
      const problems = (await app.run("problems", {})).problems as ReadonlyArray<{ error: string }>
      assert.deepEqual(problems.map((problem) => problem.error.replace(/ \(also from .*\)$/, "")), ["duplicate unit id barrel"])
    }
  })

  it("a project without jam.config.json is honestly empty", async () => {
    const root = catalogProject()
    rmSync(join(root, "jam.config.json"))
    const app = openCatalog(root)
    const summary = await app.run("summary", {})
    assert.deepEqual([summary.counts.units, summary.counts.assets, summary.problems], [0, 0, 0])
  })
})

describe("types, roles and derived fields", () => {
  const POSTER = {
    version: 1,
    id: "poster",
    title: "Key art",
    catalog: { scope: "main" },
    steps: [{ id: "paint", title: "Painting", produces: [{ role: "art", kind: "image", max: 1 }, { role: "layers", kind: "any", min: 0 }, { role: "notes", kind: "text", min: 0 }], review: "human" }]
  }

  it("a recipe is a type: its title, its scope, the roles its steps produce; workflow facts are derived fields", async () => {
    const root = catalogProject({ files: { "jam/recipes/poster.json": JSON.stringify(POSTER) } })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    await record(root, "barrel", "concept", { files: [made.concept], evidence: [`sheet=${made.dir}/views/front.png`] })
    await start(root, "poster", "cover")
    write(root, "work/.scratch/cover/1/art.png", png(32, 16))
    write(root, "work/.scratch/cover/1/art.psd", "layers")
    write(root, "work/.scratch/cover/1/notes.md", "palette notes")
    await record(root, "cover", "paint", { files: ["art=work/.scratch/cover/1/art.png", "layers=work/.scratch/cover/1/art.psd", "notes=work/.scratch/cover/1/notes.md"] })
    const app = openCatalog(root)
    assert.deepEqual((await app.run("problems", {})).problems, [])

    const cover = await app.run("unit.get", { id: "cover" })
    assert.deepEqual([cover.unit.type, cover.unit.scope, cover.type.label, cover.type.reviewAttributes], ["poster", "main", "Key art", false])
    assert.deepEqual(cover.type.roles.map((role: Any) => [role.key, role.many, role.mediaKinds]), [
      ["art", false, ["image"]],
      ["layers", true, ["image", "video", "model", "audio"]],
      ["evidence", true, ["image", "video", "model", "audio"]]
    ], "a text output is recorded, not shown")
    assert.deepEqual(cover.links.map((entry: Any) => [entry.role, entry.asset.path, entry.meta]), [["art", "work/.scratch/cover/1/art.png", { step: "paint", width: 32, height: 16 }]], "a file the catalog cannot show is not linked")
    assert.deepEqual(cover.review.parts.map((entry: Any) => entry.id), ["art"], "no attributes part: nothing about the workflow is reviewed")

    const barrel = await app.run("unit.get", { id: "barrel" })
    assert.deepEqual([barrel.unit.type, barrel.unit.scope, barrel.type.label], ["asset", "material", "3D asset"])
    assert.deepEqual(barrel.type.roles.map((role: Any) => [role.key, role.many]), [["concept", true], ["view", true], ["model", true], ["evidence", true]])
    assert.ok(barrel.type.fields.every((field: Any) => field.derived), "every field is a live fact")
    assert.deepEqual(barrel.links.map((entry: Any) => [entry.role, entry.key]), [["concept", "1"], ["evidence", "concept-sheet"]])
    const attrs = barrel.unit.attrs
    assert.deepEqual(
      [attrs.state, attrs.next, attrs.people, attrs["step.concept"], attrs["step.turnaround"], attrs.budget, attrs.attempt, attrs.run],
      ["waiting for a person", "concept waits for a person's acceptance", "concept, turnaround, delivery", "waiting for a person's acceptance", "waiting: needs concept (review)", "prop", 1, "work/.scratch/barrel/1/run.json"]
    )
    // The run state and the budget are facets.
    const search = await app.run("unit.search", { filters: { "attr.state": ["waiting for a person"], type: ["asset"] } })
    assert.deepEqual(search.units.map((item: Any) => item.id), ["barrel"])
  })

  it("catalog actions never write a run; a gate decision changes derived fields only and marks no verdict changed; changed bytes do", async () => {
    const root = catalogProject()
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    await record(root, "barrel", "concept", { files: [made.concept] })
    const runFile = (): string => readFileSync(join(root, "work/.scratch/barrel/1/run.json"), "utf8")
    const before = runFile()
    const app = openCatalog(root)
    // Notes, verdicts and tags given in the catalog never write a run record, and a verdict that
    // was not asked for through the run is not the run's decision.
    await app.run("note.create", { target: BARREL, body: "Prefer this direction" }, { actor: human })
    await app.run("review.decideCurrent", { target: BARREL, whole: "approved" }, { actor: human })
    await app.run("organization.set", { target: BARREL, tags: ["shortlist"] }, { actor: human })
    assert.equal(runFile(), before)
    assert.equal((await app.run("unit.get", { id: "barrel" })).unit.attrs["step.concept"], "waiting for a person's acceptance")

    await review(root, "barrel", "concept", { relay: "chat: yes, that one" })
    let detail = await app.run("unit.get", { id: "barrel" })
    assert.deepEqual([detail.unit.attrs["step.concept"], detail.unit.attrs.state, detail.unit.attrs.next], ["accepted", "in progress", "turnaround: nothing is recorded yet"])
    assert.ok(detail.review.parts.every((entry: Any) => entry.verdict === "approved" && entry.changed === false), "the decision changed derived fields only")

    write(root, made.concept, png(16, 16, [1, 2, 3]))
    detail = await app.run("unit.get", { id: "barrel" })
    assert.equal(part(detail, "concept:1").changed, true)
    assert.match(detail.unit.attrs["step.concept"], /^stale: .*concept\.png changed or is missing/)
    assert.equal(detail.unit.attrs.state, "needs rework")
  })
})

describe("the model a unit shows", () => {
  it("is the one the step selected and measured, the latest step's, and never another file when that one cannot be shown", async () => {
    const root = catalogProject({ config: AGENT_MODE })
    await start(root, "asset", "table", { budget: "prop" })
    const made = await makeFiles(root, "table")
    await record(root, "table", "concept", { files: [made.concept], accept: "ok" })
    await record(root, "table", "turnaround", { files: made.views, symmetric: true, accept: "ok" })
    await record(root, "table", "mesh", { files: [made.model], accept: "ok" })
    const dir = made.dir
    write(root, `${dir}/source.glb`, await glb({ triangles: 1900 }))
    const final = await glb({ triangles: 900 })
    write(root, `${dir}/final.glb`, final)
    await record(root, "table", "topology", { files: [`model=${dir}/final.glb`, `source=${dir}/source.glb`], accept: "ok" })
    const app = openCatalog(root)
    let detail = await app.run("unit.get", { id: "table" })
    assert.deepEqual([link(detail, "model").asset.path, link(detail, "model").asset.sha256, link(detail, "model").meta.step], [`${dir}/final.glb`, sha256(final), "topology"])
    assert.deepEqual([detail.unit.attrs.triangles, detail.unit.attrs.materials], [900, 1], "measurements are derived metadata of the selected model")
    assert.equal(detail.links.filter((entry: Any) => entry.role === "model").length, 1, "the source model of the same record is not shown")

    // The selected model is in a format the catalog cannot show: the role is empty. Neither the
    // source GLB of this record nor the mesh step's GLB stands in for it.
    const fbx = Buffer.from("synthetic DCC export")
    write(root, `${dir}/final.fbx`, fbx)
    write(root, `${dir}/measurement.json`, JSON.stringify({ model: { path: `${dir}/final.fbx`, sha256: sha256(fbx) }, tool: "DCC 4.2", command: "measure final.fbx", metrics: { triangles: 880, materials: 1, textureMiB: 0, textureDimensions: [] } }))
    await record(root, "table", "topology", { files: [`model=${dir}/final.fbx`, `source=${dir}/source.glb`], evidence: [`measurement=${dir}/measurement.json`], accept: "ok" })
    detail = await app.run("unit.get", { id: "table" })
    assert.equal(link(detail, "model"), undefined)
    assert.equal(detail.unit.attrs.triangles, 880)

    // Several candidates in the role, and the measured one is the FBX: the GLB candidates beside
    // it are not what the step selected, so they are not shown as its model either.
    await start(root, "asset", "stool", { budget: "prop" })
    const stool = await makeFiles(root, "stool")
    await record(root, "stool", "concept", { files: [stool.concept], accept: "ok" })
    await record(root, "stool", "turnaround", { files: stool.views, symmetric: true, accept: "ok" })
    write(root, `${stool.dir}/a.glb`, await glb({ triangles: 700 }))
    write(root, `${stool.dir}/b.glb`, await glb({ triangles: 800 }))
    write(root, `${stool.dir}/chosen.fbx`, fbx)
    write(root, `${stool.dir}/measurement.json`, JSON.stringify({ model: { path: `${stool.dir}/chosen.fbx`, sha256: sha256(fbx) }, tool: "DCC 4.2", command: "measure chosen.fbx", metrics: { triangles: 750, materials: 1 } }))
    await record(root, "stool", "mesh", { files: ["a.glb", "b.glb", "chosen.fbx"].map((name) => `model=${stool.dir}/${name}`), evidence: [`measurement=${stool.dir}/measurement.json`], accept: "ok" })
    const candidates = await app.run("unit.get", { id: "stool" })
    assert.deepEqual([link(candidates, "model"), candidates.unit.attrs.triangles], [undefined, 750])
    assert.deepEqual((await app.run("problems", {})).problems, [])
  })

  it("a version 1 run shows its recorded runtime model", async () => {
    const root = catalogProject()
    const dir = "work/assets/table/v1"
    const stamp = (path: string) => ({ path, sha256: sha256(readFileSync(join(root, path))) })
    write(root, `${dir}/brief.md`, "A tavern table")
    write(root, `${dir}/concept.png`, png(8, 8))
    write(root, `${dir}/source.glb`, await glb({ triangles: 1800 }))
    write(root, `${dir}/final.glb`, await glb({ triangles: 1000 }))
    const base = { inputs: [], evidence: [], note: "made", reviews: [], dependencies: {}, provenance: { provider: "local", model: "Blender 4.2", transport: "file" } }
    write(root, `${dir}/run.json`, JSON.stringify({
      version: 1, id: "table", profile: "prop", created: "2026-11-10T09:00:00.000Z", brief: stamp(`${dir}/brief.md`),
      context: { style: { revision: null } },
      stages: {
        concept: [{ ...base, id: "c-1", created: "2026-11-10T09:10:00.000Z", files: [stamp(`${dir}/concept.png`)], metrics: {} }],
        topology: [{ ...base, id: "p-1", created: "2026-11-10T09:40:00.000Z", files: [stamp(`${dir}/source.glb`), stamp(`${dir}/final.glb`)], runtimeModel: `${dir}/final.glb`, metrics: { triangles: 1000, materials: 1, textureDimensions: [], textureMiB: 0 } }]
      },
      jobs: []
    }))
    const detail = await openCatalog(root).run("unit.get", { id: "table" })
    assert.deepEqual([detail.unit.type, link(detail, "model").asset.path, link(detail, "concept").key, detail.unit.attrs.triangles], ["asset", `${dir}/final.glb`, "1", 1000])
  })
})

describe("loading", () => {
  it("a run that cannot be read is one problem naming its file; every other run loads", async () => {
    const root = catalogProject({
      files: {
        "jam/recipes/poster.json": JSON.stringify({ version: 1, id: "poster", title: "Key art", steps: [{ id: "paint" }] })
      }
    })
    await start(root, "asset", "barrel", { budget: "prop" })
    await start(root, "poster", "cover")
    write(root, "work/broken/run.json", JSON.stringify({ version: 2, id: "bad", steps: { mesh: [{}] } }))
    write(root, "work/torn/run.json", "{ not json")
    rmSync(join(root, "jam/recipes/poster.json"))
    const app = openCatalog(root)
    assert.deepEqual(await ids(app), ["barrel"])
    const problems = (await app.run("problems", {})).problems as ReadonlyArray<{ subject: string; error: string }>
    assert.deepEqual(problems.map((problem) => problem.subject).sort(), ["work/.scratch/cover/1/run.json", "work/broken/run.json", "work/torn/run.json"])
    assert.match(problems.find((problem) => problem.subject === "work/.scratch/cover/1/run.json")!.error, /recipe poster does not exist/)
    rmSync(join(root, "work/broken"), { recursive: true })
    rmSync(join(root, "work/torn"), { recursive: true })
    assert.deepEqual(((await app.run("problems", {})).problems as ReadonlyArray<{ subject: string }>).map((problem) => problem.subject), ["work/.scratch/cover/1/run.json"])
  })

  it("the runs are read again when a run file or a file a run recorded changes, and not otherwise", async () => {
    const root = catalogProject()
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    const app = openCatalog(root)
    const loads = async (): Promise<number> => (await app.stats()).sourceLoads["jam/runs"] ?? 0
    await app.run("summary", {})
    assert.equal(await loads(), 1)
    await app.run("unit.search", {})
    await app.run("unit.get", { id: "barrel" })
    assert.equal(await loads(), 1, "nothing changed")
    // Work in progress under the content roots that no run names is not the catalog's business.
    write(root, "work/.scratch/barrel/1/draft.png", png(4, 4))
    write(root, "work/elsewhere/notes.md", "ideas")
    await app.run("summary", {})
    assert.equal(await loads(), 1)

    await record(root, "barrel", "concept", { files: [made.concept] })
    assert.equal((await app.run("unit.get", { id: "barrel" })).links.length, 1)
    assert.equal(await loads(), 2, "the run file changed")
    // A recorded file changing is what makes its step stale, so it is an input too.
    write(root, made.concept, png(16, 16, [9, 9, 9]))
    assert.match((await app.run("unit.get", { id: "barrel" })).unit.attrs["step.concept"], /^stale/)
    assert.equal(await loads(), 3)
    await app.run("summary", {})
    assert.equal(await loads(), 3)
  })
})
