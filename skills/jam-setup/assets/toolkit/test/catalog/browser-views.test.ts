// Type views and panels in the page: browser modules a plugin declares, mounted for one unit with a
// framework-free `mount(host, ctx)`. A person and an agent reach the same mounted view: its state,
// its controls, its state kept in the page address, and a capture that names its renderer.
import assert from "node:assert/strict"
import { copyFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { definePlugin } from "../../src/catalog/plugin.ts"
import { cleanup, git, png, tmp, write } from "./helpers.ts"
import { browserOrSkip, startServer } from "./server.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const OUT = "test-output/browser/browser-views"
const EXAMPLES = fileURLToPath(new URL("../../examples/plugins/", import.meta.url))

// A view that asks the catalog for data, reports state, answers one control and keeps its level in
// the address; a panel that writes one line.
const KIT = `
export function inspector(host, ctx) {
  const stage = document.createElement('div'); stage.style.cssText = 'width:240px;height:140px;background:#345'; ctx.markStage(stage);
  const label = document.createElement('p'); label.className = 'kit-label'; host.append(stage, label);
  let name = null, level = Number(ctx.state.level ?? 1);
  const draw = () => { label.textContent = name + ' level ' + level; };
  ctx.call('unit.get', { id: ctx.unit.id }).then((d) => { name = d.unit.name; draw(); });
  return {
    state: () => ({ status: name === null ? 'loading' : 'ready', renderer: 'kit renderer', name, level }),
    control: (c) => { if (!('level' in c)) return false; level = c.level; ctx.setState({ level }); draw(); return { level }; },
    dispose: () => host.replaceChildren(),
  };
}
export function facts(host, ctx) { const p = document.createElement('p'); p.className = 'facts-panel'; p.textContent = 'Facts for ' + ctx.unit.name; host.append(p); return { dispose() {} }; }`

const kit = definePlugin({
  name: "kit",
  sources: [{
    name: "props",
    inputs: () => ["art"],
    load: () => ({
      project: "Modules",
      assetRoots: ["art"],
      types: {
        prop: {
          label: "Prop",
          roles: [{ key: "icon", label: "Icon", kinds: ["image"] }],
          views: [{ key: "inspect", label: "Inspector", module: "kit", export: "inspector", default: true }, { key: "lost", label: "Lost", module: "undeclared" }],
          panels: [{ key: "facts", label: "Facts", module: "kit", export: "facts" }]
        }
      },
      units: [
        { id: "prop/lamp", type: "prop", name: "Lamp", links: [{ role: "icon", asset: "art/lamp.png" }] },
        { id: "prop/plain", type: "prop", name: "Plain", links: [{ role: "icon", asset: "art/lamp.png" }], views: [] }
      ]
    })
  }],
  views: { kit: "catalog/kit.js" }
})

test("a type's default view mounts for people and agents alike: state, deep-linked state, controls, panels and a verified capture", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const dir = tmp("cc-views-")
  git(dir, "init", "-q")
  write(dir, "catalog.config.json", { version: 2, plugins: ["kit"] })
  write(dir, "catalog/kit.js", KIT)
  write(dir, "art/lamp.png", png(8, 8, [200, 160, 40, 255]))
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "init")
  const s = await startServer(dir, { plugins: { kit } })
  mkdirSync(OUT, { recursive: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(String(error)))
    const requested: Array<string> = []
    page.on("request", (request) => requested.push(new URL(request.url()).pathname))
    await page.goto(`${s.url}#/content/u/prop%2Flamp?vs=${encodeURIComponent(JSON.stringify({ level: 2 }))}`)
    await page.evaluate(() => (globalThis as Any).catalogViewer.settled(15000))
    const state = await page.evaluate(() => (globalThis as Any).catalogViewer.state())
    assert.equal(state.selection.part, "view:inspect", "the default view opens before the media")
    assert.deepEqual(state.selection.parts, ["view:inspect", "view:lost", "icon"])
    assert.deepEqual([state.viewer.kind, state.viewer.status, state.viewer.name, state.viewer.level, state.viewer.source.part, state.viewer.controls], ["view", "ready", "Lamp", 2, "view:inspect", ["view"]])
    assert.ok(requested.includes("/project/view/kit"), "the module is served by its declared name")
    assert.equal(await page.textContent(".facts-panel"), "Facts for Lamp")
    assert.deepEqual(await page.evaluate(() => (globalThis as Any).catalogViewer.control({ view: { level: 5 } })), { level: 5 })
    assert.match(await page.evaluate(() => location.hash), /vs=%7B%22level%22%3A5%7D/, "the view's state is kept in the link")
    assert.equal((await page.evaluate(() => (globalThis as Any).catalogViewer.control({ view: { colour: "red" } }))).code, "unsupported")
    assert.deepEqual(await page.evaluate(() => (globalThis as Any).catalogViewer.capture()), { renderer: "kit renderer", blocked: null })
    await page.screenshot({ path: `${OUT}/view-1440.png` })
    // A view whose module nobody declared says so; the media is one tab away.
    await page.locator(".strip").getByRole("tab", { name: /Lost/ }).click()
    await page.waitForFunction(() => (globalThis as Any).catalogViewer.state().viewer?.status === "error")
    assert.match((await page.evaluate(() => (globalThis as Any).catalogViewer.state())).viewer.error, /view module "undeclared" is not declared/)
    await page.locator(".strip").getByRole("tab", { name: /Icon/ }).click()
    await page.waitForFunction(() => (globalThis as Any).catalogViewer.state().viewer?.kind === "image")
    // A unit that narrows its type's views to none opens on its media.
    await page.goto(`${s.url}#/content/u/prop%2Fplain`)
    await page.evaluate(() => (globalThis as Any).catalogViewer.settled(15000))
    assert.equal((await page.evaluate(() => (globalThis as Any).catalogViewer.state())).selection.part, "icon")
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${s.url}#/content/u/prop%2Flamp`)
    await page.evaluate(() => (globalThis as Any).catalogViewer.settled(15000))
    await page.screenshot({ path: `${OUT}/view-390.png`, fullPage: true })
    await page.close()
    assert.deepEqual(errors, [])

    // The agent's path: the same view through the viewer actions, captured only as the requested view.
    await s.viewer("viewer.open", { session: "m", target: { kind: "unit", id: "prop/lamp", part: "view:inspect" } })
    const controlled = await s.viewer("viewer.control", { session: "m", view: { level: 7 } })
    assert.equal(controlled.state.viewer.level, 7)
    const capture = await s.viewer("viewer.capture", { session: "m" })
    assert.equal(capture.shows.part, "view:inspect")
    assert.equal(capture.renderer, "kit renderer, headless Chromium")
    assert.ok(capture.width === 240 && capture.height === 140, "the capture is the element the view marked")
    await s.viewer("viewer.close", { session: "m" })
    const missing = await s.viewer("viewer.open", { session: "n", target: { kind: "unit", id: "prop/lamp", part: "view:nope" } }).catch((error: Any) => error)
    assert.equal(missing.code, "not_found")
    await s.viewer("viewer.close", { session: "n" })
  } finally {
    await browser.close()
    await s.close()
    cleanup(dir)
  }
})

