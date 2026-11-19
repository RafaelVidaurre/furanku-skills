// Rules of the plugin contract that came out of reviewing the engine core: a source that cannot
// say what it reads is a problem, never a silently empty catalog; repairs are a write
// (`doctor.fix`), not something a read does; a scope cannot take the name of a page section.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { defineAction, definePlugin, Schema, type SourceOutput } from "../../catalog-plugin.ts"
import { agent, cleanup, git, human, open, read, rejects, tmp, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const CLI = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
const ENTRY = pathToFileURL(fileURLToPath(new URL("../../catalog-plugin.ts", import.meta.url))).href
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
  const dir = project({ version: 3, plugins: ["flaky"] })
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
  assert.deepEqual((await app.run("unit.search", {})).ids.sort(), ["chase", "opening"])
  assert.deepEqual((await app.run("problems", {})).problems, [])
  // inputs() starts to throw: the content that was loaded stays, and the failure is reported.
  state.broken = "index service unreachable"
  write(dir, "scenes.json", ["opening", "chase", "finale"])
  const kept = await app.run("unit.search", {})
  assert.deepEqual(kept.ids.sort(), ["chase", "opening"], "the last loaded content is shown, not an empty catalog")
  const problems: Array<Any> = (await app.run("problems", {})).problems
  assert.equal(problems.length, 1)
  assert.deepEqual([problems[0].origin, problems[0].subject], ["sources", "flaky/scenes"])
  assert.match(problems[0].error, /source scenes failed: inputs of source scenes: index service unreachable/)
  assert.match(problems[0].recovery, /last successfully loaded/)
  assert.equal((await app.run("summary", {})).problems, 1)
  assert.equal((await app.run("inbox", {})).counts.problems, 1)
  assert.equal((await app.run("doctor", {})).ok, false)
  // It is not loaded over and over while it stays broken the same way.
  const loads = state.loads
  await app.run("unit.search", {})
  await app.run("summary", {})
  assert.equal(state.loads, loads)
  // Fixed: the source is fresh again and the problem is gone.
  state.broken = null
  assert.deepEqual((await app.run("unit.search", {})).ids.sort(), ["chase", "finale", "opening"])
  assert.deepEqual((await app.run("problems", {})).problems, [])

  // A source that never managed to say what it reads: no content, and one problem saying why.
  state.broken = "no credentials"
  const fresh = await open(dir, { plugins: { flaky } })
  assert.equal((await fresh.run("unit.search", {})).total, 0)
  const first: Array<Any> = (await fresh.run("problems", {})).problems
  assert.equal(first.length, 1)
  assert.match(first[0].error, /inputs of source scenes: no credentials/)
  // The same for an inputs() that answers with something that is not a list of paths.
  const wrong = definePlugin({ name: "flaky", sources: [{ name: "scenes", inputs: (() => ({ file: "scenes.json" })) as never, load: () => scenes(["x"]) }] })
  const odd = await open(dir, { plugins: { flaky: wrong } })
  assert.equal((await odd.run("unit.search", {})).total, 0)
  assert.match((await odd.run("problems", {})).problems[0].error, /expected a list of project-relative paths/)
  cleanup(dir)
})

