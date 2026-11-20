---
name: jam-3d-motionbricks
description: Generate humanoid motion with NVIDIA MotionBricks, a model that in-betweens on its SOMA skeleton from the last four poses to one to four target poses. Checks whether a machine meets MotionBricks' documented requirements and says what is missing, sets it up on a qualifying machine, packs SOMA poses from glTF files into a request, generates there, and unpacks the result into a glTF clip on SOMA with foot-contact confidences; includes NVIDIA's usage and licence rules and the SOMA landmark map. Use when the user asks to generate a transition, in-between or locomotion clip with MotionBricks, to check whether a machine can run MotionBricks, or to set MotionBricks up, or when jam-3d-animate's provider route picks MotionBricks.
---

# MotionBricks

MotionBricks generates character motion one **generation** at a time: from a **context** (the last four poses, at 30 Hz) toward a **target** (one to four poses), it produces 0.6 to 1.9 s of motion; chaining generations makes longer motion. It works only on NVIDIA's **SOMA** skeleton. This skill never touches the project rig: poses come in on SOMA and the clip goes out on SOMA, and `jam-3d-retarget` converts in both directions, with [`assets/landmark-maps/soma.json`](assets/landmark-maps/soma.json) as the SOMA side's map (pass its path).

Two sides, which may be one machine or two:

- **Authoring side**, where Blender is: `soma_skeleton.py`, `make_test_poses.py`, `pack.py`, `unpack.py`, `clip_strip.py`.
- **Generating host**, a machine that meets MotionBricks' requirements: `host_check.py` and `generate.py`, run in MotionBricks' own environment. It needs no Blender and no jam toolkit.

Between them travel plain files: `soma-skeleton.json` and `result.json` from the host, `request.json` and the two scripts to it. Move them however the person moves files.

`<S>` is this skill's `scripts/` folder, `<A>` its `assets/`. Blender scripts run as `blender --background --python-exit-code 1 --python <S>/<script> -- <arguments>` (`jam blender <S>/<script> -- ...` in a project with the jam toolkit); each script's header lists its arguments. `<mb-python>` is MotionBricks' interpreter on the host: `uv run --project <clone> python`, or `<clone>/.venv/bin/python` (`<clone>\.venv\Scripts\python.exe` on Windows). The scripts were written against MotionBricks v0.2.0 (model `MotionBricks-SOMA-RP-v1`); with a later release, read its README and SOMA model card for changes to these rules before the first run.

## NVIDIA's rules for using the model

These hold for every project. Sources: MotionBricks' README, runtime API, Inbetweener page and SOMA model card at v0.2.0, the pinned TensorRT and Warp releases, and the paper.

