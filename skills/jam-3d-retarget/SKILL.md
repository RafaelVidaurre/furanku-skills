---
name: jam-3d-retarget
description: Retarget animation from one humanoid skeleton onto another, each described by a landmark map. Converts BVH and FBX motion to glTF, aligns the two rest poses (A-pose, T-pose or anything between) before transferring rotations chain by chain, scales hips travel by leg length, holds planted feet with IK, keeps bones the maps leave out at rest, and fails a run whose limbs do not follow the source; writes the target rig as a glTF file carrying the animations, a report and a rendered sheet. Use when the user asks to retarget an animation onto a rigged character, or when a recipe run reaches its retarget step.
---

# Retargeting

Four words carry this skill. A **landmark map** says which bone of a skeleton stands at which landmark, a joint of the humanoid vocabulary the `jam-3d-rig` skill defines (`hips`, `upper-arm.l`, `index-2.r`); every skeleton involved is described by one. **Rest alignment** compares the two skeletons' rest poses limb by limb, so a clip made on an A-pose skeleton plays on a T-pose one with the arms where the source had them. **Agreement** is how far each target limb segment points from the source's: a correct transfer matches arms and legs exactly, so agreement is this skill's test that the maps fit. The **round trip** retargets the result back onto the source: the transfer is invertible by construction, so it shows only motion the maps leave out.

It reads any glTF skeleton with animations (BVH and FBX are converted first) and writes the target `.glb` with the retargeted animations. Both skeletons must stand upright facing `+Z` in glTF's frame (metres, `+Y` up, `+X` is the character's left); the run checks that. A clip meant for delivery must also meet the clip format of the `jam-3d-animate` skill: retarget one animation per output file (`--animation`) at the spec's frame rate.

`<S>` is this skill's `scripts/` folder. Commands are written for a project with the jam toolkit, where `jam` is `node tools/jam/jam.mjs` and paths are project-relative (when the toolkit is missing and wanted, use the `jam-setup` skill). Without the toolkit the same scripts run as `python3 <script> <arguments>` and `blender --background --python-exit-code 1 --python <script> -- <arguments>`; each script's header lists its arguments.

**Requirements.** `retarget.py` needs Python 3 with numpy (`python3 -c "import numpy"` exits 0). Blender is needed only to convert BVH or FBX and to render evidence (`blender --version` prints a version; `jam doctor` reports it in a jam project); the scripts were written and run with Blender 5.1. When Blender is missing, a glTF source still retargets; ask the person before installing it.

## Retarget a clip

1. **Settle the inputs.** In a recipe run, the source is the clip the `motion` step recorded and the target and its map are the clip spec's `rig.model` and `rig.map`; `jam run where <id>` prints the path of the run record that lists them.
   - The source: a `.glb` or `.gltf` holding a skeleton and one or more animations, or a BVH or FBX file (step 2). Convert any other format to glTF in the tool that made it.
   - The target: the rigged `.glb` the animation goes onto. Its existing animations are dropped unless you pass `--keep-target-animations`.
   - Two landmark maps, one per skeleton, passed as file paths. Read [references/maps.md](references/maps.md) for the format, where maps come from and how to write one.
   - The frame rate: the source's own (its keys must be evenly spaced), or the clip spec's `fps` when it differs.
   - Contacts, chosen with the person: `auto` holds each planted ankle and toe still on the target, where planted means the source joint moves slower than `--contact-speed`, in source heights per second. Take the speed from the person, or from the clip spec's `contacts.detect.speed` (metres per second on the spec's rig): run step 3 without `--contact-speed` and the refusal prints the number to divide by for this pair. A contacts file names windows instead (needed for planted hands); `none` turns the correction off. The format and rules are in [references/method.md](references/method.md#contacts).

   Done when the four paths, the frame rate and the contacts choice (with its speed for `auto`) are written down.

2. **Convert a BVH or FBX source** (skip for glTF).

   `jam blender <S>/clip_to_glb.py -- <motion.bvh|motion.fbx> <source.glb> --up <axis> --facing <axis> --scale <metres per file unit> [--name <animation>] [--armature <name>]`

   The axes are the file's own: `--up` is the one the character stands along, `--facing` the one it looks along at rest. Blender's BVH exporter, for example, writes Z up with the character facing −Y: `--up Z --facing=-Y --scale 0.01` for a rig in centimetres. A BVH file states none of the three, so they come from the file's origin (its documentation, or the tool that wrote it). An FBX file states its up axis and unit; the command prints them under `declared` and refuses flags that contradict them. Done when the command exits 0, its printed `skeletonHeightMeters` is the character's real size, and step 3 does not refuse the facing.

3. **Retarget.**

   `jam python <S>/retarget.py <source> <source-map> <target.glb> <target-map> <out-dir> --contacts auto|none|<file> [--contact-speed <source heights per second>] [--animation <name>]... [--fps <n>]`

   It writes `<out-dir>/retargeted.glb` (the target file with the animations; scenes, meshes and skin unchanged) and `retarget-report.json`. Exit 2 means the inputs cannot be read as two humanoids (a map that does not fit, a skeleton lying down or facing `-Z`, a missing animation) or an option is missing, and nothing is written; the message says which. Exit 1 means a check failed and both files are written for diagnosis: the arms or legs do not follow the source (`agreement`), a hand or foot crossed the body (`sideFlips`), or the round trip did not return (the source moves bones the maps do not carry).

   Done when the command exits 0, the report has `"passed": true`, and you can explain every entry in its `warnings`. On anything else, read [references/troubleshooting.md](references/troubleshooting.md); fix a map or an input before raising a tolerance, and record any tolerance you raise with its reason.

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

   `jam run record <id> retarget --file clip=<out-dir>/retargeted.glb --evidence report=<out-dir>/retarget-report.json --evidence sheet=<out-dir>/evidence/<animation>-sheet.png --tool "jam-3d-retarget retarget.py, Python <version>, numpy <version>" --note "<source clip, maps, frame rate, contacts choice and speed, any tolerance raised and why>" --accept "<what you saw in the sheets>"`

   Done when the command reports the step recorded. Outside a run, done when the person has the retargeted file, the report, the sheets and your row-by-row finding.

## What carries over

[references/method.md](references/method.md) holds every rule: how the rests are aligned, which bones move and which keep their rest, how travel scales and where the root goes, how frames are sampled, how contacts are held, and what each check measures and why its tolerance is what it is. Read it when you choose options in step 1 and when you explain a result.

## What is validated

[references/validation.md](references/validation.md) lists every run with its numbers. In short: two generated test rigs that differ in rest posture (A-pose and T-pose), proportions, bone axes, units, hierarchy and root, in both directions, with a walk and an arm clip: arm segments follow the source within 0.001° where naive transfers are off by over 40° and cross the body, the round trip returns within 1e-14 of the height, planted feet hold still where the plain transfer slides them up to 8.5 mm, and Blender plays the written file within 11 micrometres of the computed one. A map placing the target's forearm on its upper-arm twist bone fails (arms 84.8° off, the hand across the body on 13 frames) although its round trip is exact. Sources written by Blender's glTF, BVH and FBX exporters, and a generated clip on a motion provider's skeleton, were retargeted too; every written file passed the Khronos glTF validator without errors. Not validated: a real character, real mocap, FBX from other tools, planted hands on real data. The pure helpers have unit tests (`python3 -m pytest <S>/test_jamretarget.py`); `<S>/test_retarget_blender.py` runs the Blender scripts and is skipped without Blender.
