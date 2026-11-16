// Rules of the plugin contract that came out of reviewing the engine core: a source that cannot
// say what it reads is a problem, never a silently empty catalog; repairs are a write
// (`doctor.fix`), not something a read does; a scope cannot take the name of a page section.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { definePlugin, type SourceOutput } from "../../src/catalog/plugin.ts"
import { agent, cleanup, git, human, open, read, rejects, tmp, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const CLI = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
const AMBIENT = ["CATALOG_ACTOR_KIND", "CATALOG_ACTOR_NAME", "JAM_ROOT", "JAM_JSON"]
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !AMBIENT.includes(key)))

const project = (config: unknown): string => {
  const dir = tmp("cc-contract-")
  git(dir, "init", "-q")
  write(dir, "catalog.config.json", config)
  return dir
}
const scenes = (ids: ReadonlyArray<string>): SourceOutput => ({
  project: "Story",
  types: { scene: { label: "Scene", fields: [], roles: [] } },
  units: ids.map((id) => ({ id, type: "scene", name: id }))
})

test("a source whose inputs() throws is a problem that keeps its last content, never a silent empty list", async () => {
  const dir = project({ version: 2, plugins: ["flaky"] })
  write(dir, "scenes.json", ["opening", "chase"])
  const state = { broken: null as string | null, loads: 0 }
  const flaky = definePlugin({
    name: "flaky",
    sources: [{
      name: "scenes",
      inputs: () => {
        if (state.broken !== null) throw new Error(state.broken)
        return ["scenes.json"]
      },
      load: async ({ files }) => {
        state.loads++
        return scenes((await files.readJson("scenes.json")) as Array<string>)
      }
    }]
  })
  const app = await open(dir, { plugins: { flaky } })
  assert.deepEqual((await app.run("catalog.search", {})).ids.sort(), ["chase", "opening"])
  assert.deepEqual((await app.run("problems", {})).problems, [])
  // inputs() starts to throw: the content that was loaded stays, and the failure is reported.
  state.broken = "index service unreachable"
  write(dir, "scenes.json", ["opening", "chase", "finale"])
  const kept = await app.run("catalog.search", {})
  assert.deepEqual(kept.ids.sort(), ["chase", "opening"], "the last loaded content is shown, not an empty catalog")
  const problems: Array<Any> = (await app.run("problems", {})).problems
  assert.equal(problems.length, 1)
  assert.deepEqual([problems[0].scope, problems[0].source], ["content", "flaky/scenes"])
  assert.match(problems[0].error, /source scenes failed: inputs of source scenes: index service unreachable/)
  assert.match(problems[0].recovery, /last successfully loaded/)
  assert.equal((await app.run("context", {})).problems, 1)
  assert.equal((await app.run("inbox", {})).counts.problems, 1)
  assert.equal((await app.run("doctor", {})).ok, false)
  // It is not loaded over and over while it stays broken the same way.
  const loads = state.loads
  await app.run("catalog.search", {})
  await app.run("context", {})
  assert.equal(state.loads, loads)
  // Fixed: the source is fresh again and the problem is gone.
  state.broken = null
  assert.deepEqual((await app.run("catalog.search", {})).ids.sort(), ["chase", "finale", "opening"])
  assert.deepEqual((await app.run("problems", {})).problems, [])

  // A source that never managed to say what it reads: no content, and one problem saying why.
  state.broken = "no credentials"
  const fresh = await open(dir, { plugins: { flaky } })
  assert.equal((await fresh.run("catalog.search", {})).total, 0)
  const first: Array<Any> = (await fresh.run("problems", {})).problems
  assert.equal(first.length, 1)
  assert.match(first[0].error, /inputs of source scenes: no credentials/)
  // The same for an inputs() that answers with something that is not a list of paths.
  const wrong = definePlugin({ name: "flaky", sources: [{ name: "scenes", inputs: (() => ({ file: "scenes.json" })) as never, load: () => scenes(["x"]) }] })
  const odd = await open(dir, { plugins: { flaky: wrong } })
  assert.equal((await odd.run("catalog.search", {})).total, 0)
  assert.match((await odd.run("problems", {})).problems[0].error, /expected a list of project-relative paths/)
  cleanup(dir)
})

