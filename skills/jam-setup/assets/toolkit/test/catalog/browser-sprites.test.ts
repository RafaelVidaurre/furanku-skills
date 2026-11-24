// Sprite-sheet animations in the page: an image a link cuts into frames plays, steps and shows
// its sheet, for a person and an agent alike; its thumbnail is its first frame; a review view
// plays two versions in step.
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { test } from "node:test"
import { crc32, deflateSync } from "node:zlib"
import { cleanup, makeProject, W } from "./helpers.ts"
import { browserOrSkip, startServer } from "./server.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const OUT = "test-output/browser/browser-sprites"

/** An RGBA PNG whose pixel at (x, y) is `pixel(x, y)`. */
const pngOf = (w: number, h: number, pixel: (x: number, y: number) => readonly [number, number, number, number]): Buffer => {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4)
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0)
  header.writeUInt32BE(h, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

/** A PNG of `columns` × `rows` cells, each filled with its own colour, so a drawn frame says which cell it came from. */
const cells = (columns: number, rows: number, size: number): { bytes: Buffer; colour: (cell: number) => [number, number, number] } => {
  const colour = (cell: number): [number, number, number] => [20 + cell * 25, 200 - cell * 20, (cell * 70) % 256]
  return { bytes: pngOf(columns * size, rows * size, (x, y) => [...colour(Math.floor(y / size) * columns + Math.floor(x / size)), 255]), colour }
}

test("a sheet plays in the page: frames, steps, the whole sheet, a first-frame thumbnail, and two versions in step in a review", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const sheet = cells(4, 2, 16)
  const older = cells(3, 1, 16)
  const dir = await makeProject({
    // A still drawn small in the middle of a large transparent canvas: 8 pixels of 64.
    assets: { "art/walk.png": sheet.bytes, "art/walk-old.png": older.bytes, "art/pose.png": pngOf(64, 64, (x, y) => (x >= 28 && x < 36 && y >= 28 && y < 36 ? [200, 30, 30, 255] : [0, 0, 0, 0])) },
    units: [{ id: "char/wolf", type: "character", name: "Wolf", links: [{ role: "animation", asset: "art/walk.png", key: "walk", label: "Walk", sheet: { fps: 8, grid: { columns: 4, rows: 2 } } }, { role: "pose", asset: "art/pose.png" }] }],
    extra: { types: { character: { label: "Character", thumb: "animation", fields: [], roles: [{ key: "animation", label: "Animation", mediaKinds: ["image"], many: true }, { key: "pose", label: "Pose", mediaKinds: ["image"] }] } } }
  })
  const s = await startServer(dir)
  mkdirSync(OUT, { recursive: true })
  const viewer = (page: Any) => ({
    state: () => page.evaluate(() => (globalThis as Any).catalogViewer.state()),
    control: (command: unknown) => page.evaluate((c: unknown) => (globalThis as Any).catalogViewer.control(c), command)
  })
  // The colour at the middle of the frame being shown.
  const shown = (page: Any) => page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    const canvas = document.querySelector("canvas.sprite-frame") as HTMLCanvasElement
    const [r, g, b] = canvas.getContext("2d")!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data
    return [r, g, b]
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.goto(`${s.url}#/main/u/char%2Fwolf`)
    await page.evaluate(() => (globalThis as Any).catalogViewer.settled(15000))
    const v = viewer(page)
    let state = (await v.state()).viewer
    assert.deepEqual([state.kind, state.status, state.sheet.frames, state.sheet.frameSize, state.sheet.duration], ["image", "ready", 8, [16, 16], 1])
    assert.deepEqual(state.controls, ["animation", "sprite", "zoom"])

    assert.deepEqual(await v.control({ animation: { frame: 6, playing: false } }), { ok: true, result: true })
    state = (await v.state()).viewer
    assert.deepEqual([state.animation.frame, state.animation.playing], [6, false])
    assert.deepEqual(await shown(page), sheet.colour(6), "frame 6 is the seventh cell, the second row's third")
    assert.equal(await page.locator(".sprite-frame").evaluate((canvas) => getComputedStyle(canvas).imageRendering), "pixelated", "a magnified frame shows its pixels")
    await page.locator(".viewer-sprite").focus()
    await page.keyboard.press("ArrowRight")
    assert.equal((await v.state()).viewer.animation.frame, 7)
    await page.keyboard.press("ArrowRight")
    assert.equal((await v.state()).viewer.animation.frame, 0, "stepping past the last frame of a looping sheet starts again")
    assert.deepEqual(await shown(page), sheet.colour(0))
    assert.equal((await v.control({ animation: { frame: 8 } })).code, "invalid")
    assert.equal((await v.control({ animation: { clip: "Run" } })).code, "unsupported")

    await v.control({ sprite: { show: "sheet" }, animation: { frame: 2, playing: false } })
    assert.equal(await page.locator(".sprite-map rect").count(), 8)
    assert.equal(await page.locator(".sprite-map rect.on").count(), 1)
    await page.locator(".sprite-map rect").nth(5).click()
    assert.equal((await v.state()).viewer.animation.frame, 5, "a click on the sheet shows that frame")
    await page.screenshot({ path: `${OUT}/sheet-1280.png` })
    await v.control({ sprite: { show: "animation" } })

    // The strip's tile is the first frame, not the whole sheet.
    // The side column shows animations apart from other files, as thumbnails named as the unit names them;
    // choosing one shows it in the viewer.
    assert.deepEqual(await page.locator('section[aria-label="Animations"] .media-name').allTextContents(), ["Walk"])
    assert.match(await page.locator('section[aria-label="Animations"] .media-tile').innerText(), /8 frames · 8 fps/)
    assert.equal(await page.locator('section[aria-label="Animations"] .media-tile canvas.thumb-canvas').count(), 1)
    assert.equal(await page.locator('section[aria-label="Animations"] .media-tile').getAttribute("aria-pressed"), "true")
    assert.deepEqual(await page.locator('section[aria-label="Assets"] .media-name').allTextContents(), ["pose"])
    await page.locator('section[aria-label="Assets"] .media-tile').click()
    await page.waitForFunction(() => (globalThis as Any).catalogViewer.state().selection.part === "pose")
    assert.equal(await page.locator('section[aria-label="Assets"] .media-tile').getAttribute("aria-pressed"), "true")
    await page.locator('section[aria-label="Animations"] .media-tile').click()
    await page.waitForFunction(() => (globalThis as Any).catalogViewer.state().viewer?.kind === "image" && (globalThis as Any).catalogViewer.state().viewer.sheet)
    // Tiles show what is drawn: the animation's first frame, and the still without its transparent border.
    const tiles = page.locator(".strip canvas.thumb-canvas")
    await page.waitForFunction(() => document.querySelectorAll(".strip canvas.thumb-canvas").length === 2)
    // The 8-pixel drawing and a pixel of margin (10 of the canvas's 64), enlarged 25 times without smoothing.
    assert.deepEqual(await tiles.nth(1).evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]), [250, 250])
    assert.deepEqual(await tiles.nth(1).evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext("2d")!.getImageData(12, 12, 1, 1).data]), [0, 0, 0, 0], "the margin stays empty: no smoothing bleeds into it")
    assert.deepEqual(await tiles.nth(1).evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext("2d")!.getImageData(26, 26, 1, 1).data]), [200, 30, 30, 255], "the first drawn pixel keeps its colour to its edge")
    await page.close()

    // A review view plays the old sheet and the new one on one transport.
    const submitted = await W(s.app)("review.submit", {
      items: [{ target: { kind: "unit", id: "char/wolf" }, views: [{ part: "animation:walk", caption: "Old and new", before: { path: "art/walk-old.png", label: "Old", sheet: { fps: 6, grid: { columns: 3 } } } }] }]
    })
    const review = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    review.on("pageerror", (error) => errors.push(String(error)))
    await review.goto(`${s.url}#/reviews/s/${submitted.submission.id}`)
    await review.evaluate(() => (globalThis as Any).catalogViewer.settled(15000))
    const compared = (await viewer(review).state()).viewer
    assert.deepEqual([compared.kind, compared.status, compared.sides.map((side: Any) => side.status)], ["compare", "ready", ["ready", "ready"]])
    assert.equal(await review.locator(".cmp-sprite canvas.sprite-frame").count(), 2)
    await review.screenshot({ path: `${OUT}/review-1280.png` })
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await s.close()
    cleanup(dir)
  }
})
