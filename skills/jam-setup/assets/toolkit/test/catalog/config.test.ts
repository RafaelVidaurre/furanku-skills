// catalog.config.json in both versions: version 2 names plugins; version 1 files and version 1
// adapter modules keep working unchanged.
import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { resolveConfig } from "../../src/catalog/CatalogConfig.ts"
import { cleanup, git, human, human2, makeProject, open, png, read, rejects, standardProject, tmp, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const resolve = (value: unknown) => Effect.runPromise(resolveConfig(value))
const refused = async (value: unknown): Promise<Any> => rejects(resolve(value), "invalid")

test("version 2 names plugins and their options; version 1 is read as one plugin with one source", async () => {
  const v2 = await resolve({ version: 2, plugins: ["manifest", "./catalog/game.ts"], options: { manifest: { file: "m.json" } }, review: { resolver: "strictest", referenceRoles: ["concept"] } })
  assert.deepEqual(v2.plugins, [{ ref: "manifest" }, { ref: "./catalog/game.ts" }])
  assert.deepEqual(v2.options, { manifest: { file: "m.json" } })
  assert.deepEqual(v2.review, { resolver: "strictest", resolverModule: null, referenceRoles: ["concept"], verdicts: ["approved", "changes", "rejected"] })
  assert.deepEqual((await resolve({ version: 2 })).plugins, [{ ref: "manifest" }], "the manifest plugin is the default")
  // Version 1: the adapter becomes the plugin list; the manifest path option gets its new name.
  const v1 = await resolve({ version: 1, adapter: "manifest", options: { manifest: "alt.json" }, previewModules: { lineup: "./previews/lineup.mjs" }, review: { resolverModule: "./tools/resolver.mjs", resolver: "mine" } })
  assert.deepEqual(v1.plugins, [{ ref: "manifest" }])
  assert.deepEqual(v1.options, { manifest: { file: "alt.json" } })
  assert.deepEqual(v1.previewModules, { lineup: "previews/lineup.mjs" })
  assert.deepEqual([v1.review.resolver, v1.review.resolverModule], ["mine", "tools/resolver.mjs"])
  const custom = await resolve({ version: 1, adapter: "./tools/adapter.mjs", options: { depth: 2 }, somethingOld: true })
  assert.deepEqual(custom.plugins, [{ ref: "./tools/adapter.mjs", adapterOptions: { depth: 2 } }], "a version 1 adapter receives the whole options object")
  // A typo in a version 2 file is named, with its field path.
  assert.match((await refused({ version: 2, plugin: ["manifest"] })).message, /catalog\.config\.json: plugin: /)
  assert.match((await refused({ version: 2, review: { verdicts: ["maybe"] } })).message, /review\.verdicts/)
  assert.match((await refused({ version: 3 })).message, /unsupported version/)
  assert.match((await refused([])).message, /unsupported version/)
})

test("a project without catalog.config.json uses the manifest plugin; a broken file keeps the last good settings and says so", async () => {
  const dir = await standardProject()
  rmSync(join(dir, "catalog.config.json"))
  const app = await open(dir)
  assert.equal((await app.run("context", {})).counts.units, 4)
  write(dir, "catalog.config.json", "{ not json")
  assert.equal((await app.run("context", {})).counts.units, 4)
  const problems = (await app.run("problems", {})).problems
  assert.deepEqual(problems.map((p: Any) => [p.scope, p.source]), [["project", "catalog.config.json"]])
  assert.match(problems[0].recovery, /previous project settings stay in use/)
  // With nothing good to fall back on, the configuration error is the answer.
  await rejects(open(dir).then((fresh) => fresh.run("context", {})), "malformed")
  write(dir, "catalog.config.json", { version: 2, plugins: ["manifest", "manifest"] })
  await rejects(open(dir).then((fresh) => fresh.run("context", {})), "invalid")
  write(dir, "catalog.config.json", { version: 2, plugins: ["no-such-plugin"] })
  assert.match((await rejects(open(dir).then((fresh) => fresh.run("context", {})), "invalid")).message, /unknown plugin no-such-plugin/)
  // Fixed: the running catalog picks it up without a restart.
  write(dir, "catalog.config.json", { version: 2, plugins: ["manifest"] })
  assert.equal((await app.run("context", {})).problems, 0)
  cleanup(dir)
})

test("version 1 projects run unchanged: adapter module with state, resolver module, preview modules, options", async () => {
  const dir = tmp("cc-v1-")
  git(dir, "init", "-q")
  write(dir, "art/a.png", png(3, 3, [5, 5, 5, 255]))
  write(dir, "data/things.json", [{ id: "thing/a", name: "A" }, { id: "thing/b", name: "B" }])
  // A version 1 adapter as projects wrote them: a factory keeping state between load() and sources().
  write(dir, "tools/adapter.mjs", `
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    export default function adapter({ root, options }) {
      let loads = 0;
      return {
        name: 'things',
        sources: () => [options.file],
        async load() {
          loads++;
          const things = JSON.parse(readFileSync(join(root, options.file), 'utf8'));
          return {
            project: options.title,
            schema: { types: { thing: { label: 'Thing', fields: [{ key: 'loads', label: 'Loads' }], roles: [{ key: 'icon', label: 'Icon', kinds: ['image'] }] } },
              collectionKinds: { row: { label: 'Row', preview: { module: 'lineup', label: 'Lineup', roles: ['icon'] } } } },
            assetRoots: ['art'],
            units: things.map((t) => ({ id: t.id, type: 'thing', name: t.name, attrs: { loads }, links: [{ role: 'icon', asset: 'art/a.png' }] })),
            collections: [{ id: 'row/all', name: 'All', kind: 'row', members: things.map((t) => ({ unit: t.id })) }],
          };
        },
      };
    }`)
  write(dir, "tools/resolver.mjs", "export default (events) => events.find((e) => e.by.name === 'Sam Second') ?? events.at(-1);\n")
  write(dir, "previews/lineup.mjs", "export default (ctx) => ctx.html`<div></div>`;\n")
  write(dir, "catalog.config.json", { version: 1, adapter: "./tools/adapter.mjs", options: { file: "data/things.json", title: "Version One" }, previewModules: { lineup: "./previews/lineup.mjs" }, review: { resolver: "sam-decides", resolverModule: "./tools/resolver.mjs", referenceRoles: [] } })
  const app = await open(dir)
  const context = await app.run("context", {})
  assert.deepEqual([context.project, context.counts.units, context.resolver, context.problems], ["Version One", 2, "sam-decides", 0])
  assert.deepEqual(context.plugins, ["media-core", "things"], "the adapter is a plugin under its own name")
  assert.equal((await app.stats()).sourceLoads["things/things"], 1)
  // Reads do not reload it; a change to what sources() names does.
  assert.equal((await app.run("unit.get", { id: "thing/a" })).unit.attrs.loads, 1)
  write(dir, "data/things.json", [...read(dir, "data/things.json"), { id: "thing/c", name: "C" }])
  assert.equal((await app.run("unit.get", { id: "thing/c" })).unit.attrs.loads, 2, "the same adapter instance loaded again")
  // previewModules and resolverModule behave as before.
  const row = await app.run("collection.get", { id: "row/all" })
  assert.equal(row.collection.owner, "adapter")
  assert.match(row.preview.moduleUrl, /^\/project\/preview\/lineup\?v=[0-9a-f]{16}$/)
  assert.match(Buffer.from((await app.previewModule("lineup")).bytes).toString(), /ctx\.html/)
  const target = { kind: "unit", id: "thing/a" }
  await W(app, human2)("review.decideCurrent", { target, whole: "rejected" })
  await new Promise((done) => setTimeout(done, 15))
  await W(app, human)("review.decide", await app.run("reviews.list", {}).then((list: Any) => ({ submission: list.items[0].id, item: list.items[0].items[0].id, whole: "approved" })))
  assert.equal((await app.run("unit.get", { id: "thing/a" })).review.summary.state, "rejected", "the project's resolver module decides")
  // An edit to the adapter module itself is picked up: the module is imported again.
  write(dir, "tools/adapter.mjs", "export default () => ({ sources: () => [], load: () => ({ project: 'Rewritten', schema: { types: {} }, units: [] }) });\n")
  assert.deepEqual([(await app.run("context", {})).project, (await app.run("context", {})).counts.units], ["Rewritten", 0])
  cleanup(dir)
})

test("version 1 manifest option and built-in adapter names map onto plugins", async () => {
  const dir = await makeProject({ units: [{ id: "lore/a", type: "lore", name: "A", attrs: { text: "x" } }] })
  write(dir, "other.manifest.json", { ...read(dir, "catalog.manifest.json"), project: "Other", unitFiles: [] })
  write(dir, "catalog.config.json", { version: 1, adapter: "manifest", options: { manifest: "other.manifest.json" } })
  const app = await open(dir)
  assert.deepEqual([(await app.run("context", {})).project, (await app.run("context", {})).counts.units], ["Other", 0])
  // The same in version 2 form.
  write(dir, "catalog.config.json", { version: 2, plugins: ["manifest"], options: { manifest: { file: "catalog.manifest.json" } } })
  assert.deepEqual([(await app.run("context", {})).project, (await app.run("context", {})).counts.units], ["Testgame", 1])
  // A version 1 adapter name the composition root does not provide is refused by name.
  write(dir, "catalog.config.json", { version: 1, adapter: "jam" })
  assert.match((await rejects(open(dir).then((fresh) => fresh.run("context", {})), "invalid")).message, /unknown plugin jam/)
  cleanup(dir)
})

// Catalogs before version 2 read `display.pixelArt` from a version 1 file; both versions accept it.
test("display: the project's pixel-art policy in both versions, and a type's own display wins", async () => {
  assert.deepEqual((await resolve({ version: 2 })).display, { pixelArt: false })
  assert.deepEqual((await resolve({ version: 2, display: { pixelArt: true } })).display, { pixelArt: true })
  assert.deepEqual((await resolve({ version: 1, adapter: "manifest", display: { pixelArt: true } })).display, { pixelArt: true })
  assert.match((await refused({ version: 2, display: { pixelArt: "yes" } })).message, /display\.pixelArt/)
  assert.match((await refused({ version: 2, display: { pixelart: true } })).message, /display/)

  const dir = await standardProject({ extra: { types: { icon: { label: "Icon", roles: [{ key: "image", label: "Image", kinds: ["image"] }], display: { pixelArt: false } }, armor: { label: "Armor", roles: [] } } } })
  write(dir, "catalog.config.json", { ...read(dir, "catalog.config.json"), display: { pixelArt: true } })
  write(dir, "content/icon_sword.json", { id: "icon/sword", type: "icon", links: [{ role: "image", asset: "art/helm.png" }] })
  const app = await open(dir)
  const schema = await app.run("schema", {})
  assert.deepEqual([schema.display, schema.schema.types.icon.display, schema.schema.types.armor.display], [{ pixelArt: true }, { pixelArt: false }, null])
  assert.deepEqual((await app.run("unit.get", { id: "icon/sword" })).display, { pixelArt: false }, "the type's own display wins")
  assert.deepEqual((await app.run("unit.get", { id: "armor/helm" })).display, { pixelArt: true }, "a type without one follows the project")
  const before = schema.version
  write(dir, "catalog.config.json", { ...read(dir, "catalog.config.json"), display: { pixelArt: false } })
  assert.notEqual((await app.run("context", {})).version, before, "the page fetches the schema again when the policy changes")
  cleanup(dir)
})
