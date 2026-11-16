// Voiced dialogue with a stand-in provider and a stand-in aligner: where each line stands as its
// text, its review mark and its takes change; the transcript check when it runs, when it finds a
// mismatch and when it is not installed; and the voice-line recipe end to end.
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import type { AudioUnit } from "../../src/jam/audio/schema.ts"
import { assign, processLines as process, type ProcessInput, speak, type SpeakInput, status, voices } from "../../src/jam/audio/voice.ts"
import { audioProject, type AudioProject, join_, NO_FFMPEG, paidCalls, silence, speech, wavOf } from "./audio-fixtures.ts"
import { jam, jamFailure, readJson, write } from "./fixtures.ts"
import { review, runFile, start, status as runStatus } from "./flow.ts"

const skip = NO_FFMPEG
const LINES = "Audio/Lines/intro.json"
const SCRIPT = [
  { id: "greet", speaker: "innkeeper", text: "Welcome, traveller.", review: "REVIEWED" },
  { id: "warn", speaker: "innkeeper", text: "Mind the X on the floor.", direction: "leaning in", performance: { elevenlabs: "[low, steady voice] Mind the X on the floor." } },
  { id: "bye", speaker: "guard", text: "Move along." }
]
const project = (options: AudioProject = {}): string => audioProject({ ...options, files: { [LINES]: JSON.stringify({ lines: SCRIPT }), ...options.files } })
const setLines = (root: string, change: (lines: Array<Record<string, unknown>>) => void): void => {
  const data = readJson<{ lines: Array<Record<string, unknown>> }>(root, LINES)
  change(data.lines)
  writeFileSync(join(root, LINES), JSON.stringify(data, null, 2))
}
const speaking = (extra: Partial<SpeakInput> = {}): SpeakInput => ({ lines: [], reviewed: false, takes: 1, dryRun: false, ...extra })
const processing = (extra: Partial<ProcessInput> = {}): ProcessInput => ({ lines: [], all: false, recheck: false, ...extra })
const rows = async (root: string) => Object.fromEntries((await jam(root, status({}))).lines.map((row) => [row.line.split("/")[1]!, row]))
const unitOf = (root: string, line: string): AudioUnit => readJson<AudioUnit>(root, `Audio/Voice/intro/${line}/unit.json`)
const voiced = async (root: string): Promise<void> => {
  await jam(root, assign({ speaker: "innkeeper", voice: "v-gravel", settings: {} }))
  await jam(root, assign({ speaker: "guard", voice: "v-bright", name: "Bright", settings: {} }))
}

