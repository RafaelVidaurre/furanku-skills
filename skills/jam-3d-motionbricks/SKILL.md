---
name: jam-3d-motionbricks
description: Generate humanoid motion with NVIDIA MotionBricks, a model that in-betweens on its SOMA skeleton from the last four poses to one to four target poses. Checks whether a machine meets MotionBricks' documented requirements and says what is missing, sets it up on a qualifying machine, packs SOMA poses from glTF files into a request, generates there, and unpacks the result into a glTF clip on SOMA with foot-contact confidences; includes NVIDIA's usage and licence rules and the SOMA landmark map. Use when the user asks to generate motion between poses with MotionBricks, to check whether a machine can run MotionBricks, or to set MotionBricks up, or when jam-3d-animate's provider route picks MotionBricks.
---

# MotionBricks

MotionBricks generates character motion one **generation** at a time: from a **context** (the last four poses, at 30 Hz) toward a **target** (one to four poses), it produces 0.6 to 1.9 s of motion; chaining generations makes longer motion. It works only on NVIDIA's **SOMA** skeleton. This skill never touches the project rig: poses come in on SOMA and the clip goes out on SOMA, and `jam-3d-retarget` converts in both directions, with [`assets/landmark-maps/soma.json`](assets/landmark-maps/soma.json) as the SOMA side's map (pass its path).

Two sides, which may be one machine or two:

- **Authoring side**, where Blender is: `soma_skeleton.py`, `make_test_poses.py`, `pack.py`, `unpack.py`, `clip_strip.py`.
- **Generating host**, a machine that meets MotionBricks' requirements: `host_check.py` and `generate.py`, run there. They need nothing else from this skill, no Blender and no jam toolkit.

Between them travel plain files: the two scripts and `request.json` to the host, `soma-skeleton.json` and `result.json` back. Move them however the person moves files.

`<S>` is this skill's `scripts/` folder, `<A>` its `assets/`. Blender scripts run as `blender --background --python-exit-code 1 --python <S>/<script> -- <arguments>` (`jam blender <S>/<script> -- ...` in a project with the jam toolkit); each script's header lists its arguments. On the host, `<python>` is any Python 3.8 or newer there, under whatever name it has (`python3`, `python` or `py -3`; once MotionBricks is installed, its own interpreter serves too), and `<mb-python>` is MotionBricks' own interpreter, as [references/setup.md](references/setup.md) defines it; host commands run in the folder the scripts were copied to. The scripts were written against MotionBricks v0.2.0 (model `MotionBricks-SOMA-RP-v1`); with a later release, read its README and SOMA model card for changes to these rules before the first run.

## NVIDIA's rules for using the model

These hold for every project. Sources: MotionBricks' README, runtime API, Inbetweener page, SOMA model card and source at v0.2.0, and the paper.

