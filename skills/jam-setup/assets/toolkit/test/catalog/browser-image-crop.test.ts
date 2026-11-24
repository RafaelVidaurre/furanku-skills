import assert from "node:assert/strict"
import { test } from "node:test"
import type { Locator, Page } from "playwright"
import { cleanup, makeProject, png, W } from "./helpers.ts"
import { browserOrSkip, newPage, startServer } from "./server.ts"

const red = [232, 20, 30, 255]
const green = [12, 220, 40, 255]
const blue = [0, 40, 250, 255]
const before = [8, 4, 24, 10]
const crop = [8, 28, 24, 10]
const atlas = "art/atlas.png"

function fixture() {
  const inCrop = (x: number, y: number, top: number) => x >= 8 && x < 32 && y >= top && y < top + 10
  return makeProject({
    assets: { [atlas]: png(48, 48, (x, y) => inCrop(x, y, 4) ? red : inCrop(x, y, 28) ? green : blue) },
    units: [{
      id: "icon", type: "portrait", name: "Atlas portrait",
      links: [{ role: "image", asset: atlas, key: "portrait", label: "Portrait", crop }]
    }, {
      id: "oversize", type: "portrait", name: "Oversize crop",
      links: [{ role: "image", asset: atlas, crop: [30, 30, 24, 24] }]
    }],
    extra: { types: { portrait: { label: "Portrait", thumb: "image", roles: [{ key: "image", label: "Image", mediaKinds: ["image"] }] } } }
  })
}

/** Sample actual browser pixels, including the space around a letterboxed preview. */
async function pixels(page: Page, target: Locator, points: ReadonlyArray<readonly [number, number]>) {
  const bytes = [...await target.screenshot({ animations: "disabled" })]
  return page.evaluate(async ({ bytes, points }) => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: "image/png" }))
    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const g = canvas.getContext("2d")!
    g.drawImage(image, 0, 0)
    image.close()
    return points.map(([x, y]) => [...g.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data])
  }, { bytes, points })
}

test("cropped stills keep their exact region in cards, the media sidebar, viewer, and frozen comparison", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const dir = await fixture()
  const server = await startServer(dir)
  try {
    const page = await newPage(browser, { viewport: { width: 1280, height: 860 } })
    page.setDefaultTimeout(7000)
    const stage = () => page.evaluate(() => window.catalogViewer.settled(15000))
    await page.goto(`${server.url}#/main`)
    const card = page.locator(".card").filter({ hasText: "Atlas portrait" })
    await card.locator("canvas.thumb-canvas").waitFor()
    await page.addStyleTag({ content: ".card-media { width: 160px !important; height: 160px !important; }" })
    const [cardCenter, cardMargin] = await pixels(page, card.locator(".card-media"), [[0.5, 0.5], [0.5, 0.15]])
    assert.deepEqual(cardCenter, green)
    assert.notDeepEqual(cardMargin, green, "the non-square crop keeps its aspect ratio")
    assert.notDeepEqual(cardMargin, blue, "atlas neighbors cannot appear around a non-square crop")

    await card.click()
    await stage()
    const natural = () => page.evaluate(() => window.catalogViewer.state().viewer.natural)
    assert.deepEqual(await natural(), { width: 24, height: 10 })
    const tile = page.locator('section[aria-label="Assets"] .media-tile canvas.thumb-canvas')
    await tile.waitFor()
    assert.deepEqual(await tile.evaluate((el: HTMLCanvasElement) => [...el.getContext("2d")!.getImageData(0, 0, 1, 1).data]), green)
    assert.deepEqual((await pixels(page, page.locator(".viewer-2d"), [[0.5, 0.5]]))[0], green)
    assert.equal(await page.getByRole("button", { name: "Play", exact: true }).count(), 0)

    const target = { kind: "unit", id: "icon" }
    const submit = W(server.app)
    const frozen = await submit("review.submit", {
      items: [{ target, views: [{ part: "image", caption: "Frozen still" }] }]
    })
    await page.goto(`${server.url}#/reviews/s/${frozen.submission.id}`)
    await stage()
    assert.deepEqual(await natural(), { width: 24, height: 10 })
    assert.deepEqual((await pixels(page, page.locator(".viewer-2d"), [[0.5, 0.5]]))[0], green)

    const comparison = await submit("review.submit", {
      items: [{ target, views: [{ part: "image", caption: "Two regions", before: { path: atlas, crop: before } }] }]
    })
    await page.goto(`${server.url}#/reviews/s/${comparison.submission.id}`)
    await stage()
    await page.getByRole("radio", { name: "Divider" }).click()
    await page.addStyleTag({ content: ".slider { width: 160px; height: 160px !important; }" })
    const [left, right, margin] = await pixels(page, page.locator(".slider"), [[0.25, 0.5], [0.75, 0.5], [0.25, 0.15]])
    assert.deepEqual([left, right], [red, green])
    assert.notDeepEqual(margin, red, "the divider keeps the crop's aspect ratio")
    assert.notDeepEqual(margin, blue, "the divider clips each source crop before fitting it")
    assert.equal(await page.locator(".same").count(), 0, "equal source bytes can produce different stills")

    const mixed = await submit("review.submit", {
      items: [{ target, views: [{
        part: "image", caption: "Animation and crop",
        before: { path: atlas, sheet: { fps: 1, frames: [{ region: before }] } }
      }] }]
    })
    await page.goto(`${server.url}#/reviews/s/${mixed.submission.id}`)
    await stage()
    assert.deepEqual((await pixels(page, page.locator(".cmp-sprite svg.sprite-still"), [[0.5, 0.5]]))[0], green)

    await page.goto(`${server.url}#/main/u/oversize`)
    await stage()
    const bad = await page.evaluate(() => window.catalogViewer.state().viewer)
    assert.equal(bad.status, "error")
    assert.match(bad.error, /Crop lies outside the 48×48 image/)
    assert.deepEqual(page.errors, [])
  } finally {
    await browser.close()
    await server.close()
    cleanup(dir)
  }
})
