// The catalog's `engine` plugin: the engine's content, as the adapter's inventory lists it, becomes
// units with relations; files the adapter could not read are problems; the inventory runs again
// only when engine files change. The adapter here is a script that writes a fixed inventory.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { catalogProject, openCatalog } from "./catalog-support.ts"
import { glb, png, write } from "./fixtures.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const FILES = {
  "Content/Props/SM_Crate.uasset": {
    id: "/Game/Props/SM_Crate", size: 1, mtimeMs: 1, saved: "5.8.4", main: "/Game/Props/SM_Crate.SM_Crate",
    assets: [{ id: "/Game/Props/SM_Crate.SM_Crate", class: "/Script/Engine.StaticMesh", tags: { Triangles: "12", AssetImportData: JSON.stringify([{ RelativeFilename: "../../art/crate.glb", FileMD5: "abc" }]) } }],
    references: [{ to: "/Game/Props/MI_Crate", kind: "hard" }, { to: "/Engine/BasicShapes/Cube", kind: "hard" }, { to: "/Script/Engine", kind: "native" }]
  },
  "Content/Props/MI_Crate.uasset": {
    id: "/Game/Props/MI_Crate", size: 1, mtimeMs: 1, main: "/Game/Props/MI_Crate.MI_Crate",
    assets: [{ id: "/Game/Props/MI_Crate.MI_Crate", class: "/Script/Engine.MaterialInstanceConstant", tags: { Parent: "/Game/Props/M_Base.M_Base" } }],
    references: [{ to: "/Game/Props/T_Crate", kind: "hard" }]
  },
  "Content/Props/T_Crate.uasset": {
    id: "/Game/Props/T_Crate", size: 1, mtimeMs: 1, main: "/Game/Props/T_Crate.T_Crate",
    assets: [{ id: "/Game/Props/T_Crate.T_Crate", class: "/Script/Engine.Texture2D", tags: { Dimensions: "4x4", AssetImportData: JSON.stringify([{ RelativeFilename: "../../art/crate.png" }, { RelativeFilename: "C:/Users/someone/crate.psd" }, { RelativeFilename: "../../Intermediate/gone.png" }]) } }]
  },
  "Content/Items/DA_Sword.uasset": {
    id: "/Game/Items/DA_Sword", size: 1, mtimeMs: 1, main: "/Game/Items/DA_Sword.DA_Sword",
    assets: [{
      id: "/Game/Items/DA_Sword.DA_Sword", class: "/Script/MyGame.ItemDefinition", tags: { Rarity: "Rare" },
      fields: { Damage: 12, Mesh: { object: "/Game/Props/SM_Crate.SM_Crate", class: "/Script/Engine.StaticMesh" }, Extras: [{ soft: "/Game/Props/T_Crate.T_Crate" }, { soft: "/Game/Gone/T_X.T_X" }], Stats: { Speed: 2 } }
    }],
    references: [{ to: "/Game/Props/SM_Crate", kind: "soft", editorOnly: true }],
    names: [{ on: "/Script/GameplayTags", values: ["Item.Weapon.Sword"] }]
  },
  "Content/Dev/Scratch.uasset": { id: "/Game/Dev/Scratch", size: 1, mtimeMs: 1, main: "/Game/Dev/Scratch.Scratch", assets: [{ id: "/Game/Dev/Scratch.Scratch", class: "/Script/Engine.Texture2D" }] },
  "Content/Old/T_Legacy.uasset": { id: "/Game/Old/T_Legacy", size: 1, mtimeMs: 1, unread: "package version 1019 is not one this reader knows" }
}

