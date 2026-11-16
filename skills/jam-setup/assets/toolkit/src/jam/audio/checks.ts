// The two checks audio supplies to recipes. `loudness`: every processed file of the record is at
// its kind's target, under the true-peak ceiling, in the project's format. `transcript-match`:
// every voiced line says its current text, by an independent transcription or, where that cannot
// run, by a person's recorded acceptance. Neither ever passes for want of a tool.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { ToolError } from "../../kernel/errors.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { type Check, type CheckInput, ExtraChecks } from "../checks/Checks.ts"
import type { Problem } from "../common.ts"
import { Config } from "../config/Config.ts"
import { Engine } from "../engine/Engine.ts"
import { kindOf } from "../runs/media.ts"
import { Aligner } from "./Aligner.ts"
import { loudnessBy, measureWav } from "./chain.ts"
import { Ffmpeg } from "./Ffmpeg.ts"
import { loadDialogue } from "./lines.ts"
import { audioSettings, LEVEL_TOLERANCE } from "./targets.ts"
import { ownerOf } from "./units.ts"

type Services = Ffmpeg | Aligner | Config | Engine | ProjectFiles

const audioFiles = (input: CheckInput) => input.record.files.filter((file) => kindOf(file.path) === "audio")

const again = (id: string): string => (id.startsWith("voice/") ? `jam audio voice process ${id.slice("voice/".length)}` : `jam audio sfx reprocess ${id.slice("sfx/".length)}`)

const loudness = (input: CheckInput): Effect.Effect<ReadonlyArray<Problem>, ToolError, Services> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const settings = yield* audioSettings
    const problems: Array<Problem> = []
    const recorded = audioFiles(input)
    if (recorded.length === 0) return [{ message: `step ${input.step.id} records no audio file to measure`, fix: "record the processed WAV files" }]
    for (const file of recorded) {
      const owner = yield* ownerOf(file.path)
      const entry = owner?.take ?? owner?.variant
      if (owner === null || entry === undefined) {
        problems.push({ message: `${file.path} is not a processed take or variant of a sound or line`, fix: `processed files come from the audio tools: add a file with "jam audio sfx add <name> --file <audio>" and record the take it writes` })
        continue
      }
      const target = settings.targets[owner.unit.target]
      if (entry.level.reference !== target.lufs || entry.level.ceiling !== target.truePeakDb) {
        problems.push({ message: `${file.path} was processed for ${entry.level.reference} LUFS under ${entry.level.ceiling} dBTP; the ${target.kind} target is now ${target.lufs} LUFS under ${target.truePeakDb} dBTP`, fix: again(owner.unit.id) })
        continue
      }
      const measured = yield* Effect.flatMap(files.readBytes(file.path), (bytes) => measureWav(bytes, file.path)).pipe(
        Effect.map((facts) => ({ facts, problem: null as Problem | null })),
        Effect.catch((error) => Effect.succeed({ facts: null, problem: { message: `${file.path} could not be measured: ${error.message}`, fix: error.fix } as Problem }))
      )
      if (measured.facts === null) {
        problems.push(measured.problem!)
        continue
      }
      const facts = measured.facts
      const { loud } = loudnessBy(facts, entry.level.measure)
      if (facts.sampleRate !== settings.format.sampleRate || facts.bitDepth !== settings.format.bitDepth) {
        problems.push({ message: `${file.path} is ${facts.sampleRate} Hz ${facts.bitDepth}-bit; the project's audio is ${settings.format.sampleRate} Hz ${settings.format.bitDepth}-bit`, fix: again(owner.unit.id) })
      }
      if (facts.truePeakDb !== null && facts.truePeakDb > target.truePeakDb + 0.1) {
        problems.push({ message: `${file.path} peaks at ${facts.truePeakDb} dBTP, over the ceiling of ${target.truePeakDb}`, fix: again(owner.unit.id) })
      }
      if (loud > target.lufs + LEVEL_TOLERANCE) {
        problems.push({ message: `${file.path} measures ${loud} LUFS (${entry.level.measure}), over the ${target.kind} target of ${target.lufs}`, fix: again(owner.unit.id) })
      } else if (loud < target.lufs - LEVEL_TOLERANCE && (entry.level.limitedBy === undefined || Math.abs(loud - entry.level.level) > LEVEL_TOLERANCE)) {
        // Under the target is right only where the record says a peak holds it there.
        problems.push({ message: `${file.path} measures ${loud} LUFS (${entry.level.measure}), under the ${target.kind} target of ${target.lufs}`, fix: again(owner.unit.id) })
      }
    }
    return problems
  })

