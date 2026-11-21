# What the retarget does

The order follows the practice engine retargeters document: align the rest poses first, map limbs as chains between landmarks, designate the pelvis so translation scales with proportions, then correct contacts with IK. Each rule below holds for any pair of humanoid skeletons; the implementation is `scripts/jamretarget/transfer.py`.

## Rest poses

The rest pose of each file is its nodes as stored. When a skinned file's nodes stand away from its bind pose, the report warns (`posed`); the nodes' pose is still what is used, since that is what plays when no animation drives a bone.

Before any frame is transferred, the run refuses a skeleton whose head is not above its feet (not `+Y` up), whose hips-to-head line leans more than 30 degrees from `+Y`, or that does not face `+Z`.

**Facing.** The facing is read on the ground plane two ways, and the report gives both per skeleton (`facing`, in degrees about `+Y`, positive turning `+Z` toward `+X`):

- `sideLineDegrees`: how far the mean right-to-left direction of the hip joints (`upper-leg`) and shoulder joints (`upper-arm`) is from `+X`. Every rest posture places these in mirror pairs, A-pose and T-pose alike.
- `feetDegrees`: how far the mean ankle-to-toes direction of the two feet is from `+Z`; feet turned out alike cancel. Without toes on both sides it is not read, and the report warns (`no-toes`).

Either line more than 90 degrees off means the character faces `-Z` or a map swaps sides; the side line catches a swapped map, the feet catch a map that swaps sides on a rig that also faces `-Z`. Either line more than `--facing-degrees` off refuses the skeleton as turned.

The facing matters because nothing later sees it. The trunk takes no rest turn and travel is copied in world axes (below), so with one skeleton turned θ about `+Y` the target's limbs and travel come out turned θ against its trunk, while arms and legs still agree with the source exactly. The tolerance is therefore the heading error a run may carry unseen. It is 10 degrees unless set. A rest whose sides mirror each other reads 0 to rounding, so the tolerance only absorbs an unevenly built rest (one hip joint placed ahead of the other, feet turned out unequally), while a file turned by its export, its placement or a wrong axis reads its whole turn. At 10 degrees a straight walk on the target drifts sideways by tan 10° ≈ 0.18 m per metre walked. Raise it only for a rest you have seen is built unevenly, and record why.

**Mirrored bones.** A bone the transfer drives (a landmark both maps place, and the root) must not be mirrored: a negative scale of its own or of a parent cannot be written as a rotation. The run refuses it by name. A mirrored bone the transfer does not drive keeps its rest, like any other.

## Rest alignment

A landmark's **segment** runs from it to the next landmark on its chain: `hips` → `spine` → `chest` → `neck` → `head`; `shoulder` → `upper-arm` → `lower-arm` → `hand` → `middle-1`; `upper-leg` → `lower-leg` → `foot` → `toes`; each finger joint to the next. For every landmark both maps place, a turn `Q` is computed once from the two rest poses:

| Landmark | `Q` |
| --- | --- |
| `hips`, `spine`, `chest`, `neck`, `head` | none: both skeletons stand upright facing `+Z`, so their trunks already correspond. How far the rest trunks differ is reported as `restDifferenceDegrees` |
| `foot` | none: both skeletons stand on their soles at rest, and a foot's pitch there comes from its build (ankle height against foot length), so each foot keeps its own and stands flat when the source's does. The difference is reported as `restDifferenceDegrees` |
| a hand whose `index-1` and `pinky-1` both maps place | the turn that matches the hand's direction (to `middle-1`, else the knuckles' middle) and its knuckle line, so palms that rest turned differently still match |
| a limb landmark whose next landmark on the chain both maps place | the shortest turn from the target's rest segment (this joint to the next) to the source's |
| any other (`toes`, a `-3` finger joint, a hand without finger landmarks) | its parent landmark's `Q`: it keeps its rest angle to its parent |

The report's `restAlignment` lists each landmark's rule and turn. An A-pose source and a T-pose target show the arm difference there (45 degrees for arms 45 degrees below level), and near zero elsewhere.

## Transfer

At every frame, each shared landmark's bone gets the world rotation `R_t = R_s · R_s,rest⁻¹ · Q · R_t,rest`: the source's rotation change since its rest, applied to the target's rest turned onto the source's. The rest difference is never played as motion. Bone axes, bone names and the bones between landmarks may all differ; only world rotations at landmarks are compared. Every other target node keeps its rest local transform.

Only rotations of shared landmarks are carried, plus the translation of the hips and of a root bone, and with `--translation scaled` the offsets below. Rotations of source bones at no shared landmark, other translations and any scale are not carried; when the source animates them the report names them under `notCarried` and in `warnings`.

