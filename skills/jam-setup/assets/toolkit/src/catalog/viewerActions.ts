// The viewer actions: what an agent uses to look at content through the same viewers a person
// sees. They are described here (names, inputs) so `jam catalog actions` can list them without
// loading the server; they run in a catalog server (`jam catalog open`), which drives the real
// page in a headless browser.
import * as Schema from "effect/Schema"
import { type ActionInfo, infoOf, optional, refOf, Text } from "./action.ts"

const Session = optional(Text).annotate({ description: "A name for the viewer session (default: default)" })

/** One frozen part of a submission item, as `evidence.compare` names it. */
export const FrozenRef = Schema.Struct({ submission: Text, item: Text, part: Text })
/** Frozen evidence against current content (`b` absent or "current") or against other frozen evidence. */
export const Comparison = Schema.Struct({
  a: FrozenRef,
  b: optional(Schema.Union([Schema.Literal("current"), FrozenRef])).annotate({ description: "Absent or \"current\" for current content" })
})

const TargetRef = refOf(["unit", "collection", "asset", "submission"], { item: true, part: true })
/** What a viewer shows: a unit, collection, asset or submission item, optionally one part or view of it, or a comparison. */
export const ViewerTarget = Schema.Struct({
  ...TargetRef.fields,
  item: TargetRef.fields.item.annotate({ description: "The submission item (required for a submission)" }),
  part: TargetRef.fields.part.annotate({ description: "A part id, or inspector:<key> for one of a unit's inspectors" }),
  member: optional(Text).annotate({ description: "A member unit, shown in its collection" }),
  view: optional(Text).annotate({ description: "A view of the submission item (vw_…)" }),
  compare: optional(Comparison).annotate({ description: "A comparison, as evidence.compare takes it" })
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
    select: optional(Schema.Struct({
      part: optional(Text).annotate({ description: "A part id, or inspector:<key>" }),
      view: optional(Text).annotate({ description: "A view of the submission item (vw_…)" }),
      compare: optional(Comparison)
    })).annotate({ description: "Select a part, view or comparison on the open page" }),
    camera: optional(Schema.Struct({ position: optional(Schema.Array(Schema.Finite)), target: optional(Schema.Array(Schema.Finite)) })),
    mode: optional(Schema.String).annotate({ description: "Surface mode of a model: textured, clay or wireframe" }),
    animation: optional(Schema.Struct({
      clip: optional(Schema.String).annotate({ description: "A model's animation clip" }),
      time: optional(Schema.Finite),
      playing: optional(Schema.Boolean),
      frame: optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({ description: "A frame of a sprite-sheet animation, from 0" }),
      speed: optional(Schema.Finite).annotate({ description: "Playback speed of a sprite-sheet animation: 0.25, 0.5, 1 or 2" })
    })),
    sprite: optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({ description: "A sprite-sheet animation's display: { show: \"animation\" | \"sheet\", onion: boolean, whole: boolean (the whole frame box, not only what is drawn in it) }" }),
    isolate: optional(Schema.Union([Schema.String, Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))])).annotate({ description: "Show one mesh of a model: its name or index" }),
    texture: optional(Schema.String).annotate({ description: "Show one texture of a model" }),
    inspector: optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({ description: "A command for the inspector showing (selected as inspector:<key>)" }),
    zoom: optional(Schema.Record(Schema.String, Schema.Unknown)),
    compare: optional(Schema.Record(Schema.String, Schema.Unknown)),
    audio: optional(Schema.Record(Schema.String, Schema.Unknown)),
    video: optional(Schema.Record(Schema.String, Schema.Unknown))
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

/**
 * The showing viewer's state: what every viewer reports (`kind`, `status`, `error`, `shows`,
 * `controls`) plus whatever its media kind or inspector adds (a camera, a zoom, its own controls).
 */
export const ShowingViewer = Schema.StructWithRest(
  Schema.Struct({
    kind: Schema.NullOr(Schema.String).annotate({ description: "The media kind shown, or compare or inspector" }),
    status: Schema.Literals(["loading", "ready", "error"]),
    error: Schema.NullOr(Schema.String),
    shows: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)).annotate({ description: "The identity of what is shown (unit, part, digest), as viewer.capture returns it" }),
    controls: Schema.Array(Schema.String).annotate({ description: "The controls viewer.control may send this viewer" })
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

/** What the page reports: its address, what is selected (the page's own) and the showing viewer's state. */
export const ViewerState = Schema.Struct({
  route: Schema.String,
  selection: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  viewer: Schema.NullOr(ShowingViewer)
})
const SessionName = Schema.String.annotate({ description: "The viewer session" })
export const ViewerShown = Schema.Struct({ session: SessionName, state: ViewerState, pageErrors: Schema.Array(Schema.String) })
export const ViewerStateOutput = Schema.Struct({ session: SessionName, state: ViewerState })
export const ViewerCaptureOutput = Schema.Struct({
  session: SessionName,
  file: Schema.String.annotate({ description: "The PNG, a project path under .catalog/.local/captures" }),
  sha256: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  shows: Schema.Unknown.annotate({ description: "The identity of what the capture shows (asset digest, submission view, or both sides of a comparison)" }),
  renderer: Schema.String,
  state: ViewerState
})
export const ViewerCloseOutput = Schema.Struct({ closed: Schema.String })

export interface ViewerAction {
  readonly name: string
  readonly description: string
  readonly input: Schema.Top
  readonly output: Schema.Top
}

export const VIEWER_ACTIONS = [
  { name: "viewer.open", description: "Open a unit, collection, asset or submission item in a headless viewer session", input: ViewerOpen, output: ViewerShown },
  { name: "viewer.state", description: "Current viewer selection, readiness, evidence identity, camera and supported controls", input: ViewerSession, output: ViewerStateOutput },
  { name: "viewer.control", description: "Select a part, view or comparison, or command the inspector showing, or apply camera, surface mode, animation, mesh isolation, zoom, playback or comparison controls", input: ViewerControl, output: ViewerShown },
  { name: "viewer.capture", description: "Capture the ready viewer as PNG; returns the file and the evidence identity shown", input: ViewerSession, output: ViewerCaptureOutput },
  { name: "viewer.close", description: "Close a viewer session", input: ViewerSession, output: ViewerCloseOutput }
] as const satisfies ReadonlyArray<ViewerAction>

export const isViewerAction = (name: string): boolean => name.startsWith("viewer.")

/** The viewer actions as `actions` lists them: reads that need a running catalog server. */
export const viewerActionInfo = (): ReadonlyArray<ActionInfo> =>
  VIEWER_ACTIONS.map((action) => infoOf({ ...action, access: "read" }, { requires: ["server"] }))
