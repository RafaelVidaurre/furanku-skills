// The transcript and word-timing check for voiced lines: forced alignment of the authored words to
// the audio, and an independent transcription compared with the text. It runs in an optional
// Python environment; where that is not installed, the check is unavailable and says how to install it.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as nodePath from "node:path"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { Executables } from "../../kernel/Executable.ts"
import { isRecord } from "../../kernel/hash.ts"
import { Process } from "../../kernel/Process.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Config } from "../config/Config.ts"
import { LOCAL_FILE } from "../layout.ts"
import { Toolkit } from "../Toolkit.ts"
import type { Word } from "./schema.ts"

const SCRIPT = "scripts/audio/align.py"
const REQUIREMENTS = "scripts/audio/requirements.txt"
const HOMOPHONES = "scripts/audio/homophones"

export type Availability =
  | { readonly available: true; readonly tool: string }
  | { readonly available: false; readonly reason: string; readonly install: string }

export interface AlignItem {
  /** Project path of the processed take. */
  readonly file: string
  readonly text: string
  readonly language: string
}

export interface Alignment {
  readonly words: ReadonlyArray<Word> | null
  /** forced: aligned to the audio. proportional: the aligner failed and spread the words by length. */
  readonly alignment: "forced" | "proportional"
  readonly alignmentError?: string | undefined
  /** What an independent transcriber heard. */
  readonly heard: string
  readonly mismatch: boolean
  readonly wordErrorRate: number
  readonly tool: string
}