test("doctor.fix is a write: it needs an actor, repeats safely by request id, and checks still cannot write", async () => {
  const dir = project({ version: 2, plugins: ["order"] })
  write(dir, "scenes.json", ["opening", "chase", "finale"])
  write(dir, "order.json", ["opening"])
  const seen: Array<string> = []
  const applied: Array<string> = []
  const order = definePlugin({
    name: "order",
    sources: [{ name: "scenes", inputs: () => ["scenes.json"], load: async ({ files }) => scenes((await files.readJson("scenes.json")) as Array<string>) }],
    checks: [{
      name: "running-order",
      run: async (context) => {
        // Whatever action runs the checks, a check only reads.
        await context.run("note.create", { target: { kind: "unit", id: "opening" }, body: "from a check" }).catch((error: { code: string }) => seen.push(error.code))
        const listed = (await context.files.readJson("order.json")) as Array<string>
        const all = (await context.files.readJson("scenes.json")) as Array<string>
        return all.filter((id) => !listed.includes(id)).map((id) => ({
          subject: id,
          message: `${id} is not in order.json`,
          fix: {
            label: "append it",
            apply: async () => {
              applied.push(id)
              const { writeFile } = await import("node:fs/promises")
              const current = (await context.files.readJson("order.json")) as Array<string>
              await writeFile(join(context.root, "order.json"), JSON.stringify([...current, id]))
            }
          }
        }))
      }
    }]
  })
  const app = await open(dir, { plugins: { order } })
  const check = (report: Any): Any => report.checks.find((c: Any) => c.name === "running-order")
  // The read reports and offers; it changes nothing, however it is asked.
  const report = await app.run("doctor", {})
  assert.deepEqual(check(report).problems.map((p: Any) => [p.subject, p.fixable]), [["chase", true], ["finale", true]])
  assert.deepEqual(report.summary, { problems: 2, info: 0, fixable: 2, fixed: 0 })
  const refused = await rejects(app.run("doctor", { fix: true }), "invalid")
  assert.match(refused.message, /doctor only reads/)
  assert.match(refused.fix, /doctor\.fix/)
  assert.deepEqual([read(dir, "order.json"), applied], [["opening"], []])
  const listed = (await app.discover()).filter((a) => a.name.startsWith("doctor"))
  assert.deepEqual(listed.map((a) => [a.name, a.kind]), [["doctor", "read"], ["doctor.fix", "write"]])
  // The write needs a declared actor.
  assert.match((await rejects(app.run("doctor.fix", {}), "invalid")).message, /declare the actor/)
  assert.deepEqual(applied, [])
  const fixed = await W(app, agent)("doctor.fix", {}, "fix-1")
  assert.deepEqual(read(dir, "order.json"), ["opening", "chase", "finale"])
  assert.deepEqual(fixed.fixed.map((f: Any) => [f.check, f.subject, f.error]), [["running-order", "chase", null], ["running-order", "finale", null]])
  assert.deepEqual([fixed.ok, fixed.summary.fixed, check(fixed).problems], [true, 2, []])
  // The same request again records nothing new and repairs nothing twice.
  write(dir, "order.json", ["opening"])
  const again = await W(app, agent)("doctor.fix", {}, "fix-1")
  assert.equal(again.replayed, true)
  assert.deepEqual(again.fixed, fixed.fixed)
  assert.deepEqual([read(dir, "order.json"), applied], [["opening"], ["chase", "finale"]], "a replay returns the first result and runs no repair")
  // The same id for another actor is refused, as for any write.
  await rejects(W(app, human)("doctor.fix", {}, "fix-1"), "conflict")
  // A new request repairs what is broken now.
  await W(app, human)("doctor.fix", {}, "fix-2")
  assert.deepEqual(read(dir, "order.json"), ["opening", "chase", "finale"])
  assert.ok(seen.length >= 4 && seen.every((code) => code === "forbidden"), "checks could not write from doctor or from doctor.fix")
  assert.equal((await app.run("notes.list", {})).total, 0)

  // The command: `doctor` reads, `doctor --fix` is the write, as the person at the terminal.
  write(dir, "catalog.config.json", { version: 2, plugins: ["./order.mjs"] })
  write(dir, "order.mjs", `import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
export default { name: "order",
  sources: [{ name: "scenes", inputs: () => ["scenes.json"], load: ({ root }) => ({ types: { scene: { label: "Scene" } }, units: JSON.parse(readFileSync(join(root, "scenes.json"), "utf8")).map((id) => ({ id, type: "scene" })) }) }],
  checks: [{ name: "running-order", run: ({ root }) => {
    const file = join(root, "order.json"), listed = JSON.parse(readFileSync(file, "utf8"))
    return JSON.parse(readFileSync(join(root, "scenes.json"), "utf8")).filter((id) => !listed.includes(id)).map((id) => ({ subject: id, message: id + " is not in order.json",
      fix: { label: "append it", apply: () => writeFileSync(file, JSON.stringify([...JSON.parse(readFileSync(file, "utf8")), id])) } }))
  } }] }
`)
  write(dir, "order.json", ["opening", "chase"])
  const cli = (...args: ReadonlyArray<string>) => spawnSync(process.execPath, [CLI, "catalog", ...args, "--root", dir], { encoding: "utf8", env })
  const plain = cli("doctor")
  assert.equal(plain.status, 1, plain.stderr)
  assert.match(plain.stdout, /finale is not in order\.json/)
  assert.match(plain.stdout, /fix: append it \(jam catalog doctor --fix\)/)
  assert.deepEqual(read(dir, "order.json"), ["opening", "chase"])
  const repaired = cli("doctor", "--fix")
  assert.equal(repaired.status, 0, repaired.stderr)
  assert.match(repaired.stdout, /1 fixed|No problems found/)
  assert.deepEqual(read(dir, "order.json"), ["opening", "chase", "finale"])
  assert.equal(JSON.parse(cli("doctor", "--fix", "--json", "--actor-kind", "agent", "--actor-name", "fixer", "--request-id", "cli-fix").stdout).ok, true)
  cleanup(dir)
})

