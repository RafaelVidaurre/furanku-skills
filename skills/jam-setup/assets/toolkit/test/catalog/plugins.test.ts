// The plugin contract, exercised through the example plugin in examples/plugins and a few
// purpose-built ones. Every extension point is reached the way a project reaches it: named in
// catalog.config.json and observed through actions.
import assert from "node:assert/strict"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { defineAction, definePlugin, Effect, optional, type Plugin, Schema, type SourceOutput, Text } from "../../src/catalog/plugin.ts"
import { publishedSchemas } from "../../src/catalog/published.ts"
import { jsonSchemaOf } from "../../src/kernel/decode.ts"
import storybook from "../../examples/plugins/storybook.ts"
import { agent, cleanup, git, human, makeProject, open, png, read, rejects, tmp, TYPES, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const EXAMPLES = fileURLToPath(new URL("../../examples/plugins/", import.meta.url))
const CAPTIONS = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n\n00:00:03.500 --> 00:00:04.000\nBye\n"

/** A project that loads the example plugin as a project module, as its header describes. */
const storyProject = (review: Record<string, unknown> = { resolver: "human-first" }): string => {
  const dir = tmp("cc-story-")
  git(dir, "init", "-q")
  write(dir, "catalog.config.json", { version: 3, plugins: [{ plugin: "./catalog/storybook.ts", options: { folder: "story" } }], review })
  write(dir, "catalog/storybook.ts", `export { default } from ${JSON.stringify(pathToFileURL(join(EXAMPLES, "storybook.ts")).href)}\n`)
  mkdirSync(join(dir, "catalog"), { recursive: true })
  copyFileSync(join(EXAMPLES, "storyboard.mjs"), join(dir, "catalog/storyboard.mjs"))
  write(dir, "story/scenes.json", [
    { id: "opening", title: "Opening", summary: "They meet.", characters: ["ada", "bo"], image: "story/opening.png", captions: "story/opening.vtt" },
    { id: "chase", title: "The Chase", characters: ["ada"], image: "story/chase.png" },
    { id: "finale", title: "Finale", characters: ["bo"] }
  ])
  write(dir, "story/characters.json", [{ id: "ada", name: "Ada", portrait: "story/ada.png" }, { id: "bo", name: "Bo" }, { id: "cy", name: "Cy" }])
  write(dir, "story/order.json", ["opening", "chase"])
  write(dir, "story/opening.png", png(4, 4, [1, 2, 3, 255]))
  write(dir, "story/chase.png", png(4, 4, [4, 5, 6, 255]))
  write(dir, "story/ada.png", png(2, 2, [7, 8, 9, 255]))
  write(dir, "story/opening.vtt", CAPTIONS)
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "story")
  return dir
}
const ids = (list: ReadonlyArray<{ id: string }>): Array<string> => list.map((entry) => entry.id)

