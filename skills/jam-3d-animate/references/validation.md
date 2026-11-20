# What was validated

Facts about the scripts in this skill as shipped, from runs on 2026-11-20 with Blender 5.1.2, Python 3 with numpy 2.4 and ffmpeg on one authoring machine. A run on that machine is evidence of that run, not a requirement.

## The test clips

`scripts/make_test_clip.py` builds a 1.7 m figure of boxes, each weighted wholly to one bone (21 bones, optionally under a ground-level `root` bone, with landmark or camel-case bone names), soles exactly on the ground at rest. Its walk is computed: the hips travel 1 m/s along the figure's front with a 3 cm bob and a 4 cm sway; each foot is planted for 60% of a 1 s cycle and swings 8 cm high for 40%, with curves that start and end at rest; the legs are solved to reach the feet, the arms swing. At 30 fps that is 30 frames, ending one frame before the first pose returns (31 with the first pose repeated). Faults are built in at known sizes, among them a step: from a given frame on, the whole body sits further forward. Each run below used `contacts.detect` height 0.01 m and speed 0.5 m/s, and thresholds of 0.01 m (slide, boundary jump, seam) and 0.005 m (penetration): the test project's own numbers, not advice.

## The check against faults of known size

| Clip | Built | Measured | Verdict |
| --- | --- | --- | --- |
| clean | none | windows' slide 0.0000, runs at ground height 0.0051 m (lift-off and touch-down), penetration 0.0000, start and end jump 0.0000, seam 0.0000 | passed |
| left foot slides 2 cm over its planted window (frames 0–18) | 0.0200 m | slide 0.0200 m, window 0–18; run at ground height 0.0250 m (with lift-off and touch-down) | footSlide failed |
| the same, 5 cm | 0.0500 m | slide 0.0500 m; run at ground height 0.0548 m | footSlide failed |
| right foot 3 cm lower all through | 0.0300 m | penetration 0.0300 m on the mesh, every right-foot window 0.0300; the sunk foot stays within the contact height through most of its swing, run at ground height 0.1035 m | penetration and footSlide failed |
| the same, skeleton only (no mesh) | 0.0300 m | penetration 0.0300 m from the foot joints at their rest height; run 0.1035 m | penetration and footSlide failed |
| whole body 8 cm sideways on the first frame | 0.0800 m | start jump 0.0793 m, end 0.0000; the planted feet move with it (run at ground height 0.0802 m) | boundaryJump and footSlide failed |
| the same on the last frame | 0.0800 m | end jump 0.0790 m, start 0.0000; run 0.0802 m | boundaryJump and footSlide failed |
| body rises over the second half, loop does not close | 0.0100 m | seam 0.0095 m | passed (under the 0.01 threshold) |
| the same | 0.0300 m | seam 0.0292 m | loopSeam failed |
| the same | 0.1000 m | seam 0.0983 m | loopSeam failed |
| clean, last frame repeats the first pose | none | seam 0.0000 under `duplicate-end`, chosen from the spec's length | passed |
| left foot slides 40 cm over its planted window, faster than `detect.speed` | 0.4000 m | detected windows: 3.1 mm (only the two frames where it stops); the run at ground height: 0.4031 m; with the window declared in `contacts.planted`: 0.4000 m | footSlide failed, declared or not; interiorJump too (the foot stops dead, 13.6 mm) |
| 8 cm pop on the first frame and an 8 cm step forward at frame 15 | 0.0800 m each | start jump 0.0793 m, interior jump 0.0831 m between frames 14 and 15 | boundaryJump and interiorJump failed |
| body rises 20 cm over the second half, with steps of +5 cm at frame 8 and −5 cm at frame 12 | 0.2000 m | seam 0.1964 m, interior jump 0.0520 m | loopSeam and interiorJump failed |
| clean, at 29.97 fps (30 frames, cycle 30/29.97 s), in place | none | last key at 29/29.97 s before and after `root_convention.py`; every frame on the grid | passed |

