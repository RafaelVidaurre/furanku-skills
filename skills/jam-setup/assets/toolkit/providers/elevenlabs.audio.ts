// The audio adapter of the provider described by elevenlabs.json: it drives the official
// `elevenlabs` program (signed in with `elevenlabs auth login`, or with an API key in its
// environment). Everything that names this vendor's commands, flags, models and prices lives here.
// The API falls back to older models when none is named, so every request names one. Sources and
// dates: docs/providers/elevenlabs.md.
import * as Effect from "effect/Effect"
import type { AdapterIo, AudioAdapter, CallOutcome, SoundRequest, SpeechRequest, VoiceInfo } from "../src/jam/audio/AudioProvider.ts"
import { fail, type ToolError } from "../src/kernel/errors.ts"
import { isRecord } from "../src/kernel/hash.ts"
import type { RunResult } from "../src/kernel/Process.ts"

const SOUND_MODEL = "eleven_text_to_sound_v3"
const SPEECH_MODEL = "eleven_v4"
const OUTPUT_FORMAT = "wav_48000"
const TAG = /\[[^\]]*\]/g
const VOICE_DEFAULTS = { stability: 0.5, similarityBoost: 0.75 }
const GENERATION_TIMEOUT_MS = 600_000

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf8")
const unitInterval = (value: unknown): boolean => typeof value === "number" && value >= 0 && value <= 1
const modelOf = (settings: Readonly<Record<string, unknown>> | undefined, fallback: string): string => (typeof settings?.["model"] === "string" ? settings["model"] : fallback)

// The program prints API errors as JSON on standard output. An answer that names a request the
// service rejected (4xx: bad input, not signed in, quota, a stated wait) made nothing; anything
// else leaves the outcome unknown.
const REJECTED = /"status(?:_code)?"\s*:\s*"?4\d\d|\b4\d\d\b.*(?:error|bad request|unauthori[sz]ed|forbidden|not found|too many)|invalid_|quota_exceeded|unauthori[sz]ed|missing_permissions|not_found|too_many|rate.?limit|not (?:signed|logged) in|api key/i

const outcomeOf = (io: AdapterIo, result: RunResult): Effect.Effect<CallOutcome, ToolError> =>
  Effect.gen(function*() {
    const said = [text(result.stdout).trim(), result.stderr.trim()].filter((part) => part !== "").join("\n").slice(-1500)
    if (result.code !== 0) {
      return REJECTED.test(said)
        ? { status: "refused", message: said }
        : { status: "lost", message: `the program exited ${result.code} without a recognisable answer: ${said || "(no output)"}` }
    }
    const audio = yield* io.output.read
    if (audio === null || audio.length === 0) return { status: "lost", message: `the program exited 0 but wrote no audio: ${said || "(no output)"}` }
    const id = /"?request[-_]id"?\s*[:=]\s*"?([A-Za-z0-9_-]+)/i.exec(said)?.[1] ?? null
    return { status: "ok", audio, extension: "wav", providerJob: id }
  })

const json = (io: AdapterIo, args: ReadonlyArray<string>): Effect.Effect<unknown, ToolError> =>
  Effect.flatMap(io.run([...args, "--format", "json"]), (result) => {
    const out = text(result.stdout).trim()
    if (result.code !== 0) return fail("unavailable", `elevenlabs ${args.slice(0, 2).join(" ")} failed: ${(out || result.stderr.trim()).slice(-600)}`, { fix: "sign in with `elevenlabs auth login`, then try again" })
    return Effect.try({ try: () => JSON.parse(out) as unknown, catch: () => new Error("not JSON") }).pipe(
      Effect.catch(() => fail("malformed", `elevenlabs ${args.slice(0, 2).join(" ")} did not print JSON: ${out.slice(0, 200)}`))
    )
  })

const voiceOf = (raw: unknown): VoiceInfo | null =>
  isRecord(raw) && typeof raw["voice_id"] === "string"
    ? {
      id: raw["voice_id"],
      name: typeof raw["name"] === "string" ? raw["name"] : raw["voice_id"],
      ...(typeof raw["category"] === "string" ? { category: raw["category"] } : {}),
      ...(typeof raw["description"] === "string" ? { description: raw["description"] } : {}),
      ...(isRecord(raw["labels"]) ? { labels: raw["labels"] } : {}),
      ...(typeof raw["preview_url"] === "string" ? { preview: raw["preview_url"] } : {})
    }
    : null

const soundSettings = (request: SoundRequest) => ({
  model_id: modelOf(request.settings, SOUND_MODEL),
  duration_seconds: request.duration ?? null,
  prompt_influence: typeof request.settings["influence"] === "number" ? request.settings["influence"] : null,
  loop: request.loop,
  output_format: OUTPUT_FORMAT
})

const speechSettings = (request: SpeechRequest) => {
  const settings = { ...VOICE_DEFAULTS, ...request.voice.settings } as Record<string, unknown>
  return {
    model_id: modelOf(request.voice.settings, SPEECH_MODEL),
    voice_id: request.voice.id,
    voice_settings: { stability: settings["stability"], similarity_boost: settings["similarityBoost"] },
    output_format: OUTPUT_FORMAT
  }
}

