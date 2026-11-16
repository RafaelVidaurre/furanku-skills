// The plugin contract, exercised through the example plugin in examples/plugins and a few
// purpose-built ones. Every extension point is reached the way a project reaches it: named in
// catalog.config.json and observed through actions.
import assert from "node:assert/strict"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { definePlugin, Effect, type Plugin, Schema } from "../../src/catalog/plugin.ts"
import { publishedSchemas } from "../../src/catalog/published.ts"
import { jsonSchemaOf } from "../../src/kernel/decode.ts"
import storybook from "../../examples/plugins/storybook.ts"
import { agent, cleanup, git, human, open, png, read, rejects, tmp, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const EXAMPLES = fileURLToPath(new URL("../../examples/plugins/", import.meta.url))
const CAPTIONS = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n\n00:00:03.500 --> 00:00:04.000\nBye\n"

/** A project that loads the example plugin as a project module, as its header describes. */
const storyProject = (review: Record<string, unknown> = { resolver: "human-first" }): string => {
  const dir = tmp("cc-story-")
  git(dir, "init", "-q")
  write(dir, "catalog.config.json", { version: 2, plugins: ["./catalog/storybook.ts"], options: { storybook: { folder: "story" } }, review })
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
  const context = await app.run("context", {})
  assert.equal(context.project, "Storybook")
  assert.deepEqual(context.plugins, ["media-core", storybook.name])
  assert.equal(context.counts.units, 6)
  assert.equal(context.problems, 0)
  // Scopes replace the default split; a type names one, and search filters by it.
  const schema = await app.run("schema", {})
  assert.deepEqual(ids(schema.scopes), ["story", "cast"])
  assert.equal(schema.schema.types.scene.scope, "story")
  assert.equal(schema.unitScopes["character/ada"], "cast")
  assert.equal((await app.run("catalog.search", { section: "units", scope: "story" })).total, 3)
  assert.deepEqual(ids((await app.run("catalog.search", { section: "units", scope: "cast" })).items).sort(), ["character/ada", "character/bo", "character/cy"])
  await rejects(app.run("catalog.search", { section: "units", scope: "content" }), "invalid")
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
  assert.deepEqual((await app.run("schema", {})).probes.map((p: Any) => [p.name, p.plugin, p.kinds]), [["captions", "storybook", ["captions"]]])
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
  assert.deepEqual([outline?.kind, outline?.plugin], ["read", "storybook"])
  assert.deepEqual((outline?.input as Any).properties, { character: { type: "string" } })
  assert.equal((outline?.input as Any).additionalProperties, false)
  assert.equal(listed.find((a) => a.name === "storybook.flag")?.kind, "write")
  assert.equal(listed.find((a) => a.name === "note.create")?.plugin, undefined)
  // A read needs no actor; its input is decoded with the declared schema.
  assert.deepEqual(ids((await app.run("storybook.outline", {})).scenes), ["opening", "chase", "finale"])
  assert.deepEqual(ids((await app.run("storybook.outline", { character: "bo" })).scenes), ["opening", "finale"])
  await rejects(app.run("storybook.outline", { charcter: "bo" }), "invalid")
  await rejects(app.run("storybook.outline", { character: 7 }), "invalid")
  // A write needs a declared actor, which its nested catalog writes keep.
  await rejects(app.run("storybook.flag", { scene: "chase", reason: "too long" }), "invalid")
  const flagged = await W(app, agent)("storybook.flag", { scene: "chase", reason: "too long" }, "flag-1")
  assert.deepEqual(flagged.note.by, agent)
  assert.deepEqual(flagged.note.target, { kind: "unit", id: "scene/chase" })
  // The same request id records once and returns the first result.
  const again = await W(app, agent)("storybook.flag", { scene: "chase", reason: "too long" }, "flag-1")
  assert.equal(again.note.id, flagged.note.id)
  assert.equal(again.replayed, true)
  assert.equal((await app.run("notes.list", {})).total, 1)
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
  assert.equal((await app.run("context", {})).resolver, "human-first")
  assert.equal(await verdict(), "approved", "the plugin's resolver keeps the person's verdict over the later agent one")
  // The same events under the default resolver: no record changes, another reading.
  write(dir, "catalog.config.json", { ...read(dir, "catalog.config.json"), review: { resolver: "latest" } })
  assert.equal(await verdict(), "changes")
  write(dir, "catalog.config.json", { ...read(dir, "catalog.config.json"), review: { resolver: "nobody-registered-this" } })
  assert.equal(await verdict(), "changes", "an unknown resolver keeps the last good settings")
  assert.match((await app.run("problems", {})).problems.map((p: Any) => p.error).join("\n"), /unknown verdict resolver nobody-registered-this/)
  await rejects(open(dir).then((fresh) => fresh.run("context", {})), "invalid")
  // Previews: named by the plugin, read from the project.
  const module = await app.previewModule("storyboard")
  assert.deepEqual(Buffer.from(module.bytes), readFileSync(join(dir, "catalog/storyboard.mjs")))
  assert.deepEqual((await app.run("schema", {})).previews, ["storyboard"])
  await rejects(app.previewModule("other"), "not_found")
  cleanup(dir)
})

