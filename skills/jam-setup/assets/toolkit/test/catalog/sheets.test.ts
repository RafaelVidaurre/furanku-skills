// Sprite sheets: an image a link cuts into animation frames. The sheet is checked when sources
// load, shown with the link, frozen with the image in a review, and part of what "changed since
// its verdict" compares.
import assert from "node:assert/strict"
import { test } from "node:test"
import { frameCount, isSheet, mediaDigest, parseSheet, sheetDuration } from "../../src/catalog/model/sheet.ts"
import { cleanup, makeProject, open, png, read, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const spriteType = {
  label: "Character",
  thumb: "animation",
  fields: [{ key: "speed", label: "Speed", kind: "number" }],
  roles: [{ key: "animation", label: "Animation", mediaKinds: ["image"], many: true }]
}
const walk = { fps: 12, grid: { columns: 4, rows: 2 } }

test("a sheet is a grid or frames, written out with its defaults so equal layouts share a digest", () => {
  const grid = parseSheet(walk)
  assert.deepEqual(grid, { ok: { fps: 12, loop: true, grid: { columns: 4, rows: 2, start: 0, count: 8, origin: [0, 0], gap: [0, 0] } } })
  assert.ok("ok" in grid && isSheet(grid.ok))
  assert.equal(isSheet(walk), false, "a stored sheet is the written-out form")
  const same = parseSheet({ fps: 12, loop: true, grid: { columns: 4, rows: 2, start: 0, count: 8 } })
  assert.ok("ok" in grid && "ok" in same && mediaDigest("a".repeat(64), grid.ok) === mediaDigest("a".repeat(64), same.ok))
  assert.equal(mediaDigest("a".repeat(64), undefined), "a".repeat(64), "media without a sheet keeps its bytes' digest")

  const trimmed = parseSheet({ fps: 20, loop: false, frames: [{ region: [90, 159, 135, 132], offset: [90, 159], size: [320, 320] }, { region: [411, 158, 134, 133], offset: [91, 158], size: [320, 320], duration: 2 }] })
  assert.ok("ok" in trimmed)
  if ("ok" in trimmed) {
    assert.equal(frameCount(trimmed.ok), 2)
    assert.equal(sheetDuration(trimmed.ok), 3 / 20)
  }
  const row = parseSheet({ fps: 10, grid: { columns: 8, rows: 4, start: 8, count: 8 }, durations: [1, 1, 1, 1, 1, 1, 1, 3] })
  assert.ok("ok" in row && sheetDuration(row.ok) === 1)

  const refused: ReadonlyArray<readonly [unknown, RegExp]> = [
    [{ grid: { columns: 4 } }, /fps/],
    [{ fps: 0, grid: { columns: 4 } }, /fps/],
    [{ fps: 12 }, /either grid or frames/],
    [{ fps: 12, grid: { columns: 4 }, frames: [] }, /either grid or frames/],
    [{ fps: 12, grid: { columns: 4, rows: 2, start: 6, count: 4 } }, /grid.count/],
    [{ fps: 12, grid: { columns: 4, cell: [0, 32] } }, /grid.cell/],
    [{ fps: 12, grid: { columns: 4 }, durations: [1, 1] }, /durations/],
    [{ fps: 12, frames: [{ region: [0, 0, 32] }] }, /frames\[0\].region/],
    [{ fps: 12, frames: [{ region: [0, 0, 32, 32], offset: [8, 0], size: [32, 32] }] }, /does not fit/],
    [{ fps: 12, frames: [{ region: [0, 0, 32, 32], pivot: [0, 0] }] }, /unknown fields: pivot/],
    [{ fps: 12, grid: { columns: 4 }, speed: 2 }, /unknown fields: speed/]
  ]
  for (const [value, reason] of refused) {
    const parsed = parseSheet(value)
    assert.ok("error" in parsed, JSON.stringify(value))
    if ("error" in parsed) assert.match(parsed.error, reason)
  }
})

test("links carry their sheet; one image can be two animations; a bad sheet is a problem and the image stays", async () => {
  const dir = await makeProject({
    assets: { "art/wolf.png": png(16, 8), "art/wolf.glb": "not a model" },
    units: [{
      id: "char/wolf",
      type: "character",
      name: "Wolf",
      links: [
        { role: "animation", asset: "art/wolf.png", key: "walk", label: "Walk", sheet: { fps: 12, grid: { columns: 4, rows: 2, count: 4 } } },
        { role: "animation", asset: "art/wolf.png", key: "bite", sheet: { fps: 15, grid: { columns: 4, rows: 2, start: 4 } } },
        { role: "animation", asset: "art/wolf.png", key: "broken", sheet: { fps: -1, grid: { columns: 4 } } }
      ]
    }],
    extra: { types: { character: spriteType } }
  })
  const app = await open(dir)
  try {
    const unit = await app.run("unit.get", { id: "char/wolf" })
    assert.deepEqual(unit.links.map((link: Any) => [link.part, link.sheet?.fps ?? null]), [["animation:walk", 12], ["animation:bite", 15], ["animation:broken", null]])
    assert.deepEqual(unit.links[1].sheet.grid, { columns: 4, rows: 2, start: 4, count: 4, origin: [0, 0], gap: [0, 0] })
    assert.deepEqual(unit.review.parts.map((part: Any) => part.id), ["animation:walk", "animation:bite", "animation:broken", "attributes"])
    // A link's label is what the unit calls the file; the part keeps its key, and its label says the name.
    assert.deepEqual([unit.links[0].label, unit.links[1].label], ["Walk", undefined])
    assert.deepEqual(unit.review.parts.slice(0, 2).map((part: Any) => part.label), ["Animation · Walk", "Animation · wolf"])
    const problems = await app.run("problems", {})
    assert.ok(problems.problems.some((problem: Any) => /char\/wolf: sheet of art\/wolf.png: fps must be/.test(problem.error)), JSON.stringify(problems.problems))
  } finally {
    cleanup(dir)
  }
})

test("a sheet on media that is not an image is refused and left off", async () => {
  const dir = await makeProject({
    assets: { "art/clip.mp4": Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(12)]) },
    units: [{ id: "char/clip", type: "clip", name: "Clip", links: [{ role: "clip", asset: "art/clip.mp4", sheet: walk }] }],
    extra: { types: { clip: { label: "Clip", fields: [], roles: [{ key: "clip", label: "Clip", mediaKinds: ["video"] }] } } }
  })
  const app = await open(dir)
  try {
    const unit = await app.run("unit.get", { id: "char/clip" })
    assert.equal(unit.links[0].sheet, undefined)
    const problems = await app.run("problems", {})
    assert.ok(problems.problems.some((problem: Any) => /a sheet cuts an image, and this is video/.test(problem.error)))
  } finally {
    cleanup(dir)
  }
})

