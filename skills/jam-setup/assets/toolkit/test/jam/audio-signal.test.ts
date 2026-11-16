// The signal rules and the settings they are driven by, on sounds synthesised in memory. Nothing
// here needs ffmpeg.
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { shape } from "../../src/jam/audio/chain.ts"
import { globPattern, sameWords } from "../../src/jam/audio/lines.ts"
import { detectEvents, frames, matchGains, momentaryMax, samplePeak, seconds, soundBounds, speechBounds, tightenTail } from "../../src/jam/audio/signal.ts"
import { resolveSettings } from "../../src/jam/audio/targets.ts"
import { readWav, wavInfo, writeWav } from "../../src/jam/audio/wav.ts"
import { hiss, hit, join_, pcmOf, RATE, recording, silence, speech, tone } from "./audio-fixtures.ts"

const near = (actual: number, expected: number, tolerance: number, what: string): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`)

describe("WAV bytes", () => {
  it("survive a round trip at 16 and 24 bits, and a decoder's streamed header is read to the end of the data", () => {
    const pcm = { rate: 44100, channels: [tone(0.1, 440, -6, 44100), tone(0.1, 660, -12, 44100)] }
    for (const depth of [16, 24] as const) {
      const bytes = writeWav(pcm, depth)
      assert.deepEqual([wavInfo(bytes, "x").channels, wavInfo(bytes, "x").sampleRate, wavInfo(bytes, "x").bitDepth], [2, 44100, depth])
      const back = readWav(bytes, "x")
      assert.equal(frames(back), frames(pcm))
      for (const index of [0, 100, 4000]) near(back.channels[1]![index]!, pcm.channels[1]![index]!, 2 / 2 ** (depth - 1), `${depth}-bit sample ${index}`)
    }
    const streamed = Buffer.from(writeWav(pcm, 16))
    streamed.writeUInt32LE(0xffffffff, 4)
    streamed.writeUInt32LE(0xffffffff, 40)
    assert.equal(frames(readWav(streamed, "streamed")), frames(pcm))
    assert.throws(() => readWav(Buffer.from("RIFFxxxxWEBPVP8 "), "picture.wav"), /picture\.wav is not a WAV file/)
  })
})

describe("how loud a sound is heard", () => {
  it("a full-scale 997 Hz sine reads -3.01 LUFS, and a short burst reads lower by the share of the 400 ms window it fills", () => {
    near(momentaryMax(pcmOf(tone(2, 997, 0))), -3.01, 0.1, "steady sine")
    near(momentaryMax(pcmOf(tone(0.05, 997, 0))), -3.01 + 10 * Math.log10(0.05 / 0.4), 0.3, "50 ms burst")
    near(samplePeak(pcmOf(tone(1, 997, -20))), -20, 0.01, "peak")
    // Two channels carrying the same signal are 3 dB louder than one.
    near(momentaryMax({ rate: RATE, channels: [tone(1, 997, -20), tone(1, 997, -20)] }) - momentaryMax(pcmOf(tone(1, 997, -20))), 3.01, 0.05, "stereo sum")
  })

  it("matched sounds end at one level: the reference, or lower when one of them would cross the ceiling there", () => {
    const free = matchGains([{ loud: -30, peak: -12 }, { loud: -20, peak: -9 }], -26, -1)
    assert.deepEqual([free.level, free.gains, free.limited], [-26, [4, -6], false])
    const held = matchGains([{ loud: -30, peak: -12 }, { loud: -40, peak: -8 }], -26, -1)
    assert.deepEqual([held.level, held.gains, held.limited], [-33, [-3, 7], true])
  })
})

describe("where a sound is", () => {
  it("a one-shot runs from just before its first transient to where its tail settles, so a ringing tail stays with it", () => {
    const sound = recording(2.5, [0.5, hit(1.2, { decay: 5 })])
    const bounds = soundBounds(sound, RATE)!
    near(bounds.start / RATE, 0.5, 0.01, "start")
    assert.ok(bounds.end / RATE > 1.5, `the tail is kept to ${bounds.end / RATE} s`)
    assert.equal(soundBounds(hiss(1), RATE), null, "an even bed has no bounds and is kept whole")
  })

  it("speech keeps a little room on both sides and ignores the silence around it", () => {
    const bounds = speechBounds(join_(silence(0.4), speech(1.5), silence(0.6)), RATE)!
    near(bounds.start / RATE, 0.4 - 0.06, 0.02, "start")
    near(bounds.end / RATE, 1.9 + 0.06, 0.03, "end")
    assert.equal(speechBounds(silence(1), RATE), null)
  })
})

describe("separate events", () => {
  const three = recording(3.2, [0.3, hit(0.5)], [1.3, hit(0.5, { frequency: 520 })], [2.3, hit(0.5, { frequency: 330, peakDb: -14 })])

  it("hits kept apart by a real gap are separate events, each cut with its own tail, soft ones included", () => {
    const found = detectEvents(three, RATE)
    assert.equal(found.events.length, 3)
    for (const [index, at] of [0.3, 1.3, 2.3].entries()) {
      near(found.events[index]!.onset / RATE, at, 0.005, `onset ${index + 1}`)
      assert.ok(found.events[index]!.end / RATE >= at + 0.3, `event ${index + 1} keeps its tail`)
    }
    assert.ok(found.events[0]!.end <= found.events[1]!.start, "cuts do not overlap")
    near(found.floorDb, -75, 6, "noise floor")
  })

  it("close transients of one action stay one event, and a quieter sound that begins while the last still rings is its tail", () => {
    const heelToe = recording(1.5, [0.3, hit(0.3)], [0.36, hit(0.3, { frequency: 700, peakDb: -9 })])
    assert.equal(detectEvents(heelToe, RATE).events.length, 1)
    const ringing = recording(2.2, [0.3, hit(1.4, { decay: 3 })], [0.9, hit(0.4, { frequency: 900, peakDb: -24, decay: 9 })])
    assert.equal(detectEvents(ringing, RATE).events.length, 1)
  })

  it("a far quieter blip is noise, not a hit; a longer gap rule merges; an even bed has no events", () => {
    const blip = recording(2.4, [0.3, hit(0.5)], [1.5, hit(0.2, { peakDb: -44 })])
    assert.equal(detectEvents(blip, RATE).events.length, 1)
    assert.equal(detectEvents(three, RATE, { minGapMs: 900 }).events.length, 1)
    assert.equal(detectEvents(hiss(1), RATE).events.length, 0)
  })
})

describe("shaping", () => {
  it("tightening plays the sound untouched until it has decayed, then fades and cuts the rest", () => {
    const long = pcmOf(hit(2, { decay: 3 }))
    const tight = tightenTail(long, 30, 100)
    // exp(-3t) is 30 dB down after 1.15 s; the fade adds 0.1 s.
    near(seconds(tight), 1.25, 0.03, "length")
    assert.equal(tight.channels[0]![1000], long.channels[0]![1000], "the body is untouched")
    assert.ok(Math.abs(tight.channels[0]!.at(-1)!) < 1e-4, "it ends at silence")
  })

  it("the window found the first time is written down, so shaping the same original again cuts at the same place", () => {
    const original = pcmOf(recording(2, [0.5, hit(0.8)]))
    const first = shape(original, "effect", { loop: false, stereo: false, window: null })
    assert.equal(first.processing.window!.by, "auto")
    near(first.processing.window!.start, 0.5, 0.01, "window start")
    const again = shape(original, "effect", first.processing)
    assert.deepEqual([frames(again.pcm), again.processing], [frames(first.pcm), first.processing])
    assert.deepEqual(Array.from(again.pcm.channels[0]!.subarray(0, 2000)), Array.from(first.pcm.channels[0]!.subarray(0, 2000)))
    const loop = shape(original, "loop", { loop: true, stereo: false, window: null })
    assert.deepEqual([frames(loop.pcm), loop.processing.window], [frames(original), null], "a loop is kept whole")
  })
})

describe("settings", () => {
  const config = { roots: { sources: "a", sfx: "b", voice: "c" }, lines: [], speakers: "s.json", language: "en" }

  it("defaults carry the jam's targets: effects and loops by their loudest 400 ms at -26 LUFS, voice at -20 LUFS integrated, all under -1 dBTP, 48 kHz 24-bit", () => {
    const settings = resolveSettings(undefined, config)
    assert.deepEqual(settings.format, { sampleRate: 48000, bitDepth: 24, source: "default" })
    assert.deepEqual(Object.values(settings.targets).map((target) => [target.kind, target.measure, target.lufs, target.truePeakDb, target.source]), [
      ["effect", "momentary-max", -26, -1, "default"], ["loop", "momentary-max", -26, -1, "default"], ["voice", "integrated", -20, -1, "default"]
    ])
  })

  it("the engine adapter's audio facts win over the project's audio section, which wins over the defaults", () => {
    const project = { ...config, format: { sampleRate: 44100, bitDepth: 16 as const }, loudness: { effect: { measure: "momentary-max" as const, lufs: -23 }, voice: { measure: "integrated" as const, lufs: -18, truePeakDb: -2 } } }
    const own = resolveSettings(undefined, project)
    assert.deepEqual([own.format, own.targets.effect.lufs, own.targets.effect.source, own.targets.voice.truePeakDb, own.targets.loop.source], [{ sampleRate: 44100, bitDepth: 16, source: "config" }, -23, "config", -2, "default"])
    const engine = resolveSettings({ sampleRate: 32000, loudness: { integratedLufs: -16, truePeakDb: -3, targets: { effect: { measure: "integrated", lufs: -14 } } } }, project)
    assert.deepEqual([engine.format.sampleRate, engine.format.bitDepth, engine.format.source], [32000, 16, "engine"])
    assert.deepEqual([engine.targets.effect.measure, engine.targets.effect.lufs, engine.targets.effect.truePeakDb, engine.targets.effect.source], ["integrated", -14, -3, "engine"])
    // The project's own voice target stands; an engine that states one programme loudness sets it only where the project is silent.
    assert.deepEqual([engine.targets.voice.lufs, engine.targets.voice.truePeakDb], [-18, -2])
    assert.deepEqual([resolveSettings({ loudness: { integratedLufs: -16 } }, config).targets.voice.lufs, resolveSettings({ loudness: { integratedLufs: -16 } }, config).targets.effect.lufs], [-16, -26])
  })
})

describe("dialogue files", () => {
  it("a lines pattern matches within a folder with * and across folders with **", () => {
    assert.ok(globPattern("Audio/Lines/*.json").test("Audio/Lines/intro.json"))
    assert.ok(!globPattern("Audio/Lines/*.json").test("Audio/Lines/act1/intro.json"))
    assert.ok(globPattern("Story/**/*.lines.json").test("Story/act1/scene2/intro.lines.json"))
    assert.ok(globPattern("Story/**/*.lines.json").test("Story/intro.lines.json"))
    assert.ok(!globPattern("Story/**/*.lines.json").test("Story/act1/notes.json"))
  })

  it("a performance keeps the authored words when only spacing differs", () => {
    assert.ok(sameWords(" Not yet...  Frankie. ", "Not yet... Frankie."))
    assert.ok(!sameWords("Not yet, Frank.", "Not yet... Frankie."))
  })
})
