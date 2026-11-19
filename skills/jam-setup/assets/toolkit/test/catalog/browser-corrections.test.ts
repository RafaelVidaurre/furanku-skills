// Ported from the version 1 engine's browser-corrections.test.mjs. Real Chromium/WebGL acceptance
// for the correction pass: selection errors, project preview modules (current and frozen), human
// submission parity, view-state restoration, notes in the UI, inspection controls, touch gestures,
// slow comparisons, refresh stability and variant changes.
//
// Changed: the agent's viewer actions run through the server's own renderer (`server.viewer`), as
// `/api/run/viewer.*` does; the original posted them over HTTP.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import type { Browser, BrowserContextOptions } from "playwright"
import { definePlugin } from "../../src/catalog/plugin.ts"
import { type App, cleanup, git, glb, human, makeProject, png, read, W, write } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, startServer, type TestPage, type TestServer, withTexture } from "./server.ts"

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const { shot } = screenshots(import.meta.url)
const LINEUP = fileURLToPath(new URL("../../examples/previews/lineup.mjs", import.meta.url))
let dir: string
let app: App
let server: TestServer
let browser: Browser
let base: string
let found: Awaited<ReturnType<typeof browserOrSkip>>
const unit = (id: string) => ({ kind: "unit", id })
const cmp = (submission: string, item: string, part: string) => `cmp=${encodeURIComponent(JSON.stringify({ a: { submission, item, part } }))}`
// The project's preview module, declared by a plugin of the project.
const lineup = definePlugin({ name: "lineup", browserModules: { lineup: "previews/lineup.mjs" } })

const page = (opts: BrowserContextOptions = {}): Promise<TestPage> => newPage(browser, { viewport: { width: 1440, height: 900 }, ...opts })
const done = async (p: TestPage): Promise<void> => {
  const errors = p.errors
  await p.close()
  assert.deepEqual(errors, [], "no page errors")
}
const state = (p: TestPage): Promise<Any> => p.evaluate(() => window.catalogViewer.state())
const settled = (p: TestPage): Promise<Any> => p.evaluate(() => window.catalogViewer.settled(15000))
const api = (name: string, input: unknown): Promise<Any> => server.viewer(name, input)
const touchDrag = async (p: TestPage, from: readonly [number, number], to: readonly [number, number], steps = 8): Promise<void> => {
  const cdp = await p.context().newCDPSession(p)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] })
  for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from[0] + ((to[0] - from[0]) * i) / steps, y: from[1] + ((to[1] - from[1]) * i) / steps }] })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await cdp.detach()
}

before(async () => {
  found = await browserOrSkip()
  if ("skip" in found) return
  browser = found.browser
  const tex = png(16, 16, [180, 60, 60, 255])
  dir = await makeProject({
    assets: {
      "art/helm.png": png(64, 64, [200, 40, 40, 255]),
      "art/helm.glb": await withTexture(await glb({ clips: ["Idle", "Alert"], meshes: 2 }), tex),
      "art/sheet.png": png(64, 64, [9, 9, 200, 255]),
      "art/boots.png": png(64, 64, [40, 160, 40, 255]),
      "art/boots.glb": await glb({ size: 2 }),
      "art/stand.glb": await glb({ size: 3 }),
      "art/helm_variant.glb": await glb({ size: 0.5, clips: ["Idle"] })
    },
    units: [
      { id: "armor/helm", type: "armor", name: "Iron Helm", attrs: { slot: "Head" }, links: [{ role: "icon", asset: "art/helm.png" }, { role: "model", asset: "art/helm.glb" }, { role: "concept", asset: "art/sheet.png" }] },
      { id: "armor/boots", type: "armor", name: "Iron Boots", attrs: { slot: "Feet" }, links: [{ role: "icon", asset: "art/boots.png" }, { role: "model", asset: "art/boots.glb" }] }
    ],
    collections: [{ id: "row/iron", name: "Iron Row", kind: "lineup", members: [{ unit: "armor/helm" }, { unit: "armor/boots" }] }],
    extra: { collectionKinds: { lineup: { label: "Lineup", preview: { label: "Lineup", module: "lineup", roles: ["model"], base: "art/stand.glb", config: { spacing: 1.75 } } } } },
    commit: false
  })
  mkdirSync(join(dir, "previews"), { recursive: true })
  copyFileSync(LINEUP, join(dir, "previews/lineup.mjs"))
  write(dir, "catalog.config.json", { version: 3, plugins: ["manifest", "lineup"] })
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=160x120:d=1:r=12", "-pix_fmt", "yuv420p", "-c:v", "libx264", join(dir, "art/clip.mp4")])
  const helm = read(dir, "content/armor_helm.json")
  helm.links.push({ role: "clip", asset: "art/clip.mp4" })
  write(dir, "content/armor_helm.json", helm)
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "initial")
  server = await startServer(dir, { plugins: { lineup } })
  app = server.app
  base = server.url
})
after(async () => {
  await browser?.close()
  await server?.close()
  if (dir) cleanup(dir)
})

