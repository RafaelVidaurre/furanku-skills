// Audio records and the files a project authors for them: the `audio` section of jam.config.json,
// dialogue line files, the speakers file, and the unit record every sound and voiced line has.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Amount, Id, PortablePath, PositiveInt, Stamp, SubjectId, Text } from "../common.ts"
import { LoudnessTarget } from "../engine/schema.ts"

const opt = Schema.optionalKey
const withDefault = <S extends Schema.Top>(schema: S, value: S["Encoded"]) => schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)))

/** The kinds of sound a loudness target is named for. */
export const TARGET_KINDS = ["effect", "loop", "voice"] as const
export type TargetKind = typeof TARGET_KINDS[number]

export const BIT_DEPTHS = [16, 24] as const

export const AudioConfig = Schema.Struct({
  roots: withDefault(
    Schema.Struct({
      sources: withDefault(PortablePath.pipe(Schema.annotate({ description: "Where originals are kept exactly as received or supplied" })), "Audio/Sources"),
      sfx: withDefault(PortablePath.pipe(Schema.annotate({ description: "Sound units: one folder per sound with its record and processed takes" })), "Audio/SFX"),
      voice: withDefault(PortablePath.pipe(Schema.annotate({ description: "Voiced lines: one folder per line with its record and processed takes" })), "Audio/Voice")
    }),
    {}
  ),
  lines: withDefault(Schema.Array(Text).pipe(Schema.annotate({ description: "Glob patterns of the dialogue line files (* within a folder, ** across folders)" })), ["Audio/Lines/*.json"]),
  speakers: withDefault(PortablePath.pipe(Schema.annotate({ description: "The file that lists speakers and the voice assigned to each" })), "Audio/speakers.json"),
  language: withDefault(Text.pipe(Schema.annotate({ description: "Language of lines that name none, as a BCP 47 code" })), "en"),
  format: opt(Schema.Struct({
    sampleRate: opt(PositiveInt),
    bitDepth: opt(Schema.Literals(BIT_DEPTHS))
  }).pipe(Schema.annotate({ description: "Processed WAV format when the engine adapter's audio facts state none (default 48000 Hz, 24-bit)" }))),
  loudness: opt(Schema.Struct({ effect: opt(LoudnessTarget), loop: opt(LoudnessTarget), voice: opt(LoudnessTarget) }).pipe(Schema.annotate({
    description: "Loudness targets by kind of sound, used when the engine adapter's audio facts state none"
  }))),
  homophones: opt(PortablePath.pipe(Schema.annotate({
    description: "Project file of same-sound spellings merged over the toolkit's list: {\"<language>\": {\"<as transcribed>\": \"<as written>\"}}"
  })))
}).pipe(Schema.annotate({ identifier: "AudioConfig" }))
export type AudioConfig = typeof AudioConfig.Type

/** The line id names a folder and files. */
export const LineId = SubjectId
/** Speakers are named as the project's writing names them. */
export const SpeakerId = SubjectId

export const Line = Schema.Struct({
  id: LineId,
  speaker: SpeakerId,
  text: Text.pipe(Schema.annotate({ description: "The words spoken, as authored. Editing them marks a voiced take stale." })),
  direction: opt(Schema.String.pipe(Schema.annotate({ description: "Acting note for people: gesture, pacing, intent. Never sent to a provider." }))),
  performance: opt(Schema.Record(Id, Text).pipe(Schema.annotate({
    description: "By provider id: the line's exact words with that provider's delivery markup. Sent instead of text."
  }))),
  review: opt(Schema.Union([Schema.String, Schema.Boolean]).pipe(Schema.annotate({
    description: "A person's mark that the words are final: true or \"reviewed\" (any case). Anything else is unreviewed."
  }))),
  language: opt(Text),
  extra: opt(Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({ description: "Anything else the project keeps with the line" })))
}).pipe(Schema.annotate({ identifier: "DialogueLine" }))
export type Line = typeof Line.Type

