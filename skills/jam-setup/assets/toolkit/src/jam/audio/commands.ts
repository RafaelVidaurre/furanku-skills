// `jam audio sfx …` and `jam audio voice …`.
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Effect from "effect/Effect"
import { Output } from "../../kernel/cli.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { described, flag, many, maybe, text } from "../cliSupport.ts"
import type { RecordResult } from "../runs/record.ts"
import { lines, pairs, table } from "../text.ts"
import type { Availability } from "./Aligner.ts"
import type { Level } from "./schema.ts"
import * as Sfx from "./sfx.ts"
import { overview } from "./overview.ts"
import * as Voice from "./voice.ts"

const settingsOf = (pairsGiven: ReadonlyArray<string>): Effect.Effect<Record<string, unknown>, ToolError> =>
  Effect.gen(function*() {
    const out: Record<string, unknown> = {}
    for (const pair of pairsGiven) {
      const at = pair.indexOf("=")
      if (at <= 0) return yield* fail("invalid", `--setting ${pair}: expected name=value, e.g. influence=0.8`)
      const value = pair.slice(at + 1)
      try {
        out[pair.slice(0, at)] = JSON.parse(value) as unknown
      } catch {
        out[pair.slice(0, at)] = value
      }
    }
    return out
  })

const levelText = (level: Level): string =>
  `${level.level} LUFS${level.belowReference > 0.1 ? ` (${level.belowReference} under ${level.reference}${level.limitedBy === undefined ? "" : `, held by ${level.limitedBy === "matched" ? "a sibling's peak" : "its peak"}`})` : ""}`

const recordedText = (recorded: RecordResult | undefined): string | null =>
  recorded === undefined ? null : `recorded ${recorded.records.map((entry) => `${entry.step} (${entry.state})`).join(", ")} on run ${recorded.id}`

const warningLines = (warnings: ReadonlyArray<string>): ReadonlyArray<string> => warnings.map((warning) => `warning: ${warning}`)

const nameArg = Argument.String("name").pipe(Argument.withDescription("The sound's name: lowercase words joined by hyphens, e.g. vase-break"))
const takeFlag = Flag.Int("take").pipe(Flag.withDescription("Which take (default: the only one)"), Flag.optional)
const shapeFlags = {
  loop: flag("loop", "A seamless loop or bed: never trimmed, levelled to the loop target"),
  stereo: flag("stereo", "Keep stereo (beds, non-positional sounds); the default is mono"),
  tighten: flag("tighten", "Fade the room tail once it has decayed 30 dB (contact sounds: steps, bumps, impacts)"),
  title: text("title", "Display name")
}
const runFlag = (what: string) => text("run", `The run whose ledger pays (default: ${what})`)
const authorizedFlag = text("authorized", "Who approved this spending, when, in their words (default: the provider's standing authorization)")
const dryRunFlag = flag("dry-run", "Print what would be sent and its cost; send nothing")

