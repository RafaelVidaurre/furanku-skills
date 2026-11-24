import assert from "node:assert/strict"
import { test } from "node:test"
import { cleanup, makeProject, open, png, read, W, write } from "./helpers.ts"

const unitId = "portrait"
const partId = "image:portrait"
const target = { kind: "unit", id: unitId }
const art = "art/atlas.png"
const portrait = { role: "image", asset: art, key: "portrait" }
const type = { thumb: "image", roles: [{ key: "image", label: "Image", mediaKinds: ["image"], many: true }] }

test("an atlas crop is frozen with the original bytes and changing only the crop invalidates a verdict", async () => {
  const start = [8, 6, 12, 5]
  const end = [2, 18, 12, 5]
  const dir = await makeProject({
    assets: { [art]: png(32, 32) },
    units: [{ id: unitId, type: "art", name: "Portrait", links: [{ ...portrait, crop: start }] }],
    extra: { types: { art: type } }
  })
  const app = await open(dir)
  const run = W(app)
  try {
    const submitted = await run("review.submit", {
      items: [{ target, views: [{ part: partId, caption: "Regions", before: { path: art, crop: end } }] }]
    })
    const submission = submitted.submission.id
    const review = await app.run("review.get", { submission })
    const item = review.items[0]
    assert.deepEqual(item.parts[0].evidence.crop, start)
    assert.deepEqual(item.parts[0].leaves[0].crop, start)
    assert.deepEqual(item.views[0].before.crop, end)
    assert.equal(item.views[0].before.sha256, item.parts[0].leaves[0].sha256)
    assert.notEqual(item.views[0].before.digest, item.parts[0].leaves[0].digest)

    const copied = await run("review.submit", {
      items: [{ target, views: [{ part: partId, caption: "Previous", before: { submission, item: item.id, part: partId } }] }]
    })
    const later = await app.run("review.get", { submission: copied.submission.id })
    assert.deepEqual(later.items[0].views[0].before.crop, start)

    await run("review.decide", { submission, item: item.id, whole: "approved" })
    let unit = await app.run("unit.get", { id: unitId })
    assert.deepEqual(unit.links[0].crop, start)
    assert.deepEqual(unit.review.parts[0].crop, start)
    assert.equal(unit.review.parts[0].changed, false)

    const unitFile = "content/portrait.json"
    write(dir, unitFile, { ...read(dir, unitFile), links: [{ ...portrait, crop: end }] })
    unit = await app.run("unit.get", { id: unitId })
    assert.equal(unit.review.parts[0].changed, true)

    const compared = await app.run("evidence.compare", { a: { submission, item: item.id, part: partId }, b: "current" })
    assert.equal(compared.identical, false)
    const { a, b } = compared.rows[0]
    assert.equal(a.sha256, b.sha256)
    assert.deepEqual([a.crop, b.crop], [start, end])
  } finally {
    cleanup(dir)
  }
})

test("a malformed crop or one paired with a sheet reports a problem and keeps the image link", async () => {
  const dir = await makeProject({
    assets: { [art]: png(32, 32) },
    units: [{ id: unitId, type: "art", name: "Portrait", links: [
      { ...portrait, crop: [0, 0, 0, 2] },
      { ...portrait, key: "conflict", crop: [0, 0, 2, 2], sheet: { fps: 1, grid: { columns: 1 } } }
    ] }],
    extra: { types: { art: type } }
  })
  const app = await open(dir)
  try {
    const unit = await app.run("unit.get", { id: unitId })
    assert.equal(unit.links.length, 2)
    for (const link of unit.links) {
      assert.equal(link.asset.id, art)
      assert.equal(link.crop, undefined)
      assert.equal(link.sheet, undefined)
    }
    const { problems } = await app.run("problems", {})
    assert.ok(problems.some((p: { error: string }) => p.error.includes("expected [x, y, width, height]")))
    assert.ok(problems.some((p: { error: string }) => p.error.includes("either crop or sheet")))
  } finally {
    cleanup(dir)
  }
})