describe("selection integrity", () => {
  it("P2 explicit missing parts, views, items and members are errors for people and agents; empty selections default", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const p = await page()
    await p.goto(`${base}#/main/u/armor%2Fhelm?part=nope`)
    await settled(p)
    const st = await state(p)
    assert.equal(st.selection.unavailable, true)
    assert.equal(st.viewer.status, "error")
    assert.match((await p.textContent(".stage-view"))!, /No media part or inspector "nope"/)
    await shot(p, "missing-part")
    await p.goto(`${base}#/main/u/armor%2Fhelm`)
    await settled(p)
    assert.equal((await state(p)).selection.part, "icon", "no selection chooses the first media part")
    await p.goto(`${base}#/collections/c/row%2Firon/armor%2Fghost`)
    await settled(p)
    assert.equal((await state(p)).selection.unavailable, true)
    assert.match((await p.textContent(".detail"))!, /not a member/)
    const s = await W(app, human)("review.submit", { items: [{ target: unit("armor/helm"), parts: ["icon"] }] })
    await p.goto(`${base}#/reviews/s/${s.submission.id}/it_doesnotexist`)
    await settled(p)
    assert.equal((await state(p)).selection.unavailable, true)
    const rv = await app.run("review.get", { submission: s.submission.id })
    await p.goto(`${base}#/reviews/s/${rv.id}/${rv.items[0].id}?view=vw_missing`)
    await settled(p)
    assert.equal((await state(p)).selection.unavailable, true)
    assert.equal((await state(p)).viewer.status, "error")
    await done(p)
    // Agents: open fails; nothing can be captured as a substitute.
    const bad = await api("viewer.open", { target: { kind: "unit", id: "armor/helm", part: "nope" }, session: "p2" }).catch((e) => e)
    assert.equal(bad.code, "not_found")
    const refused = await api("viewer.capture", { session: "p2" }).catch((e) => e)
    assert.equal(refused.code, "unavailable")
    const okOpen = await api("viewer.open", { target: { kind: "unit", id: "armor/helm", part: "model" }, session: "p2" })
    assert.equal(okOpen.state.viewer.shows.part, "model")
    const cap = await api("viewer.capture", { session: "p2" })
    assert.equal(cap.shows.part, "model")
    assert.equal(cap.shows.sha256, okOpen.state.selection.asset.sha256)
    await api("viewer.close", { session: "p2" })
  })
})