## Translation

A rig can stretch a bone or slide a joint by animating translation (or scale) instead of rotation: an elbow moving out along the upper arm, a hip joint sliding across the pelvis. Each shared landmark's **offset** is its position relative to the previous shared landmark on its chain (the elbow's from the shoulder joint, a hip joint's from `hips`), read in the previous landmark's rest frame. The report's `stretch` lists, per animation, every offset the source's translations and scales change by more than 0.1% of its height, measured against the same pose with every joint's local translation and scale at rest except the hips' and root's: `maxMeters`, `maxDegrees` (how far that turns the offset), `lengthRatio` (its length over its length from rotations alone) and `carried`.

`--translation` chooses what happens to those changes:

- `none`, unless set: they are not carried. The target keeps its own bone lengths, so its segments differ from the source's by up to each entry's `maxDegrees`. Engine and DCC retargeters default to this too: they leave the translation of bones other than the root and pelvis at the target's own pose unless a chain or bone is set to copy it (sources: part B2 of the repository's 2026-11-20 best-practices research note in `docs/research/`). It is also the setting for a target whose consumer needs fixed bone lengths, such as a motion model's own skeleton.
- `scaled`: each change is turned by the previous landmark's rest-alignment `Q⁻¹` and scaled by the target's rest offset length over the source's (`k` when either is shorter than 1% of its skeleton's height), then added to the target's rest offset: the bone-length scaling those retargeters offer as an option. Where `Q` turns the rest segment onto the source's, the target's segment then points where the source's points and stretches by the same ratio. A landmark whose bone is not below the previous landmark's on both skeletons cannot take an offset; its `carried` is false and the run warns. The report's `translation.ratios` lists each landmark's ratio.

Either way agreement, side flips and the round trip stay meaningful (below): agreement and the round trip test the maps against what is carried, and `stretch` shows what is not. A `stretch` entry under `none` is a choice the person makes, not a fault of the maps: it passes the checks and leaves a warning to report.

## Travel and the root

`k` is the target's leg length over the source's (hip joint to knee to ankle, both sides averaged). The target's hips move to their rest position plus `k` times the source hips' displacement from their rest position, in all three axes: a crouch of 0.3 m on the source is `0.3·k` on the target, and so is every metre walked.

The root is the hips' parent when it is a joint of the file's skin (a bone, not an armature node); a skeleton without a skin, such as a converted BVH file, has none. When both skeletons have one, the target's root takes the source root's rotation change and `k` times its displacement. When only the source has one, its motion reaches the target's hips with everything else. When only the target has one, it stays at rest and the hips carry the travel, as on the source. A clip in place stays in place; deriving or removing root travel is the clip's own business, before or after this skill. The report's `hipsTravel` gives both skeletons' hips travel per animation.

## Frames