Every fault was read within 4 mm of its built size by the measure built for it. Pops and seams read slightly under their size (the smooth residual around them is subtracted), steps slightly over (the motion around them adds). Runs at ground height read the slide plus the travel of lift-off and touch-down inside the contact height: 5.1 mm on this walk with a 0.01 m contact height. On the clean clip, every frame the walk was built planted was found planted, give or take one frame at each window's edge, every window's slide was 0.0000, and the largest interior jump was 6.2 mm (a knee where the leg solver straightens it).

How the measures came to be what they are:

- A pop first read as a raw extrapolation residual. On the clean walk that residual is up to 3.2 cm on a swinging knee at 30 fps, because fast smooth motion leaves one too; so the jump is what a frame adds beyond the roughest residual the same point shows inside the clip.
- Frames next to the first or last were at first part of that comparison, and an 8 cm pop then read 0. The comparison now uses frames that touch neither end.
- Choosing the loop's last-frame convention by the better fit flipped once a seam fault grew to about one frame of motion (a 6 cm fault read 5 cm on the wrong convention). It now comes from the spec's length, and from the poses only for a length range.
- A seam fault built by turning an arm read 25% high, because glTF stores no bone ends and Blender's importer gives a hand longer than the figure's. The measure was right for the points it reads; the fault is now built by moving the hips, so its size is the same at every point.
- The pop and seam were at first compared with the largest residual anywhere inside the clip, so one jump inside the clip hid them: the seam of a loop 20 cm open read 9.9 cm next to two 5 cm steps. Stencils a jump inside the clip accounts for are now left out of the comparison, and jumps inside the clip are measured themselves.
- Slide was at first measured on detected windows only, so a foot sliding faster than `detect.speed` passed. Declared windows and every run of frames within the contact height are now measured whatever the speed. Judging only runs that held no slow frame missed the 40 cm slide, which ends in two slow frames.
- At 29.97 fps the scripts set Blender's frame rate the way its own playback reads it (fps / fps_base), but its glTF add-on converts times with fps × fps_base: keys came out 1/30.03 s apart and the check refused the clip. The scripts now set the rate the add-on reads, and Blender's playback rate only for the video.

## The clip format

- A copy of the test rig with one shin 2% longer (8.4 mm at the knee), the same names and parents: the skeleton check failed on `rest` (0.0084 m at `lower-leg.l`). The same rig exported again differs by under 1e-6 m.
- A file with two animations, measured with `--animation`: everything else passed and `animations` failed; `root_convention.py --animation` wrote a file with that one animation.
- `--measure-only` on a spec with no `accept` and no detection numbers: exit 0, `passed` null, the 8 cm end pop read 0.0790 m, foot slide unmeasured.
- The glTF reader reads 15-fps keys as whole frames of 30 fps; the frame check now fails them (`framesWithoutKey`), and passes a channel that holds one value on two keys (unit tests).

## The root convention

On the clean walk (travel on the hips, no root bone):

| | Hips net travel | Along travel | Across (sway) | Height range (bob) |
| --- | --- | --- | --- | --- |
| before | 0.9667 m | 0.9667 m | 0.0399 m | 0.0297 m |
| after in-place, `--travel line` | 0.0043 m (the sway at the last frame) | 0.0000 m | 0.0399 m | 0.0297 m |

Per frame, the hips' height was unchanged to 6e-8 m and their sideways position to 0.17 mm. `travel.json` read the loop as open-ended and spanned the whole cycle (0.9667 m at the last frame). Checked with `--travel travel.json`, the in-place clip passed with slide 0.0000 and seam 0.0000 measured in the world. Without `--travel`, the check refused the clip and named the two options; before that refusal existed, the planted feet moved at 1 m/s, no real contact was detected, and only stray single-frame windows were left.

The first version took travel from the first frame to the last; on an open-ended loop that put the sway's last-frame offset into travel, and the in-place seam read 3.7 mm. Travel now spans the full cycle.

On the walk with a ground-level root bone and camel-case names, with travel on the hips and the root still, root motion onto `root`:

- every joint other than the root stayed where it was, to 3.2e-6 m over all 30 frames, read back from the written file by the skill's own glTF reader;
- the root travelled 0.9667 m;
- with `--travel line` the hips kept their sway relative to the root (0.0399 m across, 0.0000 m along); with `--travel hips` they kept nothing horizontal (0.0000 m);
- the check passed with the seam measured relative to the root.

