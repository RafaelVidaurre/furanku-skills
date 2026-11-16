// The one processing chain: an original becomes a processed WAV by decoding to the project's
// format, keeping the part that is the sound, fading the cut edges, optionally shortening the room
// tail, and setting the level to the kind's loudness target under the true-peak ceiling.
import * as Effect from "effect/Effect"
import { attempt, type ToolError } from "../../kernel/errors.ts"
import { Ffmpeg } from "./Ffmpeg.ts"
import type { AudioFacts, Level, Processing } from "./schema.ts"
import { applyGain, fade, frames, matchGains, mono, momentaryMax, type Pcm, slice, soundBounds, speechBounds, tightenTail } from "./signal.ts"
import { type AudioSettings, NEAR_SILENT_DB, type ResolvedTarget } from "./targets.ts"
import { readWav, wavInfo, writeWav } from "./wav.ts"

const round = (value: number, places = 2): number => Number(value.toFixed(places))

/** Measure WAV bytes the way records state them. */
export const measureWav = (wav: Uint8Array, what: string): Effect.Effect<AudioFacts, ToolError, Ffmpeg> =>
  Effect.gen(function*() {
    const info = yield* attempt(`read ${what}`, () => wavInfo(wav, what), "malformed")
    const pcm = yield* attempt(`read ${what}`, () => readWav(wav, what), "malformed")
    const loudness = yield* (yield* Ffmpeg).loudness(wav)
    return {
      duration: round(frames(pcm) / pcm.rate, 4),
      channels: info.channels,
      sampleRate: info.sampleRate,
      bitDepth: info.bitDepth,
      integratedLufs: loudness.integrated === null ? null : round(loudness.integrated),
      momentaryMaxLufs: round(momentaryMax(pcm)),
      truePeakDb: loudness.truePeak === null ? null : round(loudness.truePeak)
    }
  })

/** A file's loudness by a measure. A file too short for programme loudness is judged by its loudest 400 ms. */
export const loudnessBy = (facts: AudioFacts, measure: Level["measure"]): { readonly loud: number; readonly measure: Level["measure"] } =>
  measure === "integrated" && facts.integratedLufs !== null ? { loud: facts.integratedLufs, measure } : { loud: facts.momentaryMaxLufs, measure: "momentary-max" }

export interface Rendered {
  readonly wav: Uint8Array
  readonly facts: AudioFacts
  readonly level: Level
}

export interface NearSilent {
  readonly nearSilent: true
  readonly truePeakDb: number | null
}

/**
 * Bring sounds to a target level and encode them. Several sounds are matched: all end at one level,
 * the target or lower when one of them would cross the ceiling there.
 */
export const levelTo = (sounds: ReadonlyArray<Pcm>, target: ResolvedTarget, bitDepth: 16 | 24): Effect.Effect<ReadonlyArray<Rendered> | NearSilent, ToolError, Ffmpeg> =>
  Effect.gen(function*() {
    const render = (gains: ReadonlyArray<number>) =>
      Effect.forEach(sounds, (pcm, index) => {
        const wav = writeWav(applyGain(pcm, gains[index]!), bitDepth)
        return Effect.map(measureWav(wav, "the processed audio"), (facts) => ({ wav, facts }))
      })
    // A few milliseconds hold no sound to level.
    if (sounds.some((pcm) => frames(pcm) < pcm.rate * 0.005)) return { nearSilent: true, truePeakDb: null }
    const before = yield* render(sounds.map(() => 0))
    const quiet = before.find((entry) => entry.facts.truePeakDb === null || entry.facts.truePeakDb < NEAR_SILENT_DB)
    if (quiet !== undefined) return { nearSilent: true, truePeakDb: quiet.facts.truePeakDb }
    const measures = before.map((entry) => loudnessBy(entry.facts, target.measure))
    const own = before.map((entry, index) => measures[index]!.loud + (target.truePeakDb - entry.facts.truePeakDb!))
    const matched = matchGains(before.map((entry, index) => ({ loud: measures[index]!.loud, peak: entry.facts.truePeakDb! })), target.lufs, target.truePeakDb)
    let after = yield* render(matched.gains)
    // Requantising can move the true peak a hair; one shared correction keeps matched sounds matched.
    const over = Math.max(0, ...after.map((entry) => (entry.facts.truePeakDb ?? -Infinity) - target.truePeakDb))
    if (over > 0.005) after = yield* render(matched.gains.map((gain) => gain - over - 0.05))
    return after.map((entry, index): Rendered => {
      const reached = loudnessBy(entry.facts, measures[index]!.measure)
      const below = round(Math.max(0, target.lufs - reached.loud))
      return {
        wav: entry.wav,
        facts: entry.facts,
        level: {
          target: target.kind,
          measure: reached.measure,
          reference: target.lufs,
          ceiling: target.truePeakDb,
          level: round(reached.loud),
          belowReference: below,
          ...(below > 0.1 ? { limitedBy: own[index]! < target.lufs - 0.05 ? "true-peak" as const : "matched" as const } : {})
        }
      }
    })
  })

export interface Shaped {
  readonly pcm: Pcm
  /** The processing as applied, with the window that was found written in. */
  readonly processing: Processing
}

/**
 * Keep the part of a decoded original that is the sound. The first time, the window is found
 * (an effect: first transient to settled tail; a voice line: speech with a little room); it is
 * then written down, so processing the same original again cuts at the same place.
 */
export const shape = (original: Pcm, kind: ResolvedTarget["kind"], processing: Processing): Shaped => {
  const total = frames(original)
  let window = processing.window
  if (window === null && !processing.loop) {
    const mixed = mono(original)
    const found = kind === "voice" ? speechBounds(mixed, original.rate) : soundBounds(mixed, original.rate)
    if (found !== null) window = { start: found.start / original.rate, end: found.end / original.rate, by: "auto" }
  }
  let pcm: Pcm = { rate: original.rate, channels: original.channels.map((channel) => channel.slice()) }
  if (window !== null) {
    const start = Math.max(0, Math.min(total, Math.round(window.start * original.rate)))
    const end = Math.max(start, Math.min(total, Math.round(window.end * original.rate)))
    pcm = slice(original, start, end)
    if (kind === "voice") fade(pcm, 2, 8)
    else if (window.by === "auto") fade(pcm, 1, 10)
    else fade(pcm, start > 0 ? 1 : 0, end < total ? processing.fadeOutMs ?? 30 : 0)
  }
  if (processing.tighten !== undefined && !processing.loop) pcm = tightenTail(pcm, processing.tighten.atDb, processing.tighten.fadeMs)
  return { pcm, processing: { ...processing, window } }
}

export interface Processed extends Rendered {
  readonly processing: Processing
}

/** The whole chain for one original. */
export const processOriginal = (path: string, target: ResolvedTarget, settings: AudioSettings, processing: Processing): Effect.Effect<Processed | NearSilent, ToolError, Ffmpeg> =>
  Effect.gen(function*() {
    const original = yield* (yield* Ffmpeg).decode(path, { rate: settings.format.sampleRate, channels: processing.stereo ? 2 : 1 })
    const shaped = shape(original, target.kind, processing)
    const result = yield* levelTo([shaped.pcm], target, settings.format.bitDepth)
    return "nearSilent" in result ? result : { ...result[0]!, processing: shaped.processing }
  })