test("sources, scopes, enrich, relations and link meta: several sources merge into one catalog shaped by the plugin", async () => {
  const dir = storyProject()
  const app = await open(dir)
  const summary = await app.run("summary", {})
  assert.equal(summary.project, "Storybook")
  assert.deepEqual(summary.plugins, ["media-core", storybook.name])
  assert.equal(summary.counts.units, 6, "the plugin read its files under the folder its entry's options name")
  assert.equal(summary.problems, 0)
  // Scopes replace the default split; a type names one, and search filters by it.
  const schema = await app.run("schema", {})
  assert.deepEqual(ids(schema.scopes), ["story", "cast"])
  assert.equal(schema.schema.types.scene.scope, "story")
  assert.equal(schema.unitScopes["character/ada"], "cast")
  assert.equal((await app.run("unit.search", { scope: "story" })).total, 3)
  assert.deepEqual(ids((await app.run("unit.search", { scope: "cast" })).units).sort(), ["character/ada", "character/bo", "character/cy"])
  await rejects(app.run("unit.search", { scope: "main" }), "invalid")
  // enrich: categories and a derived position, applied after the sources merged.
  const opening = await app.run("unit.get", { id: "scene/opening" })
  assert.equal(opening.organization.category, "Story/Scenes")
  assert.equal(opening.organization.projectCategory, "Story/Scenes")
  assert.equal(opening.unit.attrs.position, 1)
  assert.equal((await app.run("unit.get", { id: "character/cy" })).organization.category, "Story/Cast")
  // relations: declared one way, shown both ways; neither unit stores the other.
  assert.deepEqual(opening.relations.map((r: Any) => [r.name, r.direction, r.label, ids(r.units)]), [["cast", "out", "Characters", ["character/ada", "character/bo"]]])
  const ada = await app.run("unit.get", { id: "character/ada" })
  assert.deepEqual(ada.relations.map((r: Any) => [r.direction, r.label, ids(r.units)]), [["in", "Appears in", ["scene/opening", "scene/chase"]]])
  assert.equal(ada.relations[0].units[0].name, "Opening")
  assert.deepEqual((await app.run("unit.get", { id: "character/cy" })).relations, [])
  // links[].meta travels with the link and is not review evidence.
  const captions = opening.links.find((link: Any) => link.role === "captions")
  assert.deepEqual(captions.meta, { language: "en" })
  assert.equal(opening.links.find((link: Any) => link.role === "image").meta, null)
  const submitted = await W(app)("review.submit", { items: [{ target: { kind: "unit", id: "scene/opening" }, parts: ["captions"] }] })
  const record = read(dir, `.catalog/reviews/${submitted.submission.id}/submission.json`)
  assert.equal(JSON.stringify(record.items[0].parts).includes("language"), false, "link meta is not frozen as part evidence")
  cleanup(dir)
})

test("media kinds and probes: a plugin's kind is recognised by bytes; facts are measured once per file version and cached on disk", async () => {
  const dir = storyProject()
  const app = await open(dir)
  const link = async (catalog = app): Promise<Any> => (await catalog.run("unit.get", { id: "scene/opening" })).links.find((l: Any) => l.role === "captions")
  const first = await link()
  assert.deepEqual([first.asset.kind, first.asset.state, first.asset.mime], ["captions", "ok", "text/vtt"])
  assert.deepEqual(first.facts, { captions: { facts: { cues: 2, lastCue: 3.5 } } })
  assert.equal((await app.stats()).probesMeasured, 1)
  // Read again, and through the asset: served from memory.
  await link()
  assert.deepEqual((await app.run("asset.get", { id: "story/opening.vtt" })).facts.captions.facts, { cues: 2, lastCue: 3.5 })
  assert.equal((await app.stats()).probesMeasured, 1)
  // A new process finds the result under .catalog/.local/facts, keyed by probe, version and SHA-256.
  const sha = first.asset.sha256
  const cached = readdirSync(join(dir, ".catalog/.local/facts"), { recursive: true }).map(String).filter((file) => file.endsWith(`${sha}.json`))
  assert.equal(cached.length, 1)
  const restarted = await open(dir)
  assert.deepEqual((await link(restarted)).facts.captions.facts, { cues: 2, lastCue: 3.5 })
  assert.equal((await restarted.stats()).probesMeasured, 0)
  // Git reports the whole folder as ignored when the local state is all it holds.
  const state = git(dir, "status", "--porcelain", "--ignored")
  assert.match(state, /!! \.catalog\/(\.local\/)?$/m, "the cache is machine-local and ignored by Git")
  assert.doesNotMatch(state, /\?\? \.catalog/, "and leaves nothing untracked")
  // New bytes are a new file version: measured again.
  write(dir, "story/opening.vtt", `${CAPTIONS}\n00:01:10.250 --> 00:01:11.000\nLater\n`)
  assert.deepEqual((await link()).facts.captions.facts, { cues: 3, lastCue: 70.25 })
  assert.equal((await app.stats()).probesMeasured, 2)
  // The probe is published with its fields; images have no probe here.
  assert.deepEqual((await app.run("schema", {})).probes.map((p: Any) => [p.name, p.plugin, p.mediaKinds]), [["captions", "storybook", ["captions"]]])
  assert.deepEqual((await app.run("asset.get", { id: "story/opening.png" })).facts, {})
  // Bytes decide: a .vtt that is not WebVTT is invalid, and nothing is measured for it.
  write(dir, "story/opening.vtt", "not captions")
  const broken = await link()
  assert.equal(broken.asset.state, "invalid")
  assert.deepEqual(broken.facts, {})
  cleanup(dir)
})

