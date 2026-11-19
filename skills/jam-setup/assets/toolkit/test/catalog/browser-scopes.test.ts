// The top-level split of the page comes from the project: the scopes its plugins register, with
// their labels, descriptions and order. One scope means no split at all. The page carries no
// names of its own for them, and no wording about any particular kind of project.
import assert from "node:assert/strict"
import { mkdirSync, readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"
import { definePlugin } from "../../src/catalog/plugin.ts"
import { cleanup, makeProject, png, TYPES, W, write } from "./helpers.ts"
import { browserOrSkip, startServer } from "./server.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const OUT = "test-output/browser/browser-scopes"
const settled = () => (globalThis as Any).catalogViewer?.settled(15000)

const units = [
  { id: "scene/opening", type: "scene", name: "Opening", category: "Act one", attrs: {}, links: [{ role: "still", asset: "art/opening.png" }] },
  { id: "scene/chase", type: "scene", name: "Chase", category: "Act two", attrs: {}, links: [] },
  // A unit with neither media nor attributes has nothing to review; these two are submitted.
  { id: "prop/lantern", type: "prop", name: "Lantern", category: "Hand props", attrs: { material: "Brass" }, links: [] },
  { id: "music/theme", type: "cue", name: "Main theme", attrs: { tempo: 90 }, links: [] }
]
const types = (scopes: Readonly<Record<string, string | undefined>>) => ({
  ...TYPES,
  scene: { label: "Scene", ...(scopes["scene"] ? { scope: scopes["scene"] } : {}), thumb: "still", fields: [], roles: [{ key: "still", label: "Still", mediaKinds: ["image"] }] },
  prop: { label: "Prop", ...(scopes["prop"] ? { scope: scopes["prop"] } : {}), fields: [{ key: "material", label: "Material" }], roles: [] },
  cue: { label: "Cue", ...(scopes["cue"] ? { scope: scopes["cue"] } : {}), fields: [{ key: "tempo", label: "Tempo", kind: "number" }], roles: [] }
})

test("one scope: no split, its label names the library, and every unit address is under it", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const dir = await makeProject({ assets: { "art/opening.png": png(8, 8, [20, 90, 200, 255]) }, extra: { types: types({}) }, units })
  write(dir, "catalog.config.json", { version: 3, plugins: ["manifest", "single"] })
  const single = definePlugin({ name: "single", scopes: [{ id: "story", label: "Story", description: "Everything that is on the page of the script" }] })
  const s = await startServer(dir, { plugins: { single } })
  mkdirSync(OUT, { recursive: true })
  try {
    assert.deepEqual((await s.app.run("schema", {})).scopes.map((scope: Any) => scope.id), ["story"])
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(String(error)))
    // No address: the page opens on the one scope.
    await page.goto(s.url)
    await page.getByRole("listitem").filter({ hasText: "Opening" }).waitFor()
    assert.equal(await page.locator(".browse-head h1").innerText(), "Story")
    assert.equal(await page.locator(".browse-head .muted").innerText(), "Everything that is on the page of the script")
    assert.equal(await page.getByRole("listitem").count(), 4, "every unit is in the one scope")
    assert.equal(await page.locator(".primary-nav").count(), 0, "with one scope there is nothing to switch between")
    assert.equal(await page.locator(".nav-caption").innerText(), "STORY")
    await page.locator(".side").getByRole("link", { name: "All story 4", exact: true }).waitFor()
    assert.deepEqual(await page.locator(".side .nav-i").allInnerTexts().then((texts) => texts.map((text) => text.replace(/\s+/g, " "))), ["All story 4", "Act one 1", "Act two 1", "Hand props 1", "Collections 0", "Assets 1", "Notes 0", "Reviews", "Categories & tags"])
    await page.screenshot({ path: `${OUT}/one-scope.png` })
    // A unit opens under the scope; an address under any other name is corrected or refused.
    await page.getByRole("listitem").filter({ hasText: "Opening" }).click()
    await page.locator("h1").filter({ hasText: "Opening" }).waitFor()
    assert.match(page.url(), /#\/story\/u\/scene%2Fopening$/)
    assert.equal(await page.getByRole("link", { name: "Back to list" }).innerText(), "Story")
    // The default scopes are not pages when a plugin registers its own.
    await page.goto(`${s.url}#/main`)
    await page.getByText('There is no page "main" in this catalog.').waitFor()
    await page.getByRole("link", { name: "Open the catalog" }).click()
    await page.getByRole("listitem").filter({ hasText: "Chase" }).waitFor()
    assert.match(page.url(), /#\/story$/)
    // Search and the review composer name the scope by its label.
    await page.getByRole("combobox", { name: "Search catalog" }).fill("Lantern")
    const result = page.locator(".gres").filter({ hasText: "Lantern" })
    await result.waitFor()
    assert.match(await result.innerText(), /Story$/)
    await result.click()
    assert.match(page.url(), /#\/story\/u\/prop%2Flantern$/)
    await page.goto(`${s.url}#/reviews`)
    await page.getByRole("button", { name: "New review" }).click()
    assert.deepEqual(await page.getByRole("combobox", { name: "Review source" }).locator("option").allInnerTexts(), ["Story", "Collections"])
    await page.keyboard.press("Escape")
    // An agent's viewer session finds the unit under its scope without being told.
    const opened = await s.viewer("viewer.open", { target: { kind: "unit", id: "scene/opening" } })
    assert.match(opened.state.route, /^#\/story\/u\/scene%2Fopening/)
    assert.equal(opened.state.viewer.status, "ready")
    await s.viewer("viewer.close", {})
    assert.deepEqual(errors, [])
    await page.close()
  } finally {
    await browser.close()
    await s.close()
    cleanup(dir)
  }
})

test("no plugin registers scopes: Main and Material split the units, and assets and organization are sections of their own", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const dir = await makeProject({ assets: { "art/opening.png": png(8, 8, [20, 90, 200, 255]) }, extra: { types: types({ prop: "material" }) }, units })
  const s = await startServer(dir)
  mkdirSync(OUT, { recursive: true })
  try {
    assert.deepEqual((await s.app.run("schema", {})).scopes.map((scope: Any) => [scope.id, scope.label]), [["main", "Main"], ["material", "Material"]])
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.goto(s.url)
    await page.getByRole("listitem").filter({ hasText: "Opening" }).waitFor()
    assert.deepEqual(await page.locator(".primary-nav a").evaluateAll((links) => links.map((link) => [link.textContent, link.getAttribute("href")])), [["Main", "#/main"], ["Material", "#/material"]])
    assert.match(page.url(), /#\/main$|\/$/)
    await page.locator(".primary-nav").getByRole("link", { name: "Material", exact: true }).click()
    await page.getByRole("listitem").filter({ hasText: "Lantern" }).click()
    await page.locator("h1").filter({ hasText: "Lantern" }).waitFor()
    assert.match(page.url(), /#\/material\/u\/prop%2Flantern$/)
    // Assets are a section of their own, labelled Assets, at #/assets.
    await page.locator(".side").getByRole("link", { name: "Assets 1", exact: true }).click()
    assert.match(page.url(), /#\/assets$/)
    assert.equal(await page.locator(".browse-head h1").innerText(), "Assets")
    await page.getByRole("listitem").filter({ hasText: "opening.png" }).click()
    await page.locator("h1").filter({ hasText: "opening.png" }).waitFor()
    assert.match(page.url(), /#\/assets\/a\/[^/?]+$/)
    assert.equal(await page.getByRole("link", { name: "Back to list" }).innerText(), "Assets")
    // A unit's asset link and an agent's viewer session use the same address.
    await page.goto(`${s.url}#/main/u/scene%2Fopening`)
    const openAsset = page.getByRole("link", { name: "Open asset" })
    await openAsset.waitFor()
    assert.match((await openAsset.getAttribute("href"))!, /^#\/assets\/a\//)
    const asset = (await s.app.run("asset.search", {})).assets[0]
    const opened = await s.viewer("viewer.open", { target: { kind: "asset", id: asset.id } })
    assert.equal(opened.state.route, `#/assets/a/${encodeURIComponent(asset.id)}`)
    await s.viewer("viewer.close", {})
    // Categories and tags live at #/organization.
    await page.locator(".side").getByRole("link", { name: "Categories & tags", exact: true }).click()
    assert.match(page.url(), /#\/organization$/)
    await page.locator(".organize h3").filter({ hasText: "Categories" }).waitFor()
    await page.goto(`${s.url}#/files`)
    await page.getByText('There is no page "files" in this catalog.').waitFor()
    await page.goto(`${s.url}#/organize`)
    await page.getByText('There is no page "organize" in this catalog.').waitFor()
    await page.evaluate(settled)
    assert.deepEqual(errors, [])
    await page.close()
  } finally {
    await browser.close()
    await s.close()
    cleanup(dir)
  }
})

test("several scopes: the split, its order, labels and descriptions are the project's", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const dir = await makeProject({ assets: { "art/opening.png": png(8, 8, [20, 90, 200, 255]) }, extra: { types: types({ prop: "workshop", cue: "score" }) }, units })
  write(dir, "catalog.config.json", { version: 3, plugins: ["manifest", "departments"] })
  const departments = definePlugin({
    name: "departments",
    scopes: [
      { id: "script", label: "Script", description: "Scenes as written" },
      { id: "workshop", label: "Workshop", description: "Things that are built" },
      { id: "score", label: "Score", description: "Music and sound" }
    ]
  })
  const s = await startServer(dir, { plugins: { departments } })
  mkdirSync(OUT, { recursive: true })
  try {
    const submitted = await W(s.app)("review.submit", { title: "Mixed", items: [{ target: { kind: "unit", id: "prop/lantern" } }, { target: { kind: "unit", id: "music/theme" } }] })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.goto(s.url)
    await page.getByRole("listitem").filter({ hasText: "Opening" }).waitFor()
    const nav = page.locator(".primary-nav a")
    assert.deepEqual(await nav.allInnerTexts(), ["Script", "Workshop", "Score"])
    assert.deepEqual(await nav.evaluateAll((links) => links.map((link) => [link.getAttribute("href"), link.getAttribute("title"), link.getAttribute("aria-current")])), [
      ["#/script", "Scenes as written", "page"],
      ["#/workshop", "Things that are built", null],
      ["#/score", "Music and sound", null]
    ])
    assert.equal(await page.getByRole("listitem").count(), 2, "types without a scope belong to the first one")
    await page.screenshot({ path: `${OUT}/three-scopes.png` })
    await page.locator(".primary-nav").getByRole("link", { name: "Workshop", exact: true }).click()
    await page.getByRole("listitem").filter({ hasText: "Lantern" }).waitFor()
    assert.equal(await page.getByRole("listitem").count(), 1)
    assert.equal(await page.locator(".browse-head h1").innerText(), "Workshop")
    await page.locator(".side").getByRole("link", { name: "All workshop 1", exact: true }).waitFor()
    await page.getByRole("listitem").filter({ hasText: "Lantern" }).click()
    await page.locator("h1").filter({ hasText: "Lantern" }).waitFor()
    assert.match(page.url(), /#\/workshop\/u\/prop%2Flantern$/)
    // An address that names the wrong scope is corrected to the unit's own.
    await page.goto(`${s.url}#/script/u/music%2Ftheme`)
    await page.locator("h1").filter({ hasText: "Main theme" }).waitFor()
    await page.waitForFunction(() => location.hash.startsWith("#/score/u/"))
    assert.equal(await page.locator(".primary-nav a[aria-current=page]").innerText(), "Score")
    // A submission's items say which scope each belongs to.
    await page.goto(`${s.url}#/reviews/s/${submitted.submission.id}`)
    await page.locator(".rows .row").first().waitFor()
    assert.deepEqual(await page.locator(".rows .row .row-sub").allInnerTexts().then((texts) => texts.map((text) => text.split(" · ")[0])), ["Workshop", "Score"])
    await page.evaluate(settled)
    assert.deepEqual(errors, [])
    await page.close()
  } finally {
    await browser.close()
    await s.close()
    cleanup(dir)
  }
})

test("the page's own words are about a catalog, not about any one kind of project", () => {
  const web = new URL("../../catalog/web/", import.meta.url)
  const sources = [...readdirSync(web), ...readdirSync(new URL("kinds/", web)).map((name) => `kinds/${name}`)].filter((name) => /\.(js|html|css)$/.test(name))
  assert.ok(sources.length > 20)
  for (const name of sources) {
    const text = readFileSync(new URL(name, web), "utf8")
    assert.doesNotMatch(text, /\b(game|games|gameplay|unreal|blueprints?|UE[45]?|level design|characters?, props)\b/i, `${name} speaks of a game`)
    // The default scopes are data from the engine; the page never spells their ids or labels.
    assert.doesNotMatch(text, /['"`]#\/(main|material)\b|['"`](main|material)['"`]\s*[=!]==|===\s*['"`](main|material)['"`]|>Main<|>Material</, `${name} names a scope`)
  }
})
