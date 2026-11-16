// Ported from the version 1 engine's browser-dialogue.test.mjs: word highlighting of a spoken line
// follows the real audio transport in a real browser (real decoder, no replacement clock).
//
// The original imported its `dialogue` type from a game repository; what the test needs of it (an
// audio role and `audioTranscript` naming the attributes that hold the take, its text and its word
// timings) is written out here.
import assert from "node:assert/strict"
import test from "node:test"
import { cleanup, makeProject, tone } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, startServer, type TestServer } from "./server.ts"

const { shot } = screenshots(import.meta.url)

const dialogueType = {
  label: "Dialogue",
  scope: "content",
  thumb: "audio",
  reviewAttributes: false,
  audioTranscript: { text: "text", words: "words", asset: "voiceFile" },
  fields: [
    { key: "text", label: "Text" },
    { key: "voiceState", label: "Voice state", filter: true },
    { key: "words", label: "Word timings", derived: true, summary: false },
    { key: "voiceFile", label: "Aligned take", derived: true, summary: false }
  ],
  roles: [{ key: "audio", label: "Aligned take", kinds: ["audio"] }]
}

test("dialogue highlighting follows playback, pause, silence, seeking and line changes", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  let server: TestServer | undefined
  let root: string | undefined
  try {
    root = await makeProject({
      assets: { "art/voice.wav": tone({ duration: 2 }) },
      extra: { types: { dialogue: dialogueType } },
      units: [
        { id: "line/voiced", type: "dialogue", name: "Hello there.", attrs: { text: "Hello there.", voiceFile: "art/voice.wav", words: [{ word: "Hello", start: 0.05, end: 0.8 }, { word: "there.", start: 1, end: 1.8 }] }, links: [{ role: "audio", asset: "art/voice.wav" }] },
        { id: "line/missing", type: "dialogue", name: "Silent line.", attrs: { text: "Silent line.", voiceState: "missing" } }
      ]
    })
    server = await startServer(root)
    const p = await newPage(browser)
    await p.goto(`${server.url}#/content/u/line%2Fvoiced`)
    await p.waitForFunction(() => window.catalogViewer?.state().viewer?.status === "ready")
    const state = () => p.evaluate(() => window.catalogViewer.state().viewer)
    const control = (command: unknown) => p.evaluate((c) => window.catalogViewer.control(c), command)
    assert.equal((await state()).currentWord, null, "silence before the first word")
    await p.getByRole("button", { name: "Play", exact: true }).click()
    await p.waitForFunction(() => window.catalogViewer.state().viewer.currentWord?.index === 0)
    assert.equal(await p.locator(".spoken-word.current").textContent(), "Hello")
    await shot(p, "dialogue-first-word")
    await p.waitForFunction(() => window.catalogViewer.state().viewer.currentWord?.index === 1)
    assert.equal(await p.locator(".spoken-word.current").textContent(), "there.")
    await p.getByRole("button", { name: "Pause", exact: true }).click()
    const paused = await state()
    assert.equal(paused.playing, false)
    await p.evaluate(() => new Promise<number>(requestAnimationFrame))
    assert.equal((await state()).currentTime, paused.currentTime, "pause freezes the word clock")
    await shot(p, "dialogue-paused-second-word")
    await control({ audio: { time: 0.2 } })
    await p.waitForFunction(() => document.querySelector(".spoken-word.current")?.textContent === "Hello")
    assert.equal((await state()).currentWord.word, "Hello")
    await p.getByRole("slider", { name: "Audio position" }).fill("0.9")
    assert.equal((await state()).currentWord, null, "seeking into silence clears highlighting")
    await p.waitForFunction(() => !document.querySelector(".spoken-word.current"))
    await control({ audio: { time: 1.2 } })
    assert.equal((await state()).currentWord.word, "there.")
    await control({ audio: { time: 1.95, playing: true } })
    await p.waitForFunction(() => {
      const v = window.catalogViewer.state().viewer
      return !v.playing && v.currentTime === v.duration
    })
    assert.equal((await state()).currentWord, null, "ending the take clears highlighting")
    await p.goto(`${server.url}#/content/u/line%2Fmissing`)
    await p.getByRole("heading", { name: "Silent line." }).waitFor()
    await p.evaluate(() => window.catalogViewer.settled())
    assert.equal(await p.getByRole("button", { name: "Play", exact: true }).count(), 0)
    assert.equal(await state(), null, "an unvoiced line has text and no leftover audio viewer")
    await shot(p, "dialogue-unvoiced-line")
    assert.deepEqual(p.errors, [])
  } finally {
    await browser.close()
    await server?.close()
    if (root) cleanup(root)
  }
})
