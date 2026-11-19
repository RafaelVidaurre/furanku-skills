// Ported from the version 1 engine's browser-catalog-boundaries.test.mjs: browsing and detail are
// separate pages, and a review reference role stays viewable without ever taking a decision.
//
// Changed with the rebuilt page: a unit's linked assets are always headed "Assets".
import assert from "node:assert/strict"
import { test } from "node:test"
import { cleanup, open, read, rejects, standardProject, W, write } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, startServer, type TestServer } from "./server.ts"

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const { shot } = screenshots(import.meta.url)

test("browse and detail stay separate; review references remain viewable but cannot receive decisions", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  let server: TestServer | undefined
  let dir: string | undefined
  try {
    dir = await standardProject()
    const m = read(dir, "catalog.manifest.json")
    m.types.armor.roles.push({ key: "evidence", label: "Evidence", mediaKinds: ["image"] })
    write(dir, "catalog.manifest.json", m)
    const u = read(dir, "content/armor_helm.json")
    u.links.push({ role: "evidence", asset: "art/sheet.png" })
    write(dir, "content/armor_helm.json", u)
    let app = await open(dir)
    // Simulate a real historical submission, created before reference-only policy existed.
    const old = await W(app)("review.submit", { items: [{ target: { kind: "unit", id: u.id }, parts: ["model", "evidence"], views: [{ part: "evidence", caption: "Evidence · layout" }, { part: "model", caption: "Helmet model" }] }] })
    const referenceViewsOnly = await W(app)("review.submit", { items: [{ target: { kind: "unit", id: u.id }, parts: ["model", "evidence"], views: [{ part: "evidence", caption: "Helmet detail" }] }] })
    const initial = await app.run("review.get", { submission: old.submission.id })
    const item = initial.items[0]
    const bytes = JSON.stringify(read(dir, `.catalog/reviews/${old.submission.id}/submission.json`))
    const cfg = read(dir, "catalog.config.json")
    cfg.review.referenceRoles = ["evidence"]
    write(dir, "catalog.config.json", cfg)
    // Was a second open(dir): the server's own catalog is the fresh engine that reads the new policy.
    server = await startServer(dir)
    app = server.app
    const historical = await app.run("review.get", { submission: old.submission.id })
    assert.equal(historical.items[0].summary.total, 1)
    assert.equal(historical.items[0].parts.find((p: Any) => p.id === "evidence").reviewable, false)
    assert.equal(historical.items[0].parts.find((p: Any) => p.id === "evidence").leaves[0].status, "ok")
    await rejects(W(app)("review.decide", { submission: old.submission.id, item: item.id, verdicts: { evidence: "approved" } }), "invalid")
    await rejects(W(app)("review.decideCurrent", { target: { kind: "unit", id: u.id }, verdicts: { evidence: "approved" } }), "invalid")
    await rejects(W(app)("review.submit", { items: [{ target: { kind: "unit", id: u.id }, parts: ["evidence"] }] }), "invalid")
    const whole = await W(app)("review.decide", { submission: old.submission.id, item: item.id, whole: "approved" })
    assert.deepEqual(whole.decision.verdicts, { model: "approved" })
    assert.equal(JSON.stringify(read(dir, `.catalog/reviews/${old.submission.id}/submission.json`)), bytes, "no historical record rewrite")
    const fresh = await W(app)("review.submit", { items: [{ target: { kind: "unit", id: u.id } }] })
    assert.ok(!(await app.run("review.get", { submission: fresh.submission.id })).items[0].parts.some((p: Any) => p.id === "evidence"))

    const p = await newPage(browser, { viewport: { width: 1440, height: 900 } })
    await p.goto(`${server.url}#/main?q=Iron&f.cat=Gear`)
    await p.locator(".card").first().waitFor()
    await shot(p, "main-filtered-list")
    await p.locator(".card").first().click()
    await p.waitForSelector(".d-title")
    assert.equal(await p.locator(".list-pane").count(), 0, "detail unmounts the entire gallery")
    assert.equal(await p.locator('section[aria-label="Review"], .vbar, .dialog.composer').count(), 0)
    assert.equal(await p.locator('.disclosure:has-text("Technical details")').getAttribute("open"), null)
    // Added: the block the lore unit must lack below is the one this unit, which has assets, shows.
    assert.equal(await p.locator('section[aria-label="Assets"]').count(), 1)
    await p.evaluate(() => window.catalogViewer.settled())
    await shot(p, "unit-detail")
    await p.getByRole("link", { name: "Back to list", exact: true }).click()
    await p.waitForSelector(".card")
    assert.match(p.url(), /q=Iron/)
    assert.match(p.url(), /f.cat=Gear/)
    await p.goto(`${server.url}#/main/u/lore%2Forigin`)
    await p.waitForSelector('[aria-label="Unit details"]')
    assert.equal(await p.getByText("Long ago the iron mines opened.", { exact: true }).isVisible(), true, "actual textual content remains visible")
    // A unit's linked assets are always headed "Assets".
    assert.equal(await p.locator('[aria-label="Assets"]').count(), 0)
    await p.goto(`${server.url}#/reviews/s/${old.submission.id}`)
    await p.waitForFunction(() => window.catalogViewer?.state().viewer?.status === "ready")
    assert.equal(await p.locator('[role="tab"][aria-selected="true"]').textContent(), "Helmet model", "default skips a reference even when it was the first saved view")
    assert.equal(await p.locator(".comp-row").count(), 1)
    assert.equal(await p.getByRole("radio", { name: "Approve: Evidence", exact: true }).count(), 0)
    await shot(p, "review-with-reference-role")
    await p.getByText("Supporting views (1)", { exact: true }).click()
    await p.getByRole("button", { name: "layout", exact: true }).click()
    await p.waitForFunction(() => window.catalogViewer?.state().selection?.part === "evidence")
    await p.goto(`${server.url}#/reviews/s/${referenceViewsOnly.submission.id}`)
    await p.waitForFunction(() => window.catalogViewer?.state().viewer?.status === "ready")
    assert.equal(await p.locator(".caption-bar").textContent(), "Helmet detail", "a historical submission with only supporting views still opens a useful preview")
    assert.equal(await p.locator(".comp-row").count(), 1, "supporting views never add decision targets")
    assert.deepEqual(p.errors, [])
  } finally {
    await browser.close()
    await server?.close()
    if (dir) cleanup(dir)
  }
})
