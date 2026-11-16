// What the jam-setup installer writes into catalog.config.json is what the catalog reads: the
// file it creates and the files it migrates are opened here by the catalog itself.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { describe, it } from "node:test"
import { tempProject } from "../support.ts"
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

// A version 1 adapter of the project's own: it lists one unit named after the options it was given.
const ADAPTER = `export default ({ options }) => ({
  name: "project",
  sources: () => [],
  load: () => ({ assetRoots: ["lore"], types: { note: { label: "Note" } }, units: [{ id: "note/options", type: "note", name: JSON.stringify(options) }] })
})
`

describe("catalog.config.json as the installer writes it", () => {
  it("a fresh install lists manifest and jam, and the manifest plugin reads the file the options name", async () => {
    const root = tempProject({ git: true })
    install(root)
    assert.deepEqual(readJson(root, "catalog.config.json"), { version: 2, plugins: ["manifest", "jam"], options: { manifest: { file: "Art/catalog.json" } } })
    // Hand-registered content goes where the created manifest says: a file per unit under Art/Catalog.
    write(root, "Art/Kit/chair.png", png(8, 8))
    write(root, "Art/Catalog/chair.json", JSON.stringify({ id: "kit/chair", type: "external-asset", name: "Chair", links: [{ role: "image", asset: "Art/Kit/chair.png" }] }))
    const app = openCatalog(root)
    const context = await app.run("context", {})
    assert.deepEqual([context.plugins, context.counts.units, context.problems], [["media-core", "manifest", "jam"], 1, 0])
    assert.deepEqual((await app.run("problems", {})).problems, [], "the manifest is found, and a project without runs has nothing wrong")
    const chair = await app.run("unit.get", { id: "kit/chair" })
    assert.deepEqual([chair.unit.sources, chair.type.label], [["Art/Catalog/chair.json"], "External asset"])
    assert.deepEqual(chair.links[0].facts["jam-pixels"].facts, { width: 8, height: 8 }, "the jam plugin measures hand-registered media too")
  })

  it("a project's own version 1 adapter keeps its options as a plugin when nothing would be lost", async () => {
    const root = tempProject({
      git: true,
      files: {
        "tools/catalog/project.mjs": ADAPTER,
        "catalog.config.json": JSON.stringify({
          version: 1,
          adapter: "./tools/catalog/project.mjs",
          options: { folder: "lore", manifest: "lore/index.json" },
          review: { resolver: "strictest", referenceRoles: ["evidence"] }
        })
      }
    })
    const summary = install(root)
    assert.deepEqual(readJson(root, "catalog.config.json"), {
      version: 2,
      plugins: ["./tools/catalog/project.mjs", "jam"],
      options: { "./tools/catalog/project.mjs": { folder: "lore", manifest: "lore/index.json" } },
      review: { resolver: "strictest", referenceRoles: ["evidence"] }
    })
    assert.equal(summary["catalogNotCarried"], undefined)
    const app = openCatalog(root)
    const context = await app.run("context", {})
    assert.deepEqual([context.plugins, context.resolver, context.problems], [["media-core", "project", "jam"], "strictest", 0])
    assert.equal((await app.run("unit.get", { id: "note/options" })).unit.name, JSON.stringify({ folder: "lore", manifest: "lore/index.json" }), "the adapter is given the options it had")
  })

  it("a version 1 file holding what version 2 cannot (preview modules, a resolver module, settings it does not know) is left as it is", async () => {
    const original = {
      version: 1,
      adapter: "./tools/catalog/project.mjs",
      options: { folder: "lore" },
      previewModules: { lineup: "./previews/lineup.mjs" },
      review: { resolver: "house-rules", resolverModule: "./tools/catalog/resolver.mjs" },
      display: { pixelArt: true }
    }
    const root = tempProject({ git: true, files: { "tools/catalog/project.mjs": ADAPTER, "catalog.config.json": JSON.stringify(original) } })
    const summary = install(root)
    assert.deepEqual(readJson(root, "catalog.config.json"), original, "a working configuration is never rewritten at a loss")
    assert.deepEqual(summary["catalogNotCarried"], ["previewModules", "review.resolver house-rules", "review.resolverModule", "display"])
    assert.match(String(summary["catalogConfig"]), /kept version 1/)
    assert.match(summary["next"].join("\n"), /left at version 1 because version 2 cannot hold previewModules/)
  })

  it("the version 1 default (jam's own adapter over a manifest) becomes manifest and jam with the same manifest and review settings", async () => {
    const root = tempProject({
      git: true,
      files: {
        "catalog.config.json": JSON.stringify({ version: 1, adapter: "./tools/jam/catalog-adapter.mjs", review: { resolver: "strictest", referenceRoles: ["evidence"] } }),
        "Art/catalog.json": JSON.stringify({ version: 1, assetRoots: ["Art"], types: { placeholder: { label: "Placeholder" } }, units: [{ id: "placeholder/chair", type: "placeholder", name: "Chair" }] })
      }
    })
    const summary = install(root)
    assert.deepEqual(readJson(root, "catalog.config.json"), { version: 2, plugins: ["manifest", "jam"], options: { manifest: { file: "Art/catalog.json" } }, review: { resolver: "strictest", referenceRoles: ["evidence"] } })
    assert.equal(summary["catalogNotCarried"], undefined)
    const app = openCatalog(root)
    const context = await app.run("context", {})
    assert.deepEqual([context.plugins, context.resolver, context.counts.units, context.problems], [["media-core", "manifest", "jam"], "strictest", 1, 0])
  })
})
