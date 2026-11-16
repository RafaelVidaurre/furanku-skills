// Ported from the version 1 engine's browser-audio.test.mjs: audio in a real browser, with the
// real decoder and transport. Waveform thumbnails, exact take selection, playback, agent capture
// and a frozen A/B review that shares one playhead.
//
// Changed: the agent's viewer actions run through the server's own renderer (`server.viewer`), as
// `/api/run/viewer.*` does; the original posted them over HTTP and required status 200, which a
// resolved call stands for here. Captures are kept beside the screenshots, not in the game's
// Saved/CatalogAudio folder.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { cleanup, makeProject, tone, W, write } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, soundType, startServer, type TestPage, type TestServer } from "./server.ts"

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const { save, shot } = screenshots(import.meta.url)
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
const state = (p: TestPage): Promise<Any> => p.evaluate(() => window.catalogViewer.state())
const control = (p: TestPage, c: unknown): Promise<Any> => p.evaluate((command) => window.catalogViewer.control(command), c)
const ready = async (p: TestPage): Promise<void> => {
  await p.waitForFunction(() => window.catalogViewer?.state().viewer?.status === "ready")
  await p.evaluate(() => window.catalogViewer.settled())
}

test("Chromium audio: waveform thumbs, exact take selection, transport, capture and shared-playhead frozen A/B review", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  const a = tone({ duration: 1.2 })
  const b = tone({ duration: 2, channels: 2, frequency: 660 })
  let server: TestServer | undefined
  let dir: string | undefined
  try {
    dir = await makeProject({
      assets: { "art/a.wav": a, "art/b.wav": b, "art/broken.wav": Buffer.from("RIFFxxxxWAVEinvalid") },
      units: [
        { id: "sound/tone", type: "sound", name: "Test tone", attrs: { speaker: "fixture" }, links: [{ role: "audio", asset: "art/a.wav" }, { role: "audio", asset: "art/b.wav" }] },
        { id: "sound/broken", type: "sound", name: "Broken", links: [{ role: "audio", asset: "art/broken.wav" }] }
      ],
      extra: { types: { sound: soundType } }
    })
    server = await startServer(dir)
    const { app } = server
    const api = server.viewer
    const p = await newPage(browser, { viewport: { width: 1280, height: 900 } })
    await p.goto(`${server.url}#/content`)
    await p.waitForFunction(() => [...document.querySelectorAll("audio-thumb canvas")].length > 0)
    const pixels = await p.locator("audio-thumb canvas").first().evaluate((c: HTMLCanvasElement) => new Set(c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data).size)
    assert.ok(pixels > 4, "thumbnail contains drawn waveform pixels")
    await shot(p, "audio-list-waveform-thumbs")
    await p.goto(`${server.url}#/content/u/sound%2Ftone?part=audio%3Aart%2Fa.wav`)
    await ready(p)
    let v = (await state(p)).viewer
    assert.equal(v.kind, "audio")
    assert.equal(v.source.sha256, sha256(a))
    assert.equal(v.duration, 1.2)
    assert.equal(v.channels, 1)
    assert.equal(v.sampleRate, 48000)
    assert.equal(v.playing, false)
    // Real UI play/pause, scrub and loop go through the same transport as viewer.*.
    await p.getByRole("button", { name: "Play", exact: true }).click()
    await p.waitForFunction(() => window.catalogViewer.state().viewer.currentTime > 0.05)
    await p.getByRole("button", { name: "Pause", exact: true }).click()
    v = (await state(p)).viewer
    assert.equal(v.playing, false)
    assert.ok(v.currentTime > 0)
    await p.getByRole("slider", { name: "Audio position" }).fill("0.4")
    assert.ok(Math.abs((await state(p)).viewer.currentTime - 0.4) < 0.01)
    await shot(p, "audio-unit-take")
    await control(p, { audio: { time: 1.1, loop: true, playing: true } })
    await p.waitForFunction(() => {
      const viewer = window.catalogViewer.state().viewer
      return viewer.playing && viewer.currentTime < 0.4
    })
    await control(p, { audio: { playing: false } })
    await control(p, { select: { part: "audio:art/b.wav" } })
    await ready(p)
    v = (await state(p)).viewer
    assert.equal(v.source.sha256, sha256(b))
    assert.equal(v.channels, 2)
    assert.equal(v.playing, false)
    await p.locator(".strip").getByRole("tab").first().click()
    await ready(p)
    assert.equal((await state(p)).viewer.source.sha256, sha256(a))
    assert.equal((await control(p, { audio: { time: -1 } })).code, "invalid")

    const opened = await api("viewer.open", { session: "audio", target: { kind: "unit", id: "sound/tone", part: "audio:art/b.wav" } })
    assert.equal(opened.state.viewer.source.sha256, sha256(b))
    await api("viewer.control", { session: "audio", audio: { time: 0.75, loop: true, playing: true } })
    assert.equal((await api("viewer.state", { session: "audio" })).state.viewer.playing, true)
    await api("viewer.control", { session: "audio", audio: { playing: false, time: 0.75 } })
    const capture = await api("viewer.capture", { session: "audio" })
    assert.match(capture.renderer, /catalog.*viewer/)
    assert.equal(capture.shows.sha256, sha256(b))
    assert.deepEqual([...readFileSync(join(dir, capture.file)).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    save("agent-capture-waveform", readFileSync(join(dir, capture.file)))

    const submitted = await W(app)("review.submit", { title: "Frozen audio A/B", items: [{ target: { kind: "unit", id: "sound/tone" }, views: [{ part: "audio:art/b.wav", caption: "Compare takes", before: { path: "art/a.wav", label: "Original" }, afterLabel: "Candidate" }] }] })
    const sub = await app.run("review.get", { submission: submitted.submission.id })
    const item = sub.items[0]
    const view = item.views[0]
    write(dir, "art/a.wav", tone({ frequency: 220 }))
    write(dir, "art/b.wav", tone({ frequency: 880 }))
    await api("viewer.open", { session: "ab", target: { kind: "submission", id: sub.id, item: item.id, view: view.id } })
    let comparison = (await api("viewer.control", { session: "ab", audio: { time: 0.7 }, compare: { side: "a" } })).state.viewer
    assert.equal(comparison.kind, "compare")
    assert.equal(comparison.mediaKind, "audio")
    assert.equal(comparison.currentTime, 0.7)
    assert.deepEqual(comparison.sides.map((s: Any) => s.sha256), [sha256(a), sha256(b)])
    comparison = (await api("viewer.control", { session: "ab", compare: { side: "b" } })).state.viewer
    assert.equal(comparison.currentTime, 0.7)
    assert.equal(comparison.side, "b")
    assert.equal(comparison.source.sha256, sha256(b))
    await p.goto(`${server.url}#/reviews/s/${sub.id}/${item.id}?view=${view.id}`)
    await ready(p)
    await shot(p, "audio-ab-compare-review")
    const timing = await p.evaluate(async () => {
      await window.catalogViewer.control({ audio: { playing: true, loop: false, time: 0.2 } })
      const before = window.catalogViewer.state().viewer
      await window.catalogViewer.control({ compare: { side: "a" } })
      const after = window.catalogViewer.state().viewer
      await window.catalogViewer.control({ audio: { playing: false } })
      return { before, after }
    })
    assert.equal(timing.after.playing, true)
    assert.ok(timing.after.currentTime >= timing.before.currentTime && timing.after.currentTime - timing.before.currentTime < 0.1, "live switch preserves the same clock")
    const abCapture = await api("viewer.capture", { session: "ab" })
    assert.ok(abCapture.height >= 260 && abCapture.width >= 300, "A/B waveform has a visible capture surface")
    save("agent-capture-comparison", readFileSync(join(dir, abCapture.file)))
    await W(app)("review.decide", { submission: sub.id, item: item.id, whole: "approved" })
    const verdict = await app.run("review.get", { submission: sub.id })
    assert.equal(verdict.items[0].state, "approved")
    // Corrupt-but-recognizable bytes fail decoding; a named absent take never substitutes another.
    await p.goto(`${server.url}#/content/u/sound%2Fbroken`)
    await p.waitForFunction(() => window.catalogViewer.state().viewer?.status === "error")
    assert.equal((await state(p)).viewer.playing, false)
    await shot(p, "audio-broken-take")
    await p.goto(`${server.url}#/content/u/sound%2Ftone?part=audio%3Aabsent.wav`)
    await p.waitForFunction(() => window.catalogViewer.state().selection?.unavailable)
    assert.equal((await state(p)).selection.part, "audio:absent.wav")
    assert.deepEqual(p.errors, [])
  } finally {
    await browser.close()
    await server?.close()
    if (dir) cleanup(dir)
  }
})

test("Chromium decodes served WAV, OGG, FLAC and MP3 takes under their sniffed MIME types", async (t) => {
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) return t.skip("ffmpeg is needed to generate codec fixtures")
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  let server: TestServer | undefined
  let dir: string | undefined
  try {
    dir = await makeProject({ assets: { "art/tone.wav": tone({ duration: 0.6 }) }, units: [], extra: { types: { sound: soundType } } })
    const extensions = ["wav", "ogg", "flac", "mp3"]
    for (const ext of extensions.slice(1)) execFileSync("ffmpeg", ["-y", "-v", "error", "-i", join(dir, "art/tone.wav"), join(dir, `art/tone.${ext}`)])
    write(dir, "content/codecs.json", { id: "sound/codecs", type: "sound", name: "Codec fixtures", links: extensions.map((ext) => ({ role: "audio", asset: `art/tone.${ext}` })) })
    server = await startServer(dir)
    const { app, url } = server
    const p = await newPage(browser)
    const unit = await app.run("unit.get", { id: "sound/codecs" })
    for (const [i, ext] of extensions.entries()) {
      const asset = unit.links.find((l: Any) => l.asset.path.endsWith(`.${ext}`)).asset
      const response = await fetch(new URL(asset.url, url))
      assert.equal(response.headers.get("content-type"), ["audio/wav", "audio/ogg", "audio/flac", "audio/mpeg"][i])
      assert.equal(response.headers.get("x-content-type-options"), "nosniff")
      await p.goto(`${url}#/content/u/sound%2Fcodecs?part=${encodeURIComponent(`audio:art/tone.${ext}`)}`)
      await ready(p)
      const v = (await state(p)).viewer
      assert.equal(v.kind, "audio")
      assert.equal(v.source.sha256, sha256(readFileSync(join(dir, `art/tone.${ext}`))))
      assert.ok(Math.abs(v.duration - 0.6) < 0.1, ext)
      assert.equal(v.channels, 1)
    }
    await shot(p, "audio-codec-mp3-take")
  } finally {
    await browser.close()
    await server?.close()
    if (dir) cleanup(dir)
  }
})