test("checks: doctor runs plugin checks beside the built-in ones and applies a declared fix only when asked", async () => {
  const dir = storyProject()
  const app = await open(dir)
  const check = (report: Any): Any => report.checks.find((c: Any) => c.name === "running-order")
  const before = await app.run("doctor", {})
  assert.equal(before.ok, false)
  assert.equal(check(before).plugin, "storybook")
  assert.deepEqual(check(before).problems.map((p: Any) => [p.subject, p.fixable, p.severity]), [["finale", true, "problem"]])
  assert.deepEqual(read(dir, "story/order.json"), ["opening", "chase"], "nothing is repaired without fix")
  // `doctor` is a read: it has no way to repair, and says so instead of ignoring the request.
  assert.match((await rejects(app.run("doctor", { fix: true }), "invalid")).message, /fix/)
  assert.deepEqual(read(dir, "story/order.json"), ["opening", "chase"])
  // Repairs are a write: they need an actor like any other change to the project.
  await rejects(app.run("doctor.fix", {}), "invalid")
  assert.deepEqual(read(dir, "story/order.json"), ["opening", "chase"])
  const fixed = await W(app)("doctor.fix", {})
  assert.deepEqual(read(dir, "story/order.json"), ["opening", "chase", "finale"])
  assert.deepEqual(fixed.fixed.map((f: Any) => [f.check, f.subject, f.error]), [["running-order", "finale", null]])
  assert.deepEqual(check(fixed).problems, [], "the report shows what is still wrong after the repairs")
  assert.equal(fixed.summary.fixed, 1)
  cleanup(dir)
})

test("actions: project actions are listed with JSON Schema, validated, attributed and repeatable like built-in ones", async () => {
  const dir = storyProject()
  const app = await open(dir)
  const listed = await app.discover()
  const outline = listed.find((a) => a.name === "storybook.outline")
  assert.deepEqual([outline?.access, outline?.plugin], ["read", "storybook"])
  assert.deepEqual((outline?.input as Any).properties, { character: { anyOf: [{ type: "string" }, { type: "null" }] } })
  assert.equal((outline?.input as Any).additionalProperties, false)
  // What it returns is published as its output.
  assert.deepEqual(Object.keys((outline?.output as Any).properties), ["scenes"])
  const flag = listed.find((a) => a.name === "storybook.flag")
  assert.deepEqual([flag?.access, flag?.requires, flag?.output], ["write", ["actor"], undefined])
  assert.equal(listed.find((a) => a.name === "note.create")?.plugin, undefined)
  // A read needs no actor; its input is decoded with the declared schema.
  assert.deepEqual(ids((await app.run("storybook.outline", {})).scenes), ["opening", "chase", "finale"])
  assert.deepEqual(ids((await app.run("storybook.outline", { character: "bo" })).scenes), ["opening", "finale"])
  assert.deepEqual(ids((await app.run("storybook.outline", { character: null })).scenes), ["opening", "chase", "finale"], "null is not given")
  await rejects(app.run("storybook.outline", { charcter: "bo" }), "invalid")
  await rejects(app.run("storybook.outline", { character: 7 }), "invalid")
  // A write needs a declared actor, which its nested catalog writes keep.
  await rejects(app.run("storybook.flag", { scene: "chase", reason: "too long" }), "invalid")
  const flagged = await W(app, agent)("storybook.flag", { scene: "chase", reason: "too long" }, "flag-1")
  assert.deepEqual(flagged.note.by, agent)
  assert.equal(flagged.note.body, "Flagged by checker: too long", "a write's context has the declared actor")
  assert.deepEqual(flagged.note.target, { kind: "unit", id: "scene/chase" })
  // The same request id records once and returns the first result.
  const again = await W(app, agent)("storybook.flag", { scene: "chase", reason: "too long" }, "flag-1")
  assert.equal(again.note.id, flagged.note.id)
  assert.equal(again.replayed, true)
  assert.equal((await app.run("note.list", {})).total, 1)
  await rejects(W(app, agent)("storybook.flag", { scene: "chase", reason: "something else" }, "flag-1"), "conflict")
  // A failure inside a plugin action keeps its error code.
  await rejects(W(app, agent)("storybook.flag", { scene: "nowhere", reason: "x" }), "not_found")
  cleanup(dir)
})

