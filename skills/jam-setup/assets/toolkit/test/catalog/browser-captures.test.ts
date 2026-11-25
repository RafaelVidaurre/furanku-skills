// Captures and work items in the review page, and the pixel-art display policy. A capture pair is
// shown in the comparison viewer, which reports both digests so an agent's capture of it can be
// verified; a capture keeps smooth scaling while pixel-art content keeps hard texels.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { cleanup, git, png, read, standardProject, tmp, W, write } from "./helpers.ts"
import { browserOrSkip, startServer } from "./server.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const OUT = "test-output/browser/browser-captures"
const CLI = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
const ready = () => { const v = (globalThis as Any).catalogViewer?.state().viewer; return !!v && v.status === "ready" }

test("captures and work items in the review page; pixel art keeps hard texels and captures keep smooth scaling", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const dir = await standardProject()
  write(dir, "catalog.config.json", { ...read(dir, "catalog.config.json"), display: { pixelArt: true } })
  write(dir, "shots/before.png", png(64, 40, [30, 40, 60, 255]))
  write(dir, "shots/after.png", png(64, 40, [220, 180, 90, 255]))
  write(dir, "shots/close.png", png(32, 32, [90, 200, 120, 255]))
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "shots")
  const s = await startServer(dir)
  mkdirSync(OUT, { recursive: true })
  try {
    const { submission } = await W(s.app)("review.submit", {
      title: "Lighting pass on the lower crypt with warmer torches and a softer fog falloff",
      items: [
        {
          title: "Torchlight in the lower crypt",
          text: "Warm floors return; the fog no longer swallows the stairs.\nCompare the stair landing.",
          captures: [{ label: "Whole frame", renderer: "Unreal", before: "shots/before.png", after: "shots/after.png", labels: ["Before the lighting pass on the lower crypt", "After the lighting pass"] }]
        },
        { title: "Torches flicker less?", text: "Halve the pulse rate of every torch in the crypt." },
        { target: { kind: "unit", id: "armor/helm" }, parts: ["icon"], captures: [{ label: "Helm in game", renderer: "Unreal", file: "shots/close.png" }] }
      ]
    })
    const review = await s.app.run("review.get", { submission: submission.id })
    const [work, text, helm] = review.items
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(String(error)))

    // A work item: its text above the evidence, its pair compared, who rendered it as a badge.
    await page.goto(`${s.url}#/reviews/s/${submission.id}/${work.id}`)
    await page.waitForFunction(ready)
    const pair = await page.evaluate(() => (globalThis as Any).catalogViewer.state())
    assert.equal(pair.viewer.kind, "compare")
    assert.deepEqual(pair.viewer.shows.pair.map((side: Any) => [side.leaf, side.sha256]), work.parts[0].leaves.map((leaf: Any) => [leaf.key, leaf.sha256]))
    assert.equal(pair.viewer.shows.view, work.views[0].id)
    assert.match(await page.locator(".item-text").innerText(), /^Warm floors return; the fog no longer swallows the stairs\.\nCompare the stair landing\.$/)
    assert.equal(await page.locator(".renderer-badge").innerText(), "Unreal")
    assert.match(await page.locator(".rows .row.sel .row-sub").innerText(), /^Work · Undecided/)
    assert.equal(await page.locator(".item-view .d-title a").count(), 0, "work links to no content")
    // The renderer's own pixels: never nearest-neighbour, even in a pixel-art project.
    assert.deepEqual(await page.locator(".capture-pair img").evaluateAll((images) => [...new Set(images.map((image) => getComputedStyle(image).imageRendering))]), ["auto"])
    await page.screenshot({ path: `${OUT}/pair-1440.png` })
    // The capture is a way of showing the work, not something to decide: the work is the one part.
    assert.deepEqual(await page.locator(".comp-row .part-select").allInnerTexts(), ["Torchlight in the lower crypt"])
    assert.deepEqual(await page.locator(".view-tile").allInnerTexts(), ["Whole frame"])
    // A note about what this view shows names the view, and links back to it.
    await page.locator(".note-on-view").click()
    assert.match(await page.locator(".note-view-pick").innerText(), /On view: Whole frame/)
    await page.locator(".note-new textarea").fill("The stair landing is still too dark")
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await page.locator('.note .view-chip:has-text("Whole frame")').waitFor()
    await page.screenshot({ path: `${OUT}/view-note-1440.png` })

    // A text-only item is one decision.
    await page.goto(`${s.url}#/reviews/s/${submission.id}/${text.id}`)
    await page.locator(".item-text").waitFor()
    assert.equal(await page.locator(".item-view .stage").count(), 0)
    assert.deepEqual(await page.locator(".comp-row .part-select").allInnerTexts(), ["Torches flicker less?"], "decided as one part, named after the item")
    await page.screenshot({ path: `${OUT}/decision-1440.png` })

    // A unit item: its capture first, then its content, which follows the pixel-art policy.
    await page.goto(`${s.url}#/reviews/s/${submission.id}/${helm.id}`)
    await page.waitForFunction(ready)
    assert.equal((await page.evaluate(() => (globalThis as Any).catalogViewer.state())).selection.part, "capture:1")
    // A capture is not pixel art: smoothed when shown smaller, its own pixels only when magnified.
    const captureScale = (await page.evaluate(() => (globalThis as Any).catalogViewer.state())).viewer.zoom.scale
    assert.equal(await page.locator(".stage-view img").evaluate((image) => getComputedStyle(image).imageRendering), captureScale > 1 ? "pixelated" : "auto")
    await page.locator(".caption-bar").scrollIntoViewIfNeeded()
    assert.equal(await page.locator(".caption-bar .renderer-badge").innerText(), "Unreal")
    await page.screenshot({ path: `${OUT}/unit-capture-1440.png` })
    await page.locator(".strip").getByRole("tab", { name: /Icon/ }).click()
    await page.waitForFunction(() => (globalThis as Any).catalogViewer.state().selection.part === "icon" && (globalThis as Any).catalogViewer.state().viewer?.status === "ready")
    assert.equal(await page.locator(".stage-view img").evaluate((image) => getComputedStyle(image).imageRendering), "pixelated")
    // Thumbnails: whole images with hard texels.
    await page.goto(`${s.url}#/main`)
    const thumb = page.locator(".card-media .thumb img").first()
    await thumb.waitFor()
    assert.deepEqual(await thumb.evaluate((image) => [getComputedStyle(image).imageRendering, getComputedStyle(image).objectFit]), ["pixelated", "contain"])

    // Narrow: the submission header and the comparison labels wrap by word, inside the page.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${s.url}#/reviews/s/${submission.id}/${work.id}`)
    await page.waitForFunction(ready)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 0, `the page is ${overflow}px wider than the screen`)
    await page.screenshot({ path: `${OUT}/pair-390.png`, fullPage: true })
    await page.goto(`${s.url}#/reviews/s/${submission.id}/${text.id}`)
    await page.locator(".item-text").waitFor()
    await page.screenshot({ path: `${OUT}/decision-390.png`, fullPage: true })
    await page.close()
    assert.deepEqual(errors, [])

    // An agent captures the pair and the capture is verified against both digests.
    await s.viewer("viewer.open", { session: "c", target: { kind: "submission", id: submission.id, item: work.id, view: work.views[0].id } })
    const capture = await s.viewer("viewer.capture", { session: "c" })
    assert.deepEqual(capture.shows.pair.map((side: Any) => side.sha256), work.parts[0].leaves.map((leaf: Any) => leaf.sha256))
    assert.equal(capture.shows.view, work.views[0].id)
    await s.viewer("viewer.close", { session: "c" })

    // A comparison is the object evidence.compare takes: the page address carries its JSON, and an
    // agent opens or selects one with the same object (absent b: current content).
    const icon = { submission: submission.id, item: helm.id, part: "icon" }
    const cmpOf = (route: string) => new URLSearchParams(route.split("?")[1] ?? "").get("cmp")
    const opened = await s.viewer("viewer.open", { session: "cmp", target: { kind: "unit", id: "armor/helm", compare: { a: icon } } })
    assert.equal(cmpOf(opened.state.route), JSON.stringify({ a: icon }))
    assert.deepEqual([opened.state.viewer.kind, opened.state.viewer.status, opened.state.viewer.identical], ["compare", "ready", [true]])
    const selected = await s.viewer("viewer.control", { session: "cmp", select: { compare: { a: icon, b: icon } } })
    assert.equal(cmpOf(selected.state.route), JSON.stringify({ a: icon, b: icon }))
    assert.deepEqual([selected.state.viewer.kind, selected.state.viewer.status, selected.state.viewer.shows.a, selected.state.viewer.shows.b], ["compare", "ready", "Earlier", "Later"])
    await s.viewer("viewer.close", { session: "cmp" })
    const tilde = await s.viewer("viewer.open", { session: "old", target: { kind: "unit", id: "armor/helm", compare: `${submission.id}~${helm.id}~icon` } }).catch((error: Any) => error)
    assert.equal(tilde.code, "invalid", "the ~ string is not a comparison")

    // `capture --url … --out`: the file is copied from the checkout of the server that took it.
    const out = join(tmp("cc-capture-out-"), "pair.png")
    // The server answers from this process, so the command runs beside it, not blocking it.
    const cli = await promisify(execFile)(process.execPath, [CLI, "catalog", "capture", "--target", `submission:${submission.id}/${work.id}`, "--view", work.views[0].id, "--url", s.url, "--out", out, "--root", dir, "--json"], { encoding: "utf8", timeout: 120_000 })
    const copied = JSON.parse(cli.stdout)
    assert.equal(copied.file, out)
    assert.equal(createHash("sha256").update(readFileSync(out)).digest("hex"), copied.sha256)
  } finally {
    await browser.close()
    await s.close()
    cleanup(dir)
  }
})

