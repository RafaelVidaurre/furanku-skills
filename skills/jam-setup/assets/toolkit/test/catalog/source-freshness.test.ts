// Ported from the version 1 engine: an open catalog follows the authored files by their bytes.
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { concerns } from "../../src/catalog/Changes.ts"
import { definePlugin } from "../../src/catalog/plugin.ts"
import { cleanup, makeProject, open } from "./helpers.ts"

test("one open catalog follows authored bytes even when size and mtime are preserved", async (t) => {
  const root = await makeProject({ units: [{ id: "table", type: "armor", attrs: { armor: 10 } }] })
  t.after(() => cleanup(root))
  const file = join(root, "content/table.json")
  const timestamp = new Date("2020-01-01T00:00:00Z")
  utimesSync(file, timestamp, timestamp)
  const before = statSync(file)
  const app = await open(root)
  assert.equal((await app.run("unit.get", { id: "table" })).unit.attrs.armor, 10)

  const original = readFileSync(file, "utf8")
  writeFileSync(file, original.replace('"armor": 10', '"armor": 20'))
  utimesSync(file, timestamp, timestamp)
  assert.equal(statSync(file).size, before.size)
  assert.equal(statSync(file).mtimeMs, before.mtimeMs)
  assert.equal((await app.run("unit.get", { id: "table" })).unit.attrs.armor, 20)

  rmSync(file)
  assert.equal((await app.run("unit.search", {})).units.length, 0)
  writeFileSync(file, original)
  utimesSync(file, timestamp, timestamp)
  assert.equal((await app.run("unit.get", { id: "table" })).unit.attrs.armor, 10)
})

test("a source that reads the whole project ('.' or '') follows every change there except the catalog's own records", () => {
  for (const root of [".", "", "./"]) {
    const concerned = concerns([root, "work/inventory.json"])
    assert.equal(concerned(new Set(["sprites/hero/walk.tres"])), true, `${JSON.stringify(root)}: a new engine file`)
    assert.equal(concerned(new Set([".catalog/notes/n1.json", ".catalog/reviews/s/submission.json"])), false, `${JSON.stringify(root)}: a note or review written in the catalog`)
    assert.equal(concerned(new Set([".catalog/notes/n1.json", "work/inventory.json"])), true)
  }
  const folder = concerns(["./art"])
  assert.deepEqual([folder(new Set(["art/a.png"])), folder(new Set(["other/a.png"]))], [true, false])
})

test("a source whose input is the whole project as '.' is loaded again when a file anywhere in it changes", async (t) => {
  const root = await makeProject({ units: [{ id: "table", type: "armor", attrs: { armor: 10 } }] })
  t.after(() => cleanup(root))
  let loads = 0
  const whole = definePlugin({
    name: "whole",
    sources: [{ name: "whole", inputs: () => ["."], scans: () => [], load: async ({ files }) => { loads++; return { types: { file: { label: "File" } }, units: (await files.walk("data")).map((path) => ({ id: path, type: "file" })) } } }]
  })
  writeFileSync(join(root, "catalog.config.json"), JSON.stringify({ version: 3, plugins: ["manifest", "whole"] }))
  mkdirSync(join(root, "data"))
  const app = await open(root, { plugins: { whole } })
  assert.equal((await app.run("summary", {})).counts.units, 1)
  writeFileSync(join(root, "data/a.txt"), "a")
  assert.equal((await app.run("summary", {})).counts.units, 2, "a new file anywhere in the project")
  const before = loads
  await app.run("note.create", { target: { kind: "unit", id: "table" }, body: "a note" }, { actor: { name: "t", kind: "agent" }, requestId: "n-1" })
  await app.run("summary", {})
  assert.equal(loads, before, "a note is the catalog's own record, not the source's content")
})