1. **The host decides.** MotionBricks' requirements (operating system, GPU, driver, install) are stated with their sources in [references/setup.md](references/setup.md), and `host_check.py` judges a machine against them. Detect them on the machine; never assume them.
2. **Poses are on the SOMA skeleton itself**: its joint names, root `Hips`, its joint frames, its reference (T-pose) rest, metres, +Y up. A project rig with renamed bones is not SOMA; retarget onto the SOMA rig.
3. **The context is the last four poses actually shown**, at 30 Hz, ending where the new motion starts. When chaining, each next context is the last four poses the previous generation played; `generate.py` does that.
4. **The target pose count sets the arrival.** One pose is a stop with no velocity. A second adds velocity, a third and fourth acceleration and momentum: four consecutive 30 Hz poses that begin at the target carry its motion through.
5. **Transition Early By** (0 to 20 frames) moves the transition point earlier without changing the target. Use 0 for exact poses, contacts and the hand-off into a clip; use more to make a target a guide that the motion leaves early toward the next target. To end on a clip, target its first four poses with 0, then play the clip.
6. **One generation is 18 to 58 frames** (6 to 16 tokens of four poses, less three boundary frames at each end); the default allows 8 to 14 tokens. Longer motion is several targets. Fit the length to the distance: more tokens for a longer way, fewer for a short one so the character does not add motion to fill time. A single count (`--target-tokens A-A`) fixes the length.
7. **Keep endpoint correction on.** It blends every joint so the motion starts exactly at the last context pose and ends at the first target pose.
8. **The ground is flat, at height zero.** SOMA model space has its ground on XZ at Y = 0, the model reads the hips' absolute height, and its training data has no terrain. Stand poses on Y = 0; handle stairs, slopes and other height changes outside the model.
9. **The model predicts 30 joints** (`modelJoints` in `soma-skeleton.json`), the jaw and eyes among them; no finger is. MotionBricks decodes every other joint, and any model joint whose parent is outside the 30 (such as a finger's end joint), at its reference pose (a flat T-pose hand); endpoint correction then blends it from its pose in the last context pose to its pose in the first target pose across each generation. Hands therefore carry no motion of their own; the landmark map leaves fingers, jaw and eyes unmapped so the receiving rig keeps its own. `Spine2` and `Neck2` are predicted but stand at no landmark, so a rig without those joints loses their bend: `jam-3d-retarget` names them as not carried, and its round trip shows the head's resulting offset.
10. **`Hips` carries travel and pelvis motion together**; SOMA has no ground-level root bone. A root bone or an in-place clip is made on the receiving side.
11. **Foot contacts are confidences** from 0 to 1 per heel (`LeftFoot`, `RightFoot`) and toe (`…ToeBase`), predicted with the motion, not measured (NVIDIA's viewers draw them above 0.5). `contacts.json` carries them to whatever checks the clip on the receiving rig.
12. **Pin precision and backend for reproducible results.** Identical inputs give identical motion on one backend and precision (there is no seed); FP32 and mixed FP16 can choose different motion, and differences grow through chaining. The request records precision, backend and TF32; the result records the model file hash, TensorRT version, device and GPU.
13. **Stay within what the model does.** It works best with target poses like its training data, which is captured motion: a standing pose taken from a rig's rest legs (knees locked straight, hips at the reference height) is not like it, since captured standing keeps the knees slightly bent, and steps generated from and to such a pose sank and dragged the feet (references/validation.md); it takes no text or scene geometry, avoids no collisions, and its quality on other body proportions is not established.

## Licence rules (hard guardrails)

- **Never ship NVIDIA's sample motions or anything derived from them**: the clips under the clone's `assets/motions/` (NVIDIA Sample Data Evaluation License, evaluation only), poses sampled from them, the bundled Smart Primitive and locomotion documents (they sample those clips), and motion generated toward such targets. They may be used to evaluate MotionBricks, nothing else. A project's contexts and targets are its own poses.
- **Generated motion** is output under the NVIDIA Open Model Agreement: NVIDIA claims no ownership of it and the agreement restricts no use of it.
- **Redistributing the model** (its ONNX files or weights, for instance to generate inside a game) requires shipping the Open Model Agreement and keeping the notice "Licensed by NVIDIA Corporation under the NVIDIA Open Model Agreement." The TensorRT runtime has its own licence; have it reviewed before redistributing it. A game that generates at runtime needs a fallback, such as baked clips, on hardware that cannot run its inference runtime.
- `soma-skeleton.json` and the rig built from it come from the person's own MotionBricks install under MotionBricks' terms; this skill ships no NVIDIA data.

## Generate a clip

1. **Find the generating host.** Copy `<S>/host_check.py` and `<S>/generate.py` to the machine that would generate (it may be this one) and run `<python> host_check.py [--motionbricks <clone>] [--precision fp32|fp16] [--device cuda:N] --out host-check.json` there (`--device` is the CUDA device generation will use, default `cuda:0`). Each requirement prints with `pass`, `fail`, `warn` or `unknown`, what was found and its source; every `warn` is said to the person.
   - `ready: true`: go to step 3.
   - `qualifies: true`, not ready: set it up (step 2).
   - It does not qualify: tell the person each entry of `missing`, then the options in [references/setup.md](references/setup.md) ("A machine that does not qualify"), and wait for their choice.

   Done when `host-check.json` on the chosen host says `"ready": true`, or the person has chosen a route without MotionBricks.

2. **Set it up**, only when not ready: follow [references/setup.md](references/setup.md). Done when `<python> host_check.py --motionbricks <clone> --precision <p> --device <d> --import-check` says `"ready": true` and its `plan` requirement passes.

3. **Get the SOMA rig**, once per MotionBricks release. On the host: `<mb-python> generate.py skeleton soma-skeleton.json`; move the file to the authoring side, then `soma_skeleton.py -- soma-skeleton.json soma-skeleton.glb`. Done when both files exist and the joint counts both commands print agree.

4. **Get the poses onto SOMA** as `.glb` files on that rig, each with one animation. Poses from the project rig go through `jam-3d-retarget` with `<A>/landmark-maps/soma.json`.
   - **Context**, one of: a file whose animation holds at least four frames of the motion leading in, ending where the new motion starts (`pack.py` reads the four 30 Hz poses ending at `--context-end`, default the animation's end); or a single pose the character rests in before moving, such as the first key pose, which `pack.py --context-hold` holds still for four frames.
   - **Targets**: one file per generation whose poses begin at `--start` seconds of its animation (default 0), so one file of key poses can serve several targets.

   Choose each target's pose count, Transition Early By and token range by rules 4 to 6. To prove a host and the round trip before real content, `make_test_poses.py -- soma-skeleton.json soma-skeleton.glb <dir>` writes a standing context and two targets built from the reference pose alone. Done when every file exists, rests in SOMA's reference pose, and you can state for each target its file and start, pose count, Transition Early By and tokens, with the reason.

5. **Pack.** `pack.py -- <context.glb> <request.json> --skeleton soma-skeleton.json --floor-tolerance <metres> --target <t1.glb> [--start S] [--poses N] [--early K] [--target-tokens A-B] [--target <t2.glb> ...] [--context-end S | --context-hold --context-end S] --precision fp32|fp16`. The options after a `--target` belong to that target. `--floor-tolerance` is the person's: how far a foot may sit from SOMA's standing height before a pose counts as off the ground, for instance the penetration their clip spec accepts; it has no default. It refuses a file whose rest pose is not SOMA's (`--rest-tolerance`, default 1 cm). Its summary gives, per pose set, `floor.floorOffset` (lowest foot against SOMA's standing pose) and `floor.nearGround`, and per target the ground distance from the previous pose and the average speeds the shortest and longest generation of that target's token range imply. Done when it exits 0, every `floor.nearGround` is true or belongs to a pose meant to be off the ground, and each target's intended speed lies between its two `impliedSpeed` values (otherwise change that target's `--target-tokens` or its placement and pack again).

6. **Generate.** Move `request.json` to the host and run `<mb-python> generate.py run request.json result.json [--device cuda:N]`. The first run of a precision without a plan builds it first. `generate.py check <file>` validates a request or result anywhere, without MotionBricks. Done when it exits 0 and prints the frame count and one entry per target; move `result.json` back.

7. **Unpack.** `unpack.py -- result.json <out-dir> --skeleton soma-skeleton.json --rig soma-skeleton.glb [--seam-tolerance <metres>]` writes `generated.glb` (frame 0 is the last context pose, one animation), `contacts.json` and `unpack-report.json`. When the result chains generations, each seam between them is judged: for the joint that stands out most, `excess` is how much farther it moves into the seam's frame than in any frame around it, and `pops` says whether that exceeds `--seam-tolerance`, which is the person's (for instance the jump their clip spec accepts) and has no default. Then look at a strip of the clip: `clip_strip.py -- <out-dir>/generated.glb strip.png`. Done when it exits 0, the report's `root.start` is the context's last hips position and `root.end` the last target's (when that target's Transition Early By is 0), no seam `pops`, and you can say from the strip that the clip reaches each target in a plausible way. Motion that misses, pops or looks wrong sends you back to step 4 (targets, rules 4 to 8) or step 5 (tokens).

8. **Hand over.** Give `generated.glb` to `jam-3d-retarget` for the project rig (this skill's SOMA map as the source map), and `contacts.json` to the clip check, beside the clip; keep `request.json` and `result.json` beside the clip as its record. In a recipe run that is the `motion` step: `jam run record <id> motion --file clip=<out-dir>/generated.glb --evidence request=request.json --evidence result=result.json --evidence contacts=<out-dir>/contacts.json --tool "<model>, MotionBricks <version>, <precision>, <backend>, <GPU>" --note "<what was generated: context, targets and their settings>"`, with the tool facts from `result.json`. Done when the record is accepted and the files are handed over.

The file formats, coordinate conventions and how chaining is laid out in `result.json` are in [references/files.md](references/files.md); read it before writing a tool that reads or writes them. Not covered here: in-game generation, batched requests and IK pins.

## What is validated

[references/validation.md](references/validation.md) lists every run with its numbers and what was not validated. The pure helpers have unit tests (`python3 -m pytest <S>/test_motionbricks.py`); `<S>/test_motionbricks_blender.py` runs the Blender scripts on a synthetic skeleton (Blender from `JAM_BLENDER` or `PATH`) and is skipped without Blender.
