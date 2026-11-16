import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { Measure } from "../../src/jam/measure/Measure.ts"
import { cli, glb, jam, jamFailure, jamProject, png, TOOLKIT, turnaround, write } from "./fixtures.ts"
import { AGENT_MODE, record, recordFailure, start } from "./flow.ts"

const measure = (root: string, path: string) => jam(root, Effect.flatMap(Measure, (service) => service.file(path)))
const measureFailure = (root: string, path: string) => jamFailure(root, Effect.flatMap(Measure, (service) => service.file(path)))

// Add vendor metadata to a real decoder-generated GLB without changing its buffers.
const withExtension = (bytes: Uint8Array, name: string, options: { required?: boolean; payload?: unknown } = {}): Buffer => {
  const source = Buffer.from(bytes)
  const size = source.readUInt32LE(12)
  const json = JSON.parse(source.subarray(20, 20 + size).toString()) as { extensionsUsed?: Array<string>; extensionsRequired?: Array<string>; meshes: Array<{ primitives: Array<{ extensions?: Record<string, unknown> }> }> }
  json.extensionsUsed = [name]
  if (options.required) json.extensionsRequired = [name]
  json.meshes[0]!.primitives[0]!.extensions = { [name]: options.payload ?? {} }
  const text = Buffer.from(JSON.stringify(json))
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32)
  text.copy(padded)
  const header = Buffer.from(source.subarray(0, 20))
  const tail = source.subarray(20 + size)
  header.writeUInt32LE(20 + padded.length + tail.length, 8)
  header.writeUInt32LE(padded.length, 12)
  return Buffer.concat([header, padded, tail])
}

describe("measurement", () => {
  it("counts rendered instances, strip and fan triangles, materials and embedded texture memory", async () => {
    const root = jamProject()
    for (const mode of [4, 5, 6]) {
      write(root, `m/${mode}.glb`, await glb({ mode, triangles: 2, instances: 3, texture: 1 }))
      const result = await measure(root, `m/${mode}.glb`)
      assert.ok(result.kind === "model")
      assert.deepEqual([result.triangles, result.materials, result.drawPrimitives, result.textureDimensions, result.textureMiB], [6, 1, 3, [[1, 1]], 4 / 1048576], `mode ${mode}`)
    }
    write(root, "m/image.png", png(12, 7))
    assert.deepEqual(await measure(root, "m/image.png"), { kind: "image", sha256: (await measure(root, "m/image.png")).sha256, size: [12, 7] })
    const shown = cli(root, "measure", "m/4.glb")
    assert.match(shown.stdout, /triangles {8}6\nmaterials {8}1/)
    assert.equal(cli(root, "measure", "m/4.glb", "--json").json<{ triangles: number }>().triangles, 6)
  })

  it("refuses what it cannot count rather than undercount: points, unknown extensions, a required or malformed polygon marker, other formats", async () => {
    const root = jamProject()
    write(root, "m/points.glb", await glb({ mode: 0, triangles: 1 }))
    assert.match((await measureFailure(root, "m/points.glb")).message, /m\/points\.glb: measurement needs triangle primitives/)
    const source = await glb({ triangles: 1 })
    for (const [name, options, expected] of [["EXT_meshopt_compression", {}, /extensions measurement does not understand: EXT_meshopt_compression/], ["FB_ngon_encoding", { required: true }, /requires FB_ngon_encoding/], ["FB_ngon_encoding", { payload: { geometry: "unknown" } }, /invalid FB_ngon_encoding marker/]] as const) {
      write(root, "m/extension.glb", withExtension(source, name, options))
      const error = await measureFailure(root, "m/extension.glb")
      assert.match(error.message, expected)
      assert.equal(error.code, "unsupported")
    }
    write(root, "m/model.fbx", "not measurable here")
    assert.match((await measureFailure(root, "m/model.fbx")).fix!, /attach the report as evidence labelled measurement/)
    write(root, "m/broken.glb", "not a glb")
    assert.equal((await measureFailure(root, "m/broken.glb")).code, "malformed")
    assert.equal((await measureFailure(root, "../outside.glb")).code, "forbidden")
  })

  it("tolerates optional polygon-reconstruction metadata, counting rendered triangles and leaving the file untouched", async () => {
    const root = jamProject()
    const bytes = withExtension(await glb({ triangles: 2, instances: 2 }), "FB_ngon_encoding")
    write(root, "m/vendor.glb", bytes)
    const result = await measure(root, "m/vendor.glb")
    assert.ok(result.kind === "model")
    assert.deepEqual([result.triangles, result.exportedVertices, result.ignoredExtensions], [4, 8, ["FB_ngon_encoding"]])
    assert.deepEqual(readFileSync(join(root, "m/vendor.glb")), bytes)
  })

  it("a model in another format is recorded with a measurement report bound to its exact hash", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "chair", { budget: "prop", from: "topology" })
    const dir = "work/.scratch/chair/1"
    write(root, `${dir}/chair.fbx`, "fbx bytes")
    write(root, `${dir}/origin.md`, "made in-house")
    const { sha256 } = await import("../../src/kernel/hash.ts")
    const report = (hash: string, triangles: number) => write(root, `${dir}/report.json`, JSON.stringify({ model: { path: `${dir}/chair.fbx`, sha256: hash }, tool: "Blender 4.2", command: "stats.py", metrics: { triangles, materials: 1 } }))
    const input = { files: [`model=${dir}/chair.fbx`], evidence: [`measurement=${dir}/report.json`], source: "studio", sourceEvidence: `${dir}/origin.md` }
    assert.match((await recordFailure(root, "chair", "topology", { ...input, evidence: [] })).message, /has nothing measured/)
    report("wrong-hash", 1500)
    assert.match((await recordFailure(root, "chair", "topology", input)).message, /naming one of this record's files by its exact hash/)
    report(sha256("fbx bytes"), 2500)
    assert.match((await recordFailure(root, "chair", "topology", input)).message, /2500 triangles is over the budget of 2000/)
    report(sha256("fbx bytes"), 1500)
    const recorded = await record(root, "chair", "topology", { ...input, accept: "ok" })
    assert.deepEqual([recorded.metrics!.basis, recorded.metrics!.triangles, recorded.metrics!.model], ["report", 1500, `${dir}/chair.fbx`])
  })
})

