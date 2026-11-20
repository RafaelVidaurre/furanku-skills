// The clip spec: what one animation clip is for and what it must meet, written before any motion
// is made. Every number comes from the project or the person; nothing here has a default.
import * as Schema from "effect/Schema"
import { Id, PortablePath, Positive, Text } from "../common.ts"
import { latestRecord, type Run } from "../runs/schema.ts"

const opt = Schema.optionalKey
const Seconds = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)), Schema.annotate({ description: "Seconds from the clip's first frame" }))
const Meters = Positive.pipe(Schema.annotate({ description: "Meters on the project rig" }))
const LIMBS = ["foot.l", "foot.r", "hand.l", "hand.r"] as const

const Length = Schema.Struct({
  min: Positive.pipe(Schema.annotate({ description: "Seconds" })),
  max: Positive.pipe(Schema.annotate({ description: "Seconds" }))
}).pipe(
  // Annotations go before a check: one given after it is not published in the JSON schema.
  Schema.annotate({ description: "Seconds: any length from min to max. A fixed length has min equal to max." }),
  Schema.check(Schema.makeFilter((range) => (range.min > range.max ? "length.min must not exceed length.max" : undefined)))
)

const Root = Schema.Struct({
  mode: Schema.Literals(["in-place", "root-motion"]).pipe(Schema.annotate({
    description: "in-place: travel removed, pelvis motion kept. root-motion: travel carried on the root bone."
  })),
  bone: opt(Text.pipe(Schema.annotate({ description: "root-motion: the ground-level root bone that carries travel. Absent: the hips, for a rig with no ground root." })))
}).pipe(
  Schema.annotate({ description: "Where the clip's travel goes. bone is given with root-motion only." }),
  Schema.check(Schema.makeFilter((root) => (root.mode === "in-place" && root.bone !== undefined ? "root.bone applies to root-motion only" : undefined)))
)

const Ground = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("flat") }),
  Schema.Struct({ kind: Schema.Literal("change"), description: Text.pipe(Schema.annotate({ description: "The height change the clip must cross: a stair, a ledge" })) })
]).pipe(Schema.annotate({ description: "{kind: flat}, or {kind: change, description} for a clip that crosses a height change" }))

const KeyPose = Schema.Struct({
  name: Id,
  time: Seconds
})

const Planted = Schema.Struct({
  limb: Schema.Literals(LIMBS),
  from: Seconds,
  to: Seconds
}).pipe(
  Schema.annotate({ description: "One limb planted from one time to another; from is not after to" }),
  Schema.check(Schema.makeFilter((window) => (window.from > window.to ? "a planted window's from must not be after its to" : undefined)))
)

export const ClipSpec = Schema.Struct({
  $schema: opt(Schema.String),
  id: Id,
  purpose: Text.pipe(Schema.annotate({ description: "One sentence: what the clip is for" })),
  rig: Schema.Struct({
    model: PortablePath.pipe(Schema.annotate({ description: "The project rig: a .glb holding the skinned character" })),
    map: PortablePath.pipe(Schema.annotate({ description: "The rig's skeleton map: a landmark map (bone name -> landmark)" }))
  }),
  fps: Positive.pipe(Schema.annotate({ description: "Frames per second; the clip is sampled on whole frames" })),
  length: Length,
  loop: Schema.Boolean,
  root: Root,
  ground: Ground,
  keyPoses: opt(Schema.Struct({
    file: PortablePath.pipe(Schema.annotate({ description: "keyposes.glb: the project rig with one animation holding one key per pose" })),
    poses: Schema.NonEmptyArray(KeyPose).pipe(Schema.annotate({ description: "Named poses with their intended times, in the order of their keys: each name once, in time order, none after length.max" }))
  })),
  contacts: opt(Schema.Struct({
    detect: opt(Schema.Struct({
      height: Meters.pipe(Schema.annotate({ description: "How close to its resting height a foot must be to count as planted, in meters" })),
      speed: Positive.pipe(Schema.annotate({ description: "How slow a foot must move to count as planted, in meters per second" }))
    }).pipe(Schema.annotate({ description: "How the check finds contacts on the project rig" }))),
    planted: opt(Schema.Array(Planted).pipe(Schema.annotate({ description: "Which feet or hands should be planted when; the clip check measures each of these windows" })))
  })),
  accept: Schema.Struct({
    footSlide: Meters.pipe(Schema.annotate({ description: "Most a planted foot or hand may slide within one contact window" })),
    penetration: Meters.pipe(Schema.annotate({ description: "Most a foot may go below flat ground" })),
    boundaryJump: Meters.pipe(Schema.annotate({ description: "Most a joint may jump from one frame to the next beyond the motion around it: at the first or the last frame, or anywhere inside the clip" })),
    loopSeam: opt(Meters.pipe(Schema.annotate({ description: "Looping clips only, and required for them: most a joint may differ between the end of one play and the start of the next" })))
  }).pipe(Schema.annotate({ description: "Thresholds the clip check enforces, in meters. Each comes from the project (its budget, the person); none has a default." }))
}).pipe(
  Schema.annotate({
    title: "Clip spec (clip.json): one animation clip on the project rig. Paths are project-relative.",
    description: "Beyond each field's own shape: accept.loopSeam is given exactly when loop is true; key poses have distinct names, are in time order and none is after length.max. Numbers are finite; an optional field is left out, never null."
  }),
  Schema.check(Schema.makeFilter((spec) => {
    const problems: Array<string> = []
    if (spec.loop && spec.accept.loopSeam === undefined) problems.push("a looping clip needs accept.loopSeam")
    if (!spec.loop && spec.accept.loopSeam !== undefined) problems.push("accept.loopSeam applies to looping clips only")
    const poses = spec.keyPoses?.poses ?? []
    const names = poses.map((pose) => pose.name)
    const twice = names.filter((name, index) => names.indexOf(name) !== index)
    if (twice.length > 0) problems.push(`keyPoses.poses: each name once (${[...new Set(twice)].join(", ")} repeated)`)
    if (poses.some((pose, index) => index > 0 && pose.time < poses[index - 1]!.time)) problems.push("keyPoses.poses: list the poses in time order")
    const late = poses.filter((pose) => pose.time > spec.length.max)
    if (late.length > 0) problems.push(`keyPoses.poses: ${late.map((pose) => `${pose.name} at ${pose.time} s`).join(", ")} after length.max (${spec.length.max} s)`)
    return problems.length === 0 ? undefined : problems.join("; ")
  })),
  // The identifier, unlike a description, is published from after the check.
  Schema.annotate({ identifier: "AnimationClip" })
)
export type ClipSpec = typeof ClipSpec.Type

/** The role a clip spec is recorded under. */
export const SPEC_ROLE = "spec"

/** The clip spec files a run records: the `spec` file of the latest record of each step. An animation run has exactly one. */
export const runSpecs = (run: Run): ReadonlyArray<{ readonly path: string; readonly sha256: string }> =>
  Object.keys(run.steps).flatMap((step) => (latestRecord(run, step)?.files ?? []).filter((file) => file.role === SPEC_ROLE))
