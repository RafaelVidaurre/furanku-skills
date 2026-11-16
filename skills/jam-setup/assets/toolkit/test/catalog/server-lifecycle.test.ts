// One catalog server per checkout, kept between commands: `jam catalog open`, `status`, `stop`,
// and the links that action results carry while it runs. Every command here is a real process, as
// an agent session runs it; the server it starts is a real detached process that outlives the
// command. (`open` replaces the version 1 `serve --detach`; its test in http.test.mjs is the
// first one here.)
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { cleanup, open, standardProject, W } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const CLI = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
const AMBIENT = ["CATALOG_ACTOR_KIND", "CATALOG_ACTOR_NAME", "JAM_ROOT", "JAM_JSON"]
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !AMBIENT.includes(key)))
const cli = (dir: string) => (...args: ReadonlyArray<string>) => spawnSync(process.execPath, [CLI, "catalog", ...args, "--root", dir], { encoding: "utf8", env, timeout: 120_000 })
const asAgent = ["--actor-kind", "agent", "--actor-name", "cli-bot"]
const stateFile = (dir: string): string => join(dir, ".catalog/.local/server.json")
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const gone = async (pid: number): Promise<boolean> => {
  for (let i = 0; i < 100 && alive(pid); i++) await new Promise((done) => setTimeout(done, 100))
  return !alive(pid)
}

// Whatever a failing test leaves running is ended with the file.
const started = new Set<number>()
after(() => {
  for (const pid of started) if (alive(pid)) process.kill(pid, "SIGKILL")
})
const opened = (dir: string): Any => {
  const result = cli(dir)("open", "--json")
  assert.equal(result.status, 0, result.stderr)
  const answer = JSON.parse(result.stdout)
  started.add(answer.pid)
  return answer
}

