# Reading the retarget report, and what to do when it fails

`retarget-report.json` describes one run. [method.md](method.md) says how each number is made.

## The fields

| Field | What it says |
| --- | --- |
| `passed` | Every round trip passed and the written file plays what was computed |
| `inputs`, `outputs` | Each file with its SHA-256 |
| `source`, `target` | Per skeleton: landmark to bone, the root bone, `unmappedJoints`, `heightMeters` (head landmark above the lower ankle), `legLengthMeters` |
| `landmarks` | `transferred`, `targetOnlyKeptAtRest`, `sourceOnlyNotCarried` |
| `restAlignment` | Per shared landmark: the rule and the turn in degrees between the two rests; for trunk landmarks and feet also `restDifferenceDegrees` |
| `hipsScale.factor` | `k`, the leg-length ratio travel is scaled by |
| `root.travelOn` | `root and hips` or `hips` |
| `animations[]` | Per animation: `sourceFps`, `fps`, `resampled`, `frames`, `startSeconds`, durations, `hipsTravel` of both, `agreement`, `sideFlips`, `contacts`, `roundTrip`, `fileCheckMeters`, `notCarried` |
| `agreement.transfer`, `agreement.final` | Per body part (trunk, arms, legs, feet, fingers), the largest and mean angle between a source segment and the same target segment, before and after contact correction. Arms and legs are 0 before correction when the maps carry the motion; legs move after it by what holding the feet took; the trunk and the feet show the rests' own difference |
| `sideFlips` | Frames on which a hand or foot is on the other side of the body's midplane than the source's (both clear of it by 3% of the height) |
| `droppedTargetAnimations`, `warnings` | What the target lost, and everything worth a look |

## Failures and warnings

| Symptom | Cause | Do |
| --- | --- | --- |
| exit 2, `no bone of ... maps to` | The map does not fit that file | Fix the map ([maps.md](maps.md)); the message lists the bones it does not name |
| exit 2, `left joints are not on +X` | The character faces `-Z`, or the map swaps left and right | Check the map's sides first; otherwise turn the file to face `+Z` (for BVH, flip `--forward`) |
| exit 2, `not +Y up`, `lean` | The file is in another up axis, or its rest pose is not standing | Re-export in glTF's frame; for BVH, set `--up` |
| exit 2, `not on one frame grid` | The source keys are unevenly spaced | Pass `--fps` with the clip's rate |
| exit 1, round trip failed, a `not carried` warning | The source animates bones neither map carries (extra spine joints, twist or helper bones) | Map those bones when they stand at a landmark; otherwise the motion is genuinely lost: decide with the person whether that is acceptable, then rerun with a tolerance above the reported `maxHeights` and say so in the record |
| `sideFlips` above 0 | A limb crossed through the body where the source's did not | Look at those frames in the sheet; check the map's sides and that both rests face `+Z` |
| a large `turnDegrees` on a leg, or on one arm but not the other | A map places a landmark on the wrong bone, or a rest pose is asymmetric | Compare the two rests; fix the map |
| a hand turned about the forearm | The rests hold the palms differently and the maps have no knuckles | Add `index-1` and `pinky-1` to both maps, or accept the hand's rest angle |
| a contact's `targetSlideMeters` above zero | The joint is not held over the whole window (toes held only through the ankle) | Check the window frames against the sheet; set `--contact-speed` or name the windows in a file |
| a contact's `missMeters` well above zero | The goal is out of the limb's reach on the target | Expected for very different proportions; judge the pose in the sheet |
| feet slide in the sheet with no contact window | The source's planted foot moves faster than `--contact-speed` | Set it from the source's own slide (`sourceSlideMeters`), or name the windows |
| `posed` | A file's nodes stand away from its skin's bind pose | Re-export the rig in its bind pose, or confirm the stored pose is the intended rest |
| `playbackCheckPassed` false | Blender reads the written file differently from the helpers | Do not deliver the clip; keep the files and report the difference |
