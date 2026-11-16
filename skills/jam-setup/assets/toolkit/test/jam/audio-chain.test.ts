// The processing chain on synthesised recordings, measured afterwards by ffmpeg run directly: the
// level lands on the kind's target, the true peak stays under the ceiling, silence is trimmed and
// tails kept, takes are split and matched, and a changed target is migrated from the originals.
import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { sha256 } from "../../src/kernel/hash.ts"
import { levelTo, measureWav, shape } from "../../src/jam/audio/chain.ts"
import { Ffmpeg } from "../../src/jam/audio/Ffmpeg.ts"
import type { AudioUnit } from "../../src/jam/audio/schema.ts"
import { add, reprocess, show, split, tighten, trim, variantsFromTakes } from "../../src/jam/audio/sfx.ts"
import { samplePeak } from "../../src/jam/audio/signal.ts"
import { audioSettings } from "../../src/jam/audio/targets.ts"
import { audioProject, bytesOf, hit, join_, NO_FFMPEG, pcmOf, recording, silence, speech, tone, wavOf } from "./audio-fixtures.ts"
import { jam, jamFailure, readJson, write } from "./fixtures.ts"
import { record, recordFailure, start } from "./flow.ts"

const skip = NO_FFMPEG
const FLAGS = { loop: false, stereo: false, tighten: false }
const unitOf = (root: string, name: string): AudioUnit => readJson<AudioUnit>(root, `Audio/SFX/${name}/unit.json`)
const near = (actual: number | null, expected: number, tolerance: number, what: string): void =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`)

/** What ffmpeg itself measures in a file, independent of the toolkit: R 128 summary, and the loudest momentary block. */
const measured = (root: string, path: string): { integrated: number; momentaryMax: number; truePeak: number } => {
  const file = join(root, ...path.split("/"))
  const run = (filter: string): string => spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", filter, "-f", "null", "-"], { encoding: "utf8" }).stderr
  const plain = run("ebur128=peak=true")
  const summary = plain.slice(plain.lastIndexOf("Summary:"))
  // Padded, so the 400 ms window slides off the end as it would in a mix.
  const blocks = [...run("apad=pad_dur=0.4,ebur128").matchAll(/\bM:\s*(-?[\d.]+)/g)].map((match) => Number(match[1]))
  return { integrated: Number(/I:\s+(-?[\d.]+)/.exec(summary)![1]), momentaryMax: Math.max(...blocks), truePeak: Number(/Peak:\s+(-?[\d.]+)/.exec(summary)![1]) }
}

const supply = (root: string, name: string, sound: Float32Array, rate = 48000): string => {
  write(root, `inbox/${name}.wav`, wavOf(sound, rate))
  return `inbox/${name}.wav`
}

describe("ffmpeg", () => {
  it("when it is missing, every audio command says so with how to install it or where to name its path", async () => {
    const root = audioProject({ local: { ffmpeg: "no-such-ffmpeg-program" } })
    const error = await jamFailure(root, add({ name: "knock", file: supply(root, "knock", hit(0.5)), ...FLAGS }))
    assert.equal(error.code, "unavailable")
    assert.match(error.message, /ffmpeg cannot run: no-such-ffmpeg-program is not installed or not on PATH/)
    assert.match(error.fix!, /install ffmpeg .* or set "ffmpeg" in jam\.local\.json to its path; "jam doctor" shows what was found/)
    assert.ok(!existsSync(join(root, "Audio/SFX/knock/unit.json")), "nothing was recorded")
  })

  it("decodes any rate to the asked one, probes, filters, measures and draws", { skip }, async () => {
    const root = audioProject()
    const file = supply(root, "tone", tone(1, 997, -20, 44100), 44100)
    const result = await jam(root, Effect.gen(function*() {
      const ffmpeg = yield* Ffmpeg
      const decoded = yield* ffmpeg.decode(file, { rate: 48000, channels: 2 })
      const quieter = yield* ffmpeg.filter(wavOf(tone(1, 997, -20)), "volume=-6dB")
      return {
        version: yield* ffmpeg.version, probe: yield* ffmpeg.probe(file), decoded: [decoded.rate, decoded.channels.length, decoded.channels[0]!.length],
        filteredPeak: samplePeak(quieter), loudness: yield* ffmpeg.loudness(wavOf(tone(2, 997, -20))), picture: yield* ffmpeg.waveform(file, [{ start: 0.2, end: 0.5 }])
      }
    }))
    assert.match(result.version, /^ffmpeg version/)
    assert.deepEqual(result.probe, { channels: 1, sampleRate: 44100, duration: 1, bitDepth: 16 })
    assert.deepEqual(result.decoded, [48000, 2, 48000])
    near(result.filteredPeak, -26, 0.05, "filtered peak")
    // A 997 Hz sine peaking at -20 dBFS is -23 LUFS.
    near(result.loudness.integrated, -23.0, 0.15, "integrated")
    near(result.loudness.truePeak, -20, 0.1, "true peak")
    assert.deepEqual([...result.picture.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    assert.match((await jamFailure(root, Effect.flatMap(Ffmpeg, (ffmpeg) => ffmpeg.decode("jam.config.json")))).message, /ffmpeg could not decode jam\.config\.json/)
  })
})

describe("one-shot effects", { skip }, () => {
  it("lose their silent lead-in and tail, keep their ringing tail, and land on the effect target as ffmpeg itself measures it", async () => {
    const root = audioProject()
    const supplied = supply(root, "bell", recording(3, [0.6, hit(1.2, { decay: 4, peakDb: -14 })]))
    const before = sha256(bytesOf(root, supplied))
    const result = await jam(root, add({ name: "bell", file: supplied, creator: "Sam", license: "own recording", ...FLAGS }))
    const [take] = unitOf(root, "bell").takes
    assert.deepEqual([result.warnings, take!.level.target, take!.level.measure, take!.level.reference, take!.level.ceiling], [[], "effect", "momentary-max", -26, -1])
    near(take!.level.level, -26, 0.1, "recorded level")
    const independent = measured(root, take!.file)
    near(independent.momentaryMax, -26, 0.5, "ffmpeg's loudest momentary block")
    assert.ok(independent.truePeak <= -1, `true peak ${independent.truePeak}`)
    // 0.6 s of lead-in is gone; the 1.2 s hit is there with its tail; the silence after it is gone.
    near(take!.processing.window!.start, 0.6, 0.02, "window start")
    near(take!.facts.duration, 1.2, 0.15, "duration")
    assert.deepEqual([take!.facts.sampleRate, take!.facts.bitDepth, take!.facts.channels], [48000, 24, 1])
    // The original is kept as supplied, under the sources root.
    assert.deepEqual([take!.original.path, take!.original.sha256, sha256(bytesOf(root, take!.original.path))], ["Audio/Sources/sfx/bell/bell.wav", before, before])
    assert.deepEqual([take!.generation.origin, take!.generation.creator, take!.generation.license], ["supplied", "Sam", "own recording"])
  })

  it("a sound whose peak would cross the ceiling stays under it and says how far short of the target it is", async () => {
    const root = audioProject()
    const click = recording(1, [0.3, hit(0.01, { decay: 1500, frequency: 2000, peakDb: -3 })])
    const result = await jam(root, add({ name: "click", file: supply(root, "click", click), ...FLAGS }))
    const [take] = unitOf(root, "click").takes
    assert.equal(take!.level.limitedBy, "true-peak")
    assert.ok(take!.level.belowReference > 1 && take!.level.level < -27, `level ${take!.level.level}`)
    assert.match(result.warnings[0]!, /LU under the -26 LUFS target; its peak holds it there/)
    const independent = measured(root, take!.file)
    assert.ok(independent.truePeak <= -1 && independent.truePeak >= -1.4, `true peak ${independent.truePeak} sits just under the ceiling`)
  })

  it("a loop is kept whole and levelled to the loop target; a near-silent file is refused instead of being raised into noise", async () => {
    const root = audioProject()
    const bed = join_(silence(0.3), tone(2, 220, -30), silence(0.3))
    await jam(root, add({ name: "hum", file: supply(root, "hum", bed), loop: true, stereo: true, tighten: true }))
    const unit = unitOf(root, "hum")
    assert.deepEqual([unit.target, unit.takes[0]!.processing.window, unit.takes[0]!.processing.tighten, unit.takes[0]!.facts.channels], ["loop", null, undefined, 2])
    near(unit.takes[0]!.facts.duration, 2.6, 0.001, "duration")
    near(unit.takes[0]!.level.level, -26, 0.1, "loop level")
    const silent = await jamFailure(root, add({ name: "nothing", file: supply(root, "nothing", tone(1, 300, -62)), ...FLAGS }))
    assert.match(silent.message, /is silent or near-silent \(peak -6\d.*dBTP\); raising it would only raise noise/)
    assert.match((await jamFailure(root, add({ name: "hum", file: supply(root, "knock", hit(0.5)), ...FLAGS }))).message, /sfx\/hum is a loop; a take of the other kind would be processed to another target/)
  })
})

describe("variants", { skip }, () => {
  const steps = recording(3.4, [0.3, hit(0.5, { peakDb: -4 })], [1.3, hit(0.5, { frequency: 520, peakDb: -9 })], [2.3, hit(0.5, { frequency: 330, peakDb: -16 })])

  it("a dry run lists the events and draws them without writing; splitting cuts one matched variant per event", async () => {
    const root = audioProject()
    await jam(root, add({ name: "steps", file: supply(root, "steps", steps), ...FLAGS }))
    const look = await jam(root, split({ name: "steps", dryRun: true, preview: "work/steps.png" }))
    assert.deepEqual([look.events.length, look.variants, unitOf(root, "steps").variants], [3, undefined, []])
    assert.deepEqual([...bytesOf(root, "work/steps.png").subarray(1, 4)], [0x50, 0x4e, 0x47])
    assert.match(look.next, /each shaded span should be one complete event with its tail/)

    const cut = await jam(root, split({ name: "steps", dryRun: false }))
    const unit = unitOf(root, "steps")
    assert.deepEqual(unit.variants.map((variant) => [variant.file, variant.from]), [1, 2, 3].map((n) => [`Audio/SFX/steps/variants/steps_v0${n}.wav`, 1]))
    assert.equal(cut.variants!.length, 3)
    // Hits recorded 12 dB apart leave at one level, so a random pick never jumps in volume.
    for (const variant of unit.variants) {
      near(variant.level.level, -26, 0.1, variant.file)
      near(measured(root, variant.file).momentaryMax, -26, 0.5, `${variant.file} by ffmpeg`)
      near(variant.facts.duration, 0.5, 0.2, `${variant.file} length`)
    }
    assert.match((await jamFailure(root, split({ name: "steps", minGapMs: 2000, dryRun: false }))).message, /found 1 event in take 1; nothing to split/)
    assert.equal(unitOf(root, "steps").variants.length, 3, "a refused split leaves the variants alone")
  })

  it("whole takes become variants at one shared level, held down by the one whose peak limits it", async () => {
    const root = audioProject()
    await jam(root, add({ name: "knock", file: supply(root, "knock-a", recording(1.2, [0.2, hit(0.6, { peakDb: -6 })])), ...FLAGS }))
    await jam(root, add({ name: "knock", file: supply(root, "knock-b", recording(1.2, [0.2, hit(0.01, { decay: 1500, frequency: 2000, peakDb: -3 })])), ...FLAGS }))
    assert.deepEqual(unitOf(root, "knock").takes.map((take) => take.file), ["Audio/SFX/knock/knock.wav", "Audio/SFX/knock/knock_2.wav"])
    const result = await jam(root, variantsFromTakes({ name: "knock", takes: [1, 2] }))
    const [full, peaky] = unitOf(root, "knock").variants
    assert.equal(result.variants.length, 2)
    assert.ok(full!.level.level < -27, `both sit below the target: ${full!.level.level}`)
    near(full!.level.level, peaky!.level.level, 0.15, "matched levels")
    assert.deepEqual([full!.level.limitedBy, peaky!.level.limitedBy, full!.start], ["matched", "true-peak", undefined])
    assert.ok(Math.max(measured(root, full!.file).truePeak, measured(root, peaky!.file).truePeak) <= -1)
    assert.match((await jamFailure(root, variantsFromTakes({ name: "knock", takes: [1] }))).message, /expected at least two different take numbers/)
    assert.match((await jamFailure(root, variantsFromTakes({ name: "knock", takes: [1, 7] }))).message, /sfx\/knock has no take 7/)
  })
})

describe("edits after review", { skip }, () => {
  it("trim keeps a part of the take, tighten fades its room tail; both work from the original, which never changes", async () => {
    const root = audioProject()
    await jam(root, add({ name: "pour", file: supply(root, "pour", recording(3.2, [0.4, hit(2.4, { decay: 2.5 })])), ...FLAGS }))
    const original = unitOf(root, "pour").takes[0]!.original
    const whole = unitOf(root, "pour").takes[0]!.facts.duration
    assert.ok(whole > 2, `the long tail is kept: ${whole} s`)

    const tightened = await jam(root, tighten({ name: "pour" }))
    // exp(-2.5 t) is 30 dB down after 1.38 s; the fade adds 0.1 s.
    near(tightened.take.duration, 1.48, 0.06, "tightened length")
    assert.deepEqual(unitOf(root, "pour").takes[0]!.processing.tighten, { atDb: 30, fadeMs: 100 })

    const trimmed = await jam(root, trim({ name: "pour", end: 0.8 }))
    near(trimmed.take.duration, 0.8, 0.001, "trimmed length")
    near(trimmed.take.level.level, -26, 0.1, "level after trimming")
    const take = unitOf(root, "pour").takes[0]!
    assert.deepEqual([take.processing.window!.by, take.original, sha256(bytesOf(root, original.path))], ["trim", original, original.sha256])
    // Trimming again is measured from the take as it is now, and loses nothing: a wider window brings sound back.
    assert.match((await jamFailure(root, trim({ name: "pour", start: 0.5, end: 0.51 }))).message, /at least 20 ms long/)
    assert.match((await jamFailure(root, trim({ name: "pour", end: 5 }))).message, /expected a part of the take \(0 to 0\.8 s\)/)
    assert.match((await jamFailure(root, trim({ name: "pour", take: 3, end: 0.5 }))).message, /sfx\/pour has no take 3/)
  })
})

describe("a changed target", { skip }, () => {
  const retarget = (root: string, lufs: number): void => {
    const config = readJson(root, "jam.config.json")
    writeFileSync(join(root, "jam.config.json"), JSON.stringify({ ...config, audio: { loudness: { effect: { measure: "momentary-max", lufs } } } }, null, 2))
  }

  it("reprocess migrates every take and variant from its original, keeps trims and cuts, and never moves the link to the originals", async () => {
    const root = audioProject()
    await jam(root, add({ name: "steps", file: supply(root, "steps", recording(2.4, [0.3, hit(0.5)], [1.3, hit(0.5, { frequency: 520, peakDb: -12 })])), ...FLAGS }))
    await jam(root, add({ name: "pour", file: supply(root, "pour", recording(2, [0.3, hit(1.2, { decay: 4 })])), ...FLAGS }))
    await jam(root, split({ name: "steps", dryRun: false }))
    await jam(root, trim({ name: "pour", end: 0.6 }))
    const before = { steps: unitOf(root, "steps"), pour: unitOf(root, "pour") }

    retarget(root, -20)
    assert.equal((await jam(root, audioSettings)).targets.effect.lufs, -20)
    const result = await jam(root, reprocess({ names: [], all: true }))
    assert.deepEqual([result.units.map((unit) => unit.id), result.problems], [["sfx/pour", "sfx/steps"], []])
    for (const name of ["steps", "pour"] as const) {
      const unit = unitOf(root, name)
      for (const [index, take] of unit.takes.entries()) {
        near(take.level.level, -20, 0.1, `${take.file} level`)
        near(measured(root, take.file).momentaryMax, -20, 0.5, `${take.file} by ffmpeg`)
        assert.deepEqual([take.original, take.processing, take.file], [before[name].takes[index]!.original, before[name].takes[index]!.processing, before[name].takes[index]!.file])
        assert.equal(sha256(bytesOf(root, take.original.path)), take.original.sha256, "the original is untouched")
        near(take.facts.duration, before[name].takes[index]!.facts.duration, 0.001, "same cut")
      }
      for (const [index, variant] of unit.variants.entries()) {
        near(variant.level.level, -20, 0.1, `${variant.file} level`)
        assert.deepEqual([variant.file, variant.start, variant.end], [before[name].variants[index]!.file, before[name].variants[index]!.start, before[name].variants[index]!.end])
      }
    }
    assert.match(result.next, /run steps recorded with them are stale/)
  })

  it("a take whose original is gone is left exactly as it is and reported, while the rest are migrated", async () => {
    const root = audioProject()
    await jam(root, add({ name: "knock", file: supply(root, "knock", recording(1.2, [0.2, hit(0.6)])), ...FLAGS }))
    await jam(root, add({ name: "knock", file: supply(root, "knock-2", recording(1.2, [0.2, hit(0.6, { frequency: 600 })])), ...FLAGS }))
    const [first, second] = unitOf(root, "knock").takes
    rmSync(join(root, first!.original.path))
    retarget(root, -30)
    const result = await jam(root, reprocess({ names: ["knock"], all: false }))
    assert.match(result.problems[0]!, /knock\.wav: its original Audio\/Sources\/sfx\/knock\/knock\.wav is missing; the take was left as it is/)
    const after = unitOf(root, "knock").takes
    assert.deepEqual([after[0], sha256(bytesOf(root, first!.file))], [first, first!.sha256])
    near(after[1]!.level.level, -30, 0.1, "the other take")
    assert.equal(after[1]!.original.path, second!.original.path)
    assert.match((await jamFailure(root, reprocess({ names: [], all: false }))).message, /name the sounds to reprocess, or pass --all/)
  })

  it("the loudness check refuses files processed for another target, a foreign file, and passes once they are reprocessed", async () => {
    const root = audioProject({ files: { "work/origin.md": "Recorded by Sam on 2026-11-10; the project owns it." } })
    await jam(root, add({ name: "knock", file: supply(root, "knock", recording(1.2, [0.2, hit(0.6)])), ...FLAGS }))
    const take = unitOf(root, "knock").takes[0]!
    await start(root, "sfx", "knock", { from: "process" })
    const origin = { source: "own recording", sourceEvidence: "work/origin.md" }
    retarget(root, -20)
    const stale = await recordFailure(root, "knock", "process", { files: [take.file], ...origin })
    assert.match(stale.message, /knock\.wav was processed for -26 LUFS under -1 dBTP; the effect target is now -20 LUFS under -1 dBTP \(fix: jam audio sfx reprocess knock\)/)
    assert.match((await recordFailure(root, "knock", "process", { files: ["inbox/knock.wav"], ...origin })).message, /inbox\/knock\.wav is not a processed take or variant/)
    await jam(root, reprocess({ names: ["knock"], all: false }))
    const recorded = await record(root, "knock", "process", { files: [take.file], ...origin })
    assert.deepEqual(recorded.records.map((entry) => [entry.step, entry.state]), [["process", "review"]])
    const listed = await jam(root, show("knock"))
    assert.deepEqual(listed.sounds[0]!.takes.map((row) => [row.take, row.level.reference, row.origin]), [[1, -20, "supplied"]])
  })
})

describe("voice lines", { skip }, () => {
  it("are trimmed to the speech with a little room and set to -20 LUFS integrated under the ceiling", async () => {
    const root = audioProject()
    const result = await jam(root, Effect.gen(function*() {
      const settings = yield* audioSettings
      const shaped = shape(pcmOf(join_(silence(0.5), speech(2.5, -30), silence(0.8))), "voice", { loop: false, stereo: false, window: null })
      const rendered = yield* levelTo([shaped.pcm], settings.targets.voice, 24)
      if ("nearSilent" in rendered) throw new Error("near-silent")
      return { rendered: rendered[0]!, window: shaped.processing.window!, again: yield* measureWav(rendered[0]!.wav, "the line") }
    }))
    write(root, "work/line.wav", result.rendered.wav)
    assert.deepEqual([result.rendered.level.target, result.rendered.level.measure, result.rendered.level.reference], ["voice", "integrated", -20])
    near(measured(root, "work/line.wav").integrated, -20, 0.5, "integrated loudness by ffmpeg")
    assert.ok(measured(root, "work/line.wav").truePeak <= -1)
    near(result.window.start, 0.44, 0.02, "60 ms of room before the speech")
    near(result.rendered.facts.duration, 2.5 + 0.12, 0.05, "speech plus room")
    assert.deepEqual(result.again, result.rendered.facts)
  })
})