test("open starts a server that outlives the command, reuses it, links results to it, and stop ends it", async () => {
  const dir = await standardProject()
  const run = cli(dir)
  try {
    const before = JSON.parse(run("status", "--json").stdout)
    assert.deepEqual([before.running, before.url], [false, null])
    assert.match(run("status").stdout, /not running\. Start it with: jam catalog open/)
    // Without a server a result names the page by its route and says how to get a link.
    const early = JSON.parse(run("run", "review.submit", ...asAgent, "--input", JSON.stringify({ title: "Helm pass", items: [{ target: { kind: "unit", id: "armor/helm" } }] })).stdout)
    assert.equal(early.submission.route, `#/reviews/s/${early.submission.id}`)
    assert.equal(early.submission.url, undefined)
    assert.match(early.hint, /jam catalog open/)

    // spawnSync returning at all shows the server holds none of the command's output pipes.
    const first = run("open")
    assert.equal(first.status, 0, first.stderr)
    const url = first.stdout.trim()
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/, "the address is the whole of standard output")
    assert.match(first.stderr, /started the catalog server \(process \d+\); it keeps running/)
    const record = JSON.parse(readFileSync(stateFile(dir), "utf8"))
    started.add(record.pid)
    assert.deepEqual(Object.keys(record).sort(), ["checkout", "host", "pid", "port", "startedAt", "toolkit", "url"])
    assert.deepEqual([record.url, record.port, record.host], [url, Number(new URL(url).port), hostname()])
    assert.ok(record.port >= 4600, "ports are taken from 4600 up")
    assert.equal(record.toolkit, JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version)
    assert.equal(record.checkout, (await (await open(dir)).run("context", {})).context.worktree)
    assert.ok(alive(record.pid) && record.pid !== process.pid)
    assert.equal((await fetch(url)).status, 200)
    const health = (await (await fetch(`${url}api/health`)).json()) as Any
    assert.deepEqual([health.pid, health.root], [record.pid, dir])
    // The record is machine-local state: Git never sees it.
    assert.equal(spawnSync("git", ["status", "--porcelain", "--", ".catalog/.local"], { cwd: dir, encoding: "utf8" }).stdout, "")

    // A second open finds the same server.
    const again = opened(dir)
    assert.deepEqual([again.url, again.pid, again.started, again.running], [url, record.pid, false, true])
    const status = JSON.parse(run("status", "--json").stdout)
    assert.deepEqual([status.running, status.url, status.pid, status.current], [true, url, record.pid, true])
    assert.match(run("status").stdout, new RegExp(`running at ${url.replace(/[/.]/g, "\\$&")} \\(process ${record.pid}`))

    // While it runs, every result that creates or names a review or a page carries its link.
    const submitted = JSON.parse(run("run", "review.submit", ...asAgent, "--input", JSON.stringify({ title: "Boots pass", items: [{ target: { kind: "unit", id: "armor/boots" } }] })).stdout)
    assert.equal(submitted.submission.url, `${url}#/reviews/s/${submitted.submission.id}`)
    assert.equal(submitted.hint, undefined)
    const review = JSON.parse(run("run", "review.get", "--input", JSON.stringify({ submission: submitted.submission.id })).stdout)
    assert.equal(review.url, submitted.submission.url)
    const decided = JSON.parse(run("run", "review.decide", ...asAgent, "--input", JSON.stringify({ submission: review.id, item: review.items[0].id, verdicts: { icon: "approved" } })).stdout)
    assert.equal(decided.url, `${url}#/reviews/s/${review.id}/${review.items[0].id}`)
    const listed = JSON.parse(run("run", "reviews.list").stdout)
    assert.deepEqual(listed.items.map((s: Any) => s.url).sort(), [early.submission.id, submitted.submission.id].map((id) => `${url}#/reviews/s/${id}`).sort())
    JSON.parse(run("run", "note.create", ...asAgent, "--input", JSON.stringify({ target: { kind: "unit", id: "armor/helm", part: "model" }, body: "Visor" })).stdout)
    const inbox = JSON.parse(run("todo", "--json").stdout)
    assert.deepEqual(inbox.waiting.map((w: Any) => w.url).sort(), listed.items.map((s: Any) => s.url).sort())
    assert.equal(inbox.notes[0].url, `${url}#/content/u/armor%2Fhelm`)
    assert.equal(JSON.parse(run("run", "unit.get", "--input", '{"id":"armor/helm"}').stdout).url, `${url}#/content/u/armor%2Fhelm`)
    assert.equal(JSON.parse(run("run", "collection.get", "--input", '{"id":"outfit/iron"}').stdout).url, `${url}#/collections/c/outfit%2Firon`)
    assert.equal(JSON.parse(run("run", "asset.get", "--input", '{"id":"art/helm.png"}').stdout).url, `${url}#/files/a/art%2Fhelm.png`)
    // The links open: the page is served at that address.
    assert.equal((await fetch(submitted.submission.url)).status, 200)
    // Any action can be sent to a server by its address; it answers as the CLI does in-process.
    const remote = JSON.parse(run("run", "notes.list", "--url", url).stdout)
    assert.equal(remote.total, 1)

    const stopped = run("stop")
    assert.equal(stopped.status, 0, stopped.stderr)
    assert.match(stopped.stdout, new RegExp(`stopped the catalog server at .* \\(process ${record.pid}\\)`))
    assert.ok(await gone(record.pid), "the server process has exited")
    assert.ok(!existsSync(stateFile(dir)), "its record is gone")
    await assert.rejects(fetch(url))
    assert.match(run("stop").stdout, /nothing to stop: no catalog server is recorded/)
    // Back to routes and the hint.
    const after = JSON.parse(run("run", "review.get", "--input", JSON.stringify({ submission: submitted.submission.id })).stdout)
    assert.deepEqual([after.route, after.url], [`#/reviews/s/${submitted.submission.id}`, undefined])
    assert.match(after.hint, /jam catalog open/)
  } finally {
    run("stop")
    cleanup(dir)
  }
})

