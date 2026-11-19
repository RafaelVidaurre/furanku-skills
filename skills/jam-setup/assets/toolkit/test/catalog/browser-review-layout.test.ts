// Ported from the version 1 engine's browser-review-layout.test.mjs: a review of many items with
// long titles, notes and file names stays usable from a wide desktop down to a narrow phone.
// Nothing changed but the way the server is started.
import assert from "node:assert/strict"
import { test } from "node:test"
import { agent, cleanup, makeProject, tone, W } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, soundType, startServer, type TestPage, type TestServer } from "./server.ts"

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const { shot } = screenshots(import.meta.url)

const ready = async (p: TestPage): Promise<void> => {
  await p.waitForFunction(() => window.catalogViewer?.state().viewer?.status === "ready")
  await p.evaluate(() => window.catalogViewer.settled())
}
// Scroll containers (tabs and fenced code) may overflow internally; their boxes and all other
// content must fit their parent. Check containment, not just the body's hidden scroll width.
const assertContained = async (p: TestPage, selector: string): Promise<void> => {
  const spills = await p.locator(selector).evaluateAll((nodes) =>
    nodes.flatMap((el) => {
      if (!el.getClientRects().length || !el.textContent!.trim()) return []
      const parent = el.parentElement!
      if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX)) return []
      const a = el.getBoundingClientRect()
      const b = parent.getBoundingClientRect()
      return a.width && (a.right > b.right + 2 || a.left < b.left - 2) ? [`${el.tagName}.${el.className}`] : []
    }))
  assert.deepEqual(spills, [], "visible content stays inside its container")
}

test("multi-item review keeps notes, part navigation and long content usable at desktop and narrow widths", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const names = ["First sound", "VeryLongSoundTitle".repeat(4), ...Array.from({ length: 9 }, (_, i) => `Sound ${i + 3}`)]
  const paths = Array.from({ length: 4 }, (_, i) => `art/alternate_${i}_${"room_tail_".repeat(8)}.wav`)
  let server: TestServer | undefined
  let dir: string | undefined
  try {
    dir = await makeProject({
      assets: Object.fromEntries(paths.map((path) => [path, tone({ duration: 0.2 })])),
      units: names.map((name, i) => ({ id: `sound/${i}`, type: "sound", name, attrs: { speaker: "LongDescription".repeat(30) }, links: paths.map((asset) => ({ role: "audio", asset })) })),
      extra: { types: { sound: soundType } }
    })
    server = await startServer(dir)
    const { app, url } = server
    const s = await W(app, agent)("review.submit", {
      title: "LongBatchTitle".repeat(18),
      brief: "### Listen\nOne **submission description** for eleven sounds.\n\n```text\n" + "UnbrokenCode".repeat(90) + "\n```",
      items: names.map((_, i) => ({
        target: { kind: "unit", id: `sound/${i}` },
        ...(i === 10 ? { views: [{ part: `audio:${paths[0]}`, caption: "Compare room tails", before: { path: paths[1], label: "PreviousTake".repeat(5) }, afterLabel: "CurrentTake".repeat(5) }] } : {})
      }))
    })
    const sub = await app.run("review.get", { submission: s.submission.id })
    const first = sub.items[0]
    const second = sub.items[1]
    const p = await newPage(browser, { viewport: { width: 1600, height: 950 } })
    p.setDefaultTimeout(5000)
    const show = async (item: Any = first): Promise<void> => {
      await p.goto(`${url}#/reviews/s/${sub.id}/${item.id}`)
      await p.waitForFunction((id) => window.catalogViewer?.state().selection?.item === id, item.id)
      await ready(p)
    }
    await show()
    await shot(p, "review-first-item-1600")
    await t.test("one Markdown submission brief below the preview, including after item navigation", async () => {
      for (const item of [first, second]) {
        await show(item)
        assert.equal(await p.locator('[aria-label="Submission brief"]').count(), 1)
        assert.equal(await p.locator('.d-main [aria-label="Submission brief"] strong').textContent(), "submission description")
        assert.equal(await p.locator('.d-main [aria-label="Submission brief"] pre code').count(), 1)
        const stage = (await p.locator(".stage").boundingBox())!
        const note = (await p.locator('[aria-label="Submission brief"]').boundingBox())!
        assert.ok(note.y >= stage.y + stage.height, "brief follows the preview")
      }
    })
    await t.test("preview pills and item-detail tabs use the decision part labels", async () => {
      await show()
      assert.deepEqual(await p.locator(".view-tile").allTextContents(), first.parts.filter((x: Any) => x.id !== "attributes").map((x: Any) => x.label))
      await p.goto(`${url}#/main/u/sound%2F0`)
      await p.waitForFunction(() => window.catalogViewer?.state().selection?.id === "sound/0")
      await ready(p)
      assert.deepEqual(await p.locator(".tile-l").allTextContents(), first.parts.filter((x: Any) => x.id !== "attributes").map((x: Any) => x.label))
    })
    await t.test("part labels navigate and focus the preview without changing a verdict; attributes open in place", async () => {
      await show()
      const label = first.parts[1].label
      await p.getByRole("button", { name: `View ${label}`, exact: true }).click()
      await ready(p)
      assert.equal(await p.evaluate(() => window.catalogViewer.state().selection.part), first.parts[1].id)
      assert.equal(await p.locator(".stage-view").evaluate((el) => el === document.activeElement), true)
      assert.equal(await p.locator(".comp-row.set").count(), 0)
      await p.getByRole("radio", { name: `Approve: ${label}`, exact: true }).click()
      assert.equal(await p.getByRole("radio", { name: `Approve: ${label}`, exact: true }).getAttribute("aria-checked"), "true")
      await p.getByRole("button", { name: "View Attributes", exact: true }).click()
      assert.equal(await p.locator('details:has([aria-label="Submitted attributes"])').getAttribute("open"), "")
      assert.equal(await p.locator(".comp-row.set").count(), 1, "navigation preserves the draft")
      await p.getByRole("button", { name: "Discard", exact: true }).click()
    })
    await t.test("titles, notes, decision controls and comparisons fit at representative widths", async () => {
      for (const width of [1600, 1280, 1024, 820, 768, 390, 320]) {
        await p.setViewportSize({ width, height: 950 })
        await show(second)
        await assertContained(p, ".sub-head > *, .d-title > *, .comp-all > *, .comp-row > *, .block-h > *, .md > *, .decide-f > *")
        for (const button of await p.locator(".comp-all button").all()) assert.ok(await button.isVisible())
        if (width === 1280 || width === 390) await shot(p, `review-long-title-${width}`)
        await p.goto(`${url}#/main/u/sound%2F1`)
        await p.waitForFunction(() => window.catalogViewer?.state().selection?.id === "sound/1")
        await ready(p)
        await assertContained(p, ".d-title > *, .asset-line > *, .block-h > *, .attrs dd, .mship > *")
        if (width === 390) await shot(p, `unit-long-names-${width}`)
        await show(sub.items[10])
        await p.getByRole("radiogroup", { name: "Audio comparison", exact: true }).waitFor()
        await assertContained(p, ".cmp-side > *, .cmp-cap > *, .audio-body > *, .audio-body .seg > *")
        if (width === 1280 || width === 390) await shot(p, `review-audio-compare-${width}`)
      }
    })
    assert.deepEqual(p.errors, [])
  } finally {
    await browser.close()
    await server?.close()
    if (dir) cleanup(dir)
  }
})
