// Fixtures for the audio tests: sounds synthesised in memory, a project wired to a stand-in
// provider program and a stand-in aligner (small Node scripts written into the temporary project),
// so no test reaches a real provider, spends anything, or downloads a model.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Pcm } from "../../src/jam/audio/signal.ts"
import { writeWav } from "../../src/jam/audio/wav.ts"
import { jamProject } from "./fixtures.ts"

export const RATE = 48000

/** Why ffmpeg-dependent tests are skipped, or false when ffmpeg runs here. */
export const NO_FFMPEG: string | false = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0
  ? false
  : "ffmpeg is not installed on this machine: install it to run the audio processing tests"

const samples = (seconds: number, rate = RATE): Float32Array => new Float32Array(Math.round(seconds * rate))

export const silence = (seconds: number, rate = RATE): Float32Array => samples(seconds, rate)

/** A steady sine. `peakDb` is its peak level in dBFS. */
export const tone = (seconds: number, frequency = 997, peakDb = -20, rate = RATE): Float32Array => {
  const out = samples(seconds, rate)
  const amplitude = 10 ** (peakDb / 20)
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / rate)
  return out
}

/** A struck sound: an instant attack and an exponential tail that rings for `seconds`. */
export const hit = (seconds: number, options: { readonly frequency?: number; readonly peakDb?: number; readonly decay?: number; readonly rate?: number } = {}): Float32Array => {
  const { frequency = 440, peakDb = -6, decay = 12, rate = RATE } = options
  const out = samples(seconds, rate)
  const amplitude = 10 ** (peakDb / 20)
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.exp(-decay * i / rate) * Math.sin(2 * Math.PI * frequency * i / rate)
  return out
}

/** Speech-like: a carrier whose loudness swells and dips a few times a second. */
export const speech = (seconds: number, peakDb = -12, rate = RATE): Float32Array => {
  const out = samples(seconds, rate)
  const amplitude = 10 ** (peakDb / 20)
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    out[i] = amplitude * (0.55 + 0.45 * Math.sin(2 * Math.PI * 3.1 * t)) * (0.7 * Math.sin(2 * Math.PI * 180 * t) + 0.3 * Math.sin(2 * Math.PI * 1260 * t))
  }
  return out
}

