# What was validated

Facts about the scripts in this skill as shipped, from runs on 2026-11-20 with Python 3.13 and numpy 2.4 and Blender 5.1.2, all on one macOS machine. "Looked at" means the sheets were opened and judged row by row, not that a number passed. A run on this machine is evidence of that run, not a requirement.

The method follows the retargeting practice in the repository's research note (`docs/research/motionbricks-best-practices-2026-11-20.md`, part B2), which cites Epic's IK Rig retargeting documentation (<https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-rig-animation-retargeting-in-unreal-engine>, UE 5.9, and the Retargeting Operation Stack page, UE 5.8): align rest poses first, map chains rather than bones, designate the pelvis so translation scales between proportions, keep contacts with IK goals.

## The two test rigs

`scripts/make_test_rigs.py` writes two humanoids that differ in every way the method has to absorb:

| | rig A | rig B |
| --- | --- | --- |
| Rest posture | A-pose, arms 45° below level | T-pose |
| Size | 1.40 m head landmark above ankles, legs 0.78 m | 1.57 m, legs 0.87 m (`k` = 1.115 from A to B) |
| Proportions | thigh 0.39, shin 0.39, arm 0.27 + 0.25 | thigh 0.46, shin 0.41, arm 0.28 + 0.26 (relatively shorter) |
| Bone axes | along the bone (non-identity rest rotations) | the world's (identity rest rotations) |
| Units and parents | joints in centimetres under an armature node scaled 0.01 | metres, no armature node |
| Root | none; the hips are the top joint | `Root`, a ground-level joint above the pelvis, carrying the walk's travel |
| Spine | two bones | three; the middle one at no landmark |
| Extra bones | forearm twist bones | upper-arm twist bones, five three-joint fingers per hand |
| Keys | 30 fps | 24 fps |

Both carry the same two clips, authored once as world directions and posed on each rig: **walk** (two strides, each ankle exactly still while planted, by IK on that rig's own legs; arms swinging at the sides) and **arms** (arms at the sides, level, overhead, forward with forearms up, crossed in front of the chest, at the sides). Every frame's authored arm directions are written to `motions.json`, so a retarget can be checked against what the clip asked for, not only against itself.

## Retargeting between them

`retarget.py` with default options, both directions. Arm and leg agreement is the largest angle between a source segment and the same target segment over all frames, before contact correction. "Authored" compares the target's arm segments with the directions the clip was authored with.

| Run | Clip | Frames | Round trip (heights / degrees) | Arms agreement | Arms vs authored | Side flips | File check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A to B | walk | 61 at 30 fps | 1.2e-15 / 1.2e-6 | 0.000° | 5e-5° | 0 | 1.9e-7 m |
| A to B | arms | 76 at 30 fps | 6.9e-16 / 1.7e-6 | 0.000° | 5e-5° | 0 | 2.5e-7 m |
| B to A | walk | 49 at 24 fps | 1.1e-15 / 0 | 0.000° | 4e-5° | 0 | 1.8e-7 m |
| B to A | arms | 61 at 24 fps | 7.5e-16 / 0 | 0.000° | 4e-5° | 0 | 1.9e-7 m |

`restAlignment` turned the upper and lower arms 45.0° in both directions and hands inherited it; legs turned 0.2°; feet keep their own rest (1.8° apart). The trunk is not turned; its rest difference (spine 1.5°, chest 3.6°, neck 2.7°) shows as the trunk's 3.6° agreement in every run, as designed. Hips travel on the target was `k` times the source's: walk 1.406 m to 1.568 m (A to B), 1.568 m to 1.406 m (B to A); the arms clip stayed in place. B to A folded B's root travel into A's hips.

### The classic failure, for comparison

Two wrong transfers were run on the same clips (in `test_jamretarget.py`): copying each bone's local rotation change, and applying world rotation changes to the target's own rest without aligning the rests.

| Run | Clip | This skill | Local rotation copy | World change, rests not aligned |
| --- | --- | --- | --- | --- |
| A to B | arms | 0.000°, 0 flips | 143°, hands on the wrong side on 18 frames each | 45°, 18 frames each |
| A to B | walk | 0.000°, 0 flips | 68°, 0 | 45°, 0 |
| B to A | arms | 0.000°, 0 flips | 142°, 18 frames each | 45°, 9 frames each |
| B to A | walk | 0.000°, 0 flips | 52°, 43 frames each | 45°, 49 of 49 frames each |

The last cell is the failure this skill exists to prevent: a T-pose clip whose arms hang at the sides, played on an A-pose rig without aligning rests, puts both hands through the body on every frame.

### Contacts

Detected automatically (0.1 source heights per second, 3 frames). Source ankles are exactly still while planted.

| Run | Clip | Ankle windows | Target slide without correction | With correction | Largest correction | Toe miss |
| --- | --- | --- | --- | --- | --- | --- |
| A to B | walk | 5 | 1.8 to 8.5 mm | 0 | 18.3 mm | 0 |
| B to A | walk | 4 | 6.5 to 7.8 mm | 0 | 16.4 mm | 0 |
| A to B | arms (standing) | 2 | 0 | 0 | 0.3 mm | 0 |

The slide without correction comes from the rigs' different thigh-to-shin ratios and hip widths. Toes were held still too (slide and miss 0). While feet were turned onto the source's rest pitch, the toes missed by 4.8 to 5.3 mm; keeping each foot's own rest removed that. With the correction the legs differ from the source's directions by up to 5.8° (A to B) and 7.5° (B to A) on the walk; arms and trunk are untouched by it (checked to 1e-9).

### Looked at

`retarget_evidence.py` on both runs, six frames per clip. Blender's own glTF import played every written file within 7.5e-7 m (A to B) and 1.1e-5 m (B to A, the target under the 0.01-scaled armature) of the computed joints. In every sheet:

- **Arms clip:** the target's arms hang at its sides at the start and end, go level, overhead, forward with forearms up and cross in front of the chest like the source's; no arm passes through the torso in either direction.
- **Walk:** arms hang at the sides and swing; knees bend forward; both feet stand on the ground plane in every frame shown, from the front and from the side.
- Rig B's fingers, absent on rig A, stay in their rest pose (A to B).

## Sources other tools write

- **Blender's glTF exporter** (rig A imported into Blender and exported again): retargeted onto rig B, both clips passed; round trip 5.7e-6 and 1.2e-5 heights, 0.007° and 0.013°. The residual comes from the file: Blender wrote a thigh scale of 1.0000234 on one axis, a shear the transfer cannot express in a rotation. Arms agreement 0.000°, no side flips, planted feet held to 0.
- **BVH** (the arms clip written by Blender's BVH exporter, in Blender's own frame: Z up, facing −Y, centimetres): `bvh_to_glb.py` with the wrong forward axis gave a file the retarget refused (exit 2, "left joints are not on +X"); with `--up Z --forward Y --scale 0.01` it gave a 1.46 m skeleton, 76 frames at 30 fps from time 0, which retargeted onto rig B with arms agreement 0.001°, round trip 3.0e-6 heights and 0.001°, no side flips.

## Generated motion, end to end

On 2026-11-20 the `animation` recipe ran in a scratch project on the macOS machine, with generation on a Windows 11 laptop with an 8 GB NVIDIA laptop GPU (see `jam-3d-motionbricks`). The project rig was `jam-3d-rig`'s test humanoid bound by its `bind.py` (51 bones named by landmark, A-pose, fingers), with that skill's landmark-names map; SOMA's side used `jam-3d-motionbricks`' map.

- **Onto SOMA** (a 4-frame context and 2 key poses on the project rig): round trips 1.1e-7 and 2.0e-7 heights, playback within 4.6e-7 m. The first version turned SOMA's feet onto the project rig's foot pitch, which stood SOMA's toes 3.0 cm below its own standing height; the generated step then dipped a toe 3.5 cm under the ground. Feet now keep their own rest, and the packed poses stood within 0.3 mm of SOMA's standing pose.
- **Back onto the project rig** (34 generated frames, `k` 0.873, travel 0.917 m on SOMA to 0.800 m): round trip 0.0019 heights (2.9 mm at the head), within the default tolerance. The warning named SOMA's `Spine2`, `Neck2`, `Jaw` and eyes as not carried; the trunk's agreement was 17.1° at the neck, from `Spine2` and `Neck2`'s bend. An earlier generation's round trip was 0.00204 heights, over the default; the tolerance was raised to 0.003 as troubleshooting.md says, and recorded.
- **Contacts:** the source's planted feet drift (8.9 cm over 0.5 s, about 0.2 m/s), faster than the default detection, which then found two toe windows only. With `--contact-speed 0.2` it found six windows and held the ankles to 0.8 to 10.6 mm of slide (toes up to 33.5 mm, where the goal lay 21.5 mm beyond the leg's reach); the clip check's slide fell from 50.8 to 29.7 mm. No side flips; Blender played the file within 8.5e-7 m; the sheet was looked at row by row.