describe("speakers and voices", () => {
  it("every line starts missing, and says what stands between it and a voiced line", async () => {
    const root = project()
    const result = await jam(root, status({}))
    assert.deepEqual(result.lines.map((row) => [row.line, row.state, row.reviewed, row.voice, row.needs]), [
      ["intro/greet", "missing", true, null, ["no voice", "missing"]],
      ["intro/warn", "missing", false, null, ["unreviewed", "no voice", "missing"]],
      ["intro/bye", "missing", false, null, ["unreviewed", "no voice", "missing"]]
    ])
    assert.deepEqual([result.counts.lines, result.counts.missing, result.counts.unreviewed, result.counts.noVoice], [3, 3, 2, 3])
    assert.deepEqual((await jam(root, status({ speaker: "guard" }))).lines.map((row) => row.line), ["intro/bye"])
  })

  it("the person's choice of voice is checked with the provider and written to the speakers file with its name", async () => {
    const root = project()
    const listed = await jam(root, voices({ search: "grav" }))
    assert.deepEqual([listed.provider, listed.voices.map((voice) => [voice.id, voice.name, voice.preview])], ["elevenlabs", [["v-gravel", "Gravel", "https://example.invalid/gravel.mp3"]]])
    assert.ok("design a new voice" in listed.links)
    const assigned = await jam(root, assign({ speaker: "innkeeper", voice: "v-gravel", settings: { stability: 0.4 } }))
    assert.deepEqual(assigned.voice, { provider: "elevenlabs", id: "v-gravel", name: "Gravel", settings: { stability: 0.4 } })
    assert.deepEqual(readJson(root, "Audio/speakers.json"), { speakers: [{ id: "innkeeper", voice: assigned.voice }] })
    assert.equal((await rows(root))["greet"]!.voice, "Gravel")
    assert.doesNotMatch(JSON.stringify(readJson(root, "Audio/speakers.json")), /https?:/, "a preview link is shown, never stored")
    assert.match((await jamFailure(root, assign({ speaker: "guard", voice: "nobody", settings: {} }))).message, /the provider has no voice nobody|voices get failed/)
    assert.match((await jamFailure(root, assign({ speaker: "guard", voice: "v-bright", settings: { speed: 2 } }))).message, /speed is not a voice setting of this provider/)
  })

  it("a dry run shows the text each line would send and its cost; a performance must keep the authored words", async () => {
    const root = project()
    await voiced(root)
    const plan = await jam(root, speak(speaking({ dryRun: true })))
    assert.deepEqual(plan.planned!.map((row) => [row.line, row.voice, row.text, row.estimate]), [
      ["intro/greet", "Gravel", "Welcome, traveller.", 19],
      ["intro/warn", "Gravel", "[low, steady voice] Mind the X on the floor.", 44],
      ["intro/bye", "Bright", "Move along.", 11]
    ])
    assert.match(plan.spending[0]!.words, /at most 74 ElevenLabs credits for 3 requests \(list price: at most 1 credit per character/)
    assert.deepEqual(plan.unreviewed, ["intro/warn", "intro/bye"])
    assert.deepEqual((await jam(root, speak(speaking({ dryRun: true, reviewed: true })))).planned!.map((row) => row.line), ["intro/greet"])
    assert.deepEqual(paidCalls(root), [])
    setLines(root, (lines) => void (lines[1]!["performance"] = { elevenlabs: "[whispers] Mind the cross on the floor." }))
    const changed = await jamFailure(root, speak(speaking({ dryRun: true })))
    assert.match(changed.message, /intro\/warn: its elevenlabs performance does not speak the line's exact words/)
    assert.match(changed.fix!, /to change the words, edit text/)
  })

  it("lines whose speaker has no voice are not sent; several lines need the run that pays named", async () => {
    const root = project()
    await jam(root, assign({ speaker: "innkeeper", voice: "v-gravel", settings: {} }))
    const missing = await jamFailure(root, speak(speaking()))
    assert.match(missing.message, /no voice is assigned to: guard/)
    assert.match(missing.fix!, /the person chooses each voice.*jam audio voice assign <speaker> --voice/)
    const unnamed = await jamFailure(root, speak(speaking({ speaker: "innkeeper" })))
    assert.match(unnamed.message, /--run <id> is required/)
    assert.match((await jamFailure(root, speak(speaking({ lines: ["greet"] })))).fix!, /jam run start voice-line greet --brief-text/)
    assert.match((await jamFailure(root, speak(speaking({ lines: ["nope"] })))).message, /no line nope/)
    assert.deepEqual(paidCalls(root), [])
  })
})

describe("a line's standing", { skip }, () => {
  it("missing, then voiced, then stale once its text is edited, then voiced again from the reviewed text", async () => {
    const root = project()
    await voiced(root)
    await start(root, "voice-line", "intro-lines")
    const first = await jam(root, speak(speaking({ run: "intro-lines", reviewed: true })))
    assert.deepEqual(first.spoken.map((row) => [row.line, row.take, row.file, row.transcript, row.charge]), [["intro/greet", 1, "Audio/Voice/intro/greet/greet.wav", "match", 19]])
    assert.equal(paidCalls(root).length, 1, "only the line a person marked reviewed was sent")
    assert.deepEqual(runFile(root, "intro-lines").jobs.map((job) => [job.step, job.state, job.estimate, job.actual]), [["voice", "succeeded", 19, 19]])
    assert.deepEqual(first.recorded!.records.map((entry) => [entry.step, entry.state]), [["voice", "accepted"]])
    let now = await rows(root)
    assert.deepEqual([now["greet"]!.state, now["greet"]!.take, now["greet"]!.transcript, now["greet"]!.timings, now["greet"]!.needs, now["warn"]!.state], ["voiced", 1, "match", "forced", [], "missing"])

    // The take records what was sent, who paid, and when each authored word is spoken.
    const take = unitOf(root, "greet").takes[0]!
    assert.deepEqual([take.generation.text, take.generation.voice, take.generation.run, take.generation.job], ["Welcome, traveller.", { id: "v-gravel", name: "Gravel" }, "intro-lines:1", "j1"])
    assert.deepEqual(take.words!.map((word) => word.word), ["Welcome,", "traveller."])
    assert.ok(take.words![0]!.end <= take.words![1]!.start + 1e-6 && take.words![1]!.end <= take.facts.duration + 0.01)
    assert.deepEqual([take.level.target, take.level.reference, take.facts.channels], ["voice", -20, 1])
    assert.ok(Math.abs(take.level.level + 20) <= 0.2, `voice level ${take.level.level}`)
    assert.match(take.original.path, /^Audio\/Sources\/voice\/intro\/greet\/.+_1\.wav$/)

    setLines(root, (lines) => void (lines[0]!["text"] = "Welcome back, traveller."))
    now = await rows(root)
    assert.deepEqual([now["greet"]!.state, now["greet"]!.take, now["greet"]!.needs], ["stale", null, ["stale"]])

    const second = await jam(root, speak(speaking({ run: "intro-lines", reviewed: true })))
    assert.deepEqual(second.spoken.map((row) => [row.line, row.take, row.file]), [["intro/greet", 2, "Audio/Voice/intro/greet/greet_2.wav"]])
    now = await rows(root)
    assert.deepEqual([now["greet"]!.state, now["greet"]!.take, now["greet"]!.reviewed, now["greet"]!.needs], ["voiced", 2, true, []])
    const unit = unitOf(root, "greet")
    assert.deepEqual([unit.name, unit.line!.text, unit.takes.map((entry) => entry.n)], ["Welcome back, traveller.", "Welcome back, traveller.", [1, 2]])
    assert.notEqual(unit.takes[0]!.textHash, unit.takes[1]!.textHash)

    // A person withdrawing the review mark shows at once; the take is still the line's.
    setLines(root, (lines) => void delete lines[0]!["review"])
    assert.deepEqual([(await rows(root))["greet"]!.reviewed, (await rows(root))["greet"]!.needs], [false, ["unreviewed"]])
    assert.match((await jam(root, speak(speaking({ run: "intro-lines", reviewed: true })))).next, /nothing to voice/)
  })

  it("a recording a person made becomes a take of its line, and a chosen take stands for it", async () => {
    const root = project()
    await voiced(root)
    write(root, "inbox/bye-sam.wav", wavOf(join_(silence(0.4), speech(1.1), silence(0.5))))
    const added = await jam(root, process(processing({ lines: ["bye"], file: "inbox/bye-sam.wav", creator: "Sam", license: "own recording" })))
    assert.deepEqual(added.lines.map((row) => [row.line, row.state, row.take, row.transcript]), [["intro/bye", "voiced", 1, "match"]])
    const [take] = unitOf(root, "bye").takes
    assert.deepEqual([take!.generation.origin, take!.generation.creator, take!.original.path], ["supplied", "Sam", "Audio/Sources/voice/intro/bye/bye-sam.wav"])
    assert.ok(Math.abs(take!.facts.duration - (1.1 + 0.12)) < 0.06, `trimmed to the speech: ${take!.facts.duration}`)

    // Its run starts at the processed result and says where the recording came from.
    write(root, "work/consent.md", "Recorded by Sam on 2026-11-12 for this project.")
    await start(root, "voice-line", "bye-recorded", { from: "process" })
    assert.match((await jamFailure(root, process(processing({ lines: ["bye"], run: "bye-recorded" })))).message, /starts at process from existing work, so this record must say where that work came from/)
    const entered = await jam(root, process(processing({ lines: ["bye"], run: "bye-recorded", source: "recorded by Sam", sourceEvidence: "work/consent.md" })))
    assert.deepEqual(entered.recorded!.records.map((entry) => [entry.step, entry.state]), [["process", "review"]])
    assert.deepEqual(runFile(root, "bye-recorded").steps["process"]!.records.at(-1)!.provenance, { kind: "imported", source: "recorded by Sam", sourceEvidence: "work/consent.md" })

    await start(root, "voice-line", "bye")
    await jam(root, speak(speaking({ lines: ["intro/bye"], takes: 2 })))
    assert.deepEqual(unitOf(root, "bye").takes.map((entry) => entry.n), [1, 2, 3])
    assert.equal((await rows(root))["bye"]!.take, 1, "the take already standing still stands")
    await jam(root, process(processing({ lines: ["bye"], take: 3 })))
    assert.deepEqual([(await rows(root))["bye"]!.take, unitOf(root, "bye").selected], [3, 3])
    assert.match((await jamFailure(root, process(processing({ lines: ["bye"], take: 9 })))).message, /intro\/bye has no take 9 of its current text/)
    assert.match((await jamFailure(root, process(processing({ lines: ["bye", "greet"], take: 1 })))).message, /--take applies to exactly one named line/)
    assert.match((await jamFailure(root, process(processing()))).message, /name the lines to process, pass --run <id>/)
  })
})

describe("the transcript check", { skip }, () => {
  it("flags a take that does not say its text, treats same-sound spellings as the same words, and blocks the record until it matches", async () => {
    const root = project({ files: { "tools/heard.json": JSON.stringify({ "Mind the X on the floor.": "Mind the eggs on the floor." }) } })
    await voiced(root)
    await start(root, "voice-line", "intro-lines")
    const spoken = await jam(root, speak(speaking({ run: "intro-lines", speaker: "innkeeper" })))
    assert.deepEqual(spoken.spoken.map((row) => [row.line, row.transcript, row.heard]), [["intro/greet", "match", undefined], ["intro/warn", "mismatch", "Mind the eggs on the floor."]])
    assert.match(spoken.next, /a mismatched take does not say its text/)
    assert.deepEqual((await rows(root))["warn"]!.needs, ["unreviewed", "mismatched"])

    const refused = await jamFailure(root, process(processing({ run: "intro-lines" })))
    assert.match(refused.message, /step process did not pass its checks: intro\/warn: take 1 does not say its text; the transcriber heard "Mind the eggs on the floor\."/)
    assert.equal(runFile(root, "intro-lines").steps["process"], undefined, "nothing was recorded")

    // "ex" is how a transcriber spells the letter X: the shipped list makes them the same word.
    write(root, "tools/heard.json", JSON.stringify({ "Mind the X on the floor.": "Mind the ex on the floor." }))
    const rechecked = await jam(root, process(processing({ lines: ["warn"], recheck: true })))
    assert.deepEqual(rechecked.lines.map((row) => [row.transcript, row.timings]), [["match", "forced"]])
    assert.equal(unitOf(root, "warn").takes[0]!.transcript!.heard, "Mind the ex on the floor.")

    const recorded = await jam(root, process(processing({ run: "intro-lines" })))
    assert.deepEqual(recorded.recorded!.records.map((entry) => [entry.step, entry.state, entry.gate.required]), [["process", "review", "human"]])
    const step = runFile(root, "intro-lines").steps["process"]!.records.at(-1)!
    assert.deepEqual([step.files.map((file) => [file.role, file.path]), step.checks.map((check) => check.id)], [
      [["line", "Audio/Voice/intro/greet/greet.wav"], ["line", "Audio/Voice/intro/warn/warn.wav"]], ["loudness", "transcript-match"]
    ])
    // The recipe ends, with no engine adapter, at processed lines a person accepted.
    await review(root, "intro-lines", "process", { relay: "chat: both lines sound right" })
    assert.deepEqual((await runStatus(root, "intro-lines")).steps.map((entry) => [entry.step, entry.state]), [["voice", "accepted"], ["process", "accepted"], ["import", "skipped"]])
  })

  it("when it is not installed the step cannot be recorded silently: it says how to install it, or takes a person's acceptance by ear, on record", async () => {
    const root = project({ aligner: "absent" })
    await voiced(root)
    await start(root, "voice-line", "greet")
    const spoken = await jam(root, speak(speaking({ lines: ["greet"] })))
    assert.deepEqual([spoken.spoken[0]!.transcript, spoken.transcriptCheck!.available], ["unchecked", false])
    const check = spoken.transcriptCheck as { reason: string; install: string }
    assert.match(check.reason, /its Python environment lacks torch, torchaudio/)
    assert.match(check.install, /jam python -m pip install -r .*scripts\/audio\/requirements\.txt/)
    assert.deepEqual([(await rows(root))["greet"]!.needs, unitOf(root, "greet").takes[0]!.words], [["unchecked"], undefined])

    const refused = await jamFailure(root, process(processing({ run: "greet" })))
    assert.match(refused.message, /intro\/greet: the transcript check is unavailable \(its Python environment lacks torch, torchaudio\), so nothing shows that take 1 says its text/)
    assert.match(refused.message, /install it: jam python -m pip install -r .*Or a person listens and their acceptance is recorded: jam audio voice process intro\/greet --by-ear/)
    assert.equal(runFile(root, "greet").steps["process"], undefined)
    assert.match((await jamFailure(root, process(processing({ lines: ["greet"], byEar: "sounds fine" })))).message, /--by-ear "sounds fine": expected "<where they answered>: <their words, verbatim>"/)
    assert.match((await jamFailure(root, process(processing({ run: "greet", byEar: "chat: fine" })))).message, /--by-ear needs the lines the person listened to, by name/)

    const accepted = await jam(root, process(processing({ lines: ["greet"], run: "greet", byEar: "chat: yes, she says exactly that" })))
    assert.deepEqual(accepted.lines.map((row) => [row.transcript, row.needs]), [["by-ear", []]])
    assert.deepEqual(unitOf(root, "greet").takes[0]!.transcript!.accepted, { channel: "chat", words: "yes, she says exactly that" })
    assert.deepEqual(accepted.recorded!.records.map((entry) => [entry.step, entry.state]), [["process", "review"]])
    assert.match(runFile(root, "greet").steps["process"]!.records.at(-1)!.note, /accepted by ear \(chat: yes, she says exactly that\)/)
  })

  it("a line whose text changed after it was voiced cannot be recorded until it is voiced again", async () => {
    const root = project()
    await voiced(root)
    await start(root, "voice-line", "greet")
    await jam(root, speak(speaking({ lines: ["greet"] })))
    setLines(root, (lines) => void (lines[0]!["text"] = "Welcome, stranger."))
    const refused = await jamFailure(root, process(processing({ run: "greet" })))
    assert.match(refused.message, /nothing to record on run greet:1: intro\/greet: its text changed after it was voiced; speak it again/)
  })
})
