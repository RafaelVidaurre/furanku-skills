// Sound effects: takes generated or supplied, cut into variants, trimmed, tightened and brought
// to the loudness target. Each sound is a unit folder under the sfx root.
import * as Effect from "effect/Effect"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { nowIso } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Config } from "../config/Config.ts"
import type { Engine } from "../engine/Engine.ts"
import type { Providers } from "../providers/Providers.ts"
import { spendProblem } from "../runs/jobs.ts"
import type { RecordResult } from "../runs/record.ts"
import type { Runs } from "../runs/Runs.ts"
import { AudioProvider, type Estimate } from "./AudioProvider.ts"
import { Ffmpeg } from "./Ffmpeg.ts"
import { openRun, paidCall, paidStep, type RecordNeeds, recordReceived } from "./ledger.ts"
import type { AudioFacts, AudioUnit, Level, Processing, Take } from "./schema.ts"
import { detectEvents, mono } from "./signal.ts"
import { audioSettings, type AudioSettings } from "./targets.ts"
import { keepOriginal, nextTake, readUnit, renderTake, reprocessUnit, sfxPaths, stampNow, supplyOriginal, type UnitPaths, unitsUnder, withTake, writeUnit, writeVariants } from "./units.ts"

const RECIPE = "sfx"
const PAID_STEP = "generate"
const DEFAULT_TIGHTEN = { atDb: 30, fadeMs: 100 }

export interface TakeSummary {
  readonly take: number
  readonly file: string
  readonly original: string
  readonly duration: number
  readonly level: Level
  readonly facts: AudioFacts
}

const summary = (take: Take): TakeSummary => ({ take: take.n, file: take.file, original: take.original.path, duration: take.facts.duration, level: take.level, facts: take.facts })

/** A take that could not be brought to the target says so; its own peak holds it lower. */
const levelNote = (take: Take): ReadonlyArray<string> =>
  take.level.belowReference > 0.5 ? [`${take.file}: ${take.level.belowReference} LU under the ${take.level.reference} LUFS target; its peak holds it there`] : []

interface Loaded {
  readonly paths: UnitPaths
  readonly unit: AudioUnit
  readonly settings: AudioSettings
}

const load = (name: string): Effect.Effect<Loaded, ToolError, Config | ProjectFiles | Engine> =>
  Effect.gen(function*() {
    const paths = yield* sfxPaths((yield* (yield* Config).load).audio, name)
    const unit = yield* readUnit(paths.unit)
    if (unit === null) return yield* fail("not_found", `there is no sound ${name} (${paths.unit})`, { fix: `make it first: jam audio sfx generate ${name} --prompt "<what makes the sound>", or add a file: jam audio sfx add ${name} --file <audio>` })
    return { paths, unit, settings: yield* audioSettings }
  })

const chooseTake = (unit: AudioUnit, wanted: number | undefined): Effect.Effect<Take, ToolError> => {
  const take = wanted === undefined ? (unit.takes.length === 1 ? unit.takes[0] : undefined) : unit.takes.find((candidate) => candidate.n === wanted)
  return take !== undefined
    ? Effect.succeed(take)
    : fail(wanted === undefined ? "invalid" : "not_found", wanted === undefined ? `${unit.id} has ${unit.takes.length} takes; say which with --take <n>` : `${unit.id} has no take ${wanted}`, {
      fix: `takes: ${unit.takes.map((candidate) => candidate.n).join(", ") || "none"}`
    })
}

const emptyUnit = (paths: UnitPaths, name: string, title: string | undefined, loop: boolean): AudioUnit =>
  ({ version: 1, id: paths.id, kind: "sfx", name: title ?? name, target: loop ? "loop" : "effect", takes: [], variants: [] })

const sameKind = (unit: AudioUnit, loop: boolean): Effect.Effect<void, ToolError> =>
  (unit.target === "loop") === loop
    ? Effect.void
    : fail("conflict", `${unit.id} is ${unit.target === "loop" ? "a loop" : "a one-shot effect"}; a take of the other kind would be processed to another target`, { fix: "give the new sound its own name" })

export interface ShapeFlags {
  readonly loop: boolean
  readonly stereo: boolean
  /** Fade the room tail (contact sounds: steps, bumps, impacts). */
  readonly tighten: boolean
  readonly title?: string | undefined
}

