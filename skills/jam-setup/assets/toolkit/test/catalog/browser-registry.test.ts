// The media kind registry in the page, proved with a kind the page was never written for: the
// text-kind example plugin adds plain text as a fifth media kind. Its viewer module ships beside
// the plugin (outside the project), is served only because the plugin declares it, and registers
// through the same call as the four built-in kinds. Nothing in the page names "text".
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import textKind from "../../examples/plugins/text-kind.ts"
import { definePlugin } from "../../src/catalog/plugin.ts"
import { cleanup, makeProject, png, TYPES, W, write } from "./helpers.ts"
import { browserOrSkip, startServer } from "./server.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const viewer = (): Any => (globalThis as Any).catalogViewer
const OUT = "test-output/browser/browser-registry"
const SCRIPT = "INT. WORKSHOP - NIGHT\n\nThe smith turns the helm over in her hands.\n\n    SMITH\nToo heavy by half.\n"

const project = () =>
  makeProject({
    assets: { "art/helm.png": png(4, 4, [200, 0, 0, 255]), "art/scene.txt": SCRIPT, "art/binary.txt": Buffer.from([0x00, 0x01, 0x02, 0x03]) },
    extra: { types: { ...TYPES, scene: { label: "Scene", thumb: "script", fields: [], roles: [{ key: "script", label: "Script", kinds: ["text"], expected: true }, { key: "still", label: "Still", kinds: ["image"] }] } } },
    units: [
      { id: "scene/workshop", type: "scene", name: "Workshop", attrs: {}, links: [{ role: "script", asset: "art/scene.txt" }, { role: "still", asset: "art/helm.png" }] },
      { id: "scene/broken", type: "scene", name: "Broken", attrs: {}, links: [{ role: "script", asset: "art/binary.txt" }] }
    ]
  })

