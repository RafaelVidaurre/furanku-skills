# The clip check

`clip_check.py` measures one clip on the project rig, on whole frames of the spec's `fps`, in the clip's glTF frame (metres, +Y up, front +Z). It reads the clip as stored; a provider's own flags or scores are never used in place of a measure.

## What it measures

| Measure | How | Judged by |
| --- | --- | --- |
| Skeleton | The clip's joints and parents against `rig.model`'s | must match |
| Frames | Every key time on a whole frame of `fps` | must hold |
| Length | First to last frame (for a loop also the full cycle, one frame more) against `length`, within half a frame | must hold |
| Contacts | For each ankle and ball of the foot (and wrist, when `contacts.planted` names a hand): planted on a frame when within `detect.height` of its height at rest and no faster than `detect.speed` horizontally. On ground that is not flat, speed alone | windows reported |
| Foot slide | Per contact window: the largest horizontal distance between any two positions of the point | `accept.footSlide` |
| Penetration | Per foot, the lowest vertex weighted to the foot below the ground; the ground is the lowest foot vertex at rest. A rig without a foot mesh uses its foot joints at their rest height | `accept.penetration`, flat ground only |
| Boundary jump | For every joint and bone end, how far the first frame lies from where the next three frames extrapolate it, minus the largest such residual the same point shows inside the clip; the same for the last frame | `accept.boundaryJump` |
| Loop seam | The same across the wrap from the last frame to the first, relative to the root bone's (or the hips') ground position for root motion, in the world for in-place | `accept.loopSeam`, loops only |

Notes on reading them:

- **Detection limits what slide can show.** A foot moving faster than `detect.speed` is never planted, so a slide faster than that is not measured. Keep the speed above any slide you want caught.
- **In-place clips** have their travel removed, so a planted foot moves backward with the ground. The check refuses them until it is given the travel back: `--travel <travel.json>` from `root_convention.py`, or `--travel-velocity <vx>,<vz>` (m/s; `0,0` when the motion never travelled).
- **Boundary jumps and seams compare against the clip's own motion.** Fast smooth motion leaves a residual too (a swinging foot at 30 fps can leave several centimetres), so the judged jump is what a frame adds beyond the roughest motion of that same point inside the clip. A calm joint that pops reads close to the true size of the pop; a joint already moving fast hides part of its own pop, and the calm joints around it show it instead. `boundary.interior` names the roughest point inside the clip.
- **Bone ends.** glTF stores joints, not bone ends; for a bone without children the check uses the end Blender's importer gives it. Rotations of hands, feet and the head show through those ends.
- **The loop's last frame** is one frame before the first pose returns or a copy of it; `seam.chosenBy` says how it was decided (the spec's length, or the poses for a length range). `--loop-end` overrides it.

## Reading the report

`clip-report.json`:

- `passed`, `failures` (checks and thresholds that failed), `unmeasured` (thresholds that could not be measured, with the reason in `accept.<name>.unmeasured`).
- `accept.<name>`: threshold, measured value, passed.
- `contacts`: one entry per window and point: frames and times, `slide`, `penetration`, `peakSpeed`, `atBoundary` (a window cut by the start or end of the clip), `passed`.
- `expectedContacts`: each window the spec declares planted, with the share of its frames the check found planted on that limb.
- `feet`: worst penetration per foot and its frame. `boundary` and `seam`: the worst point with its residual and the interior maximum it was compared with, and the value per bone. `root`: the hips' net ground travel and height range, and the root bone's travel.
- `ground`, `detect`, `restHeights`, `travelAddedForContacts`: the numbers the measures stand on.
- `evidence`: the sheet with its frames, and the video or the reason there is none.

## Looking at the clip

`clip-sheet.png` shows the character at evenly spaced frames (first and last included), each frame stamped, the camera following the hips over a checkered ground. Green spheres mark planted points on their frames; red marks a point whose window failed slide or penetration. `--view` picks the side (default), front, back or three-quarter view; `--sheet-frames` the count. `clip.mp4` plays every frame when Blender's own video encoder or an `ffmpeg` (on PATH or `--ffmpeg`) is available; otherwise the report says so and the sheet is the evidence. Workbench renders by default; `--engine cycles` renders on the CPU when Workbench cannot run headless.

Judge in the sheet and video what no number covers: the motion reads as the purpose says, key poses are reached, hands and head do nothing strange, nothing passes through the body.

## When a check fails

| Failure | Look at | Usual cause and fix |
| --- | --- | --- |
| `skeleton` | `checks.skeleton` missing, extra, reparented bones | The clip is on another skeleton: retarget it onto the project rig. A rig that changed since the spec was written: update `rig.model` and redo the clip |
| `wholeFrames`, `length` | `checks` | Exported at another rate or range: export again sampled at the spec's `fps` over the clip's frames, or retime with the route that made it |
| `footSlide` | the failing windows, red markers in the sheet | Retargeting changed leg proportions, or the source slides. Pin the foot during the window (IK on the rig, or the retarget skill's foot contacts) and check again. A window that is really a swing caught by detection points at the detection numbers, which the person sets |
| `penetration` | `feet.<limb>.frame` | The ground is lower in the source, or retargeting shortened the legs: correct the hips' height or the foot targets; recheck that the rig's rest pose stands on the ground |
| `boundaryJump` | `boundary.start/end.worst` | A generator's first or last frame snapping to its input, or a clip cut mid-motion: trim the frame or blend it into its neighbours, then recheck the length |
| `loopSeam` | `seam.worst`, `seam.convention` | The cycle does not close: make the last frame continue into the first (or repeat it), or have the route target the clip's own first pose |
| `unmeasured` | `accept.<name>.unmeasured` | Ground that is not flat, or no contact detected: the person judges from the sheet and video, or the detection numbers change |

Change a threshold only when the person decides the project accepts more, and record why.