const processingFor = (flags: ShapeFlags): Processing => ({ loop: flags.loop, stereo: flags.stereo, window: null, ...(flags.tighten && !flags.loop ? { tighten: DEFAULT_TIGHTEN } : {}) })

export interface GenerateInput extends ShapeFlags {
  readonly name: string
  readonly prompt: string
  /** The run that pays (default: the newest run whose subject is the sound's name). */
  readonly run?: string | undefined
  readonly takes: number
  readonly duration?: number | undefined
  readonly settings: Readonly<Record<string, unknown>>
  readonly provider?: string | undefined
  readonly authorized?: string | undefined
  /** Print the plan and its estimate; send nothing. */
  readonly dryRun: boolean
}

export interface Spending {
  readonly provider: string
  readonly unit: string
  readonly perRequest: number
  readonly requests: number
  readonly total: number
  readonly basis: string
  /** The same in a sentence a person can approve. */
  readonly words: string
}

export const spendingOf = (provider: { id: string; descriptor: { unit: { label: string } } }, estimate: Estimate, requests: number, total: number): Spending => ({
  provider: provider.id,
  unit: provider.descriptor.unit.label,
  perRequest: estimate.amount,
  requests,
  total,
  basis: estimate.basis,
  words: `at most ${total} ${provider.descriptor.unit.label} for ${requests} request${requests === 1 ? "" : "s"} (${estimate.basis})`
})

export interface GenerateResult {
  readonly id: string
  readonly unit: string
  readonly model: string
  readonly spending: Spending
  /** Set for a dry run: nothing was sent. */
  readonly planned?: { readonly request: Record<string, unknown>; readonly run: string }
  readonly takes: ReadonlyArray<TakeSummary & { readonly job: string; readonly charge: number }>
  readonly charged: number
  readonly warnings: ReadonlyArray<string>
  /** Why the provider stopped the batch, in its words (a stated wait is in here). */
  readonly refused?: string
  readonly recorded?: RecordResult
  readonly next: string
}

type GenerateNeeds = Config | ProjectFiles | Engine | Ffmpeg | AudioProvider | Runs | Providers | RecordNeeds

