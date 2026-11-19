// Ported from the version 1 engine's browser-part-notes.test.mjs. Real Chromium acceptance for
// per-part review comments in the dedicated review view: drafts survive reload, saved comments
// reload with their part and verdict. Changed: a decision's per-part text is a part comment.
import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import type { Browser } from "playwright"
import { type App, cleanup, human, standardProject, W } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, startServer, type TestPage, type TestServer } from "./server.ts"

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const { shot } = screenshots(import.meta.url)
let dir: string
let app: App
let server: TestServer
let browser: Browser
let base: string
let found: Awaited<ReturnType<typeof browserOrSkip>>
const unit = (id: string) => ({ kind: "unit", id })

const page = (): Promise<TestPage> => newPage(browser, { viewport: { width: 1440, height: 900 } })
const done = async (p: TestPage): Promise<void> => {
  const errors = p.errors
  await p.close()
  assert.deepEqual(errors, [], "no page errors")
}
const until = async <A>(fn: () => Promise<A>, ms = 5000): Promise<A> => {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 50))
  }
}
const texts = (p: TestPage, sel: string) => p.$$eval(sel, (els) => els.map((e) => e.textContent!.replace(/\s+/g, " ").trim()))
// Each shown part comment as [verdict class, part label, comment text].
const commentsShown = (p: TestPage, sel: string) =>
  p.$$eval(`${sel} .part-note`, (els) => els.map((e) => [e.querySelector(".pv")!.className.replace("pv ", ""), e.querySelector(".pv")!.textContent!.trim(), e.querySelector(".part-note-t")!.textContent]))

before(async () => {
  found = await browserOrSkip()
  if ("skip" in found) return
  browser = found.browser
  dir = await standardProject()
  server = await startServer(dir)
  app = server.app
  base = server.url
})
after(async () => {
  await browser?.close()
  await server?.close()
  if (dir) cleanup(dir)
})