test("doctor.fix is a write: it needs an actor, repeats safely by request id, and checks still cannot write", async () => {
  const dir = project({ version: 3, plugins: ["order"] })
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
  assert.deepEqual(listed.map((a) => [a.name, a.access]), [["doctor", "read"], ["doctor.fix", "write"]])
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
  assert.equal((await app.run("note.list", {})).total, 0)

  // The command: `doctor` reads, `doctor --fix` is the write, as the person at the terminal.
  write(dir, "catalog.config.json", { version: 3, plugins: ["./order.mjs"] })
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
  const dir = project({ version: 3, plugins: ["sections"] })
  const sections = definePlugin({
    name: "sections",
    scopes: [
      { id: "organization", label: "Organization", description: "Clashes with the organization page" },
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
  assert.match(errors[0]!, /scope id "organization" is a section of the catalog page/)
  assert.match(errors[1]!, /scope id "Story Beats" must be lower-case letters, digits and hyphens/)
  // The unit's page is under its scope.
  assert.equal((await app.run("unit.get", { id: "opening" })).route, "#/story/u/opening")
  cleanup(dir)
})

test("an action name from before the renames is not found, and its fix names the action that replaced it", async () => {
  const dir = project({ version: 3, plugins: ["story"] })
  const story = definePlugin({ name: "story", sources: [{ name: "scenes", inputs: () => [], load: () => scenes(["opening"]) }] })
  const app = await open(dir, { plugins: { story } })
  const renamed: ReadonlyArray<readonly [string, string]> = [
    ["context", "summary"],
    ["catalog.search", "unit.search, collection.search or asset.search"],
    ["notes.list", "note.list"],
    ["reviews.list", "review.list"],
    ["locks.list", "lock.list"],
    ["unlock", "lock.remove"],
    ["collections.membership", "collection.membership"],
    ["organize.set", "organization.set"],
    ["organize.bulk", "organization.setMany"]
  ]
  for (const [old, now] of renamed) {
    const error = await rejects(app.run(old, {}, { actor: human }), "not_found")
    assert.equal(error.fix, `${old} is now ${now}`, old)
  }
  assert.equal((await rejects(app.run("no.such", {}), "not_found")).fix, "list the actions with: jam catalog actions")
  assert.equal((await app.run("summary", {})).counts.units, 1)
  cleanup(dir)
})

test("plugin actions are named <plugin>.<operation>: a reserved plugin name is refused, an unprefixed name runs and is reported", async () => {
  const dir = project({ version: 3, plugins: ["note", "story"] })
  const echo = (name: string) => defineAction({ name, access: "read", description: `Echo ${name}`, input: Schema.Struct({}), run: () => ({ ran: name }) })
  // A plugin named like the catalog's own namespace would pass for a built-in.
  const note = definePlugin({ name: "note", actions: [echo("note.archive")] })
  const story = definePlugin({
    name: "story",
    sources: [{ name: "scenes", inputs: () => [], load: () => scenes(["opening"]) }],
    actions: [echo("story.outline"), echo("outline")]
  })
  const app = await open(dir, { plugins: { note, story } })
  await rejects(app.run("note.archive", {}), "not_found")
  assert.deepEqual(await app.run("story.outline", {}), { ran: "story.outline" })
  assert.deepEqual(await app.run("outline", {}), { ran: "outline" }, "an unprefixed action still runs")
  const errors: Array<string> = (await app.run("problems", {})).problems.map((p: Any) => p.error)
  assert.deepEqual(errors, [
    'plugin note: action note.archive is refused because "note" is a name the catalog reserves for its own actions',
    "plugin story: action outline should be named story.outline"
  ])
  const listed = (await app.discover()).filter((action) => action.plugin !== undefined).map((action) => [action.name, action.plugin, action.access, action.requires])
  assert.deepEqual(listed, [["story.outline", "story", "read", []], ["outline", "story", "read", []]])
  cleanup(dir)
})

test("a project plugin imports the stable entry catalog-plugin.ts and loads", async () => {
  const dir = project({ version: 3, plugins: ["./catalog/story.ts"] })
  // What a project writes as `import … from "../tools/jam/catalog-plugin.ts"`; here the toolkit is not beside it.
  write(dir, "catalog/story.ts", `import { defineAction, definePlugin, defineSource, defineType, Schema } from ${JSON.stringify(ENTRY)}
export default definePlugin({
  name: "story",
  sources: [defineSource({ name: "scenes", inputs: () => [], load: () => ({ types: { scene: defineType({ label: "Scene" }) }, units: [{ id: "opening", type: "scene" }] }) })],
  actions: [defineAction({ name: "story.count", access: "read", description: "Scenes", input: Schema.Struct({}), output: Schema.Struct({ scenes: Schema.Number }),
    run: async (_input, { run }) => ({ scenes: (await run("unit.search", {})).total }) })]
})
`)
  const app = await open(dir)
  assert.deepEqual([(await app.run("summary", {})).counts.units, (await app.run("problems", {})).problems], [1, []])
  assert.deepEqual(await app.run("story.count", {}), { scenes: 1 })
  cleanup(dir)
})

test("an action's context follows its access: a read gets no actor, a write gets the declared one; a declared output is published and checked", async () => {
  const dir = project({ version: 3, plugins: ["story"] })
  const seen: Array<readonly [string, unknown]> = []
  const story = definePlugin({
    name: "story",
    sources: [{ name: "scenes", inputs: () => [], load: () => scenes(["opening"]) }],
    actions: [
      defineAction({ name: "story.peek", access: "read", description: "What a read receives", input: Schema.Struct({}), output: Schema.Struct({ keys: Schema.Array(Schema.String) }),
        run: (_input, context) => {
          seen.push(["read", "actor" in context])
          return { keys: Object.keys(context).sort() }
        } }),
      defineAction({ name: "story.mark", access: "write", description: "What a write receives", input: Schema.Struct({}), output: Schema.Struct({ by: Schema.String }),
        // Typed: a write's actor is never null.
        run: (_input, context) => ({ by: `${context.actor.kind}:${context.actor.name}` }) }),
      defineAction({ name: "story.wrong", access: "read", description: "Returns what its output does not allow", input: Schema.Struct({}), output: Schema.Struct({ n: Schema.Number }),
        run: () => ({ n: "one" } as never) })
    ]
  })
  const app = await open(dir, { plugins: { story } })
  assert.deepEqual(await app.run("story.peek", {}), { keys: ["files", "options", "root", "run"] })
  assert.deepEqual(seen, [["read", false]])
  assert.deepEqual(await W(app, agent)("story.mark", {}, "mark-1"), { by: "agent:checker" })
  assert.deepEqual(await W(app, agent)("story.mark", {}, "mark-1"), { by: "agent:checker", replayed: true }, "a replayed write still matches its published output")
  // The tests decode every result against its output: a mismatch fails internal.
  assert.match((await rejects(app.run("story.wrong", {}), "internal")).message, /result of story\.wrong/)
  const listed = Object.fromEntries((await app.discover()).filter((action) => action.plugin === "story").map((action) => [action.name, action]))
  assert.deepEqual(Object.keys((listed["story.peek"]!.output as Any).properties), ["keys"])
  assert.deepEqual(Object.keys((listed["story.mark"]!.output as Any).properties), ["by", "replayed"])
  cleanup(dir)
})

test("a replayed write whose output is a union of objects still matches its published output; a write whose output is no object is refused", async () => {
  const dir = project({ version: 3, plugins: ["story"] })
  const story = definePlugin({
    name: "story",
    sources: [{ name: "scenes", inputs: () => [], load: () => scenes(["opening"]) }],
    actions: [
      defineAction({
        name: "story.pick",
        access: "write",
        description: "Picks a scene, or says none fits",
        input: Schema.Struct({ id: Schema.String }),
        output: Schema.Union([Schema.Struct({ picked: Schema.String }), Schema.Struct({ none: Schema.Literal(true) })]),
        run: (input) => (input.id === "opening" ? { picked: input.id } : { none: true as const })
      }),
      defineAction({ name: "story.count", access: "write", description: "A bare number", input: Schema.Struct({}), output: Schema.Number, run: () => 1 })
    ]
  })
  const app = await open(dir, { plugins: { story } })
  assert.deepEqual(await W(app, agent)("story.pick", { id: "opening" }, "pick-1"), { picked: "opening" })
  assert.deepEqual(await W(app, agent)("story.pick", { id: "opening" }, "pick-1"), { picked: "opening", replayed: true })
  assert.deepEqual(await W(app, agent)("story.pick", { id: "nope" }, "pick-2"), { none: true })
  assert.deepEqual(await W(app, agent)("story.pick", { id: "nope" }, "pick-2"), { none: true, replayed: true })
  const published = (await app.discover()).find((action) => action.name === "story.pick")!.output as Any
  assert.deepEqual(published.anyOf.map((member: Any) => Object.keys(member.properties)), [["picked", "replayed"], ["none", "replayed"]])
  await rejects(app.run("story.count", {}, { actor: agent }), "not_found")
  assert.deepEqual((await app.run("problems", {})).problems.map((p: Any) => [p.error, p.recovery]), [[
    "plugin story: action story.count is a write whose output is not an object or a union of objects",
    "declare its output as a Schema.Struct, or a Schema.Union of them: a replayed write adds replayed: true to its result"
  ]])
  cleanup(dir)
})

test("a browser module name declared by two plugins is a problem, and the first declaration wins", async () => {
  const dir = project({ version: 3, plugins: ["story", "other"] })
  write(dir, "catalog/first.js", "export function mount() { return { dispose() {} } }\n")
  write(dir, "catalog/second.js", "export function mount() { return { dispose() {} } }\n// second\n")
  const story = definePlugin({ name: "story", sources: [{ name: "scenes", inputs: () => [], load: () => scenes(["opening"]) }], browserModules: { kit: "catalog/first.js" } })
  const other = definePlugin({ name: "other", browserModules: { kit: "catalog/second.js", own: "catalog/second.js" } })
  const app = await open(dir, { plugins: { story, other } })
  assert.deepEqual((await app.run("problems", {})).problems.map((p: Any) => [p.subject, p.error, p.recovery]), [
    ["catalog.config.json", "plugin other: browser module kit is already registered by story", "rename it or remove one of the plugins"]
  ])
  assert.deepEqual(Object.keys((await app.run("schema", {})).browserModules).sort(), ["kit", "own"])
  assert.equal((await app.browserModule("kit")).file, join(dir, "catalog/first.js"))
  cleanup(dir)
})

test("a plugin on the earlier contract fails to load, naming the field: views, previews, an action's kind", async () => {
  const dir = project({ version: 3, plugins: ["story"] })
  const story = definePlugin({ name: "story", sources: [{ name: "scenes", inputs: () => [], load: () => scenes(["opening"]) }] })
  const old = (extra: Record<string, unknown>) => ({ name: "old", sources: [{ name: "scenes", inputs: () => [], load: () => scenes(["chase"]) }], ...extra }) as never
  const plugins = {
    story,
    views: old({ views: { kit: "catalog/kit.js" } }),
    previews: old({ previews: { lineup: "catalog/lineup.mjs" } }),
    kind: old({ actions: [{ name: "old.run", kind: "read", description: "x", input: Schema.Struct({}), run: () => ({}) }] })
  }
  const app = await open(dir, { plugins })
  assert.equal((await app.run("summary", {})).counts.units, 1)
  const expected = {
    views: [/plugin old: views is no longer read; it was renamed browserModules/, /browserModules/],
    previews: [/plugin old: previews is no longer read; it was renamed browserModules/, /browserModules/],
    kind: [/plugin old: action old\.run: kind is no longer read; it was renamed access/, /access: "read" or "write"/]
  } as const
  for (const [entry, [error, recovery]] of Object.entries(expected)) {
    // Listed after a good load, the old plugin is a problem and the previous plugins stay in use.
    write(dir, "catalog.config.json", { version: 3, plugins: ["story", entry] })
    const problems: Array<Any> = (await app.run("problems", {})).problems
    assert.match(problems[0].error, error, entry)
    assert.equal((await app.run("summary", {})).counts.units, 1, "the last good plugins stay in use")
    // A catalog with no good plugins yet fails with the same error and its fix.
    const fresh = await rejects((await open(dir, { plugins })).run("summary", {}), "invalid")
    assert.match(fresh.message, error)
    assert.match(fresh.fix, recovery)
    write(dir, "catalog.config.json", { version: 3, plugins: ["story"] })
  }
  cleanup(dir)
})