describe("project preview modules", () => {
  it("P3 a project module renders current and frozen previews with its declared config, base and members under shared controls", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const p = await page()
    await p.goto(`${base}#/collections/c/row%2Firon`)
    await settled(p)
    const v = (await state(p)).viewer
    assert.equal(v.status, "ready")
    assert.equal(v.shows.module, "lineup")
    assert.equal(v.shows.spacing, 1.75, "declared config reached the module")
    assert.equal(v.files.models.length, 2)
    assert.equal(v.files.ghosts.length, 2)
    assert.ok(v.files.ghosts.every((u: string) => u.includes("stand.glb")), "declared base dependency loaded")
    await shot(p, "preview-lineup-current")
    // Agents drive the same module viewer.
    await api("viewer.open", { target: { kind: "collection", id: "row/iron" }, session: "p3" })
    const ctl = await api("viewer.control", { session: "p3", mode: "clay", camera: { position: [4, 3, 6], target: [1, 0.5, 0] } })
    assert.equal(ctl.state.viewer.mode, "clay")
    const cap = await api("viewer.capture", { session: "p3" })
    assert.equal(cap.shows.module, "lineup")
    // Freeze, then change base, member bytes and config: the frozen preview renders exactly the reviewed inputs.
    const s = await W(app, human)("review.submit", { items: [{ target: { kind: "collection", id: "row/iron" }, parts: ["preview"] }] })
    const rv = await app.run("review.get", { submission: s.submission.id })
    const frozen = Object.fromEntries(rv.items[0].parts[0].leaves.map((l: Any) => [l.key, l.sha256]))
    write(dir, "art/stand.glb", await glb({ size: 7 }))
    write(dir, "art/boots.glb", await glb({ size: 4 }))
    const m = read(dir, "catalog.manifest.json")
    m.collectionKinds.lineup.preview.config = { spacing: 3 }
    write(dir, "catalog.manifest.json", m)
    // This is already the current URL: goto would leave refresh to the visibility-
    // sensitive 2.5-second poll. Reload to fetch the edited fixture deterministically.
    await p.reload()
    await p.waitForFunction(() => window.catalogViewer?.state().viewer?.shows?.spacing === 3)
    await settled(p)
    assert.equal((await state(p)).viewer.shows.spacing, 3)
    await p.goto(`${base}#/reviews/s/${rv.id}/${rv.items[0].id}`)
    await settled(p)
    const fv = (await state(p)).viewer
    assert.equal(fv.status, "ready")
    assert.equal(fv.shows.spacing, 1.75, "frozen config")
    assert.ok(fv.files.ghosts.every((u: string) => u.includes("/media/evidence/") && u.includes("leaf=base")), "frozen base bytes, not current")
    assert.ok(fv.files.models.every((u: string) => u.includes("/media/evidence/")))
    const c = await app.run("evidence.compare", { a: { submission: rv.id, item: rv.items[0].id, part: "preview" }, b: "current" })
    assert.equal(c.rows.find((r: Any) => r.key === "base").a.sha256, frozen["base"])
    assert.notEqual(c.rows.find((r: Any) => r.key === "base").b.sha256, frozen["base"])
    await shot(p, "preview-lineup-frozen")
    await api("viewer.close", { session: "p3" })
    await done(p)
  })
})