test("a plugin's media kind is recognised, served, shown, controlled, compared and captured like a built-in one", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const dir = await project()
  write(dir, "catalog.config.json", { version: 2, plugins: ["manifest", "text-kind"] })
  const s = await startServer(dir, { plugins: { "text-kind": textKind } })
  mkdirSync(OUT, { recursive: true })
  try {
    // The engine half: recognised by bytes, labelled, with the address of its browser module.
    const schema = await s.app.run("schema", {})
    assert.deepEqual(Object.keys(schema.mediaKinds), ["image", "video", "model", "audio", "text"])
    assert.equal(schema.mediaKinds.text.label, "Text")
    assert.match(schema.mediaKinds.text.web, /^\/project\/kind\/text\?v=[0-9a-f]{16}$/)
    const detail = await s.app.run("unit.get", { id: "scene/workshop" })
    assert.deepEqual([detail.links[0].asset.kind, detail.links[0].asset.state, detail.links[0].asset.mime], ["text", "ok", "text/plain; charset=utf-8"])
    assert.equal((await s.app.run("unit.get", { id: "scene/broken" })).links[0].asset.state, "invalid", "a .txt whose bytes are not text is not text")
    assert.deepEqual((await s.app.run("problems", {})).problems, [])

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(String(error)))
    const requested: Array<string> = []
    page.on("request", (request) => requested.push(new URL(request.url()).pathname))

    // The page half: the module is fetched from its declared address and its viewer shows the file.
    await page.goto(`${s.url}#/content/u/scene%2Fworkshop`)
    await page.waitForFunction(() => (globalThis as Any).catalogViewer?.state().viewer?.status === "ready")
    assert.ok(requested.includes("/project/kind/text"), "the kind's module was loaded from the plugin's folder")
    const state = await page.evaluate(viewer).then(() => page.evaluate(() => (globalThis as Any).catalogViewer.state()))
    assert.deepEqual([state.viewer.kind, state.viewer.lines, state.viewer.controls, state.selection.part], ["text", SCRIPT.split("\n").length, ["text"], "script"])
    assert.equal(state.viewer.source.sha256, detail.links[0].asset.sha256)
    assert.equal(await page.locator("[data-text-viewer]").textContent(), SCRIPT)
    // Its thumbnail and icon are the ones it registered; its label is the schema's.
    assert.equal(await page.locator(".strip .tile.on .thumb").textContent(), "Aa")
    assert.match(await page.locator('section[aria-label="Files"] .mship').first().innerText(), /Script\s+scene\.txt/)
    await page.screenshot({ path: `${OUT}/text-detail.png` })
    // Switching to a built-in kind and back swaps viewers through the same registry.
    await page.locator(".strip").getByRole("tab", { name: /Still/ }).click()
    await page.waitForFunction(() => (globalThis as Any).catalogViewer.state().viewer?.kind === "image" && (globalThis as Any).catalogViewer.state().viewer.status === "ready")
    await page.locator(".strip").getByRole("tab", { name: /Script/ }).click()
    await page.waitForFunction(() => (globalThis as Any).catalogViewer.state().viewer?.kind === "text" && (globalThis as Any).catalogViewer.state().viewer.status === "ready")
    // A control only this kind has, and one it does not have.
    assert.deepEqual(await page.evaluate(() => (globalThis as Any).catalogViewer.control({ text: { wrap: false } })), { ok: true })
    await page.waitForFunction(() => (globalThis as Any).catalogViewer.state().viewer.wrap === false)
    assert.equal(await page.locator("[data-text-viewer]").evaluate((element) => getComputedStyle(element).whiteSpace), "pre")
    assert.equal((await page.evaluate(() => (globalThis as Any).catalogViewer.control({ text: { wrap: "yes" } }))).code, "invalid")
    assert.match((await page.evaluate(() => (globalThis as Any).catalogViewer.control({ mode: "clay" }))).error, /the current text viewer does not support this control/)
    assert.deepEqual(await page.evaluate(() => (globalThis as Any).catalogViewer.capture()), { renderer: "catalog text viewer", blocked: null })

    // Lists: the files page shows it with its own thumbnail and label, and filters by its kind.
    await page.goto(`${s.url}#/files`)
    const card = page.getByRole("listitem").filter({ hasText: "scene.txt" })
    await card.waitFor()
    assert.equal(await card.locator(".card-media .thumb").first().textContent(), "Aa")
    assert.match(await card.locator(".card-sub").innerText(), /^Text · /)
    await page.screenshot({ path: `${OUT}/files-with-text.png` })
    await page.goto(`${s.url}#/files/a/art%2Fscene.txt`)
    await page.waitForFunction(() => (globalThis as Any).catalogViewer?.state().viewer?.status === "ready")
    assert.match(await page.locator(".d-meta .type").innerText(), /Text/)
    // A file of the kind that cannot be shown says why, as any kind's would.
    await page.goto(`${s.url}#/content/u/scene%2Fbroken`)
    await page.waitForFunction(() => (globalThis as Any).catalogViewer?.state().viewer?.status === "error")
    assert.match((await page.evaluate(() => (globalThis as Any).catalogViewer.state())).viewer.error, /declared text but bytes are|not a supported media format/)

    // Review: frozen text is shown by the same viewer, and compared side by side after an edit.
    const submitted = await W(s.app)("review.submit", { title: "Workshop scene", items: [{ target: { kind: "unit", id: "scene/workshop" }, parts: ["script"] }] })
    const review = await s.app.run("review.get", { submission: submitted.submission.id })
    await page.goto(`${s.url}#/reviews/s/${review.id}/${review.items[0].id}`)
    await page.waitForFunction(() => (globalThis as Any).catalogViewer?.state().viewer?.status === "ready")
    const frozen = await page.evaluate(() => (globalThis as Any).catalogViewer.state())
    assert.deepEqual([frozen.viewer.kind, frozen.selection.submission], ["text", review.id])
    assert.equal(await page.locator("[data-text-viewer]").textContent(), SCRIPT)
    await page.screenshot({ path: `${OUT}/text-review.png` })
    write(dir, "art/scene.txt", `${SCRIPT}\nShe sets it down.\n`)
    await page.goto(`${s.url}#/content/u/scene%2Fworkshop?cmp=${review.id}~${review.items[0].id}~script`)
    await page.waitForFunction(() => { const v = (globalThis as Any).catalogViewer?.state().viewer; return v?.kind === "compare" && v.status === "ready" })
    const compared = await page.evaluate(() => (globalThis as Any).catalogViewer.state())
    assert.deepEqual(compared.viewer.sides.map((side: Any) => [side.side, side.kind, side.status]), [["a", "text", "ready"], ["b", "text", "ready"]])
    assert.deepEqual(compared.viewer.identical, [false])
    const sides = await page.locator(".dialog.compare [data-text-viewer]").allTextContents()
    assert.deepEqual(sides, [SCRIPT, `${SCRIPT}\nShe sets it down.\n`])
    assert.deepEqual(await page.evaluate(() => (globalThis as Any).catalogViewer.capture()), { renderer: "catalog text viewer", blocked: null })
    await page.screenshot({ path: `${OUT}/text-compare.png` })
    await page.close()

    // An agent's viewer session: open, control and capture go through the same registered viewer.
    const opened = await s.viewer("viewer.open", { target: { kind: "unit", id: "scene/workshop", part: "script" }, size: { width: 900, height: 600 } })
    assert.deepEqual([opened.state.viewer.kind, opened.state.viewer.status, opened.pageErrors], ["text", "ready", []])
    const controlled = await s.viewer("viewer.control", { text: { wrap: false } })
    assert.equal(controlled.state.viewer.wrap, false)
    const capture = await s.viewer("viewer.capture", {})
    assert.equal(capture.renderer, "catalog text viewer, headless Chromium")
    assert.equal(capture.shows.part, "script")
    const shot = readFileSync(join(dir, capture.file))
    assert.equal(shot.subarray(1, 4).toString(), "PNG")
    assert.ok(capture.width > 300 && capture.height > 200)
    assert.match(capture.file, /^\.catalog\/\.local\/captures\//)
    await s.viewer("viewer.close", {})
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await s.close()
    cleanup(dir)
  }
})

