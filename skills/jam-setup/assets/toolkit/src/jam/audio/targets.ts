// What processed audio must be: the WAV format and the loudness target of each kind of sound. The
// engine adapter's audio facts decide where they speak, then the project's `audio` section, then
// the defaults below.
import * as Effect from "effect/Effect"
import type { ToolError } from "../../kernel/errors.ts"
import { Config } from "../config/Config.ts"
import { Engine } from "../engine/Engine.ts"
import type { Facts } from "../engine/schema.ts"
import { type AudioConfig, TARGET_KINDS, type TargetKind } from "./schema.ts"

export type Source = "engine" | "config" | "default"

export interface ResolvedTarget {
  readonly kind: TargetKind
  readonly measure: "integrated" | "momentary-max"
  readonly lufs: number
  readonly truePeakDb: number
  readonly source: Source
}

export interface AudioSettings {
  readonly format: { readonly sampleRate: number; readonly bitDepth: 16 | 24; readonly source: Source }
  readonly targets: Readonly<Record<TargetKind, ResolvedTarget>>
}

/**
 * Carried from the game jam these tools come from. Effects and loops put their loudest 400 ms at
 * -26 LUFS: low enough that sounds with up to about 24 dB between peak and loudness reach it under
 * the ceiling, so a gain in game data means the same for every sound. Voice lines sit at -20 LUFS
 * integrated. Nothing passes -1 dBTP.
 */
export const DEFAULT_TARGETS: Readonly<Record<TargetKind, { readonly measure: "integrated" | "momentary-max"; readonly lufs: number }>> = {
  effect: { measure: "momentary-max", lufs: -26 },
  loop: { measure: "momentary-max", lufs: -26 },
  voice: { measure: "integrated", lufs: -20 }
}
export const DEFAULT_TRUE_PEAK_DB = -1
export const DEFAULT_FORMAT = { sampleRate: 48000, bitDepth: 24 } as const

/** A result this far under digital full scale is a failed generation, not a quiet sound. */
export const NEAR_SILENT_DB = -45
/** How far a measured level may sit from its target and still count as on it, in LU. */
export const LEVEL_TOLERANCE = 0.5

export const resolveSettings = (facts: Facts["audio"], config: AudioConfig): AudioSettings => {
  const engineLoudness = facts?.loudness
  const target = (kind: TargetKind): ResolvedTarget => {
    const fallback = DEFAULT_TARGETS[kind]
    const fromEngine = engineLoudness?.targets?.[kind]
    const fromConfig = config.loudness?.[kind]
    const chosen = fromEngine ?? fromConfig
    // An engine that states one programme loudness means it for what is measured that way.
    const legacy = chosen === undefined && fallback.measure === "integrated" ? engineLoudness?.integratedLufs : undefined
    return {
      kind,
      measure: chosen?.measure ?? fallback.measure,
      lufs: chosen?.lufs ?? legacy ?? fallback.lufs,
      truePeakDb: chosen?.truePeakDb ?? engineLoudness?.truePeakDb ?? DEFAULT_TRUE_PEAK_DB,
      source: fromEngine !== undefined || legacy !== undefined ? "engine" : fromConfig !== undefined ? "config" : "default"
    }
  }
  const depth = facts?.bitDepth ?? config.format?.bitDepth
  const rate = facts?.sampleRate ?? config.format?.sampleRate
  return {
    format: {
      sampleRate: rate ?? DEFAULT_FORMAT.sampleRate,
      bitDepth: depth === 16 ? 16 : DEFAULT_FORMAT.bitDepth,
      source: facts?.sampleRate !== undefined || facts?.bitDepth !== undefined ? "engine" : config.format !== undefined ? "config" : "default"
    },
    targets: Object.fromEntries(TARGET_KINDS.map((kind) => [kind, target(kind)])) as Record<TargetKind, ResolvedTarget>
  }
}

/** The settings in force for this project. */
export const audioSettings: Effect.Effect<AudioSettings, ToolError, Engine | Config> = Effect.gen(function*() {
  const config = yield* (yield* Config).load
  const facts = (yield* (yield* Engine).resolved).facts
  return resolveSettings(facts.audio, config.audio)
})