describe("human submission parity and view state", () => {
  it("P4 the submit dialog creates several captioned views of one part, a captured camera/state, and an explicit correction link", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const first = await W(app, human)("review.submit", { title: "Helm first look", items: [{ target: unit("armor/helm"), parts: ["model"] }] })
    const p = await page()
    await p.goto(`${base}#/reviews`)
    await p.getByRole("button", { name: "New review", exact: true }).click()
    await p.getByRole("searchbox", { name: "Find items to review" }).fill("Iron Helm")
    await p.locator('.picker-item:has-text("Iron Helm") input').check()
    await p.getByRole("button", { name: "Continue", exact: true }).click()
    await settled(p)
    await p.evaluate(() => window.catalogViewer.control({ camera: { position: [0.3, 2.5, 2], target: [0.5, 0.5, 0] }, mode: "clay", animation: { clip: "Alert", time: 0.4, playing: false } }))
    await p.waitForSelector(".dialog.submit")
    await p.fill('.dialog.submit input[aria-label="Title"]', "Helm silhouette pass")
    await p.click('.ptog:has-text("Concept")')
    // Keep only model views: two of them, one with the captured camera.
    while (await p.locator(".view-row select").count() > 0 && (await p.locator(".view-row select").first().inputValue()) !== "model") await p.click('.view-row button[aria-label^="Remove view"] >> nth=0')
    await p.fill(".view-row input >> nth=0", "Helm · front")
    await p.click(".add-view")
    const rows = p.locator(".view-row")
    await rows.nth(1).locator("select").selectOption("model")
    await rows.nth(1).locator("input").fill("Helm · high angle, clay")
    await rows.nth(1).locator('button:has-text("Use current view")').click()
    for (let i = (await rows.count()) - 1; i >= 2; i--) await rows.nth(i).locator('button[aria-label^="Remove view"]').click()
    await p.selectOption('.dialog.submit select[aria-label="Replaces"]', first.submission.id)
    await shot(p, "submit-dialog")
    await p.click('.dialog.submit button:has-text("Submit")')
    await p.waitForFunction(() => location.hash.startsWith("#/reviews/s/"))
    const id = decodeURIComponent((await p.evaluate(() => location.hash)).split("/")[3]!.split("?")[0]!)
    const rv = await app.run("review.get", { submission: id })
    assert.equal(rv.title, "Helm silhouette pass")
    assert.equal(rv.supersedes, first.submission.id)
    assert.ok(!rv.items[0].parts.some((x: Any) => x.id.startsWith("concept")))
    const mv = rv.items[0].views.filter((x: Any) => x.part === "model")
    assert.deepEqual(mv.map((x: Any) => x.caption), ["Helm · front", "Helm · high angle, clay"])
    assert.deepEqual(mv[1].camera.position.map((x: number) => Math.round(x * 10) / 10), [0.3, 2.5, 2])
    assert.equal(mv[1].state.mode, "clay")
    assert.equal(mv[1].state.animation.clip, "Alert")
    assert.ok(Math.abs(mv[1].state.animation.time - 0.4) < 0.05)
    await done(p)
  })

  it("P7 a reopened view restores camera, surface mode and animation pose; unsupported state is reported", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const s = await W(app, human)("review.submit", {
      items: [{
        target: unit("armor/helm"),
        parts: ["model"],
        views: [
          { part: "model", caption: "Clay idle", camera: { position: [1, 2, 3], target: [0.5, 0.5, 0] }, state: { mode: "clay", animation: { clip: "Idle", time: 0.6, playing: false } } },
          { part: "model", caption: "Missing clip", state: { animation: { clip: "Dance", time: 0 }, isolate: "nothing" } }
        ]
      }]
    })
    const rv = await app.run("review.get", { submission: s.submission.id })
    const [v1, v2] = rv.items[0].views
    const p = await page()
    await p.goto(`${base}#/reviews/s/${rv.id}/${rv.items[0].id}?view=${v1.id}`)
    await settled(p)
    let v = (await state(p)).viewer
    assert.equal(v.mode, "clay")
    assert.equal(v.animation.clip, "Idle")
    assert.ok(Math.abs(v.animation.time - 0.6) < 0.01)
    assert.deepEqual(v.camera.position, [1, 2, 3])
    assert.deepEqual(v.restoreIssues, [])
    await shot(p, "review-restored-clay-view")
    const cap = await api("viewer.open", { target: { kind: "submission", id: rv.id, item: rv.items[0].id, view: v1.id }, session: "p7" })
    assert.equal(cap.state.viewer.mode, "clay")
    assert.ok(Math.abs(cap.state.viewer.animation.time - 0.6) < 0.01)
    await api("viewer.close", { session: "p7" })
    await p.goto(`${base}#/reviews/s/${rv.id}/${rv.items[0].id}?view=${v2.id}`)
    await settled(p)
    v = (await state(p)).viewer
    assert.equal(v.animation.missing, "Dance")
    assert.ok(v.restoreIssues.some((x: string) => /Dance/.test(x)) && v.restoreIssues.some((x: string) => /nothing/.test(x)))
    assert.match((await p.textContent(".viewer-note"))!, /No "Dance" clip/)
    await done(p)
  })
})

