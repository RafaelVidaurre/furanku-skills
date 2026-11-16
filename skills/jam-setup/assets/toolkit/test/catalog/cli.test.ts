// The catalog commands (`jam catalog …`) as a person or an agent runs them: a process of their own,
// no browser and no server. T21 is ported from the version 1 engine's http.test.mjs; the tests for
// todo, doctor and unlock are new with these commands.
//
// The rest of the original http.test.mjs is in http.test.ts and server-lifecycle.test.ts:
// - T15/T21 HTTP actions: `GET /api/actions` discovery including the viewer actions, the actor a
//   non-browser client must declare (400), a retried `POST /api/run/note.create` recorded once,
//   the browser's default human actor, and validation errors as 400 with `error.code`.
// - T22 security: host and origin checks, the write header, content type and body limits, path
//   traversal and symlink escapes over `/media/…`, media response headers and ranges, the page's
//   content security policy.
// - Server binds to loopback only; `serve --detach`.
// - From T21 itself: `viewer.capture` in the action list (viewer actions belong to the server).
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { cleanup, standardProject } from "./helpers.ts"

const CLI = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
// The commands read these as defaults; a test run must not inherit them from the machine.
const AMBIENT = ["CATALOG_ACTOR_KIND", "CATALOG_ACTOR_NAME", "JAM_ROOT", "JAM_JSON"]
const cli = (dir: string) => (...args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, [CLI, "catalog", ...args, "--root", dir], {
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !AMBIENT.includes(key)))
  })
const asAgent = ["--actor-kind", "agent", "--actor-name", "cli-bot"]

test("T21 CLI runs the same actions without a browser and the same validation", async () => {
  const dir = await standardProject()
  const run = cli(dir)
  // The action list is text for people by default; --json gives the list a program reads.
  const list: Array<string> = JSON.parse(run("actions", "--json").stdout).actions.map((a: { name: string }) => a.name)
  // Was note.resolve and viewer.capture: viewer actions come with the server package.
  assert.ok(list.includes("note.resolve") && list.includes("review.submit"))
  const search = JSON.parse(run("run", "catalog.search", "--input", '{"q":"helm"}').stdout)
  assert.equal(search.items[0].id, "armor/helm")
  const noActor = run("run", "note.create", "--input", '{"target":{"kind":"unit","id":"armor/helm"},"body":"x"}')
  // Was status 1: invalid input now exits with 2, every other failure with 1.
  assert.equal(noActor.status, 2)
  assert.match(noActor.stderr, /declare the actor/)
  const ok = JSON.parse(run("run", "note.create", ...asAgent, "--request-id", "cli-1", "--input", '{"target":{"kind":"unit","id":"armor/helm"},"body":"From CLI"}').stdout)
  assert.equal(ok.note.by.name, "cli-bot")
  const again = JSON.parse(run("run", "note.create", ...asAgent, "--request-id", "cli-1", "--input", '{"target":{"kind":"unit","id":"armor/helm"},"body":"From CLI"}').stdout)
  assert.equal(again.note.id, ok.note.id)
  // A failure is one JSON object on standard error only with --json; it is `error:` text otherwise.
  const invalid = run("run", "organize.set", ...asAgent, "--json", "--input", '{"target":{"kind":"unit","id":"armor/helm"},"tags":["NOPE NOPE"]}')
  assert.equal(JSON.parse(invalid.stderr).error.code, "invalid")
  cleanup(dir)
})

test("catalog todo lists an open note under its heading", async () => {
  const dir = await standardProject()
  const run = cli(dir)
  const empty = run("todo")
  assert.equal(empty.status, 0, empty.stderr)
  assert.doesNotMatch(empty.stdout, /Open notes/)
  const created = run("run", "note.create", ...asAgent, "--input", '{"target":{"kind":"unit","id":"armor/helm"},"body":"Visor too thin"}')
  assert.equal(created.status, 0, created.stderr)
  const todo = run("todo")
  assert.equal(todo.status, 0, todo.stderr)
  const lines = todo.stdout.split("\n")
  const heading = lines.findIndex((line) => /^Open notes \(1\)$/.test(line))
  assert.notEqual(heading, -1, todo.stdout)
  assert.match(lines[heading + 1] ?? "", /Iron Helm\s+Visor too thin\s+from cli-bot\s+#\/content\/u\/armor%2Fhelm/)
  // The same list for a program.
  const inbox = JSON.parse(run("todo", "--json").stdout)
  assert.equal(inbox.counts.notes, 1)
  assert.equal(inbox.notes[0].body, "Visor too thin")
  cleanup(dir)
})

test("catalog doctor reports on the standard project and exits 0 when nothing needs fixing", async () => {
  const dir = await standardProject()
  const run = cli(dir)
  const doctor = run("doctor")
  assert.equal(doctor.status, 0, doctor.stderr)
  assert.notEqual(doctor.stdout.trim(), "")
  // Lines for information may precede the summary on some machines; nothing is left to fix.
  assert.match(doctor.stdout, /^(No problems found\.|0 to fix, \d+ for information.*)$/m)
  const report = JSON.parse(run("doctor", "--json").stdout)
  assert.equal(report.ok, true)
  assert.equal(report.summary.problems, 0)
  cleanup(dir)
})

test("catalog unlock removes a lock whose owner has exited", async () => {
  const dir = await standardProject()
  const run = cli(dir)
  const { note } = JSON.parse(run("run", "note.create", ...asAgent, "--input", '{"target":{"kind":"unit","id":"armor/helm"},"body":"x"}').stdout)
  // Planted as the version 1 "Locks" test plants it: the lock of this note, held by a process that is gone.
  const locks = join(dir, ".catalog/.local/locks")
  mkdirSync(locks, { recursive: true })
  const name = `note:${note.id}`
  const key = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${createHash("sha256").update(name).digest("hex").slice(0, 10)}`
  const file = join(locks, `${key}.lock`)
  writeFileSync(file, JSON.stringify({ name, pid: 999999, host: hostname(), at: new Date().toISOString() }))
  const listed = JSON.parse(run("run", "locks.list").stdout).locks
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, name)
  assert.equal(listed[0].alive, false)
  const unlocked = run("unlock", name)
  assert.equal(unlocked.status, 0, unlocked.stderr)
  assert.match(unlocked.stdout, new RegExp(`removed lock ${name}`))
  assert.ok(!existsSync(file), "the lock file is gone")
  assert.deepEqual(JSON.parse(run("run", "locks.list").stdout).locks, [])
  // The record it guarded can be written again.
  const edited = run("run", "note.edit", ...asAgent, "--input", JSON.stringify({ id: note.id, body: "y" }))
  assert.equal(edited.status, 0, edited.stderr)
  assert.equal(JSON.parse(edited.stdout).note.body, "y")
  // A lock that does not exist is an error, not a silent success.
  const none = run("unlock", name)
  assert.notEqual(none.status, 0)
  assert.match(none.stderr, /no such lock/)
  cleanup(dir)
})