test("an item of options is decided by picking one, or none with what would work; a review can be withdrawn from its page", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const dir = await standardProject()
  write(dir, "shots/a.png", png(32, 32, [200, 60, 60, 255]))
  write(dir, "shots/b.png", png(32, 32, [60, 60, 200, 255]))
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "concepts")
  const s = await startServer(dir)
  mkdirSync(OUT, { recursive: true })
  try {
    const { submission: previous } = await W(s.app)("review.submit", {
      title: "First concept pass",
      items: [{ title: "Sentinel sketch", captures: [{ label: "Sketch", file: "shots/a.png" }] }]
    })
    const { submission } = await W(s.app)("review.submit", {
      title: "Tidestone sentinel concepts",
      supersedes: previous.id,
      items: [{
        title: "Tidestone sentinel",
        choose: "one",
        decide: [{ id: "a", label: "A: Drowned warden" }, { id: "b", label: "B: Abyssal idol" }],
        captures: [{ label: "A", file: "shots/a.png", shows: "a" }, { label: "B", file: "shots/b.png", shows: "b" }]
      }]
    })
    const item = submission.items[0]
    const page = await found.browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(20000)
    await page.goto(`${s.url}#/reviews/s/${submission.id}/${item.id}`)
    await page.locator(".choice").waitFor()
    const related = page.getByRole("navigation", { name: "Related reviews" })
    await related.getByRole("link", { name: previous.ref }).click()
    await page.getByRole("heading", { name: "First concept pass" }).waitFor()
    await related.getByRole("link", { name: submission.ref }).click()
    await page.getByRole("heading", { name: "Tidestone sentinel concepts" }).waitFor()
    assert.deepEqual(await page.locator(".choice-pick").allInnerTexts(), ["A: Drowned warden", "B: Abyssal idol", "None of these"])
    // None of these needs words before it can be saved.
    await page.getByRole("radio", { name: "None of these" }).click()
    assert.equal(await page.locator(".decide-f .btn.primary").isDisabled(), true)
    await page.getByRole("radio", { name: "B: Abyssal idol" }).click()
    await page.screenshot({ path: `${OUT}/choice-1440.png` })
    await page.locator(".decide-f .btn.primary").click()
    await page.locator('.ritem .pv:has-text("Picked B: Abyssal idol")').waitFor()
    const decided = await s.app.run("review.get", { submission: submission.id })
    assert.deepEqual([decided.items[0].state, decided.decisions[0].pick], ["approved", { option: "item:b" }])
    // Withdrawn from its page: it stays readable and leaves the queue.
    const withdraw = page.getByRole("button", { name: "Withdraw review" })
    const dialog = page.getByRole("dialog", { name: "Withdraw review" })
    await withdraw.click()
    await page.waitForFunction(() => document.activeElement?.id === "withdraw-reason")
    await page.keyboard.press("Escape")
    await dialog.waitFor({ state: "hidden" })
    await page.waitForFunction(() => document.activeElement?.matches(".withdraw-btn"), undefined, { timeout: 2000 })
    await withdraw.click()
    await dialog.getByLabel("Why withdraw it?").fill("Wrong concepts")
    await dialog.getByRole("button", { name: "Withdraw", exact: true }).click()
    await page.locator(".withdrawn-line").waitFor()
    assert.equal((await s.app.run("review.get", { submission: submission.id })).withdrawn.reason, "Wrong concepts")
    await page.screenshot({ path: `${OUT}/withdrawn-1440.png` })
  } finally {
    await found.browser.close()
    await s.close()
    cleanup(dir)
  }
})
