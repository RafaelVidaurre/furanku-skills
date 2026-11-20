# Rigged character recipe

Notes for each step of the `character` recipe. `jam run next` points here; `jam recipe show character` lists the steps.

Each step's skill says how the work is done; these notes say only what a character that deforms adds.

## concept

Settle these in the brief before any image is made; changing one later redoes every step after it.

| Decision | Settle | Why |
| --- | --- | --- |
| Skeleton | The skeleton profile the rig will use (`jam engine facts skeletons`), or none (`jam-3d-rig` then builds the landmark skeleton) | It fixes the bind pose and which joints must exist |
| Bind pose | The pose the character is drawn, modelled and bound in: the profile's rest pose, else arms about 45 degrees down from level and legs slightly apart | A mesh modelled in another pose stretches when it is bound |
| Proportions | Limb lengths as shares of body height: shoulder to wrist, hip to ankle, hand, foot | Animations and gameplay values made for a skeleton assume its proportions; a character 20% shorter in the arm misses what it reaches for |
| Hands | Separate fingers that move, or mittens that follow the hand | Fingers constrain every image, need finger joints and more triangles; mittens need none of it |
| Budget | A `deforming` budget with its poses (`jam config show budgets.<name>`) | The poses are what the deformation evidence must show |

Draw the concept **in the bind pose**: arms away from the body, legs apart, fingers relaxed and apart when they are to move, smooth unfaceted surfaces, nothing held, no cloth bridging a limb to the body.

## turnaround

- Every view holds the bind pose.
- With separate fingers: each finger visible in the front and back views, hands edge-on in the side views, and each view generated on its own at full size (hands cut from one sheet are too small to read and come back as mittens).
- Measure the proportions from the brief on the front view and keep the numbers as evidence. Done when they meet the brief.

## mesh

A mesh can be rigged when its limbs are separate from the body and from each other, its fingers (when they are to move) are apart by a centimetre or more, and it stands in the bind pose. Look at both hands before accepting: generated hands often have fingers joined by shared faces on one side. Ask for the densest mesh the route gives: it is what the textures are baked from.

## topology

A deforming budget needs quads in loops around each joint, which reducing a dense mesh does not give: use `jam-3d-retopo`'s provider remesh route (its routes reference, "Meshes that deform"), asking for half the triangle target in faces. The evidence adds a close-up of each joint and of a hand to the fixed views.

## uv

Get the landmark file now (`jam-3d-rig` says where joint positions come from); the rig step reuses it. `jam-3d-uv`'s `seam_hints_from_landmarks.py` turns it into garment-style seams for the seams route. Give the head and hands their share of the texture: check their checker squares in close-ups, not only the whole figure.

## texture

Bake from the generated mesh onto the new layout (`jam-3d-texture`). Judge it unlit, in close-ups of the face, each hand and every border between materials, and beside the turnaround's front, back and side views.

## rig

`jam-3d-rig`. The step has two outputs: the skinned model, and deformation evidence showing each pose the budget names.

```
jam run record <id> rig --file model=<skinned.glb> --file deformation=<pose sheet> ...
```

For each extreme pose, `jam-3d-retopo`'s `edge_stretch.py` on the mesh at rest and posed adds a number to the stills: no face edge stretched beyond twice its rest length. A joint that fails goes back to topology for more loops there, not to the weights.

## conform

Runs only when the engine adapter has a `conform-skeleton` command: it reworks the rig onto one of the engine's own skeletons so that engine's animations play without retargeting (`jam-engine`). Engines that retarget from any humanoid skeleton skip it.

## import

`jam engine import --kind skinned --run <id>` imports the rigged model and records the step; without an adapter command the step is skipped and the run ends at the delivered files. See it in the engine before the delivery review: one still of the head, the hands and each border (`jam engine capture`) catches a scrambled texture or an inverted normal that the model viewer does not show.

## delivery

The skinned GLB accepted at the rig step (or conformed), with the reports of the three surface steps, the pose sheet and one sheet of textured stills as evidence; a person accepts it. A character that cannot hold the budget's poses is not delivered as a static model.