## Tests

- `python3 -m pytest scripts/test_jamretarget.py` (29 tests, Blender-free, under a second): rotations; glTF sampling in LINEAR, STEP and CUBICSPLINE; frame-rate reading; the writer keeping nodes, skins, meshes and binary data unchanged; the three map shapes; refusals (sides swapped, a missing required landmark, two bones for one landmark, a rig facing backward, lying down or leaning); the `posed` warning; rest alignment and its inverse; feet keeping their own rest pitch; the hand frame (a target whose palms rest turned 90° gets fingers within 1e-6° of the source's); both directions against the authored directions and the two naive transfers above; the exact round trip; root to root (rig B onto a copy 1.2 times its size: travel on root and hips, scaled 1.2, round trip 1e-15); root folded into hips; contact detection, blend weights, held feet, an unreachable hand reported as a miss; and `retarget.py` end to end (resampling 24 to 60 fps, contacts off, a contacts file holding a hand, a landmark only the target maps, motion on an unmapped spine bone failing the round trip and named in a warning, inputs refused with exit 2 and nothing written).
- `python3 -m pytest scripts/test_retarget_blender.py` (3 tests, about 4 seconds, skipped without Blender): the evidence script and its playback check, a Blender-exported source, and the BVH conversion including the refused facing.

## Not validated

- **A real character or real mocap.** Apart from the generated clip below, every clip was authored on the generated rigs. Noisy capture contacts and long clips (the longest here has 151 frames) are untried.
- **Engines other than the one import below.**
- **Planted hands on real data.** The hand path ran only in unit tests, on the test rigs.
- **Rest poses other than A and T,** such as arms forward or bent elbows at rest, and rests whose palms differ without knuckle landmarks (the hand then keeps its rest angle to the forearm, by design).
- **Large proportion differences.** Only `k` of 0.90, 1.12 and 1.2 ran.
- **Other BVH writers.** Only Blender's own BVH exporter; files from capture systems and libraries may need other axes and scales.
- **Sparse or unevenly keyed sources** beyond the unit tests, and sources with several skins.
- **`--keep-target-animations`** (code path only).
- **Other Blender versions and operating systems.**
