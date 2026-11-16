// Dialogue as the project authors it: line files matched by `audio.lines`, and the speakers file
// that says which voice speaks for whom. A line's text is hashed, so a voiced take knows when the
// words it speaks have been edited.
import * as Effect from "effect/Effect"
import { decode } from "../../kernel/decode.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { sha256 } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Config } from "../config/Config.ts"
import { type AudioConfig, type AudioUnit, type Line, LinesFile, type Speaker, SpeakersFile, type Take, UNIT_FILE } from "./schema.ts"

export const hashText = (text: string): string => sha256(text)

export const isReviewed = (line: Line): boolean => line.review === true || (typeof line.review === "string" && line.review.trim().toLowerCase() === "reviewed")

export interface ScriptLine {
  /** The lines file's name without `.json`. */
  readonly script: string
  readonly file: string
  readonly line: Line
  readonly language: string
  readonly textHash: string
  /** `<script>/<line id>`: how commands name the line. */
  readonly ref: string
}

export interface Dialogue {
  readonly lines: ReadonlyArray<ScriptLine>
  readonly speakers: ReadonlyArray<Speaker>
  readonly speakersFile: string
}

const escape = (text: string): string => text.replace(/[.+^${}()|[\]\\]/g, "\\$&")

/** A glob as a pattern over project paths: `*` and `?` stay inside a folder, `**` crosses folders. */
export const globPattern = (glob: string): RegExp =>
  new RegExp(`^${glob.split(/(\*\*\/|\*\*|\*|\?)/).map((part) => (part === "**/" ? "(?:.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : escape(part))).join("")}$`, "u")

/** The folder a glob can match under: its leading segments without a wildcard. */
const fixedPrefix = (glob: string): string => {
  const segments = glob.split("/")
  const upTo = segments.findIndex((segment) => /[*?]/.test(segment))
  return (upTo === -1 ? segments.slice(0, -1) : segments.slice(0, upTo)).join("/")
}

const matching = (config: AudioConfig): Effect.Effect<ReadonlyArray<string>, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const found = new Set<string>()
    for (const glob of config.lines) {
      const pattern = globPattern(glob)
      const prefix = fixedPrefix(glob)
      if (prefix === "") return yield* fail("invalid", `audio.lines ${JSON.stringify(glob)}: a pattern must start with a folder, such as Audio/Lines/*.json`)
      const candidates = yield* files.walk(prefix, { skip: (path, kind) => kind === "directory" && /(?:^|\/)(?:node_modules|\.git)$/.test(path) })
      for (const path of candidates) {
        if (pattern.test(path) && path !== config.speakers && !path.endsWith(`/${UNIT_FILE}`)) found.add(path)
      }
    }
    return [...found].sort()
  })

export const loadSpeakers = (config: AudioConfig): Effect.Effect<SpeakersFile, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    if (!(yield* files.exists(config.speakers))) return { speakers: [] }
    return yield* Effect.flatMap(files.readJson(config.speakers), decode(SpeakersFile, { what: config.speakers, fix: "see schemas/audio-speakers.schema.json in the toolkit" }))
  })

export const loadDialogue: Effect.Effect<Dialogue, ToolError, Config | ProjectFiles> = Effect.gen(function*() {
  const files = yield* ProjectFiles
  const config = (yield* (yield* Config).load).audio
  const lines: Array<ScriptLine> = []
  const scripts = new Map<string, string>()
  for (const file of yield* matching(config)) {
    const script = file.split("/").at(-1)!.replace(/\.json$/i, "")
    const other = scripts.get(script)
    if (other !== undefined) return yield* fail("invalid", `two lines files share the name ${script}: ${other} and ${file}`, { fix: "lines are named <file name>/<line id>; give one of the files another name" })
    scripts.set(script, file)
    const data = yield* Effect.flatMap(files.readJson(file), decode(LinesFile, { what: file, fix: "see schemas/audio-lines.schema.json in the toolkit; fields of your own go under extra" }))
    const seen = new Set<string>()
    for (const line of data.lines) {
      if (seen.has(line.id)) return yield* fail("invalid", `${file}: line id ${line.id} is used twice`, { fix: "give each line of a file its own id" })
      seen.add(line.id)
      lines.push({ script, file, line, language: line.language ?? data.language ?? config.language, textHash: hashText(line.text), ref: `${script}/${line.id}` })
    }
  }
  return { lines, speakers: (yield* loadSpeakers(config)).speakers, speakersFile: config.speakers }
})

/** Lines named as `<script>/<id>`, or by id alone when only one file has it. */
export const resolveLines = (dialogue: Dialogue, references: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<ScriptLine>, ToolError> =>
  Effect.forEach(references, (reference) => {
    const matches = dialogue.lines.filter((entry) => entry.ref === reference || entry.line.id === reference)
    return matches.length === 1
      ? Effect.succeed(matches[0]!)
      : fail(matches.length === 0 ? "not_found" : "invalid", matches.length === 0 ? `no line ${reference}` : `line id ${reference} is in several files`, {
        fix: matches.length === 0 ? `"jam audio voice status" lists every line as <file name>/<line id>` : `name it with its file: ${matches.map((entry) => entry.ref).join(", ")}`
      })
  })

export type VoiceState = "missing" | "stale" | "voiced"

export interface Standing {
  readonly state: VoiceState
  /** The take that stands for the line: the selected one, else the lowest-numbered take of the current text. */
  readonly take: Take | null
}

/** How a line's unit stands against its current text. */
export const standingOf = (line: ScriptLine, unit: AudioUnit | null): Standing => {
  if (unit === null || unit.takes.length === 0) return { state: "missing", take: null }
  const current = unit.takes.filter((take) => take.textHash === line.textHash)
  if (current.length === 0) return { state: "stale", take: null }
  return { state: "voiced", take: current.find((take) => take.n === unit.selected) ?? current[0]! }
}

/** Whether two texts are the same words in the same order, spacing aside. */
export const sameWords = (a: string, b: string): boolean => a.split(/\s+/).filter(Boolean).join(" ") === b.split(/\s+/).filter(Boolean).join(" ")
