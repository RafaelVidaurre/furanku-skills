// The viewer actions: what an agent uses to look at content through the same viewers a person
// sees. They are described here (names, inputs) so `jam catalog actions` can list them without
// loading the server; they run in a catalog server (`jam catalog open`), which drives the real
// page in a headless browser.
import * as JsonSchema from "effect/JsonSchema"
import * as Schema from "effect/Schema"
import { optional, Text } from "./action.ts"
import type { ActionInfo } from "./Actions.ts"

const Session = optional(Text).annotate({ description: "A name for the viewer session (default: default)" })

/** What a viewer shows: one entry, optionally one part or view of it, or a comparison. */
export const ViewerTarget = Schema.Struct({
  kind: Schema.Literals(["unit", "collection", "asset", "submission"]),
  id: Text,
  item: optional(Text).annotate({ description: "The submission item (required for a submission)" }),
  member: optional(Text).annotate({ description: "A member unit, shown in its collection" }),
  part: optional(Text),
  view: optional(Text),
  compare: optional(Text).annotate({ description: "A comparison: <submission>~<item>~<part>, optionally followed by a second ~<submission>~<item>~<part>" })
})
export type ViewerTarget = typeof ViewerTarget.Type

export const ViewerOpen = Schema.Struct({
  target: ViewerTarget,
  size: optional(Schema.Struct({
    width: Schema.Int.check(Schema.isBetween({ minimum: 320, maximum: 3840 })),
    height: Schema.Int.check(Schema.isBetween({ minimum: 240, maximum: 2160 }))
  })),
  session: Session
})

export const ViewerSession = Schema.Struct({ session: Session })

/**
 * Controls are handed to the viewer that is showing. Which ones it accepts is in its state
 * (`viewer.controls`); a media kind from a plugin may define its own, so other keys pass through.
 */
export const ViewerControl = Schema.StructWithRest(
  Schema.Struct({
    session: Session,
    select: optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({ description: "Select a part, view or compare on the open page: { part?, view?, compare? }" }),
    camera: optional(Schema.Struct({ position: optional(Schema.Array(Schema.Finite)), target: optional(Schema.Array(Schema.Finite)) })),
    mode: optional(Schema.String).annotate({ description: "Surface mode of a model: textured, clay or wireframe" }),
    animation: optional(Schema.Struct({ clip: optional(Schema.String), time: optional(Schema.Finite), playing: optional(Schema.Boolean) })),
    zoom: optional(Schema.Record(Schema.String, Schema.Unknown)),
    compare: optional(Schema.Record(Schema.String, Schema.Unknown)),
    audio: optional(Schema.Record(Schema.String, Schema.Unknown)),
    video: optional(Schema.Record(Schema.String, Schema.Unknown))
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

export interface ViewerAction {
  readonly name: string
  readonly description: string
  readonly input: Schema.Top
}

export const VIEWER_ACTIONS: ReadonlyArray<ViewerAction> = [
  { name: "viewer.open", description: "Open a unit, collection, asset or submission item in a headless viewer session", input: ViewerOpen },
  { name: "viewer.state", description: "Current viewer selection, readiness, evidence identity, camera and supported controls", input: ViewerSession },
  { name: "viewer.control", description: "Select a part or view, or apply camera, surface mode, animation, mesh isolation, zoom, playback or comparison controls", input: ViewerControl },
  { name: "viewer.capture", description: "Capture the ready viewer as PNG; returns the file and the evidence identity shown", input: ViewerSession },
  { name: "viewer.close", description: "Close a viewer session", input: ViewerSession }
]

export const isViewerAction = (name: string): boolean => name.startsWith("viewer.")

const jsonSchema = (schema: Schema.Top): Record<string, unknown> => {
  const document = Schema.toJsonSchemaDocument(schema)
  return { $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12, ...document.schema, ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {}) }
}

/** The viewer actions as `actions` lists them. They run in a server, so their kind is `viewer`. */
export const viewerActionInfo = (): ReadonlyArray<ActionInfo> =>
  VIEWER_ACTIONS.map((action) => ({ name: action.name, kind: "viewer", description: action.description, input: jsonSchema(action.input) }))
