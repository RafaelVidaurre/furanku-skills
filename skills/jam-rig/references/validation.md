# What was validated

Facts about the scripts in this skill as shipped, from runs on 2026-11-16 with Blender 5.1.2 on macOS. "Looked at" means the pose stills were opened and judged one by one, not that a number passed.

## Two real characters, two skeletons each

Two generated, textured game characters of about 21,000 triangles, each bound twice: with the landmark skeleton, and with [`assets/profiles/vrm-humanoid.json`](../assets/profiles/vrm-humanoid.json), which has other bone names and three bones between hips and neck where the landmark skeleton has two. Landmarks came from the joints an auto-rig service placed on each character, through [`assets/landmark-maps/left-right-camelcase.json`](../assets/landmark-maps/left-right-camelcase.json). Neither has finger joints.

| Character | Skeleton | Bones | Weights from | Check | Lowest mean own weight | Highest stray share | Vertices with 1/2/3/4 influences |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A: one object, jacket, scarf, hat, beard; A-pose; 10,451 welded vertices | landmark | 21 | heat on the mesh | passed | 0.70 (right thigh) | 0.16 (left upper arm) | 3324 / 2006 / 847 / 4274 |
| A | profile | 22 | heat on the mesh | passed | 0.70 (right thigh) | 0.16 (left upper arm) | 3330 / 2021 / 606 / 4494 |
| B: three objects (body, head, hair); A-pose; delivered at another size than its landmarks, bound with `--height-meters`; 10,949 welded vertices, 92 seam points shared between objects | landmark | 21 | heat on a voxel proxy | passed | 0.86 (left upper arm) | 0.08 (left upper arm) | 5990 / 3058 / 1318 / 583 |
| B | profile | 22 | heat on a voxel proxy | passed | 0.86 (left upper arm) | 0.08 (left upper arm) | 5985 / 2991 / 1010 / 963 |

Limits: mean own weight at least 0.5, stray share at most 0.25, at most 4 influences.

What the stills showed, the same in all four runs (seven poses each at 480 by 640; `fingers-curled` skipped, no finger bones):

- **Arms raised, arms forward:** arms keep their thickness at the shoulder; chest, waist and jacket hem stay in place. The armpits stretch: 106 to 295 edges past double length, the most of any pose.
- **Elbows bent:** forearms bend at the elbow with their volume; no edge past double.
- **Knee bend:** thighs and shins bend at hip and knee, the feet stay flat where they stood (A also seen from the side), A's jacket hangs over the thighs without tearing.
- **Torso twist:** the twist spreads along the trunk; hips and legs stay.
- **Head turn:** head, hair, hat, beard and face turn as one; shoulders, collar and scarf stay. No crack between B's head and body objects.

One difference between the two skeletons: with the profile's extra spine bone the largest edge stretch on A is higher (6.9 times against 4.4) with about the same count of stretched edges. Nothing in the stills shows it.

## A third character, with an apron and joined fingers

A generated character of 19,309 triangles with a wide trunk, an apron to the shins and a relaxed, half-closed hand whose fingers share faces. Its landmarks, including all ten fingers, were read from the rig it already carried, with that rig's skeleton profile as the table.

- At the default limits the check fails, as it should for a garment across both legs: right thigh 0.54 mean own weight with 26% stray (left: 0.57, 23%).
- With `--max-stray-share 0.35` it passed with the landmark skeleton (51 bones), the profile (52) and `--fingers none` (21). Stills (360 by 480) for the first two: body poses sound; in the knee bend the apron bends with both thighs (363 to 402 edges past double); in the head turn the face and moustache turn together, with a crease under the jaw where the short neck folds.
- The report warned that the mesh joins neighbouring fingers (24 and 16 edges), and the curled hand crumples in the still. Joined fingers cannot be rigged apart; `--fingers none` is the answer for such a mesh.

## Outside Blender

- All `rigged.glb` files above (two characters with two skeletons, the third character with three, the test figure) were loaded with a second glTF library (glTF-Transform): one skin each with the expected joint count, rooted at the hips bone, inverse bind matrices matching, every primitive with `JOINTS_0` and `WEIGHTS_0`, no vertex without a joint, at most 4 influences, weights summing to 1, materials and textures present.
- One run's outputs were recorded as the `rig` step of the toolkit's `character` recipe in a scratch project and accepted: `model`, `deformation` (the pose sheet) and `landmarks` as files, the report and manifest as evidence.
- The shipped profile and the landmark files of every run decode against the toolkit's own `SkeletonProfile` and `LandmarkFile` schemas with excess properties refused.
- `landmarks_from_rig.py` ran through `jam python` on a real rigged file from an auto-rig service: 21 landmarks, 3 bones reported unmapped, no findings.

