import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { decode } from "../../src/kernel/decode.ts"
import { ClipSpec } from "../../src/jam/animation/clip.ts"
import { importFor } from "../../src/jam/engine/host.ts"
import { Recipes } from "../../src/jam/recipes/Recipes.ts"
import { deliverRun } from "../../src/jam/runs/deliver.ts"
import { skipStep } from "../../src/jam/runs/review.ts"
import type { Run } from "../../src/jam/runs/schema.ts"
import { cli, glb, jam, jamFailure, jamProject, readJson, write } from "./fixtures.ts"
import { AGENT_MODE, record, recordFailure, review, runFile, start, status, stepStatus } from "./flow.ts"

type Pure = Schema.Codec<unknown, unknown, never, never>
const problem = async (value: unknown): Promise<string> => (await Effect.runPromise(Effect.flip(decode(ClipSpec as Pure, { what: "clip.json" })(value)))).message

const SPEC = {
  id: "walk-loop",
  purpose: "The hero's default walk, looped under player control.",
  rig: { model: "art/hero/hero.glb", map: "art/hero/hero.map.json" },
  fps: 30,
  length: { min: 1, max: 1.2 },
  loop: true,
  root: { mode: "in-place" },
  ground: { kind: "flat" },
  keyPoses: { file: "work/.scratch/walk/1/keyposes.glb", poses: [{ name: "contact-left", time: 0 }, { name: "contact-right", time: 0.5 }] },
  contacts: { detect: { height: 0.03, speed: 0.2 }, planted: [{ limb: "foot.l", from: 0, to: 0.3 }] },
  accept: { footSlide: 0.02, penetration: 0.01, boundaryJump: 0.05, loopSeam: 0.01 }
}

describe("the clip spec", () => {
  it("holds the design's fields, and every threshold must be stated", async () => {
    await Effect.runPromise(decode(ClipSpec as Pure, { what: "clip.json" })(SPEC))
    const { keyPoses: _poses, ...withoutPoses } = SPEC
    const { loopSeam: _seam, ...once } = SPEC.accept
    await Effect.runPromise(decode(ClipSpec as Pure, { what: "clip.json" })({ ...withoutPoses, length: { min: 2, max: 2 }, loop: false, root: { mode: "root-motion", bone: "root" }, ground: { kind: "change", description: "a 30 cm step up at 0.4 s" }, contacts: {}, accept: once }))
    assert.match(await problem({ ...SPEC, accept: { footSlide: 0.02 } }), /penetration/)
    assert.match(await problem({ ...SPEC, accept: once }), /a looping clip needs accept.loopSeam/)
    assert.match(await problem({ ...SPEC, loop: false }), /loopSeam applies to looping clips only/)
    assert.match(await problem({ ...SPEC, root: { mode: "in-place", bone: "root" } }), /root.bone applies to root-motion only/)
    // One shape per field: no short forms.
    for (const short of [{ root: "in-place" }, { ground: "flat" }, { length: 1 }, { keyPoses: SPEC.keyPoses.poses }]) assert.match(await problem({ ...SPEC, ...short }), new RegExp(Object.keys(short)[0]!))
    assert.match(await problem({ ...SPEC, length: { min: 2, max: 1 } }), /length.min must not exceed length.max/)
    assert.match(await problem({ ...SPEC, contacts: { planted: [{ limb: "tail", from: 0, to: 1 }] } }), /contacts/)
    assert.match(await problem({ ...SPEC, contacts: { detect: { height: 0.03 } } }), /speed/)
    const published = JSON.parse(readFileSync(join(import.meta.dirname, "../../schemas/animation-clip.schema.json"), "utf8")) as { $defs: { AnimationClip: { required: Array<string> } } }
    assert.deepEqual(published.$defs.AnimationClip.required, ["id", "purpose", "rig", "fps", "length", "loop", "root", "ground", "accept"])
  })

  // The repository's shared clip-spec fixtures: jam-3d-animate's reader is held to the same list (test/clip-spec-fixtures.test.js).
  const FIXTURES = join(import.meta.dirname, "../../../../../../test/fixtures/clip-specs")
  const fixtures = (kind: "valid" | "invalid") => readdirSync(join(FIXTURES, kind)).filter((name) => name.endsWith(".json")).map((name) => [name, readFileSync(join(FIXTURES, kind, name), "utf8")] as const)
  const read = (text: string): { readonly parsed: true; readonly value: unknown } | { readonly parsed: false } => {
    try {
      return { parsed: true, value: JSON.parse(text) as unknown }
    } catch {
      return { parsed: false }
    }
  }

  it("accepts every shared valid fixture", async () => {
    assert.ok(fixtures("valid").length >= 3)
    for (const [name, text] of fixtures("valid")) {
      const json = read(text)
      assert.ok(json.parsed, `${name} is JSON`)
      await Effect.runPromise(decode(ClipSpec as Pure, { what: name })(json.value))
    }
  })

  it("refuses every shared invalid fixture: as unreadable JSON, as the clip-spec check does, or by the schema", async () => {
    assert.ok(fixtures("invalid").length >= 10)
    for (const [name, text] of fixtures("invalid")) {
      const json = read(text)
      if (!json.parsed) continue
      const outcome = await Effect.runPromise(Effect.result(decode(ClipSpec as Pure, { what: name })(json.value)))
      assert.equal(outcome._tag, "Failure", `${name} is refused`)
    }
    const message = async (name: string) => problem(JSON.parse(readFileSync(join(FIXTURES, "invalid", name), "utf8")))
    assert.match(await message("duplicate-pose-names.json"), /each name once \(contact-left repeated\)/)
    assert.match(await message("poses-out-of-time-order.json"), /in time order/)
    assert.match(await message("pose-past-length-max.json"), /late at 1.5 s after length.max \(1.2 s\)/)
  })
})