export const generate = (input: GenerateInput): Effect.Effect<GenerateResult, ToolError, GenerateNeeds> =>
  Effect.gen(function*() {
    const audio = yield* AudioProvider
    const config = yield* (yield* Config).load
    const paths = yield* sfxPaths(config.audio, input.name)
    if (input.prompt.trim() === "") return yield* fail("invalid", "--prompt is required: what makes the sound, as a physical event")
    if (!Number.isInteger(input.takes) || input.takes < 1 || input.takes > 5) return yield* fail("invalid", `--takes ${input.takes}: expected 1 to 5`)
    const provider = yield* audio.resolve("sound", input.provider)
    const sound = yield* audio.sound(provider)
    const request = { prompt: input.prompt.trim(), duration: input.duration, loop: input.loop, settings: input.settings }
    const problems = sound.problems(request)
    if (problems.length > 0) return yield* fail("invalid", problems.join("; "), { fix: `the provider's settings are described in ${provider.descriptor.docs ?? "its document"}` })
    const existing = yield* readUnit(paths.unit)
    if (existing !== null) yield* sameKind(existing, input.loop)
    const estimate = sound.estimate(request)
    const spending = spendingOf(provider, estimate, input.takes, estimate.amount * input.takes)
    const described = sound.describe(request)
    const reference = input.run ?? input.name
    if (input.dryRun) {
      return {
        id: paths.id, unit: paths.unit, model: sound.model, spending, planned: { request: described, run: reference }, takes: [], charged: 0, warnings: [],
        next: "nothing was sent. Once the person has approved that cost (or a standing authorization covers it), run it again without --dry-run"
      }
    }
    const context = yield* openRun(reference, RECIPE)
    const step = yield* paidStep(context, PAID_STEP)
    const refusedByCap = yield* spendProblem({ run: reference, provider: provider.id, estimate: spending.total })
    if (refusedByCap !== null) return yield* Effect.fail(refusedByCap)
    const unready = yield* audio.ready(provider)
    if (unready !== null) return yield* fail("unavailable", `the program of provider ${provider.id} does not run: ${unready}`, { fix: `"jam provider probe ${provider.id}" says what is missing; nothing was sent or charged` })
    const settings = yield* audioSettings
    const license = yield* audio.license(provider)
    const stamp = yield* stampNow
    let unit = existing ?? emptyUnit(paths, input.name, input.title, input.loop)
    if (input.title !== undefined) unit = { ...unit, name: input.title }
    const made: Array<TakeSummary & { job: string; charge: number }> = []
    const originals: Array<string> = []
    const warnings: Array<string> = []
    let charged = 0
    let lastJob: string | undefined
    let refused: string | undefined
    let stopped: ToolError | undefined
    for (let index = 0; index < input.takes; index++) {
      const attempt = yield* Effect.result(paidCall({ run: reference, step: step.id, provider, operation: `${sound.model}: sound effect`, estimate, request: described, authorized: input.authorized, call: audio.generateSound(provider, request) }))
      if (attempt._tag === "Failure") {
        stopped = attempt.failure
        break
      }
      const result = attempt.success
      if (result.status === "refused") {
        refused = result.message
        break
      }
      charged += result.charge
      lastJob = result.job.id
      const original = yield* keepOriginal(`${paths.sources}/${stamp}_${index + 1}.${result.extension}`, result.audio)
      originals.push(original.path)
      const n = nextTake(unit)
      const take = yield* renderTake({
        paths, unit, n, original, settings, processing: processingFor(input),
        generation: {
          origin: "generated", provider: provider.id, model: String(described["model_id"] ?? sound.model), prompt: request.prompt, settings: described,
          run: result.run, job: result.job.id, ...(result.job.providerJob === undefined ? {} : { providerJob: result.job.providerJob }), request: result.request,
          charge: result.charge, unit: result.job.unit, creator: `${provider.id} (agent-generated)`, ...(license === null ? {} : { license }), at: yield* nowIso
        }
      })
      if ("nearSilent" in take) {
        warnings.push(`${original.path}: near-silent result (peak ${take.truePeakDb ?? "-inf"} dBTP), kept as an original but not made a take; it was still charged (job ${result.job.id})`)
        continue
      }
      unit = withTake(unit, take)
      // Saved take by take, so what was paid for is on record even when a later request is lost.
      yield* writeUnit(paths.unit, unit)
      warnings.push(...levelNote(take))
      made.push({ ...summary(take), job: result.job.id, charge: result.charge })
    }
    const recorded = lastJob === undefined || originals.length === 0
      ? undefined
      : yield* recordReceived({ context, step, originals, job: lastJob, note: `Generated ${originals.length} take${originals.length === 1 ? "" : "s"} of ${paths.id} with ${provider.id} (${sound.model}). Prompt: ${request.prompt}` })
    // A lost answer or a cap stops the batch; what arrived before it is already on record.
    if (stopped !== undefined) return yield* Effect.fail(stopped)
    const id = context.ref.run.id
    return {
      id: paths.id, unit: paths.unit, model: sound.model, spending, takes: made, charged, warnings,
      ...(refused === undefined ? {} : { refused }),
      ...(recorded === undefined ? {} : { recorded }),
      next: made.length === 0
        ? (refused !== undefined ? `the provider refused; read its message (a stated wait is the time to wait), fix the cause and run it again` : `no usable take: revise the prompt and generate again`)
        : `a person listens (agents cannot hear): jam audio sfx show ${input.name} lists the files. When they have chosen: jam run record ${id} process --file <the chosen take, or each variant> --tool "jam audio" --note "<which take and why>"`
    }
  })

export interface AddInput extends ShapeFlags {
  readonly name: string
  /** Project path of the supplied audio file. */
  readonly file: string
  readonly prompt?: string | undefined
  readonly creator?: string | undefined
  readonly license?: string | undefined
  /** Where the file came from, in the supplier's words. */
  readonly source?: string | undefined
}

export interface AddResult {
  readonly id: string
  readonly unit: string
  readonly take: TakeSummary
  readonly warnings: ReadonlyArray<string>
  readonly next: string
}

