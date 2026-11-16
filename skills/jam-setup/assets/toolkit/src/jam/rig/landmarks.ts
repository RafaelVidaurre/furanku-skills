// The canonical joint vocabulary every rigging piece speaks, whatever produced the joints and
// whatever skeleton they end up on: a joint source writes a landmark file, a skeleton profile maps
// landmarks to one target skeleton's bone names.
import * as Schema from "effect/Schema"
import { Text } from "../common.ts"

const opt = Schema.optionalKey
const SIDES = ["l", "r"] as const
const sided = (names: ReadonlyArray<string>): ReadonlyArray<string> => names.flatMap((name) => SIDES.map((side) => `${name}.${side}`))

/** Joints every humanoid rig has. Sided joints end in `.l` or `.r` (the character's own left and right). */
export const CORE_LANDMARKS: ReadonlyArray<string> = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  ...sided(["shoulder", "upper-arm", "lower-arm", "hand", "upper-leg", "lower-leg", "foot", "toes"])
]

/** Optional finger chains: three joints per finger, numbered from the palm outward. */
export const FINGER_LANDMARKS: ReadonlyArray<string> = sided(
  ["thumb", "index", "middle", "ring", "pinky"].flatMap((finger) => [1, 2, 3].map((joint) => `${finger}-${joint}`))
)

export const LANDMARKS: ReadonlyArray<string> = [...CORE_LANDMARKS, ...FINGER_LANDMARKS]

export const Landmark = Schema.Literals(LANDMARKS).pipe(Schema.annotate({ identifier: "Landmark", description: "A joint of the canonical humanoid vocabulary" }))

/** The landmark each landmark hangs from; `hips` is the root. */
export const LANDMARK_PARENT: Readonly<Record<string, string | null>> = Object.fromEntries(LANDMARKS.map((name): [string, string | null] => {
  const [joint = "", side] = name.split(".")
  const on = (other: string): string => (side === undefined ? other : `${other}.${side}`)
  const finger = /^([a-z]+)-([123])$/.exec(joint)
  if (finger) return [name, finger[2] === "1" ? on("hand") : on(`${finger[1]}-${Number(finger[2]) - 1}`)]
  const chain: Record<string, string | null> = {
    hips: null, spine: "hips", chest: "spine", neck: "chest", head: "neck",
    shoulder: "chest", "upper-arm": on("shoulder"), "lower-arm": on("upper-arm"), hand: on("lower-arm"),
    "upper-leg": "hips", "lower-leg": on("upper-leg"), foot: on("lower-leg"), toes: on("foot")
  }
  return [name, chain[joint] ?? null]
}))

const Vector = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])
const Axis = Schema.Literals(["+X", "-X", "+Y", "-Y", "+Z", "-Z"])

const perLandmark = <S extends Schema.Top>(names: ReadonlyArray<string>, field: (name: string) => S) =>
  Object.fromEntries(names.map((name) => [name, field(name)])) as Record<string, S>

/** A named target skeleton as data: which of its bones stands at each landmark. */
export const SkeletonProfile = Schema.Struct({
  label: opt(Text),
  reference: opt(Text.pipe(Schema.annotate({ description: "File that holds the skeleton, inside the adapter folder or the project" }))),
  engineAsset: opt(Text.pipe(Schema.annotate({ description: "The engine's id of the skeleton asset" }))),
  bones: Schema.Struct(perLandmark(LANDMARKS, () => opt(Text))).pipe(Schema.annotate({
    description: "The skeleton's bone name at each landmark it has. A landmark it lacks is left out."
  })),
  hierarchy: opt(Schema.Record(Schema.String, Schema.NullOr(Schema.String)).pipe(Schema.annotate({
    description: "Parent bone of each bone, by the skeleton's own names; null for the root. Absent: the landmark hierarchy."
  }))),
  notes: opt(Schema.String)
}).pipe(Schema.annotate({ identifier: "SkeletonProfile" }))
export type SkeletonProfile = typeof SkeletonProfile.Type

/** Where the joints of one mesh are: written by any joint source, read by rigging. */
export const LandmarkFile = Schema.Struct({
  $schema: opt(Schema.String),
  units: Schema.Literal("meters"),
  up: Axis,
  landmarks: Schema.Struct({
    ...perLandmark(CORE_LANDMARKS, () => Vector),
    ...perLandmark(FINGER_LANDMARKS, () => opt(Vector))
  }),
  source: Text.pipe(Schema.annotate({ description: "What placed the joints: a provider's auto-rig, a DCC estimate, a person" }))
}).pipe(Schema.annotate({ identifier: "LandmarkFile", title: "Landmark file: joint positions of one mesh" }))
export type LandmarkFile = typeof LandmarkFile.Type

/** A skeleton named by a budget: the project's own profile first, then the engine adapter's. */
export const skeletonNamed = (
  id: string,
  project: Readonly<Record<string, SkeletonProfile>>,
  adapter: Readonly<Record<string, SkeletonProfile>> | undefined
): SkeletonProfile | undefined => project[id] ?? adapter?.[id]