// An adapter whose import takes animation clips onto a target and lists what it made.
const ANIMATING = {
  "adapter.json": JSON.stringify({
    id: "anim",
    label: "Animating engine",
    facts: { unitsPerMeter: 1, up: "+Y", forward: "+Z", handedness: "right" },
    commands: { import: { run: ["node", "commands/import.mjs"], kinds: ["skinned", "animation"] } }
  }),
  "commands/import.mjs": `
    const args = process.argv.slice(2)
    const value = (flag) => args[args.indexOf(flag) + 1]
    console.log(JSON.stringify({ assets: [{ id: "/Anim/walk_loop", kind: "animation-sequence", source: args[2], skeleton: value("--target") + "_Skeleton" }], args }))`
}

const IMPORTS = { "static-only": { run: ["node", "commands/import.mjs"], kinds: ["static", "skinned"] }, "no-kinds": { run: ["node", "commands/import.mjs"] } }

const project = (adapter: "anim" | "static-only" | "no-kinds" | null) =>
  jamProject({
    git: true,
    config: { ...AGENT_MODE, engine: { adapter, facts: {} } },
    files: adapter === null ? {} : Object.fromEntries(Object.entries(adapter === "anim" ? ANIMATING : {
      ...ANIMATING,
      "adapter.json": JSON.stringify({ ...JSON.parse(ANIMATING["adapter.json"]), id: adapter, commands: { import: IMPORTS[adapter] } })
    }).map(([path, text]) => [`jam/engines/${adapter}/${path}`, text]))
  })

const sha256 = (root: string, path: string): string => createHash("sha256").update(readFileSync(join(root, path))).digest("hex")

/** Rig, map, spec and a clip; returns the run folder's paths. */
const files = async (root: string) => {
  const dir = "work/.scratch/walk/1"
  write(root, "art/hero/hero.glb", await glb({ triangles: 200 }))
  write(root, "art/hero/hero.map.json", JSON.stringify({ label: "hero", landmarks: { pelvis: "hips" } }))
  write(root, `${dir}/clip.json`, JSON.stringify(SPEC))
  write(root, `${dir}/provider.bvh`, "HIERARCHY\nROOT Hips\n")
  write(root, `${dir}/walk.glb`, await glb({ triangles: 200 }))
  return { dir, spec: `${dir}/clip.json`, raw: `${dir}/provider.bvh`, clip: `${dir}/walk.glb` }
}

