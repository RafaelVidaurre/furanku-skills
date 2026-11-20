# What was validated

Facts about the scripts in this skill, from runs on 2026-11-20; the last section re-ran them after the review fixes. Two machines took part:

- **Authoring side:** a macOS arm64 machine with Blender 5.1.2. It cannot generate, and the host check says so.
- **Generating host:** a Windows 11 x86-64 laptop with an 8 GB NVIDIA laptop GPU of compute capability 8.9, driver 621 (CUDA 13.5 user-mode driver), holding a MotionBricks v0.2.0 clone (commit `54fc563`) with its environment (Python 3.12.16, TensorRT 10.8.0.43, Warp 1.17.0) from an earlier evaluation, and a cached FP32 plan from that evaluation.

Files moved between them with a file-transfer tool. These runs are evidence of these runs, not requirements: nothing in the skill depends on either machine.

## Host check

| Where | Result |
| --- | --- |
| Authoring machine (macOS arm64, Python 3.14 and 3.9) | `os` fail, `nvidia-gpu` fail, `qualifies: false`, exit 1. Correct: the release cannot run there. |
| Generating host, first version | Every requirement passed except `driver-cuda`, `unknown`: this driver prints `CUDA UMD Version: 13.5` where older ones print `CUDA Version:`. The parser now reads both (unit-tested on both headers). |
| Generating host, with `--motionbricks --import-check`, FP32 and FP16 | All nine requirements pass: OS, GPU, compute capability 8.9, driver 621.14, CUDA 13.5, clone v0.2.0 with real ONNX files (758 MB FP32, 380 MB FP16), Python 3.12.16, a plan fitting this GPU and OS, TensorRT and Warp starting on the CUDA device. `qualifies` and `ready` true. |

