---
name: jam-3d-retarget
description: Retarget animation from one humanoid skeleton onto another, each described by a landmark map. Aligns the two rest poses (A-pose, T-pose or anything between) before transferring rotations chain by chain, scales hips travel by leg length, holds planted feet with IK, keeps bones the maps leave out at rest, and proves the transfer with a round trip back onto the source; writes the target rig as a glTF file carrying the animations, a report and a rendered sheet. Use when the user asks to retarget, transfer or copy an animation or mocap clip (glTF or BVH) onto a rigged character, to bring a library, mocap or generated clip onto the project rig, or when a recipe run reaches its retarget step.
---

# Retargeting

Three words carry this skill. A **landmark map** says which bone of a skeleton stands at which joint of a fixed vocabulary (`hips`, `upper-arm.l`, `index-2.r`); every skeleton involved is described by one. **Rest alignment** compares the two skeletons' rest poses limb by limb, so a clip made on an A-pose skeleton plays on a T-pose one with the arms where the source had them. The **round trip** retargets the result back onto the source and measures how far it lands from the original: it is this skill's proof that nothing but the target's proportions changed. Nothing here knows where a clip came from or where it goes next; every file is glTF's frame (metres, `+Y` up, the character faces `+Z`, `+X` is its left).

`<S>` is this skill's `scripts/` folder. Commands are written for a project with the jam toolkit, where `jam` is `node tools/jam/jam.mjs` and paths are project-relative (when the toolkit is missing and wanted, use the `jam-setup` skill). Without the toolkit the same scripts run as `python3 <script> <arguments>` and `blender --background --python-exit-code 1 --python <script> -- <arguments>`; each script's header lists its arguments.

**Requirements.** `retarget.py` needs Python 3 with numpy (`python3 -c "import numpy"` exits 0). Blender is needed only to convert BVH and to render evidence (`blender --version` prints a version; `jam doctor` reports it in a jam project); the scripts were written and run with Blender 5.1.

## Retarget a clip

1. **Settle the inputs.** In a recipe run, `jam run next <id>` names the step's files.
   - The source: a `.glb` or `.gltf` holding a skeleton and one or more animations. A BVH file is converted in step 2; convert any other format to glTF in the tool that made it.
   - The target: the rigged `.glb` the animation goes onto. Its existing animations are replaced unless you pass `--keep-target-animations`.
   - Two landmark maps, one per skeleton, passed as file paths. Read [references/maps.md](references/maps.md) for the format, the vocabulary, where maps come from (a rigging skill's shipped maps, a provider descriptor's `rig.landmarks`, a skeleton profile) and how to write one.
   - Both skeletons rest standing upright, facing `+Z`. Their rest postures and proportions may differ.
   - The frame rate: the source's own (its keys must be evenly spaced), or the clip spec's `fps` when it differs.
   - Contacts: `auto` holds each planted ankle and toe still on the target; a contacts file names windows instead (needed for planted hands); `none` turns the correction off. The format is in [references/method.md](references/method.md#contacts).

   Done when the four paths, the frame rate and the contacts choice are written down.

2. **Convert a BVH source** (skip for glTF).

   `jam blender <S>/bvh_to_glb.py -- <motion.bvh> <source.glb> [--scale <to metres>] [--up Y] [--forward=-Z] [--name <animation>]`

   BVH states neither units nor axes, so `--scale`, `--up` and `--forward` come from the file's origin (its documentation, or the tool that wrote it). Done when the command exits 0 and its printed `skeletonHeightMeters` is the source character's real size.

3. **Retarget.**

   `jam python <S>/retarget.py -- <source> <source-map> <target.glb> <target-map> <out-dir> [--animation <name>]... [--fps <n>] [--contacts auto|none|<file>]`

   It writes `<out-dir>/retargeted.glb` (the target file with the animations; nodes, meshes and skin copied unchanged) and `retarget-report.json`. Exit 2 means the inputs cannot be read as two humanoids (a map that does not fit, a skeleton lying down or facing `-Z`, a missing animation) and nothing is written; the message says which. Exit 1 means the round trip failed: the source moves bones the maps do not carry.

   Done when the command exits 0, the report has `"passed": true`, and you can explain every entry in its `warnings` and every non-zero `sideFlips`. On anything else, read [references/troubleshooting.md](references/troubleshooting.md); fix a map or an input before raising a tolerance.

4. **Look at it.**

   `jam blender <S>/retarget_evidence.py -- <out-dir>/retarget-report.json <out-dir>/evidence`

   It renders `<animation>-sheet.png` per animation (columns are frames; rows are source front, target front, source side, target side) and checks that Blender plays the written file as computed. Open each sheet and judge:

   | Look at | Sound when |
   | --- | --- |
   | arms | each target arm points where the source's does and stays on its own side of the body; nothing passes through the torso |
   | legs and feet | the feet stand on the ground plane in the same frames as the source's, knees bend forward |
   | trunk and head | the lean and turn match the source's |
   | hands | fingers the source lacks hold the target's rest pose; fingers both have move with the source's |

   Done when `evidence-manifest.json` has `"playbackCheckPassed": true` and you can state for every row of every sheet that it is sound, or which fault it shows (a fault sends you to [references/troubleshooting.md](references/troubleshooting.md)). Without Blender this step cannot run: the report is then the only evidence, and the record says the sheets were not rendered.

5. **Record.** In a recipe run:

   `jam run record <id> retarget --file clip=<out-dir>/retargeted.glb --evidence report=<out-dir>/retarget-report.json --evidence sheet=<out-dir>/evidence/<animation>-sheet.png --tool "jam-3d-retarget retarget.py, Python <version>" --note "<source clip, maps, frame rate, contacts choice>" --accept "<what you saw in the sheets>"`

   Use the roles `jam run next <id>` names when they differ from these. Done when the command reports the step recorded. Outside a run, done when the person has the retargeted file, the report, the sheets and your row-by-row finding.

## What carries over

[references/method.md](references/method.md) holds every rule: how the rests are aligned, which bones move and which keep their rest, how travel scales and where the root goes, how frames are sampled and how contacts are held. Read it when you choose options in step 1 and when you explain a result.

## What is validated

[references/validation.md](references/validation.md) lists every run with its numbers. In short: two generated test rigs that differ in rest posture (A-pose and T-pose), proportions, bone axes, units, hierarchy and root, in both directions, with a walk and an arm clip: arm segments follow the source within 0.001° where naive transfers are off by over 40° and cross the body, the round trip returns within 1e-14 of the height, planted feet hold still where the plain transfer slides them up to 8.5 mm, and Blender plays the written file within 11 micrometres of the computed one. A source written by Blender's glTF exporter and a BVH source were retargeted too. Not validated: a real character, real mocap or generated motion, an engine import, planted hands on real data. The pure helpers have unit tests (`python3 -m pytest <S>/test_jamretarget.py`); `<S>/test_retarget_blender.py` runs the Blender scripts and is skipped without Blender.
