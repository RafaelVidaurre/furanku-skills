# What the retarget does

The order follows the practice engine retargeters document: align the rest poses first, map limbs as chains between landmarks, designate the pelvis so translation scales with proportions, then correct contacts with IK. Each rule below holds for any pair of humanoid skeletons; the implementation is `scripts/jamretarget/transfer.py`.

## Rest poses

The rest pose of each file is its nodes as stored. When a skinned file's nodes stand away from its bind pose, the report warns (`posed`); the nodes' pose is still what is used, since that is what plays when no animation drives a bone.

Before any frame is transferred, the run refuses a skeleton whose head is not above its feet (not `+Y` up), whose hips-to-head line leans more than 30 degrees from `+Y`, whose left joints are not on `+X` (facing `-Z`, or a map that swaps sides), or whose toes are behind its ankles.

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

Only rotations of shared landmarks are carried, plus the translation of the hips and of a root bone. Rotations of source bones at no shared landmark, translations of other bones and any scale are not carried; when the source animates them the report names them under `notCarried` and in `warnings`.

## Travel and the root

`k` is the target's leg length over the source's (hip joint to knee to ankle, both sides averaged). The target's hips move to their rest position plus `k` times the source hips' displacement from their rest position, in all three axes: a crouch of 0.3 m on the source is `0.3·k` on the target, and so is every metre walked.

The root is the hips' parent when it is a joint of the file's skin (a bone, not an armature node); a skeleton without a skin, such as a converted BVH file, has none. When both skeletons have one, the target's root takes the source root's rotation change and `k` times its displacement. When only the source has one, its motion reaches the target's hips with everything else. When only the target has one, it stays at rest and the hips carry the travel, as on the source. A clip in place stays in place; deriving or removing root travel is the clip's own business, before or after this skill. The report's `hipsTravel` gives both skeletons' hips travel per animation.

## Frames

Frames are whole frames from the source's first key, at the source's frame rate (`1 / key spacing`, which needs evenly spaced keys) or at `--fps`. When the source's length is not a whole number of frames at that rate, the clip ends at the last whole frame and the report warns. Every channel is written LINEAR, one key per frame.

## Contacts

`--contacts` has no default: the person chooses `auto`, a contacts file or `none`.

`--contacts auto` finds, for each ankle (`foot.*`) and toe joint (`toes.*`) both maps place, the windows where the source joint moves slower than `--contact-speed` for at least `--contact-min-frames` frames (1 unless set: the speed alone decides; set more to ignore brief stops). The speed is in source heights per second and has no default, since how still a planted foot stands depends on the source. A speed `v` given in metres per second on the source is `v / H`, with `H` the source's `heightMeters`; one given on the target, such as a clip spec's `contacts.detect.speed` when the target is the spec's rig, is `v / (k · H)`, because travel reaches the target scaled by `k` (below). The run refuses `auto` without a speed and prints both divisors for the pair. Height above any ground is not used, so a foot planted on a step counts.

A contacts file names the windows instead, in seconds of the source clip:

```json
{ "contacts": [ { "joint": "hand.r", "start": 0.40, "end": 1.25, "animation": "push" },
                { "joint": "foot.l", "start": 0.0, "end": 0.55 } ] }
```

`joint` is `foot.l`, `foot.r`, `toes.l`, `toes.r`, `hand.l` or `hand.r`; `animation` limits a window to one animation. Hands are held only through a file: a hand that is merely still is not a contact.

Each window's goal is the mean, over the window, of the source joint's position mapped onto the target (the target joint's rest position plus `k` times the source joint's displacement from its rest), so the target joint holds one place for the whole window. Two-bone IK on the upper and lower limb puts the ankle (or wrist) on its goal; when only the toes are planted, the ankle moves so the toes land on theirs. The foot or hand keeps the rotation the transfer gave it. The limb bends in the plane it already bends in (or, when straight, toward its rest bend: knees forward, elbows back). The correction blends in and out over `--contact-blend` frames (3 unless set) around each window.

Per window the report gives the source joint's slide, the target's slide without and with the correction (largest distance from where it stood at the window's first frame), how far the correction moved it, and `missMeters`, how far it stayed from its goal: above zero when the goal is out of the limb's reach, and for toes when the ankle of the same foot is held (the foot's length differs from `k` times the source's).

## The checks

Each animation passes when all three hold; the report's `passed` also needs the file check below.

**Agreement.** `agreement.transfer` is, per body part, the largest angle over all frames between a source segment and the same target segment, before contact correction; `agreement.final` the same after it. A correct transfer matches every arm and leg segment exactly: each target bone's rest segment is turned onto the source's by `Q` and then moved by the source's own rotation change, so it points where the source's segment points, whatever the two rests, proportions and bone axes. Arms and legs therefore measure zero to rounding, and anything more means a mapped bone does not stand at its landmark, or a bone between two landmarks moves on the source or stands differently on the target. The check fails when arms or legs exceed `--agreement-degrees` (1 unless set: far above rounding and a file's own numerical noise, far below a misplaced joint). The trunk and the feet are reported but not judged: they keep the rests' own difference by design.

**Side flips.** `sideFlips` counts, per hand and foot, the frames on which it is on the other side of the body's midplane than the source's, both clear of the midplane by 3% of the height: the limb crossed through the body. The check fails when any joint has more than `--side-flip-frames` such frames (0 unless set). A correct transfer can still flip a hand that the source holds just past the midplane when the two bodies' widths differ; allow those frames only after seeing them in the sheet.

**The round trip.** The plain transfer (without contact correction) is retargeted back onto the source with the same rules, and every shared landmark is compared with the original: `roundTrip.maxHeights` (largest distance, in source heights) and `maxDegrees` (largest rotation difference). Rest alignment, rotation transfer and travel scaling are exactly invertible, so the round trip proves only that: it returns to rounding error even for a wrong map, and measures more only when the source moves bones the maps leave out, which then appear in `notCarried`. It fails above `--round-trip-tolerance` source heights (0.002 unless set) or `--round-trip-degrees` (1 unless set).

## Checks on the written file

The written `.glb` is read back and played: `fileCheckMeters` is the largest distance between a joint as played from the file and as computed (a few tenths of a micrometre from storing values as 32-bit floats); it fails above 0.01% of the target's height. `retarget_evidence.py` repeats that check through Blender's own glTF import (`playbackCheckMeters`).

The written file is valid glTF 2.0: a node the animations drive that stores a `matrix` is written as the same translation, rotation and scale, since glTF forbids a matrix on an animated node; the target's dropped animations take their accessors, buffer views and bytes with them (`droppedDataRemovedBytes`). When the target uses an extension the writer cannot renumber references in, that data stays in the file unreferenced and the report warns.