test("a review freezes the sheet with the image; new timing marks the part changed and compares as different", async () => {
  const unitFile = "content/char_wolf.json"
  const dir = await makeProject({
    assets: { "art/wolf.png": png(16, 8) },
    units: [{ id: "char/wolf", type: "character", name: "Wolf", links: [{ role: "animation", asset: "art/wolf.png", key: "walk", sheet: walk }] }],
    extra: { types: { character: spriteType } }
  })
  const app = await open(dir)
  const run = W(app)
  try {
    const submitted = await run("review.submit", { items: [{ target: { kind: "unit", id: "char/wolf" } }] })
    const review = await app.run("review.get", { submission: submitted.submission.id })
    const part = review.items[0].parts.find((candidate: Any) => candidate.id === "animation:walk")
    assert.equal(part.evidence.sheet.fps, 12)
    assert.equal(part.leaves[0].sheet.fps, 12, "the page plays frozen evidence with the sheet it was reviewed as")
    assert.notEqual(part.evidence.digest, part.evidence.sha256)
    const stored = read(dir, `.catalog/reviews/${submitted.submission.id}/submission.json`)
    assert.equal(JSON.stringify(stored).includes("\"sheet\""), true)

    await run("review.decide", { submission: submitted.submission.id, item: review.items[0].id, whole: "approved" })
    let unit = await app.run("unit.get", { id: "char/wolf" })
    assert.equal(unit.review.parts.find((candidate: Any) => candidate.id === "animation:walk").changed, false)
    let compared = await app.run("evidence.compare", { a: { submission: submitted.submission.id, item: review.items[0].id, part: "animation:walk" }, b: "current" })
    assert.equal(compared.identical, true)
    assert.equal(compared.rows[0].b.sheet.fps, 12)

    // Same bytes, new timing: what was approved is not what plays now.
    write(dir, unitFile, { ...read(dir, unitFile), links: [{ role: "animation", asset: "art/wolf.png", key: "walk", sheet: { ...walk, fps: 8 } }] })
    unit = await app.run("unit.get", { id: "char/wolf" })
    assert.equal(unit.review.parts.find((candidate: Any) => candidate.id === "animation:walk").changed, true)
    compared = await app.run("evidence.compare", { a: { submission: submitted.submission.id, item: review.items[0].id, part: "animation:walk" }, b: "current" })
    assert.equal(compared.identical, false)
    assert.equal(compared.rows[0].a.sha256, compared.rows[0].b.sha256)
    assert.deepEqual([compared.rows[0].a.sheet.fps, compared.rows[0].b.sheet.fps], [12, 8])
  } finally {
    cleanup(dir)
  }
})