describe("part comments", () => {
  it("review detail: comments per decided part survive a reload as a draft, record only for decided parts, and show after reload", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const p = await page()
    const sub = await W(app, human)("review.submit", { items: [{ target: unit("armor/helm") }] })
    await p.goto(`${base}#/reviews/s/${sub.submission.id}`)
    const dlg = p.locator('section[aria-label="Decision"]')
    await dlg.waitFor()
    assert.equal(await dlg.locator('button[aria-label="Comment on Attributes"]').isDisabled(), true, "no comment without a verdict")
    await dlg.locator('button[aria-label="Request changes: Icon"]').click()
    await dlg.locator('button[aria-label="Reject: Model"]').click()
    await dlg.locator('button[aria-label="Approve: Concept"]').click()
    await dlg.locator('button[aria-label="Comment on Icon"]').click()
    await dlg.locator('textarea[aria-label="Comment on Icon"]').fill("Outline too thin at small sizes")
    await dlg.locator('button[aria-label="Comment on Model"]').click()
    await dlg.locator('textarea[aria-label="Comment on Model"]').fill("Visor silhouette is wrong")
    await dlg.locator('button[aria-label="Comment on Concept"]').click()
    await dlg.locator('textarea[aria-label="Comment on Concept"]').fill("Dropped with its verdict")
    await dlg.locator('textarea[aria-label="Comment"]').fill("Close overall")
    // The draft, comments included, survives a reload.
    await p.reload()
    await dlg.waitFor()
    assert.equal(await dlg.locator('textarea[aria-label="Comment on Icon"]').inputValue(), "Outline too thin at small sizes")
    assert.equal(await dlg.locator('textarea[aria-label="Comment on Model"]').inputValue(), "Visor silhouette is wrong")
    assert.equal(await dlg.locator('textarea[aria-label="Comment on Model"]').getAttribute("maxlength"), "5000", "typing cannot exceed the API comment limit")
    // A filled comment collapses and reopens with its text intact.
    const iconTog = dlg.locator('button[aria-label="Comment on Icon"]')
    await iconTog.click()
    assert.equal(await dlg.locator('textarea[aria-label="Comment on Icon"]').count(), 0, "filled comment collapses")
    assert.equal(await iconTog.getAttribute("aria-expanded"), "false")
    await iconTog.click()
    assert.equal(await dlg.locator('textarea[aria-label="Comment on Icon"]').inputValue(), "Outline too thin at small sizes", "reopened comment keeps its text")
    // Clearing a part's verdict hides its comment and leaves it out of the decision.
    await dlg.locator('[role="radiogroup"][aria-label="Concept"] button[title="No verdict"]').click()
    assert.equal(await dlg.locator('textarea[aria-label="Comment on Concept"]').count(), 0)
    await p.evaluate(() => window.catalogViewer.settled())
    await shot(p, "part-notes-quick-composer")
    await dlg.locator('button:has-text("Save")').click()
    const ev: Any = await until(async () => (await app.run("review.get", { submission: sub.submission.id })).decisions[0])
    assert.deepEqual(ev.verdicts, { icon: "changes", model: "rejected" })
    assert.deepEqual(ev.partComments, { icon: "Outline too thin at small sizes", model: "Visor silhouette is wrong" })
    assert.equal(ev.comment, "Close overall")
    // Saved comments live with the review, never on the content inspection page.
    await p.reload()
    await p.waitForSelector('section[aria-label="Verdicts"] .part-note')
    assert.deepEqual(await commentsShown(p, 'section[aria-label="Verdicts"]'), [["changes", "Icon", "Outline too thin at small sizes"], ["rejected", "Model", "Visor silhouette is wrong"]])
    assert.deepEqual(await texts(p, 'section[aria-label="Verdicts"] .ritem-c'), ["Close overall"])
    await p.goto(`${base}#/main/u/armor%2Fhelm`)
    await p.waitForSelector(".d-title")
    assert.equal(await p.locator('section[aria-label="Review"], section[aria-label="Verdicts"]').count(), 0)
    await done(p)
  })

  it("submission item review: mixed verdicts with two part comments save and reload; a decision without comments records none", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const s = await W(app, human)("review.submit", { title: "Boots pass", items: [{ target: unit("armor/boots") }] })
    const rv = await app.run("review.get", { submission: s.submission.id })
    const item = rv.items[0].id
    const p = await page()
    await p.goto(`${base}#/reviews/s/${rv.id}/${item}`)
    const dec = p.locator('section[aria-label="Decision"]')
    await dec.waitFor()
    await dec.locator('.comp-all button:has-text("Approve")').click()
    await dec.locator('button[aria-label="Request changes: Model"]').click()
    await dec.locator('button[aria-label="Comment on Model"]').click()
    await dec.locator('textarea[aria-label="Comment on Model"]').fill("Sole is too thick")
    await dec.locator('button[aria-label="Comment on Icon"]').click()
    await dec.locator('textarea[aria-label="Comment on Icon"]').fill("Icon reads well")
    await p.reload()
    await dec.waitFor()
    assert.equal(await dec.locator('textarea[aria-label="Comment on Model"]').inputValue(), "Sole is too thick", "draft comment restored")
    assert.equal(await dec.locator('textarea[aria-label="Comment on Icon"]').inputValue(), "Icon reads well")
    await p.evaluate(() => window.catalogViewer.settled())
    await shot(p, "part-notes-submission-draft")
    await dec.locator('.decide-f button:has-text("Save")').click()
    const ev: Any = await until(async () => (await app.run("review.get", { submission: rv.id })).decisions[0])
    assert.equal(ev.covers, "whole")
    assert.deepEqual(ev.partComments, { model: "Sole is too thick", icon: "Icon reads well" })
    assert.equal(ev.comment, "")
    // A second decision without comments.
    await dec.locator('.comp-all button:has-text("Reject")').click()
    await dec.locator('.decide-f button:has-text("Save")').click()
    const evs: Any = await until(async () => {
      const e = (await app.run("review.get", { submission: rv.id })).decisions
      return e.length === 2 && e
    })
    assert.deepEqual(evs[0].partComments, {}, "no comments recorded when none were written")
    await p.reload()
    const verdicts = p.locator('section[aria-label="Verdicts"]')
    await verdicts.locator(".part-note").first().waitFor()
    assert.equal(await verdicts.locator(".ritem").nth(0).locator(".part-note").count(), 0)
    assert.deepEqual(await commentsShown(p, 'section[aria-label="Verdicts"] .ritem:nth-of-type(2)'), [["approved", "Icon", "Icon reads well"], ["changes", "Model", "Sole is too thick"]])
    await shot(verdicts, "part-notes-submission-verdicts")
    await done(p)
  })
})
