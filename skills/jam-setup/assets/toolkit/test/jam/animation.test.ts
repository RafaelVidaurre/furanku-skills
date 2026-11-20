import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
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

const project = (adapter: "anim" | "static-only" | null) =>
  jamProject({
    git: true,
    config: { ...AGENT_MODE, engine: { adapter, facts: {} } },
    files: adapter === null ? {} : Object.fromEntries(Object.entries(adapter === "anim" ? ANIMATING : {
      ...ANIMATING,
      "adapter.json": JSON.stringify({ ...JSON.parse(ANIMATING["adapter.json"]), id: "static-only", commands: { import: { run: ["node", "commands/import.mjs"], kinds: ["static", "skinned"] } } })
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

  for (const adapter of ["anim", "static-only", null] as const) {
    it(`runs to delivery ${adapter === "anim" ? "importing the clip onto its target" : adapter === null ? "with no engine" : "skipping the import when the adapter does not list animation"}`, async () => {
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

      // check: a clip report that passed and measured this clip.
      const report = (name: string, fields: Record<string, unknown>) => {
        write(root, `${made.dir}/${name}.json`, JSON.stringify({ passed: true, clip: { role: "clip", path: made.clip, sha256: sha256(root, made.clip) }, ...fields }))
        return `evidence=${made.dir}/${name}.json`
      }
      const attempt = (evidence: ReadonlyArray<string>) => recordFailure(root, "walk", "check", { files: [`clip=${made.clip}`, ...evidence], accept: "watched" })
      assert.match((await attempt([report("unmarked", { clip: undefined })])).message, /needs a clip report/)
      assert.match((await attempt([report("failed", { passed: false, failures: ["footSlide", "loopSeam"] })])).message, /the clip failed its check: footSlide; loopSeam/)
      assert.match((await attempt([report("other", { clip: { role: "clip", path: "x.glb", sha256: "0".repeat(64) } })])).message, /measured another clip/)
      await record(root, "walk", "check", { files: [`clip=${made.clip}`, report("clip-report", {})], accept: "watched" })

      const importStep = await stepStatus(root, "walk", "import")
      if (adapter === "anim") {
        assert.equal(importStep.state, "ready")
        assert.match((await jamFailure(root, importFor({ kind: "animation", files: [], run: "walk" }))).message, /--kind animation needs --target/)
        // The target may be named by the receipt of the skinned import: its first asset is the skinned asset.
        write(root, "work/hero-import.json", JSON.stringify({ assets: [{ id: "/Game/Hero/SK_Hero", kind: "skeletal-mesh" }, { id: "/Game/Hero/T_Hero", kind: "texture" }] }))
        const imported = await jam(root, importFor({ kind: "animation", files: [], run: "walk", target: "work/hero-import.json" }))
        assert.deepEqual(imported.outcome.status === "ran" && imported.outcome.receipt["args"], ["--kind", "animation", made.clip, "--target", "/Game/Hero/SK_Hero"])
        const stored = runFile(root, "walk").steps["import"]!.records[0]!
        assert.deepEqual(stored.engineAssets, [{ id: "/Anim/walk_loop", kind: "animation-sequence", source: made.clip, skeleton: "/Game/Hero/SK_Hero_Skeleton" }])
        assert.equal(stored.note, `Imported ${made.clip} as animation onto /Game/Hero/SK_Hero through engine adapter anim.`)
        const shown = cli(root, "engine", "show", "--json").json<{ kinds: Record<string, Array<string>> }>()
        assert.deepEqual(shown.kinds, { import: ["skinned", "animation"] })
      } else {
        assert.equal(importStep.state, "skipped")
        assert.equal(importStep.reason, adapter === null ? "no engine adapter is configured, so there is no import command" : "engine adapter static-only's import command takes static, skinned, not animation")
        assert.equal(importStep.condition!.when, "engine provides import --kind animation")
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
    assert.deepEqual([bricks.transports, bricks.spend.summary], [["skill"], "not billed per job (time on an NVIDIA GPU the person runs, own or rented; no charge per job)"])
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