test("a stale or foreign record is replaced without touching the process it names; an older toolkit's server is replaced", async () => {
  const dir = await standardProject()
  const run = cli(dir)
  try {
    const first = opened(dir)
    const record = JSON.parse(readFileSync(stateFile(dir), "utf8"))
    assert.equal(run("stop").status, 0)
    assert.ok(await gone(first.pid))

    // A record whose process has exited (a crash, a reboot): reported as gone, replaced by open.
    writeFileSync(stateFile(dir), JSON.stringify(record))
    const dead = JSON.parse(run("status", "--json").stdout)
    assert.equal(dead.running, false)
    assert.match(dead.reason, /has exited/)
    assert.match(run("status").stdout, /not running: the recorded server .* is gone/)
    // Results do not link to a server that is gone.
    assert.equal(JSON.parse(run("run", "unit.get", "--input", '{"id":"armor/helm"}').stdout).url, undefined)
    const second = opened(dir)
    assert.deepEqual([second.started, second.running], [true, true])
    assert.notEqual(second.pid, first.pid)
    assert.equal((await fetch(second.url)).status, 200)

    // A record that names a live process which is not this checkout's server (a reused process
    // id): this test's own process. Neither stop nor open may end it.
    assert.equal(run("stop").status, 0)
    assert.ok(await gone(second.pid))
    writeFileSync(stateFile(dir), JSON.stringify({ ...record, pid: process.pid }))
    const foreign = JSON.parse(run("status", "--json").stdout)
    assert.equal(foreign.running, false)
    assert.match(foreign.reason, /nothing answers|another server/)
    const refused = run("stop")
    assert.match(refused.stdout, /nothing to stop/)
    assert.ok(!existsSync(stateFile(dir)), "the record that proved nothing is removed")
    writeFileSync(stateFile(dir), JSON.stringify({ ...record, pid: process.pid }))
    const third = opened(dir)
    assert.equal(third.started, true)
    assert.notEqual(third.pid, process.pid)
    assert.ok(alive(process.pid), "the unrelated process was left alone")

    // The running server was started by another toolkit version: open replaces it.
    writeFileSync(stateFile(dir), JSON.stringify({ ...JSON.parse(readFileSync(stateFile(dir), "utf8")), toolkit: "0.0.1" }))
    const outdated = JSON.parse(run("status", "--json").stdout)
    assert.deepEqual([outdated.running, outdated.current], [true, false])
    const fourth = opened(dir)
    assert.equal(fourth.started, true)
    assert.notEqual(fourth.pid, third.pid)
    assert.ok(await gone(third.pid), "the older server was stopped")
    assert.equal(JSON.parse(readFileSync(stateFile(dir), "utf8")).pid, fourth.pid)
  } finally {
    run("stop")
    cleanup(dir)
  }
})

test("a taken port: a second checkout's server takes the next free one, and an explicit taken port is an error", async () => {
  const one = await standardProject()
  const two = await standardProject()
  try {
    const first = opened(one)
    const second = opened(two)
    assert.ok(first.port >= 4600 && second.port >= 4600)
    assert.notEqual(second.port, first.port)
    assert.notEqual(second.pid, first.pid)
    // Each server is its own checkout's.
    assert.equal(((await (await fetch(`${first.url}api/health`)).json()) as Any).root, one)
    assert.equal(((await (await fetch(`${second.url}api/health`)).json()) as Any).root, two)
    // Asking for a port that is taken fails with the reason, and leaves the running server alone.
    const taken = cli(two)("serve", "--port", String(first.port), "--json")
    assert.equal(taken.status, 1)
    const error = JSON.parse(taken.stderr).error
    assert.equal(error.code, "unavailable")
    assert.match(error.message, /EADDRINUSE/)
    assert.equal(JSON.parse(cli(two)("status", "--json").stdout).pid, second.pid)
    assert.equal(cli(two)("serve", "--port", "nope").status, 2)
  } finally {
    cli(one)("stop")
    cli(two)("stop")
    cleanup(one, two)
  }
})

test("serve runs in the foreground, records itself, and closes in order when asked to stop", { skip: process.platform === "win32" ? "Windows has no stop signal a process can answer" : false }, async () => {
  const dir = await standardProject()
  const child = spawn(process.execPath, [CLI, "catalog", "serve", "--port", "0", "--root", dir], { env, stdio: ["ignore", "pipe", "pipe"] })
  started.add(child.pid!)
  try {
    let out = ""
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString() })
    const url = await new Promise<string>((found, failed) => {
      const timer = setTimeout(() => failed(new Error(`serve did not announce itself: ${out}`)), 60_000)
      child.stdout.on("data", () => {
        const match = /^Catalog for .+ \(main\) at (http:\/\/127\.0\.0\.1:\d+\/)$/m.exec(out)
        if (match) {
          clearTimeout(timer)
          found(match[1]!)
        }
      })
      child.once("exit", (code) => failed(new Error(`serve exited with ${code}: ${out}`)))
    })
    assert.equal((await fetch(url)).status, 200)
    // The foreground server is this checkout's server: open finds it instead of starting another.
    const found = opened(dir)
    assert.deepEqual([found.url, found.pid, found.started], [url, child.pid, false])
    const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)))
    child.kill("SIGTERM")
    await exited
    assert.ok(!existsSync(stateFile(dir)), "its record was removed on the way out")
    await assert.rejects(fetch(url))
  } finally {
    child.kill("SIGKILL")
    cleanup(dir)
  }
})

