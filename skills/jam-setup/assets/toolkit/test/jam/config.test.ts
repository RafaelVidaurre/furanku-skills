import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { Config } from "../../src/jam/config/Config.ts"
import type { JamConfig } from "../../src/jam/config/schema.ts"
import { Recipes } from "../../src/jam/recipes/Recipes.ts"
import { tempProject } from "../support.ts"
import { cli, CONFIG, jam, jamFailure, jamProject, readJson, TOOLKIT, write } from "./fixtures.ts"

const V1 = readFileSync(join(TOOLKIT, "test/jam/fixtures/v1-config.json"), "utf8")
const load = (root: string) => jam(root, Effect.flatMap(Config, (config) => config.load))
const loadFailure = (root: string) => jamFailure(root, Effect.flatMap(Config, (config) => config.load))

describe("configuration", () => {
  it("fills defaults, and reports every problem at once with its field and expected form", async () => {
    const root = tempProject({ files: { "jam.config.json": JSON.stringify({ version: 2, toolkit: "tools/jam", roots: { scratch: "a/.scratch", delivered: "a/out", scan: [] } }) } })
    const config = await load(root)
    assert.deepEqual([config.review.mode, config.engine.adapter, config.style.document, config.budgets, config.spend], ["recipe", null, null, {}, {}])
    write(root, "jam.config.json", JSON.stringify({
      ...CONFIG,
      roots: { scratch: "/abs", delivered: "a\\b", scan: [] },
      budgets: { prop: { ...CONFIG.budgets.prop, triangles: { target: 9000, max: 8000 } }, hero: { ...CONFIG.budgets.character, poses: undefined } },
      spend: { meshy: { perRun: -1 } },
      review: { mode: "sometimes" },
      profiles: {}
    }))
    const error = await loadFailure(root)
    assert.equal(error.code, "invalid")
    const problems = (error.details as { problems: Array<string> }).problems
    for (const expected of [
      /^profiles: expected no excess property/,
      /^roots\.scratch: expected a project-relative path/,
      /^roots\.delivered: expected a project-relative path/,
      /^budgets\.prop: triangles\.target must not exceed triangles\.max/,
      /^budgets\.hero: a deforming budget needs maxInfluences and poses/,
      /^spend\.meshy\.perRun: expected a value greater than or equal to 0/,
      /^review\.mode: expected "recipe" \| "agent" \| "none"/
    ]) assert.ok(problems.some((problem) => expected.test(problem)), `${expected} in\n${problems.join("\n")}`)
  })

  it("a project without configuration gets told how to set up, not a missing-file error", () => {
    const root = tempProject()
    for (const args of [["run", "status", "barrel"], ["run", "start", "prop", "barrel", "--brief-text", "x"], ["config", "show"], ["engine", "show"], ["job", "list"]]) {
      const result = cli(root, ...args)
      assert.equal(result.status, 1, args.join(" "))
      assert.match(result.stderr, /error: jam\.config\.json is missing: this project is not set up for jam\n  fix: create it with "jam setup --from <choices\.json>"/, args.join(" "))
      assert.doesNotMatch(result.stderr, /ENOENT/)
    }
    assert.equal(cli(root, "recipe", "list").status, 0, "recipes can be read before setup")
    assert.equal(cli(root, "provider", "list").status, 0)
  })

  it("setup prints the defaults to decide on, writes decided choices over them once, and never replaces a configuration", () => {
    const root = tempProject({ files: { ".mcp.json": "existing harness configuration" } })
    const defaults = cli(root, "setup", "--json").json<{ configured: boolean; template: { roots: { scratch: string } } }>()
    assert.deepEqual([defaults.configured, typeof defaults.template.roots.scratch], [false, "string"])
    assert.equal(existsSync(join(root, "jam.config.json")), false)
    write(root, "choices.json", JSON.stringify({ roots: { scratch: "content/.work", delivered: "content/final", scan: ["content"] }, spend: { meshy: { perRun: 42 }, scenario: { perRun: null } }, review: { mode: "agent" } }))
    assert.equal(cli(root, "setup", "--from", "choices.json").status, 0)
    const written = readJson<JamConfig>(root, "jam.config.json")
    assert.deepEqual([written.roots.scratch, written.spend["meshy"], written.spend["scenario"]?.perRun, written.review.mode, written.toolkit], ["content/.work", { perRun: 42 }, null, "agent", "tools/jam"])
    const before = readFileSync(join(root, "jam.config.json"), "utf8")
    const again = cli(root, "setup", "--from", "choices.json")
    assert.equal(again.status, 1)
    assert.match(again.stderr, /already exists; setup never replaces it/)
    assert.equal(readFileSync(join(root, "jam.config.json"), "utf8"), before)
    assert.equal(readFileSync(join(root, ".mcp.json"), "utf8"), "existing harness configuration")
    for (const bad of [{ spend: { meshy: { perRun: "none" } } }, { spend: { meshy: { perRun: -1 } } }, { spend: { meshy: {} } }, { version: 1 }]) {
      const fresh = tempProject({ files: { "choices.json": JSON.stringify(bad) } })
      assert.notEqual(cli(fresh, "setup", "--from", "choices.json").status, 0, JSON.stringify(bad))
      assert.equal(existsSync(join(fresh, "jam.config.json")), false, "a wrong choice writes nothing")
    }
  })

  it("setup spells content folders as the project already does: the defaults it prints, and choices written in another letter case", () => {
    const root = tempProject({ files: { "art/hero.png": "x", "Content/readme.md": "x" } })
    const defaults = cli(root, "setup", "--json").json<{ template: { roots: { scratch: string; delivered: string; scan: Array<string> } } }>()
    assert.deepEqual(defaults.template.roots, { scratch: "art/.scratch", delivered: "art/Assets", scan: ["art"] })
    write(root, "choices.json", JSON.stringify({ roots: { scratch: "content/.work", delivered: "content/final", scan: ["content"] } }))
    assert.equal(cli(root, "setup", "--from", "choices.json").status, 0)
    assert.deepEqual(readJson<JamConfig>(root, "jam.config.json").roots, { scratch: "Content/.work", delivered: "Content/final", scan: ["Content"] })
  })

  it("config set changes one validated field: caps, no cap, disabled, the review mode; a wrong value changes nothing", () => {
    const root = jamProject()
    const set = (...args: ReadonlyArray<string>) => cli(root, "config", "set", ...args)
    for (const [path, value, expected] of [["spend.meshy.perRun", "125.5", 125.5], ["spend.scenario.perRun", "none", null], ["spend.scenario.perRun", "0", 0], ["spend.tripo.perRun", "20", 20], ["review.mode", "agent", "agent"], ["style.revision", "v002", "v002"]] as const) {
      const result = set(path, value)
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(cli(root, "config", "show", path, "--json").json<unknown>(), expected)
    }
    assert.deepEqual(readJson<JamConfig>(root, "jam.config.json").spend["tripo"], { perRun: 20 }, "a provider that was not configured is added without touching others")
    assert.equal(readJson<JamConfig>(root, "jam.config.json").budgets["prop"]!.maxMaterials, 1)
    const before = readFileSync(join(root, "jam.config.json"), "utf8")
    for (const args of [["spend.meshy.perRun", "-1"], ["spend.meshy.perRun", "lots"], ["review.mode", "sometimes"], ["revieww.mode", "agent"], ["review.mode"], ["review.mode", "agent", "--remove"], ["spend..perRun", "1"]]) {
      const result = set(...args)
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`)
      assert.equal(readFileSync(join(root, "jam.config.json"), "utf8"), before, args.join(" "))
    }
    assert.match(set("review.mode", "sometimes").stderr, /review\.mode: expected "recipe" \| "agent" \| "none"/)
    assert.equal(set("style.revision", "--remove").status, 0)
    assert.equal(readJson<JamConfig>(root, "jam.config.json").style.revision, undefined)
    write(root, "jam.config.json.lock", "another owner")
    assert.match(set("review.mode", "recipe").stderr, /error: jam\.config\.json\.lock is held by another writer/)
    assert.equal(readJson<JamConfig>(root, "jam.config.json").review.mode, "agent")
  })

  it("machine paths resolve project-relative or absolute, and a bare name stays on PATH", async () => {
    const root = jamProject({ files: { "jam.local.json": JSON.stringify({ python: "env/bin/python", blender: "/opt/blender/blender", providers: { meshy: "bin/meshy" } }) } })
    const found = await jam(root, Effect.gen(function*() {
      const config = yield* Config
      return [yield* config.tool("python"), yield* config.tool("blender"), yield* config.tool("ffmpeg"), yield* config.providerCommand("meshy", "meshy"), yield* config.providerCommand("tripo", "tripo")]
    }))
    assert.deepEqual(found, [join(root, "env/bin/python"), "/opt/blender/blender", "ffmpeg", join(root, "bin/meshy"), "tripo"])
    write(root, "jam.local.json", JSON.stringify({ pyhton: "x" }))
    assert.match((await jamFailure(root, Effect.flatMap(Config, (config) => config.tool("python")))).message, /jam\.local\.json: pyhton: expected no excess property/)
  })
})

describe("migration from version 1", () => {
  it("upgrades a real version 1 configuration: budgets, routes, caps, and the review policy as recipes; nothing is lost", async () => {
    const root = tempProject({ files: { "jam.config.json": V1, "jam.local.json": JSON.stringify({ python: "tools/jam/.venv/bin/python", meshy: "C:/Tools/meshy.cmd" }), "Art/style.md": "style" } })
    const v1 = await loadFailure(root)
    assert.equal(v1.code, "unsupported")
    assert.match(v1.fix!, /jam config migrate/)
    const preview = cli(root, "config", "migrate", "--dry-run", "--json").json<{ migrated: boolean; recipes: Array<string> }>()
    assert.equal(preview.migrated, false)
    assert.equal(readFileSync(join(root, "jam.config.json"), "utf8"), V1, "a dry run writes nothing")
    assert.equal(existsSync(join(root, "jam")), false)

    const result = cli(root, "config", "migrate", "--json")
    assert.equal(result.status, 0, result.stderr)
    const config = await load(root)
    assert.deepEqual(config.roots, { scratch: "Art/.scratch", delivered: "Art/Assets", scan: ["Art"] })
    assert.deepEqual(Object.keys(config.budgets), ["character", "player-base", "prop", "npc", "set-piece"])
    assert.deepEqual(config.budgets["prop"], {
      kind: "static", triangles: { target: 3000, max: 8000 }, textureSize: 1024, maxMaterials: 1, maxTextureMiB: 24,
      context: { platforms: ["Windows", "macOS"], renderer: "Unreal Engine desktop deferred (non-Nanite)", camera: "third-person, about 3.5-4 m behind and 2 m above the player, 75 degree FOV", cameraDistanceMeters: 4, screenCoveragePercent: 10, expectedInstances: 20, materialWorkflow: "pbr" }
    })
    const npc = config.budgets["npc"]!
    assert.deepEqual([npc.kind, npc.maxInfluences, npc.skeleton], ["deforming", 4, "npc"])
    assert.match(npc.poses!, /^A-pose bind pose; plays the prototype's ABP_Player locomotion/)
    // Conventions the profiles carried are kept until an engine adapter supplies them.
    assert.deepEqual(config.engine, {
      adapter: null,
      facts: { authoring: Object.fromEntries(["character", "player-base", "npc"].map((name) => [name, { units: "meters", up: "+Z", forward: "-Y", pivot: "bottom-center" }]).concat(["prop", "set-piece"].map((name) => [name, { units: "meters", up: "+Z", forward: "+X", pivot: "bottom-center" }]))) }
    })
    assert.deepEqual(Object.keys(config.skeletons), ["character", "npc"], "profiles that described the same skeleton share one entry")
    assert.equal(config.budgets["player-base"]!.skeleton, "character")
    assert.match(config.skeletons["npc"]!.notes!, /Manny's bone names, hierarchy, orientations and A-pose/)
    assert.deepEqual(config.routes, { image: "scenario", mesh: "meshy" })
    assert.deepEqual(config.spend, { meshy: { perRun: null, total: null }, scenario: { perRun: 300, total: null }, tripo: { perRun: 20, total: null }, elevenlabs: { perRun: null, total: null } })
    assert.equal(config.review.mode, "recipe")
    assert.deepEqual(readJson(root, "jam.local.json"), { python: "tools/jam/.venv/bin/python", providers: { meshy: "C:/Tools/meshy.cmd" } })

    // The review policy: project default human, with prop, npc and set-piece reviewed by agents.
    const gates = async (id: string) => Object.fromEntries((await jam(root, Effect.flatMap(Recipes, (recipes) => recipes.get(id)))).steps.map((step) => [step.id, step.review]))
    const stages = ["concept", "turnaround", "mesh", "topology", "uv", "texture", "delivery"]
    const all = (gate: string) => Object.fromEntries(stages.map((stage) => [stage, gate]))
    assert.deepEqual(await gates("asset"), all("human"))
    assert.deepEqual(await gates("prop"), { ...all("agent"), collision: "agent", import: "none" })
    assert.deepEqual(await gates("set-piece"), { ...all("agent"), collision: "agent", import: "none" })
    assert.deepEqual(await gates("npc"), { ...all("agent"), rig: "agent", conform: "agent", import: "none" })
    assert.deepEqual(await gates("character"), { ...all("human"), rig: "agent", conform: "agent", import: "none" })
    const setPiece = readJson<{ extends: string; budget: string }>(root, "jam/recipes/set-piece.json")
    assert.deepEqual([setPiece.extends, setPiece.budget], ["builtin:prop", "set-piece"])
    assert.equal(cli(root, "config", "check").status, 0)
    assert.equal(cli(root, "recipe", "check").status, 0)
    assert.match(cli(root, "config", "migrate").stdout, /already version 2/)
  })

  it("an all-agent policy becomes review mode agent; an incomplete profile and a project's own recipe are kept as they are", async () => {
    const v1 = {
      version: 1,
      style: { document: null, references: [] },
      profiles: { Prop: { assetKind: "static", targetTriangles: 100, maxTriangles: 200, textureSize: 512, maxMaterials: 1, maxTextureMiB: 2, units: "meters", up: "+Z", forward: "-Y", pivot: "bottom" }, draft: { renderer: "undecided" } },
      providers: { image: "scenario", mesh: "meshy" },
      review: { default: "agent", stages: {} },
      spend: { meshy: { unit: "credits", limit: 0 } }
    }
    const mine = JSON.stringify({ version: 1, id: "prop", title: "ours", steps: [{ id: "only", review: "none" }] })
    const root = tempProject({ files: { "jam.config.json": JSON.stringify(v1), "jam/recipes/prop.json": mine } })
    const result = cli(root, "config", "migrate", "--json").json<{ kept: Array<string>; notes: Array<string>; recipes: Array<string> }>()
    assert.deepEqual(result.kept, ["jam/recipes/prop.json"])
    assert.equal(readFileSync(join(root, "jam/recipes/prop.json"), "utf8"), mine)
    assert.deepEqual(result.recipes, ["jam/recipes/asset.json"])
    const config = await load(root)
    assert.equal(config.review.mode, "agent")
    assert.deepEqual(Object.keys(config.budgets), ["prop"])
    assert.deepEqual(config.engine.facts.extra, { v1Profiles: { draft: { renderer: "undecided" } } })
    assert.deepEqual(config.spend["meshy"], { perRun: 0, total: null })
    assert.ok(result.notes.some((note) => /profile Prop is budget prop/.test(note)))
    assert.ok(result.notes.some((note) => /profile draft is incomplete/.test(note)))
  })
})
