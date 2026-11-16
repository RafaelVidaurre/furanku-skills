// The one place ffmpeg is run: decoding any audio file to samples, filtering, EBU R 128
// measurement, and the waveform picture. The program comes from jam.local.json, else PATH.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { attempt, fail, type ToolError, toolError } from "../../kernel/errors.ts"
import { Process, type RunResult } from "../../kernel/Process.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Config } from "../config/Config.ts"
import { LOCAL_FILE } from "../layout.ts"
import { frames, type Pcm } from "./signal.ts"
import { readWav, wavInfo } from "./wav.ts"

export interface DecodeOptions {
  /** Resample to this rate (default: the file's own). */
  readonly rate?: number | undefined
  /** Mix to this many channels (default: the file's own). */
  readonly channels?: number | undefined
}

export interface Loudness {
  /** Programme loudness in LUFS; null when the audio is too short or too quiet to pass the gate. */
  readonly integrated: number | null
  /** Loudness range in LU. */
  readonly range: number | null
  /** True peak in dBTP; null for digital silence. */
  readonly truePeak: number | null
}

export interface Probe {
  readonly channels: number
  readonly sampleRate: number
  readonly duration: number
  /** Bits per sample of a WAV file; null for other containers. */
  readonly bitDepth: number | null
}

export interface Span {
  readonly start: number
  readonly end: number
}

export const FFMPEG_FIX = `install ffmpeg (ffmpeg.org, or your package manager), or set "ffmpeg" in ${LOCAL_FILE} to its path; "jam doctor" shows what was found`