export const LinesFile = Schema.Struct({
  $schema: opt(Schema.String),
  title: opt(Schema.String),
  language: opt(Text.pipe(Schema.annotate({ description: "Language of this file's lines (default: audio.language)" }))),
  lines: Schema.Array(Line),
  extra: opt(Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({ description: "Anything else the project keeps with the file" })))
}).pipe(Schema.annotate({ identifier: "DialogueLines", title: "Dialogue lines (a file matched by audio.lines)" }))
export type LinesFile = typeof LinesFile.Type

export const VoiceRef = Schema.Struct({
  provider: Id,
  id: Text.pipe(Schema.annotate({ description: "The provider's id of the voice" })),
  name: opt(Schema.String),
  settings: opt(Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({ description: "Provider settings used for every line in this voice" })))
})
export type VoiceRef = typeof VoiceRef.Type

export const Speaker = Schema.Struct({
  id: SpeakerId,
  name: opt(Schema.String),
  voice: opt(VoiceRef),
  extra: opt(Schema.Record(Schema.String, Schema.Unknown))
})
export type Speaker = typeof Speaker.Type

export const SpeakersFile = Schema.Struct({
  $schema: opt(Schema.String),
  speakers: Schema.Array(Speaker)
}).pipe(Schema.annotate({ identifier: "Speakers", title: "Speakers and their voices (audio.speakers)" }))
export type SpeakersFile = typeof SpeakersFile.Type

export const AudioFacts = Schema.Struct({
  duration: Schema.Finite.pipe(Schema.annotate({ description: "Seconds" })),
  channels: PositiveInt,
  sampleRate: PositiveInt,
  bitDepth: PositiveInt,
  integratedLufs: Schema.NullOr(Schema.Finite).pipe(Schema.annotate({ description: "Programme loudness; null when the file is too short to measure" })),
  momentaryMaxLufs: Schema.Finite.pipe(Schema.annotate({ description: "Loudest 400 ms window" })),
  truePeakDb: Schema.NullOr(Schema.Finite)
})
export type AudioFacts = typeof AudioFacts.Type

export const Level = Schema.Struct({
  target: Schema.Literals(TARGET_KINDS),
  measure: Schema.Literals(["integrated", "momentary-max"]),
  reference: Schema.Finite.pipe(Schema.annotate({ description: "The target loudness in LUFS when this was processed" })),
  ceiling: Schema.Finite.pipe(Schema.annotate({ description: "The true-peak ceiling in dBTP when this was processed" })),
  level: Schema.Finite.pipe(Schema.annotate({ description: "The loudness reached" })),
  belowReference: Schema.Finite,
  limitedBy: opt(Schema.Literals(["true-peak", "matched"]).pipe(Schema.annotate({
    description: "Why the level is under the reference: its own peak, or a sibling variant's peak (variants share one level)"
  })))
})
export type Level = typeof Level.Type

export const Processing = Schema.Struct({
  loop: Schema.Boolean.pipe(Schema.annotate({ description: "A loop or bed: never trimmed" })),
  stereo: Schema.Boolean,
  window: Schema.NullOr(Schema.Struct({
    start: Schema.Finite,
    end: Schema.Finite,
    by: Schema.Literals(["auto", "trim"])
  })).pipe(Schema.annotate({ description: "The part of the original kept, in seconds of the original; null keeps all of it" })),
  fadeOutMs: opt(Schema.Finite),
  tighten: opt(Schema.Struct({ atDb: Schema.Finite, fadeMs: Schema.Finite }).pipe(Schema.annotate({
    description: "Room tail faded out once the sound has decayed atDb below its loudest moment"
  })))
})
export type Processing = typeof Processing.Type

export const Generation = Schema.Struct({
  origin: Schema.Literals(["generated", "supplied"]),
  provider: opt(Schema.String),
  model: opt(Schema.String),
  prompt: opt(Schema.String.pipe(Schema.annotate({ description: "Sound: the prompt sent" }))),
  text: opt(Schema.String.pipe(Schema.annotate({ description: "Voice: the text sent, with any delivery markup" }))),
  voice: opt(Schema.Struct({ id: Schema.String, name: opt(Schema.String) })),
  settings: opt(Schema.Record(Schema.String, Schema.Unknown)),
  run: opt(Schema.String.pipe(Schema.annotate({ description: "The run whose ledger paid, as <id>:<n>" }))),
  job: opt(Schema.String),
  providerJob: opt(Schema.String),
  request: opt(Stamp),
  charge: opt(Amount),
  unit: opt(Schema.String),
  creator: opt(Schema.String),
  license: opt(Schema.String),
  source: opt(Schema.String.pipe(Schema.annotate({ description: "Supplied: where the file came from, in the supplier's words" }))),
  at: Schema.String
})
export type Generation = typeof Generation.Type

