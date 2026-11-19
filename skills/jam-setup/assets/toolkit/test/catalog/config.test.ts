// catalog.config.json version 3: plugins, each with its own options, and the review and display
// policy. Files of an older toolkit (configuration version 1 or 2, manifest version 1) are named and
// sent to `jam catalog migrate`.
import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { resolveConfig } from "../../src/catalog/CatalogConfig.ts"
import { cleanup, makeProject, open, read, rejects, standardProject, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const resolve = (value: unknown) => Effect.runPromise(resolveConfig(value))
const refused = async (value: unknown): Promise<Any> => rejects(resolve(value), "invalid")
const published = (file: string): Any => JSON.parse(readFileSync(new URL(`../../schemas/${file}`, import.meta.url), "utf8"))
/** Follow a local `$ref` (`#/$defs/<name>`) inside a published schema. */
const deref = (document: Any, node: Any): Any => (typeof node?.$ref === "string" ? deref(document, document.$defs[node.$ref.replace("#/$defs/", "")]) : node)

test("version 3 lists plugins as names or entries with their own options; older versions are sent to the migration", async () => {
  const config = await resolve({ version: 3, plugins: ["manifest", { plugin: "./catalog/game.ts", options: { depth: 2 } }, { plugin: "jam" }], review: { resolver: "strictest", referenceRoles: ["concept"] } })
  assert.deepEqual(config.plugins, [{ ref: "manifest", options: {} }, { ref: "./catalog/game.ts", options: { depth: 2 } }, { ref: "jam", options: {} }])
  assert.deepEqual(config.review, { resolver: "strictest", referenceRoles: ["concept"], verdicts: ["approved", "changes", "rejected"] })
  assert.deepEqual((await resolve({ version: 3 })).plugins, [{ ref: "manifest", options: {} }], "the manifest plugin is the default")
  // A typo is named, with its field path; nothing of an older version is accepted.
  assert.match((await refused({ version: 3, plugin: ["manifest"] })).message, /catalog\.config\.json: plugin: /)
  assert.match((await refused({ version: 3, plugins: [{ plugin: "manifest", option: {} }] })).message, /plugins\[0\]/)
  assert.match((await refused({ version: 3, plugins: [{ options: {} }] })).message, /plugins\[0\]/)
  assert.match((await refused({ version: 3, review: { verdicts: ["maybe"] } })).message, /review\.verdicts/)
  for (const old of [{ options: { manifest: { file: "m.json" } } }, { adapter: "manifest" }, { previewModules: {} }, { review: { resolverModule: "./r.mjs" } }]) {
    assert.ok((await refused({ version: 3, ...old })).message.includes(Object.keys(old)[0] === "review" ? "resolverModule" : Object.keys(old)[0]!), JSON.stringify(old))
  }
  assert.match((await refused({ version: 4 })).message, /unsupported version/)
  assert.match((await refused([])).message, /unsupported version/)
  for (const version of [1, 2]) {
    const error = await rejects(resolve({ version, plugins: ["manifest"] }), "unsupported")
    assert.deepEqual([error.message, error.fix], [`catalog.config.json was written by an older toolkit (version ${version})`, "run: jam catalog migrate"])
  }
})

test("a project whose catalog.config.json is version 2 fails every action as unsupported, with the migration as the fix", async () => {
  const dir = await standardProject()
  write(dir, "catalog.config.json", { version: 2, plugins: ["manifest"], options: { manifest: { file: "catalog.manifest.json" } } })
  const app = await open(dir)
  for (const [action, input] of [["summary", {}], ["unit.get", { id: "armor/helm" }], ["note.list", {}]] as const) {
    const error = await rejects(app.run(action, input), "unsupported")
    assert.deepEqual([error.message, error.fix], ["catalog.config.json was written by an older toolkit (version 2)", "run: jam catalog migrate"], action)
  }
  const write_ = await rejects(W(app)("note.create", { target: { kind: "unit", id: "armor/helm" }, body: "x" }), "unsupported")
  assert.equal(write_.fix, "run: jam catalog migrate")
  assert.ok(!existsSync(join(dir, ".catalog")), "nothing is written")
  cleanup(dir)
})

test("a manifest of an older toolkit is one problem naming the migration, not a list of malformed units", async () => {
  const dir = await standardProject()
  write(dir, "catalog.manifest.json", { ...read(dir, "catalog.manifest.json"), version: 1 })
  const app = await open(dir)
  const summary = await app.run("summary", {})
  assert.deepEqual([summary.counts.units, summary.problems], [0, 1])
  assert.deepEqual((await app.run("problems", {})).problems, [{
    origin: "sources",
    subject: "catalog.manifest.json",
    error: "catalog.manifest.json was written by an older toolkit (manifest version 1)",
    recovery: "run: jam catalog migrate"
  }])
  // Moved to version 2 (as the migration does: type views become inspectors, role kinds mediaKinds), it loads.
  write(dir, "catalog.manifest.json", { ...read(dir, "catalog.manifest.json"), version: 2 })
  assert.deepEqual([(await app.run("summary", {})).counts.units, (await app.run("problems", {})).problems], [4, []])
  cleanup(dir)
})

test("a project without catalog.config.json uses the manifest plugin; a broken file keeps the last good settings and says so", async () => {
  const dir = await standardProject()
  rmSync(join(dir, "catalog.config.json"))
  const app = await open(dir)
  assert.equal((await app.run("summary", {})).counts.units, 4)
  write(dir, "catalog.config.json", "{ not json")
  assert.equal((await app.run("summary", {})).counts.units, 4)
  const problems = (await app.run("problems", {})).problems
  assert.deepEqual(problems.map((p: Any) => [p.origin, p.subject]), [["project", "catalog.config.json"]])
  assert.match(problems[0].recovery, /previous project settings stay in use/)
  // With nothing good to fall back on, the configuration error is the answer.
  await rejects(open(dir).then((fresh) => fresh.run("summary", {})), "malformed")
  write(dir, "catalog.config.json", { version: 3, plugins: ["manifest", { plugin: "manifest", options: { file: "catalog.manifest.json" } }] })
  await rejects(open(dir).then((fresh) => fresh.run("summary", {})), "invalid")
  write(dir, "catalog.config.json", { version: 3, plugins: [{ plugin: "no-such-plugin" }] })
  assert.match((await rejects(open(dir).then((fresh) => fresh.run("summary", {})), "invalid")).message, /unknown plugin no-such-plugin/)
  // Fixed: the running catalog picks it up without a restart.
  write(dir, "catalog.config.json", { version: 3, plugins: ["manifest"] })
  assert.equal((await app.run("summary", {})).problems, 0)
  cleanup(dir)
})

test("each plugin entry's options reach that plugin: the manifest plugin reads the file its entry names", async () => {
  const dir = await makeProject({ units: [{ id: "lore/a", type: "lore", name: "A", attrs: { text: "x" } }] })
  write(dir, "other.manifest.json", { ...read(dir, "catalog.manifest.json"), project: "Other", unitFiles: [] })
  write(dir, "catalog.config.json", { version: 3, plugins: [{ plugin: "manifest", options: { file: "other.manifest.json" } }] })
  const app = await open(dir)
  assert.deepEqual([(await app.run("summary", {})).project, (await app.run("summary", {})).counts.units], ["Other", 0])
  // A string entry has no options: the manifest plugin reads its default file.
  write(dir, "catalog.config.json", { version: 3, plugins: ["manifest"] })
  assert.deepEqual([(await app.run("summary", {})).project, (await app.run("summary", {})).counts.units], ["Testgame", 1])
  // A plugin name the composition root does not provide is refused by name.
  write(dir, "catalog.config.json", { version: 3, plugins: [{ plugin: "jam", options: {} }] })
  assert.match((await rejects(open(dir).then((fresh) => fresh.run("summary", {})), "invalid")).message, /unknown plugin jam/)
  cleanup(dir)
})

test("display: the project's pixel-art policy, and a type's own display wins", async () => {
  assert.deepEqual((await resolve({ version: 3 })).display, { pixelArt: false })
  assert.deepEqual((await resolve({ version: 3, display: { pixelArt: true } })).display, { pixelArt: true })
  assert.match((await refused({ version: 3, display: { pixelArt: "yes" } })).message, /display\.pixelArt/)
  assert.match((await refused({ version: 3, display: { pixelart: true } })).message, /display/)

  const dir = await standardProject({ extra: { types: { icon: { label: "Icon", roles: [{ key: "image", label: "Image", mediaKinds: ["image"] }], display: { pixelArt: false } }, armor: { label: "Armor", roles: [] } } } })
  write(dir, "catalog.config.json", { ...read(dir, "catalog.config.json"), display: { pixelArt: true } })
  write(dir, "content/icon_sword.json", { id: "icon/sword", type: "icon", links: [{ role: "image", asset: "art/helm.png" }] })
  const app = await open(dir)
  const schema = await app.run("schema", {})
  assert.deepEqual([schema.display, schema.schema.types.icon.display, schema.schema.types.armor.display], [{ pixelArt: true }, { pixelArt: false }, null])
  assert.deepEqual((await app.run("unit.get", { id: "icon/sword" })).display, { pixelArt: false }, "the type's own display wins")
  assert.deepEqual((await app.run("unit.get", { id: "armor/helm" })).display, { pixelArt: true }, "a type without one follows the project")
  const before = schema.version
  write(dir, "catalog.config.json", { ...read(dir, "catalog.config.json"), display: { pixelArt: false } })
  assert.notEqual((await app.run("summary", {})).version, before, "the page fetches the schema again when the policy changes")
  cleanup(dir)
})

test("the published config schema is closed like the decoder; published record schemas stay open like the record reader", async () => {
  const config = published("catalog.config.schema.json")
  const top = deref(config, config)
  assert.equal(top.additionalProperties, false)
  assert.equal(deref(config, top.properties.review).additionalProperties, false)
  assert.equal(deref(config, top.properties.display).additionalProperties, false)
  assert.match((await refused({ version: 3, bogus: 1 })).message, /bogus/)

  // Records are read with unknown fields ignored, so a newer toolkit's additions never break an older one.
  const note = published("catalog-note.schema.json")
  assert.notEqual(deref(note, note).additionalProperties, false)
  const dir = await standardProject()
  const app = await open(dir)
  const made = (await W(app)("note.create", { target: { kind: "unit", id: "armor/helm" }, body: "From a newer toolkit" })).note
  const file = `.catalog/notes/${made.id}.json`
  write(dir, file, { ...read(dir, file), addedLater: { by: "a newer toolkit" } })
  assert.deepEqual((await app.run("note.list", {})).notes.map((entry: Any) => entry.body), ["From a newer toolkit"])
  assert.deepEqual((await app.run("problems", {})).problems, [])
  cleanup(dir)
})