export const add = (input: AddInput): Effect.Effect<AddResult, ToolError, Config | ProjectFiles | Engine | Ffmpeg> =>
  Effect.gen(function*() {
    const config = yield* (yield* Config).load
    const paths = yield* sfxPaths(config.audio, input.name)
    const original = yield* supplyOriginal(config.audio, paths, input.file)
    const existing = yield* readUnit(paths.unit)
    if (existing !== null) yield* sameKind(existing, input.loop)
    let unit = existing ?? emptyUnit(paths, input.name, input.title, input.loop)
    if (input.title !== undefined) unit = { ...unit, name: input.title }
    const take = yield* renderTake({
      paths, unit, n: nextTake(unit), original, settings: yield* audioSettings, processing: processingFor(input),
      generation: {
        origin: "supplied",
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
        creator: input.creator ?? "supplied by the user",
        license: input.license ?? "unspecified; confirm before distribution",
        source: input.source ?? `supplied file ${input.file.split("/").at(-1)!}`,
        at: yield* nowIso
      }
    })
    if ("nearSilent" in take) return yield* fail("invalid", `${input.file} is silent or near-silent (peak ${take.truePeakDb ?? "-inf"} dBTP); raising it would only raise noise`, { fix: "supply the recording at a normal level" })
    yield* writeUnit(paths.unit, withTake(unit, take))
    return { id: paths.id, unit: paths.unit, take: summary(take), warnings: levelNote(take), next: `jam audio sfx show ${input.name}` }
  })

export interface SplitInput {
  readonly name: string
  readonly take?: number | undefined
  readonly minGapMs?: number | undefined
  readonly riseDb?: number | undefined
  readonly dryRun: boolean
  /** Project path of a PNG to draw the waveform with each event shaded. */
  readonly preview?: string | undefined
}

export interface SplitResult {
  readonly id: string
  readonly take: string
  readonly floorDb: number
  readonly events: ReadonlyArray<{ readonly variant: number; readonly start: number; readonly end: number; readonly onset: number; readonly peakDb: number }>
  readonly preview?: string
  /** Absent for a dry run. */
  readonly variants?: ReadonlyArray<{ readonly file: string; readonly level: Level }>
  readonly next: string
}

export const split = (input: SplitInput): Effect.Effect<SplitResult, ToolError, Config | ProjectFiles | Engine | Ffmpeg> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const ffmpeg = yield* Ffmpeg
    const { paths, unit, settings } = yield* load(input.name)
    const take = yield* chooseTake(unit, input.take)
    const pcm = yield* ffmpeg.decode(take.file)
    // A lower rise finds the swishes in a continuous sound whose parts never fall silent.
    const found = detectEvents(mono(pcm), pcm.rate, {
      ...(input.minGapMs === undefined ? {} : { minGapMs: input.minGapMs }),
      ...(input.riseDb === undefined ? {} : { riseDb: input.riseDb, fallDb: Math.min(24, input.riseDb) })
    })
    const events = found.events.map((event, index) => ({
      variant: index + 1,
      start: Number((event.start / pcm.rate).toFixed(4)),
      end: Number((event.end / pcm.rate).toFixed(4)),
      onset: Number((event.onset / pcm.rate).toFixed(4)),
      peakDb: Number(event.peakDb.toFixed(1))
    }))
    if (input.preview !== undefined) yield* files.writeBytes(input.preview, yield* ffmpeg.waveform(take.file, events))
    const base = { id: paths.id, take: take.file, floorDb: Number(found.floorDb.toFixed(1)), events, ...(input.preview === undefined ? {} : { preview: input.preview }) }
    if (input.dryRun) {
      return { ...base, next: `look at ${input.preview ?? "a preview (--preview <file.png>)"}: each shaded span should be one complete event with its tail. Tune --min-gap <ms> (or lower --rise <dB> for a continuous sound), then run it without --dry-run` }
    }
    if (events.length < 2) {
      return yield* fail("invalid", `${paths.id}: found ${events.length} event${events.length === 1 ? "" : "s"} in take ${take.n}; nothing to split`, { fix: "try a smaller --min-gap or a lower --rise with --dry-run --preview <file.png>, or keep it as one sound" })
    }
    const next = yield* writeVariants(paths, unit, events.map((event) => ({ from: take.n, start: event.start, end: event.end })), settings)
    yield* writeUnit(paths.unit, next)
    return { ...base, variants: next.variants.map((variant) => ({ file: variant.file, level: variant.level })), next: `jam audio sfx show ${input.name}` }
  })