1. **The host decides.** The runtime needs an NVIDIA GPU of compute capability 7.5 or higher with a driver of 525 or newer that supports CUDA 12, on Windows or Linux x86-64. The release's runtime has no macOS or non-NVIDIA route (NVIDIA's ONNX page shows other runtimes only as raw model calls, without the engine's input encoding, trimming and endpoint correction). Detect this on the machine; never assume it.
2. **Plans belong to the machine that built them.** The first run of each precision builds a TensorRT plan, taking minutes, cached in the clone's `.trt-cache/`. Build plans on the host that generates; never copy them between machines.
3. **Poses are on the SOMA skeleton itself**: its joint names, root `Hips`, its joint frames, its reference (T-pose) rest, metres, +Y up. A project rig with renamed bones is not SOMA; retarget onto the SOMA rig.
4. **The context is the last four poses actually shown**, at 30 Hz, ending where the new motion starts. When chaining, each next context is the last four poses the previous generation played; `generate.py` does that.
5. **The target pose count sets the arrival.** One pose is a stop with no velocity. A second adds velocity, a third and fourth acceleration and momentum: four consecutive 30 Hz poses that begin at the target carry its motion through.
6. **Transition Early By** (0 to 20 frames) moves the transition point earlier without changing the target. Use 0 for exact poses, contacts and the hand-off into a clip; use more to make a target a guide that the motion leaves early toward the next target. To end on a clip, target its first four poses with 0, then play the clip.
7. **One generation is 18 to 58 frames** (6 to 16 tokens of four poses, less three boundary frames at each end); the default allows 8 to 14 tokens. Longer motion is several targets. Fit the length to the distance: more tokens for a longer way, fewer for a short one so the character does not add motion to fill time. A single count (`tokens=A-A`) fixes the length.
8. **Keep endpoint correction on.** It spreads small corrections so the motion starts exactly at the last context pose and ends at the first target pose.
9. **The ground is flat, at height zero.** SOMA model space has its ground on XZ at Y = 0, the model reads the hips' absolute height, and its training data has no terrain. Stand poses on Y = 0; handle stairs, slopes and other height changes outside the model.
10. **Fingers, jaw and eyes are not modelled.** They come back at the reference pose (flat T-pose hands) on every frame; the landmark map leaves them unmapped so the receiving rig keeps its own.
11. **`Hips` carries travel and pelvis motion together**; SOMA has no ground-level root bone. A root bone or an in-place clip is made on the receiving side.
12. **Foot contacts are confidences** from 0 to 1 per heel (`LeftFoot`, `RightFoot`) and toe (`…ToeBase`), predicted with the motion (NVIDIA's viewers draw them above 0.5). Measure contacts, slide and penetration on the target rig after retargeting; never take them from these values.
13. **Pin precision and backend for reproducible results.** Identical inputs give identical motion on one backend and precision (there is no seed); FP32 and mixed FP16 can choose different motion, and differences grow through chaining. The request records precision, backend and TF32; the result records the model file hash, TensorRT version and GPU.
14. **Stay within what the model does.** It works best with target poses like its training data; it takes no text or scene geometry, avoids no collisions, and its quality on other body proportions is not established. Look at every result.

## Licence rules (hard guardrails)

- **Never ship NVIDIA's sample motions or anything derived from them**: the clips under the clone's `assets/motions/` (NVIDIA Sample Data Evaluation License, evaluation only), poses sampled from them, the bundled Smart Primitive and locomotion documents (they sample those clips), and motion generated toward such targets. They may be used to evaluate MotionBricks, nothing else. A project's contexts and targets are its own poses.
- **Generated motion** is output under the NVIDIA Open Model Agreement: NVIDIA claims no ownership of it and the agreement restricts no use of it.
- **Redistributing the model** (its ONNX files or weights, for instance to generate inside a game) requires shipping the Open Model Agreement and keeping the notice "Licensed by NVIDIA Corporation under the NVIDIA Open Model Agreement." The TensorRT runtime has its own licence; have it reviewed before redistributing it. A game that generates at runtime needs a fallback, such as baked clips, on hardware that cannot run its inference runtime.
- `soma-skeleton.json` and the rig built from it come from the person's own MotionBricks install under MotionBricks' terms; this skill ships no NVIDIA data.

## Generate a clip

1. **Find the generating host.** Copy `<S>/host_check.py` to the machine that would generate (it may be this one) and run `python3 host_check.py [--motionbricks <clone>] [--precision fp32|fp16] --out host-check.json` there; any Python 3.8 or newer works. Each requirement prints with `pass`, `fail`, `warn` or `unknown`, what was found and its source.
   - `ready: true`: go to step 3.
   - `qualifies: true`, not ready: set it up (step 2).
   - It does not qualify, and the person has no machine that does: tell them each entry of `missing`, then the options, without assuming any: another machine they control that meets rule 1 (local or remote), a cloud instance with such a GPU, someone else who generates and returns `result.json`, or another route through `jam-3d-animate` (by hand, retargeting an existing clip, another motion provider). Wait for their choice.

   Done when `host-check.json` on the chosen host says `"ready": true`, or the person has chosen a route without MotionBricks.

2. **Set it up**, only when not ready: follow [references/setup.md](references/setup.md). Done when `host_check.py --motionbricks <clone> --precision <p> --import-check` says `"ready": true` and its `plan` requirement passes.

3. **Get the SOMA rig**, once per MotionBricks release. On the host: `<mb-python> generate.py skeleton soma-skeleton.json`; move the file to the authoring side, then `soma_skeleton.py -- soma-skeleton.json soma-skeleton.glb`. Done when both files exist and the joint counts both commands print agree.

4. **Get the poses onto SOMA** as `.glb` files on that rig, each with one animation: a **context** holding at least four frames that end where the new motion starts, and one file per **target** whose first frames are the target poses. Poses from the project rig go through `jam-3d-retarget` with `<A>/landmark-maps/soma.json`. Choose each target's pose count, Transition Early By and token range by rules 5 to 7. To prove a host and the round trip before real content, `make_test_poses.py -- soma-skeleton.json soma-skeleton.glb <dir>` writes a standing context and two targets built from the reference pose alone. Done when every file exists, rests in SOMA's reference pose, and you can state for each target its pose count, Transition Early By and tokens with the reason.

5. **Pack.** `pack.py -- <context.glb> <request.json> --skeleton soma-skeleton.json --target <t1.glb>[,poses=N][,early=K][,tokens=A-B] [--target ...] --precision fp32|fp16`. It refuses a file whose rest pose is not SOMA's (`--rest-tolerance`, default 1 cm). Its summary gives, per pose set, `floorOffset` (lowest foot against SOMA's standing pose) and, per target, the ground distance from the previous pose and the average speeds the shortest and longest generation imply. Done when it exits 0, every `nearGround` is true or belongs to a pose meant to be off the ground, and each target's intended speed lies between its two `impliedSpeed` values (otherwise change `tokens` or the target's placement and pack again).