const generate = Command.make("generate", {
  name: nameArg,
  prompt: Flag.String("prompt").pipe(Flag.withDescription("What makes the sound, as one physical event; the provider's document says how to word it")),
  run: runFlag("the run whose subject is the sound's name"),
  takes: Flag.Int("takes").pipe(Flag.withDescription("How many takes to request, 1 to 5; each is charged"), Flag.withDefault(1)),
  duration: Flag.Finite("duration").pipe(Flag.withDescription("Length in seconds; left out, the provider chooses"), Flag.optional),
  setting: many("setting", "A provider setting as name=value; the provider's document lists them. Repeat per setting."),
  provider: text("provider", "Provider id (default: routes.sound)"),
  authorized: authorizedFlag,
  dryRun: dryRunFlag,
  ...shapeFlags
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Sfx.generate({
      name: input.name, prompt: input.prompt, run: maybe(input.run), takes: input.takes, duration: maybe(input.duration), settings: yield* settingsOf(input.setting),
      provider: maybe(input.provider), authorized: maybe(input.authorized), dryRun: input.dryRun, loop: input.loop, stereo: input.stereo, tighten: input.tighten, title: maybe(input.title)
    })
    yield* (yield* Output).emit(result, lines(
      result.planned !== undefined ? `${result.id}: would request ${result.spending.requests} take${result.spending.requests === 1 ? "" : "s"} from ${result.spending.provider} (${result.model})` : null,
      `cost: ${result.spending.words}${result.planned === undefined ? `; charged ${result.charged} ${result.spending.unit}` : ""}`,
      result.takes.length === 0 ? null : table(["take", "file", "seconds", "level", "job"], result.takes.map((take) => [String(take.take), take.file, take.duration.toFixed(2), levelText(take.level), take.job])),
      ...warningLines(result.warnings),
      result.refused === undefined ? null : `refused by the provider: ${result.refused}`,
      recordedText(result.recorded),
      `next: ${result.next}`
    ))
  })).pipe(described(
    "Generate takes of a sound with the sound provider, paid through a run's ledger, and process each to the loudness target. The original of every take is kept. Needs a run: jam run start sfx <name> --brief-text \"...\".",
    `jam audio sfx generate vase-break --prompt "Ceramic vase shattering on a wooden floor, close and dry" --duration 2 --takes 2`
  ))

const add = Command.make("add", {
  name: nameArg,
  file: Flag.String("file").pipe(Flag.withDescription("Project path of the audio file (copy a file from elsewhere into the project first)")),
  prompt: text("prompt", "The prompt it was made with, when it was generated elsewhere"),
  creator: text("creator", "Who made it"),
  license: text("license", "The rights the project has over it"),
  source: text("source", "Where it came from"),
  ...shapeFlags
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Sfx.add({
      name: input.name, file: input.file, prompt: maybe(input.prompt), creator: maybe(input.creator), license: maybe(input.license), source: maybe(input.source),
      loop: input.loop, stereo: input.stereo, tighten: input.tighten, title: maybe(input.title)
    })
    yield* (yield* Output).emit(result, lines(
      `${result.id}: take ${result.take.take} is ${result.take.file} (${result.take.duration.toFixed(2)} s, ${levelText(result.take.level)}); original kept at ${result.take.original}`,
      ...warningLines(result.warnings),
      `next: ${result.next}`
    ))
  })).pipe(described(
    "Add a sound made outside the tools (recorded, bought, made in a provider's app) as a take: its file is kept as the original and processed like any other. Costs nothing and needs no run.",
    `jam audio sfx add door-creak --file inbox/door-creak.wav --creator "Sam" --license "own recording"`
  ))

const split = Command.make("split", {
  name: nameArg,
  take: takeFlag,
  minGap: Flag.Finite("min-gap").pipe(Flag.withDescription("Milliseconds the level must stay down between two events (default 120)"), Flag.optional),
  rise: Flag.Finite("rise").pipe(Flag.withDescription("dB an event must rise above the noise floor (default 18); lower it for a continuous sound whose parts never fall silent"), Flag.optional),
  dryRun: flag("dry-run", "List the events found and write nothing"),
  preview: text("preview", "Project path of a PNG to draw: the waveform with each event shaded")
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Sfx.split({ name: input.name, take: maybe(input.take), minGapMs: maybe(input.minGap), riseDb: maybe(input.rise), dryRun: input.dryRun, preview: maybe(input.preview) })
    yield* (yield* Output).emit(result, lines(
      `${result.id}: ${result.events.length} event${result.events.length === 1 ? "" : "s"} in ${result.take} (noise floor ${result.floorDb} dB)`,
      table(["event", "start", "end", "onset", "peak dB"], result.events.map((event) => [String(event.variant), event.start.toFixed(3), event.end.toFixed(3), event.onset.toFixed(3), String(event.peakDb)])),
      result.preview === undefined ? null : `preview: ${result.preview}`,
      result.variants === undefined ? null : `wrote ${result.variants.length} level-matched variants:\n${result.variants.map((variant) => `  ${variant.file}  ${levelText(variant.level)}`).join("\n")}`,
      `next: ${result.next}`
    ))
  })).pipe(described(
    "Cut one take that holds several separate events (a run of footsteps, a few knocks) into level-matched variants, one per event. Look first: --dry-run --preview draws what it found. Splitting again replaces the variants.",
    "jam audio sfx split footsteps-gravel --dry-run --preview work/footsteps.png"
  ))

