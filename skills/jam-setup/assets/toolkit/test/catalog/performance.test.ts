// The performance rules, each from a measured failure of the version 1 engine. They are stated
// as counts of work done (programs run, sources loaded, files read), not as timings, so a
// regression fails on any machine.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { TestClock } from "effect/testing"
import assert from "node:assert/strict"
import { utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { definePlugin } from "../../src/catalog/plugin.ts"
import { Ids } from "../../src/kernel/Ids.ts"
import { Process } from "../../src/kernel/Process.ts"
import { type App, cleanup, git, makeProject, open, png, read, standardProject, tmp, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const unit = (id: string) => ({ kind: "unit", id })

/** The real Process, recording every program it is asked to run. */
const recordingProcess = (calls: Array<string>): Layer.Layer<Process> =>
  Layer.effect(Process, Effect.map(Process, (real) => ({
    run: (command, args, options) => (calls.push([command, ...args].join(" ")), real.run(command, args, options)),
    text: (command, args, options) => (calls.push([command, ...args].join(" ")), real.text(command, args, options))
  }))).pipe(Layer.provide(Process.layer))

/** What one action cost, as the difference of the catalog's counters around it. */
const cost = async (app: App, action: () => Promise<unknown>) => {
  const before = await app.stats()
  await action()
  const after = await app.stats()
  const loads = Object.fromEntries(Object.entries(after.sourceLoads).map(([source, count]) => [source, count - (before.sourceLoads[source] ?? 0)]).filter(([, count]) => count !== 0))
  return { projections: after.projections - before.projections, scans: after.recordScans - before.recordScans, parsed: after.recordsParsed - before.recordsParsed, hashed: after.filesHashed - before.filesHashed, loads }
}

test("the context poll starts no program and returns no schema", async () => {
  const dir = await standardProject()
  const calls: Array<string> = []
  const app = await open(dir, { process: recordingProcess(calls) })
  await app.run("context", {})
  calls.length = 0
  const context = await app.run("context", {})
  assert.deepEqual(calls, [], "the poll starts no program: the checkout is read from Git's own files")
  assert.equal(context.context.branch, "main")
  assert.equal("schema" in context, false)
  assert.equal("unitScopes" in context, false)
  assert.equal(context.context.dirty, undefined)
  assert.ok(JSON.stringify(context).length < 1500, "the poll answer stays small whatever the project holds")
  // What moved out is still available, on request: the schema by version, the dirty count by `checkout`.
  const schema = await app.run("schema", {})
  assert.equal(schema.version, context.version)
  assert.ok(schema.schema.types.armor)
  calls.length = 0
  write(dir, "untracked.txt", "x")
  assert.equal((await app.run("checkout", {})).context.dirty, 1)
  assert.equal(calls.filter((call) => /\bstatus\b/.test(call)).length, 1)
  // No read of content starts a program at all.
  calls.length = 0
  await app.run("catalog.search", { q: "helm" })
  await app.run("unit.get", { id: "armor/helm" })
  await app.run("notes.list", {})
  assert.deepEqual(calls, [])
  cleanup(dir)
})

test("an action builds at most one projection and scans the record folders once", async () => {
  const units = Array.from({ length: 40 }, (_, i) => ({ id: `lore/${i}`, type: "lore", name: `Lore ${i}`, attrs: { text: `Text ${i}` }, links: [] }))
  const dir = await makeProject({ units })
  const app = await open(dir)
  const run = W(app)
  await run("organize.bulk", { targets: units.map((u) => unit(u.id)), addTags: ["batch"] })
  const submitted = await run("review.submit", { items: units.slice(0, 10).map((u) => ({ target: unit(u.id) })) })
  const review = await app.run("review.get", { submission: submitted.submission.id })
  // Reads over many rows, facets and review states: one projection each, reused when nothing changed.
  const first = await cost(app, () => app.run("catalog.search", { filters: { tag: ["batch"], review: ["undecided"] } }))
  assert.deepEqual([first.projections <= 1, first.scans], [true, 1])
  for (const action of [() => app.run("catalog.search", { q: "lore" }), () => app.run("context", {}), () => app.run("reviews.list", {}), () => app.run("organization.list", {}), () => app.run("inbox", {})]) {
    assert.deepEqual(await cost(app, action), { projections: 0, scans: 1, parsed: 0, hashed: 0, loads: {} }, "an unchanged project is not projected again")
  }
  // Writes: the projection is read once, under the lock; the answer comes from what was written.
  for (const action of [
    () => run("note.create", { target: unit("lore/1"), body: "n" }),
    () => run("review.decide", { submission: review.id, item: review.items[0].id, whole: "approved" }),
    () => run("organize.set", { target: unit("lore/2"), tags: ["x"] }),
    () => run("review.decideCurrent", { target: unit("lore/30"), whole: "approved" }),
    () => run("category.rename", { from: "Nothing", to: "Else" })
  ]) {
    const spent = await cost(app, action)
    assert.deepEqual([spent.projections <= 1, spent.scans, spent.loads], [true, 1, {}])
  }
  cleanup(dir)
})

test("sources invalidate through their declared inputs: an unchanged source is not loaded again", async () => {
  const dir = tmp("cc-inputs-")
  git(dir, "init", "-q")
  write(dir, "data/a.json", [{ id: "a/1" }])
  write(dir, "data/b.json", [{ id: "b/1" }])
  write(dir, "data/unrelated.json", {})
  write(dir, "media/pic.png", png(4, 4))
  const source = (name: string) => ({
    name,
    inputs: () => [`data/${name}.json`],
    load: async (context: { files: { readJson(path: string): Promise<unknown> } }) => ({
      types: { [name]: { label: name, roles: [{ key: "pic", label: "Pic", kinds: ["image"] }] } },
      assetRoots: ["media"],
      units: ((await context.files.readJson(`data/${name}.json`)) as Array<{ id: string }>).map((entry) => ({ id: entry.id, type: name, links: [{ role: "pic", asset: "media/pic.png" }] }))
    })
  })
  const two = definePlugin({ name: "two", sources: [source("a"), source("b")] })
  write(dir, "catalog.config.json", { version: 2, plugins: ["two"] })
  const app = await open(dir, { plugins: { two } })
  const search = () => app.run("catalog.search", {})
  assert.deepEqual((await cost(app, search)).loads, { "two/a": 1, "two/b": 1 })
  assert.deepEqual((await cost(app, search)).loads, {}, "nothing changed: nothing is loaded")
  // A file no source declared is not an input.
  write(dir, "data/unrelated.json", { changed: true })
  assert.deepEqual((await cost(app, search)).loads, {})
  // One source's input changes: only that source is loaded.
  write(dir, "data/b.json", [{ id: "b/1" }, { id: "b/2" }])
  const changed = await cost(app, search)
  assert.deepEqual(changed.loads, { "two/b": 1 })
  assert.equal((await search()).total, 3)
  // Authored data is compared by bytes: same size, same timestamp, other content.
  const file = join(dir, "data/a.json")
  const stamp = new Date("2021-03-04T05:06:07Z")
  utimesSync(file, stamp, stamp)
  await search()
  writeFileSync(file, JSON.stringify([{ id: "a/9" }], null, 2) + "\n")
  utimesSync(file, stamp, stamp)
  assert.deepEqual((await cost(app, search)).loads, { "two/a": 1 })
  assert.deepEqual((await search()).ids.sort(), ["a/9", "b/1", "b/2"])
  // Media is compared by size and modification time: a changed media file reloads no source, and
  // a list never reads one in full (was hashed: 1 while every file was hashed on load).
  assert.equal((await cost(app, search)).hashed, 0)
  write(dir, "media/pic.png", png(8, 8))
  assert.deepEqual(await cost(app, search), { projections: 1, scans: 1, parsed: 0, hashed: 0, loads: {} })
  // The digest is computed when a detail page names the file, once per version of it.
  assert.equal((await cost(app, () => app.run("asset.get", { id: "media/pic.png" }))).hashed, 1)
  assert.equal((await cost(app, () => app.run("asset.get", { id: "media/pic.png" }))).hashed, 0)
  // A new process starts from the machine-local cache instead of hashing the file again.
  const restarted = await open(dir, { plugins: { two } })
  assert.equal((await cost(restarted, () => restarted.run("asset.get", { id: "media/pic.png" }))).hashed, 0)
  cleanup(dir)
})

// Measured on a real project (2,446 media files, 2,515 source files): a page asking for its 21
// thumbnails at once ran one full check of the sources per request, one after another, and the
// last thumbnail answered after 3.7 s.
test("requests arriving together share a check of the sources that began after they arrived", async () => {
  const dir = tmp("cc-burst-")
  git(dir, "init", "-q")
  write(dir, "data/list.json", [{ id: "p/1" }])
  for (let i = 0; i < 20; i++) write(dir, `media/${i}.png`, png(4, 4, [i, 0, 0, 255]))
  let checks = 0
  const counted = definePlugin({
    name: "counted",
    sources: [{
      name: "list",
      inputs: () => (checks++, ["data/list.json", "media"]),
      load: async (context) => ({
        types: { pic: { label: "Pic", roles: [{ key: "pic", label: "Pic", kinds: ["image"], many: true }] } },
        assetRoots: ["media"],
        units: ((await context.files.readJson("data/list.json")) as Array<{ id: string }>).map((entry) => ({ id: entry.id, type: "pic", links: Array.from({ length: 20 }, (_, i) => ({ role: "pic", asset: `media/${i}.png` })) }))
      })
    }]
  })
  write(dir, "catalog.config.json", { version: 2, plugins: ["counted"] })
  const app = await open(dir, { plugins: { counted } })
  await app.run("context", {})
  checks = 0
  const files = await Promise.all(Array.from({ length: 20 }, (_, i) => app.assetFile(`media/${i}.png`)))
  assert.equal(files.length, 20)
  assert.ok(checks <= 2, `20 requests at once checked the sources ${checks} times`)
  // Each answer still reflects the files as they were when it was asked for.
  write(dir, "data/list.json", [{ id: "p/1" }, { id: "p/2" }])
  assert.equal((await app.run("catalog.search", {})).total, 2)
  cleanup(dir)
})

test("record scans are incremental: only files that changed are read again", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  const notes: Array<Any> = []
  for (let i = 0; i < 25; i++) notes.push((await run("note.create", { target: unit("armor/helm"), body: `Note ${i}` })).note)
  const list = () => app.run("notes.list", { pageSize: 100 })
  await list()
  assert.equal((await cost(app, list)).parsed, 0, "an action over unchanged records reads no record file")
  // One file edited outside the catalog (a merge, an editor): exactly that file is read.
  const edited = { ...read(dir, `.catalog/notes/${notes[7].id}.json`), body: "Edited elsewhere" }
  write(dir, `.catalog/notes/${notes[7].id}.json`, edited)
  const spent = await cost(app, list)
  assert.deepEqual([spent.parsed, spent.scans], [1, 1])
  assert.ok((await list()).notes.some((n: Any) => n.body === "Edited elsewhere"))
  // The catalog's own write: the one new file, not the other 25.
  const written = await cost(app, () => run("note.create", { target: unit("armor/boots"), body: "One more" }))
  await list()
  assert.ok(written.parsed <= 1, `a write read ${written.parsed} record files`)
  // A second catalog on the same checkout sees the other's records without either rescanning all.
  const other = await open(dir)
  await W(other)("note.create", { target: unit("armor/coat"), body: "From another process" })
  assert.equal((await cost(app, list)).parsed, 1)
  assert.equal((await list()).total, 27)
  cleanup(dir)
})

test("time and ids come from injected services: records are reproducible under a test clock and counting ids", async () => {
  const dir = await standardProject()
  const app = await open(dir, { ids: Ids.layerTest, extra: TestClock.layer() })
  await app.effect(TestClock.setTime(Date.parse("2030-01-02T03:04:05.000Z")))
  const { note } = await W(app)("note.create", { target: unit("armor/helm"), body: "Deterministic" })
  assert.deepEqual([note.id, note.at], ["nt_0001", "2030-01-02T03:04:05.000Z"])
  await app.effect(TestClock.adjust("90 minutes"))
  const edited = (await W(app)("note.edit", { id: note.id, body: "Later" })).note
  assert.deepEqual([edited.editedAt, edited.revision], ["2030-01-02T04:34:05.000Z", 2])
  const submitted = await W(app)("review.submit", { items: [{ target: unit("lore/origin") }] })
  const review = await app.run("review.get", { submission: submitted.submission.id })
  assert.deepEqual([review.id, review.items[0].id, review.at], ["sub_0003", "it_0002", "2030-01-02T04:34:05.000Z"])
  // Verdict order is recorded time, then identity: both are under the test's control.
  await app.effect(TestClock.adjust("1 second"))
  await W(app)("review.decide", { submission: review.id, item: review.items[0].id, whole: "changes" })
  await W(app)("review.decide", { submission: review.id, item: review.items[0].id, whole: "approved" })
  const history = (await app.run("unit.get", { id: "lore/origin" })).history
  assert.deepEqual(history.map((event: Any) => [event.id, event.at, event.verdicts.attributes]), [["vd_0005", "2030-01-02T04:34:06.000Z", "approved"], ["vd_0004", "2030-01-02T04:34:06.000Z", "changes"]])
  assert.equal((await app.run("unit.get", { id: "lore/origin" })).review.summary.state, "approved", "a tie on time is decided by id")
  cleanup(dir)
})