export const join_ = (...parts: ReadonlyArray<Float32Array>): Float32Array => {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Steady low noise, the same every run, so a recording has a floor to settle into. */
export const hiss = (duration: number, levelDb = -70): Float32Array => {
  const out = new Float32Array(Math.round(duration * RATE))
  const amplitude = 10 ** (levelDb / 20)
  let state = 12345
  for (let i = 0; i < out.length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    out[i] = amplitude * (state / 0x3fffffff - 1)
  }
  return out
}
export const over = (base: Float32Array, added: Float32Array, at: number): Float32Array => {
  const out = base.slice()
  const start = Math.round(at * RATE)
  for (let i = 0; i < added.length && start + i < out.length; i++) out[start + i] = out[start + i]! + added[i]!
  return out
}
/** A recording: hiss throughout, with sounds laid over it at given times. */
export const recording = (duration: number, ...sounds: ReadonlyArray<readonly [number, Float32Array]>): Float32Array =>
  sounds.reduce((mix, [at, sound]) => over(mix, sound, at), hiss(duration))
export const pcmOf = (channel: Float32Array, rate = RATE): Pcm => ({ rate, channels: [channel] })

export const wavOf = (channel: Float32Array, rate = RATE, bitDepth: 16 | 24 = 16): Uint8Array => writeWav(pcmOf(channel, rate), bitDepth)

/**
 * A stand-in for the sound and voice provider's program. It answers the commands the shipped
 * adapter sends, writes synthetic audio, keeps a usage counter in a file beside it, and logs
 * every call. Words in the text steer it: LOSE (dies without an answer), LATER (answers its first
 * request, then dies on every one after), REFUSE (answers with a stated wait), SILENT (returns
 * near-silence), TWO (two hits in one sound).
 */
const PROVIDER = String.raw`
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const here = dirname(fileURLToPath(import.meta.url))
const stateFile = join(here, "provider-state.json")
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { used: 1000, requests: 0 }
const save = () => writeFileSync(stateFile, JSON.stringify(state))
const args = process.argv.slice(2)
appendFileSync(join(here, "provider-calls.jsonl"), JSON.stringify(args) + "\n")
const value = (flag) => { const at = args.indexOf(flag); return at === -1 ? undefined : args[at + 1] }
const RATE = 48000
const wav = (channel) => {
  const out = Buffer.alloc(44 + channel.length * 2)
  out.write("RIFF", 0, "latin1"); out.writeUInt32LE(36 + channel.length * 2, 4); out.write("WAVEfmt ", 8, "latin1")
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 2, 28)
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36, "latin1"); out.writeUInt32LE(channel.length * 2, 40)
  channel.forEach((sample, i) => out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2))
  return out
}
const fill = (seconds, at) => Array.from({ length: Math.round(seconds * RATE) }, (_, i) => at(i / RATE))
const hit = (seconds, frequency) => fill(seconds, (t) => 0.5 * Math.exp(-12 * t) * Math.sin(2 * Math.PI * frequency * t))
const quiet = (seconds) => fill(seconds, () => 0)
const refuse = (text) => ((/LATER/.test(text) ? state.requests > 0 : /LOSE/.test(text)) ? (console.error("socket hang up"), process.exit(1)) : /REFUSE/.test(text)
  ? (console.log(JSON.stringify({ status_code: 429, detail: { status: "too_many_concurrent_requests", message: "Too many requests. Retry after 37 seconds." } })), process.exit(1)) : null)

if (args[0] === "--version") console.log("stand-in provider 1.0")
else if (args[0] === "user") console.log(JSON.stringify({ tier: "creator", character_count: state.used }))
else if (args[0] === "voices" && args[1] === "search") {
  const all = [{ voice_id: "v-gravel", name: "Gravel", category: "premade", description: "Low and rough", preview_url: "https://example.invalid/gravel.mp3" }, { voice_id: "v-bright", name: "Bright", category: "generated" }]
  const search = value("--search")
  console.log(JSON.stringify({ voices: all.filter((voice) => search === undefined || voice.name.toLowerCase().includes(search.toLowerCase())), has_more: false }))
} else if (args[0] === "voices" && args[1] === "get") {
  const id = value("--voice-id")
  if (!id.startsWith("v-")) { console.log(JSON.stringify({ status_code: 404, detail: { status: "voice_not_found" } })); process.exit(1) }
  console.log(JSON.stringify({ voice_id: id, name: id === "v-gravel" ? "Gravel" : "Bright" }))
} else if (args[0] === "text-to-sound-effects") {
  const text = value("--text")
  refuse(text)
  state.requests++
  // Charged less than the list price, so a test can tell the actual charge from the estimate.
  state.used += 150
  save()
  const sound = /SILENT/.test(text) ? fill(1, (t) => 0.0005 * Math.sin(2 * Math.PI * 300 * t))
    : /TWO/.test(text) ? [...quiet(0.2), ...hit(0.5, 330), ...quiet(0.4), ...hit(0.5, 520), ...quiet(0.3)]
    : [...quiet(0.25), ...hit(0.6, 300 + 40 * state.requests), ...quiet(0.35)]
  writeFileSync(value("--output"), wav(sound))
  console.log(JSON.stringify({ request_id: "req_" + state.requests }))
} else if (args[0] === "text-to-speech") {
  const text = value("--text")
  refuse(text)
  state.requests++
  state.used += text.length
  save()
  const seconds = Math.max(1.2, text.length * 0.06)
  writeFileSync(value("--output"), wav([...quiet(0.3), ...fill(seconds, (t) => 0.25 * (0.55 + 0.45 * Math.sin(2 * Math.PI * 3.1 * t)) * (0.7 * Math.sin(2 * Math.PI * 180 * t) + 0.3 * Math.sin(2 * Math.PI * 1260 * t))), ...quiet(0.3)]))
} else { console.error("stand-in provider: unknown command " + args.join(" ")); process.exit(2) }
`

/**
 * A stand-in for the transcript aligner. It "hears" each line's own text unless
 * tools/heard.json maps the text to something else, and spreads the words over the file.
 */
const ALIGNER = String.raw`
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const here = dirname(fileURLToPath(import.meta.url))
if (process.argv.includes("--check")) { console.log(JSON.stringify({ available: true, tool: "stand-in aligner" })); process.exit(0) }
const request = JSON.parse(readFileSync(0, "utf8"))
const heard = existsSync(join(here, "heard.json")) ? JSON.parse(readFileSync(join(here, "heard.json"), "utf8")) : {}
const words = (text, same) => text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean).map((word) => same[word] ?? word)
console.log(JSON.stringify({ results: request.items.map((item) => {
  const duration = (statSync(item.file).size - 44) / (48000 * 3)
  const authored = item.text.split(/\s+/).filter(Boolean)
  const transcript = heard[item.text] ?? item.text
  const same = request.homophones[item.language] ?? {}
  const a = words(item.text, same), b = words(transcript, same)
  const wrong = Math.max(a.length, b.length) - a.filter((word, index) => b[index] === word).length
  return { alignment: "forced", duration, transcript, mismatch: wrong > 0, wordErrorRate: wrong / Math.max(1, a.length),
    words: authored.map((word, index) => ({ word, start: duration * index / authored.length, end: duration * (index + 1) / authored.length })) }
}) }))
`

/** An aligner whose environment is not installed. */
const ALIGNER_ABSENT = `console.log(JSON.stringify({ available: false, missing: ["torch", "torchaudio"] }))\n`

export const PROVIDER_ID = "elevenlabs"
export const STANDING = "Sam 2026-11-16: up to 1000 credits a run, decide within it and report after"

export interface AudioProject {
  /** Fields merged over the audio test configuration (shallow). */
  readonly config?: Readonly<Record<string, unknown>>
  readonly files?: Readonly<Record<string, string | Uint8Array>>
  /** installed: the stand-in aligner. absent: its environment is missing. */
  readonly aligner?: "installed" | "absent"
  /** Fields merged over jam.local.json. */
  readonly local?: Readonly<Record<string, unknown>>
  readonly git?: boolean
}

/** A project routed to the stand-in provider, with spending allowed under a standing authorization. */
export const audioProject = (options: AudioProject = {}): string =>
  jamProject({
    git: options.git ?? false,
    config: {
      routes: { sound: PROVIDER_ID, voice: PROVIDER_ID },
      spend: { [PROVIDER_ID]: { perRun: 1000, total: 5000, standing: STANDING } },
      ...options.config
    },
    files: {
      "tools/provider.mjs": PROVIDER,
      "tools/aligner.mjs": options.aligner === "absent" ? ALIGNER_ABSENT : ALIGNER,
      "jam.local.json": JSON.stringify({ providers: { [PROVIDER_ID]: "tools/provider.mjs" }, aligner: ["node", "tools/aligner.mjs"], ...options.local }),
      ...options.files
    }
  })

/** Every call the stand-in provider received, as its argument lists. */
export const providerCalls = (root: string): ReadonlyArray<ReadonlyArray<string>> => {
  const file = join(root, "tools/provider-calls.jsonl")
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as ReadonlyArray<string>) : []
}

/** The paid calls among them. */
export const paidCalls = (root: string): ReadonlyArray<ReadonlyArray<string>> => providerCalls(root).filter((call) => call[0]?.startsWith("text-to-") === true)

export const bytesOf = (root: string, path: string): Uint8Array => readFileSync(join(root, ...path.split("/")))