const variants = Command.make("variants", {
  name: nameArg,
  takes: Flag.String("takes").pipe(Flag.withDescription("The takes to use, as numbers separated by commas, e.g. 1,2,4"))
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Sfx.variantsFromTakes({ name: input.name, takes: input.takes.split(",").map((part) => part.trim()).filter((part) => part !== "").map(Number) })
    yield* (yield* Output).emit(result, `${result.id}: ${result.variants.length} level-matched variants\n${result.variants.map((variant, index) => `  ${variant.file}  from ${result.from[index]}  ${levelText(variant.level)}`).join("\n")}`)
  })).pipe(described(
    "Make chosen whole takes the level-matched variants of a sound: one event per take is the reliable way to get variants. Replaces earlier variants.",
    "jam audio sfx variants glass-knock --takes 1,2,4"
  ))

const editText = (verb: string, result: Sfx.EditResult): string =>
  lines(`${result.id}: take ${result.take.take} ${verb}; now ${result.take.duration.toFixed(2)} s at ${levelText(result.take.level)} (${result.take.file})`, ...warningLines(result.warnings))

const trim = Command.make("trim", {
  name: nameArg,
  take: takeFlag,
  start: Flag.Finite("start").pipe(Flag.withDescription("Seconds into the take where it should begin (default 0)"), Flag.optional),
  end: Flag.Finite("end").pipe(Flag.withDescription("Seconds into the take where it should end (default: its end)"), Flag.optional)
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Sfx.trim({ name: input.name, take: maybe(input.take), start: maybe(input.start), end: maybe(input.end) })
    yield* (yield* Output).emit(result, editText("trimmed", result))
  })).pipe(described(
    "Keep only part of a take, with short fades, for feedback such as \"there is a noise at the end\". The take is processed again from its original, so trimming twice loses nothing.",
    "jam audio sfx trim wine-pour --take 1 --end 1.85"
  ))

const tighten = Command.make("tighten", {
  name: nameArg,
  take: takeFlag,
  atDb: Flag.Finite("at-db").pipe(Flag.withDescription("How far the sound must decay below its loudest moment before the fade starts (default 30)"), Flag.optional),
  fadeMs: Flag.Finite("fade-ms").pipe(Flag.withDescription("Length of the fade in milliseconds (default 100)"), Flag.optional)
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Sfx.tighten({ name: input.name, take: maybe(input.take), atDb: maybe(input.atDb), fadeMs: maybe(input.fadeMs) })
    yield* (yield* Output).emit(result, editText("tightened", result))
  })).pipe(described(
    "Fade out a take's room tail, for feedback such as \"it has reverb\": generators add room ring that rewording the prompt does not remove. Leave it off when the tail is part of the event (shards after a break, a pour).",
    "jam audio sfx tighten footstep-wood --take 2"
  ))

