// Voiced dialogue: which lines need a voice, who speaks them, generating takes, and settling the
// take that stands for each line with its word timings and transcript check.
import * as Effect from "effect/Effect"
import { decode } from "../../kernel/decode.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { isRecord } from "../../kernel/hash.ts"
import { nowIso } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { parentOf } from "../../kernel/Stamps.ts"
import { Config } from "../config/Config.ts"
import type { Engine } from "../engine/Engine.ts"
import type { Providers } from "../providers/Providers.ts"
import { stepOf } from "../recipes/resolve.ts"
import { spendProblem } from "../runs/jobs.ts"
import { type RecordResult, recordSteps } from "../runs/record.ts"
import { Runs } from "../runs/Runs.ts"
import { latestRecord, runKey } from "../runs/schema.ts"
import { Toolkit } from "../Toolkit.ts"
import { Aligner, type Availability } from "./Aligner.ts"
import { AudioProvider, type ResolvedProvider, type SpeechRequest, type VoiceInfo } from "./AudioProvider.ts"
import { Ffmpeg } from "./Ffmpeg.ts"
import { openRun, paidCall, paidStep, type RecordNeeds, recordReceived } from "./ledger.ts"
import { type Dialogue, isReviewed, loadDialogue, loadSpeakers, resolveLines, sameWords, type ScriptLine, standingOf, type VoiceState } from "./lines.ts"
import { type AudioUnit, type Processing, SpeakersFile, type Take, type Transcript, type VoiceRef } from "./schema.ts"
import { type Spending, spendingOf } from "./sfx.ts"
import { audioSettings, type AudioSettings } from "./targets.ts"
import { keepOriginal, nextTake, readUnit, renderTake, reprocessUnit, stampNow, supplyOriginal, type UnitPaths, voicePaths, withTake, writeUnit } from "./units.ts"

const RECIPE = "voice-line"
const PAID_STEP = "voice"
const PROCESS_STEP = "process"
const PROCESSING: Processing = { loop: false, stereo: false, window: null }

export type TranscriptState = "match" | "mismatch" | "by-ear" | "unchecked"

export interface LineRow {
  readonly line: string
  readonly speaker: string
  readonly state: VoiceState
  /** A person marked the words final. */
  readonly reviewed: boolean
  /** The assigned voice, or null when the speaker has none. */
  readonly voice: string | null
  readonly take: number | null
  readonly file: string | null
  readonly transcript: TranscriptState | null
  /** What an independent transcriber heard, when it differs from the text. */
  readonly heard?: string | undefined
  /** Word timings: aligned to the audio, spread by word length, or none. */
  readonly timings: "forced" | "proportional" | "none" | null
  /** Everything that stands between this line and a finished voiced line. */
  readonly needs: ReadonlyArray<string>
}

const transcriptState = (take: Take | null): TranscriptState | null => (take === null ? null : take.transcript?.status ?? "unchecked")

const unitFor = (line: ScriptLine): Effect.Effect<{ readonly paths: UnitPaths; readonly unit: AudioUnit | null }, ToolError, Config | ProjectFiles> =>
  Effect.gen(function*() {
    const paths = yield* voicePaths((yield* (yield* Config).load).audio, line.script, line.line.id)
    return { paths, unit: yield* readUnit(paths.unit) }
  })

const rowOf = (dialogue: Dialogue, line: ScriptLine, unit: AudioUnit | null): LineRow => {
  const standing = standingOf(line, unit)
  const voice = dialogue.speakers.find((speaker) => speaker.id === line.line.speaker)?.voice
  const transcript = transcriptState(standing.take)
  const reviewed = isReviewed(line.line)
  return {
    line: line.ref,
    speaker: line.line.speaker,
    state: standing.state,
    reviewed,
    voice: voice === undefined ? null : voice.name ?? voice.id,
    take: standing.take?.n ?? null,
    file: standing.take?.file ?? null,
    transcript,
    ...(transcript === "mismatch" ? { heard: standing.take?.transcript?.heard } : {}),
    timings: standing.take === null ? null : standing.take.words === undefined ? "none" : standing.take.transcript?.alignment ?? "none",
    needs: [
      ...(reviewed ? [] : ["unreviewed"]),
      ...(voice === undefined ? ["no voice"] : []),
      ...(standing.state === "voiced" ? [] : [standing.state]),
      ...(transcript === "mismatch" ? ["mismatched"] : transcript === "unchecked" ? ["unchecked"] : [])
    ]
  }
}

