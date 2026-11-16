// Where sounds and voiced lines live, and the operations both share: a unit is a folder with its
// record (unit.json) and processed files; every take points at an original that is kept as it
// arrived and never rewritten.
import * as Effect from "effect/Effect"
import { decode } from "../../kernel/decode.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { sha256 } from "../../kernel/hash.ts"
import { nowIso } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { parentOf } from "../../kernel/Stamps.ts"
import { levelTo, type NearSilent, processOriginal } from "./chain.ts"
import { Ffmpeg } from "./Ffmpeg.ts"
import { type AudioConfig, AudioUnit, type Generation, type Processing, type Take, UNIT_FILE, type Variant } from "./schema.ts"
import { fade, frames, type Pcm, slice } from "./signal.ts"
import type { AudioSettings } from "./targets.ts"

export const SOUND_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FILE_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface UnitPaths {
  readonly id: string
  /** The unit's folder. */
  readonly dir: string
  readonly unit: string
  /** Stable name of the n-th take's processed file. */
  take(n: number): string
  variant(n: number): string
  /** Where this unit's originals are kept. */
  readonly sources: string
}

const layout = (id: string, dir: string, stem: string, sources: string): UnitPaths => ({
  id,
  dir,
  unit: `${dir}/${UNIT_FILE}`,
  take: (n) => `${dir}/${stem}${n === 1 ? "" : `_${n}`}.wav`,
  variant: (n) => `${dir}/variants/${stem}_v${String(n).padStart(2, "0")}.wav`,
  sources
})

export const sfxPaths = (config: AudioConfig, name: string): Effect.Effect<UnitPaths, ToolError> =>
  SOUND_NAME.test(name) && name.length <= 64
    ? Effect.succeed(layout(`sfx/${name}`, `${config.roots.sfx}/${name}`, name, `${config.roots.sources}/sfx/${name}`))
    : fail("invalid", `sound name ${JSON.stringify(name)}: expected lowercase words joined by hyphens, such as vase-break`)

export const voicePaths = (config: AudioConfig, script: string, line: string): Effect.Effect<UnitPaths, ToolError> =>
  FILE_SAFE.test(script) && FILE_SAFE.test(line)
    ? Effect.succeed(layout(`voice/${script}/${line}`, `${config.roots.voice}/${script}/${line}`, line, `${config.roots.sources}/voice/${script}/${line}`))
    : fail("invalid", `line ${script}/${line}: the lines file name and the line id must be file-name safe (letters, digits, dot, underscore, hyphen)`)

const decodeUnit = (path: string) => decode(AudioUnit, { what: path, code: "malformed", fix: "unit records are written by the tool; restore this one from Git" })

export const readUnit = (path: string): Effect.Effect<AudioUnit | null, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    return (yield* files.exists(path)) ? yield* Effect.flatMap(files.readJson(path), decodeUnit(path)) : null
  })

export const writeUnit = (path: string, unit: AudioUnit): Effect.Effect<void, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    yield* (yield* ProjectFiles).writeJson(path, yield* decodeUnit(path)(unit))
  })

/** Every unit record under a root, sorted by path. */
export const unitsUnder = (root: string): Effect.Effect<ReadonlyArray<{ readonly path: string; readonly unit: AudioUnit }>, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const found = yield* files.walk(root, { skip: (path, kind) => kind === "file" && !path.endsWith(`/${UNIT_FILE}`) })
    const out: Array<{ path: string; unit: AudioUnit }> = []
    for (const path of found) {
      const unit = yield* readUnit(path)
      if (unit !== null) out.push({ path, unit })
    }
    return out
  })

export interface Owner {
  readonly path: string
  readonly unit: AudioUnit
  readonly take?: Take
  readonly variant?: Variant
}

