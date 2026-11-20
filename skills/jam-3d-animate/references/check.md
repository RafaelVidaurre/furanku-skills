# The clip check

`clip_check.py` measures one clip on the project rig, on whole frames of the spec's `fps`, in the clip format's frame (clip-spec.md). It reads the clip as stored. Contact flags or scores a provider returns are never used in place of a measured contact: `--provider-contacts <file>` only stamps that file into the report beside the measured contacts, for comparison.

## What it measures

| Measure | How | Judged by |
| --- | --- | --- |
| Animations | The file holds one animation (the clip format in clip-spec.md); `--animation` picks which one to measure in a file with several | must hold |
| Skeleton | The clip's joints, their parents and each joint's rest (world position and orientation, from the skin's inverse bind matrices; from the joints' nodes for a skin without them) against `rig.model`'s, within 0.1 mm and about 0.01° | must match |
| Frames | Every key on a whole frame of `fps`, and every frame from the first to the last keyed (a channel that never changes may have fewer keys) | must hold |
| Length | First to last frame (for a loop also the full cycle, one frame more) against `length`, within half a frame | must hold |
| Contacts | For each ankle and ball of the foot (and wrist, when `contacts.planted` names a hand): planted on a frame when within `detect.height` of its height at rest and no faster than `detect.speed` horizontally. On ground that is not flat, speed alone | windows reported |
| Foot slide | The largest horizontal distance between any two positions of a point: per detected window, and per declared window (`contacts.planted`) whatever the speed, taking the foot's least-moving point (a foot turning on its heel or ball is planted) | `accept.footSlide`, the larger of the two |
| Travel at ground height | Per run of frames a foot spends within `detect.height` of the ground (one of its points, flat ground only) while detection plants none of its points and no declared window holds it: the travel of its least-moving point and its peak speed | not judged: a run longer than `accept.footSlide` puts `groundTravel` in `unjudged`, for the person |
| Penetration | Per foot, the lowest vertex weighted to the foot below the ground; the ground is the lowest foot vertex with the skin at rest. A rig without a foot mesh uses its foot joints at their rest height | `accept.penetration`, flat ground only |
| Boundary jump | For every joint and bone end, how far the first frame lies from where the next three frames extrapolate it, minus the largest such residual the same point's smooth motion shows inside the clip; the same for the last frame | `accept.boundaryJump` |
| Interior jump | Between any two frames that touch neither end, how far a joint's step departs from the steps around it in the pattern a jump makes, beyond how far the steps around it stray from that pattern (a jump of d reads d; fast smooth motion close to 0) | `accept.boundaryJump` |
| Loop seam | The boundary measure across the wrap from the last frame to the first, and the interior jump on the steps around the wrap read as the loop plays, under the loop-end convention of clip-spec.md, relative to the root bone's (or the hips') ground position for root motion, in the world for in-place | `accept.loopSeam`, loops only |

Notes on reading them:

- **Travel at ground height is the person's to judge.** A foot near the ground and moving fast is a swing passing low, a foot lifting off or coming down, a foot dragging or skating along the floor, or a planted foot sliding faster than detection; height and speed cannot tell these apart, so the check reports each run and judges none. Show the person the run's frames in the video (amber markers): a foot that should hold there gets a declared window (`contacts.planted`), which is judged as a slide whatever the speed; a swing or touch-down the person accepts is acknowledged (`--acknowledge groundTravel`, SKILL.md step 6). A foot sunk below the ground stays within the contact height through its swing, so it shows here beside its penetration.
- **In-place clips** have their travel removed, so a planted foot moves backward with the ground. The check refuses them until it is given the travel back: `--travel <travel.json>` from `root_convention.py`, or `--travel-velocity <vx>,<vz>` (m/s; `0,0` when the motion never travelled).
- **Boundary jumps and seams compare against the clip's own smooth motion.** Fast smooth motion leaves a residual too, so the judged jump is what an end frame adds beyond the roughest smooth motion of that same point inside the clip; stencils that a jump inside the clip accounts for are left out of that comparison, so such a jump hides no pop at an end. A calm joint that pops reads close to the true size of the pop; a joint already moving fast hides part of its own pop, and the calm joints around it show it instead. `boundary.smooth` names the roughest point.
- **Interior jumps** read a joint that jumps by its size, less the roughness of the motion around it (a joint already moving fast hides part of a jump of its own; the calm joints around it show it instead). A joint that stops dead within a frame reads too: from a speed of s m/s, s / (3·fps). A deliberate hard stop (an impact) is then the person's call, by the threshold. A second jump within four frames lowers the reading by up to a sixth of that jump.
- **Bone ends.** glTF stores joints, not bone ends; for a bone without children the check uses the end Blender's importer gives it. Rotations of hands, feet and the head show through those ends.
- **The loop's last frame:** `seam.chosenBy` says how the convention was decided (the spec's length, or the poses for a length range); `--loop-end` overrides it.

