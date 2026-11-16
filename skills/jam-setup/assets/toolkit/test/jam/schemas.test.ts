import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { decode } from "../../src/kernel/decode.ts"
import { JamConfig } from "../../src/jam/config/schema.ts"
import { Adapter } from "../../src/jam/engine/schema.ts"
import { PUBLISHED, renderSchemas } from "../../src/jam/reference.ts"
import { CORE_LANDMARKS, LANDMARK_PARENT, LandmarkFile, LANDMARKS, SkeletonProfile, skeletonNamed } from "../../src/jam/rig/landmarks.ts"
import { tempProject } from "../support.ts"
import { cli, TOOLKIT } from "./fixtures.ts"

const read = (path: string): unknown => JSON.parse(readFileSync(join(TOOLKIT, path), "utf8"))
type Pure = Schema.Codec<unknown, unknown, never, never>
const valid = <A>(schema: Schema.Top, value: unknown, what: string): Promise<A> => Effect.runPromise(decode(schema as Pure, { what })(value)) as Promise<A>
const problem = async (schema: Schema.Top, value: unknown): Promise<string> => (await Effect.runPromise(Effect.flip(decode(schema as Pure, { what: "value" })(value)))).message

describe("published schemas", () => {
  it("the committed schemas and command reference match the toolkit's definitions", () => {
    for (const file of renderSchemas()) assert.equal(readFileSync(join(TOOLKIT, file.path), "utf8"), file.text, `${file.path} is out of date: run "jam schemas write"`)
    const check = cli(tempProject(), "schemas", "check")
    assert.equal(check.status, 0, `${check.stderr}\nrun "node jam.mjs schemas write" in the toolkit and commit the result`)
    const committed = readdirSync(join(TOOLKIT, "schemas"))
    for (const entry of PUBLISHED) assert.ok(committed.includes(entry.file), `schemas/${entry.file} is committed`)
  })

  it("are closed JSON Schemas that name what is required", () => {
    const recipe = read("schemas/recipe.schema.json") as { $schema: string; $defs: Record<string, { required: Array<string>; additionalProperties: boolean; properties: Record<string, unknown> }> }
    assert.equal(recipe.$schema, "https://json-schema.org/draft/2020-12/schema")
    assert.deepEqual([recipe.$defs["Recipe"]!.required, recipe.$defs["Recipe"]!.additionalProperties], [["version", "id", "steps"], false])
    assert.ok("when" in recipe.$defs["Recipe"]!.properties && "extends" in recipe.$defs["Recipe"]!.properties)
    const adapter = JSON.stringify(read("schemas/engine-adapter.schema.json"))
    for (const expected of ["conform-skeleton", "unitsPerMeter", "upper-arm.l", "skeletons"]) assert.ok(adapter.includes(expected), expected)
    const landmarks = read("schemas/landmarks.schema.json") as { $defs: { LandmarkFile: { properties: { landmarks: { required: Array<string> } } } } }
    assert.deepEqual(landmarks.$defs.LandmarkFile.properties.landmarks.required, CORE_LANDMARKS)
  })

  it("every data file the toolkit ships validates, and its $schema pointer leads to a published schema", async () => {
    for (const folder of ["recipes", "providers", "engines"]) {
      for (const name of readdirSync(join(TOOLKIT, folder)).filter((file) => file.endsWith(".json"))) {
        const data = read(`${folder}/${name}`) as { $schema?: string; id: string }
        assert.equal(data.id, name.slice(0, -5), `${folder}/${name}: id matches the file name`)
        assert.ok(data.$schema !== undefined && existsSync(join(TOOLKIT, folder, data.$schema)), `${folder}/${name}: $schema ${data.$schema} exists`)
        if (folder === "engines") await valid(Adapter, data, `${folder}/${name}`)
      }
    }
    const defaults = await valid<typeof JamConfig.Type>(JamConfig, read("defaults/config.json"), "defaults/config.json")
    assert.deepEqual([defaults.spend, defaults.engine.adapter, defaults.review.mode], [{}, null, "recipe"], "a new project starts with paid work disabled, no engine and the recipes' own gates")
    assert.equal(dirname(defaults.roots.scratch), dirname(defaults.roots.delivered))
  })
})