// argv in, the inventory file out; every call is logged so the test can count them.
const ADAPTER = {
  "jam/engines/fake/adapter.json": JSON.stringify({
    id: "fake", label: "Fake engine",
    facts: { unitsPerMeter: 100, up: "+Z", forward: "+X", handedness: "left" },
    commands: { inventory: { run: ["node", "commands/inventory.mjs"] }, import: { run: ["node", "commands/import.mjs"], kinds: ["static", "textures"] } }
  }),
  // Importing adds the file to what the engine holds, as a real import would.
  "jam/engines/fake/commands/import.mjs": `
    import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
    const args = process.argv.slice(2)
    appendFileSync("import-calls.log", JSON.stringify(args) + "\\n")
    const files = JSON.parse(readFileSync("engine-files.json", "utf8"))
    const assets = args.filter((arg) => /\\.(glb|png)$/.test(arg)).map((file) => {
      const name = file.split("/").pop().replace(/\\.[^.]+$/, "")
      const id = "/Game/Imported/" + name
      files["Content/Imported/" + name + ".uasset"] = { id, size: 1, mtimeMs: 1, main: id + "." + name, assets: [{ id: id + "." + name, class: "/Script/Engine.StaticMesh" }] }
      return { id: id + "." + name, kind: "static-mesh", source: file }
    })
    writeFileSync("engine-files.json", JSON.stringify(files))
    console.log(JSON.stringify({ assets }))`,
  "jam/engines/fake/commands/inventory.mjs": `
    import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
    import { dirname } from "node:path"
    const args = process.argv.slice(2)
    const out = args[args.indexOf("--out") + 1]
    appendFileSync("inventory-calls.log", JSON.stringify(args) + "\\n")
    const files = JSON.parse(readFileSync("engine-files.json", "utf8"))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify({ format: 1, adapter: "fake", generatedAt: "2026-11-18T00:00:00Z", roots: [{ id: "/Game", path: "Content" }], files }))
    console.log(JSON.stringify({ inventory: out, files: Object.keys(files).length, assets: 0, read: 0, reused: 0, removed: 0, unread: 0 }))`
}