Frames are whole frames from the source's first key, at the source's frame rate (`1 / key spacing`, which needs evenly spaced keys) or at `--fps`. A rate read from the keys within 0.02% of a whole number is that number: storing key times (32-bit floats, a BVH file's six-decimal frame time below 400 fps) moves a rate by less, and the NTSC rates (1000/1001 of a whole rate, such as 29.97) lie 0.1% away, so they stay what they are. When the source's length is not a whole number of frames at that rate, the clip ends at the last whole frame and the report warns. Every channel is written LINEAR, one key per frame.

## Contacts

`--contacts` has no default: the person chooses `auto`, a contacts file or `none`.

`--contacts auto` finds, for each ankle (`foot.*`) and toe joint (`toes.*`) both maps place, the windows where the source joint moves over the ground (its speed in `x` and `z`, as the clip spec's `contacts.detect.speed` reads it) slower than `--contact-speed` for at least `--contact-min-frames` frames (1 unless set: the speed alone decides; set more to ignore brief stops). `--contact-speed` is in source heights per second and has no default, since how still a planted foot stands depends on the source. A speed `v` given in metres per second on the source is `v / H`, with `H` the source's `heightMeters`; one given on the target, such as a clip spec's `contacts.detect.speed` when the target is the spec's rig, is `v / (k · H)`, because travel reaches the target scaled by `k` (below). The run refuses `auto` without a speed and prints both divisors for the pair. Neither height above any ground nor vertical speed is used, so a foot planted on a step counts, and a heel rising in place stays planted.

A contacts file names the windows instead, in seconds of the source clip:

```json
{ "contacts": [ { "joint": "hand.r", "start": 0.40, "end": 1.25, "animation": "push" },
                { "joint": "foot.l", "start": 0.0, "end": 0.55 } ] }
```

`joint` is `foot.l`, `foot.r`, `toes.l`, `toes.r`, `hand.l` or `hand.r`; `animation` limits a window to one animation. Hands are held only through a file: a hand that is merely still is not a contact.

Goals come from the source joint's position mapped onto the target (the target joint's rest position plus `k` times the source joint's displacement from its rest). An ankle or toe joint stands on the ground: its goal is the window's mean mapped position over the ground, held for the whole window, at the mapped height of each frame, so the hold removes slide and leaves the source's lift and settle. A hand may rest on any surface: its goal is the window's mean mapped position on all three axes. Two-bone IK on the upper and lower limb puts the ankle (or wrist) on its goal; when only the toes are planted, the ankle moves so the toes land on theirs. The foot or hand keeps the rotation the transfer gave it. The limb bends in the plane it already bends in (or, when straight, toward its rest bend: knees forward, elbows back). The correction blends in and out over `--contact-blend` frames (3 unless set) around each window.

Per window the report gives the source joint's slide, the target's slide without and with the correction (largest distance from where it stood at the window's first frame, over the ground for ankles and toes and in space for hands), how far the correction moved it, and `missMeters`, how far it stayed from its goal: above zero when the goal is out of the limb's reach, and for toes when the ankle of the same foot is held (the foot's length differs from `k` times the source's).

## The checks

Each animation passes when all three hold; the report's `passed` also needs the file check below.

**Agreement.** `agreement.transfer` is, per body part, the largest angle over all frames between a source segment and the same target segment, before contact correction; `agreement.final` the same after it. The source is taken as the transfer carries it (`agreement.against`): with `--translation none`, its joints' translations and scales other than the hips' and root's are held at rest, since their effect is reported under `stretch` and lost by design, not a fault of the maps. A correct transfer matches every arm and leg segment exactly: each target bone's rest segment is turned onto the source's by `Q` and then moved by the source's own rotation change, so it points where the source's segment points, whatever the two rests, proportions and bone axes. Arms and legs therefore measure zero to rounding, and anything more means a mapped bone does not stand at its landmark, or a bone between two landmarks turns on the source or stands differently on the target. The check fails when arms or legs exceed `--agreement-degrees` (1 unless set: far above rounding and a file's own numerical noise, far below a misplaced joint). The trunk and the feet are reported but not judged: they keep the rests' own difference by design.

**Side flips.** `sideFlips` counts, per hand and foot, the frames on which it is on the other side of the body's midplane than the source's, both clear of the midplane by 3% of the height: the limb crossed through the body. The check fails when any joint has more than `--side-flip-frames` such frames (0 unless set). A correct transfer can still flip a hand that the source holds just past the midplane when the two bodies' widths differ; allow those frames only after seeing them in the sheet.

**The round trip.** The plain transfer (without contact correction) is retargeted back onto the source with the same rules, and every shared landmark is compared with the source as the transfer carries it (`roundTrip.against`, the same as agreement's): `roundTrip.maxHeights` (largest distance, in source heights) and `maxDegrees` (largest rotation difference). Rest alignment, rotation transfer, travel scaling and scaled offsets are exactly invertible, so the round trip proves only that: it returns to rounding error even for a wrong map, and measures more only when the source moves bones the maps leave out (`notCarried`), or, with `--translation scaled`, translates a landmark whose offset cannot be carried (`stretch` with `carried` false). Under `none` the stretches are held out of it, so a tolerance raised for one never hides motion the maps lose. It fails above `--round-trip-tolerance` source heights (0.002 unless set) or `--round-trip-degrees` (1 unless set).

## Checks on the written file

The written `.glb` is read back and played: `fileCheckMeters` is the largest distance between a joint as played from the file and as computed (a few tenths of a micrometre from storing values as 32-bit floats); it fails above 0.01% of the target's height. `retarget_evidence.py` repeats that check through Blender's own glTF import (`playbackCheckMeters`).

The written file is valid glTF 2.0 and self-contained: every buffer and image the target keeps in another file or a data URI is embedded in the `.glb` (`embedded` in the report lists them), and a target whose referenced file cannot be read, or that keeps data in several buffers and uses an extension the writer cannot renumber references in, is refused before anything is written. A node the animations drive that stores a `matrix` is written as the same translation, rotation and scale, since glTF forbids a matrix on an animated node; the target's dropped animations take their accessors, buffer views and bytes with them (`droppedDataRemovedBytes`). When the target uses an extension the writer cannot renumber references in, that data stays in the file unreferenced and the report warns.