const reprocess = Command.make("reprocess", {
  names: Argument.String("name").pipe(Argument.withDescription("Sounds to process again"), Argument.variadic()),
  all: flag("all", "Every sound")
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Sfx.reprocess({ names: input.names, all: input.all })
    yield* (yield* Output).emit(result, lines(
      `processed again from the originals: ${result.units.length} sound${result.units.length === 1 ? "" : "s"}`,
      ...result.units.map((unit) => `  ${unit.id}: ${unit.files.map((file) => `${file.file.split("/").at(-1)} ${file.level}`).join(", ")}`),
      `next: ${result.next}`
    ))
    if (result.problems.length > 0) return yield* fail("conflict", `${result.problems.length} file${result.problems.length === 1 ? " was" : "s were"} left as they are: ${result.problems.join("; ")}`, { fix: "restore the missing originals from Git, then reprocess those sounds again" })
  })).pipe(described(
    "Process existing sounds again from their originals with the settings now in force, after a loudness target, the sample rate or the bit depth changed. Trims, tightening and variant cuts are kept.",
    "jam audio sfx reprocess --all"
  ))

const show = Command.make("show", { name: Argument.String("name").pipe(Argument.withDescription("One sound; left out: every sound"), Argument.optional) }, (input) =>
  Effect.gen(function*() {
    const result = yield* Sfx.show(maybe(input.name))
    yield* (yield* Output).emit(result, result.sounds.length === 0 ? "(no sounds yet)" : result.sounds.map((sound) =>
      lines(
        `${sound.id}: ${sound.name} (${sound.target})`,
        table(["take", "file", "seconds", "level", "origin", "original"], sound.takes.map((take) => [String(take.take), take.file, take.duration.toFixed(2), levelText(take.level), take.origin, take.original])),
        sound.variants.length === 0 ? null : table(["variant", "file", "seconds", "level", "from take"], sound.variants.map((variant) => [String(variant.variant), variant.file, variant.duration.toFixed(2), levelText(variant.level), String(variant.from)]))
      )).join("\n\n"))
  })).pipe(described("List sounds with their takes, variants, levels and originals.", "jam audio sfx show vase-break"))

const sfx = Command.make("sfx").pipe(
  Command.withDescription("Sound effects: generate or add takes, cut variants, trim, tighten, reprocess"),
  Command.withSubcommands([generate, add, split, variants, trim, tighten, reprocess, show])
)

const checkText = (check: Availability | null): string | null =>
  check === null ? null : check.available ? `transcript check: ${check.tool}` : `transcript check: unavailable (${check.reason}); install: ${check.install}`

const lineTable = (rows: ReadonlyArray<Voice.LineRow>): string =>
  table(["line", "speaker", "state", "reviewed", "voice", "take", "transcript", "timings", "needs"], rows.map((row) => [
    row.line, row.speaker, row.state, row.reviewed ? "yes" : "no", row.voice ?? "-", row.take === null ? "-" : String(row.take), row.transcript ?? "-", row.timings ?? "-", row.needs.join(", ") || "-"
  ]))

const linesArg = Argument.String("line").pipe(Argument.withDescription("Lines as <lines file name>/<line id>, or the id alone when only one file has it"), Argument.variadic())

const status = Command.make("status", {
  script: text("script", "Only this lines file (its name without .json)"),
  speaker: text("speaker", "Only this speaker's lines")
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Voice.status({ script: maybe(input.script), speaker: maybe(input.speaker) })
    const { counts } = result
    yield* (yield* Output).emit(result, lines(
      lineTable(result.lines),
      `${counts.lines} lines: ${counts.voiced} voiced, ${counts.missing} missing, ${counts.stale} stale, ${counts.mismatched} mismatched, ${counts.unchecked} unchecked, ${counts.unreviewed} unreviewed, ${counts.noVoice} without a voice`
    ))
  })).pipe(described(
    "List every dialogue line with where it stands: missing (no take), stale (its text changed after it was voiced) or voiced; whether a person marked its words reviewed; whether its take matches the text.",
    "jam audio voice status --script intro"
  ))