`--measure-only` reads no thresholds and judges nothing: `accept` and `failures` are null, `passed` is null, `measures` holds every number, and the script exits 0 once the clip is measured. Without detection numbers it leaves the detected contacts out (`contacts` null). Its report is never accepted for delivery.

## Reading the report

`clip-report.json`:

- `passed` (true, false, or null while something awaits a person or with `--measure-only`), `failures` (checks and thresholds that failed), `unmeasured` (measures that could not be taken; the reason is in `accept.<name>.unmeasured`), `unjudged` (`groundTravel` when a run of travel at ground height is longer than `accept.footSlide`; null with `--measure-only`), `acknowledged` (the names given with `--acknowledge`), `awaiting` (names in `unmeasured` or `unjudged` not acknowledged).
- `measures`: each measured value; `accept.<name>`: threshold, measured value, passed (`interiorJump` against `accept.boundaryJump`).
- `checks`: `animations` (the file's animations and the one measured), `skeleton` (missing, extra, reparented bones and `rest`: the worst difference and its bone), `wholeFrames` (`framesWithoutKey`, `sparse` channels), `length`.
- `contacts`: one entry per detected window and point: frames and times, `slide`, `penetration`, `peakSpeed`, `atBoundary` (a window cut by the start or end of the clip), `passed`.
- `expectedContacts`: each window the spec declares planted, with its `slide` per point and for the limb, `passed`, and the share of its frames detection found planted.
- `grounded`: each run of travel at ground height per foot: frames and times, `travel` per point and for the foot (its least-moving point), `peakSpeed`, and `toJudge` (longer than `accept.footSlide`).
- `feet`: worst penetration per foot and its frame. `boundary`: per end the worst point with its residual and its smooth `baseline`, and the value per bone; `interior`: the largest jump inside the clip and its frames; `smooth`: the roughest smooth motion. `seam`: the same for the wrap. `root`: the hips' net ground travel and height range, and the root bone's travel.
- `ground`, `detect` (with `from`: the spec's `contacts.detect`, or the command line), `restHeights`, `travelAddedForContacts`: the numbers the measures stand on.
- `evidence`: the sheet with its frames, and the video or the reason there is none.

## Looking at the clip

`clip-sheet.png` shows the character at evenly spaced frames (first and last included), each frame stamped, the camera following the hips over a checkered ground. Green spheres mark planted points on their frames; red marks a point whose window failed slide or penetration; amber marks a foot's travel at ground height that is the person's to judge. `--view` picks the side (default), front, back or three-quarter view; `--sheet-frames` the count. `clip.mp4` plays every frame at the spec's rate when Blender's own video encoder or an `ffmpeg` (on PATH or `--ffmpeg`) is available; otherwise the report says so and the sheet is the evidence. Workbench renders by default; `--engine cycles` renders on the CPU when Workbench cannot run headless.

Judge in the sheet and video what no number covers: the motion reads as the purpose says, key poses are reached, hands and head do nothing strange, nothing passes through the body.

## When a check fails

| Failure | Look at | Usual cause and fix |
| --- | --- | --- |
| `animations` | `checks.animations.names` | A file of several clips: run `root_convention.py --animation <name>`, which writes the one clip |
| `skeleton` | `checks.skeleton` missing, extra, reparented bones, `rest` | The clip is on another skeleton, or on a copy of the rig that was moved, scaled or edited: retarget it onto the project rig. A rig that changed since the spec was written: update `rig.model` and redo the clip |
| `wholeFrames`, `length` | `checks` | Exported at another rate, range or with keys thinned out: export again sampled on every frame at the spec's `fps` over the clip's frames, or retime with the route that made it |
| `footSlide` | the failing detected and declared windows, red markers in the sheet | Retargeting changed leg proportions, or the source slides. Pin the foot during the window (IK on the rig, or the retarget skill's foot contacts) and check again. A detected window that is really a swing points at the detection numbers, which the person sets |
| `groundTravel` (unjudged) | `grounded` runs with `toJudge`, amber markers in the video | The person judges each run: a low swing, lift-off or touch-down they accept is acknowledged; a foot meant to hold gets a declared window and the check runs again; a foot dragging, skating or sunk goes back to the route that made the motion |
| `penetration` | `feet.<limb>.frame` | The ground is lower in the source, or retargeting shortened the legs: correct the hips' height or the foot targets; recheck that the rig's rest pose stands on the ground |
| `boundaryJump` | `boundary.start/end.worst` | A generator's first or last frame snapping to its input, or a clip cut mid-motion: trim the frame or blend it into its neighbours, then recheck the length |
| `interiorJump` | `boundary.interior` (bone and frames), the video at those frames | A pose snapping between two generated or retargeted segments, a flipped joint, a bad key: fix or blend the frames around it |
| `loopSeam` | `seam.worst`, `seam.convention` | The cycle does not close: make the last frame continue into the first (or repeat it), or have the route target the clip's own first pose |
| `unmeasured` | `accept.<name>.unmeasured` | Ground that is not flat, or no contact detected or declared: the person judges from the sheet and video (acknowledged when they accept it), or the detection numbers change |