## Checking a rig made elsewhere

`pose_evidence.py --map` posed the third character's original rig (88 bones on an engine skeleton, made by another tool) through that skeleton's profile: four poses rendered, and the stills showed that rig's own faults (its apron splits open in the knee bend; 1,199 edges past double). The path works; it was run on this one rig.

## Handing over to an engine adapter's conform command

One bind (character A, landmark skeleton) and its landmark file were given to an engine adapter's `conform-skeleton` command through `jam engine conform-skeleton`. The reference skeleton file was a skinned mesh already on that engine skeleton, not the engine's own export.

- With `rigged.blend`: the command ran to the end. Its own deformation check passed in every region (lowest mean own weight 0.73, highest stray share 0.16) and it wrote an 88-bone engine file. The toolkit then rejected the adapter's receipt for a missing `files` key, a mismatch between those two.
- With `rigged.glb`: the command stopped at its own deformation check (calves, hands, head, thighs: 27 to 45% stray). It read the glTF mesh as stored, one vertex per UV and normal, and its automatic weights do not cross those seams. `bind.py` welds them on load; that command does not.

Nothing was imported into the engine.

## The generated test figure

`scripts/make_test_humanoid.py` builds a capsule figure with four fanned fingers and a thumb per hand as one remeshed surface (45,700 vertices), with exact landmarks. `scripts/test_bind_blender.py` binds it and asserts:

- landmark skeleton with fingers (51 bones) and the profile (52 bones): check passed, no warnings, files load as skinned meshes with the expected joints and parents;
- `--fingers none --bone-axes world --weights proxy --max-influences 2`: check passed, at most 2 influences, every joint's rest rotation is identity;
- landmarks at another size than the mesh: refused with the report written and no model; accepted with `--height-meters`;
- `pose_evidence.py` writes its stills, sheet and manifest.

Its stills (landmark skeleton, eight poses at 360 by 480) were looked at: the body poses are smooth, with no step at the waist or shoulders, and the fingers close into a fist without crossing; a crease opens at the knuckles, where the figure's palm block meets its fingers.

The figure is far more regular than any character and proves less than the runs above.

## Faults found on the way, and their fixes

| Found on | Fault | Fix |
| --- | --- | --- |
| The third character | Its moustache and lower face stayed behind when the head turned: the wide trunk's region reached them by its thickness | Nothing above the head joint is trunk or neck |
| The test figure at 89,000 vertices | A step across the waist in the knee bend: weights blended across region borders over two edge rings, a few millimetres on a dense mesh | The blend band is a distance along the surface, 3% of the height, with borrowed weights fading across it |
| The third character | Curling the fingers tore the hand | Finger vertices are weighted by their position along their own finger, never by the solver, and a mesh that joins fingers past their second joints gets a warning |
| The third character, whose hand is half closed in its bind pose | Curling 70 degrees more folded the fingers through the palm | The pose closes each joint to 70 degrees from wherever it stands |
| The test figure's first hand | Its fingers converged and fused in the remesh | A fault of the figure; it showed the joined-fingers warning working |

## Not validated

- **Any engine.** No output was imported into a game engine or played with an animation. Bone axes, units and naming were checked only in the glTF files themselves.
- **Fingers on a real character with separate fingers.** Finger weights ran on the test figure and on one character with joined fingers.
- **Garments across both legs.** One aproned character, which fails the default limits by design; see [troubleshooting.md](troubleshooting.md).
- **Coarse meshes.** The blend band is 3% of the height along edges; on a mesh whose edges at a region border are longer than that, weights stop at the border. The real characters' edges are one to three centimetres (estimated from their size and triangle counts).
- **Code paths that ran only on the test figure, or not at all:** `--bone-axes world`, `--weights proxy` on one object and a lower influence limit (test figure only); `--weights direct` on several objects, the `distance` fallback, `.blend` and `.gltf` input, shape keys, more than 4 influences, `--derive` and `--strip-prefix` on a real rig (unit tests only).
- **Bind poses other than an A-pose**, non-humanoid bodies, long hair, capes, tails.
- **The VRM profile in a VRM tool.** The joints carry VRM's humanoid names; no VRM exporter or viewer was run.
- **Other Blender versions and operating systems.** Only Blender 5.1.2 on macOS.