test("resolvers and previews: a plugin's resolver is selected by name; its preview module is served by name", async () => {
  const dir = storyProject()
  const app = await open(dir)
  const target = { kind: "unit", id: "scene/chase" }
  const sub = await W(app, human)("review.submit", { items: [{ target }] })
  const item = (await app.run("review.get", { submission: sub.submission.id })).items[0].id
  await W(app, human)("review.decide", { submission: sub.submission.id, item, verdicts: { image: "approved" } })
  await new Promise((done) => setTimeout(done, 15))
  await W(app, agent)("review.decide", { submission: sub.submission.id, item, verdicts: { image: "changes" } })
  const verdict = async (): Promise<string> => (await app.run("unit.get", { id: "scene/chase" })).review.parts.find((p: Any) => p.id === "image").verdict
  assert.equal((await app.run("summary", {})).resolver, "human-first")
  assert.equal(await verdict(), "approved", "the plugin's resolver keeps the person's verdict over the later agent one")
  // The same decisions under the default resolver: no record changes, another reading.
  write(dir, "catalog.config.json", { ...read(dir, "catalog.config.json"), review: { resolver: "latest" } })
  assert.equal(await verdict(), "changes")
  write(dir, "catalog.config.json", { ...read(dir, "catalog.config.json"), review: { resolver: "nobody-registered-this" } })
  assert.equal(await verdict(), "changes", "an unknown resolver keeps the last good settings")
  assert.match((await app.run("problems", {})).problems.map((p: Any) => p.error).join("\n"), /unknown verdict resolver nobody-registered-this/)
  await rejects(open(dir).then((fresh) => fresh.run("summary", {})), "invalid")
  // Previews: browser modules named by the plugin, read from the project.
  const module = await app.browserModule("storyboard")
  assert.deepEqual(Buffer.from(module.bytes), readFileSync(join(dir, "catalog/storyboard.mjs")))
  assert.match((await app.run("schema", {})).browserModules.storyboard, /^\/project\/module\/storyboard\?v=[0-9a-f]{16}$/)
  await rejects(app.browserModule("other"), "not_found")
  cleanup(dir)
})

