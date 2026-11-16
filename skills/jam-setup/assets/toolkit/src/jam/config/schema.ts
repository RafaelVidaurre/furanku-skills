// jam.config.json (project policy, tracked) and jam.local.json (this machine's paths, ignored).
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { AudioConfig } from "../audio/schema.ts"
import { Amount, Id, PortablePath, Positive, PositiveInt, Text } from "../common.ts"
import { Facts } from "../engine/schema.ts"
import { SkeletonProfile } from "../rig/landmarks.ts"

const opt = Schema.optionalKey
const withDefault = <S extends Schema.Top>(schema: S, value: S["Encoded"]) => schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)))

const isPowerOfTwo = (n: number): boolean => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0

/** What a delivered asset may cost at run time. Conventions (units, axes) belong to the engine adapter. */
export const Budget = Schema.Struct({
  kind: Schema.Literals(["static", "deforming"]),
  triangles: Schema.Struct({ target: PositiveInt, max: PositiveInt }),
  textureSize: PositiveInt.pipe(Schema.annotate({ description: "Largest texture dimension, a power of two" })),
  maxMaterials: PositiveInt,
  maxTextureMiB: Positive.pipe(Schema.annotate({ description: "Decoded RGBA8 texture memory with full mip chains, in MiB" })),
  skeleton: opt(Text.pipe(Schema.annotate({ description: "Name of a skeleton profile: under skeletons in this file, else in the engine adapter's facts. Absent: the landmark hierarchy." }))),
  maxInfluences: opt(PositiveInt),
  poses: opt(Text.pipe(Schema.annotate({ description: "Poses the deformation evidence must show (deforming budgets)" }))),
  context: opt(Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({
    description: "Why the numbers are what they are: platforms, renderer, camera, expected instances. Not enforced."
  })))
}).pipe(
  Schema.annotate({ identifier: "Budget" }),
  Schema.check(Schema.makeFilter((budget) =>
    budget.triangles.target > budget.triangles.max
      ? "triangles.target must not exceed triangles.max"
      : !isPowerOfTwo(budget.textureSize)
      ? "textureSize must be a power of two"
      : budget.kind === "deforming" && (budget.maxInfluences === undefined || budget.poses === undefined)
      ? "a deforming budget needs maxInfluences and poses"
      : undefined
  ))
)
export type Budget = typeof Budget.Type

const Cap = Schema.NullOr(Amount)

export const Spend = Schema.Struct({
  perRun: Cap.pipe(Schema.annotate({ description: "Most one run may spend with this provider, in the provider's own unit. null: no cap. 0: paid work disabled." })),
  total: withDefault(Cap.pipe(Schema.annotate({ description: "Most all runs together may spend. null: no cap. 0: paid work disabled." })), null),
  standing: opt(Text.pipe(Schema.annotate({
    description: "The person's own words authorising work inside the caps without asking each time, with who and when"
  })))
})
export type Spend = typeof Spend.Type

export const REVIEW_MODES = ["recipe", "agent", "none"] as const
export type ReviewMode = typeof REVIEW_MODES[number]

export const CommandCheck = Schema.Struct({
  run: Schema.NonEmptyArray(Schema.String).pipe(Schema.annotate({
    description: "Program and arguments, run from the project root with no shell. {file:<role>} (one file) and {files:<role>} (each as its own argument) are the record's files with that role, {run} the run file, {dir} the run folder: all project-relative with forward slashes. {id} and {step} are the subject and step ids. It prints {\"problems\": [{\"message\", \"fix\"?}]} and exits 0; an empty list passes."
  })),
  when: opt(Schema.Literals(["record", "status"]).pipe(Schema.annotate({
    description: "record (default): run once when the step is recorded. status: also every time status is read, so keep it fast."
  }))),
  description: opt(Schema.String)
})
export type CommandCheck = typeof CommandCheck.Type

export const JamConfig = Schema.Struct({
  $schema: opt(Schema.String),
  version: Schema.Literal(2),
  toolkit: PortablePath.pipe(Schema.annotate({ description: "Where the toolkit is installed in this project" })),
  roots: Schema.Struct({
    scratch: PortablePath.pipe(Schema.annotate({ description: "Git-ignored folder where runs work" })),
    delivered: PortablePath.pipe(Schema.annotate({ description: "Tracked folder accepted work is delivered into" })),
    scan: Schema.Array(PortablePath).pipe(Schema.annotate({ description: "Further folders searched for run files" }))
  }),
  style: withDefault(
    Schema.Struct({
      document: Schema.NullOr(PortablePath),
      revision: opt(Text.pipe(Schema.annotate({ description: "Name of the approved art direction. Changing it makes earlier work stale; editing the document does not." }))),
      references: Schema.Array(PortablePath)
    }),
    { document: null, references: [] }
  ),
  budgets: withDefault(Schema.Record(Id, Budget), {}),
  skeletons: withDefault(Schema.Record(Id, SkeletonProfile).pipe(Schema.annotate({
    description: "Skeleton profiles the project declares itself, for targets no engine adapter describes"
  })), {}),
  engine: withDefault(
    Schema.Struct({
      adapter: Schema.NullOr(Id).pipe(Schema.annotate({ description: "Engine adapter id: a folder under jam/engines/ or a preset the toolkit ships. null: glTF conventions." })),
      facts: Facts.pipe(Schema.annotate({ description: "Project overrides merged over the adapter's facts" }))
    }),
    { adapter: null, facts: {} }
  ),
  routes: withDefault(Schema.Record(Id, Id).pipe(Schema.annotate({ description: "Which provider serves each capability (image, mesh, sound, voice, ...)" })), {}),
  spend: withDefault(Schema.Record(Id, Spend).pipe(Schema.annotate({ description: "Spending caps per provider. A provider that is absent cannot be paid." })), {}),
  review: withDefault(
    Schema.Struct({
      mode: Schema.Literals(REVIEW_MODES).pipe(Schema.annotate({
        description: "recipe: each step's own gate. agent: no gate is stricter than agent review. none: work is recorded with no gate."
      }))
    }),
    { mode: "recipe" }
  ),
  checks: withDefault(Schema.Record(Id, CommandCheck).pipe(Schema.annotate({ description: "Project checks, each a command" })), {}),
  audio: withDefault(AudioConfig.pipe(Schema.annotate({ description: "Sound effects and voiced dialogue: where files live, the processed format and the loudness targets" })), {})
}).pipe(Schema.annotate({ identifier: "JamConfig", title: "jam.config.json" }))
export type JamConfig = typeof JamConfig.Type

export const LocalConfig = Schema.Struct({
  $schema: opt(Schema.String),
  python: opt(Text.pipe(Schema.annotate({ description: "Python executable: a name on PATH, an absolute path, or a project-relative path" }))),
  blender: opt(Text),
  ffmpeg: opt(Text),
  providers: opt(Schema.Record(Id, Text).pipe(Schema.annotate({ description: "Executable of a provider's CLI, by provider id" }))),
  aligner: opt(Schema.NonEmptyArray(Schema.String).pipe(Schema.annotate({
    description: "Program and arguments of the transcript aligner, when it is not the toolkit's own script run by this machine's Python. `python` and `node` resolve to the machine's own."
  }))),
  engine: opt(Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({
    description: "How this machine reaches the engine (editor path, host, port). Passed to adapter commands; never credentials."
  })))
}).pipe(Schema.annotate({ identifier: "JamLocalConfig", title: "jam.local.json" }))
export type LocalConfig = typeof LocalConfig.Type

export type ToolName = "python" | "blender" | "ffmpeg"