describe("the turnaround check", () => {
  const pillow = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", "import PIL"]).status === 0

  it("needs five distinct views on equal canvases; a declared symmetric subject may reuse a side view", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "barrel", { budget: "prop" })
    const dir = "work/.scratch/barrel/1"
    write(root, `${dir}/concept.png`, png(4, 4))
    await record(root, "barrel", "concept", { files: [`${dir}/concept.png`], accept: "ok" })
    const views = turnaround(root, `${dir}/views`)
    write(root, `${dir}/views/back.png`, png(8, 9, [1, 2, 3]))
    assert.match((await recordFailure(root, "barrel", "turnaround", { files: views, symmetric: true })).message, /the views have different canvases \(8x8, 8x9\)/)
    write(root, `${dir}/views/back.png`, png(8, 8, [1, 2, 3]))
    const reused = views.map((view) => (view.startsWith("view:right=") ? `view:right=${dir}/views/left.png` : view))
    assert.match((await recordFailure(root, "barrel", "turnaround", { files: reused })).message, /two views are the same image .*record with --symmetric/)
    const recorded = await record(root, "barrel", "turnaround", { files: reused, symmetric: true, accept: "a barrel looks the same from both sides" })
    assert.equal(recorded.records[0]!.state, "accepted")
  })

  it("reads the crop tool's report for the facing of the side views", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "knight", { budget: "prop" })
    const dir = "work/.scratch/knight/1"
    write(root, `${dir}/concept.png`, png(4, 4))
    await record(root, "knight", "concept", { files: [`${dir}/concept.png`], accept: "ok" })
    const views = turnaround(root, `${dir}/views`)
    const { sha256 } = await import("../../src/kernel/hash.ts")
    const hash = (view: string) => sha256(readFileSync(join(root, `${dir}/views/${view}.png`)))
    const report = (facing: unknown) => write(root, `${dir}/views/crops.json`, JSON.stringify({ views: { left: { sha256: hash("left") }, right: { sha256: hash("right") } }, sideFacing: facing }))
    report({ asDrawn: 0.91, mirrored: 0.62 })
    assert.match((await recordFailure(root, "knight", "turnaround", { files: views, evidence: [`${dir}/views/crops.json`] })).message, /left and right views face the same way \(silhouette overlap as drawn 0\.91, mirrored 0\.62\)/)
    report({ asDrawn: 0.55, mirrored: 0.93 })
    assert.equal((await record(root, "knight", "turnaround", { files: views, evidence: [`${dir}/views/crops.json`], accept: "ok" })).records[0]!.state, "accepted")
  })

  it("crops a sheet into views with the shipped tool and records them from its report", { skip: pillow ? false : "Pillow is not installed" }, async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "asset", "knight", { budget: "prop" })
    const dir = "work/.scratch/knight/1"
    // A sheet whose right view mirrors its left, drawn by the same helper the Python tests use.
    const made = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", `
