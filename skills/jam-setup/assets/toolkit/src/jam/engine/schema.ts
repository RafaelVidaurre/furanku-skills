// The engine adapter contract: facts an engine imposes, the commands an adapter can run, and the
// receipts those commands print. Asset skills read facts and call commands through `jam engine`;
// nothing outside an adapter names an engine.
import * as Schema from "effect/Schema"
import { Id, PortablePath, Positive, PositiveInt, Text } from "../common.ts"
import { SkeletonProfile } from "../rig/landmarks.ts"

const Axis = Schema.Literals(["+X", "-X", "+Y", "-Y", "+Z", "-Z"])
const Vector = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])
const opt = Schema.optionalKey

/** How loud one kind of sound is made: which loudness is measured, where it is put, and the peak it may not pass. */
export const LoudnessTarget = Schema.Struct({
  measure: Schema.Literals(["integrated", "momentary-max"]).pipe(Schema.annotate({
    description: "integrated: programme loudness of the whole file. momentary-max: its loudest 400 ms, so a short knock and a long hum set to the same value sound equally loud."
  })),
  lufs: Schema.Finite,
  truePeakDb: opt(Schema.Finite.pipe(Schema.annotate({ description: "True-peak ceiling in dBTP (default: the engine's or -1)" })))
})
export type LoudnessTarget = typeof LoudnessTarget.Type

/** Conventions of one engine. Every field is optional so a project can override a single one. */
export const Facts = Schema.Struct({
  unitsPerMeter: opt(Positive.pipe(Schema.annotate({ description: "Engine units in one meter (1 for glTF)" }))),
  up: opt(Axis),
  forward: opt(Axis),
  handedness: opt(Schema.Literals(["left", "right"])),
  contentRoot: opt(Schema.Union([Schema.Literal("."), PortablePath]).pipe(Schema.annotate({ description: "Project folder the engine imports into; \".\" when that is the project root" }))),
  assetId: opt(Schema.Struct({
    scheme: Text.pipe(Schema.annotate({ description: "Engine asset id with {path}, e.g. an engine package path" })),
    from: Text.pipe(Schema.annotate({ description: "Project file pattern with {path} that the id is derived from" }))
  })),
  mesh: opt(Schema.Struct({
    static: opt(Text.pipe(Schema.annotate({ description: "Interchange format for static meshes (file extension)" }))),
    skinned: opt(Text)
  })),
  textures: opt(Schema.Struct({
    normalGreen: opt(Schema.Literals(["up", "down"])),
    packed: opt(Text.pipe(Schema.annotate({ description: "Channel packing of the combined mask map, e.g. ORM" })))
  })),
  collision: opt(Schema.Struct({ convention: Text, prefix: opt(Schema.String) })),
  skeletons: opt(Schema.Record(Id, SkeletonProfile).pipe(Schema.annotate({ description: "Target skeletons this engine uses, by name. A budget names one." }))),
  audio: opt(Schema.Struct({
    container: opt(Text),
    sampleRate: opt(PositiveInt),
    channels: opt(PositiveInt),
    bitDepth: opt(PositiveInt),
    loudness: opt(Schema.Struct({
      integratedLufs: opt(Schema.Finite),
      truePeakDb: opt(Schema.Finite),
      targets: opt(Schema.Record(Id, LoudnessTarget).pipe(Schema.annotate({ description: "Targets by kind of sound (effect, loop, voice) where the engine or its mix sets them" })))
    }))
  })),
  naming: opt(Schema.Record(Schema.String, Schema.String).pipe(Schema.annotate({ description: "Name prefix per asset type" }))),
  binaries: opt(Schema.Struct({
    lfs: opt(Schema.Array(Text).pipe(Schema.annotate({ description: "Glob patterns of engine binaries to keep in Git LFS" }))),
    lockable: opt(Schema.Boolean)
  })),
  authoring: opt(Schema.Record(Schema.String, Schema.Struct({
    units: opt(Text),
    up: opt(Axis),
    forward: opt(Axis),
    pivot: opt(Text)
  })).pipe(Schema.annotate({ description: "Export conventions per budget, where they differ from the engine's own axes" }))),
  extra: opt(Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({ description: "Adapter-specific facts the toolkit passes through" })))
}).pipe(Schema.annotate({ identifier: "EngineFacts" }))
export type Facts = typeof Facts.Type