test("a kind nothing registered a viewer for is listed and labelled, and says that it cannot be shown", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const dir = await project()
  // The same kind without its browser half, and one whose declared module is not there.
  const bare = definePlugin({ name: "bare", mediaKinds: [{ ...textKind.mediaKinds[0]!, web: undefined as never }] })
  const lost = definePlugin({ name: "lost", mediaKinds: [{ ...textKind.mediaKinds[0]!, web: new URL("./no-such-module.js", import.meta.url).href }] })
  write(dir, "catalog.config.json", { version: 2, plugins: ["manifest", "bare"] })
  const s = await startServer(dir, { plugins: { bare, lost } })
  try {
    const page = await browser.newPage()
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.goto(`${s.url}#/content/u/scene%2Fworkshop`)
    await page.waitForFunction(() => (globalThis as Any).catalogViewer?.state().viewer?.status === "error")
    const state = await page.evaluate(() => (globalThis as Any).catalogViewer.state())
    assert.deepEqual([state.viewer.kind, state.viewer.error], ["text", "No viewer is registered for text media"])
    assert.equal(await page.locator(".stage-view [role=alert]").innerText(), "No viewer is registered for text media")
    // It is still a file of the catalog: listed, labelled from the schema, with a plain thumbnail.
    await page.goto(`${s.url}#/files`)
    const card = page.getByRole("listitem").filter({ hasText: "scene.txt" })
    await card.waitFor()
    assert.match(await card.locator(".card-sub").innerText(), /^Text · /)
    assert.equal(await card.locator(".thumb.plain").count(), 1)
    // A viewer that is not ready is never captured.
    await s.viewer("viewer.open", { target: { kind: "unit", id: "scene/workshop", part: "script" } })
    await assert.rejects(s.viewer("viewer.capture", {}), /viewer is not showing ready media \(error: No viewer is registered for text media\); nothing was captured/)
    await s.viewer("viewer.close", {})
    // A declared module that is missing: the schema says so and the page does not ask for it.
    write(dir, "catalog.config.json", { version: 2, plugins: ["manifest", "lost"] })
    const schema = await s.app.run("schema", {})
    assert.deepEqual([schema.mediaKinds.text.web, /missing/.test(schema.mediaKinds.text.webError)], [null, true])
    assert.deepEqual(errors, [])
    await page.close()
  } finally {
    await browser.close()
    await s.close()
    cleanup(dir)
  }
})

test("the page has no list of media kinds of its own: the registry is the only place that knows them", () => {
  const web = new URL("../../catalog/web/", import.meta.url)
  const files = ["app.js", "compare.js", "controller.js", "core.js", "detail.js", "inbox.js", "lists.js", "markdown.js", "media-kinds.js", "notes.js", "organize.js", "plugin-api.js", "previews.js", "review.js", "viewers.js"]
  for (const file of files) {
    assert.ok(existsSync(new URL(file, web)), file)
    const source = readFileSync(new URL(file, web), "utf8").split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n")
    // Outside kinds/, no code compares against or names a built-in kind id.
    const hits = source.match(/['"`](image|video|model|audio)['"`]/g) ?? []
    assert.deepEqual(hits, [], `${file} names a media kind`)
  }
  // Each built-in kind is one module that registers itself, like a plugin's.
  for (const kind of ["image", "video", "model", "audio"]) {
    assert.match(readFileSync(new URL(`kinds/${kind}.js`, web), "utf8"), new RegExp(`registerMediaKind\\('${kind}', \\{`))
  }
})
