import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, it } from "node:test"
import { Engine } from "../../src/jam/engine/Engine.ts"
import { conformFor, importFor } from "../../src/jam/engine/host.ts"
import { deliverRun } from "../../src/jam/runs/deliver.ts"
import { skipStep } from "../../src/jam/runs/review.ts"
import type { Run } from "../../src/jam/runs/schema.ts"
import { CHARACTER_BUDGET, cli, CONFIG, jam, jamFailure, jamProject, png, readJson, write } from "./fixtures.ts"
import { AGENT_MODE, record, recordFailure, review, runFile, start, status, stepStatus, throughTexture } from "./flow.ts"

// An adapter whose commands are small scripts: argv in, one JSON receipt out.
const ADAPTER = {
  "adapter.json": JSON.stringify({
    id: "fake",
    label: "Fake engine",
    versions: ">=1",
    facts: {
      unitsPerMeter: 100, up: "+Z", forward: "+X", handedness: "left", contentRoot: ".",
      mesh: { static: "glb", skinned: "glb" },
      skeletons: { biped: { label: "Biped", engineAsset: "/Game/Rigs/SK_Biped", bones: { hips: "pelvis", spine: "spine_01", head: "head", "upper-arm.l": "upperarm_l" } } }
    },
    commands: {
      import: { run: ["node", "commands/import.mjs"], kinds: ["static", "skinned"] },
      inspect: { run: ["node", "commands/inspect.mjs"] },
      "conform-skeleton": { run: ["node", "commands/conform.mjs"] },
      references: { run: ["node", "commands/echo.mjs", "references"] },
      check: { run: ["node", "commands/echo.mjs", "check"] },
      capture: null,
      "fit-collision": { run: ["node", "commands/echo.mjs", "own"], description: "Fit collision hulls to a mesh" },
      broken: { run: ["node", "commands/broken.mjs"] },
      refused: { run: ["node", "commands/refused.mjs"] },
      chatty: { run: ["node", "commands/chatty.mjs"] }
    },
    docs: { capture: "docs/capture.md", import: "docs/import.md" },
    sources: [{ fact: "unitsPerMeter", url: "https://example.invalid/units", says: "one unit is a centimeter" }]
  }),
  "commands/import.mjs": `
    import { existsSync } from "node:fs"
    import { basename } from "node:path"
    const args = process.argv.slice(2)
    if (existsSync("editor-closed")) {
      console.log(JSON.stringify({ error: { code: "editor-handoff", message: "no engine transport is configured" }, handoff: { steps: ["open the editor", { script: "import_1.py", result: "import_1.json" }] } }))
      process.exit(3)
    }
    const kind = args[args.indexOf("--kind") + 1]
    const files = args.filter((arg) => arg.endsWith(".glb"))
    console.log(JSON.stringify({
      assets: files.map((file) => ({ id: "/Game/" + basename(file).replace(/\\.[^.]+$/, ""), kind, source: file, sha256: "n/a" })),
      args, settings: JSON.parse(process.env.JAM_ENGINE_SETTINGS), cwd: process.cwd(), root: process.env.JAM_PROJECT_ROOT
    }))`,
  "commands/inspect.mjs": `
    import { existsSync, readFileSync } from "node:fs"
    if (existsSync("editor-closed")) { console.log(JSON.stringify({ handoff: { reason: "the editor is not running", steps: ["start the editor"], resume: "jam engine inspect " + process.argv[2] } })); process.exit(3) }
    const override = existsSync("inspect.json") ? JSON.parse(readFileSync("inspect.json", "utf8")) : {}
    console.log(JSON.stringify({ id: process.argv[2], bounds: { min: [0, 0, 0], max: [0.6, 0.6, 1] }, pivot: [0, 0, 0], materials: ["M_Main"], triangles: 1000, skeleton: { root: "pelvis", bones: ["pelvis", "spine_01", "head", "upperarm_l"] }, skeletonAsset: "/Game/Rigs/SK_Biped", lods: [{ triangles: 1000 }], details: { nanite: false }, ...override }))`,
  "commands/conform.mjs": `
    import { copyFileSync, mkdirSync, writeFileSync } from "node:fs"
    const args = process.argv.slice(2)
    const out = args[args.indexOf("--out") + 1]
    mkdirSync(out, { recursive: true })
    copyFileSync(args[0], out + "/conformed.glb")
    writeFileSync(out + "/report.json", JSON.stringify({ args }))
    console.log(JSON.stringify({ files: [out + "/conformed.glb"], report: out + "/report.json" }))`,
  "commands/echo.mjs": `
    const [which, ...args] = process.argv.slice(2)
    const receipts = {
      references: args[0] === "bad" ? { referencedBy: [] } : { references: args.map((id) => ({ id, kind: "level", path: "maps/main" })) },
      check: { problems: [{ message: "2 assets have no stored source", fix: "reimport them" }], report: { checked: 14 } },
      own: { ran: "fit-collision", args }
    }
    console.log(JSON.stringify(receipts[which]))`,
  "commands/broken.mjs": `console.error("editor is not running on port 30010"); process.exit(3)`,
  "commands/refused.mjs": `console.log(JSON.stringify({ error: { code: "locked", message: "the asset is checked out by someone else", fix: "ask them to check it in" } })); process.exit(1)`,
  "commands/chatty.mjs": `console.log("Starting checks..."); console.log("done")`,
  "docs/capture.md": "# Capture\n\nOpen the level and take one still.\n",
  "docs/import.md": "# By hand\n\n## Import\n\nDrag the file into the content browser.\n\n## Afterwards\n\nSave all.\n"
}