test("a view module that ships beside its plugin is loaded from the plugin's folder (the storybook example)", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const dir = tmp("cc-story-views-")
  git(dir, "init", "-q")
  write(dir, "catalog.config.json", { version: 2, plugins: ["./catalog/storybook.ts"] })
  write(dir, "catalog/storybook.ts", `export { default } from ${JSON.stringify(pathToFileURL(join(EXAMPLES, "storybook.ts")).href)}\n`)
  copyFileSync(join(EXAMPLES, "storyboard.mjs"), join(dir, "catalog/storyboard.mjs"))
  write(dir, "story/scenes.json", [{ id: "opening", title: "Opening", characters: ["ada", "bo"], image: "story/opening.png" }, { id: "chase", title: "The Chase", characters: ["ada"] }])
  write(dir, "story/characters.json", [{ id: "ada", name: "Ada" }, { id: "bo", name: "Bo" }])
  write(dir, "story/order.json", ["opening", "chase"])
  write(dir, "story/opening.png", png(4, 4, [1, 2, 3, 255]))
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "story")
  const s = await startServer(dir)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`${s.url}#/story/u/scene%2Fopening?part=view:beats&vs=${encodeURIComponent(JSON.stringify({ highlight: "character/bo" }))}`)
    await page.waitForFunction(() => (globalThis as Any).catalogViewer?.state().viewer?.status === "ready")
    const state = await page.evaluate(() => (globalThis as Any).catalogViewer.state())
    assert.deepEqual([state.viewer.kind, state.viewer.cast, state.viewer.highlight, state.viewer.renderer], ["view", ["character/ada", "character/bo"], "character/bo", "storybook beats view"])
    assert.deepEqual(await page.locator(".storybook-beats [data-character]").allTextContents(), ["Ada", "Bo"])
    await page.waitForFunction(() => document.querySelector(".storybook-placement")?.textContent === "Scene 1 of 2")
    assert.equal((await page.evaluate(() => (globalThis as Any).catalogViewer.control({ view: { highlight: "character/cy" } }))).code, "invalid")
    await page.screenshot({ path: `${OUT}/storybook-beats.png` })
    await page.close()
  } finally {
    await browser.close()
    await s.close()
    cleanup(dir)
  }
})