## Key poses

Two one-key poses ("contact" from frame 0, "passing" from frame 7) went from a `.glb` of pose animations onto the rig at 0.0 s and 0.4 s. `keyposes.glb` held one animation with keys at exactly those times, and every joint matched its source pose to 3.4e-6 m. A pose name missing from the source was refused, naming the actions the source has. The same poses saved as actions in a `.blend` and passed as `--poses` gave the same result (3.4e-6 m). A `.blend` of poses that also held other objects (a bone shape the glTF importer had added) first put them into the key-pose file; the file now holds the rig's own objects only, and a test covers it.

The same poses on an armature kept in centimetres (bones a hundred times longer, the object scaled 0.01, so the same rest in the world) first came out up to 137 m off, because each bone was copied in the armature's own space; carried over as motion from rest in the world, they matched to 3.3e-6 m. The pose sheet (`keyposes-sheet.png`) showed both poses, each stamped with its name and time, and was looked at.

## The blockout

From the two key poses at 0 and 0.4 s, for a 0.5 s clip that does not loop: 16 frames on the 30 fps grid, one animation, the poses at frames 0 and 12, the last pose held to frame 15; the check (`--measure-only`) passed animations, skeleton, frames and length. As a blockout should, it is not yet motion: foot slide 33.9 mm, penetration 13.5 mm, an interior jump of 19.2 mm at the right hand where the straight-line motion turns at a pose. Halfway between two poses a joint turned 90° stands at 45°, and the hips halfway along their travel (unit tests).

## Evidence

- The sheet rendered with Workbench (default) and with `--engine cycles`; green markers sat under planted points and red under the sunken foot's windows. Looked at for the clean, sunken and slide clips.
- Video: Blender's own encoder wrote `clip.mp4` for every clip above; `--ffmpeg <path>` wrote it through ffmpeg from rendered frames instead. The path where neither exists, which reports why there is no video, was not run.
- A full check of a 30-frame clip, with sheet and video at 240×300, took about one second.

## The animation recipe, end to end

On 2026-11-20, after the review fixes, in a fresh scratch project with the toolkit installed by `jam-setup`'s install script, Blender 5.1.2 and ffmpeg on one authoring machine; generation on a separate GPU host through an `inbetween` provider reached through its skill; an engine adapter whose `import` takes `--kind animation`, on a scratch engine project. The rig was `jam-3d-rig`'s test humanoid (1.7 m, A-pose, fingers) bound by its `bind.py`, with that skill's landmark-names map as `rig.map`. Every threshold and detection number below is the test project's own, set by the tester, not advice. Each step was recorded and accepted by the toolkit's checks, and both runs were delivered (`jam run deliver` verified every file).

**By hand: `bow`.** 30 fps, 1.2 s fixed, not looping, in place, flat ground; key poses `stand` (0 s), `bow` (0.6 s: hips 3 cm back and 5 cm down, spine and chest bent 22° each, knees bent with the feet on their rest spots) and `upright` (1.2 s); both feet declared planted throughout; detection 0.02 m and 0.2 m/s; slide 0.01 m, penetration 0.01 m, jump 0.02 m.

- `blockout.py`: 37 frames, the poses at frames 0, 18 and 36. `clip_check.py --measure-only`: format checks passed; slide 0.7 mm, penetration 11.7 mm (the feet sink between poses, where the bent legs are interpolated joint by joint), interior jump 15.3 mm.
- A keying pass in Blender, scripted in place of an animator: eased timing into and out of each pose, an IK target per foot at its rest spot holding the foot's rest orientation, baked on every frame and exported with routes.md's call. Slide 0.0, penetration 0.0, start and end jump 2.6 mm, interior jump 0.1 mm.
- `root_convention.py --travel line`: no net travel; the hips kept their 3 cm along and 5 cm height range. The check passed, both declared windows at 0.0 slide. Sheet and video looked at: it bows and straightens with both feet planted.
- Found: `jam run start` refused the skill's command without a brief (it now gives `--brief-text`); the route's own done criterion, `--measure-only`, refused an in-place spec without travel (routes.md now gives `--travel-velocity 0,0`); a first keying pass in a scene left at Blender's default 24 fps wrote the 37 frames 1/24 s apart, and the check failed `wholeFrames` and `length` (1.5 s; routes.md now says to set the rate before importing).