test("a view's before side plays as an animation: a file with its sheet, or earlier evidence with the sheet it was reviewed as", async () => {
  const dir = await makeProject({
    assets: { "art/walk-v1.png": png(12, 4, [9, 9, 9, 255]), "art/walk-v2.png": png(16, 8) },
    units: [{ id: "char/wolf", type: "character", name: "Wolf", links: [{ role: "animation", asset: "art/walk-v2.png", key: "walk", sheet: walk }] }],
    extra: { types: { character: spriteType } }
  })
  const app = await open(dir)
  const run = W(app)
  try {
    const target = { kind: "unit", id: "char/wolf" }
    const first = await run("review.submit", {
      items: [{ target, views: [{ part: "animation:walk", caption: "Walk, old and new", before: { path: "art/walk-v1.png", label: "v1", sheet: { fps: 10, grid: { columns: 3 } } } }] }]
    })
    let review = await app.run("review.get", { submission: first.submission.id })
    let before = review.items[0].views[0].before
    assert.deepEqual([before.label, before.sheet.fps, before.sheet.grid.columns, before.status], ["v1", 10, 3, "ok"])

    const second = await run("review.submit", {
      items: [{ target, views: [{ part: "animation:walk", caption: "Walk again", before: { submission: first.submission.id, item: review.items[0].id, part: "animation:walk" } }] }]
    })
    review = await app.run("review.get", { submission: second.submission.id })
    before = review.items[0].views[0].before
    assert.equal(before.sheet.fps, 12, "earlier evidence keeps the sheet it was reviewed with")

    const refusals = [
      [{ path: "art/walk-v1.png", sheet: { fps: 0, grid: { columns: 3 } } }, /before sheet: fps/],
      [{ submission: first.submission.id, item: review.items[0].id, part: "animation:walk", sheet: walk }, /earlier evidence keeps the sheet/]
    ] as const
    for (const [given, reason] of refusals) {
      const error = await run("review.submit", { items: [{ target, views: [{ part: "animation:walk", caption: "x", before: given }] }] }).catch((e: Any) => e)
      assert.equal(error.code, "invalid")
      assert.match(error.message, reason)
    }
  } finally {
    cleanup(dir)
  }
})