test("inspectors and panels: a type names modules its plugin declares; a unit lists them with where each loads from", async () => {
  const dir = storyProject()
  const app = await open(dir)
  const scene = await app.run("unit.get", { id: "scene/opening" })
  assert.deepEqual(scene.inspectors.map((v: Any) => [v.key, v.label, v.module, v.export, v.default, v.error]), [["beats", "Beats", "storybook", "beats", false, null]])
  assert.match(scene.inspectors[0].url, /^\/project\/module\/storybook\?v=[0-9a-f]{16}$/)
  assert.deepEqual(scene.panels.map((p: Any) => [p.key, p.export, p.url === scene.inspectors[0].url]), [["placement", "placement", true]])
  assert.deepEqual((await app.run("unit.get", { id: "character/ada" })).inspectors, [])
  const schema = await app.run("schema", {})
  // Inspector, panel and preview modules share one namespace.
  assert.deepEqual(Object.keys(schema.browserModules), ["storyboard", "storybook"])
  assert.equal(schema.browserModules.storybook, scene.inspectors[0].url)
  assert.deepEqual(schema.schema.types.scene.inspectors.map((v: Any) => v.key), ["beats"])
  // Served by its declared name from beside the plugin, and nothing else is.
  assert.deepEqual(Buffer.from((await app.browserModule("storybook")).bytes), readFileSync(join(EXAMPLES, "storybook.web.js")))
  await rejects(app.browserModule("storybook.web.js"), "not_found")

  // A module nobody declared, a unit narrowing its inspectors, a malformed inspector: each said, none guessed.
  const narrowed = definePlugin({
    name: "narrowed",
    sources: [{
      name: "props",
      inputs: () => [],
      load: () => ({
        assetRoots: ["story"],
        types: { prop: { label: "Prop", roles: [], inspectors: [{ key: "inspect", label: "Inspector", module: "kit", default: true }, { key: "lost", label: "Lost", module: "undeclared" }, { key: "Bad Key", label: "x", module: "kit" }] } },
        units: [{ id: "prop/lamp", type: "prop" }, { id: "prop/plain", type: "prop", inspectors: ["inspect"] }]
      })
    }],
    browserModules: { kit: "catalog/kit.js" }
  })
  write(dir, "catalog/kit.js", "export default function (host) { host.textContent = 'kit' }\n")
  write(dir, "catalog.config.json", { version: 3, plugins: ["narrowed"] })
  const other = await open(dir, { plugins: { narrowed } })
  const lamp = await other.run("unit.get", { id: "prop/lamp" })
  assert.deepEqual(lamp.inspectors.map((v: Any) => [v.key, v.default, v.export, !!v.url, v.error]), [
    ["inspect", true, "default", true, null],
    ["lost", false, "default", false, 'browser module "undeclared" is not declared by any plugin (a plugin lists it under browserModules)']
  ])
  assert.deepEqual((await other.run("unit.get", { id: "prop/plain" })).inspectors.map((v: Any) => v.key), ["inspect"])
  assert.match((await other.run("problems", {})).problems.map((p: Any) => p.error).join("\n"), /type prop: inspector Bad Key needs a unique key/)
  cleanup(dir)
})

