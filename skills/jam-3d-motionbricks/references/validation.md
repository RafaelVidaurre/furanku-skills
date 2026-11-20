# What was validated

Facts about the scripts in this skill as shipped, from runs on 2026-11-20. Two machines took part:

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

- **Pack:** the packed poses equal the constructed ones within 1.9e-7 m and 0.000 degrees on every joint; rest fit 0.0 m; floor offset 0.000 m for every pose set; implied speeds 0.79 to 2.65 m/s for target 1.
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

## Blender-only and unit tests

- `test_motionbricks.py`, 48 tests: pose math (frame conversion, pack on SOMA itself, independence from bone axes, round trips through a rig with other bone frames), the request and result checks, chaining arithmetic, target options, the host check's parsing and judgement, plan matching, LFS pointers, seam steps, the landmark map.
- `test_motionbricks_blender.py`, 4 tests on a synthetic skeleton with SOMA's names: build the rig and test poses, pack (FP16 request, per-target options, refusal of a rig with a longer arm), unpack a stand-in result and pack the clip back within 1e-5 m, render a strip.

## Not validated

- **Any Linux host, any cloud instance, any other GPU or driver.** Failing requirements (old GPU, old driver, old glibc, macOS) are judged only in unit tests and on the macOS machine.
- **A fresh install** following [setup.md](setup.md): the host already had its clone; a plan was built from scratch only for FP16.
- **`uv run --project`** as the interpreter: runs used the environment's interpreter directly.
- **Real project content:** no pose came through `jam-3d-retarget` from a project rig, and no target was a moving four-pose target on the real model (four-pose sampling ran only in the Blender tests).
- **Settings not run on the model:** `--tf32 on|off`, `--no-endpoint-correction`, `--onnx-sha256`, `--context-end`, target `start=`.
- **`clip_strip.py` on rigs other than the SOMA proxy figure; glTF files holding several animations**, or rigs whose rest pose differs from SOMA's by less than the tolerance but more than zero.
- **Another MotionBricks release.**