export class Aligner extends Context.Service<Aligner, {
  /** Whether the check can run on this machine. Never fails. */
  readonly availability: Effect.Effect<Availability>
  /** Align and transcribe a batch. Fails with `unavailable` when the environment is not installed. */
  align(items: ReadonlyArray<AlignItem>): Effect.Effect<ReadonlyArray<Alignment>, ToolError>
}>()("jam/audio/Aligner") {
  static readonly layerNoDeps: Layer.Layer<Aligner, never, Config | Process | ProjectFiles | Toolkit | Executables> = Layer.effect(
    Aligner,
    Effect.gen(function*() {
      const configs = yield* Config
      const proc = yield* Process
      const files = yield* ProjectFiles
      const toolkit = yield* Toolkit
      const executables = yield* Executables

      // Shown to a person, so the toolkit is named the way they would type it from the project.
      const shown = (relative: string): string => {
        const inProject = nodePath.relative(files.root, toolkit.path(relative)).split(nodePath.sep).join("/")
        return inProject.startsWith("..") || nodePath.isAbsolute(inProject) ? toolkit.path(relative) : inProject
      }
      const install = `jam python -m pip install -r ${shown(REQUIREMENTS)} (it downloads speech models on first use); a ready environment can be named under "aligner" in ${LOCAL_FILE}`

      const command: Effect.Effect<readonly [string, ReadonlyArray<string>], ToolError> = Effect.gen(function*() {
        const local = yield* configs.local
        const [first, ...rest] = local.aligner ?? ["python", toolkit.path(SCRIPT)]
        const program = first === "python" ? yield* configs.tool("python") : first === "node" ? executables.node : first
        return [program, rest] as const
      })

      const call = (extra: ReadonlyArray<string>, input: unknown, timeoutMs: number): Effect.Effect<unknown, ToolError> =>
        Effect.gen(function*() {
          const [program, args] = yield* command
          const result = yield* proc.run(program, [...args, ...extra], { cwd: files.root, input: JSON.stringify(input), timeoutMs })
          const out = Buffer.from(result.stdout).toString("utf8").trim()
          if (result.code !== 0) return yield* fail("unavailable", `the aligner exited ${result.code}: ${(result.stderr.trim() || out).split("\n").slice(-2).join(" ")}`)
          return yield* Effect.try({ try: () => JSON.parse(out) as unknown, catch: () => null }).pipe(
            Effect.catch(() => fail("unavailable", `the aligner did not print JSON: ${out.slice(0, 160) || "(nothing)"}`))
          )
        })

      const availability: Effect.Effect<Availability> = call(["--check"], {}, 120_000).pipe(
        Effect.map((answer): Availability =>
          isRecord(answer) && answer["available"] === true
            ? { available: true, tool: typeof answer["tool"] === "string" ? answer["tool"] : "aligner" }
            : { available: false, reason: isRecord(answer) && Array.isArray(answer["missing"]) ? `its Python environment lacks ${answer["missing"].join(", ")}` : "it answered without saying it is available", install }),
        Effect.catch((error) => Effect.succeed<Availability>({ available: false, reason: error.message, install }))
      )

      const homophones = (languages: ReadonlyArray<string>): Effect.Effect<Record<string, Record<string, string>>, ToolError> =>
        Effect.gen(function*() {
          const config = (yield* configs.load).audio
          const own = config.homophones === undefined ? {} : yield* files.readJson(config.homophones)
          const out: Record<string, Record<string, string>> = {}
          for (const language of new Set(languages)) {
            const base = language.split("-")[0]!.toLowerCase()
            const shipped = (yield* toolkit.exists(`${HOMOPHONES}/${base}.json`)) ? yield* toolkit.readJson(`${HOMOPHONES}/${base}.json`) : {}
            const merged: Record<string, string> = {}
            for (const source of [shipped, isRecord(own) ? own[base] : undefined, isRecord(own) ? own[language] : undefined]) {
              if (isRecord(source)) for (const [heard, written] of Object.entries(source)) if (typeof written === "string") merged[heard] = written
            }
            out[language] = merged
          }
          return out
        })

      // Timings are only kept when they are the authored words, in order, inside the recording.
      const wordsOf = (raw: unknown, text: string, duration: number): ReadonlyArray<Word> | null => {
        const expected = text.split(/\s+/).filter(Boolean)
        if (!Array.isArray(raw) || raw.length !== expected.length) return null
        let end = 0
        const out: Array<Word> = []
        for (const [index, entry] of raw.entries()) {
          if (!isRecord(entry) || entry["word"] !== expected[index] || typeof entry["start"] !== "number" || typeof entry["end"] !== "number") return null
          if (!(entry["start"] >= end - 1e-6 && entry["end"] > entry["start"] && entry["end"] <= duration + 0.01)) return null
          end = entry["end"]
          out.push({ word: entry["word"] as string, start: Number(entry["start"].toFixed(4)), end: Number(entry["end"].toFixed(4)) })
        }
        return out
      }

      return {
        availability,
        align: (items) =>
          Effect.gen(function*() {
            const state = yield* availability
            if (!state.available) return yield* fail("unavailable", `the transcript check cannot run here: ${state.reason}`, { fix: state.install })
            const resolved = yield* Effect.forEach(items, (item) => Effect.map(files.resolve(item.file), (file) => ({ ...item, file })))
            const answer = yield* call([], { items: resolved, homophones: yield* homophones(items.map((item) => item.language)) }, 1_800_000)
            const results = isRecord(answer) && Array.isArray(answer["results"]) ? answer["results"] : null
            if (results === null || results.length !== items.length) return yield* fail("malformed", "the aligner returned an incomplete batch")
            return results.map((raw, index): Alignment => {
              const entry = isRecord(raw) ? raw : {}
              const duration = typeof entry["duration"] === "number" ? entry["duration"] : Infinity
              const words = wordsOf(entry["words"], items[index]!.text, duration)
              const failed = typeof entry["alignmentError"] === "string" ? entry["alignmentError"] : words === null ? "the aligner returned word timings that are not the authored words in order" : undefined
              return {
                words,
                alignment: entry["alignment"] === "forced" && words !== null ? "forced" : "proportional",
                ...(failed === undefined ? {} : { alignmentError: failed }),
                heard: typeof entry["transcript"] === "string" ? entry["transcript"] : "",
                mismatch: entry["mismatch"] !== false,
                wordErrorRate: typeof entry["wordErrorRate"] === "number" ? Number(entry["wordErrorRate"].toFixed(4)) : 1,
                tool: state.tool
              }
            })
          })
      }
    })
  )
}
