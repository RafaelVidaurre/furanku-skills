// Ported from the version 1 engine's browser-dialogue.test.mjs: word highlighting of a spoken line
// follows the real audio transport in a real browser (real decoder, no replacement clock).
//
// The original imported its `dialogue` type from a game repository; what the test needs of it (an
// audio role and `audioTranscript` naming the attributes that hold the take, its text and its word
// timings) is written out here.
//
// The take plays on the real clock while the test acts, and on a loaded machine one action (a
// screenshot above all) takes seconds: the original's 2-second take ran out during its first
// screenshot, and a starved page draws few frames. So each word is caught by a watcher in the page,
// set before playback starts, which pauses on a frame inside it and the highlight is read while
// paused; and the take lasts far longer than any action, so a click meant for a playing take lands
// while it still plays.
import assert from "node:assert/strict"
import test from "node:test"
import { cleanup, makeProject, tone } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, startServer, type TestServer } from "./server.ts"

const { shot } = screenshots(import.meta.url)

const TAKE_SECONDS = 20
const words = [{ word: "Hello", start: 0.05, end: 0.8 }, { word: "there.", start: 1, end: 1.8 }]

declare global {
  interface Window {
    /** Set by the test: settles with the viewer's state once playback has paused inside the word it watches for. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    held?: Promise<any>
  }
}

const dialogueType = {
  label: "Dialogue",
  scope: "main",
  thumb: "audio",
  reviewAttributes: false,
  audioTranscript: { text: "text", words: "words", asset: "voiceFile" },
  fields: [
    { key: "text", label: "Text" },
    { key: "voiceState", label: "Voice state", filter: true },
    { key: "words", label: "Word timings", derived: true, summary: false },
    { key: "voiceFile", label: "Aligned take", derived: true, summary: false }
  ],
  roles: [{ key: "audio", label: "Aligned take", mediaKinds: ["audio"] }]
}

test("dialogue highlighting follows playback, pause, silence, seeking and line changes", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  let server: TestServer | undefined
  let root: string | undefined
  try {
    root = await makeProject({
      assets: { "art/voice.wav": tone({ duration: TAKE_SECONDS }) },
      extra: { types: { dialogue: dialogueType } },
      units: [
        { id: "line/voiced", type: "dialogue", name: "Hello there.", attrs: { text: "Hello there.", voiceFile: "art/voice.wav", words }, links: [{ role: "audio", asset: "art/voice.wav" }] },
        { id: "line/missing", type: "dialogue", name: "Silent line.", attrs: { text: "Silent line.", voiceState: "missing" } }
      ]
    })
    server = await startServer(root)
    const p = await newPage(browser)
    await p.goto(`${server.url}#/main/u/line%2Fvoiced`)
    await p.waitForFunction(() => window.catalogViewer?.state().viewer?.status === "ready")
    const state = () => p.evaluate(() => window.catalogViewer.state().viewer)
    const control = (command: unknown) => p.evaluate((c) => window.catalogViewer.control(c), command)
    assert.equal((await state()).currentWord, null, "silence before the first word")
    // A watcher in the page, set before playback starts, pauses on the first frame whose clock falls
    // inside the word. A page starved by a busy machine may draw no frame inside a word; the watcher
    // then plays it again from just before its start. `held` settles with the paused state, or fails
    // after 30 s, since a page evaluation that never settles would hold the test forever.
    const holdAt = (index: number) =>
      p.evaluate(({ index, start, end }) => {
        window.held = new Promise((done, fail) => {
          let replays = 0
          const deadline = performance.now() + 30_000 // as long as Playwright waits for anything else
          const look = () => {
            const viewer = window.catalogViewer.state().viewer
            if (viewer.currentWord?.index === index) {
              void window.catalogViewer.control({ audio: { playing: false } })
              return done(window.catalogViewer.state().viewer)
            }
            if (performance.now() > deadline) return fail(new Error(`playback did not reach word ${index} in 30 s (at ${viewer.currentTime} s, playing: ${viewer.playing})`))
            if (viewer.playing && viewer.currentTime >= end) {
              if (++replays > 20) return fail(new Error(`no frame fell inside word ${index} in 20 plays`))
              void window.catalogViewer.control({ audio: { time: Math.max(0, start - 0.05) } })
            }
            requestAnimationFrame(look)
          }
          requestAnimationFrame(look)
        })
      }, { index, ...words[index]! })
    const held = () => p.evaluate(() => window.held!)
    const play = () => p.getByRole("button", { name: "Play", exact: true }).click()
    for (const [index, { word }] of words.entries()) {
      await holdAt(index)
      await play()
      const stopped = await held()
      assert.equal(stopped.playing, false)
      assert.equal(stopped.currentWord.word, word)
      await p.waitForFunction((word) => document.querySelector(".spoken-word.current")?.textContent === word, word)
      await shot(p, ["dialogue-first-word", "dialogue-paused-second-word"][index]!)
    }
    await play()
    await p.getByRole("button", { name: "Pause", exact: true }).click()
    const paused = await state()
    assert.equal(paused.playing, false)
    await p.evaluate(() => new Promise<number>(requestAnimationFrame))
    assert.equal((await state()).currentTime, paused.currentTime, "pause freezes the word clock")
    await control({ audio: { time: 0.2 } })
    await p.waitForFunction(() => document.querySelector(".spoken-word.current")?.textContent === "Hello")
    assert.equal((await state()).currentWord.word, "Hello")
    await p.getByRole("slider", { name: "Audio position" }).fill("0.9")
    assert.equal((await state()).currentWord, null, "seeking into silence clears highlighting")
    await p.waitForFunction(() => !document.querySelector(".spoken-word.current"))
    await control({ audio: { time: 1.2 } })
    assert.equal((await state()).currentWord.word, "there.")
    await control({ audio: { time: TAKE_SECONDS - 0.05, playing: true } })
    await p.waitForFunction(() => {
      const v = window.catalogViewer.state().viewer
      return !v.playing && v.currentTime === v.duration
    })
    assert.equal((await state()).currentWord, null, "ending the take clears highlighting")
    await p.goto(`${server.url}#/main/u/line%2Fmissing`)
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