export interface StatusResult {
  readonly lines: ReadonlyArray<LineRow>
  readonly counts: Readonly<Record<"lines" | "missing" | "stale" | "voiced" | "mismatched" | "unchecked" | "unreviewed" | "noVoice", number>>
}

export const status = (input: { readonly script?: string | undefined; readonly speaker?: string | undefined }): Effect.Effect<StatusResult, ToolError, Config | ProjectFiles> =>
  Effect.gen(function*() {
    const dialogue = yield* loadDialogue
    const rows: Array<LineRow> = []
    for (const line of dialogue.lines) {
      if ((input.script !== undefined && line.script !== input.script) || (input.speaker !== undefined && line.line.speaker !== input.speaker)) continue
      rows.push(rowOf(dialogue, line, (yield* unitFor(line)).unit))
    }
    const count = (need: string): number => rows.filter((row) => row.needs.includes(need)).length
    return {
      lines: rows,
      counts: {
        lines: rows.length, missing: count("missing"), stale: count("stale"), voiced: rows.filter((row) => row.state === "voiced").length,
        mismatched: count("mismatched"), unchecked: count("unchecked"), unreviewed: count("unreviewed"), noVoice: count("no voice")
      }
    }
  })

export interface VoicesResult {
  readonly provider: string
  readonly voices: ReadonlyArray<VoiceInfo>
  /** Where a person makes or browses voices. */
  readonly links: Readonly<Record<string, string>>
}

export const voices = (input: { readonly search?: string | undefined; readonly provider?: string | undefined }): Effect.Effect<VoicesResult, ToolError, AudioProvider> =>
  Effect.gen(function*() {
    const audio = yield* AudioProvider
    const provider = yield* audio.resolve("voice", input.provider)
    return { provider: provider.id, voices: yield* audio.voices(provider, input.search), links: (yield* audio.voice(provider)).links ?? {} }
  })

export interface AssignInput {
  readonly speaker: string
  readonly voice: string
  readonly provider?: string | undefined
  /** The voice's name, when it was already found through the provider; skips the lookup. */
  readonly name?: string | undefined
  readonly settings: Readonly<Record<string, unknown>>
}

export const assign = (input: AssignInput): Effect.Effect<{ readonly speaker: string; readonly voice: VoiceRef; readonly file: string }, ToolError, Config | ProjectFiles | AudioProvider> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const audio = yield* AudioProvider
    const config = (yield* (yield* Config).load).audio
    const provider = yield* audio.resolve("voice", input.provider)
    const problems = (yield* audio.voice(provider)).settingProblems(input.settings)
    if (problems.length > 0) return yield* fail("invalid", `--setting: ${problems.join("; ")}`)
    const name = input.name ?? (yield* audio.voiceInfo(provider, input.voice)).name
    const voice: VoiceRef = { provider: provider.id, id: input.voice, name, ...(Object.keys(input.settings).length === 0 ? {} : { settings: input.settings }) }
    yield* loadSpeakers(config)
    const raw = (yield* files.exists(config.speakers)) ? yield* files.readJson(config.speakers) : { speakers: [] }
    const list = isRecord(raw) && Array.isArray(raw["speakers"]) ? raw["speakers"] as ReadonlyArray<Record<string, unknown>> : []
    const next = {
      ...(isRecord(raw) ? raw : {}),
      speakers: list.some((speaker) => speaker["id"] === input.speaker)
        ? list.map((speaker) => (speaker["id"] === input.speaker ? { ...speaker, voice } : speaker))
        : [...list, { id: input.speaker, voice }]
    }
    yield* decode(SpeakersFile, { what: config.speakers })(next)
    yield* files.writeJson(config.speakers, next)
    return { speaker: input.speaker, voice, file: config.speakers }
  })