describe("the animation recipe", () => {
  it("orders define, key poses, motion, retarget, check, import and delivery, with the skills that do each", async () => {
    const recipe = await jam(jamProject(), Effect.flatMap(Recipes, (recipes) => recipes.get("animation")))
    assert.deepEqual(recipe.steps.map((step) => [step.id, step.skill ?? null, step.optional]), [
      ["define", "jam-3d-animate", false], ["keyposes", "jam-3d-animate", true], ["motion", "jam-3d-animate", false], ["retarget", "jam-3d-retarget", true],
      ["check", "jam-3d-animate", false], ["import", "jam-engine", true], ["delivery", null, false]
    ])
    assert.deepEqual(recipe.steps.find((step) => step.id === "import")!.when, { engine: "import", kind: "animation" })
    assert.deepEqual(recipe.steps.find((step) => step.id === "check")!.checks, ["clip-report"])
  })

  for (const adapter of ["anim", "static-only", "no-kinds", null] as const) {
    it(`runs to delivery ${adapter === "anim" ? "importing the clip onto its target" : adapter === null ? "with no engine" : `skipping the import when the adapter ${adapter === "no-kinds" ? "lists no kinds" : "does not list animation"}`}`, async () => {
      const root = project(adapter)
      await start(root, "animation", "walk")
      const made = await files(root)

      // define: the spec must be valid and name a rig and map that exist; its key-pose file is made at the keyposes step.
      write(root, `${made.dir}/bad.json`, JSON.stringify({ ...readJson(root, made.spec), rig: { ...SPEC.rig, map: "art/hero/missing.json" } }))
      assert.match((await recordFailure(root, "walk", "define", { files: [`spec=${made.dir}/bad.json`], tool: "editor" })).message, /rig.map art\/hero\/missing.json does not exist/)
      await record(root, "walk", "define", { files: [`spec=${made.spec}`], tool: "editor", accept: "the person set the thresholds" })
      await jam(root, skipStep({ run: "walk", step: "keyposes", reason: "a library clip" }))
      await record(root, "walk", "motion", { files: [`clip=${made.raw}`], tool: "provider library clip", accept: "the clip asked for" })
      await record(root, "walk", "retarget", { files: [`clip=${made.clip}`], accept: "on the project rig" })

      // check: a clip report that passed and measured this clip, against the run's spec and the rig it names, with one animation.
      const stamp = (role: string, path: string) => ({ role, path, sha256: sha256(root, path) })
      const report = (name: string, fields: Record<string, unknown>) => {
        write(root, `${made.dir}/${name}.json`, JSON.stringify({
          passed: true, measureOnly: false, clip: stamp("clip", made.clip), spec: stamp("spec", made.spec), animation: "Walk", checks: { animations: { passed: true, names: ["Walk"], measured: "Walk" } },
          rig: { model: stamp("rig", SPEC.rig.model), map: stamp("map", SPEC.rig.map) }, unmeasured: [], ...fields
        }))
        return `evidence=${made.dir}/${name}.json`
      }
      const attempt = (evidence: ReadonlyArray<string>, note = "done") => recordFailure(root, "walk", "check", { files: [`clip=${made.clip}`, ...evidence], accept: "watched", note })
      const other = { role: "x", path: "x", sha256: "0".repeat(64) }
      assert.match((await attempt([report("unmarked", { clip: undefined })])).message, /needs a clip report/)
      assert.match((await attempt([report("failed", { passed: false, failures: ["footSlide", "loopSeam"] })])).message, /the clip failed its check: footSlide; loopSeam/)
      assert.match((await attempt([report("other", { clip: other })])).message, /measured another clip/)
      assert.match((await attempt([report("other-spec", { spec: other })])).message, /against another clip spec than the run's work\/.scratch\/walk\/1\/clip.json/)
      assert.match((await attempt([report("other-rig", { rig: { model: other, map: stamp("map", SPEC.rig.map) } })])).message, /on another rig model than the one/)
      assert.match((await attempt([report("other-map", { rig: { model: stamp("rig", SPEC.rig.model), map: other } })])).message, /on another rig map than the one/)
      assert.match((await attempt([report("two", { checks: { animations: { passed: false, names: ["Walk", "Idle"], measured: "Walk" } } })])).message, /exactly one animation; the clip holds 2 \(Walk, Idle\)/)
      assert.match((await attempt([report("unnamed", { checks: {} })])).message, /the report does not say the clip holds one \(checks.animations\)/)
      assert.match((await attempt([report("measured-only", { measureOnly: true, passed: null })])).message, /only measured the clip \(--measure-only\) and judged nothing/)
      assert.match((await attempt([report("unmeasured", { unmeasured: ["penetration"] })])).message, /could not measure penetration[^]*naming penetration/)
      await record(root, "walk", "check", { files: [`clip=${made.clip}`, report("judged", { unmeasured: ["penetration"] })], accept: "watched", note: "penetration judged from the sheet and video: the feet stay on the step" })
      await record(root, "walk", "check", { files: [`clip=${made.clip}`, report("clip-report", {})], accept: "watched" })
      // A later change to the rig the spec names makes the report stale.
      write(root, SPEC.rig.map, JSON.stringify({ label: "hero", landmarks: { pelvis: "hips", spine_01: "spine" } }))
      assert.match((await stepStatus(root, "walk", "check")).problems?.map((problem) => problem.message).join("\n") ?? "", /on another rig map/)
      write(root, SPEC.rig.map, JSON.stringify({ label: "hero", landmarks: { pelvis: "hips" } }))

      const importStep = await stepStatus(root, "walk", "import")
      if (adapter === "anim") {
        assert.equal(importStep.state, "ready")
        assert.match((await jamFailure(root, importFor({ kind: "animation", files: [], run: "walk" }))).message, /--kind animation needs --target/)
        // The target may be named by the receipt of the skinned import: its first asset is the skinned asset.
        write(root, "work/hero-import.json", JSON.stringify({ assets: [{ id: "/Game/Hero/SK_Hero", kind: "skeletal-mesh" }, { id: "/Game/Hero/T_Hero", kind: "texture" }] }))
        const imported = await jam(root, importFor({ kind: "animation", files: [], run: "walk", target: "work/hero-import.json" }))
        // The sequence is named after the run's clip spec, so clips of different runs never share an engine asset by file name.
        assert.deepEqual(imported.outcome.status === "ran" && imported.outcome.receipt["args"], ["--kind", "animation", made.clip, "--target", "/Game/Hero/SK_Hero", "--name", "walk-loop"])
        const stored = runFile(root, "walk").steps["import"]!.records[0]!
        assert.deepEqual(stored.engineAssets, [{ id: "/Anim/walk_loop", kind: "animation-sequence", source: made.clip, skeleton: "/Game/Hero/SK_Hero_Skeleton" }])
        assert.equal(stored.note, `Imported ${made.clip} as animation onto /Game/Hero/SK_Hero through engine adapter anim.`)
        const shown = cli(root, "engine", "show", "--json").json<{ kinds: Record<string, Array<string>> }>()
        assert.deepEqual(shown.kinds, { import: ["skinned", "animation"] })
      } else {
        assert.equal(importStep.state, "skipped")
        assert.equal(importStep.reason, {
          "static-only": "engine adapter static-only's import command takes static, skinned, not animation",
          "no-kinds": "engine adapter no-kinds's import command lists no kinds, and takes animation only when it lists it",
          null: "no engine adapter is configured, so there is no import command"
        }[String(adapter)])
        assert.equal(importStep.condition!.when, "engine provides import --kind animation")
        // jam engine import agrees with the condition: an adapter imports animation only when it lists it.
        if (adapter !== null) assert.match((await jamFailure(root, importFor({ kind: "animation", files: [made.clip], target: "/Game/Hero/SK_Hero" }))).message, /--kind animation: this adapter (imports static, skinned|lists no kinds, and imports animation only when it lists it)$/)
      }

      await record(root, "walk", "delivery", { files: [`clip=${made.clip}`, `evidence=${made.dir}/clip-report.json`] })
      await review(root, "walk", "delivery", { relay: "chat: ship it" })
      const delivered = readJson<Run>(root, (await jam(root, deliverRun("walk"))).run)
      assert.ok(delivered.steps["delivery"]!.records[0]!.files[0]!.path.endsWith("walk.glb"))
      assert.equal((await status(root, "walk")).next.action, "done")
    })
  }
})

describe("motion routes", () => {
  it("jam provider list shows each motion provider with its modes", () => {
    const listed = cli(jamProject(), "provider", "list", "--json").json<{ providers: Array<{ id: string; capabilities: Array<string>; modes: Record<string, Array<string>>; transports: Array<string>; spend: { summary: string } }> }>().providers
    const motion = Object.fromEntries(listed.filter((row) => row.capabilities.includes("motion")).map((row) => [row.id, row.modes["motion"]]))
    assert.deepEqual(motion, { meshy: ["library", "text"], motionbricks: ["inbetween"], scenario: ["library", "text", "video"], tripo: ["library"] })
    const bricks = listed.find((row) => row.id === "motionbricks")!
    assert.deepEqual([bricks.transports, bricks.spend.summary], [["skill"], "not billed per job (compute the person runs, own or rented; no charge per job)"])
    const text = cli(jamProject(), "provider", "list").stdout
    assert.match(text, /motionbricks +motion \(inbetween\)/)
    assert.match(text, /meshy +mesh \(single, multiview\), motion \(library, text\)/)
  })

  it("a motion mode outside the four is refused", async () => {
    const root = jamProject({ files: { "jam/providers/dance.json": JSON.stringify({ id: "dance", label: "Dance", unit: { id: "x", label: "x", paid: true }, capabilities: { motion: { modes: ["dance"] } }, transports: [] }) } })
    const listed = cli(root, "provider", "list", "--json")
    assert.notEqual(listed.status, 0)
    assert.match(listed.stderr, /capabilities\.motion\.modes\[0\]/)
  })
})
