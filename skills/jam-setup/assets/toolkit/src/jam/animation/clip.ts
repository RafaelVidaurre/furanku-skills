// The clip spec: what one animation clip is for and what it must meet, written before any motion
// is made. Every number comes from the project or the person; nothing here has a default.
import * as Schema from "effect/Schema"
import { Id, PortablePath, Positive, Text } from "../common.ts"

const opt = Schema.optionalKey
const Seconds = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)), Schema.annotate({ description: "Seconds from the clip's first frame" }))
const Meters = Positive.pipe(Schema.annotate({ description: "Meters on the project rig" }))
const LIMBS = ["foot.l", "foot.r", "hand.l", "hand.r"] as const

const Length = Schema.Struct({
  min: Positive.pipe(Schema.annotate({ description: "Seconds" })),
  max: Positive.pipe(Schema.annotate({ description: "Seconds" }))
}).pipe(
  Schema.check(Schema.makeFilter((range) => (range.min > range.max ? "length.min must not exceed length.max" : undefined))),
  Schema.annotate({ description: "Seconds: any length from min to max. A fixed length has min equal to max." })
)

const Root = Schema.Struct({
  mode: Schema.Literals(["in-place", "root-motion"]).pipe(Schema.annotate({
    description: "in-place: travel removed, pelvis motion kept. root-motion: travel carried on the root bone."
  })),
  bone: opt(Text.pipe(Schema.annotate({ description: "root-motion: the ground-level root bone that carries travel. Absent: the hips, for a rig with no ground root." })))
}).pipe(Schema.check(Schema.makeFilter((root) => (root.mode === "in-place" && root.bone !== undefined ? "root.bone applies to root-motion only" : undefined))))

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
}).pipe(Schema.check(Schema.makeFilter((window) => (window.from > window.to ? "a planted window's from must not be after its to" : undefined))))

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
    poses: Schema.NonEmptyArray(KeyPose).pipe(Schema.annotate({ description: "Named poses with their intended times, in the order of their keys" }))
  })),
  contacts: opt(Schema.Struct({
    detect: opt(Schema.Struct({
      height: Meters.pipe(Schema.annotate({ description: "How close to its resting height a foot must be to count as planted, in meters" })),
      speed: Positive.pipe(Schema.annotate({ description: "How slow a foot must move to count as planted, in meters per second" }))
    }).pipe(Schema.annotate({ description: "How the check finds contacts on the project rig" }))),
    planted: opt(Schema.Array(Planted).pipe(Schema.annotate({ description: "Which feet or hands should be planted when, reported beside the detected contacts" })))
  })),
  accept: Schema.Struct({
    footSlide: Meters.pipe(Schema.annotate({ description: "Most a planted foot or hand may slide within one contact window" })),
    penetration: Meters.pipe(Schema.annotate({ description: "Most a foot may go below flat ground" })),
    boundaryJump: Meters.pipe(Schema.annotate({ description: "Most a joint may jump at the first or the last frame" })),
    loopSeam: opt(Meters.pipe(Schema.annotate({ description: "Looping clips only, and required for them: most a joint may differ between the end of one play and the start of the next" })))
  }).pipe(Schema.annotate({ description: "Thresholds the clip check enforces, in meters. Each comes from the project (its budget, the person); none has a default." }))
}).pipe(
  Schema.check(Schema.makeFilter((spec) =>
    spec.loop && spec.accept.loopSeam === undefined
      ? "a looping clip needs accept.loopSeam"
      : !spec.loop && spec.accept.loopSeam !== undefined
      ? "accept.loopSeam applies to looping clips only"
      : undefined
  )),
  Schema.annotate({ identifier: "AnimationClip", title: "Clip spec (clip.json): one animation clip on the project rig. Paths are project-relative." })
)
export type ClipSpec = typeof ClipSpec.Type
