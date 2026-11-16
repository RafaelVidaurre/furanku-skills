// Ported from the version 1 engine's browser-domain-split.test.mjs: the two scopes of a catalog
// are browsed apart, in a real browser. Nothing changed but the way the server is started.
import assert from "node:assert/strict"
import test from "node:test"
import { cleanup, makeProject, TYPES } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, startServer, type TestServer } from "./server.ts"

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const { shot } = screenshots(import.meta.url)

test("Content and Assets have independent counts, categories, search, detail links and return navigation", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  let server: TestServer | undefined
  let dir: string | undefined
  try {
    dir = await makeProject({
      extra: { types: { ...TYPES, lore: { ...TYPES.lore, fields: [...TYPES.lore.fields, { key: "internal", label: "Internal", derived: true }] }, resource: { label: "Character model", scope: "assets", roles: [], fields: [] } } },
      units: [
        { id: "player", type: "lore", name: "Player", category: "Characters", attrs: { text: "Playable role", internal: "engine/private/path" } },
        { id: "unused-model", type: "resource", name: "Uncast model", category: "Characters/Outfits", attrs: {} }
      ]
    })
    server = await startServer(dir)
    const app = server.app
    const content = await app.run("catalog.search", { scope: "content" })
    const assets = await app.run("catalog.search", { scope: "assets" })
    assert.deepEqual(content.ids, ["player"])
    assert.deepEqual(assets.ids, ["unused-model"])
    assert.equal(content.items[0].attrsPreview.some((a: Any) => a.label === "Internal"), false)
    assert.equal(content.all, 1)
    assert.equal(assets.facets.cat.values.find((v: Any) => v.value === "Characters").count, 1)
    assert.equal((await app.run("catalog.search", { scope: "content", q: "Uncast" })).total, 0)
    const page = await newPage(browser)
    await page.goto(server.url + "#/content")
    await page.getByRole("listitem").filter({ hasText: "Player" }).waitFor()
    assert.equal(await page.getByRole("listitem").filter({ hasText: "Uncast model" }).count(), 0)
    await shot(page, "content-list")
    await page.locator(".primary-nav").getByRole("link", { name: "Assets", exact: true }).click()
    await page.getByRole("listitem").filter({ hasText: "Uncast model" }).click()
    await page.locator("h1").filter({ hasText: "Uncast model" }).waitFor()
    assert.match(page.url(), /#\/assets\/u\//)
    assert.equal(await page.locator(".list-pane").count(), 0)
    assert.equal(await page.getByRole("button", { name: "Review", exact: true }).count(), 0)
    await shot(page, "assets-unit-detail")
    await page.getByRole("link", { name: "Back to list" }).click()
    await page.getByRole("listitem").filter({ hasText: "Uncast model" }).waitFor()
    assert.equal(await page.getByRole("listitem").filter({ hasText: "Player" }).count(), 0)
    await shot(page, "assets-list")
    await page.getByRole("combobox", { name: "Search catalog" }).fill("Uncast")
    await page.locator(".gres").filter({ hasText: "Uncast model" }).click()
    assert.match(page.url(), /#\/assets\/u\//)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(server.url + "#/content")
    await page.getByRole("listitem").filter({ hasText: "Player" }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await shot(page, "content-list-narrow")
    assert.deepEqual(page.errors, [])
  } finally {
    await browser.close()
    await server?.close()
    if (dir) cleanup(dir)
  }
})
