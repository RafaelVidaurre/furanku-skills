// Ported from the version 1 engine: one read action works from one snapshot of the records,
// however many rows it returns.
import assert from "node:assert/strict"
import { test } from "node:test"
import { cleanup, open, standardProject, W } from "./helpers.ts"

test("a search shares one record snapshot across its rows and sees later external label changes", async () => {
  const units = Array.from({ length: 30 }, (_, i) => ({ id: `prop/${i}`, type: "armor", name: `Prop ${i}`, links: [] }))
  const root = await standardProject({ units, collections: [] })
  try {
    const app = await open(root)
    await W(app)("organize.bulk", { targets: units.map((u) => ({ kind: "unit", id: u.id })), addTags: ["placeholder"] })
    // Version 1 counted calls to `app.records.list` and allowed 20; the counters of `app.stats()`
    // replace it, under the stricter rule of exactly one record scan and at most one projection.
    const before = await app.stats()
    const found = await app.run("catalog.search", { filters: { tag: ["placeholder"] } })
    const after = await app.stats()
    assert.equal(found.total, units.length)
    const scans = after.recordScans - before.recordScans
    assert.equal(scans, 1, `one search rescanned repository records ${scans} times for ${units.length} rows`)
    assert.ok(after.projections - before.projections <= 1, `one search built ${after.projections - before.projections} projections`)
    const otherWriter = await open(root)
    await W(otherWriter)("organize.bulk", { targets: [{ kind: "unit", id: units[0]!.id }], removeTags: ["placeholder"] })
    assert.equal((await app.run("catalog.search", { filters: { tag: ["placeholder"] } })).total, units.length - 1)
  } finally {
    cleanup(root)
  }
})

test("context computes review counts from one record snapshot across the asynchronous actor lookup", async () => {
  const units = Array.from({ length: 8 }, (_, i) => ({ id: `lore/${i}`, type: "lore", name: `Lore ${i}`, attrs: { text: `Text ${i}` }, links: [] }))
  const root = await standardProject({ units, collections: [] })
  try {
    const app = await open(root)
    const run = W(app)
    const submitted = await run("review.submit", { title: "Reviewed metadata", items: units.map((u) => ({ target: { kind: "unit", id: u.id } })) })
    const sub = await app.run("review.get", { submission: submitted.submission.id })
    for (const item of sub.items) await run("review.decide", { submission: sub.id, item: item.id, whole: "approved" })
    // As above: `app.stats()` replaces the wrapped `app.records.list`, under the stricter rule.
    const before = await app.stats()
    const context = await app.run("context")
    const after = await app.stats()
    assert.equal(context.counts.waiting, 0)
    assert.equal(context.counts.submissions, 1)
    const scans = after.recordScans - before.recordScans
    assert.equal(scans, 1, `context rescanned repository records ${scans} times for ${units.length} reviewed items`)
    assert.ok(after.projections - before.projections <= 1, `context built ${after.projections - before.projections} projections`)
  } finally {
    cleanup(root)
  }
})
