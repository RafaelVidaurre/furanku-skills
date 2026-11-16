// "What needs attention", in the page: the inbox action as a view reachable from the top bar.
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { test } from "node:test"
import { agent, cleanup, png, standardProject, W, write } from "./helpers.ts"
import { browserOrSkip, startServer } from "./server.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const OUT = "test-output/browser/browser-inbox"
const unit = (id: string) => ({ kind: "unit", id })

test("the attention view lists waiting reviews, open notes, changed verdicts and problems, each leading to its page", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const dir = await standardProject()
  const s = await startServer(dir)
  mkdirSync(OUT, { recursive: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(String(error)))
    // Nothing waiting: the link is there without a count, and the view says so.
    await page.goto(`${s.url}#/content`)
    const link = page.locator(".top").getByRole("link", { name: /Needs attention/ })
    await link.waitFor()
    assert.equal(await link.locator(".badge").count(), 0)
    await link.click()
    await page.getByRole("heading", { name: "Needs attention" }).waitFor()
    // The page has another status region (toasts), so the message is found by its own place.
    const empty = page.locator(".attention-empty")
    await empty.waitFor()
    assert.equal(await empty.getAttribute("role"), "status")
    assert.equal(await empty.innerText(), "Nothing is waiting: no undecided reviews, open notes, changed verdicts or problems.")
    assert.equal(await page.locator(".attention").count(), 0)

    const run = W(s.app)
    await run("review.decideCurrent", { target: unit("armor/helm"), whole: "approved" })
    const waiting = await run("review.submit", { title: "Boots pass", items: [{ target: unit("armor/boots") }, { target: unit("armor/coat") }] })
    await W(s.app, agent)("note.create", { target: { ...unit("armor/helm"), part: "model" }, body: "Visor reads thin at distance" })
    write(dir, "art/helm.png", png(4, 4, [9, 9, 9, 255]))
    write(dir, "content/broken.json", "{ nope")
    const inbox = await s.app.run("inbox", {})
    assert.deepEqual(inbox.counts, { waiting: 1, notes: 1, changed: 1, problems: 1 })

    // The open page notices on its next poll: the count appears and the view fills in.
    await page.waitForFunction(() => document.querySelector(".attention-link .badge")?.textContent === "4", null, { timeout: 15_000 })
    const section = (name: string) => page.locator(`section.attention[aria-label="${name}"]`)
    await section("Reviews waiting for a verdict").waitFor()
    assert.deepEqual(await page.locator("section.attention").evaluateAll((sections) => sections.map((element) => [element.getAttribute("aria-label"), element.querySelector(".badge")?.textContent])), [
      ["Reviews waiting for a verdict", "1"],
      ["Open notes", "1"],
      ["Changed since their verdict", "1"],
      ["Problems", "1"]
    ])
    assert.match(await section("Reviews waiting for a verdict").innerText(), /Boots pass[\s\S]*Rae Tester[\s\S]*2 of 2 waiting/)
    assert.match(await section("Open notes").innerText(), /Iron Helm · Model[\s\S]*Visor reads thin at distance[\s\S]*checker/)
    assert.match(await section("Changed since their verdict").innerText(), /Iron Helm[\s\S]*Icon changed after its verdict/)
    assert.match(await section("Problems").innerText(), /content\/broken\.json/)
    await page.screenshot({ path: `${OUT}/inbox.png` })

    // Each entry opens the page it is about.
    await section("Reviews waiting for a verdict").getByRole("link").click()
    await page.waitForFunction(() => (globalThis as Any).catalogViewer?.state().selection?.submission != null)
    assert.ok(page.url().includes(`#/reviews/s/${waiting.submission.id}`))
    await page.goBack()
    await section("Open notes").getByRole("link").click()
    await page.locator("h1").filter({ hasText: "Iron Helm" }).waitFor()
    assert.match(page.url(), /#\/content\/u\/armor%2Fhelm/)
    await page.goBack()
    await section("Changed since their verdict").getByRole("link").click()
    await page.locator("h1").filter({ hasText: "Iron Helm" }).waitFor()
    await page.goBack()
    // Deciding the waiting items and resolving the note empties the view.
    const review = await s.app.run("review.get", { submission: waiting.submission.id })
    for (const item of review.items) await run("review.decide", { submission: review.id, item: item.id, whole: "approved" })
    await run("note.resolve", { id: inbox.notes[0].id })
    await page.waitForFunction(() => document.querySelector(".attention-link .badge")?.textContent === "2", null, { timeout: 15_000 })
    assert.equal(await section("Reviews waiting for a verdict").count(), 0)
    assert.equal(await section("Open notes").count(), 0)
    // Narrow screens keep the link reachable without widening the page.
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: `${OUT}/inbox-narrow.png` })
    assert.deepEqual(errors, [])
    await page.close()
  } finally {
    await browser.close()
    await s.close()
    cleanup(dir)
  }
})