/** Facts after the default, the adapter and the project's overrides are merged. */
export interface ResolvedFacts extends Facts {
  readonly unitsPerMeter: number
  readonly up: typeof Axis.Type
  readonly forward: typeof Axis.Type
  readonly handedness: "left" | "right"
}

/** The commands every adapter may provide. An adapter may add its own beside them. */
export const VERBS = ["import", "inspect", "references", "capture", "check", "conform-skeleton"] as const
export type Verb = typeof VERBS[number]

export const AdapterCommand = Schema.Struct({
  run: Schema.NonEmptyArray(Schema.String).pipe(Schema.annotate({
    description: "Program and arguments. `python`, `blender` and `node` resolve to the machine's own; a path that exists in the adapter folder resolves there; {adapter}, {project} and {toolkit} are substituted. The command's own arguments are appended."
  })),
  kinds: opt(Schema.Array(Id).pipe(Schema.annotate({ description: "For import: the asset kinds this command accepts" }))),
  timeoutSeconds: opt(PositiveInt),
  description: opt(Schema.String)
})
export type AdapterCommand = typeof AdapterCommand.Type

export const Source = Schema.Struct({
  fact: Text.pipe(Schema.annotate({ description: "Dotted name of the fact, e.g. unitsPerMeter or textures.normalGreen" })),
  url: Text,
  says: opt(Schema.String.pipe(Schema.annotate({ description: "What the source states, quoted or summarised" })))
})

export const Adapter = Schema.Struct({
  $schema: opt(Schema.String),
  id: Id,
  label: Text,
  versions: opt(Text.pipe(Schema.annotate({ description: "Engine versions the adapter was written for, e.g. >=5.4" }))),
  facts: Facts,
  commands: opt(Schema.Record(Id, Schema.NullOr(AdapterCommand)).pipe(Schema.annotate({
    description: "By name. The standard commands are import, inspect, references, capture, check and conform-skeleton; any other name is the adapter's own, run with `jam engine run <name>`. A command prints one JSON receipt and exits 0, or exits 3 with a handoff. null (or absent) means: done by hand, following the matching guidance document."
  }))),
  docs: opt(Schema.Record(Schema.String, Schema.String).pipe(Schema.annotate({
    description: "Guidance documents by topic (import, inspect, acceptance, ...), relative to the adapter folder, or to the preset file for a shipped preset"
  }))),
  sources: opt(Schema.Array(Source).pipe(Schema.annotate({ description: "Where each fact comes from" })))
}).pipe(Schema.annotate({ identifier: "EngineAdapter", title: "Engine adapter (adapter.json or a shipped preset)" }))
export type Adapter = typeof Adapter.Type

/** What `import` prints. Reimporting the same source keeps the id. */
export const EngineAsset = Schema.Struct({
  id: Text.pipe(Schema.annotate({ description: "The engine's own id for the asset" })),
  kind: Text,
  source: opt(PortablePath),
  sha256: opt(Schema.String)
})
export type EngineAsset = typeof EngineAsset.Type

export const ImportReceipt = Schema.Struct({ assets: Schema.Array(EngineAsset) }).pipe(
  Schema.annotate({ identifier: "EngineImportReceipt", title: "Receipt printed by an adapter's import command" })
)
export type ImportReceipt = typeof ImportReceipt.Type