interface Planned {
  readonly line: ScriptLine
  readonly provider: ResolvedProvider
  readonly request: SpeechRequest
  readonly described: Record<string, unknown>
  readonly model: string
  readonly estimate: ReturnType<NonNullable<ResolvedProvider["adapter"]["voice"]>["estimate"]>
}

export interface SpeakInput {
  /** Lines to voice; none means every missing or stale line. */
  readonly lines: ReadonlyArray<string>
  /** The run that pays (default for one line: the run whose subject is the line's id). */
  readonly run?: string | undefined
  /** Only lines a person marked reviewed. */
  readonly reviewed: boolean
  readonly speaker?: string | undefined
  readonly script?: string | undefined
  readonly takes: number
  readonly authorized?: string | undefined
  readonly dryRun: boolean
}

export interface SpokenRow {
  readonly line: string
  readonly take: number
  readonly file: string
  readonly original: string
  readonly duration: number
  readonly job: string
  readonly charge: number
  readonly transcript: TranscriptState
  readonly heard?: string | undefined
}

export interface SpeakResult {
  readonly spending: ReadonlyArray<Spending>
  /** Set for a dry run: what would be sent, line by line. */
  readonly planned?: ReadonlyArray<{ readonly line: string; readonly speaker: string; readonly provider: string; readonly voice: string; readonly text: string; readonly takes: number; readonly estimate: number }>
  readonly spoken: ReadonlyArray<SpokenRow>
  /** Unreviewed lines among those voiced: their words may still change. */
  readonly unreviewed: ReadonlyArray<string>
  readonly charged: number
  readonly transcriptCheck: Availability | null
  readonly warnings: ReadonlyArray<string>
  readonly refused?: string
  readonly recorded?: RecordResult
  readonly next: string
}

type SpeakNeeds = Config | ProjectFiles | Engine | Ffmpeg | AudioProvider | Aligner | Runs | Providers | RecordNeeds

// Check takes against their text and store what was learned. Returns how the check stands.
const checkTakes = (entries: ReadonlyArray<{ readonly line: ScriptLine; readonly paths: UnitPaths; readonly take: number }>): Effect.Effect<Availability, ToolError, Aligner | ProjectFiles> =>
  Effect.gen(function*() {
    const aligner = yield* Aligner
    const state = yield* aligner.availability
    if (!state.available || entries.length === 0) return state
    const units = new Map<string, AudioUnit>()
    const items: Array<{ file: string; text: string; language: string }> = []
    for (const entry of entries) {
      const unit = units.get(entry.paths.unit) ?? (yield* readUnit(entry.paths.unit))!
      units.set(entry.paths.unit, unit)
      items.push({ file: unit.takes.find((take) => take.n === entry.take)!.file, text: entry.line.line.text, language: entry.line.language })
    }
    const results = yield* aligner.align(items)
    const at = yield* nowIso
    for (const [index, entry] of entries.entries()) {
      const result = results[index]!
      const unit = units.get(entry.paths.unit)!
      const take = unit.takes.find((candidate) => candidate.n === entry.take)!
      const transcript: Transcript = {
        status: result.mismatch ? "mismatch" : "match",
        language: entry.line.language,
        heard: result.heard,
        wordErrorRate: result.wordErrorRate,
        alignment: result.alignment,
        ...(result.alignmentError === undefined ? {} : { alignmentError: result.alignmentError }),
        tool: result.tool,
        at
      }
      const { words: _words, ...rest } = take
      units.set(entry.paths.unit, withTake(unit, { ...rest, ...(result.words === null ? {} : { words: result.words }), transcript }))
    }
    for (const [path, unit] of units) yield* writeUnit(path, unit)
    return state
  })