describe("interaction coverage", () => {
  it("T07 notes in the UI: edit, deal with an explanation, reopen and clear", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const p = await page()
    await p.goto(`${base}#/main/u/armor%2Fboots`)
    await settled(p)
    await p.locator(".disclosure > summary").filter({ hasText: /^Notes/ }).click()
    await p.fill(".note-new textarea", "Toe cap too round")
    await p.click('.note-new button:has-text("Add")')
    const note = p.locator('.note:has-text("Toe cap too round")')
    await note.waitFor()
    await note.hover()
    await note.locator('button[aria-label="Edit note"]').click()
    await p.locator(".note-edit textarea").fill("Toe cap too round at 10 m")
    await p.locator('.note-edit button:has-text("Save")').click()
    await p.waitForSelector('.note:has-text("Toe cap too round at 10 m")')
    const edited = p.locator('.note:has-text("at 10 m")')
    await edited.hover()
    await edited.locator('button:has-text("Dealt with")').click()
    await p.fill(".resolve input", "Squared in v2")
    await p.click(".resolve button")
    await p.waitForSelector('.block[aria-label="Notes"] details summary:has-text("Dealt with")')
    const n = (await app.run("note.list", { state: "all", target: unit("armor/boots") })).notes[0]
    assert.equal(n.body, "Toe cap too round at 10 m")
    assert.equal(n.resolved.explanation, "Squared in v2")
    await p.click('.block[aria-label="Notes"] details summary')
    const resolved = p.locator(".note.resolved")
    await resolved.hover()
    await shot(p, "unit-notes-dealt-with")
    await resolved.locator('button:has-text("Reopen")').click()
    await p.waitForFunction(() => !document.querySelector(".note.resolved"))
    const open = p.locator('.note:has-text("at 10 m")')
    await open.hover()
    await open.locator('button[aria-label="Clear note"]').click()
    await open.locator('button:has-text("Clear")').click()
    await p.waitForFunction(() => !document.body.textContent!.includes("at 10 m"))
    assert.equal((await app.run("note.list", { state: "all", target: unit("armor/boots") })).total, 0)
    await done(p)
  })

  it("T17 texture inspection and mesh isolation through the visible controls", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const p = await page()
    await p.goto(`${base}#/main/u/armor%2Fhelm?part=model`)
    await settled(p)
    const v0 = (await state(p)).viewer
    assert.ok(v0.textures.length >= 1 && v0.meshes.length === 2)
    await shot(p, "unit-detail-model")
    await p.selectOption('select[aria-label="Inspect texture"]', v0.textures[0].id)
    await p.waitForSelector(".tex-panel canvas")
    await p.waitForFunction(() => document.querySelector<HTMLCanvasElement>(".tex-panel canvas")?.width === 16, null, { timeout: 5000 })
    await p.selectOption('select[aria-label="Isolate mesh"]', "1")
    assert.equal((await state(p)).viewer.isolate, 1)
    await shot(p, "inspect-texture-isolate")
    await p.click('.tex-panel button[aria-label="Close texture"]')
    await p.selectOption('select[aria-label="Isolate mesh"]', "")
    assert.equal((await state(p)).viewer.isolate, null)
    await done(p)
  })

  it("T18 shortcuts are ignored while a video control has focus", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const p = await page()
    await p.goto(`${base}#/main/u/armor%2Fhelm?part=clip`)
    await settled(p)
    const url = p.url()
    await p.focus(".viewer-video video")
    for (const k of ["j", "k", "/", "Escape"]) await p.keyboard.press(k)
    assert.equal(p.url(), url)
    await done(p)
  })

  it("T16/IA-33 touch: dragging the divider differs from a tap; a caption-bar swipe changes views while viewer gestures do not", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const s = await W(app, human)("review.submit", { items: [{ target: unit("armor/helm"), parts: ["icon", "model"], views: [{ part: "icon", caption: "Icon" }, { part: "model", caption: "Model A" }, { part: "model", caption: "Model B" }] }] })
    const rv = await app.run("review.get", { submission: s.submission.id })
    write(dir, "art/helm.png", png(64, 64, [10, 10, 10, 255]))
    const p = await page({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await p.goto(`${base}#/main/u/armor%2Fhelm?${cmp(rv.id, rv.items[0].id, "icon")}`)
    await settled(p)
    await p.waitForSelector(".slider")
    const box = (await p.locator(".slider").boundingBox())!
    await touchDrag(p, [box.x + box.width * 0.5, box.y + box.height * 0.5], [box.x + box.width * 0.15, box.y + box.height * 0.5])
    const moved = Number(await p.getAttribute(".slider-handle", "aria-valuenow"))
    assert.ok(moved < 25, `touch drag moved the divider (${moved})`)
    await p.touchscreen.tap(box.x + box.width * 0.7, box.y + box.height * 0.5)
    assert.ok(Math.abs(Number(await p.getAttribute(".slider-handle", "aria-valuenow")) - 70) <= 2, "a tap places the divider")
    assert.equal(await p.locator(".dialog.full").count(), 0, "a tap does not open full screen")
    await p.keyboard.press("Escape")
    await p.goto(`${base}#/reviews/s/${rv.id}/${rv.items[0].id}`)
    await settled(p)
    const views = rv.items[0].views
    await p.locator(".caption-bar").scrollIntoViewIfNeeded()
    const bar = (await p.locator(".caption-bar").boundingBox())!
    await touchDrag(p, [bar.x + bar.width * 0.8, bar.y + bar.height / 2], [bar.x + bar.width * 0.1, bar.y + bar.height / 2], 5)
    await p.waitForFunction((id) => location.hash.includes(id), views[1].id)
    // A horizontal drag on the image viewer pans it; it does not change the view.
    await p.goto(`${base}#/reviews/s/${rv.id}/${rv.items[0].id}?view=${views[0].id}`)
    await settled(p)
    const st = (await p.locator(".stage-view").boundingBox())!
    await touchDrag(p, [st.x + st.width * 0.8, st.y + st.height / 2], [st.x + st.width * 0.2, st.y + st.height / 2], 5)
    await p.waitForTimeout(300)
    assert.ok(p.url().includes(views[0].id), "viewer pan did not navigate")
    await p.click('.caption-bar button[aria-label="Next view"]')
    await p.waitForFunction((id) => location.hash.includes(id), views[1].id)
    await shot(p, "narrow-swipe-views")
    await done(p)
  })

  it("T24 a slow comparison reports loading until both sides are ready", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const s = await W(app, human)("review.submit", { items: [{ target: unit("armor/boots"), parts: ["icon"] }] })
    const rv = await app.run("review.get", { submission: s.submission.id })
    write(dir, "art/boots.png", png(64, 64, [250, 250, 0, 255]))
    const p = await page()
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => { release = r })
    await p.route("**/media/evidence/**", async (route) => {
      await gate
      await route.continue()
    })
    await p.goto(`${base}#/main/u/armor%2Fboots?${cmp(rv.id, rv.items[0].id, "icon")}`)
    await p.waitForFunction(() => window.catalogViewer.state().viewer?.kind === "compare")
    assert.equal((await state(p)).viewer.status, "loading")
    assert.equal(await p.evaluate(() => window.catalogViewer.settled(800)), false, "not settled while a side is loading")
    release()
    await settled(p)
    const v = (await state(p)).viewer
    assert.equal(v.status, "ready")
    assert.ok(v.sides.every((x: Any) => x.status === "ready"))
    await shot(p, "compare-image-with-current")
    await done(p)
  })

  it("T03/T04 refresh changes only affected state; a project variant change keeps the selected part, camera, draft and targets", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const p = await page()
    await W(app, human)("review.decideCurrent", { target: unit("armor/helm"), whole: "approved" })
    await p.goto(`${base}#/main/u/armor%2Fhelm?part=model`)
    await settled(p)
    await p.evaluate(() => window.catalogViewer.control({ camera: { position: [2, 1, 2], target: [0.5, 0.5, 0] } }))
    await p.locator(".disclosure > summary").filter({ hasText: /^Notes/ }).click()
    await p.fill(".note-new textarea", "Draft during refresh")
    const before = (await state(p)).viewer
    write(dir, "art/sheet.png", png(64, 64, [1, 255, 1, 255])) // unrelated to the model view
    await p.waitForTimeout(3300)
    await settled(p)
    const same = (await state(p)).viewer
    assert.deepEqual(same.camera, before.camera, "camera untouched")
    assert.equal(same.shows.sha256, before.shows.sha256)
    assert.equal(await p.inputValue(".note-new textarea"), "Draft during refresh")
    // Variant change in the project data: the model role now points at another asset.
    const helm = read(dir, "content/armor_helm.json")
    helm.links = helm.links.map((l: Any) => (l.role === "model" ? { role: "model", asset: "art/helm_variant.glb" } : l))
    write(dir, "content/armor_helm.json", helm)
    await p.waitForFunction(() => window.catalogViewer.state().viewer?.shows?.asset === "art/helm_variant.glb", null, { timeout: 8000 })
    await settled(p)
    const st = await state(p)
    assert.equal(st.selection.part, "model")
    assert.equal(st.viewer.status, "ready")
    assert.equal(await p.inputValue(".note-new textarea"), "Draft during refresh")
    const u = await app.run("unit.get", { id: "armor/helm" })
    const model = u.review.parts.find((x: Any) => x.id === "model")
    assert.equal(model.verdict, "approved")
    assert.equal(model.changed, true, "same part identity, changed evidence")
    await shot(p, "variant-change")
    await done(p)
  })
})
