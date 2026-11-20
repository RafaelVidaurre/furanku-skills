# What was validated

Facts about the scripts in this skill as shipped, from runs on 2026-11-20 with Blender 5.1.2 on macOS (Apple silicon), Python 3 with numpy 2.4, and ffmpeg from Homebrew. A run on this machine is evidence of that run, not a requirement.

## The test clips

`scripts/make_test_clip.py` builds a 1.7 m figure of boxes, each weighted wholly to one bone (21 bones, optionally under a ground-level `root` bone, with landmark or camel-case bone names), soles exactly on the ground at rest. Its walk is computed: the hips travel 1 m/s along the figure's front with a 3 cm bob and a 4 cm sway; each foot is planted for 60% of a 1 s cycle and swings 8 cm high for 40%, with curves that start and end at rest; the legs are solved to reach the feet, the arms swing. At 30 fps that is 30 frames, ending one frame before the first pose returns (31 with the first pose repeated). Faults are built in at known sizes. Each run below used `contacts.detect` height 0.01 m and speed 0.5 m/s, and thresholds of 0.01 m (slide, boundary jump, seam) and 0.005 m (penetration): the test project's own numbers, not advice.

## The check against faults of known size

| Clip | Built | Measured | Verdict |
| --- | --- | --- | --- |
| clean | none | slide 0.0000, penetration 0.0000, start and end jump 0.0000, seam 0.0000 | passed |
| left foot slides 2 cm over its planted window (frames 0–18) | 0.0200 m | slide 0.0200 m, window 0–18 | footSlide failed |
| the same, 5 cm | 0.0500 m | slide 0.0500 m | footSlide failed |
| right foot 3 cm lower all through | 0.0300 m | penetration 0.0300 m on the mesh, every right-foot window 0.0300 | penetration failed |
| the same, skeleton only (no mesh) | 0.0300 m | penetration 0.0300 m from the foot joints at their rest height | penetration failed |
| whole body 8 cm sideways on the first frame | 0.0800 m | start jump 0.0793 m, end 0.0000 | boundaryJump failed |
| the same on the last frame | 0.0800 m | end jump 0.0790 m, start 0.0000 | boundaryJump failed |
| body rises over the second half, loop does not close | 0.0100 m | seam 0.0095 m | passed (under the 0.01 threshold) |
| the same | 0.0300 m | seam 0.0292 m | loopSeam failed |
| the same | 0.1000 m | seam 0.0983 m | loopSeam failed |
| clean, last frame repeats the first pose | none | seam 0.0000 under `duplicate-end`, chosen from the spec's length | passed |

Every fault was read within 2 mm of its built size, and no fault leaked into another measure. Pops and seams read slightly under their size: the residual of the frames around them is subtracted. On the clean clip, every frame the walk was built planted was found planted, give or take one frame at each window's edge, and every window's slide was 0.0000.

How the measures came to be what they are:

- A pop first read as a raw extrapolation residual. On the clean walk that residual is up to 3.2 cm on a swinging knee at 30 fps, because fast smooth motion leaves one too; so the jump is what a frame adds beyond the roughest residual the same point shows inside the clip.
- Frames next to the first or last were at first part of that comparison, and an 8 cm pop then read 0. The comparison now uses frames that touch neither end.
- Choosing the loop's last-frame convention by the better fit flipped once a seam fault grew to about one frame of motion (a 6 cm fault read 5 cm on the wrong convention). It now comes from the spec's length, and from the poses only for a length range.
- A seam fault built by turning an arm read 25% high, because glTF stores no bone ends and Blender's importer gives a hand longer than the figure's. The measure was right for the points it reads; the fault is now built by moving the hips, so its size is the same at every point.

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

Two one-key poses ("contact" from frame 0, "passing" from frame 7) went from a `.glb` of pose animations onto the rig at 0.0 s and 0.4 s. `keyposes.glb` held one animation with keys at exactly those times, and every joint matched its source pose to 3.4e-6 m. A pose name missing from the source was refused, naming the actions the source has. The same poses saved as actions in a `.blend` gave the same result twice: as `--poses <file.blend>` beside the rig's `.glb`, and as the rig file itself with no `--poses` (3.4e-6 m).

## Evidence

- The sheet rendered with Workbench (default) and with `--engine cycles`; green markers sat under planted points and red under the sunken foot's windows. Looked at for the clean, sunken and slide clips.
- Video: Blender's own encoder wrote `clip.mp4` for every clip above; `--ffmpeg <path>` wrote it through ffmpeg from rendered frames instead. The path where neither exists, which reports why there is no video, was not run.
- A full check of a 30-frame clip, with sheet and video at 240×300, took about one second.

## Tests

- `python3 -m pytest scripts/test_jamanim.py`: 18 tests of the spec, maps, the glTF reader (on a glTF written by the test), the measures on synthetic trajectories, and travel.
- `python3 -m pytest scripts/test_animate_blender.py`: 16 tests that build the clips above in Blender and assert the numbers within the stated tolerances: clean pass, slide (2 and 5 cm), penetration (mesh and joints), pops at each end, seams (1 and 3 cm), duplicate-end loop, in-place and root-bone conventions, a clip on another skeleton failing the skeleton check, ground that is not flat leaving penetration unmeasured, detection numbers from the command line, key poses, and video through ffmpeg. About 30 seconds.

## Not validated

- **Real characters and real motion.** Every clip was generated. A real rig's leaf-bone ends, finger chains, twist bones and dense meshes, and real motion's heel strikes, were not run.
- **Any provider, library or capture output**, and any clip that went through retargeting. The route steps that hand work to other skills or providers were written, not run.
- **Any engine import** of a clip.
- **Turning clips.** The root convention moves translation only; travel along a curve and heading on the root bone were not run.
- **Ground that is not flat** beyond confirming that penetration is reported unmeasured and contacts are found by speed alone.
- **Hand contacts** (`contacts.planted` naming a hand): code path only.
- **A pose library made in Blender's own pose-library tools**: the `.blend` sources above held plain actions.
- **The headless renderers elsewhere.** Workbench and Cycles ran on this Mac only; whether Workbench renders headless on a machine without a display was not run.
- **Other Blender versions and operating systems.**