const emptyUnit = (paths: UnitPaths, line: ScriptLine): AudioUnit => ({ version: 1, id: paths.id, kind: "voice", name: line.line.text, target: "voice", takes: [], variants: [] })

const withLine = (unit: AudioUnit, line: ScriptLine): AudioUnit => ({
  ...unit,
  name: line.line.text,
  line: { script: line.script, file: line.file, id: line.line.id, speaker: line.line.speaker, text: line.line.text, textHash: line.textHash, language: line.language }
})

export const speak = (input: SpeakInput): Effect.Effect<SpeakResult, ToolError, SpeakNeeds> =>
  Effect.gen(function*() {
    const audio = yield* AudioProvider
    const dialogue = yield* loadDialogue
    if (!Number.isInteger(input.takes) || input.takes < 1 || input.takes > 5) return yield* fail("invalid", `--takes ${input.takes}: expected 1 to 5`)
    let chosen: ReadonlyArray<ScriptLine>
    if (input.lines.length > 0) chosen = yield* resolveLines(dialogue, input.lines)
    else {
      const open: Array<ScriptLine> = []
      for (const line of dialogue.lines) {
        if (standingOf(line, (yield* unitFor(line)).unit).state !== "voiced") open.push(line)
      }
      chosen = open
    }
    chosen = chosen.filter((line) =>
      (input.speaker === undefined || line.line.speaker === input.speaker) && (input.script === undefined || line.script === input.script) && (!input.reviewed || isReviewed(line.line)))
    if (chosen.length === 0) {
      return { spending: [], spoken: [], unreviewed: [], charged: 0, transcriptCheck: null, warnings: [], next: `nothing to voice: "jam audio voice status" shows where every line stands` }
    }
    const voiceless = [...new Set(chosen.filter((line) => dialogue.speakers.find((speaker) => speaker.id === line.line.speaker)?.voice === undefined).map((line) => line.line.speaker))]
    if (voiceless.length > 0) {
      return yield* fail("conflict", `no voice is assigned to: ${voiceless.join(", ")}`, {
        fix: `the person chooses each voice: list candidates with "jam audio voice voices --search <text>", then jam audio voice assign <speaker> --voice <voice id>`
      })
    }
    const providers = new Map<string, ResolvedProvider>()
    const planned: Array<Planned> = []
    for (const line of chosen) {
      const voice = dialogue.speakers.find((speaker) => speaker.id === line.line.speaker)!.voice!
      const provider = providers.get(voice.provider) ?? (yield* audio.resolve("voice", voice.provider))
      providers.set(voice.provider, provider)
      const adapter = yield* audio.voice(provider)
      const markup = line.line.performance?.[provider.id]
      if (markup !== undefined && !sameWords(adapter.spokenWords(markup), line.line.text)) {
        return yield* fail("invalid", `${line.ref}: its ${provider.id} performance does not speak the line's exact words`, { fix: "a performance is the text with delivery markup added; to change the words, edit text" })
      }
      const problems = adapter.settingProblems(voice.settings ?? {})
      if (problems.length > 0) return yield* fail("invalid", `voice of ${line.line.speaker}: ${problems.join("; ")}`, { fix: `assign it again with valid settings: jam audio voice assign ${line.line.speaker} --voice ${voice.id}` })
      const request: SpeechRequest = { text: markup ?? line.line.text, voice, language: line.language }
      planned.push({ line, provider, request, described: adapter.describe(request), model: String(adapter.describe(request)["model_id"] ?? adapter.model), estimate: adapter.estimate(request) })
    }
    const spending = [...providers.values()].map((provider) => {
      const own = planned.filter((plan) => plan.provider.id === provider.id)
      return spendingOf(provider, own[0]!.estimate, own.length * input.takes, own.reduce((sum, plan) => sum + plan.estimate.amount, 0) * input.takes)
    })
    const unreviewed = chosen.filter((line) => !isReviewed(line.line)).map((line) => line.ref)
    if (input.dryRun) {
      return {
        spending, spoken: [], unreviewed, charged: 0, transcriptCheck: null, warnings: [],
        planned: planned.map((plan) => ({ line: plan.line.ref, speaker: plan.line.line.speaker, provider: plan.provider.id, voice: plan.request.voice.name ?? plan.request.voice.id, text: plan.request.text, takes: input.takes, estimate: plan.estimate.amount * input.takes })),
        next: "nothing was sent. Once the person has approved that cost (or a standing authorization covers it), run it again without --dry-run"
      }
    }
    const reference = input.run ?? (chosen.length === 1 ? chosen[0]!.line.id : undefined)
    if (reference === undefined) return yield* fail("invalid", "--run <id> is required: the run whose ledger pays for these lines", { fix: `start one for the batch: jam run start ${RECIPE} <batch name> --brief-text "<which lines and why>"` })
    const context = yield* openRun(reference, RECIPE)
    const step = yield* paidStep(context, PAID_STEP)
    for (const entry of spending) {
      const refusedByCap = yield* spendProblem({ run: reference, provider: entry.provider, estimate: entry.total })
      if (refusedByCap !== null) return yield* Effect.fail(refusedByCap)
    }
    for (const provider of providers.values()) {
      const unready = yield* audio.ready(provider)
      if (unready !== null) return yield* fail("unavailable", `the program of provider ${provider.id} does not run: ${unready}`, { fix: `"jam provider probe ${provider.id}" says what is missing; nothing was sent or charged` })
    }
    const settings = yield* audioSettings
    const stamp = yield* stampNow
    const licenses = new Map<string, string | null>()
    const made: Array<{ line: ScriptLine; paths: UnitPaths; take: number; job: string; charge: number; original: string }> = []
    const warnings: Array<string> = []
    let charged = 0
    let lastJob: string | undefined
    let refused: string | undefined
    let stopped: ToolError | undefined
    sending: for (const plan of planned) {
      const { paths, unit: existing } = yield* unitFor(plan.line)
      let unit = withLine(existing ?? emptyUnit(paths, plan.line), plan.line)
      if (!licenses.has(plan.provider.id)) licenses.set(plan.provider.id, yield* audio.license(plan.provider))
      const license = licenses.get(plan.provider.id) ?? null
      for (let index = 0; index < input.takes; index++) {
        const attempt = yield* Effect.result(paidCall({ run: reference, step: step.id, provider: plan.provider, operation: `${plan.model}: speech`, estimate: plan.estimate, request: plan.described, authorized: input.authorized, call: audio.speak(plan.provider, plan.request) }))
        if (attempt._tag === "Failure") {
          stopped = attempt.failure
          break sending
        }
        const result = attempt.success
        if (result.status === "refused") {
          refused = result.message
          break sending
        }
        charged += result.charge
        lastJob = result.job.id
        const original = yield* keepOriginal(`${paths.sources}/${stamp}_${index + 1}.${result.extension}`, result.audio)
        const n = nextTake(unit)
        const take = yield* renderTake({
          paths, unit, n, original, settings, processing: PROCESSING,
          generation: {
            origin: "generated", provider: plan.provider.id, model: plan.model, text: plan.request.text,
            voice: { id: plan.request.voice.id, ...(plan.request.voice.name === undefined ? {} : { name: plan.request.voice.name }) }, settings: plan.described,
            run: result.run, job: result.job.id, ...(result.job.providerJob === undefined ? {} : { providerJob: result.job.providerJob }), request: result.request,
            charge: result.charge, unit: result.job.unit, creator: `${plan.provider.id} (agent-generated)`, ...(license === null ? {} : { license }), at: yield* nowIso
          }
        })
        if ("nearSilent" in take) {
          warnings.push(`${original.path}: near-silent result (peak ${take.truePeakDb ?? "-inf"} dBTP), kept as an original but not made a take; it was still charged (job ${result.job.id})`)
          continue
        }
        unit = withTake(unit, { ...take, textHash: plan.line.textHash })
        yield* writeUnit(paths.unit, unit)
        made.push({ line: plan.line, paths, take: n, job: result.job.id, charge: result.charge, original: original.path })
      }
    }
    const check = yield* checkTakes(made)
    const recorded = lastJob === undefined || made.length === 0
      ? undefined
      : yield* recordReceived({ context, step, originals: made.map((entry) => entry.original), job: lastJob, note: `Voiced ${[...new Set(made.map((entry) => entry.line.ref))].join(", ")} (${made.length} take${made.length === 1 ? "" : "s"}).` })
    // A lost answer or a cap stops the batch; what arrived before it is already on record.
    if (stopped !== undefined) return yield* Effect.fail(stopped)
    const spoken: Array<SpokenRow> = []
    for (const entry of made) {
      const take = (yield* readUnit(entry.paths.unit))!.takes.find((candidate) => candidate.n === entry.take)!
      spoken.push({
        line: entry.line.ref, take: take.n, file: take.file, original: entry.original, duration: take.facts.duration, job: entry.job, charge: entry.charge,
        transcript: take.transcript?.status ?? "unchecked", ...(take.transcript?.status === "mismatch" ? { heard: take.transcript.heard } : {})
      })
    }
    const id = context.ref.run.id
    return {
      spending, spoken, unreviewed, charged, transcriptCheck: check, warnings,
      ...(refused === undefined ? {} : { refused }),
      ...(recorded === undefined ? {} : { recorded }),
      next: spoken.length === 0
        ? (refused !== undefined ? "the provider refused; read its message (a stated wait is the time to wait), fix the cause and run it again" : "no usable take was made")
        : spoken.some((row) => row.transcript === "mismatch")
        ? `a mismatched take does not say its text: revise that line's performance and speak it again, or have a person listen. Then: jam audio voice process --run ${id}`
        : `settle and record the lines: jam audio voice process --run ${id}; a person listens before the step is accepted (agents cannot hear)`
    }
  })