export const adapter: AudioAdapter = {
  sound: {
    model: SOUND_MODEL,
    problems: (request) => [
      ...(request.duration !== undefined && !(request.duration >= 0.5 && request.duration <= 30) ? ["--duration must be 0.5 to 30 seconds"] : []),
      ...Object.entries(request.settings).flatMap(([key, value]) =>
        key === "influence"
          ? (unitInterval(value) ? [] : ["--setting influence must be a number from 0 to 1"])
          : key === "model"
          ? (typeof value === "string" ? [] : ["--setting model must be a model id"])
          : [`--setting ${key} is not a sound setting of this provider (use influence, model)`])
    ],
    // Upper bound: billed per second when a duration is set, per generation otherwise.
    estimate: (request) => ({
      amount: Math.max(200, Math.ceil(40 * (request.duration ?? 0))),
      basis: "list price: 40 credits per second when a duration is set, 200 per generation otherwise, whichever is more (provider pricing pages, read 2026-11-15)",
      kind: "list"
    }),
    describe: (request) => ({ operation: "text to sound effect", text: request.prompt, ...soundSettings(request) }),
    generate: (io, request) => {
      const sent = soundSettings(request)
      return Effect.flatMap(
        io.run([
          "text-to-sound-effects", "convert", "--text", request.prompt, "--model-id", sent.model_id, "--output-format", OUTPUT_FORMAT,
          ...(sent.duration_seconds === null ? [] : ["--duration-seconds", String(sent.duration_seconds)]),
          ...(sent.prompt_influence === null ? [] : ["--prompt-influence", String(sent.prompt_influence)]),
          ...(request.loop ? ["--loop", "true"] : []),
          "--output", io.output.path
        ], { timeoutMs: GENERATION_TIMEOUT_MS }),
        (result) => outcomeOf(io, result)
      )
    }
  },

  voice: {
    model: SPEECH_MODEL,
    // A performance is the authored text with [audio tags]; these are its spoken words.
    spokenWords: (markup) => markup.replace(TAG, " "),
    settingProblems: (settings) =>
      Object.entries(settings).flatMap(([key, value]) =>
        key === "model"
          ? (typeof value === "string" ? [] : ["model must be a model id"])
          : key in VOICE_DEFAULTS
          ? (unitInterval(value) ? [] : [`${key} must be a number from 0 to 1`])
          : [`${key} is not a voice setting of this provider (use ${Object.keys(VOICE_DEFAULTS).join(", ")}, model)`]),
    // Upper bound: speech is billed per character.
    estimate: (request) => ({ amount: request.text.length, basis: "list price: at most 1 credit per character of the text sent (provider pricing pages, read 2026-11-15)", kind: "list" }),
    describe: (request) => ({ operation: "text to speech", text: request.text, language: request.language, ...speechSettings(request) }),
    // The speech model rejects a seed, so takes are not repeatable: keep the ones worth keeping.
    speak: (io, request) => {
      const sent = speechSettings(request)
      return Effect.flatMap(
        io.run([
          "text-to-speech", "convert", "--voice-id", sent.voice_id, "--text", request.text, "--model-id", sent.model_id, "--output-format", OUTPUT_FORMAT,
          "--voice-settings", JSON.stringify(sent.voice_settings), "--output", io.output.path
        ], { timeoutMs: GENERATION_TIMEOUT_MS }),
        (result) => outcomeOf(io, result)
      )
    },
    voices: (io, search) =>
      Effect.gen(function*() {
        const rows: Array<VoiceInfo> = []
        let token: string | undefined
        do {
          const page = yield* json(io, ["voices", "search", "--page-size", "100", ...(search === undefined ? [] : ["--search", search]), ...(token === undefined ? [] : ["--next-page-token", token])])
          if (!isRecord(page) || !Array.isArray(page["voices"])) return yield* fail("malformed", "elevenlabs voices search did not return a list of voices")
          for (const raw of page["voices"]) {
            const voice = voiceOf(raw)
            if (voice !== null) rows.push(voice)
          }
          token = page["has_more"] === true && typeof page["next_page_token"] === "string" ? page["next_page_token"] : undefined
        } while (token !== undefined)
        return rows
      }),
    voice: (io, id) =>
      Effect.flatMap(json(io, ["voices", "get", "--voice-id", id]), (raw) => {
        const voice = voiceOf(raw)
        return voice === null ? fail("not_found", `the provider has no voice ${id}`, { fix: `list voices with "jam audio voice voices"` }) : Effect.succeed(voice)
      }),
    links: {
      "design a new voice": "https://elevenlabs.io/app/voice-lab?create=true&creationType=voiceDesign",
      "your voices": "https://elevenlabs.io/app/voice-lab",
      "voice library": "https://elevenlabs.io/app/voice-library"
    }
  },

  account: (io) =>
    json(io, ["user", "subscription", "get"]).pipe(
      Effect.map((raw) => {
        const tier = isRecord(raw) && typeof raw["tier"] === "string" ? raw["tier"] : null
        return {
          used: isRecord(raw) && typeof raw["character_count"] === "number" ? raw["character_count"] : null,
          license: tier === null
            ? null
            : tier === "free"
            ? "ElevenLabs free plan: no commercial license; non-commercial use must credit elevenlabs.io"
            : `ElevenLabs ${tier} plan: paid plans include a commercial license except for beta services; confirm before distribution`
        }
      }),
      Effect.catch(() => Effect.succeed({ used: null, license: null }))
    )
}