test("viewer actions are listed everywhere and need a server to run", async () => {
  const dir = await standardProject()
  const run = cli(dir)
  // From T21: the action list a program reads includes the viewer actions.
  const list: Array<Any> = JSON.parse(run("actions", "--json").stdout).actions
  assert.ok(list.some((a) => a.name === "note.resolve") && list.some((a) => a.name === "viewer.capture"))
  assert.deepEqual(list.filter((a) => a.kind === "viewer").map((a) => a.name), ["viewer.open", "viewer.state", "viewer.control", "viewer.capture", "viewer.close"])
  assert.match(run("actions").stdout, /^viewer\.open\s+viewer\s+Open a unit/m)
  // Without a server there is no page to drive: the failure says how to get one.
  const none = run("run", "viewer.state", "--json")
  assert.equal(none.status, 1)
  const error = JSON.parse(none.stderr).error
  assert.equal(error.code, "unavailable")
  assert.match(error.fix, /jam catalog open/)
  // In-process the engine does not know them at all.
  await assert.rejects((await open(dir)).run("viewer.state", {}), /unknown action viewer\.state/)
  try {
    const server = opened(dir)
    // With a server: validated by the server before any browser is started.
    const invalid = run("run", "viewer.open", "--json", "--input", '{"target":{"kind":"planet","id":"x"}}')
    assert.equal(invalid.status, 2)
    assert.equal(JSON.parse(invalid.stderr).error.code, "invalid")
    const unopened = run("run", "viewer.state", "--json")
    assert.equal(JSON.parse(unopened.stderr).error.code, "not_found")
    assert.match(JSON.parse(unopened.stderr).error.message, /call viewer\.open first/)
    assert.deepEqual(JSON.parse(run("run", "viewer.close").stdout), { closed: "default" })
    // An agent's write through the server is attributed as declared, like any other client's.
    const note = JSON.parse(run("run", "note.create", "--url", server.url, ...asAgent, "--input", '{"target":{"kind":"unit","id":"armor/helm"},"body":"Through the server"}').stdout)
    assert.deepEqual([note.note.by.name, note.note.by.kind], ["cli-bot", "agent"])
    assert.equal((await W(await open(dir))("notes.list", {})).total, 1)
  } finally {
    run("stop")
    cleanup(dir)
  }
})

test("capture and example refuse what they cannot do before a server or a browser is started", async () => {
  const dir = await standardProject()
  const run = cli(dir)
  const refused = (...args: ReadonlyArray<string>): Any => {
    const result = run(...args, "--json")
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`)
    assert.equal(result.stdout, "")
    return JSON.parse(result.stderr).error
  }
  assert.match(refused("capture", "--target", "armor/helm").message, /--target must be unit:<id>, collection:<id>, asset:<id> or submission:<id>\/<item>/)
  assert.match(refused("capture", "--target", "unit:armor/helm", "--size", "big").message, /--size must be <width>x<height>/)
  assert.match(refused("capture", "--target", "unit:armor/helm", "--camera", "{nope").message, /--camera is not valid JSON/)
  const both = refused("capture", "--target", "unit:armor/helm", "--url", "http://127.0.0.1:1/", "--out", join(dir, "x.png"))
  assert.match(both.message, /--out needs a local capture/)
  // Through a server that is not there: the failure says so and how to get one.
  const nowhere = run("capture", "--target", "unit:armor/helm", "--url", "http://127.0.0.1:1/", "--json")
  assert.equal(nowhere.status, 1)
  assert.deepEqual([JSON.parse(nowhere.stderr).error.code, /jam catalog open/.test(JSON.parse(nowhere.stderr).error.fix)], ["unavailable", true])
  // The sample is only ever written into an empty folder.
  const taken = refused("example", dir)
  assert.match(taken.message, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout, "", "nothing was written")
  cleanup(dir)
})