export interface ProcessInput {
  readonly lines: ReadonlyArray<string>
  /** Every line that has a take. */
  readonly all: boolean
  /** Record the processed lines on this run's process step. Without lines: the lines this run voiced. */
  readonly run?: string | undefined
  readonly step?: string | undefined
  /** A recording to add as a new take of the one named line (project path). */
  readonly file?: string | undefined
  /** Make this take stand for the one named line. */
  readonly take?: number | undefined
  /** A person listened and accepted the named lines: `<where they answered>: <their words>`. */
  readonly byEar?: string | undefined
  /** Run the transcript check again for takes that already have a result. */
  readonly recheck: boolean
  readonly creator?: string | undefined
  readonly license?: string | undefined
  readonly source?: string | undefined
  /** With --run on a run that starts at this step: the document showing where the recordings came from. */
  readonly sourceEvidence?: string | undefined
}

export interface ProcessResult {
  readonly lines: ReadonlyArray<LineRow>
  readonly transcriptCheck: Availability
  readonly problems: ReadonlyArray<string>
  readonly recorded?: RecordResult
  readonly next: string
}

const isCurrent = (take: Take, settings: AudioSettings): boolean => {
  const target = settings.targets.voice
  return take.level.reference === target.lufs && take.level.ceiling === target.truePeakDb && take.facts.sampleRate === settings.format.sampleRate && take.facts.bitDepth === settings.format.bitDepth
}