export interface VariantsResult {
  readonly id: string
  readonly from: ReadonlyArray<string>
  readonly variants: ReadonlyArray<{ readonly file: string; readonly level: Level }>
}

/** Turn chosen whole takes into level-matched variants: one event per take is the reliable way to get them. */
export const variantsFromTakes = (input: { readonly name: string; readonly takes: ReadonlyArray<number> }): Effect.Effect<VariantsResult, ToolError, Config | ProjectFiles | Engine | Ffmpeg> =>
  Effect.gen(function*() {
    const { paths, unit, settings } = yield* load(input.name)
    if (input.takes.length < 2 || input.takes.some((n) => !Number.isInteger(n) || n < 1) || new Set(input.takes).size !== input.takes.length) {
      return yield* fail("invalid", `--takes ${input.takes.join(",")}: expected at least two different take numbers, such as 1,2,4`, { fix: `takes of ${unit.id}: ${unit.takes.map((take) => take.n).join(", ") || "none"}` })
    }
    const next = yield* writeVariants(paths, unit, input.takes.map((from) => ({ from })), settings)
    yield* writeUnit(paths.unit, next)
    return { id: paths.id, from: input.takes.map((n) => unit.takes.find((take) => take.n === n)!.file), variants: next.variants.map((variant) => ({ file: variant.file, level: variant.level })) }
  })

export interface EditResult {
  readonly id: string
  readonly take: TakeSummary
  readonly warnings: ReadonlyArray<string>
}

// Process one take again with changed processing, and bring the unit's variants along.
const reshape = (name: string, wanted: number | undefined, change: (take: Take) => Effect.Effect<{ processing: Processing; moved: boolean }, ToolError>): Effect.Effect<EditResult, ToolError, Config | ProjectFiles | Engine | Ffmpeg> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const { paths, unit, settings } = yield* load(name)
    const take = yield* chooseTake(unit, wanted)
    if (!(yield* files.exists(take.original.path))) return yield* fail("not_found", `the original of take ${take.n}, ${take.original.path}, is missing`, { fix: "restore it from Git; takes are always processed from their original" })
    const { processing, moved } = yield* change(take)
    const result = yield* renderTake({ paths, unit, n: take.n, original: take.original, generation: take.generation, processing, settings })
    if ("nearSilent" in result) return yield* fail("invalid", `what is left of take ${take.n} is near-silent (peak ${result.truePeakDb ?? "-inf"} dBTP)`, { fix: "choose a part that holds the sound" })
    let next = withTake(unit, result)
    const warnings = [...levelNote(result)]
    if (next.variants.length > 0) {
      // Variants cut from this take follow it where the part they came from is still there.
      const duration = result.facts.duration
      const sources = next.variants.flatMap((variant) => {
        if (variant.from !== take.n || variant.start === undefined || variant.end === undefined) return [{ from: variant.from, start: variant.start, end: variant.end }]
        return moved || variant.start >= duration - 0.02 ? [] : [{ from: variant.from, start: variant.start, end: Math.min(variant.end, duration) }]
      })
      const gone = next.variants.length - sources.length
      if (gone > 0) warnings.push(`${gone} variant${gone === 1 ? "" : "s"} cut from take ${take.n} ${gone === 1 ? "was" : "were"} removed, because the part ${gone === 1 ? "it" : "they"} came from moved or is gone; split the take again`)
      next = yield* writeVariants(paths, next, sources, settings)
    }
    yield* writeUnit(paths.unit, next)
    return { id: paths.id, take: summary(result), warnings }
  })

/** Keep only [start, end] seconds of a processed take, for review feedback such as "there is a noise at the end". */
export const trim = (input: { readonly name: string; readonly take?: number | undefined; readonly start?: number | undefined; readonly end?: number | undefined }): Effect.Effect<EditResult, ToolError, Config | ProjectFiles | Engine | Ffmpeg> =>
  reshape(input.name, input.take, (take) => {
    const start = input.start ?? 0
    const end = input.end ?? take.facts.duration
    if (!(start >= 0 && end <= take.facts.duration + 0.0005 && end - start > 0.02)) {
      return fail("invalid", `--start ${start} --end ${end}: expected a part of the take (0 to ${take.facts.duration} s) at least 20 ms long`)
    }
    const base = take.processing.window?.start ?? 0
    return Effect.succeed({ processing: { ...take.processing, window: { start: base + start, end: base + end, by: "trim" as const } }, moved: start > 0 })
  })