**A motion provider: `step-greet`.** 30 fps, 0.9 to 1.6 s, not looping, root motion on the hips, flat ground; detection 0.03 m and 0.25 m/s; slide 0.03 m, penetration 0.02 m, jump 0.03 m. The provider's tooling asked for a floor tolerance (the spec's `accept.penetration`, 0.02 m) and, for chained generations, a seam tolerance (`accept.boundaryJump`, 0.03 m).

- **Stepping versions failed the check**, as they should. A step of 0.8 m to a greet at 1.1 s, generated from a held standing pose with one target pose, retargeted with contacts detected at the spec's speed: slide 0.642 m. The generated motion itself dragged the stepping foot along the floor, within the contact height, at up to 2.7 m/s before lifting it; only the runs at ground height measure that: the detected windows alone read at most 23 mm. Penetration 32.4 mm and an interior jump of 32.3 mm came with it. A longer generation of the same step slid 0.773 m; 1.4 m in 1.5 s gave real steps (feet lifted 16 and 47 cm) and still slid 0.279 m (the planted feet drift as the body sets off; a landing foot skids 28 cm). Holding named contact windows in the retarget turned the skid into jumps of up to 14.9 cm where the hold blends in.
- **The spec was revised** by the tester, as the person, to an in-place greet (right hand above the head at 1.1 s) and recorded again: 34 frames; on the project rig slide 11.6 mm, penetration 4.4 mm, start and end jump 6.4 mm, interior jump 5.8 mm, runs at ground height 0.1 to 0.2 mm; passed. Sheet and video looked at: it raises the right hand with both feet planted. The engine import recorded one sequence of 1.1 s on the rig's skeleton.
- **A second attempt of the same run** (the greet over 1.4 s, 42 frames) passed the check (slide 13.6 mm, penetration 4.6 mm, jumps 5.7 and 6.8 mm), and its import replaced the first attempt's sequence under the same engine id.

## Tests

- `python3 -m pytest scripts/test_jamanim.py`: 59 tests of the spec (each field's one shape, the refusals the toolkit makes too: nulls, unknown fields, numbers that are not finite, pose order and length, project-relative paths), the three map shapes, the glTF reader (percent-encoded buffer names, the frame grid, rests), the measures on synthetic trajectories (pops next to interior jumps, a seam next to steps, a slide too fast to detect), travel and the blockout.
- `python3 -m pytest scripts/test_animate_blender.py`: 26 tests that build the clips above in Blender and assert the numbers within the stated tolerances, including every row of the tables above, key poses from a `.glb`, from a `.blend` holding other objects and from a centimetre armature, the pose sheet, the blockout, and video through ffmpeg. About two minutes.

## Not validated

- **Real characters and captured motion.** The rigs were generated test figures; a real rig's twist bones and dense meshes, and captured motion, were not run.
- **Keying by a person, the retarget-a-library route, and paid providers.** The by-hand route ran end to end with a scripted keying pass; the provider route with one generator on its own host.
- **Engines other than the one import above**, and clips that travel through an engine import after these fixes.
- **Turning clips.** The root convention moves translation only; travel along a curve and heading on the root bone were not run.
- **Ground that is not flat** beyond confirming that penetration is reported unmeasured and contacts are found by speed alone.
- **Hand contacts** (`contacts.planted` naming a hand): code path only.
- **A pose library made in Blender's own pose-library tools**: the `.blend` sources above held plain actions.
- **The headless renderers elsewhere.** Workbench and Cycles ran on the authoring machine only, which has a display; whether Workbench renders headless on a machine without one was not run.
- **Other Blender versions and operating systems.**
- **The video's frame rate at 29.97 fps.** The scripts set it; no video was played back and timed.
