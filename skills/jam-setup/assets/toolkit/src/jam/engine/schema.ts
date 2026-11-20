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
export const VERBS = ["import", "inspect", "references", "capture", "check", "conform-skeleton", "inventory", "previews"] as const
export type Verb = typeof VERBS[number]

export const AdapterCommand = Schema.Struct({
  run: Schema.NonEmptyArray(Schema.String).pipe(Schema.annotate({
    description: "Program and arguments. `python`, `blender` and `node` resolve to the machine's own; a path that exists in the adapter folder resolves there; {adapter}, {project} and {toolkit} are substituted. The command's own arguments are appended."
  })),
  kinds: opt(Schema.Array(Id).pipe(Schema.annotate({ description: "For import: the asset kinds this command accepts (static, skinned, animation, textures, audio, ...). A recipe step conditioned on a kind runs only when it is listed." }))),
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
    description: "By name. The standard commands are import, inspect, references, capture, check, conform-skeleton, inventory and previews; any other name is the adapter's own, run with `jam engine run <name>`. A command prints one JSON receipt and exits 0, or exits 3 with a handoff. null (or absent) means: done by hand, following the matching guidance document."
  }))),
  docs: opt(Schema.Record(Schema.String, Schema.String).pipe(Schema.annotate({
    description: "Guidance documents by topic (import, inspect, acceptance, ...), relative to the adapter folder, or to the preset file for a shipped preset"
  }))),
  sources: opt(Schema.Array(Source).pipe(Schema.annotate({ description: "Where each fact comes from" })))
}).pipe(Schema.annotate({ identifier: "EngineAdapter", title: "Engine adapter (adapter.json or a shipped preset)" }))
export type Adapter = typeof Adapter.Type

/** What `import` prints. Reimporting the same source keeps the id. A skinned import lists its skinned asset first; an animation import lists each animation asset with its skeleton. */
export const EngineAsset = Schema.Struct({
  id: Text.pipe(Schema.annotate({ description: "The engine's own id for the asset" })),
  kind: Text,
  source: opt(PortablePath),
  sha256: opt(Schema.String),
  skeleton: opt(Text.pipe(Schema.annotate({ description: "For an animation: the engine id of the skeleton it plays on" })))
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

/** One reference from an engine file to another engine file or code module. */
export const InventoryReference = Schema.Struct({
  to: Text.pipe(Schema.annotate({ description: "The engine id of what is referenced: another file's id, or a code module" })),
  kind: Schema.Literals(["hard", "soft", "native", "build"]).pipe(Schema.annotate({
    description: "hard: needed to load the file. soft: named by path and loaded on demand. native: a code module. build: needed only to build the file."
  })),
  editorOnly: opt(Schema.Boolean.pipe(Schema.annotate({ description: "True when the game does not need this reference, only the editor" })))
})

const FieldReferences = Schema.Array(Schema.Struct({
  property: Text.pipe(Schema.annotate({ description: "The property path holding the reference, such as Parts[0] or Rules.Mesh" })),
  to: Text.pipe(Schema.annotate({ description: "The engine id of the referenced object" })),
  kind: Schema.Literals(["hard", "soft", "native"])
})).pipe(Schema.annotate({ description: "Each reference in fields, with the property that holds it" }))

/** A component or other instanced subobject an asset holds. */
export const InventoryComponent = Schema.Struct({
  name: Text.pipe(Schema.annotate({ description: "The component's name in its owner, such as Body or CharacterMovement" })),
  class: Text.pipe(Schema.annotate({ description: "The engine's class of the component" })),
  path: opt(Text.pipe(Schema.annotate({ description: "The engine id of the component object or template" }))),
  from: opt(Text.pipe(Schema.annotate({ description: "The class that declares the component, when a parent class does" }))),
  inherited: opt(Schema.Boolean.pipe(Schema.annotate({ description: "True when a parent class adds the component" }))),
  native: opt(Schema.Boolean.pipe(Schema.annotate({ description: "True when code adds the component" }))),
  fields: opt(Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({ description: "The component's property values, encoded as the asset's fields" }))),
  fieldReferences: opt(FieldReferences),
  fieldsError: opt(Text)
})

/** One asset stored in an engine file. */
export const InventoryAsset = Schema.Struct({
  id: Text.pipe(Schema.annotate({ description: "The engine's id of the asset" })),
  class: Text.pipe(Schema.annotate({ description: "The engine's class or type of the asset" })),
  tags: opt(Schema.Record(Schema.String, Schema.String).pipe(Schema.annotate({ description: "Metadata the engine keeps without loading the asset, as strings" }))),
  tagsFromEngine: opt(Schema.Boolean.pipe(Schema.annotate({ description: "false when the asset was read through the engine and its tags could not be listed" }))),
  fields: opt(Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({
    description: "Property values by property name, for the classes the project lists and their subclasses. A reference is {object, class} or {soft}; a value the adapter cannot decode is {unparsed: <type>}"
  }))),
  fieldsSource: opt(Schema.Literals(["file", "engine"]).pipe(Schema.annotate({
    description: "file: the values the file itself sets. engine: the effective values the engine holds, inherited and native defaults included"
  }))),
  fieldReferences: opt(FieldReferences),
  components: opt(Schema.Array(InventoryComponent).pipe(Schema.annotate({ description: "The components and instanced subobjects the asset holds" }))),
  fieldsError: opt(Text.pipe(Schema.annotate({ description: "Why the asset's fields could not be read; the rest of the entry is still read" }))),
  fieldsEngineError: opt(Text.pipe(Schema.annotate({ description: "Why the engine could not give the asset's effective values; fields are the file's" })))
})

export type InventoryAsset = typeof InventoryAsset.Type

