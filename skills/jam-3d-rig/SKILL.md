---
name: jam-3d-rig
description: Rig a humanoid character mesh so it deforms. Binds the mesh to a skeleton placed on landmark joints, limits bone influences, and writes a skinned glTF file with pose stills as deformation evidence; engine-neutral, with bone names and hierarchy taken from a skeleton profile when one is chosen. Use when the user asks to rig, skin or make animatable a character mesh (generated, bought or hand-made), to re-rig after its mesh changed, to check an existing rig's deformation, or when a recipe run reaches its rig step.
---

# Rigging

Three words carry this skill. **Landmarks** are the character's joint positions in a fixed vocabulary (`hips`, `upper-arm.l`, `index-2.r`); every joint source writes them to one file. A **profile** names a target skeleton as data: which bone stands at each landmark, and its hierarchy. To **bind** is to build the skeleton on the landmarks and weight the mesh to it. No step names an engine: the result is a skinned glTF file, and anything shaped by one engine happens after it, in that engine's adapter.

`<S>` is this skill's `scripts/` folder and `<A>` its `assets/`. Commands are written for a project with the jam toolkit, where `jam` is `node tools/jam/jam.mjs` and paths are project-relative (when the toolkit is missing and wanted, use the `jam-setup` skill). Without the toolkit the same scripts run as `blender --background --python-exit-code 1 --python <script> -- <arguments>` and `python3 <script> <arguments>`; each script's header lists its arguments. They were written and run with Blender 5.1; `landmarks_from_rig.py` needs only Python with numpy.

## Rig a mesh

1. **Settle the inputs.** In a recipe run, `jam run next <id>` names the step's files and `jam config show` the budget.
   - The mesh: one humanoid in its final topology, UVs and textures, as `.glb`, `.gltf` or `.blend`. It stands upright in a bind pose with the arms away from the body, faces front, and carries one UV set. Clothes and hair may be separate objects in the file.
   - The skeleton: the landmark skeleton, or a profile when something downstream reads bone names or needs a set bone count. The budget's `skeleton` names it; [references/profiles.md](references/profiles.md) says where profiles live, how to write one, and has a worked example.
   - The influence limit: the budget's `maxInfluences`, else 4.
   - Fingers: whether each finger must move. That needs finger landmarks and a mesh whose fingers are separate; otherwise each hand follows its hand bone.

   Done when the mesh path, the skeleton choice (profile file and id, or "landmark skeleton"), the influence limit and the finger choice are written down.

2. **Get the landmarks.** Read [references/landmarks.md](references/landmarks.md) for the vocabulary, the four sources (an auto-rig service's skeleton through a bone-name table, the rig already on the mesh, a DCC estimate, a person) and the checks. The usual case:

   `jam python <S>/landmarks_from_rig.py -- <rigged.glb> <landmarks.json> --map <A>/landmark-maps/<table>.json`

   Done when the command exits 0, its `missing` is empty, and you can explain every entry in `findings`. Keep its `heightMeters`: when the mesh you bind is another file than the rigged one, that number is `--height-meters` in the next step.

3. **Bind.**

   `jam blender <S>/bind.py -- <mesh> <landmarks.json> <out-dir> [--profile <file> [--profile-id <id>]] [--max-influences <n>] [--fingers auto|none] [--height-meters <h>]`

   It writes `rigged.glb` (metres, +Y up, front +Z), `rigged.blend` and `rig-report.json`. The run ends with an error when the landmarks do not fit the mesh or the **deformation check** fails: every limb and the head must be weighted mainly to their own bones (mean share at least 0.5, at most 25% of a region's vertices mostly on other bones).

   Done when the command exits 0, `rig-report.json` has `"passed": true`, and you have read every entry in its `warnings`. On a failure or a warning you cannot explain, read [references/troubleshooting.md](references/troubleshooting.md); fix the mesh or the landmarks before touching a threshold.

4. **Look at it move.**

   `jam blender <S>/pose_evidence.py -- <out-dir>/rigged.glb <out-dir>/poses`

   It poses the delivered file through arms raised, arms forward, elbows bent, a deep knee bend, a torso twist and a head turn (and curled fingers when the rig has them), and writes one still per pose, `pose-sheet.png` with all of them, and `pose-manifest.json`. Open the sheet and judge each pose:

   | Pose | Sound when |
   | --- | --- |
   | arms raised, arms forward | the arms keep their thickness at the shoulder and the chest and waist stay in place |
   | elbows bent, knee bend | each limb bends at its joint, keeps its volume, and the feet stand where they stood |
   | torso twist | the twist spreads along the trunk, hips and legs still |
   | head turn | the whole head and face turn together, the shoulders and collar stay |
   | fingers curled | each finger closes on its own into a fist |

   Add `--views all` for a pose you cannot judge from its one still. Done when you have looked at every pose in the sheet and can state for each that it is sound, or which fault it shows; a fault sends you back to step 2 or 3 through the troubleshooting page.

5. **Record.** In a recipe run:

   `jam run record <id> rig --file model=<out-dir>/rigged.glb --file deformation=<out-dir>/poses/pose-sheet.png --file landmarks=<landmarks.json> --file deformation=<out-dir>/rig-report.json --evidence poses=<out-dir>/poses/pose-manifest.json --tool "Blender <version>, jam-3d-rig bind.py" --note "<skeleton, influence limit, finger choice, any raised threshold and why>" --accept "<what you saw in the poses>"`

   The step's check reads `rig-report.json`: it must have passed, be about this `rigged.glb`, and stay within the budget's influence limit. A run that starts at this step adds `--source` and `--source-evidence`. Done when the command reports the step recorded. Outside a run, done when the person has the three files, the sheet and your pose-by-pose finding.

6. **Engine skeleton, only when asked for.** When `jam engine show` lists `conform-skeleton` and the project wants that engine's own animations to play without retargeting, hand over to `jam engine conform-skeleton --run <id>` (the `jam-engine` skill); it takes the model and the landmark file recorded in step 5.

## Check a rig made elsewhere

Step 4 works on any rigged humanoid: `jam blender <S>/pose_evidence.py -- <rigged.glb> <out-dir> --map <bone-name table or profile> [--profile-id <id>]`, with the table that maps its bone names to landmarks (step 2). Done as in step 4. The weight numbers of the deformation check exist only for a bind; to get them, rebind the mesh from its own rig (step 2, "the rig already on the mesh").

## What is validated

[references/validation.md](references/validation.md) lists every run with its numbers. In short: binding and posing were run and looked at on two generated game characters, each with the landmark skeleton and with the shipped profile, on a third with an apron and joined fingers, and on a generated test figure with fingers; every output loads as a skinned mesh in a second glTF library. The bound test humanoid was imported into one engine and played one retargeted clip; not validated: real characters or the shipped profiles in an engine, finger weights on a real character with separate fingers, garments across both legs (the check fails on them by design), coarse meshes with edges longer than the blend band, and non-humanoid bodies. The pure helpers have unit tests (`python3 -m pytest <S>/test_jamrig.py`); `<S>/test_bind_blender.py` runs the scripts in Blender on the test figure and is skipped without it.
