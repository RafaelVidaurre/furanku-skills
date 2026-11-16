// Ported from the version 1 engine's browser-browse-cards.test.mjs: what the gallery shows while a
// query is pending, and what a card leads with. Nothing changed but the way the server is started.
import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { cleanup, glb, makeProject, TYPES } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, startServer, type TestPage, type TestServer } from "./server.ts"

const { shot } = screenshots(import.meta.url)

const fixture = async (t: TestContext, run: (page: TestPage, url: string) => Promise<void>): Promise<void> => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  let server: TestServer | undefined
  let dir: string | undefined
  try {
    dir = await makeProject({
      extra: { types: { ...TYPES, lore: { ...TYPES.lore, fields: [{ key: "role", label: "Role" }, { key: "setting", label: "Appears in" }] }, resource: { label: "Model", scope: "assets", roles: [], fields: [] } } },
      assets: { "art/player.glb": await glb() },
      units: [
        { id: "player", type: "armor", name: "Player", category: "Characters", links: [{ role: "model", asset: "art/player.glb" }] },
        { id: "tray", type: "lore", name: "Tray", category: "Props", attrs: { role: "Carryable", setting: "Hands Lab" } },
        ...Array.from({ length: 8 }, (_, i) => ({ id: `art-${i}`, name: `Model ${i}`, type: "resource" }))
      ]
    })
    server = await startServer(dir)
    await run(await newPage(browser), server.url)
  } finally {
    await browser.close()
    await server?.close()
    if (dir) cleanup(dir)
  }
}

test("pending tab and filter queries never display another result count or cards", (t) =>
  fixture(t, async (page, url) => {
    await page.goto(url + "#/assets")
    await page.locator(".side").getByRole("link", { name: "All assets 8", exact: true }).waitFor()
    let release: () => void = () => undefined
    let gate = new Promise<void>((resolve) => { release = resolve })
    let started: () => void = () => undefined
    const requestStarted = new Promise<void>((resolve) => { started = resolve })
    await page.route("**/api/run/catalog.search", async (route) => {
      const input = route.request().postDataJSON().input
      if (input.scope === "content") {
        started()
        await gate
      }
      await route.continue()
    })
    try {
      await page.locator(".primary-nav").getByRole("link", { name: "Content", exact: true }).click()
      await page.waitForFunction(() => document.querySelector(".browse-head h1")?.textContent === "Content")
      await requestStarted
      assert.equal(await page.locator(".side").getByRole("link", { name: /^All content/ }).innerText(), "All content")
      assert.equal(await page.locator(".chips [aria-live]").count(), 0)
      assert.equal(await page.getByRole("listitem").count(), 0)
      await shot(page, "content-pending")
      release()
      await page.getByRole("listitem").filter({ hasText: "Player" }).waitFor()
      assert.equal(await page.locator(".chips [aria-live]").innerText(), "2")
      gate = new Promise<void>((resolve) => { release = resolve })
      const filteredRequest = page.waitForRequest((req) => req.url().endsWith("/catalog.search") && req.postDataJSON().input.filters?.cat?.[0] === "Props")
      await page.locator(".side").getByRole("link", { name: "Props 1", exact: true }).click()
      await filteredRequest
      await page.waitForFunction(() => location.hash.includes("f.cat=Props"))
      assert.equal(await page.locator(".chips [aria-live]").count(), 0, "unfiltered count must disappear while category loads")
      assert.equal(await page.getByRole("listitem").count(), 0)
      release()
      await page.getByRole("listitem").filter({ hasText: "Tray" }).waitFor()
      assert.equal(await page.locator(".chips [aria-live]").innerText(), "1 of 2")
      await shot(page, "content-filtered")
    } finally {
      release()
    }
    assert.deepEqual(page.errors, [])
  }))

test("gallery cards lead with a preview and name, with no property summaries", (t) =>
  fixture(t, async (page, url) => {
    await page.goto(url + "#/content")
    const player = page.getByRole("listitem").filter({ hasText: "Player" })
    await player.waitFor()
    await player.locator(".card-media img").evaluate((img: HTMLImageElement) => img.decode())
    const fits = await player.evaluate((el) => el.querySelector("model-thumb")!.getBoundingClientRect().height <= el.querySelector(".card-media")!.getBoundingClientRect().height + 1)
    assert.ok(fits, "model thumbnail stays within the card instead of clipping its lower half")
    const tray = page.getByRole("listitem").filter({ hasText: "Tray" })
    assert.equal(await tray.locator(".card-media").count(), 1)
    assert.doesNotMatch(await tray.innerText(), /Appears in|Role|Carryable|Hands Lab/)
    assert.equal(await tray.locator(".card-name").evaluate((el) => el.nextElementSibling!.className), "card-sub")
    await shot(page, "content-cards")
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await shot(page, "content-cards-narrow")
    assert.deepEqual(page.errors, [])
  }))