/** What `inspect <id>` prints. Lengths are meters whatever the engine's unit. */
export const InspectReceipt = Schema.Struct({
  id: Text,
  kind: opt(Text),
  source: opt(Schema.String.pipe(Schema.annotate({ description: "The file the asset was imported from" }))),
  bounds: opt(Schema.Struct({ min: Vector, max: Vector })),
  pivot: opt(Vector),
  triangles: opt(Schema.Int),
  vertices: opt(Schema.Int),
  materials: opt(Schema.Array(Schema.String).pipe(Schema.annotate({ description: "Material slot names, in slot order" }))),
  sections: opt(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)).pipe(Schema.annotate({ description: "Mesh sections, one object each (material, triangles, ...)" }))),
  lods: opt(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)).pipe(Schema.annotate({ description: "Levels of detail, one object each" }))),
  skeleton: opt(Schema.Struct({ root: opt(Schema.String), bones: opt(Schema.Array(Schema.String)) })),
  skeletonAsset: opt(Schema.String.pipe(Schema.annotate({ description: "The engine's id of the skeleton asset a skinned asset uses" }))),
  collision: opt(Schema.Struct({ shapes: Schema.Int, kinds: opt(Schema.Array(Schema.String)) })),
  details: opt(Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({ description: "Anything else the adapter reports, so it needs no side file" })))
}).pipe(Schema.annotate({ identifier: "EngineInspectReceipt", title: "Receipt printed by an adapter's inspect command" }))
export type InspectReceipt = typeof InspectReceipt.Type

/** What `references <id>...` prints. */
export const ReferencesReceipt = Schema.Struct({
  references: Schema.Array(Schema.Struct({ id: Text, kind: opt(Schema.String), path: opt(Schema.String) }))
}).pipe(Schema.annotate({ identifier: "EngineReferencesReceipt", title: "Receipt printed by an adapter's references command" }))

/** What `check` prints: the same problem shape the toolkit's own checks use. */
export const CheckReceipt = Schema.Struct({
  problems: Schema.Array(Schema.Struct({ message: Text, fix: opt(Schema.String) })),
  report: opt(Schema.Unknown)
}).pipe(Schema.annotate({ identifier: "EngineCheckReceipt", title: "Receipt printed by an adapter's check command" }))

/** What `capture` prints: the stills it wrote, as project files. */
export const CaptureReceipt = Schema.Struct({ files: Schema.Array(PortablePath) }).pipe(
  Schema.annotate({ identifier: "EngineCaptureReceipt", title: "Receipt printed by an adapter's capture command" })
)

/** What `conform-skeleton` prints: the reworked model first, then anything else it wrote, as project files. */
export const ConformReceipt = Schema.Struct({
  files: Schema.NonEmptyArray(PortablePath),
  report: opt(PortablePath)
}).pipe(Schema.annotate({ identifier: "EngineConformReceipt", title: "Receipt printed by an adapter's conform-skeleton command" }))
export type ConformReceipt = typeof ConformReceipt.Type

/**
 * What a command prints, with exit code 3, when it cannot reach the engine from this process: the
 * work is handed to a person or agent, and nothing is recorded as done.
 */
export const Handoff = Schema.Struct({
  handoff: Schema.Struct({
    reason: opt(Schema.String),
    steps: Schema.Array(Schema.Unknown).pipe(Schema.annotate({ description: "What to do by hand, in order: a sentence each, or an object the adapter describes" })),
    resume: opt(Schema.String.pipe(Schema.annotate({ description: "The command to run again once the steps are done" })))
  })
}).pipe(Schema.annotate({ identifier: "EngineHandoff", title: "Handoff printed by an adapter command that exits 3" }))

/** The receipt schema of each standard command. */
export const RECEIPTS = {
  import: ImportReceipt,
  inspect: InspectReceipt,
  references: ReferencesReceipt,
  capture: CaptureReceipt,
  check: CheckReceipt,
  "conform-skeleton": ConformReceipt
} as const

export const HANDOFF_EXIT = 3