import sys; sys.path.insert(0, ${JSON.stringify(join(TOOLKIT, "test"))})
from test_crop import figure_sheet
figure_sheet().save(sys.argv[1]); figure_sheet(right_mirrored=False).save(sys.argv[2])`, join(root, "sheet.png"), join(root, "same-way.png")], { encoding: "utf8" })
    assert.equal(made.status, 0, made.stderr)
    write(root, "layout.json", JSON.stringify(Object.fromEntries(["front", "left", "back", "right", "three-quarter"].map((view, index) => [view, [index * 7, 0, 7, 9]]))))
    write(root, `${dir}/concept.png`, png(4, 4))
    await record(root, "knight", "concept", { files: [`${dir}/concept.png`], accept: "ok" })
    const same = cli(root, "crop", "same-way.png", "layout.json", `${dir}/same`)
    assert.equal(same.status, 2)
    assert.match(same.stderr, /left and right views face the same way/)
    const cropped = cli(root, "crop", "sheet.png", "layout.json", `${dir}/views`, "--json")
    assert.equal(cropped.status, 0, cropped.stderr)
    const flags = cropped.json<{ record: string }>().record.split(" ")
    const files = flags.filter((_, index) => flags[index - 1] === "--file")
    const evidence = flags.filter((_, index) => flags[index - 1] === "--evidence")
    assert.equal((await record(root, "knight", "turnaround", { files, evidence, accept: "ok" })).records[0]!.state, "accepted")
    // Without the report the check measures the facing itself.
    assert.equal((await record(root, "knight", "turnaround", { files, accept: "ok" })).records[0]!.state, "accepted")
  })
})

describe("project checks", () => {
  it("run a configured command with the record's files substituted and take its problems", async () => {
    const check = `
      import { readFileSync } from "node:fs"
      const [model, step, id] = process.argv.slice(2)
      const size = readFileSync(model).length
      console.log(JSON.stringify({ problems: size > 2000 ? [] : [{ message: step + " of " + id + ": " + model + " is only " + size + " bytes", fix: "export it again" }] }))`
    const root = jamProject({
      config: { ...AGENT_MODE, checks: { "not-empty": { run: ["node", "tools/check.mjs", "{file:model}", "{step}", "{id}"] }, noisy: { run: ["node", "-e", "console.log('hello')"] }, crash: { run: ["node", "-e", "process.exit(4)"] } } },
      files: {
        "tools/check.mjs": check,
        "jam/recipes/part.json": JSON.stringify({ version: 1, id: "part", steps: [{ id: "model", produces: [{ role: "model", kind: "model", max: 1 }], checks: ["not-empty"] }, { id: "noisy", checks: ["noisy"] }, { id: "crash", checks: ["crash"] }] })
      }
    })
    await start(root, "part", "bolt")
    write(root, "work/.scratch/bolt/1/tiny.glb", await glb({ triangles: 1 }))
    const refused = await recordFailure(root, "bolt", "model", { files: ["work/.scratch/bolt/1/tiny.glb"] })
    assert.match(refused.message, /model of bolt: work\/\.scratch\/bolt\/1\/tiny\.glb is only \d+ bytes \(fix: export it again\)/)
    write(root, "work/.scratch/bolt/1/real.glb", await glb({ triangles: 800 }))
    assert.equal((await record(root, "bolt", "model", { files: ["work/.scratch/bolt/1/real.glb"], accept: "ok" })).records[0]!.state, "accepted")
    assert.match((await recordFailure(root, "bolt", "noisy", {})).message, /check noisy must print \{"problems": \[\.\.\.\]\}; it printed: hello/)
    assert.match((await recordFailure(root, "bolt", "crash", {})).message, /check crash could not run \(exit 4\)/)
  })

  it("a check another part of the toolkit supplies runs for real: a file that never went through the audio tools is refused, not passed", async () => {
    const root = jamProject({ config: AGENT_MODE })
    await start(root, "sfx", "door-slam")
    write(root, "work/.scratch/door-slam/1/take.wav", "RIFF")
    await record(root, "door-slam", "generate", { files: ["work/.scratch/door-slam/1/take.wav"], accept: "ok" })
    assert.match((await recordFailure(root, "door-slam", "process", { files: ["work/.scratch/door-slam/1/take.wav"] })).message, /step process did not pass its checks: .*take\.wav is not a processed take or variant of a sound or line/)
  })
})