6. **Generate.** Copy `request.json` and `<S>/generate.py` to the host and run `<mb-python> generate.py run request.json result.json`. The first run of a precision without a plan builds it first. `generate.py check <file>` validates a request or result anywhere, without MotionBricks. Done when it exits 0 and prints the frame count and one entry per target; move `result.json` back.

7. **Unpack.** `unpack.py -- result.json <out-dir> --skeleton soma-skeleton.json --rig soma-skeleton.glb` writes `generated.glb` (frame 0 is the last context pose), `contacts.json` and `unpack-report.json`. Done when it exits 0, the report's `root.start` is the context's last hips position and `root.end` the last target's (when that target's Transition Early By is 0), no seam in `frameSteps.seams` moves a joint farther than `frameSteps.largest`, and you have looked at a strip of the clip (`clip_strip.py -- <out-dir>/generated.glb strip.png`) and can say it reaches each target in a plausible way; motion that misses, pops or looks wrong sends you back to step 4 (targets, rules 5 to 9) or step 5 (tokens).

8. **Hand over.** Give `generated.glb` and `contacts.json` to `jam-3d-retarget` for the project rig, then to `jam-3d-animate`'s clip check; keep `request.json` and `result.json` beside the clip as its record. In a recipe run, name in `--tool` the model, MotionBricks version, precision, backend and GPU from `result.json`. Done when the files are handed over and the record is kept.

The file formats, coordinate conventions and how chaining is laid out in `result.json` are in [references/files.md](references/files.md); read it before writing a tool that reads or writes them. Not covered here: in-game generation, batched requests, IK pins and any inference path besides TensorRT.

## What is validated

[references/validation.md](references/validation.md) lists every run with its numbers. In short: the host check, a plan build and real generations ran on one Windows laptop with an NVIDIA GPU, from constructed poses packed in Blender on another machine, and the unpacked clip re-imports into Blender matching the result to under a micrometre. Not validated: Linux hosts, real project content through retargeting, and any machine but those two. The pure helpers have unit tests (`python3 -m pytest <S>/test_motionbricks.py`); `<S>/test_motionbricks_blender.py` runs the Blender scripts on a synthetic skeleton and is skipped without Blender.