export class Ffmpeg extends Context.Service<Ffmpeg, {
  /** The version line. Fails with `unavailable` and how to install it when ffmpeg cannot run. */
  readonly version: Effect.Effect<string, ToolError>
  /** Decode a project audio file of any format to samples. */
  decode(path: string, options?: DecodeOptions): Effect.Effect<Pcm, ToolError>
  /** Channel count, sample rate and duration of a project audio file. */
  probe(path: string): Effect.Effect<Probe, ToolError>
  /** Pass WAV bytes through an ffmpeg audio filter chain, e.g. `highpass=f=80`. */
  filter(wav: Uint8Array, chain: string): Effect.Effect<Pcm, ToolError>
  /** Measure WAV bytes with the ebur128 filter. */
  loudness(wav: Uint8Array): Effect.Effect<Loudness, ToolError>
  /** Draw a file's waveform as a PNG with the given spans (seconds) shaded, and return its bytes. */
  waveform(path: string, spans: ReadonlyArray<Span>): Effect.Effect<Uint8Array, ToolError>
}>()("jam/audio/Ffmpeg") {
  static readonly layerNoDeps: Layer.Layer<Ffmpeg, never, Config | Process | ProjectFiles> = Layer.effect(
    Ffmpeg,
    Effect.gen(function*() {
      const configs = yield* Config
      const proc = yield* Process
      const files = yield* ProjectFiles

      const run = (args: ReadonlyArray<string>, input?: Uint8Array): Effect.Effect<RunResult, ToolError> =>
        Effect.flatMap(configs.tool("ffmpeg"), (command) =>
          proc.run(command, args, { cwd: files.root, timeoutMs: 300_000, ...(input === undefined ? {} : { input }) }).pipe(
            Effect.mapError((error) => toolError("unavailable", `ffmpeg cannot run: ${error.message}`, { fix: FFMPEG_FIX }))
          ))

      const ok = (what: string, result: RunResult): Effect.Effect<RunResult, ToolError> =>
        result.code === 0
          ? Effect.succeed(result)
          : fail("malformed", `ffmpeg could not ${what}: ${result.stderr.trim().split("\n").slice(-3).join(" ") || `exit ${result.code}`}`)

      const conversion = (options: DecodeOptions): ReadonlyArray<string> => [
        ...(options.rate === undefined ? [] : ["-ar", String(options.rate)]),
        ...(options.channels === undefined ? [] : ["-ac", String(options.channels)])
      ]
      const AS_FLOAT_WAV = ["-f", "wav", "-c:a", "pcm_f32le", "pipe:1"]

      const decode = (path: string, options: DecodeOptions = {}): Effect.Effect<Pcm, ToolError> =>
        Effect.gen(function*() {
          const source = yield* files.resolve(path)
          if ((yield* files.stat(path))?.kind !== "file") return yield* fail("not_found", `${path} does not exist`)
          const result = yield* Effect.flatMap(run(["-v", "error", "-i", source, "-map", "0:a:0", "-vn", ...conversion(options), ...AS_FLOAT_WAV]), (done) => ok(`decode ${path}`, done))
          const pcm = yield* attempt(`read ${path}`, () => readWav(result.stdout, path), "malformed")
          if (frames(pcm) === 0) return yield* fail("malformed", `${path} holds no audio`)
          return pcm
        })

      const number = (text: string | undefined): number | null => (text === undefined || /inf|nan/i.test(text) ? null : Number(text))

      return {
        version: Effect.flatMap(run(["-version"]), (result) =>
          result.code === 0
            ? Effect.succeed(Buffer.from(result.stdout).toString("utf8").split(/\r?\n/)[0]!.trim())
            : fail("unavailable", `ffmpeg -version exited ${result.code}`, { fix: FFMPEG_FIX })),
        decode,
        probe: (path) =>
          Effect.gen(function*() {
            const header = yield* Effect.flatMap(files.readBytes(path), (bytes) => attempt("read the header", () => wavInfo(bytes, path), "malformed")).pipe(
              Effect.catch(() => Effect.succeed(null))
            )
            if (header !== null) {
              const frameBytes = header.channels * (header.bitDepth / 8)
              return { channels: header.channels, sampleRate: header.sampleRate, duration: (header.dataEnd - header.dataStart) / frameBytes / header.sampleRate, bitDepth: header.bitDepth }
            }
            const pcm = yield* decode(path)
            return { channels: pcm.channels.length, sampleRate: pcm.rate, duration: frames(pcm) / pcm.rate, bitDepth: null }
          }),
        filter: (wav, chain) =>
          Effect.gen(function*() {
            const result = yield* Effect.flatMap(run(["-v", "error", "-f", "wav", "-i", "pipe:0", "-af", chain, ...AS_FLOAT_WAV], wav), (done) => ok(`apply the filter ${chain}`, done))
            return yield* attempt("read the filtered audio", () => readWav(result.stdout, "the filtered audio"), "malformed")
          }),
        loudness: (wav) =>
          Effect.gen(function*() {
            // Per-block values go to standard output with three decimals; the summary on standard
            // error has one, and is the only source for audio shorter than a block.
            const result = yield* Effect.flatMap(
              run(["-hide_banner", "-nostats", "-f", "wav", "-i", "pipe:0", "-map", "0:a:0", "-af", "ebur128=peak=true:metadata=1,ametadata=mode=print:file=-", "-f", "null", "-"], wav),
              (done) => ok("measure loudness", done)
            )
            const summary = result.stderr.slice(Math.max(0, result.stderr.lastIndexOf("Summary:")))
            const summaryIntegrated = number(/\bI:\s+(-?inf|nan|[-+\d.]+)\s+LUFS/i.exec(summary)?.[1])
            const summaryPeak = number(/True peak:[\s\S]*?Peak:\s+(-?inf|nan|[-+\d.]+)\s+dBFS/i.exec(summary)?.[1])
            if (!summary.startsWith("Summary:")) return yield* fail("malformed", "ffmpeg's ebur128 filter printed no summary; this ffmpeg build may lack it", { fix: FFMPEG_FIX })
            let integrated = summaryIntegrated
            let linearPeak = 0
            for (const line of Buffer.from(result.stdout).toString("utf8").split(/\r?\n/)) {
              const at = line.indexOf("=")
              if (at === -1) continue
              const value = Number(line.slice(at + 1))
              if (!Number.isFinite(value)) continue
              const key = line.slice(0, at)
              if (key === "lavfi.r128.I") integrated = value
              else if (key.startsWith("lavfi.r128.true_peak")) linearPeak = Math.max(linearPeak, value)
            }
            // The blocks miss a tail shorter than one block and lose precision on quiet audio; the
            // summary covers everything, so the finer figure is used only when the two agree.
            const blockPeak = linearPeak >= 0.1 ? 20 * Math.log10(linearPeak) : null
            const truePeak = summaryPeak !== null && blockPeak !== null && Math.abs(blockPeak - summaryPeak) <= 0.06 ? blockPeak : summaryPeak
            return {
              integrated: integrated === null || integrated <= -70 ? null : integrated,
              range: number(/\bLRA:\s+(-?inf|nan|[-+\d.]+)\s+LU\b/i.exec(summary)?.[1]),
              truePeak
            }
          }),
        waveform: (path, spans) =>
          Effect.gen(function*() {
            const source = yield* files.resolve(path)
            const pcm = yield* decode(path)
            const width = 1600
            const height = 300
            const total = frames(pcm) / pcm.rate
            const boxes = spans.map((span) =>
              `drawbox=x=${Math.round(span.start / total * width)}:y=0:w=${Math.max(1, Math.round((span.end - span.start) / total * width))}:h=${height}:color=orange@0.35:t=fill`)
            const graph = `[0:a]showwavespic=s=${width}x${height}:colors=0x203040[w];[1:v][w]overlay=format=auto${boxes.length > 0 ? `,${boxes.join(",")}` : ""}`
            const result = yield* Effect.flatMap(
              run(["-v", "error", "-i", source, "-f", "lavfi", "-i", `color=c=white:s=${width}x${height}`, "-filter_complex", graph, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"]),
              (done) => ok(`draw the waveform of ${path}`, done)
            )
            return result.stdout
          })
      }
    })
  )
}