const project = (engine: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  catalogProject({
    config: { engine: { adapter: "fake", facts: {} } },
    plugins: ["manifest", { plugin: "engine", options: engine }] as Any,
    files: {
      ...ADAPTER,
      "engine-files.json": JSON.stringify(FILES),
      "catalog.manifest.json": JSON.stringify({ version: 2, assetRoots: ["art"], types: { prop: { label: "Prop", roles: [{ key: "model", label: "Model", mediaKinds: ["model"] }] } }, units: [{ id: "kit/barrel", type: "prop", name: "Barrel", links: [{ role: "model", asset: "art/barrel.glb" }] }] }),
      "art/barrel.glb": "glTF",
      "art/crate.glb": "glTF",
      "art/crate.png": png(4, 4),
      "Content/Props/SM_Crate.uasset": "x",
      ...extra
    }
  })

const calls = (root: string): ReadonlyArray<ReadonlyArray<string>> =>
  readFileSync(join(root, "inventory-calls.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line))

describe("engine content in the catalog", () => {
  it("each readable engine file is a unit typed by its class, among the project's source material, with its metadata and what it uses", async () => {
    const root = project({ types: { "/Script/MyGame.ItemDefinition": { type: "item", label: "Item" } }, exclude: ["Content/Dev/**"], filter: ["Rarity"] })
    const catalog = openCatalog(root)
    const found = await catalog.run("unit.search", { scope: "material" })
    assert.deepEqual(found.units.map((unit: Any) => [unit.id, unit.type]).sort(), [
      ["engine:/Game/Items/DA_Sword", "item"],
      ["engine:/Game/Props/MI_Crate", "engine-material-instance-constant"],
      ["engine:/Game/Props/SM_Crate", "engine-static-mesh"],
      ["engine:/Game/Props/T_Crate", "engine-texture2d"]
    ])
    const crate = await catalog.run("unit.get", { id: "engine:/Game/Props/SM_Crate" })
    assert.equal(crate.unit.scope, "material")
    assert.equal(crate.unit.name, "SM_Crate")
    assert.deepEqual([crate.unit.attrs.class, crate.unit.attrs.Triangles, crate.unit.attrs.file, crate.unit.attrs.saved], ["/Script/Engine.StaticMesh", "12", "Content/Props/SM_Crate.uasset", "5.8.4"])
    assert.deepEqual([crate.unit.attrs.uses, crate.unit.attrs.external, crate.unit.attrs.modules], [["engine:/Game/Props/MI_Crate"], ["/Engine/BasicShapes/Cube"], ["/Script/Engine"]])
    assert.ok(!("AssetImportData" in crate.unit.attrs))
    const relations = Object.fromEntries(crate.relations.map((relation: Any) => [relation.direction, relation.units.map((unit: Any) => unit.id)]))
    assert.deepEqual(relations, { out: ["engine:/Game/Props/MI_Crate"], in: ["engine:/Game/Items/DA_Sword"] })
    const sword = await catalog.run("unit.get", { id: "engine:/Game/Items/DA_Sword" })
    assert.deepEqual([sword.unit.attrs.names, sword.unit.scope], [["Item.Weapon.Sword"], "material"])
    // Property values: references become the units they name, other structure stays readable.
    assert.deepEqual([sword.unit.attrs.Damage, sword.unit.attrs.Mesh, sword.unit.attrs.Extras, sword.unit.attrs.Stats],
      [12, "engine:/Game/Props/SM_Crate", ["engine:/Game/Props/T_Crate", "/Game/Gone/T_X.T_X"], "{\"Speed\":2}"])
    const schema = await catalog.run("schema", {})
    assert.ok(schema.schema.types.item.fields.some((field: Any) => field.key === "Rarity" && field.filter === true))
    assert.deepEqual(schema.schema.types.item.fields.filter((field: Any) => field.group === "Properties").map((field: Any) => [field.key, field.kind ?? null]),
      [["Damage", "text"], ["Extras", "refs"], ["Mesh", "refs"], ["Stats", "text"]])
    // Content defined elsewhere stays the project's main content; engine assets are its material.
    assert.deepEqual((await catalog.run("unit.search", { scope: "main" })).units.map((unit: Any) => unit.id), ["kit/barrel"])
    // No section of its own: the project's sections stay what they were.
    assert.deepEqual(schema.scopes.map((scope: Any) => scope.id), ["main", "material"])
  })

  it("an actor's components show as their classes, for filters and archetypes, with each component's values", async () => {
    const pickup = {
      id: "/Game/Items/BP_Pickup", size: 1, mtimeMs: 1, main: "/Game/Items/BP_Pickup.BP_Pickup",
      assets: [{
        id: "/Game/Items/BP_Pickup.BP_Pickup", class: "/Script/Engine.Blueprint", fields: { InitialLifeSpan: 0 }, fieldsSource: "engine",
        components: [
          { name: "Body", class: "/Script/Engine.StaticMeshComponent", path: "/Game/Items/BP_Pickup.BP_Pickup_C:Body_GEN_VARIABLE", fields: { StaticMesh: { object: "/Game/Props/SM_Crate.SM_Crate", class: "/Script/Engine.StaticMesh" } } },
          { name: "Glow", class: "/Script/Engine.PointLightComponent", inherited: true, from: "/Game/Items/BP_Base.BP_Base_C", fields: { Intensity: 1234 } },
          { name: "Spare", class: "/Script/Engine.PointLightComponent" }
        ]
      }]
    }
    const root = project({}, { "engine-files.json": JSON.stringify({ ...FILES, "Content/Items/BP_Pickup.uasset": pickup }) })
    const catalog = openCatalog(root)
    const unit = (await catalog.run("unit.get", { id: "engine:/Game/Items/BP_Pickup" })).unit
    assert.deepEqual(unit.attrs.components, ["PointLightComponent", "StaticMeshComponent"])
    assert.equal(unit.attrs.fieldsSource, "engine")
    assert.deepEqual(JSON.parse(unit.attrs.componentValues).map((component: Any) => [component.name, component.inherited ?? false]), [["Body", false], ["Glow", true], ["Spare", false]])
    const fields = (await catalog.run("schema", {})).schema.types["engine-blueprint"].fields
    assert.ok(fields.some((field: Any) => field.key === "components" && field.filter === true))
    assert.ok(!(await catalog.run("schema", {})).schema.types["engine-static-mesh"].fields.some((field: Any) => field.key === "components"))
  })

  it("an engine asset shows the file it was imported from when the catalog can show that file", async () => {
    const catalog = openCatalog(project())
    const texture = await catalog.run("unit.get", { id: "engine:/Game/Props/T_Crate" })
    assert.deepEqual(texture.links.map((link: Any) => [link.role, link.asset.path]), [["source", "art/crate.png"]])
    // A source the engine recorded but that is not in the checkout keeps only what was stored.
    assert.deepEqual(texture.unit.attrs.sourceFiles, [{ stored: "../../art/crate.png", path: "art/crate.png" }, { stored: "C:/Users/someone/crate.psd" }, { stored: "../../Intermediate/gone.png" }])
    const mesh = await catalog.run("unit.get", { id: "engine:/Game/Props/SM_Crate" })
    assert.deepEqual(mesh.unit.attrs.sourceFiles, [{ stored: "../../art/crate.glb", path: "art/crate.glb", md5: "abc" }])
  })

  it("with matchSourcesByMd5, a source the engine recorded elsewhere is found among the catalog's media by its MD5", async () => {
    const bytes = png(6, 3)
    const md5 = createHash("md5").update(bytes).digest("hex")
    const files = { ...FILES, "Content/Props/T_Moved.uasset": { id: "/Game/Props/T_Moved", size: 1, mtimeMs: 1, main: "/Game/Props/T_Moved.T_Moved", assets: [{ id: "/Game/Props/T_Moved.T_Moved", class: "/Script/Engine.Texture2D", tags: { AssetImportData: JSON.stringify([{ RelativeFilename: "../../../elsewhere/moved.png", FileMD5: md5 }]) } }] } }
    const off = project({}, { "engine-files.json": JSON.stringify(files), "art/moved.png": bytes })
    assert.deepEqual((await openCatalog(off).run("unit.get", { id: "engine:/Game/Props/T_Moved" })).links, [])
    const on = project({ matchSourcesByMd5: true }, { "engine-files.json": JSON.stringify(files), "art/moved.png": bytes })
    const moved = await openCatalog(on).run("unit.get", { id: "engine:/Game/Props/T_Moved" })
    assert.deepEqual(moved.links.map((link: Any) => link.asset.path), ["art/moved.png"])
  })

  it("a file the adapter could not read is a problem naming it, not an empty unit", async () => {
    const catalog = openCatalog(project())
    const { problems } = await catalog.run("problems", {})
    const legacy = problems.find((problem: Any) => problem.subject === "Content/Old/T_Legacy.uasset")
    assert.match(legacy.error, /could not read \/Game\/Old\/T_Legacy: package version 1019/)
    assert.match(legacy.recovery, /jam engine inventory --engine/)
    assert.equal((await catalog.run("unit.search", {})).units.some((unit: Any) => unit.id === "engine:/Game/Old/T_Legacy"), false)
  })

  it("the inventory runs again only when an engine file changes, and hands the adapter the previous inventory", async () => {
    const root = project()
    const catalog = openCatalog(root)
    await catalog.run("unit.search", {})
    await catalog.run("unit.search", {})
    assert.equal(calls(root).length, 1)
    write(root, "Content/Props/SM_Crate.uasset", "changed")
    utimesSync(join(root, "Content/Props/SM_Crate.uasset"), new Date(), new Date(Date.now() + 5000))
    await catalog.run("unit.search", {})
    assert.equal(calls(root).length, 2)
    assert.ok(calls(root)[1]!.includes("--previous"))
    const refreshed = await catalog.run("engine.refresh", { full: true, engine: true })
    assert.deepEqual([refreshed.files, refreshed.unread], [6, 1])
    assert.deepEqual(calls(root)[2]!.filter((arg) => arg.startsWith("--")), ["--out", "--engine"])
  })

  it("a unit's files go into the engine through the adapter and come back as engine units", async () => {
    const root = project()
    const catalog = openCatalog(root)
    const imported = await catalog.run("engine.import", { unit: "kit/barrel", kind: "static" }, { actor: { kind: "agent", name: "test" } })
    assert.deepEqual([imported.status, imported.units], ["ran", ["engine:/Game/Imported/barrel"]])
    assert.deepEqual(JSON.parse(readFileSync(join(root, "import-calls.log"), "utf8").trim()), ["--kind", "static", "art/barrel.glb"])
    assert.equal((await catalog.run("unit.get", { id: "engine:/Game/Imported/barrel" })).unit.attrs.class, "/Script/Engine.StaticMesh")
    const nothing = await catalog.run("engine.import", { files: ["notes.txt"], kind: "static" }, { actor: { kind: "agent", name: "test" } }).catch((error: Any) => error)
    assert.match(String(nothing.message ?? nothing), /nothing to import/)
    // A project that builds its engine content itself names its own action instead.
    const own = openCatalog(project({ importWith: "game.content.build" }))
    const refused = await own.run("engine.import", { unit: "kit/barrel", kind: "static" }, { actor: { kind: "agent", name: "test" } }).catch((error: Any) => error)
    assert.equal(refused.code, "conflict")
    assert.match(refused.fix, /game\.content\.build/)
  })

  it("an adapter that cannot list the engine's content is one problem; the rest of the catalog works", async () => {
    const root = catalogProject({
      config: { engine: { adapter: "web", facts: {} } },
      plugins: ["manifest", "engine"],
      files: { "catalog.manifest.json": JSON.stringify({ version: 2, types: { note: { label: "Note" } }, units: [{ id: "n1", type: "note", name: "N" }] }) }
    })
    const catalog = openCatalog(root)
    const { problems } = await catalog.run("problems", {})
    assert.deepEqual(problems.map((problem: Any) => problem.subject), ["engine"])
    assert.match(problems[0].error, /adapter web cannot list the engine's content/)
    assert.equal((await catalog.run("unit.get", { id: "n1" })).unit.name, "N")
  })
})

// argv in, previews and their index out: the texture gets an image, the mesh a model, the material
// none. A version is the inventory's hash, else size:mtime, as the toolkit computes it.
const PREVIEWS = `
  import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
  const args = process.argv.slice(2)
  const value = (flag) => args[args.indexOf(flag) + 1]
  appendFileSync("previews-calls.log", JSON.stringify(args) + "\\n")
  const out = value("--out")
  const inventory = JSON.parse(readFileSync(value("--inventory"), "utf8"))
  const version = (path) => { const file = inventory.files[path]; return file.hash ?? file.size + ":" + file.mtimeMs }
  mkdirSync(out, { recursive: true })
  copyFileSync("preview.png", out + "/t-crate.png")
  copyFileSync("preview.glb", out + "/sm-crate.glb")
  const files = {
    "Content/Props/T_Crate.uasset": { version: version("Content/Props/T_Crate.uasset"), file: "t-crate.png", kind: "image", how: "the texture's source image" },
    "Content/Props/SM_Crate.uasset": { version: version("Content/Props/SM_Crate.uasset"), file: "sm-crate.glb", kind: "model", how: "a glTF export" },
    "Content/Props/MI_Crate.uasset": { version: version("Content/Props/MI_Crate.uasset"), failed: "the material did not compile" }
  }
  writeFileSync(out + "/index.json", JSON.stringify({ format: 1, adapter: "fake", generatedAt: "2026-11-18T00:00:00Z", files }))
  console.log(JSON.stringify({ index: out + "/index.json", previews: 2, made: 2, reused: 0, failed: 1, waiting: 0, none: 2 }))`

describe("engine previews in the catalog", () => {
  const withPreviews = async () => {
    const adapter = JSON.parse(ADAPTER["jam/engines/fake/adapter.json"])
    adapter.commands.previews = { run: ["node", "commands/previews.mjs"] }
    return project({}, {
      "jam/engines/fake/adapter.json": JSON.stringify(adapter),
      "jam/engines/fake/commands/previews.mjs": PREVIEWS,
      "preview.png": png(8, 8),
      "preview.glb": Buffer.from(await glb())
    })
  }

  it("a unit shows the preview the adapter made in its preview role, which is its thumbnail; loading never makes previews", async () => {
    const root = await withPreviews()
    const catalog = openCatalog(root)
    const before = await catalog.run("unit.get", { id: "engine:/Game/Props/T_Crate" })
    assert.deepEqual(before.links.map((link: Any) => link.role), ["source"])
    assert.equal(existsSync(join(root, "previews-calls.log")), false)

    const made = await catalog.run("engine.previews", {})
    assert.deepEqual([made.index, made.previews, made.made, made.failed], ["work/.scratch/.engine/previews/index.json", 2, 2, 1])
    const [args] = readFileSync(join(root, "previews-calls.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Array<string>)
    assert.deepEqual(args, ["--inventory", "work/.scratch/.engine/inventory.json", "--out", "work/.scratch/.engine/previews"])

    const texture = await catalog.run("unit.get", { id: "engine:/Game/Props/T_Crate" })
    assert.deepEqual(texture.links.map((link: Any) => [link.role, link.asset.path, link.asset.state]), [
      ["preview", "work/.scratch/.engine/previews/t-crate.png", "ok"],
      ["source", "art/crate.png", "ok"]
    ])
    assert.equal(texture.unit.attrs.preview, "the texture's source image")
    const mesh = await catalog.run("unit.get", { id: "engine:/Game/Props/SM_Crate" })
    assert.deepEqual(mesh.links.map((link: Any) => [link.role, link.asset.kind, link.asset.state]), [["preview", "model", "ok"], ["source", "model", "invalid"]])
    const material = await catalog.run("unit.get", { id: "engine:/Game/Props/MI_Crate" })
    assert.deepEqual([material.links, material.unit.attrs.preview], [[], "none: the material did not compile"])
    const found = await catalog.run("unit.search", { q: "SM_Crate" })
    assert.equal(found.units[0].thumb.path, "work/.scratch/.engine/previews/sm-crate.glb")
  })

  it("a preview made for an earlier version of its file stays shown and says so", async () => {
    const root = await withPreviews()
    const catalog = openCatalog(root)
    await catalog.run("engine.previews", { only: ["Content/Props/**"], limit: 5, engine: false, full: true })
    const [args] = readFileSync(join(root, "previews-calls.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Array<string>)
    assert.deepEqual(args!.slice(4), ["--full", "--no-engine", "--only", "Content/Props/**", "--limit", "5"])
    const files = JSON.parse(readFileSync(join(root, "engine-files.json"), "utf8"))
    files["Content/Props/T_Crate.uasset"].mtimeMs = 2
    files["Content/Props/MI_Crate.uasset"].mtimeMs = 2
    write(root, "engine-files.json", JSON.stringify(files))
    await catalog.run("engine.refresh", {})
    const texture = await catalog.run("unit.get", { id: "engine:/Game/Props/T_Crate" })
    assert.equal(texture.links[0].role, "preview")
    assert.match(texture.unit.attrs.preview, /for an earlier version of the file \(run jam engine previews\)/)
    const material = await catalog.run("unit.get", { id: "engine:/Game/Props/MI_Crate" })
    assert.equal(material.unit.attrs.preview, undefined, "a failure is about the version it was made for")
  })
})