const voices = Command.make("voices", { search: text("search", "Narrow by name, description or label"), provider: text("provider", "Provider id (default: routes.voice)") }, (input) =>
  Effect.gen(function*() {
    const result = yield* Voice.voices({ search: maybe(input.search), provider: maybe(input.provider) })
    yield* (yield* Output).emit(result, lines(
      table(["voice id", "name", "category", "description", "listen"], result.voices.map((voice) => [voice.id, voice.name, voice.category ?? "-", (voice.description ?? "-").slice(0, 60), voice.preview ?? "-"])),
      ...Object.entries(result.links).map(([what, url]) => `${what}: ${url}`)
    ))
  })).pipe(described("List the voices the voice provider's account can use, with a link to hear each. The person chooses; this call is free.", `jam audio voice voices --search "gravelly"`))

const assign = Command.make("assign", {
  speaker: Argument.String("speaker").pipe(Argument.withDescription("Speaker id as the lines name it")),
  voice: Flag.String("voice").pipe(Flag.withDescription("The provider's id of the voice")),
  provider: text("provider", "Provider id (default: routes.voice)"),
  name: text("name", "The voice's name, when you already found it through the provider; skips the lookup"),
  setting: many("setting", "A provider voice setting as name=value, used for every line in this voice. Repeat per setting.")
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Voice.assign({ speaker: input.speaker, voice: input.voice, provider: maybe(input.provider), name: maybe(input.name), settings: yield* settingsOf(input.setting) })
    yield* (yield* Output).emit(result, `${result.speaker} speaks with ${result.voice.name ?? result.voice.id} (${result.voice.provider} ${result.voice.id}); written to ${result.file}`)
  })).pipe(described("Give a speaker a voice: the id is checked with the provider and written to the speakers file with its name.", "jam audio voice assign innkeeper --voice 21m00Tcm4TlvDq8ikWAM"))

const speak = Command.make("speak", {
  lines: linesArg,
  run: runFlag("for one line, the run whose subject is the line's id"),
  reviewed: flag("reviewed", "Only lines a person marked reviewed"),
  speaker: text("speaker", "Only this speaker's lines"),
  script: text("script", "Only this lines file"),
  takes: Flag.Int("takes").pipe(Flag.withDescription("Takes per line, 1 to 5; each is charged"), Flag.withDefault(1)),
  authorized: authorizedFlag,
  dryRun: dryRunFlag
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Voice.speak({
      lines: input.lines, run: maybe(input.run), reviewed: input.reviewed, speaker: maybe(input.speaker), script: maybe(input.script), takes: input.takes, authorized: maybe(input.authorized), dryRun: input.dryRun
    })
    yield* (yield* Output).emit(result, lines(
      ...result.spending.map((entry) => `cost: ${entry.words}`),
      result.planned === undefined ? null : table(["line", "speaker", "voice", "takes", "at most", "text sent"], result.planned.map((plan) => [plan.line, plan.speaker, plan.voice, String(plan.takes), String(plan.estimate), plan.text])),
      result.spoken.length === 0 ? null : table(["line", "take", "file", "seconds", "transcript", "job"], result.spoken.map((row) => [row.line, String(row.take), row.file, row.duration.toFixed(2), row.transcript, row.job])),
      ...result.spoken.filter((row) => row.heard !== undefined).map((row) => `mismatch: ${row.line} take ${row.take} was heard as ${JSON.stringify(row.heard)}`),
      result.planned === undefined && result.spending.length > 0 ? `charged ${result.charged} ${result.spending[0]!.unit}` : null,
      result.unreviewed.length === 0 ? null : `not marked reviewed, so their words may still change: ${result.unreviewed.join(", ")}`,
      checkText(result.transcriptCheck),
      ...warningLines(result.warnings),
      result.refused === undefined ? null : `refused by the provider: ${result.refused}`,
      recordedText(result.recorded),
      `next: ${result.next}`
    ))
  })).pipe(described(
    "Voice dialogue lines with each speaker's assigned voice, paid through a run's ledger. Without lines: every missing or stale line. Each take is processed to the voice target and checked against its text where the transcript check is installed.",
    "jam audio voice speak --run intro-lines --script intro --reviewed"
  ))

