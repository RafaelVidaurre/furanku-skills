// What the jam-setup installer writes into catalog.config.json is what the catalog reads: the
// file it creates is opened here by the catalog itself, and a file it leaves for migration is one
// the catalog refuses with the same instruction.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { tempProject } from "../support.ts"
import { rejects } from "../catalog/helpers.ts"
import { openCatalog } from "./catalog-support.ts"
import { png, readJson, TOOLKIT, write } from "./fixtures.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const INSTALL = join(TOOLKIT, "../../scripts/install.mjs")

const install = (root: string): Record<string, Any> => {
  const result = spawnSync(process.execPath, [INSTALL, "--project", root, "--no-deps", "--no-lfs"], { encoding: "utf8", env: { ...process.env, HOME: root } })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as Record<string, Any>
}

describe("catalog.config.json as the installer writes it", () => {
  it("a fresh install lists manifest and jam, and the manifest plugin reads the file its entry's options name", async () => {
    const root = tempProject({ git: true })
    install(root)
    assert.deepEqual(readJson(root, "catalog.config.json"), { version: 3, plugins: [{ plugin: "manifest", options: { file: "Art/catalog.json" } }, "jam"] })
    // Hand-registered content goes where the created manifest says: a file per unit under Art/Catalog.
    write(root, "Art/Kit/chair.png", png(8, 8))
    write(root, "Art/Catalog/chair.json", JSON.stringify({ id: "kit/chair", type: "external-asset", name: "Chair", links: [{ role: "image", asset: "Art/Kit/chair.png" }] }))
    const app = openCatalog(root)
    const summary = await app.run("summary", {})
    assert.deepEqual([summary.plugins, summary.counts.units, summary.problems], [["media-core", "manifest", "jam"], 1, 0])
    assert.deepEqual((await app.run("problems", {})).problems, [], "the manifest is found, and a project without runs has nothing wrong")
    const chair = await app.run("unit.get", { id: "kit/chair" })
    assert.deepEqual([chair.unit.sources, chair.type.label], [["Art/Catalog/chair.json"], "External asset"])
    assert.deepEqual(chair.links[0].facts["jam-pixels"].facts, { width: 8, height: 8 }, "the jam plugin measures hand-registered media too")
  })

  it("a configuration it leaves for migration is one the catalog refuses with the same instruction", async () => {
    const root = tempProject({ git: true, files: { "catalog.config.json": JSON.stringify({ version: 2, plugins: ["manifest"], options: { manifest: { file: "Art/catalog.json" } } }) } })
    assert.equal(install(root)["catalogConfig"], "left as it is")
    // With the toolkit's packages in place, the installer asks the toolkit's own dry run.
    symlinkSync(join(TOOLKIT, "node_modules"), join(root, "tools/jam/node_modules"), "dir")
    assert.equal(install(root)["catalogMigration"], "needs migration: run jam catalog migrate")
    const error = await rejects(openCatalog(root).run("summary", {}), "unsupported")
    assert.deepEqual([error.message, error.fix], ["catalog.config.json was written by an older toolkit (version 2)", "run: jam catalog migrate"])
  })
})