test("plugin function results: a value, a promise or an Effect; a failure is a scoped problem, never a crash", async () => {
  const dir = tmp("cc-kinds-")
  git(dir, "init", "-q")
  write(dir, "catalog.config.json", { version: 3, plugins: ["shapes"] })
  const type = { label: "Shape", fields: [{ key: "sides", label: "Sides" }], roles: [] }
  const source = (name: string, load: Plugin["sources"] extends ReadonlyArray<infer S> | undefined ? S extends { load: infer L } ? L : never : never) => ({ name, inputs: () => [], load })
  let broken = true
  const shapes = definePlugin({
    name: "shapes",
    sources: [
      source("value", () => ({ types: { shape: type }, units: [{ id: "shape/square", type: "shape", attrs: { sides: 4 } }] })),
      source("promise", async () => ({ types: { shape: type }, units: [{ id: "shape/triangle", type: "shape", attrs: { sides: 3 } }] })),
      source("effect", () => Effect.succeed({ types: { shape: type }, units: [{ id: "shape/line", type: "shape", attrs: { sides: 1 } }] })),
      source("throws", () => { throw new Error("no shapes today") }),
      source("fails", () => Effect.fail("effect said no")),
      // The same type key with another definition, and a unit id that is already taken.
      source("clash", () => ({ types: { shape: { ...type, label: "Other" } }, units: [{ id: "shape/square", type: "shape" }] }))
    ],
    enrich: () => {
      if (broken) throw new Error("enrich exploded")
      return { units: { "shape/line": null } }
    },
    actions: [{ name: "summary", access: "read", description: "shadows a built-in", input: Schema.Struct({}), run: () => ({ hijacked: true }) }]
  })
  // The composition root registers a plugin that lives outside src/catalog by name.
  await rejects(open(dir).then((bare) => bare.run("summary", {})), "invalid")
  const app = await open(dir, { plugins: { shapes } })
  assert.deepEqual(ids((await app.run("unit.search", {})).units).sort(), ["shape/line", "shape/square", "shape/triangle"])
  const summary = await app.run("summary", {})
  assert.equal(summary.hijacked, undefined, "a plugin cannot replace a built-in action")
  const problems: Array<string> = (await app.run("problems", {})).problems.map((p: Any) => `${p.origin} | ${p.subject} | ${p.error}`)
  for (const expected of [/source throws failed: no shapes today/, /source fails failed: effect said no/, /type shape is already defined differently by source value/, /duplicate unit id shape\/square/, /plugin shapes \| enrich by shapes: enrich exploded/, /action summary has the name of a built-in action/]) {
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected} in\n${problems.join("\n")}`)
  }
  assert.equal(summary.problems, problems.length)
  assert.equal(existsSync(join(dir, ".catalog/notes")), false)
  broken = false
  cleanup(dir)
})

test("the README's example plugin works as printed", async () => {
  const readme = readFileSync(fileURLToPath(new URL("../../src/catalog/README.md", import.meta.url)), "utf8")
  const example = /```ts\n(\/\/ catalog\/recipes\.ts[\s\S]*?)```/.exec(readme)?.[1]
  assert.ok(example, "the README holds the recipes example")
  const dir = tmp("cc-readme-")
  git(dir, "init", "-q")
  // Only the import is rewritten: a temporary project has no installed toolkit beside it.
  write(dir, "catalog/recipes.ts", example.replace('"../tools/jam/catalog-plugin.ts"', JSON.stringify(new URL("../../catalog-plugin.ts", import.meta.url).href)))
  write(dir, "catalog.config.json", { version: 3, plugins: ["./catalog/recipes.ts"] })
  write(dir, "recipes.json", [{ id: "stock", title: "Stock" }, { id: "soup", title: "Soup", photo: "photos/soup.png", uses: ["stock"] }])
  write(dir, "photos/soup.png", png(4, 4))
  const app = await open(dir)
  assert.deepEqual([(await app.run("summary", {})).project, (await app.run("summary", {})).problems], ["Cookbook", 0])
  const stock = await app.run("unit.get", { id: "recipe/stock" })
  assert.deepEqual(stock.relations.map((r: Any) => [r.direction, r.label, ids(r.units)]), [["in", "Used in", ["recipe/soup"]]])
  const photos = (await app.run("doctor", {})).checks.find((check: Any) => check.name === "photos")
  assert.deepEqual(photos.problems.map((p: Any) => p.message), ["recipe/stock has no photo"])
  cleanup(dir)
})

test("published schemas: the configuration and every record kind render as JSON Schema", () => {
  const rendered = Object.fromEntries(publishedSchemas.map((entry) => [entry.file, jsonSchemaOf(entry.schema) as Any]))
  assert.deepEqual(Object.keys(rendered).sort(), ["catalog-categories.schema.json", "catalog-collection.schema.json", "catalog-decision.schema.json", "catalog-note.schema.json", "catalog-organization.schema.json", "catalog-submission.schema.json", "catalog.config.schema.json"])
  // An identified schema is published as a reference into its definitions.
  const body = (file: string, name: string): Any => {
    assert.equal(rendered[file].$ref, `#/$defs/${name}`)
    return rendered[file].$defs[name]
  }
  assert.deepEqual(body("catalog.config.schema.json", "CatalogConfig").properties.version, { type: "number", enum: [3] })
  assert.deepEqual(body("catalog-note.schema.json", "NoteRecord").required, ["id", "target", "body", "by", "at", "revision"])
  assert.equal(body("catalog-decision.schema.json", "DecisionRecord").properties.id.pattern, "^dc_[a-z0-9]+$")
})

test("collection kinds: a member's own value reads as a count, or as written when the kind says text", async () => {
  const dir = tmp("cc-members-")
  git(dir, "init", "-q")
  const pieces = definePlugin({
    name: "pieces",
    sources: [{
      name: "families",
      inputs: () => [],
      load: () => ({
        types: { piece: { label: "Piece", roles: [] } },
        collectionKinds: { family: { label: "Brush family", memberExtra: { key: "role", format: "text" } }, crate: { label: "Crate", memberExtra: { key: "count" } } },
        units: [{ id: "piece/corner", type: "piece" }, { id: "piece/edge", type: "piece" }],
        collections: [
          { id: "family/wall", name: "Wall", kind: "family", members: [{ unit: "piece/corner", role: "Corner Outer" }, { unit: "piece/edge" }] },
          { id: "crate/supplies", name: "Supplies", kind: "crate", members: [{ unit: "piece/corner", count: 3 }] }
        ]
      })
    }]
  })
  write(dir, "catalog.config.json", { version: 3, plugins: ["pieces"] })
  const app = await open(dir, { plugins: { pieces } })
  assert.deepEqual((await app.run("collection.get", { id: "family/wall" })).members.map((m: Any) => m.extra), ["Corner Outer", null])
  assert.deepEqual((await app.run("collection.get", { id: "crate/supplies" })).members.map((m: Any) => m.extra), ["×3"])
  cleanup(dir)
})