const withAdapter = (extra: Record<string, unknown> = {}, files: Record<string, string> = {}) =>
  jamProject({
    git: true,
    config: { ...AGENT_MODE, engine: { adapter: "fake", facts: {} }, ...extra },
    files: { ...Object.fromEntries(Object.entries(ADAPTER).map(([path, text]) => [`jam/engines/fake/${path}`, text])), ...files }
  })

const resolved = (root: string) => jam(root, Effect.flatMap(Engine, (engine) => engine.resolved))
const run = (root: string, verb: Parameters<Engine["Service"]["run"]>[0], args: ReadonlyArray<string> = []) => jam(root, Effect.flatMap(Engine, (engine) => engine.run(verb, args)))
const runFailure = (root: string, verb: Parameters<Engine["Service"]["run"]>[0], args: ReadonlyArray<string> = []) => jamFailure(root, Effect.flatMap(Engine, (engine) => engine.run(verb, args)))

describe("adapter resolution", () => {
  it("no adapter means glTF conventions; a preset gives facts only; a project adapter comes first; overrides merge over either", async () => {
    const none = await resolved(jamProject())
    assert.deepEqual([none.source, none.facts.unitsPerMeter, none.facts.up, none.facts.forward, none.facts.handedness], ["default", 1, "+Y", "+Z", "right"])
    const preset = await resolved(jamProject({ config: { engine: { adapter: "web", facts: { unitsPerMeter: 2, naming: { staticMesh: "SM_" } } } } }))
    assert.deepEqual([preset.source, preset.dir, preset.provides, preset.facts.unitsPerMeter, preset.facts.up, preset.facts.naming], ["preset", null, [], 2, "+Y", { staticMesh: "SM_" }])
    const project = await resolved(withAdapter())
    assert.deepEqual([project.source, project.dir, project.facts.unitsPerMeter, project.facts.skeletons?.["biped"]?.bones.hips], ["project", "jam/engines/fake", 100, "pelvis"])
    // A project adapter named like a preset replaces it.
    const shadow = jamProject({ config: { engine: { adapter: "web", facts: {} } }, files: { "jam/engines/web/adapter.json": JSON.stringify({ id: "web", label: "Ours", facts: { unitsPerMeter: 1, up: "+Z", forward: "-Y", handedness: "right" } }) } })
    assert.deepEqual([(await resolved(shadow)).label, (await resolved(shadow)).facts.up], ["Ours", "+Z"])
  })

  it("an unknown adapter, an invalid one, or one that leaves out the core conventions fails with the fix", async () => {
    const unknown = await jamFailure(jamProject({ config: { engine: { adapter: "ghost", facts: {} } } }), Effect.flatMap(Engine, (engine) => engine.resolved))
    assert.equal(unknown.code, "not_found")
    assert.match(unknown.fix!, /jam engine install <folder>.*choose a preset: .*web/)
    const partial = jamProject({ config: { engine: { adapter: "half", facts: {} } }, files: { "jam/engines/half/adapter.json": JSON.stringify({ id: "half", label: "Half", facts: { up: "+Z" } }) } })
    assert.match((await jamFailure(partial, Effect.flatMap(Engine, (engine) => engine.resolved))).message, /engine adapter half does not state unitsPerMeter, forward, handedness/)
    const typo = jamProject({ config: { engine: { adapter: "typo", facts: {} } }, files: { "jam/engines/typo/adapter.json": JSON.stringify({ id: "typo", label: "T", facts: { upAxis: "+Z", contentRoot: "../elsewhere" }, commands: { import: { runs: ["x"] } } }) } })
    const error = await jamFailure(typo, Effect.flatMap(Engine, (engine) => engine.resolved))
    assert.match(error.message, /facts\.upAxis: expected no excess property/)
    assert.match(error.message, /facts\.contentRoot: /)
    assert.match(error.message, /commands\.import\.run: missing|commands\.import/i)
  })

  it("install copies an adapter folder from anywhere into the project and selects it", async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "jam-adapter-")))
    after(() => rmSync(outside, { recursive: true, force: true }))
    for (const [path, text] of Object.entries(ADAPTER)) write(outside, path, text)
    const root = jamProject()
    const installed = cli(root, "engine", "install", outside, "--json")
    assert.equal(installed.status, 0, installed.stderr)
    assert.deepEqual(installed.json(), { id: "fake", dir: "jam/engines/fake", files: Object.keys(ADAPTER).length })
    assert.equal(readJson<{ engine: { adapter: string } }>(root, "jam.config.json").engine.adapter, "fake")
    assert.equal(readFileSync(join(root, "jam/engines/fake/commands/import.mjs"), "utf8"), ADAPTER["commands/import.mjs"])
    const show = cli(root, "engine", "show", "--json").json<{ source: string; commands: Record<string, boolean>; own: Array<string>; docs: Array<string> }>()
    assert.deepEqual([show.source, show.commands, show.own, show.docs], ["project", { import: true, inspect: true, references: true, capture: false, check: true, "conform-skeleton": true }, ["fit-collision", "broken", "refused", "chatty"], ["capture", "import"]])
    write(outside, "adapter.json", JSON.stringify({ id: "fake", label: "x" }))
    assert.match(cli(root, "engine", "install", outside).stderr, /facts: .*missing|facts/i)
    assert.match(cli(root, "engine", "install", join(outside, "nowhere")).stderr, /has no readable adapter\.json/)
  })
})

