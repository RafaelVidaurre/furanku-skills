# Reading the retarget report, and what to do when it fails

`retarget-report.json` describes one run. [method.md](method.md) says how each number is made.

## The fields

| Field | What it says |
| --- | --- |
| `passed` | Every animation passed (its own `passed`: agreement, side flips and round trip) and the written file plays what was computed |
| `inputs`, `outputs` | Each file with its SHA-256 |
| `source`, `target` | Per skeleton: landmark to bone, the root bone, `unmappedJoints`, `heightMeters` (head landmark above the lower ankle), `legLengthMeters`, `facing` (`sideLineDegrees`, `feetDegrees`: how far the rest is turned about `+Y`) |
| `landmarks` | `transferred`, `targetOnlyKeptAtRest`, `sourceOnlyNotCarried` |
| `restAlignment` | Per shared landmark: the rule and the turn in degrees between the two rests; for trunk landmarks and feet also `restDifferenceDegrees` |
| `hipsScale.factor` | `k`, the leg-length ratio travel is scaled by |
| `translation` | `mode` (`none` or `scaled`) and, per landmark, the offset it is measured `from`, the length `ratio` a scaled offset takes and whether it is `carriable` |
| `root.travelOn` | `root and hips` or `hips` |
| `animations[]` | Per animation: `passed`, `sourceFps`, `fps`, `resampled`, `frames`, `startSeconds`, durations, `hipsTravel` of both, `agreement`, `sideFlips`, `contacts`, `roundTrip`, `fileCheckMeters`, `stretch`, `notCarried` |
| `stretch` | Per landmark whose offset from the previous one the source's translations or scales change: `maxMeters`, `maxDegrees`, `lengthRatio`, and whether the run `carried` it |
| `agreement.transfer`, `agreement.final` | Per body part (trunk, arms, legs, feet, fingers), the largest and mean angle between a source segment and the same target segment, before and after contact correction, against the source as carried (`against`). `passed` judges arms and legs of `transfer` against `toleranceDegrees`: they are 0 when the maps fit. Legs move after correction by what holding the feet took; the trunk and the feet show the rests' own difference |
| `sideFlips`, `sideFlipsPassed` | Frames on which a hand or foot is on the other side of the body's midplane than the source's (both clear of it by 3% of the height), and whether each count is within `sideFlipsAllowedFrames` |
| `options` | Every option the run used, tolerances included |
| `droppedTargetAnimations`, `droppedDataRemovedBytes`, `embedded`, `warnings` | What the target lost and how many bytes of its data were removed (`null`: kept unreferenced), the files and data URIs embedded from the target, and everything worth a look |

## Failures and warnings

| Symptom | Cause | Do |
| --- | --- | --- |
| exit 2, `no bone of ... maps to` | The map does not fit that file | Fix the map ([maps.md](maps.md)); the message lists the bones it does not name |
| exit 2, `left joints are not on +X` or `toes are behind the ankles` | The character faces `-Z`, or the map swaps left and right | Check the map's sides first; otherwise turn the file to face `+Z` (for BVH or FBX, convert again with the opposite `--facing`) |
| exit 2, `turned about +Y` | The rest pose faces another way than `+Z`: the file is turned, or a BVH or FBX was converted with the wrong `--facing` | Turn the file to face `+Z`, or convert again with the axis the character looks along. Only when the sheet or the rig shows the rest itself is built unevenly (the angle is its build, not a turn), rerun with `--facing-degrees` above the reported angle and say so in the record |
| exit 2, `are mirrored` | A bone the transfer drives, or a parent of it, has a negative scale | Export the rig with the mirror applied (positive scales) in the tool that made it |
| exit 2, `refers to … which cannot be read` | The target keeps a buffer or image in a file that is not where its URI says | Put the file beside the target as the URI names it, or export the target as a self-contained `.glb` |
| exit 2, `not +Y up`, `lean` | The file is in another up axis, or its rest pose is not standing | Re-export in glTF's frame; for BVH or FBX, convert again with the right `--up` |
| exit 2, `not on one frame grid` | The source keys are unevenly spaced | Pass `--fps` with the clip's rate |
| exit 2, `--contacts auto needs --contact-speed` | Planted is defined by a speed nobody gave | Get it from the person or the clip spec and divide as the message says, or choose a contacts file or `none` |
| `clip_to_glb.py` exit 2, `declares that` | The FBX file states another up axis or unit than the flags | Pass the declared values; when the file's content shows its header is wrong (the printed height, the retarget's facing check), keep your flags and add `--ignore-declared` |
| `clip_to_glb.py` exit 2, `one skeleton` | The FBX file holds several skeletons | Pass `--armature` with the one that carries the motion |
| exit 1, an `arms point up to … degrees away` or `legs point …` warning | A map places a landmark on a bone that does not stand at it (a twist or helper bone, the wrong side), or a bone between two landmarks turns | Compare the named landmark's bone with the rig: fix the map. When the source animates a bone between two landmarks that no landmark can take, the motion is genuinely lost: decide with the person, then rerun with `--agreement-degrees` above the reported angle and say so in the record |
| exit 1, round trip failed, a `move landmarks off where its rotations put them` warning | The source stretches or slides bones by translation or scale (`stretch`), and `--translation none` keeps the target's bone lengths | Decide with the person: rerun with `--translation scaled` when the target should stretch like the source; keep `none` when it should keep its proportions (a target whose consumer needs fixed bone lengths), then rerun with a round-trip tolerance above the reported `maxHeights` and say so in the record |
| exit 1, round trip failed, a `not carried` warning | The source animates bones neither map carries (extra spine joints, twist or helper bones) | Map those bones when they stand at a landmark; otherwise the motion is genuinely lost: decide with the person whether that is acceptable, then rerun with a tolerance above the reported `maxHeights` and say so in the record |
| exit 1, `sideFlips` above 0 | A limb crossed through the body where the source's did not | Look at those frames in the sheet; check the map's sides and that both rests face `+Z`. When the sheet shows a hand the source holds just past the midplane landing just past it on the other side, rerun with `--side-flip-frames` at that count and say so in the record |
| a large `turnDegrees` on a leg, or on one arm but not the other | A map places a landmark on the wrong bone, or a rest pose is asymmetric | Compare the two rests; fix the map |
| a hand turned about the forearm | The rests hold the palms differently and the maps have no knuckles | Add `index-1` and `pinky-1` to both maps, or accept the hand's rest angle |
| a contact's `targetSlideMeters` above zero | The joint is not held over the whole window (toes held only through the ankle) | Check the window frames against the sheet; ask the person for another `--contact-speed` or name the windows in a file |
| a jump where a named window begins or ends | The window starts or ends while the source joint still moves over the ground, and the hold pulls it to its goal within `--contact-blend` frames | Start and end each named window where the source joint has stopped (its speed over the ground near zero), or widen the blend |
| a contact's `missMeters` well above zero | The goal is out of the limb's reach on the target | Expected for very different proportions; judge the pose in the sheet |
| feet slide in the sheet with no contact window | The source's planted foot moves faster than `--contact-speed` | Show the person the source's own slide (`sourceSlideMeters` of the windows found) and agree a faster speed, or name the windows |
| `posed` | A file's nodes stand away from its skin's bind pose | Re-export the rig in its bind pose, or confirm the stored pose is the intended rest |
| `playbackCheckPassed` false | Blender reads the written file differently from the helpers | Do not deliver the clip; keep the files and report the difference |
