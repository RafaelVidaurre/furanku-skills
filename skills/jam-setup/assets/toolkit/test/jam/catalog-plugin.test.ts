// The other plugin points of `jam`: probes, the made-from relation, and what loading costs.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { catalogProject, openCatalog } from "./catalog-support.ts"
import { glb, png, TOOLKIT, write } from "./fixtures.ts"
import { AGENT_MODE, makeFiles, record, start } from "./flow.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const MANIFEST = {
  version: 1,
  assetRoots: ["kit"],
  types: { piece: { label: "Kit piece", roles: [{ key: "model", label: "Model", kinds: ["model"] }, { key: "picture", label: "Picture", kinds: ["image"] }] } },
  units: [{ id: "kit/plank", type: "piece", name: "Plank", links: [{ role: "model", asset: "kit/plank.glb" }, { role: "picture", asset: "kit/plank.png" }] }]
}

const kitProject = async (): Promise<string> =>
  catalogProject({
    config: AGENT_MODE,
    plugins: ["manifest", "jam"],
    files: { "catalog.manifest.json": JSON.stringify(MANIFEST), "kit/plank.glb": await glb({ triangles: 340, texture: 8 }), "kit/plank.png": png(24, 12) }
  })

describe("probes", () => {
  it("the toolkit's measurements appear on any catalog asset and are made once per file version", async () => {
    const root = await kitProject()
    const app = openCatalog(root)
    assert.deepEqual((await app.run("schema", {})).probes.map((probe: Any) => [probe.name, probe.plugin, probe.kinds]), [["jam-geometry", "jam", ["model"]], ["jam-pixels", "jam", ["image"]]])
    // Hand-registered content, never part of a run.
    const plank = await app.run("unit.get", { id: "kit/plank" })
    const facts = Object.fromEntries(plank.links.map((entry: Any) => [entry.role, entry.facts]))
    assert.deepEqual(facts["model"]["jam-geometry"].facts, { triangles: 340, materials: 1, textureMiB: 0, textures: ["8×8"], vertices: 4, drawPrimitives: 1 })
    assert.deepEqual(facts["picture"]["jam-pixels"].facts, { width: 24, height: 12 })
    assert.equal((await app.stats()).probesMeasured, 2)
    await app.run("unit.get", { id: "kit/plank" })
    assert.deepEqual((await app.run("asset.get", { id: "kit/plank.glb" })).facts["jam-geometry"].facts.triangles, 340)
    assert.equal((await app.stats()).probesMeasured, 2, "measured once")

    // The cache is keyed by the bytes: the same model at another path, as a run's output, is not measured again.
    await start(root, "asset", "crate", { budget: "prop" })
    const made = await makeFiles(root, "crate")
    await record(root, "crate", "concept", { files: [made.concept], accept: "ok" })
    await record(root, "crate", "turnaround", { files: made.views, symmetric: true, accept: "ok" })
    write(root, made.model, await glb({ triangles: 340, texture: 8 }))
    await record(root, "crate", "mesh", { files: [made.model], accept: "ok" })
    const crate = await app.run("unit.get", { id: "crate" })
    assert.equal(crate.links.find((entry: Any) => entry.role === "model").facts["jam-geometry"].facts.triangles, 340)
    const measured = (await app.stats()).probesMeasured
    assert.equal(measured, 2 + 6, "the six new images, and no model")

    // A new process finds the results on disk.
    const restarted = openCatalog(root)
    assert.equal((await restarted.run("unit.get", { id: "kit/plank" })).links[0].facts["jam-geometry"].facts.triangles, 340)
    assert.equal((await restarted.stats()).probesMeasured, 0)
  })
})