test("plugin function results: a value, a promise or an Effect; a failure is a scoped problem, never a crash", async () => {
  const dir = tmp("cc-kinds-")
  git(dir, "init", "-q")
  write(dir, "catalog.config.json", { version: 2, plugins: ["shapes"] })
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
    actions: [{ name: "context", kind: "read", description: "shadows a built-in", input: Schema.Struct({}), run: () => ({ hijacked: true }) }]
  })
  // The composition root registers a plugin that lives outside src/catalog by name.
  await rejects(open(dir).then((bare) => bare.run("context", {})), "invalid")
  const app = await open(dir, { plugins: { shapes } })
  assert.deepEqual(ids((await app.run("catalog.search", {})).items).sort(), ["shape/line", "shape/square", "shape/triangle"])
  const context = await app.run("context", {})
  assert.equal(context.hijacked, undefined, "a plugin cannot replace a built-in action")
  const problems: Array<string> = (await app.run("problems", {})).problems.map((p: Any) => `${p.scope} | ${p.source} | ${p.error}`)
  for (const expected of [/source throws failed: no shapes today/, /source fails failed: effect said no/, /type shape is already defined differently by source value/, /duplicate content id shape\/square/, /plugin shapes \| enrich by shapes: enrich exploded/, /action context has the name of a built-in action/]) {
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected} in\n${problems.join("\n")}`)
  }
  assert.equal(context.problems, problems.length)
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
  write(dir, "catalog/recipes.ts", example.replace('"../tools/jam/src/catalog/plugin.ts"', JSON.stringify(new URL("../../src/catalog/plugin.ts", import.meta.url).href)))
  write(dir, "catalog.config.json", { version: 2, plugins: ["./catalog/recipes.ts"] })
  write(dir, "recipes.json", [{ id: "stock", title: "Stock" }, { id: "soup", title: "Soup", photo: "photos/soup.png", uses: ["stock"] }])
  write(dir, "photos/soup.png", png(4, 4))
  const app = await open(dir)
  assert.deepEqual([(await app.run("context", {})).project, (await app.run("context", {})).problems], ["Cookbook", 0])
  const stock = await app.run("unit.get", { id: "recipe/stock" })
  assert.deepEqual(stock.relations.map((r: Any) => [r.direction, r.label, ids(r.units)]), [["in", "Used in", ["recipe/soup"]]])
  const photos = (await app.run("doctor", {})).checks.find((check: Any) => check.name === "photos")
  assert.deepEqual(photos.problems.map((p: Any) => p.message), ["recipe/stock has no photo"])
  cleanup(dir)
})

test("published schemas: the configuration and every record kind render as JSON Schema", () => {
  const rendered = Object.fromEntries(publishedSchemas.map((entry) => [entry.file, jsonSchemaOf(entry.schema) as Any]))
  assert.deepEqual(Object.keys(rendered).sort(), ["catalog-categories.schema.json", "catalog-collection.schema.json", "catalog-label.schema.json", "catalog-note.schema.json", "catalog-submission.schema.json", "catalog-verdict.schema.json", "catalog.config.schema.json"])
  // An identified schema is published as a reference into its definitions.
  const body = (file: string, name: string): Any => {
    assert.equal(rendered[file].$ref, `#/$defs/${name}`)
    return rendered[file].$defs[name]
  }
  assert.deepEqual(body("catalog.config.schema.json", "CatalogConfig").properties.version, { type: "number", enum: [2] })
  assert.deepEqual(body("catalog-note.schema.json", "NoteRecord").required, ["id", "target", "body", "by", "at", "revision"])
  assert.equal(body("catalog-verdict.schema.json", "VerdictRecord").properties.id.pattern, "^vd_[a-z0-9]+$")
})