/** A project whose one plugin reads its catalog from `shelf.json`, as source output. */
const shelfProject = (output: SourceOutput, extra: Partial<Plugin> = {}) => {
  const dir = tmp("cc-shelf-")
  git(dir, "init", "-q")
  write(dir, "catalog.config.json", { version: 3, plugins: ["shelf"] })
  write(dir, "shelf.json", output)
  const shelf = definePlugin({
    name: "shelf",
    sources: [{ name: "shelf", inputs: () => ["shelf.json"], load: ({ files }) => files.readJson("shelf.json") as Promise<SourceOutput> }],
    ...extra
  })
  return { dir, plugins: { shelf } }
}
const BOOK = { label: "Book", fields: [], roles: [{ key: "cover", label: "Cover", mediaKinds: ["image"] }] }

test("a project-owned collection hides a catalog-owned one with its id, and the hidden record is listed as a problem", async () => {
  const { dir, plugins } = shelfProject({ types: { book: BOOK }, units: [{ id: "book/a", type: "book" }, { id: "book/b", type: "book" }] })
  const app = await open(dir, { plugins })
  await W(app)("collection.create", { id: "set/reading", name: "Reading list", members: ["book/a"] })
  const [file] = readdirSync(join(dir, ".catalog/collections"))
  // Later the project's sources define the same id.
  write(dir, "shelf.json", { types: { book: BOOK }, units: [{ id: "book/a", type: "book" }, { id: "book/b", type: "book" }], collections: [{ id: "set/reading", name: "Shelf order", members: [{ unit: "book/b" }] }] })
  assert.equal((await app.run("collection.get", { id: "set/reading" })).collection.name, "Shelf order", "the project's sources stay authoritative")
  assert.deepEqual((await app.run("problems", {})).problems, [{
    origin: "records",
    subject: `.catalog/collections/${file}`,
    error: "collection set/reading is also defined by the project's sources; this catalog-owned record is hidden",
    recovery: "create it again under another id with collection.create and delete this one with collection.delete, or remove the collection from the project's sources"
  }])
  cleanup(dir)
})

test("a role key that is a reserved part name is dropped and reported; decision and view are ordinary role keys", async () => {
  const reserved = ["attributes", "item", "capture", "inspector"]
  const roles = [...[...reserved, "decision", "view"].map((key) => ({ key, label: key, mediaKinds: ["image"], many: true })), BOOK.roles[0]!]
  const { dir, plugins } = shelfProject({ types: { book: { ...BOOK, roles } }, units: [{ id: "book/a", type: "book" }] })
  const app = await open(dir, { plugins })
  const schema = await app.run("schema", {})
  assert.deepEqual(schema.schema.types.book.roles.map((role: Any) => role.key), ["decision", "view", "cover"])
  const problems: Array<string> = (await app.run("problems", {})).problems.map((problem: Any) => problem.error)
  for (const key of reserved) assert.ok(problems.includes(`type book: role ${key} uses a reserved part name`), `${key} in ${problems.join("; ")}`)
  assert.equal(problems.length, reserved.length, problems.join("; "))
  cleanup(dir)
})

test("a plugin action's optional input built with optional() accepts null as not given", async () => {
  const { dir, plugins } = shelfProject({ types: { book: BOOK }, units: [{ id: "book/a", type: "book" }] }, {
    actions: [defineAction({
      name: "shelf.find",
      access: "read",
      description: "Books, optionally one",
      input: Schema.Struct({ id: optional(Text) }),
      run: (input) => ({ id: input.id ?? null })
    })]
  })
  const app = await open(dir, { plugins })
  assert.deepEqual(await app.run("shelf.find", { id: null }), { id: null })
  assert.deepEqual(await app.run("shelf.find", { id: "book/a" }), { id: "book/a" })
  await rejects(app.run("shelf.find", { id: "" }), "invalid")
  cleanup(dir)
})