/** The unit a processed file belongs to, with the take or variant it is. */
export const ownerOf = (file: string): Effect.Effect<Owner | null, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    const dir = parentOf(file)
    const within = (folder: string): string => (folder === "" ? UNIT_FILE : `${folder}/${UNIT_FILE}`)
    for (const path of dir === "" ? [within(dir)] : [within(dir), within(parentOf(dir))]) {
      const unit = yield* readUnit(path)
      if (unit === null) continue
      const take = unit.takes.find((candidate) => candidate.file === file)
      const variant = unit.variants.find((candidate) => candidate.file === file)
      if (take !== undefined) return { path, unit, take }
      if (variant !== undefined) return { path, unit, variant }
    }
    return null
  })

export const nextTake = (unit: AudioUnit): number => Math.max(0, ...unit.takes.map((take) => take.n)) + 1

/** A file-name-safe time stamp, so originals received together sort together. */
export const stampNow: Effect.Effect<string> = Effect.map(nowIso, (at) => at.replace(/[:.]/g, "-"))

/** Keep bytes as an original. The same bytes may be kept twice; different bytes never replace an original. */
export const keepOriginal = (path: string, bytes: Uint8Array): Effect.Effect<{ readonly path: string; readonly sha256: string }, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const digest = sha256(bytes)
    if (yield* files.exists(path)) {
      if ((yield* files.sha256(path)) !== digest) return yield* fail("conflict", `an original with other content is already kept at ${path}`, { fix: "originals are never replaced; give the file another name" })
    } else yield* files.writeBytes(path, bytes)
    return { path, sha256: digest }
  })

/**
 * The original of a supplied file. One that already lies under the sources root is the original
 * and stays where it is; anything else is copied in under its own name.
 */
export const supplyOriginal = (config: AudioConfig, paths: UnitPaths, file: string): Effect.Effect<{ readonly path: string; readonly sha256: string }, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    if ((yield* files.stat(file))?.kind !== "file") return yield* fail("not_found", `${file} does not exist`, { fix: "give the audio file's project path; copy a file from elsewhere into the project first" })
    return file.startsWith(`${config.roots.sources}/`)
      ? { path: file, sha256: yield* files.sha256(file) }
      : yield* keepOriginal(`${paths.sources}/${file.split("/").at(-1)!}`, yield* files.readBytes(file))
  })

export interface TakeInput {
  readonly paths: UnitPaths
  readonly unit: AudioUnit
  readonly n: number
  readonly original: { readonly path: string; readonly sha256: string }
  readonly generation: Generation
  readonly processing: Processing
  readonly settings: AudioSettings
}

/** Run the chain on an original and write the processed take. The unit record is the caller's to save. */
export const renderTake = (input: TakeInput): Effect.Effect<Take | NearSilent, ToolError, Ffmpeg | ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const processed = yield* processOriginal(input.original.path, input.settings.targets[input.unit.target], input.settings, input.processing)
    if ("nearSilent" in processed) return processed
    const file = input.paths.take(input.n)
    yield* files.writeBytes(file, processed.wav)
    return { n: input.n, file, sha256: sha256(processed.wav), original: input.original, generation: input.generation, processing: processed.processing, facts: processed.facts, level: processed.level }
  })

export const withTake = (unit: AudioUnit, take: Take): AudioUnit => ({ ...unit, takes: [...unit.takes.filter((other) => other.n !== take.n), take].sort((a, b) => a.n - b.n) })

export interface VariantSource {
  /** The take it comes from. */
  readonly from: number
  /** Seconds into that take; absent for the whole take. */
  readonly start?: number | undefined
  readonly end?: number | undefined
}

/**
 * Replace a unit's variants with these cuts of its takes, all at one level so a random pick never
 * jumps in volume. Old variant files are removed.
 */