Of the three plans cached on the host (SOMA FP32, SOMA FP16, and one of MotionBricks' other model), the check counted exactly the one for the requested precision as fitting, for FP32 and for FP16.

## Skeleton and rig

- `generate.py skeleton` read 77 joints, 30 of them model joints, from the clone's USD file (SHA-256 `4ab93d78…`). Its positions match the file read independently with OpenUSD: hips at 1.012 m, hip joints (`LeftLeg`) at 0.929 m, knees (`LeftShin`) at 0.496 m, arms horizontal at 1.442 m, toes toward +Z, the character's left on +X.
- `soma_skeleton.py` built the rig; it re-imports with the same 77 joint positions (rest fit 0.0 m).
- `assets/landmark-maps/soma.json` read through `jam-3d-rig`'s `landmarks_from_rig.py` on that rig: 21 landmarks, none missing, no findings, the other 56 joints reported unmapped.

## Pack, generate, unpack, on the real model

Poses: `make_test_poses.py` on the real rig (standing, arms lowered; built from the reference pose, no motion data). Context: standing at the origin. Target 1: one pose 1.5 m ahead (a stop). Target 2: one pose 1.0 m to the character's left of that, turned 90 degrees to its left. Defaults otherwise: tokens 8 to 14, Transition Early By 0, endpoint correction on.

- **Pack:** the packed poses equal the constructed ones within 1.9e-7 m and 0.000 degrees on every joint; rest fit 0.0 m; floor offset 0.000 m for every pose set. (The implied speeds this run printed, 0.79 to 2.65 m/s, used the 6 to 16 tokens of any generation; the summary now uses the target's own range, 0.92 to 1.80 m/s for the default 8 to 14.)
- **FP32 generation:** both generations chose 14 tokens, 50 frames each; the clip is 99 frames (3.27 s). First run 10.1 s in all, of which 4.65 s encoding on the first call (Warp compiling its kernels) and 95 ms inference on the first call, 5.4 ms on the second; a second run took 1.8 s.
- **Endpoints:** frame 0 equals the last context pose, frame 49 the first target, the last frame the second target, each within 1.1e-6 m and 0.0001 degrees per joint.
- **Motion:** the root goes from (0, 1.012, 0) to (1.0, 1.012, 1.5) along a 2.75 m path; hips height 0.874 to 1.013 m; top ground speed of the hips 2.46 m/s. The fastest joint move is 0.216 m in one frame, a toe end in a swing. Lowest foot joint 0.019 m below the ground, 0.040 m below its standing height.
- **Contacts:** frames above 0.5, of 99: left heel 57, left toe 71, right heel 52, right toe 57. While a joint stayed above 0.5 across two frames, it moved 3.3 to 5.6 mm per frame on average and at most 19 to 37 mm (on SOMA, before any retargeting).
- **Looked at** with `clip_strip.py`, every seventh frame from the side on the rig's proxy figure: from standing, the figure leans, steps forward and arrives standing, then turns to its left and steps sideways to the second target, ending facing that way. The `early=10` run below (every fifth frame) turns before it has fully stopped, as a guide target should.
- **Unpack:** `generated.glb` re-imports into Blender as 99 frames (0 to 98) at 30 fps; packing every frame back gives the result's poses within 8.7e-7 m and 0.0001 degrees.

### Precision, determinism, chaining settings

| Run | Generations (generated / played frames, tokens) | Clip | Notes |
| --- | --- | --- | --- |
| FP32, again | 50/50 (14), 50/50 (14) | 99 frames | Frames and contacts identical to the first run |
| FP16 (plan built first: 523.6 s, then `generate.py plan` reported it) | 50/50 (14), 50/50 (14) | 99 frames | Same token counts as FP32, different motion: joints up to 0.463 m apart, as NVIDIA's model card warns. Ends at the same target. 0.98 s in all |
| FP32, target 1 `early=10`, target 2 `tokens=9-9` | 50/40 (14), 30/30 (9) | 69 frames | The first generation stops 10 frames early, the fixed count gives exactly 30 frames. Largest joint move across the seam 0.051 m (a fingertip), against 0.013 m at the seam of the default run and 0.216 m inside the motion |

## Poses from a project rig, end to end

Later on 2026-11-20 the same two machines ran a whole `animation` recipe in a scratch project. The project rig was `jam-3d-rig`'s bound test humanoid; its key poses (`stand`, and `greet` 0.8 m ahead with the right hand raised) and a 4-frame context holding `stand` were authored on it in Blender and retargeted onto the SOMA rig with `jam-3d-retarget` and `assets/landmark-maps/soma.json`.

- **Host check** with `--motionbricks <clone> --import-check`, FP32: all nine requirements passed, `ready: true`. `generate.py skeleton` read 77 joints, 30 model joints, as before.
- **Pack:** context ending at its last frame, one target starting at 1.1 s (the `greet` key), one pose, Transition Early By 0, tokens 10 to 10, FP32. The first pack's floor offset was −0.030 m, which the then-default floor tolerance of 5 cm still called near the ground: the retarget had turned SOMA's feet to the project rig's foot pitch, and the generated step then dipped a toe 3.5 cm under the ground. That default is gone; the tolerance is now the person's. After `jam-3d-retarget` kept each foot's own rest, the floor offset was 0.0003 m. Ground distance 0.917 m (0.83 m/s at the fixed 34 frames; the summary then printed 0.48 to 1.62 m/s, ignoring the fixed token count).
- **Generate:** 34 frames (10 tokens), plan cached, encode 286 ms and inference 8.4 ms on the first call of the session, 23 ms and 8.0 ms later. With `tokens=12-12` the same request gave 42 frames; with the default 8 to 14 the model chose 14 tokens, 50 frames.
- **Unpack:** 34 frames, 1.1 s; the hips from (0, 1.012, 0) to (0, 1.012, 0.917), path 0.964 m, height 0.904 to 1.025 m; the largest one-frame move 0.212 m, a fingertip end. Looked at with `clip_strip.py`: it steps with the right leg, closes with the left while the right arm rises, and stops standing at the target. The strip first cut off the raised arm; it is now framed on every still's full height.
- **What the motion carried:** the planted feet drift: the left ankle moved 8.9 cm over its first 0.5 s on the ground, about 0.2 m/s, and the right 7.6 cm over its last 14 frames. The ball of the stepping foot sank 2.9 cm below its standing height while the foot pivoted. Both came through to the project rig and were measured there by `jam-3d-animate`'s check, as rule 12 expects.
- **Hand-over:** the clip went back to the project rig through `jam-3d-retarget`, which named `Spine2`, `Neck2`, `Jaw` and the eyes as not carried (rule 10), and on to the check, an engine import and delivery.

## After the review fixes

The same generating host, a clone of v0.2.0 with its environment, and the authoring machine with Blender 5.1.2. Neither `python3`, `python` nor `py` was on the host's `PATH`; `host_check.py` ran with the environment's interpreter (Python 3.12.16).

- **Host check**, each in 0.4 to 2.5 s: without a clone, `qualifies: true`, disk passed with 13.2 GB free. With the clone: FP32 (`--import-check`) and FP16 ready, each with exactly one of the three cached plans fitting on every field MotionBricks keys a plan on (model file and its hash, TensorRT 10.8.0.43 read from the environment, build options, GPU, OS and CPU architecture); the others named what differs. `--tf32 off` found no fitting plan (`warn`): the cached FP32 plan was built with TF32 allowed, and the earlier check, which compared only the model file name, OS and GPU, would have counted it although MotionBricks would build a new one. `--device cuda:1` on this one-GPU host failed `compute-capability` and `cuda-runtime` and did not qualify. With `--import-check`, Warp reported the device's bus id as `00000000:01:00` against `nvidia-smi`'s `00000000:01:00.0`; the check now matches both forms.
- **Device:** `generate.py plan --device cpu` and `--device cuda:1` exit 1 naming the problem; `cuda:0` loaded the cached FP32 plan in 3.5 s. A host with several GPUs was not available, so selecting another device before MotionBricks allocates is covered by a unit test only.
- **Generations**, FP32, plan cached, from the real SOMA rig's test poses packed with the new target options: the default two targets gave 99 frames (50 + 50); `--early 10` on the first and `--target-tokens 9-9` on the second gave 69 frames (40 + 30), as before; a context held from a single standing pose (`--context-hold --context-end 0`) to the target 1.5 m ahead with `--target-tokens 10-10` gave 34 frames. `generate.py check` passed each result.
- **Seams:** in the default run the seam after the first target (a stop) moved the right heel 6.4 mm against at most 5.2 mm in the four frames on either side, 1.2 mm of excess; in the `--early 10` run no joint moved farther at the seam than around it (excess −3.4 mm, at the right hip). The earlier check compared seams with the largest step anywhere in the clip (0.216 m, a toe in a swing), so it could not fail. Both runs pass with a seam tolerance of 1 cm; `unpack.py` refuses a chained result without one.
- **Unpack:** given the 8-frame animated context file as `--rig`, the clip held one animation, `generated`, and the report named `context` as dropped (the original script wrote both, `context` first). Packing the `--early 10` clip's last four and first four frames back gave the result's poses within 7.3e-7 m and 0.0001 degrees. Strips: the held-context clip steps from standing and stops standing at the target; the `--early 10` clip turns before it has fully stopped. `clip_strip.py` failed on a relative output path, as the skill writes it, and now resolves it.

## Blender-only and unit tests

- `test_motionbricks.py`, 81 tests: pose math (frame conversion, pack on SOMA itself, independence from bone axes, round trips through a rig with other bone frames), the request and result checks (malformed entries and booleans named, never raised), device selection before allocation, chaining arithmetic, target options (paths with commas, misplaced or repeated options), the floor tolerance having no default, implied speeds from each target's token range, the host check's parsing and judgement (the GPU behind `--device`, disk as a warning), plan matching on every cache-key field, LFS pointers, seams judged against the motion around them, the landmark map.
- `test_motionbricks_blender.py`, 5 tests on a synthetic skeleton with SOMA's names: build the rig and test poses, pack (FP16 request, per-target options, a held context, refusal of a rig with a longer arm), unpack a stand-in result onto an animated rig file (one animation out, a chained result refused without a seam tolerance) and pack the clip back within 1e-5 m, render a strip to a relative path.

## Not validated

- **Any Linux host, any cloud instance, any other GPU or driver.** Failing requirements (old GPU, old driver, old glibc, macOS) are judged only in unit tests and on the macOS machine.
- **A fresh install** following [setup.md](setup.md): the host already had its clone; a plan was built from scratch only for FP16.
- **`uv run --project`** as the interpreter: runs used the environment's interpreter directly.
- **Real project content beyond one generated test figure,** and a moving four-pose target on the real model (four-pose sampling ran only in the Blender tests).
- **Settings not run on the model:** `--tf32 on|off`, `--no-endpoint-correction`, `--onnx-sha256`, and `--context-end` other than with `--context-hold`.
- **A host with several GPUs**, and `--device` other than `cuda:0` generating.
- **`clip_strip.py` on rigs other than SOMA's; glTF files holding several animations**, or rigs whose rest pose differs from SOMA's by less than the tolerance but more than zero.
- **Another MotionBricks release.**