test("old keys in a source's output and an enrich patch are each a problem naming the field and its new key", async () => {
  const GUIDE = "rename it; docs/catalog-migration.md lists every renamed key"
  const output = {
    types: { thing: { label: "Thing", fields: [], roles: [{ key: "cover", label: "Cover", kinds: ["image"], mediaKinds: ["image"] }], views: [] } },
    units: [{ id: "thing/a", type: "thing", views: [] }, { id: "thing/b", type: "thing" }],
    problems: [{ source: "shelf.json", error: "a shelf is crooked" }]
  } as unknown as SourceOutput
  const { dir, plugins } = shelfProject(output, { enrich: () => ({ units: { "thing/b": { name: "B", views: [] } as never } }) })
  const app = await open(dir, { plugins })
  const problems = (await app.run("problems", {})).problems
  assert.deepEqual(problems.filter((p: Any) => p.recovery === GUIDE).map((p: Any) => [p.subject, p.error]), [
    ["shelf", "types.thing.views is now inspectors"],
    ["shelf", "types.thing.roles[0].kinds is now mediaKinds"],
    ["shelf", "units[0] (thing/a).views is now inspectors"],
    ["shelf", "problems[0].source is now subject"],
    ["plugin shelf", 'units["thing/b"].views is now inspectors']
  ])
  assert.ok(problems.some((p: Any) => p.error === "a shelf is crooked"), "the problem itself is still reported")
  cleanup(dir)
})

test("a version 2 manifest or unit file that still uses views or role kinds is a problem pointing to jam catalog migrate", async () => {
  const armor = { ...TYPES.armor, roles: TYPES.armor.roles.map((role, index) => (index === 0 ? { ...role, kinds: ["image"] } : role)), views: [] }
  const dir = await makeProject({
    extra: { types: { ...TYPES, armor }, units: [{ id: "lore/a", type: "lore", name: "A", views: [] }] },
    units: [{ id: "lore/b", type: "lore", name: "B", views: [] }, { id: "lore/c", type: "lore", name: "C" }]
  })
  const app = await open(dir)
  const problems = (await app.run("problems", {})).problems
  assert.deepEqual(problems.map((p: Any) => [p.origin, p.subject, p.error, p.recovery]), [
    ["sources", "catalog.manifest.json", "types.armor.views is now inspectors", "run: jam catalog migrate"],
    ["sources", "catalog.manifest.json", "types.armor.roles[0].kinds is now mediaKinds", "run: jam catalog migrate"],
    ["sources", "catalog.manifest.json", "units[0] (lore/a).views is now inspectors", "run: jam catalog migrate"],
    ["sources", "content/lore_b.json", "views is now inspectors", "run: jam catalog migrate"]
  ])
  assert.equal((await app.run("unit.get", { id: "lore/b" })).unit.name, "B", "the units still load")
  cleanup(dir)
})

test("an edit to a module a plugin imports from the project reloads the plugin, as an edit to the plugin does", async () => {
  const dir = tmp("cc-imports-")
  git(dir, "init", "-q")
  write(dir, "catalog.config.json", { version: 3, plugins: ["./catalog/p.mjs"] })
  write(dir, "catalog/p.mjs", `import { label } from "./lib/label.mjs"
export default { name: "p", sources: [{ name: "one", inputs: () => ["catalog"], load: () => ({ types: { thing: { label: "Thing" } }, units: [{ id: "a", type: "thing", name: label() }] }) }] }
`)
  write(dir, "catalog/lib/label.mjs", `export const label = () => "first"\n`)
  const app = await open(dir)
  assert.equal((await app.run("unit.get", { id: "a" })).unit.name, "first")
  write(dir, "catalog/lib/label.mjs", `export const label = () => "second"\n`)
  assert.equal((await app.run("unit.get", { id: "a" })).unit.name, "second")
  cleanup(dir)
})