export const writeVariants = (paths: UnitPaths, unit: AudioUnit, sources: ReadonlyArray<VariantSource>, settings: AudioSettings): Effect.Effect<AudioUnit, ToolError, Ffmpeg | ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const ffmpeg = yield* Ffmpeg
    const decoded = new Map<number, Pcm>()
    const pieces: Array<Pcm> = []
    for (const source of sources) {
      const take = unit.takes.find((candidate) => candidate.n === source.from)
      if (take === undefined) return yield* fail("not_found", `${unit.id} has no take ${source.from}`, { fix: `takes: ${unit.takes.map((candidate) => candidate.n).join(", ") || "none"}` })
      const pcm = decoded.get(take.n) ?? (yield* ffmpeg.decode(take.file))
      decoded.set(take.n, pcm)
      if (source.start === undefined || source.end === undefined) pieces.push({ rate: pcm.rate, channels: pcm.channels.map((channel) => channel.slice()) })
      else {
        const start = Math.max(0, Math.min(frames(pcm), Math.round(source.start * pcm.rate)))
        const end = Math.max(start, Math.min(frames(pcm), Math.round(source.end * pcm.rate)))
        pieces.push(fade(slice(pcm, start, end), 2, 8))
      }
    }
    for (const old of unit.variants) yield* files.remove(old.file).pipe(Effect.catch(() => Effect.void))
    if (pieces.length === 0) return { ...unit, variants: [] }
    const rendered = yield* levelTo(pieces, settings.targets[unit.target], settings.format.bitDepth)
    if ("nearSilent" in rendered) return yield* fail("invalid", `${unit.id}: a variant would be near-silent (peak ${rendered.truePeakDb ?? "-inf"} dBTP)`, { fix: "leave that event out: raise --rise or cut it with trim first" })
    const variants: Array<Variant> = []
    for (const [index, entry] of rendered.entries()) {
      const source = sources[index]!
      const file = paths.variant(index + 1)
      yield* files.writeBytes(file, entry.wav)
      variants.push({
        n: index + 1,
        file,
        sha256: sha256(entry.wav),
        from: source.from,
        ...(source.start === undefined || source.end === undefined ? {} : { start: source.start, end: source.end }),
        facts: entry.facts,
        level: entry.level
      })
    }
    return { ...unit, variants }
  })

export interface Reprocessed {
  readonly unit: AudioUnit
  /** Each rewritten file with the level it now has. */
  readonly files: ReadonlyArray<{ readonly file: string; readonly level: number }>
  readonly problems: ReadonlyArray<string>
}

/**
 * Process every take of a unit again from its original, with the processing its record states and
 * the settings now in force, then cut its variants again. A take whose original is missing or has
 * changed is left exactly as it is and reported.
 */
export const reprocessUnit = (paths: UnitPaths, unit: AudioUnit, settings: AudioSettings): Effect.Effect<Reprocessed, ToolError, Ffmpeg | ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const problems: Array<string> = []
    const done: Array<{ file: string; level: number }> = []
    let next = unit
    for (const take of unit.takes) {
      const present = (yield* files.exists(take.original.path)) ? yield* files.sha256(take.original.path) : null
      if (present !== take.original.sha256) {
        problems.push(`${take.file}: its original ${take.original.path} ${present === null ? "is missing" : "no longer has the recorded content"}; the take was left as it is`)
        continue
      }
      const result = yield* renderTake({ paths, unit, n: take.n, original: take.original, generation: take.generation, processing: take.processing, settings })
      if ("nearSilent" in result) {
        problems.push(`${take.file}: its original is near-silent (peak ${result.truePeakDb ?? "-inf"} dBTP); the take was left as it is`)
        continue
      }
      // What was learned about the words stays with the take only while the audio is the same length.
      const sameTiming = Math.abs(result.facts.duration - take.facts.duration) < 0.002 && result.processing.window?.start === take.processing.window?.start
      next = withTake(next, {
        ...result,
        ...(take.textHash === undefined ? {} : { textHash: take.textHash }),
        ...(sameTiming && take.words !== undefined ? { words: take.words } : {}),
        ...(sameTiming && take.transcript !== undefined ? { transcript: take.transcript } : {})
      })
      done.push({ file: result.file, level: result.level.level })
    }
    if (next.variants.length > 0) {
      next = yield* writeVariants(paths, next, next.variants.map((variant) => ({ from: variant.from, start: variant.start, end: variant.end })), settings)
      done.push(...next.variants.map((variant) => ({ file: variant.file, level: variant.level.level })))
    }
    return { unit: next, files: done, problems }
  })