/** Fade out a take's room tail, for review feedback such as "it has reverb". */
export const tighten = (input: { readonly name: string; readonly take?: number | undefined; readonly atDb?: number | undefined; readonly fadeMs?: number | undefined }): Effect.Effect<EditResult, ToolError, Config | ProjectFiles | Engine | Ffmpeg> =>
  reshape(input.name, input.take, (take) => {
    const atDb = input.atDb ?? DEFAULT_TIGHTEN.atDb
    const fadeMs = input.fadeMs ?? DEFAULT_TIGHTEN.fadeMs
    if (!(atDb > 0 && fadeMs > 0)) return fail("invalid", `--at-db ${atDb} --fade-ms ${fadeMs}: both must be greater than 0`)
    if (take.processing.loop) return fail("invalid", `take ${take.n} is a loop; a loop has no tail to fade`)
    return Effect.succeed({ processing: { ...take.processing, tighten: { atDb, fadeMs } }, moved: false })
  })

export interface ReprocessResult {
  readonly settings: AudioSettings
  readonly units: ReadonlyArray<{ readonly id: string; readonly files: ReadonlyArray<{ readonly file: string; readonly level: number }> }>
  readonly problems: ReadonlyArray<string>
  readonly next: string
}

/** Bring existing sounds up to the settings now in force (a changed loudness target, sample rate or bit depth). */
export const reprocess = (input: { readonly names: ReadonlyArray<string>; readonly all: boolean }): Effect.Effect<ReprocessResult, ToolError, Config | ProjectFiles | Engine | Ffmpeg> =>
  Effect.gen(function*() {
    const config = yield* (yield* Config).load
    const settings = yield* audioSettings
    if (input.all === (input.names.length > 0)) return yield* fail("invalid", "name the sounds to reprocess, or pass --all for every sound")
    const names = input.all
      ? (yield* unitsUnder(config.audio.roots.sfx)).filter((entry) => entry.unit.kind === "sfx").map((entry) => entry.unit.id.slice("sfx/".length))
      : input.names
    const units: Array<{ id: string; files: ReadonlyArray<{ file: string; level: number }> }> = []
    const problems: Array<string> = []
    for (const name of names) {
      const { paths, unit } = yield* load(name)
      const result = yield* reprocessUnit(paths, unit, settings)
      yield* writeUnit(paths.unit, result.unit)
      units.push({ id: paths.id, files: result.files })
      problems.push(...result.problems)
    }
    return {
      settings, units, problems,
      next: "processed files changed, so run steps recorded with them are stale: record those steps again, and import again where an engine holds them"
    }
  })

export interface ShowResult {
  readonly sounds: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly unit: string
    readonly target: string
    readonly takes: ReadonlyArray<TakeSummary & { readonly origin: string; readonly prompt?: string | undefined; readonly job?: string | undefined }>
    readonly variants: ReadonlyArray<{ readonly variant: number; readonly file: string; readonly from: number; readonly duration: number; readonly level: Level }>
  }>
}

export const show = (name: string | undefined): Effect.Effect<ShowResult, ToolError, Config | ProjectFiles | Engine> =>
  Effect.gen(function*() {
    const config = yield* (yield* Config).load
    const entries = name === undefined
      ? (yield* unitsUnder(config.audio.roots.sfx)).filter((entry) => entry.unit.kind === "sfx")
      : [yield* Effect.map(load(name), (loaded) => ({ path: loaded.paths.unit, unit: loaded.unit }))]
    return {
      sounds: entries.map(({ path, unit }) => ({
        id: unit.id,
        name: unit.name,
        unit: path,
        target: unit.target,
        takes: unit.takes.map((take) => ({
          ...summary(take),
          origin: take.generation.origin,
          prompt: take.generation.prompt,
          job: take.generation.job === undefined ? undefined : `${take.generation.run ?? ""}/${take.generation.job}`
        })),
        variants: unit.variants.map((variant) => ({ variant: variant.n, file: variant.file, from: variant.from, duration: variant.facts.duration, level: variant.level }))
      }))
    }
  })