/** What an inventory says about one engine file. */
export const InventoryFile = Schema.Struct({
  id: Text.pipe(Schema.annotate({ description: "The engine's id of the file, which references to it use" })),
  size: Schema.Int,
  mtimeMs: Schema.Finite.pipe(Schema.annotate({ description: "Modification time when it was read; with size, what a refresh compares" })),
  hash: opt(Schema.String.pipe(Schema.annotate({ description: "The engine's own content hash of the file, when its format has one" }))),
  saved: opt(Schema.String.pipe(Schema.annotate({ description: "The engine version that wrote the file" }))),
  main: opt(Text.pipe(Schema.annotate({ description: "The asset that stands for the file" }))),
  assets: opt(Schema.Array(InventoryAsset)),
  references: opt(Schema.Array(InventoryReference)),
  names: opt(Schema.Array(Schema.Struct({ on: Schema.String, values: Schema.Array(Schema.String) })).pipe(Schema.annotate({
    description: "Searchable names the file uses (gameplay tags, for example), grouped by what they name"
  }))),
  unread: opt(Text.pipe(Schema.annotate({ description: "Why the adapter could not read the file; such an entry has no assets or references" })))
})
export type InventoryFile = typeof InventoryFile.Type

/** The engine's content as an adapter reads it: one entry per engine file, by project path. */
export const EngineInventory = Schema.Struct({
  format: Schema.Literal(1),
  adapter: Id,
  generatedAt: Text,
  fieldsConfig: opt(Schema.String.pipe(Schema.annotate({
    description: "Hash of the field list the entries were read with; when the list changes the adapter reads again the entries it affects"
  }))),
  parents: opt(Schema.Record(Schema.String, Schema.String).pipe(Schema.annotate({
    description: "Class -> parent class links the adapter learned from the engine, kept so runs without the engine select the same subclasses"
  }))),
  roots: Schema.Array(Schema.Struct({
    id: Text.pipe(Schema.annotate({ description: "The engine's name for the root, as it starts the ids under it" })),
    path: Schema.Union([Schema.Literal("."), PortablePath])
  })),
  files: Schema.Record(PortablePath, InventoryFile)
}).pipe(Schema.annotate({ identifier: "EngineInventory", title: "Engine content inventory written by an adapter's inventory command" }))
export type EngineInventory = typeof EngineInventory.Type

/** What `inventory` prints after writing the inventory file. */
export const InventoryReceipt = Schema.Struct({
  inventory: PortablePath.pipe(Schema.annotate({ description: "The inventory file written" })),
  files: Schema.Int,
  assets: Schema.Int,
  read: Schema.Int.pipe(Schema.annotate({ description: "Files read in this run" })),
  reused: Schema.Int.pipe(Schema.annotate({ description: "Files taken unchanged from the previous inventory" })),
  removed: Schema.Int.pipe(Schema.annotate({ description: "Files in the previous inventory that are gone" })),
  unread: Schema.Int.pipe(Schema.annotate({ description: "Files the adapter could not read" }))
}).pipe(Schema.annotate({ identifier: "EngineInventoryReceipt", title: "Receipt printed by an adapter's inventory command" }))

/** What the previews index says about one engine file, by the file's project path in the inventory. */
export const PreviewEntry = Schema.Struct({
  version: Text.pipe(Schema.annotate({ description: "The file's version the entry was made for: its inventory hash, or <size>:<mtimeMs> when it has none" })),
  file: opt(Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, { message: "expected a file name in the previews folder" })),
    Schema.annotate({ description: "The preview, a file in the previews folder" })
  )),
  kind: opt(Schema.Literals(["image", "model", "audio"]).pipe(Schema.annotate({ description: "image: PNG, JPEG or WebP. model: self-contained GLB. audio: WAV" }))),
  how: opt(Text.pipe(Schema.annotate({ description: "How the adapter made it, in a few words" }))),
  failed: opt(Text.pipe(Schema.annotate({ description: "Why no preview was made for this version; the adapter tries again when the file changes" })))
})
export type PreviewEntry = typeof PreviewEntry.Type

/** Previews of engine files, written by an adapter's previews command beside the files it lists. */
export const EnginePreviews = Schema.Struct({
  format: Schema.Literal(1),
  adapter: Id,
  generatedAt: Text,
  files: Schema.Record(PortablePath, PreviewEntry)
}).pipe(Schema.annotate({ identifier: "EnginePreviews", title: "Index of engine previews written by an adapter's previews command" }))
export type EnginePreviews = typeof EnginePreviews.Type

/** What `previews` prints after writing the previews and their index. */
export const PreviewsReceipt = Schema.Struct({
  index: PortablePath.pipe(Schema.annotate({ description: "The index file written" })),
  previews: Schema.Int.pipe(Schema.annotate({ description: "Files that have a preview" })),
  made: Schema.Int.pipe(Schema.annotate({ description: "Previews made in this run" })),
  reused: Schema.Int.pipe(Schema.annotate({ description: "Previews kept because their file did not change" })),
  failed: Schema.Int.pipe(Schema.annotate({ description: "Files whose preview could not be made" })),
  waiting: Schema.Int.pipe(Schema.annotate({ description: "Files whose preview needs the engine, which did not make it in this run" })),
  none: Schema.Int.pipe(Schema.annotate({ description: "Files of a kind the adapter makes no preview for" }))
}).pipe(Schema.annotate({ identifier: "EnginePreviewsReceipt", title: "Receipt printed by an adapter's previews command" }))

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
  "conform-skeleton": ConformReceipt,
  inventory: InventoryReceipt,
  previews: PreviewsReceipt
} as const

export const HANDOFF_EXIT = 3
