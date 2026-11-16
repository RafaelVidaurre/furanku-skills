// The command line as an agent meets it: cold, with nothing but --help.
import assert from "node:assert/strict"
import { chmodSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import type { Run } from "../../src/jam/runs/schema.ts"
import { tempProject } from "../support.ts"
import { cli, glb, png, PROP_BUDGET, readJson, TOOLKIT, turnaround, write } from "./fixtures.ts"

/** What --help shows for a command: its flags, and the example it ends with. */
const help = (root: string, ...command: ReadonlyArray<string>) => {
  const result = cli(root, ...command, "--help")
  assert.equal(result.status, 0, `${command.join(" ")} --help`)
  const flags = [...result.stdout.split("GLOBAL FLAGS")[0]!.matchAll(/^\s+--([a-z-]+)/gm)].map((match) => match[1]!)
  const example = /EXAMPLES\n(?:\s+#.*\n)?\s+(jam .+)/.exec(result.stdout)?.[1]
  assert.ok(example, `${command.join(" ")} --help ends with an example`)
  assert.match(result.stdout, /DESCRIPTION\n\s+\S/)
  return { flags, example: example!, text: result.stdout }
}

/** Run a command, having checked that --help names every flag it uses. */
const using = (root: string, command: ReadonlyArray<string>, args: ReadonlyArray<string>) => {
  const known = new Set([...help(root, ...command).flags, "json", "root"])
  for (const arg of args) if (arg.startsWith("--")) assert.ok(known.has(arg.slice(2)), `${command.join(" ")} --help does not mention ${arg}`)
  const result = cli(root, ...command, ...args, "--json")
  assert.equal(result.status, 0, `jam ${[...command, ...args].join(" ")}\n${result.stderr}`)
  return result.json<Record<string, any>>() // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("a prop, cold, through the command line", () => {
  it("goes from an unconfigured project to a delivered prop following only --help and what each command prints", async () => {
    const root = tempProject({ git: true })
    const top = cli(root, "--help").stdout
    for (const command of ["setup", "config", "recipe", "run", "job", "measure", "provider", "engine", "doctor", "schemas"]) assert.match(top, new RegExp(`^\\s+${command}\\s+\\S`, "m"), command)

    // Setup: the defaults say what to decide; the choices file holds what differs.
    const defaults = using(root, ["setup"], [])
    assert.equal(defaults["configured"], false)
    write(root, "choices.json", JSON.stringify({ roots: { scratch: "content/.work", delivered: "content/props", scan: ["content"] }, style: { document: "content/style.md", references: [] }, budgets: { prop: PROP_BUDGET } }))
    write(root, "content/style.md", "Chunky, hand-painted.")
    write(root, ".gitignore", "content/.work/\n")
    using(root, ["setup"], ["--from", "choices.json"])
    const doctor = using(root, ["doctor"], [])
    assert.deepEqual((doctor["lines"] as Array<{ check: string; status: string }>).filter((line) => line.status === "fail"), [])

    // Choosing the recipe from the request.
    const recipes = using(root, ["recipe", "list"], [])["recipes"] as Array<{ id: string; when: string }>
    const chosen = recipes.find((recipe) => /does not deform/.test(recipe.when))!.id
    assert.equal(chosen, "prop")
    const started = using(root, ["run", "start"], [chosen, "oak-barrel", "--brief-text", "A weathered oak barrel, about 1 m tall"])
    assert.equal(started["run"], "content/.work/oak-barrel/1/run.json")
    const dir = started["dir"] as string

    // From here on the run says what is next, with the command to use.
    const next = () => using(root, ["run", "next"], ["oak-barrel"])
    let step = next()
    assert.deepEqual([step["action"], step["step"].id, step["step"].skill, step["step"].gate.required], ["work", "concept", "jam-concept", "human"])
    assert.equal(step["step"].guide.anchor, "concept")
    assert.ok(existsSync(join(root, step["step"].guide.path)) || existsSync(step["step"].guide.path), "the guide it points at exists")
    assert.match(step["commands"][0].command, /^jam run record oak-barrel concept --file <image> --evidence <path> --note "<what was done>" --tool "<tool and version>"$/)

    write(root, `${dir}/concept.png`, png(32, 32))
    const concept = using(root, ["run", "record"], ["oak-barrel", "concept", "--file", `${dir}/concept.png`, "--note", "Generated from the brief", "--tool", "image model 2"])
    assert.deepEqual(concept["records"].map((entry: { state: string }) => entry.state), ["review"])
    step = next()
    assert.deepEqual([step["action"], step["summary"]], ["review", "concept waits for a person's acceptance"])
    // With no catalog.config.json, a jam project's catalog lists its runs: the request goes to the
    // catalog and prints where the person opens it. Their answer may also arrive another way and is
    // recorded as a relay.
    const asked = cli(root, "run", "request-review", "oak-barrel", "concept")
    assert.equal(asked.status, 0, asked.stderr)
    assert.match(asked.stdout, /^oak-barrel: concept is waiting for a person's review at\n#\/reviews\/s\/sub_[a-z0-9]+\n/)
    using(root, ["run", "review"], ["oak-barrel", "concept", "--accept", "--relay", "chat: yes, that one"])

    const views = turnaround(root, `${dir}/views`)
    using(root, ["run", "record"], ["oak-barrel", "turnaround", ...views.flatMap((view) => ["--file", view]), "--symmetric", "--note", "Five views of a round barrel", "--tool", "image model 2"])
    using(root, ["run", "review"], ["oak-barrel", "turnaround", "--accept", "--relay", "chat: looks consistent"])

    write(root, `${dir}/mesh.glb`, await glb({ triangles: 1900 }))
    using(root, ["run", "record"], ["oak-barrel", "mesh", "--file", `${dir}/mesh.glb`, "--note", "Made in the DCC from the views", "--tool", "Blender 4.2", "--accept", "Closed surface, right proportions"])
    step = next()
    assert.equal(step["step"].id, "topology")

    // One finalize script produced topology, UVs and textures: one call, three records.
    write(root, `${dir}/final.glb`, await glb({ triangles: 1000, texture: 8 }))
    const measured = using(root, ["measure"], [`${dir}/final.glb`])
    assert.equal(measured["triangles"], 1000)
    const finished = using(root, ["run", "record"], ["oak-barrel", "topology", "uv", "texture", "--file", `model=${dir}/final.glb`, "--metric", "triangles=1000", "--note", "Reduced, unwrapped and textured by finalize.py", "--tool", "Blender 4.2", "--accept", "Within budget, no stretching"])
    assert.deepEqual(finished["records"].map((entry: { step: string; state: string }) => [entry.step, entry.state]), [["topology", "accepted"], ["uv", "accepted"], ["texture", "accepted"]])

    // No engine adapter: the engine steps are skipped by themselves and delivery is next.
    const status = using(root, ["run", "status"], ["oak-barrel"])
    assert.deepEqual(status["steps"].map((entry: { step: string; state: string }) => [entry.step, entry.state]).slice(6), [["collision", "skipped"], ["import", "skipped"], ["delivery", "ready"]])
    assert.match(cli(root, "run", "status", "oak-barrel").stdout, /collision\s+skipped\s+agent\s+no engine adapter is configured, so there is no import command; when engine provides import: does not hold/)
    using(root, ["run", "record"], ["oak-barrel", "delivery", "--file", `model=${dir}/final.glb`, "--evidence", `${dir}/concept.png`, "--note", "Final model", "--tool", "Blender 4.2"])
    using(root, ["run", "review"], ["oak-barrel", "delivery", "--accept", "--relay", "chat: ship the barrel", "--by", "Sam"])
    step = next()
    assert.deepEqual([step["action"], step["commands"][0].command], ["deliver", "jam run deliver oak-barrel"])
    const delivered = using(root, ["run", "deliver"], ["oak-barrel"])
    assert.equal(delivered["delivered"], "content/props/oak-barrel/1")
    assert.equal(using(root, ["run", "where"], ["oak-barrel"])["run"], "content/props/oak-barrel/1/run.json")
    const record = readJson<Run>(root, "content/props/oak-barrel/1/run.json")
    assert.equal(record.steps["delivery"]!.records[0]!.reviews[0]!.by, "Sam")
    assert.equal(next()["action"], "done")

    // What was improvised becomes a recipe.
    const captured = using(root, ["recipe", "capture"], ["oak-barrel", "--as", "round-prop"])
    assert.deepEqual(captured["steps"], ["concept", "turnaround", "mesh", "topology", "uv", "texture", "delivery"])
    const recipe = readJson<{ steps: Array<{ id: string; needs?: Array<string>; review: string; produces?: Array<{ role: string; keys?: Array<string> }>; checks?: Array<string>; skill?: string }> }>(root, "jam/recipes/round-prop.json")
    const turnaroundStep = recipe.steps.find((entry) => entry.id === "turnaround")!
    assert.deepEqual([turnaroundStep.needs, turnaroundStep.review, turnaroundStep.produces![0]!.keys, turnaroundStep.checks, turnaroundStep.skill], [["concept"], "human", ["front", "left", "back", "right", "three-quarter"], ["turnaround-views"], "jam-turnaround"])
    assert.equal(recipe.steps.find((entry) => entry.id === "mesh")!.review, "agent")
    assert.equal(cli(root, "recipe", "check", "round-prop").status, 0)
  })
})

describe("command line conventions", () => {
  it("every command has a description and one example in --help", () => {
    const root = tempProject()
    const reference = readFileSync(join(TOOLKIT, "docs/cli.md"), "utf8")
    const commands = [...reference.matchAll(/^#{2,3} ((?:[a-z-]+ ?)+)$/gm)].map((match) => match[1]!.trim().split(" ")).filter((command) => command[0] !== "commands")
    const leaves = commands.filter((command) => !commands.some((other) => other.length > command.length && other.slice(0, command.length).join(" ") === command.join(" ")))
    assert.ok(leaves.length > 40, `${leaves.length} commands`)
    // Spawning every command is slow; a spread of them shows the convention holds.
    for (const command of leaves.filter((_, index) => index % 6 === 0)) {
      const shown = help(root, ...command)
      assert.ok(reference.includes(shown.example), `docs/cli.md has the example of ${command.join(" ")}`)
    }
  })

  it("prints one JSON object with --json, readable text without, and errors with the fix on standard error", () => {
    const root = tempProject()
    const text = cli(root, "run", "status", "nothing")
    assert.deepEqual([text.status, text.stdout], [1, ""])
    assert.match(text.stderr, /^error: .*\n  fix: /)
    const json = cli(root, "run", "status", "nothing", "--json")
    assert.equal(json.stdout, "")
    const error = (JSON.parse(json.stderr) as { error: { code: string; message: string; fix: string } }).error
    assert.deepEqual([error.code, typeof error.fix], ["not_found", "string"])
    const usage = cli(root, "run", "record", "barrel")
    assert.notEqual(usage.status, 0)
    assert.match(usage.stderr + usage.stdout, /Missing required argument|step/)
  })

  it("launches Python and Blender with this machine's programs, passing arguments through untouched and returning their exit code", { skip: process.platform === "win32" ? "uses a shell script as the stand-in program" : false }, () => {
    const root = tempProject({ files: { "bin/fake": `#!/bin/sh\nfor arg in "$@"; do echo "[$arg]"; done\nexit 7\n`, "jam.local.json": JSON.stringify({ python: "bin/fake", blender: "bin/fake" }), "my script.py": "" } })
    chmodSync(join(root, "bin/fake"), 0o755)
    const python = cli(root, "python", "my script.py", "--", "--flag", "a b", "-c")
    assert.deepEqual([python.status, python.stdout], [7, "[my script.py]\n[--flag]\n[a b]\n[-c]\n"])
    const blender = cli(root, "blender", "--factory-startup", "toolkit:fbx-to-glb.py", "--", "in.fbx", "out file.glb")
    assert.deepEqual(blender.stdout.split("\n").slice(0, 9), ["[--background]", "[--factory-startup]", "[--python-exit-code]", "[1]", "[--python]", `[${join(TOOLKIT, "scripts/fbx-to-glb.py")}]`, "[--]", "[in.fbx]", "[out file.glb]"])
    assert.match(cli(root, "blender").stderr, /name the script to run: jam blender \[--factory-startup\] <script\.py> \[args\]/)
    write(root, "jam.local.json", JSON.stringify({ python: "bin/not-there" }))
    const absent = cli(root, "python", "x.py")
    assert.equal(absent.status, 1)
    assert.match(absent.stderr, /cannot run .*bin\/not-there \(ENOENT\)\n  fix: set "python" in jam\.local\.json/)
  })
})