type ProcessNeeds = Config | ProjectFiles | Engine | Ffmpeg | Aligner | Runs | Toolkit | RecordNeeds

export const processLines = (input: ProcessInput): Effect.Effect<ProcessResult, ToolError, ProcessNeeds> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const dialogue = yield* loadDialogue
    const settings = yield* audioSettings
    const context = input.run === undefined ? null : yield* (yield* Runs).open(input.run)
    const named = yield* resolveLines(dialogue, input.lines)
    if (named.length !== 1 && (input.file !== undefined || input.take !== undefined)) return yield* fail("invalid", `${input.file !== undefined ? "--file" : "--take"} applies to exactly one named line`)
    if (named.length === 0 && input.byEar !== undefined) return yield* fail("invalid", "--by-ear needs the lines the person listened to, by name")
    const accepted = input.byEar === undefined ? null : (() => {
      const at = input.byEar.indexOf(":")
      return at === -1 ? null : { channel: input.byEar.slice(0, at).trim(), words: input.byEar.slice(at + 1).trim() }
    })()
    if (input.byEar !== undefined && (accepted === null || accepted.channel === "" || accepted.words === "")) {
      return yield* fail("invalid", `--by-ear ${JSON.stringify(input.byEar)}: expected "<where they answered>: <their words, verbatim>"`, { fix: `for example --by-ear "chat: both lines sound right"` })
    }
    let chosen: ReadonlyArray<ScriptLine> = named
    if (named.length === 0) {
      if (context === null && !input.all) return yield* fail("invalid", "name the lines to process, pass --run <id> for the lines that run voiced, or --all for every voiced line")
      const key = context === null ? null : runKey(context.ref.run)
      const found: Array<ScriptLine> = []
      for (const line of dialogue.lines) {
        const unit = (yield* unitFor(line)).unit
        if (unit !== null && unit.takes.length > 0 && (input.all || unit.takes.some((take) => take.generation.run === key))) found.push(line)
      }
      chosen = found
    }
    const problems: Array<string> = []
    const ready: Array<{ line: ScriptLine; paths: UnitPaths; take: number }> = []
    const toCheck: Array<{ line: ScriptLine; paths: UnitPaths; take: number }> = []
    for (const line of chosen) {
      const { paths, unit: existing } = yield* unitFor(line)
      let unit = existing
      if (input.file !== undefined) {
        const base = withLine(unit ?? emptyUnit(paths, line), line)
        const original = yield* supplyOriginal((yield* (yield* Config).load).audio, paths, input.file)
        const take = yield* renderTake({
          paths, unit: base, n: nextTake(base), original, settings, processing: PROCESSING,
          generation: { origin: "supplied", text: line.line.text, creator: input.creator ?? "supplied recording", license: input.license ?? "unspecified; confirm before distribution", source: input.source ?? `supplied file ${input.file.split("/").at(-1)!}`, at: yield* nowIso }
        })
        if ("nearSilent" in take) return yield* fail("invalid", `${input.file} is silent or near-silent (peak ${take.truePeakDb ?? "-inf"} dBTP)`, { fix: "supply the recording at a normal level" })
        unit = { ...withTake(base, { ...take, textHash: line.textHash }), selected: take.n }
      }
      if (unit === null || unit.takes.length === 0) {
        problems.push(`${line.ref}: not voiced yet`)
        continue
      }
      if (unit.takes.some((take) => !isCurrent(take, settings))) {
        const result = yield* reprocessUnit(paths, unit, settings)
        unit = result.unit
        problems.push(...result.problems)
      }
      if (input.take !== undefined) {
        if (!unit.takes.some((take) => take.n === input.take && take.textHash === line.textHash)) {
          return yield* fail("not_found", `${line.ref} has no take ${input.take} of its current text`, { fix: `takes of the current text: ${unit.takes.filter((take) => take.textHash === line.textHash).map((take) => take.n).join(", ") || "none"}` })
        }
        unit = { ...unit, selected: input.take }
      }
      unit = standingOf(line, unit).state === "voiced" ? withLine(unit, line) : unit
      yield* writeUnit(paths.unit, unit)
      const standing = standingOf(line, unit)
      if (standing.take === null) {
        problems.push(`${line.ref}: its text changed after it was voiced; speak it again`)
        continue
      }
      ready.push({ line, paths, take: standing.take.n })
      if (standing.take.transcript === undefined || input.recheck) toCheck.push({ line, paths, take: standing.take.n })
    }
    const check = yield* checkTakes(accepted === null ? toCheck : [])
    if (accepted !== null) {
      const at = yield* nowIso
      for (const entry of ready) {
        const unit = (yield* readUnit(entry.paths.unit))!
        const take = unit.takes.find((candidate) => candidate.n === entry.take)!
        // What a transcriber wrote stays on the record beside the person's acceptance.
        const { status: _status, accepted: _before, at: _at, ...kept } = take.transcript ?? { status: "by-ear" as const, language: entry.line.language, at }
        yield* writeUnit(entry.paths.unit, withTake(unit, { ...take, transcript: { ...kept, language: entry.line.language, status: "by-ear", accepted, at } }))
      }
    }
    const rows: Array<LineRow> = []
    for (const line of chosen) rows.push(rowOf(dialogue, line, (yield* unitFor(line)).unit))
    let recorded: RecordResult | undefined
    if (context !== null) {
      if (ready.length === 0) return yield* fail("conflict", `nothing to record on run ${runKey(context.ref.run)}: ${problems.join("; ") || "no line of it has a take"}`, { fix: `voice lines first: jam audio voice speak --run ${context.ref.run.id}` })
      const step = yield* Effect.try({ try: () => stepOf(context.recipe, input.step ?? PROCESS_STEP), catch: (cause) => cause as ToolError })
      const role = step.produces.find((output) => output.kind === "audio")?.role ?? "line"
      const taken: Array<string> = []
      for (const entry of ready) taken.push((yield* readUnit(entry.paths.unit))!.takes.find((take) => take.n === entry.take)!.file)
      const folders = new Set(taken.map(parentOf))
      const kept: Array<string> = []
      for (const file of latestRecord(context.ref.run, step.id)?.files ?? []) {
        if (file.role === role && !folders.has(parentOf(file.path)) && (yield* files.exists(file.path))) kept.push(file.path)
      }
      recorded = yield* recordSteps({
        run: runKey(context.ref.run),
        steps: [step.id],
        files: [...kept, ...taken].map((path) => `${role}=${path}`),
        evidence: [],
        inputs: [],
        note: `Processed ${ready.map((entry) => entry.line.ref).join(", ")} to the voice loudness target${accepted === null ? "" : `; accepted by ear (${accepted.channel}: ${accepted.words})`}.`,
        ...(input.sourceEvidence === undefined
          ? { tool: `jam audio ${yield* (yield* Toolkit).version}` }
          : { source: input.source ?? "supplied recordings", sourceEvidence: input.sourceEvidence })
      })
    }
    const mismatched = rows.filter((row) => row.transcript === "mismatch").map((row) => row.line)
    const unchecked = rows.filter((row) => row.transcript === "unchecked").map((row) => row.line)
    return {
      lines: rows, transcriptCheck: check, problems,
      ...(recorded === undefined ? {} : { recorded }),
      next: recorded !== undefined
        ? recorded.next
        : mismatched.length > 0
        ? `${mismatched.join(", ")} ${mismatched.length === 1 ? "does" : "do"} not say the text: revise the performance and speak again, or have a person listen and add --by-ear "<where they answered>: <their words>"`
        : unchecked.length > 0 && !check.available
        ? `the transcript check is not installed (${check.install}). Without it, a person listens: jam audio voice process ${unchecked.join(" ")} --by-ear "<where they answered>: <their words>"`
        : "record the lines on their run: jam audio voice process --run <id>"
    }
  })