describe("made from", () => {
  it("a subject's inputs lead to the units they came from, in either plugin, and those units show who used them", async () => {
    const root = await kitProject()
    // The barrel's concept is an input of the crate; so is a hand-registered kit piece.
    await start(root, "asset", "barrel", { budget: "prop" })
    const barrel = await makeFiles(root, "barrel")
    await record(root, "barrel", "concept", { files: [barrel.concept], accept: "ok" })
    await start(root, "asset", "crate", { budget: "prop" })
    const crate = await makeFiles(root, "crate")
    await record(root, "crate", "concept", { files: [crate.concept], inputs: [barrel.concept, "kit/plank.png", "work/style.md"], accept: "ok" })
    const app = openCatalog(root)
    const relations = async (id: string) => ((await app.run("unit.get", { id })).relations as ReadonlyArray<Any>).map((relation) => [relation.name, relation.direction, relation.label, relation.units.map((unit: Any) => unit.id)])
    assert.deepEqual(await relations("crate"), [["made-from", "out", "Made from", ["barrel", "kit/plank"]]])
    assert.deepEqual(await relations("barrel"), [["made-from", "in", "Used by", ["crate"]]])
    assert.deepEqual(await relations("kit/plank"), [["made-from", "in", "Used by", ["crate"]]], "the hand-registered unit stores nothing; the reverse side is computed")
    const detail = await app.run("unit.get", { id: "crate" })
    assert.deepEqual(detail.unit.attrs.inputs, [barrel.concept, "kit/plank.png", "work/style.md"])
    assert.deepEqual(detail.refs.madeFrom.map((unit: Any) => [unit.id, unit.exists]), [["barrel", true], ["kit/plank", true]])
    assert.ok(detail.review.parts.every((part: Any) => part.id !== "attributes"), "provenance is not a reviewed attribute")
  })
})

describe("what loading costs", () => {
  // Every module a command loads, seen from inside the process.
  const loaded = (root: string, ...args: ReadonlyArray<string>): ReadonlyArray<string> => {
    const hook = join(root, "hook.mjs")
    write(root, "hook.mjs", `import { registerHooks } from "node:module"
const seen = new Set()
registerHooks({ resolve(specifier, context, next) { const found = next(specifier, context); seen.add(found.url); return found } })
process.on("exit", () => process.stderr.write("\\nLOADED " + JSON.stringify([...seen])))
`)
    const result = spawnSync(process.execPath, ["--import", hook, join(TOOLKIT, "src/cli/main.ts"), ...args, "--root", root], { encoding: "utf8", env: { ...process.env, JAM_NO_INSTALL: "1" } })
    assert.equal(result.status, 0, result.stderr)
    return (JSON.parse(result.stderr.slice(result.stderr.lastIndexOf("LOADED ") + 7)) as ReadonlyArray<string>).filter((url) => url.includes("/src/")).map((url) => url.slice(url.indexOf("/src/") + 1))
  }

  it("a catalog that does not list jam loads none of the ledger; a ledger command loads none of the catalog", async () => {
    const manifestOnly = catalogProject({ plugins: ["manifest"], files: { "catalog.manifest.json": JSON.stringify(MANIFEST), "kit/plank.glb": await glb(), "kit/plank.png": png(4, 4) } })
    const catalogModules = loaded(manifestOnly, "catalog", "run", "unit.get", "--input", JSON.stringify({ id: "kit/plank" }))
    assert.ok(catalogModules.includes("src/jam/catalog/plugin.ts"), "the plugin is registered by name")
    assert.deepEqual(catalogModules.filter((path) => path.startsWith("src/jam/") && path !== "src/jam/catalog/plugin.ts"), [], "and nothing behind it is loaded")

    const withRuns = catalogProject()
    await start(withRuns, "asset", "barrel", { budget: "prop" })
    for (const command of [["run", "status", "barrel"], ["run", "next", "barrel"], ["run", "status"], ["job", "list"]]) {
      assert.deepEqual(loaded(withRuns, ...command).filter((path) => path.startsWith("src/catalog/") || path.startsWith("src/jam/catalog/")), [], `jam ${command.join(" ")}`)
    }
    // With the plugin listed, the catalog reads runs through the ledger.
    assert.ok(loaded(withRuns, "catalog", "run", "catalog.search").includes("src/jam/runs/Runs.ts"))
    assert.ok(existsSync(join(withRuns, "catalog.config.json")))
  })
})