describe("facts", () => {
  it("are addressed a key per argument, since keys may contain dots; one dotted argument works when it can mean one thing only", () => {
    const root = withAdapter({ engine: { adapter: "fake", facts: { extra: { a: { "b.c": 1, b: { c: 2 } } } } } })
    const fact = (...path: ReadonlyArray<string>) => cli(root, "engine", "facts", ...path)
    assert.equal(fact("skeletons", "biped", "bones", "upper-arm.l").stdout.trim(), "upperarm_l")
    assert.equal(fact("skeletons.biped.bones.upper-arm.l").stdout.trim(), "upperarm_l", "the only reading of the dotted form")
    assert.equal(fact("mesh.static").stdout.trim(), "glb")
    assert.equal(fact("contentRoot").stdout.trim(), ".")
    assert.equal(fact("skeletons", "biped", "engineAsset").stdout.trim(), "/Game/Rigs/SK_Biped")
    assert.equal(fact("extra", "a", "b.c").stdout.trim(), "1")
    assert.equal(fact("extra", "a", "b", "c").stdout.trim(), "2")
    assert.match(fact("extra.a.b.c").stderr, /extra\.a\.b\.c could mean several facts\n  fix: give the path as separate arguments/)
    assert.match(fact("skeletons", "ghost").stderr, /the engine facts have nothing at skeletons ghost/)
    assert.equal(cli(root, "engine", "facts", "--json").json<{ unitsPerMeter: number }>().unitsPerMeter, 100)
  })
})