export const Word = Schema.Struct({ word: Schema.String, start: Schema.Finite, end: Schema.Finite })
export type Word = typeof Word.Type

export const Transcript = Schema.Struct({
  status: Schema.Literals(["match", "mismatch", "by-ear"]).pipe(Schema.annotate({
    description: "match / mismatch: an independent transcription compared with the text. by-ear: no transcription ran; a person listened and accepted it."
  })),
  language: Schema.String,
  heard: opt(Schema.String.pipe(Schema.annotate({ description: "What the transcriber wrote" }))),
  wordErrorRate: opt(Schema.Finite),
  alignment: opt(Schema.Literals(["forced", "proportional"]).pipe(Schema.annotate({
    description: "forced: word timings aligned to the audio. proportional: the aligner failed and timings are spread by word length."
  }))),
  alignmentError: opt(Schema.String),
  tool: opt(Schema.String),
  accepted: opt(Schema.Struct({ channel: Schema.String, words: Schema.String }).pipe(Schema.annotate({
    description: "by-ear: where the person answered and what they said, verbatim"
  }))),
  at: Schema.String
})
export type Transcript = typeof Transcript.Type

export const Take = Schema.Struct({
  n: PositiveInt,
  file: PortablePath.pipe(Schema.annotate({ description: "The processed WAV" })),
  sha256: Schema.String,
  original: Stamp.pipe(Schema.annotate({ description: "The file as received or supplied, never rewritten" })),
  generation: Generation,
  processing: Processing,
  facts: AudioFacts,
  level: Level,
  textHash: opt(Schema.String.pipe(Schema.annotate({ description: "Voice: SHA-256 of the line's text when this take was made" }))),
  words: opt(Schema.Array(Word).pipe(Schema.annotate({ description: "Voice: when each authored word is spoken, in seconds of the processed file" }))),
  transcript: opt(Transcript)
})
export type Take = typeof Take.Type

export const Variant = Schema.Struct({
  n: PositiveInt,
  file: PortablePath,
  sha256: Schema.String,
  from: PositiveInt.pipe(Schema.annotate({ description: "The take it was cut from" })),
  start: opt(Schema.Finite.pipe(Schema.annotate({ description: "Seconds into that take; absent when the variant is the whole take" }))),
  end: opt(Schema.Finite),
  facts: AudioFacts,
  level: Level
})
export type Variant = typeof Variant.Type

export const UNIT_FILE = "unit.json"

export const AudioUnit = Schema.Struct({
  $schema: opt(Schema.String),
  version: Schema.Literal(1),
  id: Schema.String.pipe(Schema.annotate({ description: "sfx/<name> or voice/<script>/<line id>" })),
  kind: Schema.Literals(["sfx", "voice"]),
  name: Schema.String.pipe(Schema.annotate({ description: "Display name: the sound's title, or the line's text" })),
  target: Schema.Literals(TARGET_KINDS).pipe(Schema.annotate({ description: "Which loudness target its files are processed to" })),
  line: opt(Schema.Struct({
    script: Schema.String,
    file: PortablePath,
    id: Schema.String,
    speaker: Schema.String,
    text: Schema.String,
    textHash: Schema.String,
    language: Schema.String
  }).pipe(Schema.annotate({ description: "Voice: the authored line as it was when last voiced or processed" }))),
  selected: opt(PositiveInt.pipe(Schema.annotate({ description: "Voice: the take that stands for the line (default: the lowest-numbered current take)" }))),
  takes: Schema.Array(Take),
  variants: Schema.Array(Variant)
}).pipe(Schema.annotate({ identifier: "AudioUnit", title: "Sound or voiced-line record (unit.json). Written by the tool; do not edit by hand." }))
export type AudioUnit = typeof AudioUnit.Type