const process = Command.make("process", {
  lines: linesArg,
  all: flag("all", "Every line that has a take (after the voice target or the audio format changed)"),
  run: text("run", "Record the processed lines on this run's process step; without lines, the lines this run voiced"),
  step: text("step", "The step to record (default: process)"),
  file: text("file", "Project path of a recording to add as a new take of the one named line"),
  take: Flag.Int("take").pipe(Flag.withDescription("Make this take stand for the one named line"), Flag.optional),
  byEar: text("by-ear", "A person listened to the named lines and accepted them: \"<where they answered>: <their words>\""),
  recheck: flag("recheck", "Run the transcript check again for takes that already have a result"),
  creator: text("creator", "With --file: who recorded it"),
  license: text("license", "With --file: the rights the project has over it"),
  source: text("source", "With --file: where it came from"),
  sourceEvidence: text("source-evidence", "With --run on a run that starts at this step: the document showing where the recordings came from and the right to use them")
}, (input) =>
  Effect.gen(function*() {
    const result = yield* Voice.processLines({
      lines: input.lines, all: input.all, run: maybe(input.run), step: maybe(input.step), file: maybe(input.file), take: maybe(input.take), byEar: maybe(input.byEar), recheck: input.recheck,
      creator: maybe(input.creator), license: maybe(input.license), source: maybe(input.source), sourceEvidence: maybe(input.sourceEvidence)
    })
    yield* (yield* Output).emit(result, lines(
      lineTable(result.lines),
      ...result.lines.filter((row) => row.heard !== undefined).map((row) => `mismatch: ${row.line} was heard as ${JSON.stringify(row.heard)}`),
      checkText(result.transcriptCheck),
      ...result.problems.map((problem) => `problem: ${problem}`),
      recordedText(result.recorded),
      `next: ${result.next}`
    ))
  })).pipe(described(
    "Settle the take that stands for each line: bring it to the voice target, align its words, compare a transcription with the text, and with --run record the lines on the run. Also adds a recording as a take (--file), picks a take (--take), or notes a person's acceptance by ear (--by-ear).",
    "jam audio voice process --run intro-lines"
  ))

const voice = Command.make("voice").pipe(
  Command.withDescription("Voiced dialogue: line status, voices, speaking lines, settling and checking takes"),
  Command.withSubcommands([status, voices, assign, speak, process])
)

const settings = Command.make("settings", {}, () =>
  Effect.gen(function*() {
    const result = yield* overview
    yield* (yield* Output).emit(result, lines(
      pairs([["format", `${result.format.sampleRate} Hz, ${result.format.bitDepth}-bit WAV (${result.format.source})`]]),
      table(["kind", "measure", "LUFS", "ceiling dBTP", "from"], Object.values(result.targets).map((target) => [target.kind, target.measure, String(target.lufs), String(target.truePeakDb), target.source])),
      table(["route", "provider", "guide", "spending"], result.routes.map((route) => [route.route, route.provider ?? "not routed", route.guide ?? "-", route.spending ?? `jam config set routes.${route.route} <provider>`])),
      pairs([["sounds", result.roots.sfx], ["voiced lines", result.roots.voice], ["originals", result.roots.sources], ["lines files", result.lines.join(", ")], ["speakers", result.speakers]]),
      checkText(result.transcriptCheck)
    ))
  })).pipe(described(
    "Show what audio work in this project runs on: the processed format and each kind's loudness target with where it comes from, the provider of the sound and voice routes with its guide and spending caps, where files live, and whether the transcript check is installed.",
    "jam audio settings"
  ))

export const audio = Command.make("audio").pipe(
  Command.withDescription("Sound effects and voiced dialogue: generate, process to loudness targets, check, keep originals"),
  Command.withSubcommands([sfx, voice, settings])
)