test("a scope is a page section: an id that is one already, or is not a plain slug, is refused and reported", async () => {
  const dir = project({ version: 2, plugins: ["sections"] })
  const sections = definePlugin({
    name: "sections",
    scopes: [
      { id: "reviews", label: "Reviews", description: "Clashes with the reviews page" },
      { id: "Story Beats", label: "Story beats", description: "Not a slug" },
      { id: "story", label: "Story", description: "Scenes, in order" }
    ],
    sources: [{ name: "scenes", inputs: () => [], load: () => scenes(["opening"]) }]
  })
  const app = await open(dir, { plugins: { sections } })
  const schema = await app.run("schema", {})
  assert.deepEqual(schema.scopes, [{ id: "story", label: "Story", description: "Scenes, in order" }])
  assert.deepEqual(schema.unitScopes, { opening: "story" })
  const errors: Array<string> = (await app.run("problems", {})).problems.map((p: Any) => p.error)
  assert.equal(errors.length, 2)
  assert.match(errors[0]!, /scope id "reviews" is a section of the catalog page/)
  assert.match(errors[1]!, /scope id "Story Beats" must be lower-case letters, digits and hyphens/)
  // The unit's page is under its scope.
  assert.equal((await app.run("unit.get", { id: "opening" })).route, "#/story/u/opening")
  cleanup(dir)
})