describe("engine adapters that ship beside the toolkit", () => {
  // The adapter skills live in the same repository; an installed toolkit does not carry them.
  const ADAPTERS = ["../../../jam-engine-unreal/adapter", "../../../jam-engine/assets/example-adapter"].map((path) => join(TOOLKIT, path))

  it("validate against the adapter schema, and every guide they name exists", { skip: ADAPTERS.every((dir) => existsSync(dir)) ? false : "the adapter skills are not in this checkout" }, async () => {
    for (const dir of ADAPTERS) {
      const adapter = await valid<typeof Adapter.Type>(Adapter, JSON.parse(readFileSync(join(dir, "adapter.json"), "utf8")), `${dir}/adapter.json`)
      for (const [topic, guide] of Object.entries(adapter.docs ?? {})) assert.ok(existsSync(join(dir, guide.split("#")[0]!)), `${adapter.id}: docs.${topic} -> ${guide}`)
      for (const [name, command] of Object.entries(adapter.commands ?? {})) {
        const script = command?.run.find((token) => /\.(py|mjs|js)$/.test(token))
        if (script !== undefined) assert.ok(existsSync(join(dir, script)), `${adapter.id}: command ${name} runs ${script}`)
      }
    }
  })

  it("the shipped presets state the four core conventions, cite sources at the top level, and have a guide with a section per topic they name", async () => {
    for (const name of readdirSync(join(TOOLKIT, "engines")).filter((file) => file.endsWith(".json"))) {
      const preset = await valid<typeof Adapter.Type>(Adapter, read(`engines/${name}`), name)
      for (const fact of ["unitsPerMeter", "up", "forward", "handedness"] as const) assert.ok(preset.facts[fact] !== undefined, `${name}: ${fact}`)
      assert.equal((preset.facts.extra as Record<string, unknown> | undefined)?.["sources"], undefined, `${name}: sources are not hidden under extra`)
      assert.deepEqual(Object.values(preset.commands ?? {}).filter((command) => command !== null), [], `${name}: a preset runs nothing`)
      for (const [topic, guide] of Object.entries(preset.docs ?? {})) {
        const text = readFileSync(join(TOOLKIT, "engines", guide), "utf8")
        assert.match(text, new RegExp(`^## ${topic}\\b`, "im"), `${name}: ${guide} has a section on ${topic}`)
      }
    }
  })
})

describe("the landmark vocabulary", () => {
  const core = Object.fromEntries(CORE_LANDMARKS.map((name, index) => [name, [index * 0.01, 1, 0]]))

  it("is the fixed joint set: a spine chain, four limbs with sides, and optional finger chains", () => {
    assert.equal(CORE_LANDMARKS.length, 5 + 8 * 2)
    assert.equal(LANDMARKS.length, CORE_LANDMARKS.length + 5 * 3 * 2)
    assert.deepEqual(["hips", "head", "hand.l", "toes.r", "index-1.l", "index-3.l"].map((name) => LANDMARK_PARENT[name]), [null, "neck", "lower-arm.l", "foot.r", "hand.l", "index-2.l"])
  })

  it("a landmark file gives every core joint in meters; a profile maps the landmarks a skeleton has to its bone names", async () => {
    await valid(LandmarkFile, { units: "meters", up: "+Y", landmarks: { ...core, "thumb-1.l": [0.4, 1.2, 0.05] }, source: "auto-rig of the mesh provider" }, "landmarks")
    const { hips: _hips, ...headless } = core
    assert.match(await problem(LandmarkFile, { units: "meters", up: "+Y", landmarks: headless, source: "x" }), /landmarks\.hips: missing/i)
    assert.match(await problem(LandmarkFile, { units: "centimeters", up: "+Y", landmarks: core, source: "x" }), /units: expected "meters"/)
    assert.match(await problem(LandmarkFile, { units: "meters", up: "+Y", landmarks: { ...core, tail: [0, 0, 0] }, source: "x" }), /landmarks\.tail: expected no excess property/)
    const profile = await valid<typeof SkeletonProfile.Type>(SkeletonProfile, { label: "Studio rig", reference: "rigs/studio.glb", bones: { hips: "Pelvis", "upper-arm.l": "L_UpperArm" }, hierarchy: { Pelvis: null, L_UpperArm: "L_Clavicle" } }, "profile")
    assert.equal(profile.bones["upper-arm.l"], "L_UpperArm")
    assert.match(await problem(SkeletonProfile, { bones: { pelvis: "Pelvis" } }), /bones\.pelvis: expected no excess property/)
  })

  it("a budget's skeleton is the project's own profile first, then the engine adapter's", () => {
    const project = { rig: { bones: { hips: "ours" } } }
    const adapter = { rig: { bones: { hips: "theirs" } }, biped: { bones: { hips: "pelvis" } } }
    assert.equal(skeletonNamed("rig", project, adapter)!.bones.hips, "ours")
    assert.equal(skeletonNamed("biped", project, adapter)!.bones.hips, "pelvis")
    assert.equal(skeletonNamed("ghost", project, adapter), undefined)
    assert.equal(skeletonNamed("biped", {}, undefined), undefined)
  })
})