describe("the command contract", () => {
  it("runs the adapter's script with the command's arguments in the project folder and returns its one JSON receipt", async () => {
    const root = withAdapter({}, { "jam.local.json": JSON.stringify({ engine: { host: "localhost", port: 30010 } }) })
    const outcome = await run(root, "import", ["--kind", "static", "work/a b/crate.glb"])
    assert.ok(outcome.status === "ran")
    assert.deepEqual(outcome.receipt, {
      assets: [{ id: "/Game/crate", kind: "static", source: "work/a b/crate.glb", sha256: "n/a" }],
      args: ["--kind", "static", "work/a b/crate.glb"],
      settings: { host: "localhost", port: 30010 },
      cwd: root,
      root
    })
    const references = await run(root, "references", ["/Game/crate"])
    assert.deepEqual(references.status === "ran" && references.receipt, { references: [{ id: "/Game/crate", kind: "level", path: "maps/main" }] })
    const check = await run(root, "check")
    assert.deepEqual(check.status === "ran" && check.receipt, { problems: [{ message: "2 assets have no stored source", fix: "reimport them" }], report: { checked: 14 } })
  })

  it("a failing command, a receipt of the wrong shape, or anything but one JSON object is an error that says what the adapter did", async () => {
    const root = withAdapter()
    const failed = await runFailure(root, "broken", ["/Game/crate"])
    assert.equal(failed.code, "unavailable")
    assert.match(failed.message, /engine broken failed \(adapter fake, exit 3\): editor is not running on port 30010/)
    assert.match(failed.fix!, /"engine" in jam\.local\.json/)
    const refused = await runFailure(root, "refused")
    assert.deepEqual([refused.message, refused.fix], ["engine refused failed (adapter fake, exit 1): the asset is checked out by someone else", "ask them to check it in"])
    const chatty = await runFailure(root, "chatty")
    assert.equal(chatty.code, "malformed")
    assert.match(chatty.message, /must print one JSON object; it printed: Starting checks/)
    const shape = await runFailure(root, "references", ["bad"])
    assert.equal(shape.code, "malformed")
    assert.match(shape.message, /references receipt of adapter fake: references: missing/i)
    assert.match(shape.fix!, /schemas\/engine-references-receipt\.schema\.json/)
  })

  it("a null command prints the adapter's guide for doing it by hand; a facts-only preset has a guide too", async () => {
    const root = withAdapter()
    const manual = await run(root, "capture", ["/Game/crate"])
    assert.deepEqual(manual, {
      status: "manual", command: "capture", adapter: "fake", guide: { topic: "capture", path: "jam/engines/fake/docs/capture.md", text: "# Capture\n\nOpen the level and take one still." },
      next: "adapter fake has no capture command: do it by hand following jam/engines/fake/docs/capture.md, then record the step with what you produced as evidence"
    })
    assert.equal(cli(root, "engine", "docs", "import").stdout, "jam/engines/fake/docs/import.md\n\n## Import\n\nDrag the file into the content browser.\n", "the section for the topic, not the whole document")
    assert.match(cli(root, "engine", "docs", "lighting").stderr, /no guidance on lighting\n  fix: topics: capture, import/)

    const preset = jamProject({ config: { engine: { adapter: "web", facts: {} } } })
    const byHand = await run(preset, "import", ["--kind", "static", "a.glb"])
    assert.ok(byHand.status === "manual" && byHand.guide !== null)
    assert.match(byHand.guide.path, /engines\/web\.md$/)
    assert.match(byHand.guide.text, /^## Import\n/)
    assert.doesNotMatch(byHand.guide.text, /\n## /, "only the import section")
    assert.match(byHand.next, /adapter web has no import command: do it by hand following .*engines\/web\.md/)
    const topics = cli(preset, "engine", "show", "--json").json<{ docs: Array<string> }>().docs
    assert.ok(topics.includes("import") && topics.includes("inspect") && topics.length > 2, topics.join(", "))
    for (const topic of topics) assert.equal(cli(preset, "engine", "docs", topic).status, 0, topic)
    const none = await run(jamProject(), "import", ["--kind", "static", "a.glb"])
    assert.ok(none.status === "manual")
    assert.equal(none.guide, null)
    assert.match(none.next, /gltf is facts only: do the import in the engine by hand .* or install a full adapter/)
  })

  it("an adapter's own commands run by name with the same receipt rule, and a recipe step can depend on one", async () => {
    const root = withAdapter({}, { "jam/recipes/hull.json": JSON.stringify({ version: 1, id: "hull", steps: [{ id: "fit", when: { engine: "fit-collision" } }, { id: "bake", when: { engine: "bake-lighting" } }] }) })
    const fitted = cli(root, "engine", "run", "fit-collision", "--json", "--", "--mode", "measure", "/Game/crate", "--json")
    assert.equal(fitted.status, 0, fitted.stderr)
    assert.deepEqual(fitted.json<{ receipt: unknown }>().receipt, { ran: "fit-collision", args: ["--mode", "measure", "/Game/crate", "--json"] }, "everything after -- reaches the adapter as typed")
    assert.match(cli(root, "engine", "run", "bake-lighting").stderr, /adapter fake has no command bake-lighting\n  fix: it runs: import, inspect, conform-skeleton, references, check, fit-collision/)
    await start(root, "hull", "wall")
    assert.deepEqual((await status(root, "wall")).steps.map((step) => [step.step, step.state, step.reason]), [["fit", "ready", undefined], ["bake", "skipped", "engine adapter fake has no bake-lighting command"]])
  })

  it("a handoff is its own result: the steps are shown, nothing is recorded, and it is not a failure", async () => {
    const root = withAdapter()
    await start(root, "prop", "crate")
    const made = await throughTexture(root, "crate")
    await jam(root, skipStep({ run: "crate", step: "collision", reason: "decorative" }))
    write(root, "editor-closed", "")
    const handed = await jam(root, importFor({ kind: "static", files: [], run: "crate" }))
    assert.deepEqual(handed.outcome, {
      status: "handoff", command: "import", adapter: "fake", reason: "no engine transport is configured",
      steps: ["open the editor", { script: "import_1.py", result: "import_1.json" }],
      resume: "jam engine import --kind static --run crate"
    })
    assert.equal(handed.recorded, undefined)
    assert.equal((await stepStatus(root, "crate", "import")).state, "ready", "the step is still to do")
    const printed = cli(root, "engine", "import", "--kind", "static", "--run", "crate")
    assert.equal(printed.status, 0)
    assert.equal(printed.stdout, "not done: no engine transport is configured\ndo these by hand, in order:\n  1. open the editor\n  2. {\"script\":\"import_1.py\",\"result\":\"import_1.json\"}\nthen run again: jam engine import --kind static --run crate\n")
    const inspect = await run(root, "inspect", ["/Game/model"])
    assert.deepEqual(inspect.status === "handoff" && [inspect.reason, inspect.resume], ["the editor is not running", "jam engine inspect /Game/model"])
    // An import done by hand while the editor is unreachable still needs evidence of what was checked.
    assert.match((await recordFailure(root, "crate", "import", { tool: "editor", engineAssets: [{ kind: "static", id: "/Game/model" }] })).message, /\/Game\/model was not inspected: the adapter could not reach the engine \(the editor is not running\)/)
    assert.ok(made.model.length > 0)
  })
})

describe("engine steps of a run", () => {
  it("import records the step with the engine's asset ids and its receipt, after the engine-inspect check", async () => {
    const root = withAdapter()
    await start(root, "prop", "crate")
    const made = await throughTexture(root, "crate")
    await jam(root, skipStep({ run: "crate", step: "collision", reason: "decorative" }))
    assert.match((await jamFailure(root, importFor({ kind: "audio", files: [], run: "crate" }))).message, /--kind audio: this adapter imports static, skinned/)
    // The engine reports more material slots than the budget allows: the import step is refused.
    write(root, "inspect.json", JSON.stringify({ materials: ["M_A", "M_B"] }))
    assert.match((await jamFailure(root, importFor({ kind: "static", files: [], run: "crate" }))).message, /step import did not pass its checks: \/Game\/model has 2 material slots, over the budget of 1/)
    write(root, "inspect.json", "{}")
    const result = await jam(root, importFor({ kind: "static", files: [], run: "crate", destination: "Props/Crates", slots: ["wood=M_Oak", "iron=M_Iron"], extra: ["--two-sided", "wood"] }))
    assert.deepEqual(result.recorded!.records.map((entry) => [entry.step, entry.state]), [["import", "accepted"]])
    assert.deepEqual(result.outcome.status === "ran" && result.outcome.receipt["args"], ["--kind", "static", made.model, "--destination", "Props/Crates", "--slot", "wood=M_Oak", "--slot", "iron=M_Iron", "--two-sided", "wood"])
    const stored = runFile(root, "crate").steps["import"]!.records[0]!
    assert.deepEqual(stored.arguments, ["--kind", "static", "--destination", "Props/Crates", "--slot", "wood=M_Oak", "--slot", "iron=M_Iron", "--two-sided", "wood"], "what the adapter was told, files left out")
    assert.deepEqual(stored.engineAssets, [{ id: "/Game/model", kind: "static", source: made.model, sha256: "n/a" }])
    assert.deepEqual(stored.inputs.map((file) => file.path), [made.model])
    assert.deepEqual(stored.dependencies, { texture: runFile(root, "crate").steps["texture"]!.records[0]!.id, collision: "skipped" })
    assert.equal(readJson<{ adapter: string }>(root, stored.evidence[0]!.path).adapter, "fake")
    assert.deepEqual((await stepStatus(root, "crate", "import")).engineAssets, stored.engineAssets)
    // On the command line, what follows -- goes to the adapter as typed and the files before it stay files.
    const typed = cli(root, "engine", "import", "--kind", "static", "--slot", "wood=M_Oak", made.model, "--json", "--", "--two-sided", "wood", "--name", "SM_Crate")
    assert.equal(typed.status, 0, typed.stderr)
    assert.deepEqual(typed.json<{ outcome: { receipt: { args: Array<string> } } }>().outcome.receipt.args, ["--kind", "static", made.model, "--slot", "wood=M_Oak", "--two-sided", "wood", "--name", "SM_Crate"])
    // Without a run it only imports and prints the receipt.
    const plain = await jam(root, importFor({ kind: "static", files: [made.model] }))
    assert.equal(plain.recorded, undefined)
  })

  it("an import done by hand is recorded with the engine's id and evidence", async () => {
    const root = jamProject({ config: { ...AGENT_MODE, engine: { adapter: "manual", facts: {} } }, files: { "jam/engines/manual/adapter.json": JSON.stringify({ id: "manual", label: "By hand", facts: { unitsPerMeter: 1, up: "+Y", forward: "+Z", handedness: "right" }, commands: { import: null, inspect: null }, docs: { import: "import.md" } }), "jam/engines/manual/import.md": "# Import by hand\n" } })
    await start(root, "prop", "crate")
    const made = await throughTexture(root, "crate")
    // The adapter provides no import command, so the step is skipped on its own; doing it by hand is still possible.
    assert.equal((await stepStatus(root, "crate", "import")).state, "skipped")
    const outcome = await jam(root, importFor({ kind: "static", files: [], run: "crate" }))
    assert.equal(outcome.recorded, undefined)
    assert.deepEqual(outcome.outcome.status === "manual" && outcome.outcome.guide, { topic: "import", path: "jam/engines/manual/import.md", text: "# Import by hand" })
    assert.match((await recordFailure(root, "crate", "import", { tool: "editor 5.4" })).message, /step import records no engine asset/)
    assert.match((await recordFailure(root, "crate", "import", { tool: "editor 5.4", engineAssets: [{ kind: "static", id: "Props/Crate" }] })).message, /Props\/Crate was not inspected: adapter manual has no inspect command and no inspect guide/)
    write(root, `${made.dir}/in-editor.png`, png(4, 4))
    const recorded = await record(root, "crate", "import", { tool: "editor 5.4", engineAssets: [{ kind: "static", id: "Props/Crate" }], evidence: [`${made.dir}/in-editor.png`] })
    assert.equal(recorded.records[0]!.state, "accepted")
  })
})

// The same recipe must finish with any engine adapter and with none.
const CONFIGURATIONS: ReadonlyArray<readonly [string, () => string]> = [
  ["no adapter", () => jamProject({ git: true, config: AGENT_MODE })],
  ["the facts-only web preset", () => jamProject({ git: true, config: { ...AGENT_MODE, engine: { adapter: "web", facts: {} } } })],
  ["an adapter with import, inspect and conform-skeleton", () => withAdapter({ budgets: { ...CONFIG.budgets, character: { ...CHARACTER_BUDGET, skeleton: "biped" } } })]
]

for (const [name, make] of CONFIGURATIONS) {
  const engineless = !name.startsWith("an adapter")
  const reason = name === "no adapter" ? (verb: string) => `no engine adapter is configured, so there is no ${verb} command` : (verb: string) => `engine adapter web has no ${verb} command`

  describe(`a whole run with ${name}`, () => {
    it("prop: finishes at delivery; engine steps run when the adapter provides them and are skipped with the reason when not", async () => {
      const root = make()
      await start(root, "prop", "crate")
      const made = await throughTexture(root, "crate")
      const before = await status(root, "crate")
      if (engineless) {
        assert.deepEqual(before.steps.filter((step) => step.condition !== undefined).map((step) => [step.step, step.state, step.reason, step.condition]), [
          ["collision", "skipped", reason("import"), { when: "engine provides import", met: false, reason: reason("import") }],
          ["import", "skipped", reason("import"), { when: "engine provides import", met: false, reason: reason("import") }]
        ])
        assert.deepEqual(before.next, { action: "work", step: "delivery", why: "nothing is recorded yet" })
      } else {
        assert.deepEqual(before.steps.filter((step) => step.condition !== undefined).map((step) => [step.step, step.state, step.condition!.met]), [["collision", "ready", true], ["import", "waiting", true]])
        await record(root, "crate", "collision", { files: [`model=${made.model}`], accept: "hull added" })
        await jam(root, importFor({ kind: "static", files: [], run: "crate" }))
      }
      await record(root, "crate", "delivery", { files: [`model=${made.model}`] })
      await review(root, "crate", "delivery", { relay: "chat: ship it" })
      const delivered = await jam(root, deliverRun("crate"))
      const final = readJson<Run>(root, delivered.run)
      assert.ok(final.steps["delivery"]!.records[0]!.files[0]!.path.endsWith(".glb"), "delivered as glTF")
      if (engineless) {
        assert.deepEqual([final.steps["collision"], final.steps["import"]].map((log) => [log!.records.length, log!.skip!.reason, log!.skip!.auto]), [[0, reason("import"), true], [0, reason("import"), true]])
        assert.deepEqual(final.steps["delivery"]!.records[0]!.dependencies["import"], "skipped")
        assert.ok(Object.values(final.steps).every((log) => log.records.every((entry) => entry.engineAssets === undefined)), "nothing engine-shaped is recorded")
      } else {
        assert.deepEqual(final.steps["import"]!.records[0]!.engineAssets!.map((asset) => asset.id), ["/Game/model"])
      }
    })

    it("character: rig is engine-neutral; conform and import happen only when the adapter provides them", async () => {
      const root = make()
      await start(root, "character", "hero")
      const made = await throughTexture(root, "hero")
      write(root, `${made.dir}/poses.png`, png(32, 16))
      assert.match((await recordFailure(root, "hero", "rig", { files: [`model=${made.model}`] })).message, /needs at least 1 file with role deformation/)
      write(root, `${made.dir}/landmarks.json`, JSON.stringify({ units: "meters", up: "+Y", landmarks: {}, source: "test" }))
      await record(root, "hero", "rig", { files: [`model=${made.model}`, `deformation=${made.dir}/poses.png`, `landmarks=${made.dir}/landmarks.json`], accept: "limbs follow their bones in every pose" })
      const before = await status(root, "hero")
      if (engineless) {
        assert.deepEqual(before.steps.filter((step) => step.condition !== undefined).map((step) => [step.step, step.state, step.reason]), [["conform", "skipped", reason("conform-skeleton")], ["import", "skipped", reason("import")]])
      } else {
        const conformed = await jam(root, conformFor({ files: [], run: "hero", height: 1.8, fingers: "5", accept: "matches the biped rest pose", extra: ["--max-influences", "4"] }))
        assert.deepEqual(conformed.recorded!.records.map((entry) => [entry.step, entry.state]), [["conform", "accepted"]])
        const conform = runFile(root, "hero").steps["conform"]!.records[0]!
        assert.deepEqual([conform.files[0]!.path, conform.note], [`${made.dir}/conform/conformed.glb`, `Conformed ${made.model} to skeleton biped through engine adapter fake.`])
        // The adapter got the standard arguments: the model, the landmark file the rig step recorded, the skeleton, then what was passed through.
        assert.deepEqual(readJson<{ args: Array<string> }>(root, conform.evidence.find((file) => file.label === "report")!.path).args, [made.model, "--landmarks", `${made.dir}/landmarks.json`, "--skeleton", "biped", "--height", "1.8", "--fingers", "5", "--out", `${made.dir}/conform`, "--max-influences", "4"])
        assert.deepEqual(conform.arguments, ["--landmarks", `${made.dir}/landmarks.json`, "--skeleton", "biped", "--height", "1.8", "--fingers", "5", "--out", `${made.dir}/conform`, "--max-influences", "4"])
        assert.deepEqual(conform.inputs.map((file) => file.path), [made.model, `${made.dir}/landmarks.json`])
        const imported = await jam(root, importFor({ kind: "skinned", files: [], run: "hero" }))
        assert.deepEqual(imported.recorded!.records.map((entry) => entry.state), ["accepted"])
        assert.deepEqual(runFile(root, "hero").steps["import"]!.records[0]!.inputs.map((file) => file.path), [`${made.dir}/conform/conformed.glb`], "the conformed model is what gets imported")
      }
      await record(root, "hero", "delivery", { files: [`model=${made.model}`] })
      await review(root, "hero", "delivery", { relay: "chat: ship it" })
      const delivered = await jam(root, deliverRun("hero"))
      const final = readJson<Run>(root, delivered.run)
      assert.equal(final.steps["rig"]!.records[0]!.files.find((file) => file.role === "deformation")!.path, "work/assets/hero/1/poses.png")
      assert.equal(final.steps["conform"]!.skip?.auto, engineless ? true : undefined)
      assert.equal(existsSync(join(root, "work/assets/hero/1/model.glb")), true)
    })
  })
}

describe("engine-inspect for a deforming asset", () => {
  it("compares the engine's skeleton with the profile the budget names", async () => {
    const root = withAdapter({ budgets: { ...CONFIG.budgets, character: { ...CHARACTER_BUDGET, skeleton: "biped" } } })
    await start(root, "character", "hero")
    const made = await throughTexture(root, "hero")
    write(root, `${made.dir}/poses.png`, png(32, 16))
    await record(root, "hero", "rig", { files: [`model=${made.model}`, `deformation=${made.dir}/poses.png`], accept: "ok" })
    await jam(root, skipStep({ run: "hero", step: "conform", reason: "the provider's rig already matches" }))
    write(root, "inspect.json", JSON.stringify({ skeleton: { root: "pelvis", bones: ["pelvis", "head"] } }))
    assert.match((await jamFailure(root, importFor({ kind: "skinned", files: [], run: "hero" }))).message, /\/Game\/model lacks bones of skeleton biped: spine_01, upperarm_l/)
    write(root, "inspect.json", JSON.stringify({ skeleton: undefined, bounds: { min: [0, 0, 0], max: [0, 0, 0] } }))
    assert.match((await jamFailure(root, importFor({ kind: "skinned", files: [], run: "hero" }))).message, /empty or inverted bounds/)
  })
})

describe("deformation evidence", () => {
  it("a rig report among the evidence decides: it must pass, be about the recorded model and keep influences in budget", async () => {
    const root = jamProject({ config: { ...CONFIG, ...AGENT_MODE } })
    await start(root, "character", "hero")
    const made = await throughTexture(root, "hero")
    write(root, `${made.dir}/poses.png`, png(32, 16))
    const model = runFile(root, "hero").steps["texture"]!.records[0]!.files.find((file) => file.role === "model")!.sha256
    const report = (fields: Record<string, unknown>): string =>
      JSON.stringify({ passed: true, outputs: [{ role: "model", path: made.model, sha256: model }], glb: { maxInfluences: 4, problems: [] }, ...fields })
    const attempt = (name: string, fields: Record<string, unknown>) => {
      write(root, `${made.dir}/${name}.json`, report(fields))
      return recordFailure(root, "hero", "rig", { files: [`model=${made.model}`, `deformation=${made.dir}/poses.png`, `deformation=${made.dir}/${name}.json`], accept: "limbs follow" })
    }
    assert.match((await attempt("failed", { passed: false })).message, /failed its own deformation check/)
    assert.match((await attempt("other", { outputs: [{ role: "model", path: "x.glb", sha256: "0".repeat(64) }] })).message, /about another model/)
    assert.match((await attempt("heavy", { glb: { maxInfluences: 8, problems: [] } })).message, /up to 8 influences per vertex; the budget allows 4/)
    write(root, `${made.dir}/good.json`, report({}))
    await record(root, "hero", "rig", { files: [`model=${made.model}`, `deformation=${made.dir}/poses.png`, `deformation=${made.dir}/good.json`], accept: "limbs follow" })
    assert.equal((await stepStatus(root, "hero", "rig")).state, "accepted")
  })
})