const transcriptMatch = (input: CheckInput): Effect.Effect<ReadonlyArray<Problem>, ToolError, Services> =>
  Effect.gen(function*() {
    const aligner = yield* Aligner
    const dialogue = yield* loadDialogue
    const problems: Array<Problem> = []
    const recorded = audioFiles(input)
    if (recorded.length === 0) return [{ message: `step ${input.step.id} records no voiced line`, fix: `record the processed lines: jam audio voice process --run ${input.context.ref.run.id}` }]
    let availability: Effect.Success<typeof aligner.availability> | undefined
    for (const file of recorded) {
      const owner = yield* ownerOf(file.path)
      const take = owner?.take
      if (owner === null || take === undefined || owner.unit.kind !== "voice" || owner.unit.line === undefined) {
        problems.push({ message: `${file.path} is not a take of a voiced line`, fix: `voiced lines come from "jam audio voice speak" or "jam audio voice process <line> --file <recording>"` })
        continue
      }
      const ref = `${owner.unit.line.script}/${owner.unit.line.id}`
      const line = dialogue.lines.find((candidate) => candidate.ref === ref)
      if (line === undefined) {
        problems.push({ message: `${file.path} voices ${ref}, which is no longer in the lines files`, fix: "restore the line, or leave this file out of the record" })
        continue
      }
      if (take.textHash !== line.textHash) {
        problems.push({ message: `${ref}: its text changed after take ${take.n} was voiced`, fix: `voice it again: jam audio voice speak ${ref} --run ${input.context.ref.run.id}` })
        continue
      }
      const transcript = take.transcript
      if (transcript?.status === "match" || transcript?.status === "by-ear") continue
      if (transcript?.status === "mismatch") {
        problems.push({
          message: `${ref}: take ${take.n} does not say its text; the transcriber heard ${JSON.stringify(transcript.heard ?? "")}`,
          fix: `revise the line's performance and speak it again; when a person has listened and it is right: jam audio voice process ${ref} --by-ear "<where they answered>: <their words>"`
        })
        continue
      }
      availability ??= yield* aligner.availability
      problems.push(availability.available
        ? { message: `${ref}: take ${take.n} has not been checked against its text`, fix: `jam audio voice process ${ref}` }
        : {
          message: `${ref}: the transcript check is unavailable (${availability.reason}), so nothing shows that take ${take.n} says its text`,
          fix: `install it: ${availability.install}. Or a person listens and their acceptance is recorded: jam audio voice process ${ref} --by-ear "<where they answered>: <their words>"`
        })
    }
    return problems
  })

/** The audio checks, bound to the services they measure with. */
export const audioChecks: Effect.Effect<ReadonlyArray<Check>, never, Services> = Effect.gen(function*() {
  const services = yield* Effect.context<Services>()
  return [
    { id: "loudness", description: "Each processed audio file is at its kind's loudness target, under the true-peak ceiling, in the project's audio format", when: "record", run: (input) => Effect.provide(loudness(input), services) },
    { id: "transcript-match", description: "Each voiced line says its current text: an independent transcription matches, or a person listened and their acceptance is on record", when: "record", run: (input) => Effect.provide(transcriptMatch(input), services) }
  ]
})

/** Supplies the audio checks to the check registry. */
export const audioChecksLayer: Layer.Layer<never, never, Services> = Layer.effect(ExtraChecks, audioChecks)
