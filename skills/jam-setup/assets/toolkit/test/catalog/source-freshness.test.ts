// Ported from the version 1 engine: an open catalog follows the authored files by their bytes.
import assert from "node:assert/strict"
import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
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
