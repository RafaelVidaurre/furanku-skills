# What was validated

Facts about the scripts in this skill, from runs on 2026-11-20; "Poses from a project rig, end to end" and "After the review fixes" ran the scripts as they now are. Two machines took part:

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

Later on 2026-11-20, after the review fixes, the same two machines ran the `animation` recipe in a fresh scratch project, following the skill's steps with the final scripts. The host was reached through a run queue that other work shared; files moved with a file-transfer tool. The project rig was `jam-3d-rig`'s bound test humanoid; its key poses were authored on it in Blender and retargeted onto the SOMA rig with `jam-3d-retarget` and `assets/landmark-maps/soma.json`. No NVIDIA sample motion was used.

- **Host check** with `--motionbricks <clone> --precision fp32 --device cuda:0 --import-check`: all nine requirements passed, `ready: true`. `generate.py skeleton` read 77 joints, 30 model joints; `soma_skeleton.py` built the rig with 77.
- **Pack:** the context held from the `stand` key pose (`--context-hold --context-end 0`), one target pose per request, Transition Early By 0, FP32, `--floor-tolerance 0.02` (the clip spec's penetration threshold). Floor offsets 0.0003 m for the held context and the target.
- **Generate:** plan cached; encode 168 ms and inference 8.3 ms for a 10-token generation.
- **Stepping:** a step 0.917 m ahead with `--target-tokens 10-10` gave 34 frames, from the context's hips to the target's within the report's rounding, and the strip looked plausible. Read joint by joint, the stepping foot slid flat along the floor for its first 0.5 s (heel and ball within 1.1 cm of their standing height, up to 2.7 m/s, 44 cm) before lifting 4.9 cm, while the model's own contact confidence for it fell to 0 by its third frame: the model treats it as a swing that never clears the floor. The closing foot came down toes first and skidded 40 cm at floor height, and the standing foot sank 3.1 cm. The token count chosen by the model (14, 50 frames) and 12 tokens both kept the dragging swing (at 12 tokens the closing toe stayed below the floor for the whole clip); a target 1.6 m ahead with 14 tokens gave full steps (feet lifted 16 and 47 cm) whose landing toe ploughed 6 cm under the floor at 3 m/s. On the project rig, `jam-3d-animate`'s check failed all of these; the faults are in the generated motion itself, before retargeting (see below).
- **In place:** a target with the right hand raised and no travel, 10 tokens: 34 frames, hips path 1.9 cm, feet below 0.2 m/s and within 6 mm of their standing height throughout, lowest foot 5 mm under it. It passed the check on the project rig, was imported into an engine and delivered; a second attempt with 12 tokens (42 frames) passed as well.
- **Chained:** the in-place greet and back to standing, 10 tokens each: 67 frames. `unpack.py` refused the result without `--seam-tolerance`; with 0.03 m (the clip spec's boundary jump) the seam read 2.0 mm of excess at the right heel and did not pop. That was the earlier seam measure, which compared step sizes; this result was not kept, so it was not re-read with the current one.
- **Records:** the `motion` step took the clip with the request, result and contacts as evidence and the tool facts from `result.json`.
- **Found:** this page and the skill named the pack summary's and unpack report's floor numbers as top-level fields; they sit under `floor`, as the skill now says.

## Stepping from a standing pose: what the inputs change

The same day, the stepping request above was varied on the same host and model (FP32, endpoint correction on, Transition Early By 0, one target pose) and every result was read on the SOMA skeleton before any retargeting, against the scratch clip spec's detection numbers (0.03 m, 0.25 m/s): 90 generations. Distances are the target's hips ahead of the context's.

| Context and target | Distance, tokens | What the model made |
| --- | --- | --- |
| The project's standing pose on SOMA: legs at the rest pose, knees locked, hips at the reference height (1.012 m); the greet or the same standing pose as target | 0.3 and 0.45 m; 10, 13, 16 | No step: the feet lifted at most 3 cm and slid 4 to 22 cm while slow and with the model's contact confidence at 0.9 or more |
| The same | 0.6 and 0.92 m; 10, 13, 16 | Steps whose feet travelled 0.47 to 0.85 m at floor height, up to 4.1 m/s; feet 1.8 to 4.1 cm under their standing height |
| The same poses with the knees bent so the hips sit 2 to 4 cm lower, feet on their spots and flat | 0.3 to 0.8 m; 10 to 16 | Short moves (0.3 and 0.45 m) slid more than they stepped (feet lifted at most 6 cm; slow slides of 4 to 26 cm); longer ones stepped with feet that still travelled 0.1 to 0.75 m at floor height |
| The same | 0.92 and 1.1 m; 10 to 16 | Both feet lifted 8.6 to 33 cm and fell at most 0.6 to 1.6 cm under their standing height. Retargeted onto the project rig with contacts and checked (12 of them), 10 failed on penetration (2.3 to 3.1 cm), on jumps where the contact holds blend in (3.0 to 8.3 cm) or on length; the 2 that passed every threshold were two-footed hops, not the step the spec asks for |
| NVIDIA's idle sample (evaluation only, nothing kept), whose standing bends the knees about 13° with the hips 2 cm below the reference height, as context; the same pose ahead as target | 0.3 to 0.92 m; 10, 13, 16 | The same picture: no step at 0.3 m (feet slid 7 to 14 cm), and from 0.45 m stepping feet that travelled 0.3 to 0.94 m at floor height |
| NVIDIA's own walk example: four poses of its sample walk ending at 1.0 s as context, the walk at 1.8 s as target | one and four target poses, default tokens | Four target poses: planted feet slid at most 2.2 cm; the landing heel reached the floor at 4 m/s and skidded 26 cm. One target pose: planted feet slid 11.6 cm |

So a move from standing to standing toward one target pose is out of what the model does well, whoever's poses it starts from: it slides or skates the feet, and the inputs only move where. Bending the knees as in captured standing removed most of the sinking and let the feet lift. Not run: intermediate target poses that carry the step itself (a contact pose mid-step), and several target poses ahead of a stop.

## After the review fixes

The same generating host, a clone of v0.2.0 with its environment, and the authoring machine with Blender 5.1.2. Neither `python3`, `python` nor `py` was on the host's `PATH`; `host_check.py` ran with the environment's interpreter (Python 3.12.16).

- **Host check**, each in 0.4 to 2.5 s: without a clone, `qualifies: true`, disk passed with 13.2 GB free. With the clone: FP32 (`--import-check`) and FP16 ready, each with exactly one of the three cached plans fitting on every field MotionBricks keys a plan on (model file and its hash, TensorRT 10.8.0.43 read from the environment, build options, GPU, OS and CPU architecture); the others named what differs. `--tf32 off` found no fitting plan (`warn`): the cached FP32 plan was built with TF32 allowed, and the earlier check, which compared only the model file name, OS and GPU, would have counted it although MotionBricks would build a new one. `--device cuda:1` on this one-GPU host failed `compute-capability` and `cuda-runtime` and did not qualify. With `--import-check`, Warp reported the device's bus id as `00000000:01:00` against `nvidia-smi`'s `00000000:01:00.0`; the check now matches both forms. After the GPU requirement was split into `compute-capability` (any GPU of the machine) and `device` (the GPU `--device` names), the check ran again on this host: without a clone, `qualifies: true`, both passed; FP32 with the clone and `--import-check`, `ready: true`, `device` identified as Warp reported it, one of three cached plans fitting; `--device cuda:1`, `device` and `cuda-runtime` failed and the machine still qualified (`ready: false`).
- **Device:** `generate.py plan --device cpu` and `--device cuda:1` exit 1 naming the problem; `cuda:0` loaded the cached FP32 plan in 3.5 s. A host with several GPUs was not available, so selecting another device before MotionBricks allocates is covered by a unit test only.
- **Generations**, FP32, plan cached, from the real SOMA rig's test poses packed with the new target options: the default two targets gave 99 frames (50 + 50); `--early 10` on the first and `--target-tokens 9-9` on the second gave 69 frames (40 + 30), as before; a context held from a single standing pose (`--context-hold --context-end 0`) to the target 1.5 m ahead with `--target-tokens 10-10` gave 34 frames. `generate.py check` passed each result.
- **Seams,** as measured then (each joint's step into the seam's frame against its largest step in the four frames on either side): in the default run the right heel moved 6.4 mm against at most 5.2 mm, 1.2 mm of excess; in the `--early 10` run no joint moved farther at the seam than around it (excess −3.4 mm, at the right hip). Both passed a seam tolerance of 1 cm. A step-size comparison passes a joint that jumps against its direction of motion, so seams are now judged by the change in velocity; re-read that way from the same two result files, the default run's seam reads 1.85 cm at the right forearm against at most 0.44 cm around it (1.4 cm of excess: about 1.9 cm per frame forward before the seam, 0.7 cm per frame sideways and up after it), and the `--early 10` run's 2.7 cm at the left toe end against 1.6 cm (1.1 cm of excess). Both pop at 1 cm. `unpack.py` refuses a chained result without a tolerance.
- **Unpack:** given the 8-frame animated context file as `--rig`, the clip held one animation, `generated`, and the report named `context` as dropped (the original script wrote both, `context` first). Packing the `--early 10` clip's last four and first four frames back gave the result's poses within 7.3e-7 m and 0.0001 degrees. Strips: the held-context clip steps from standing and stops standing at the target; the `--early 10` clip turns before it has fully stopped. `clip_strip.py` failed on a relative output path, as the skill writes it, and now resolves it.

## Blender-only and unit tests

- `test_motionbricks.py`, 108 tests: pose math (frame conversion, pack on SOMA itself, independence from bone axes, round trips through a rig with other bone frames), the request and result checks (malformed entries, booleans and numbers a float cannot hold named, never raised), device selection before allocation, chaining arithmetic, target options (paths with commas, misplaced or repeated options), the floor tolerance having no default, non-finite command-line numbers refused, implied speeds from each target's token range, the host check's parsing and judgement (a machine qualifying on any of its GPUs, the GPU behind `--device`, disk as a warning), plan matching on every cache-key field and not on a GPU the device may not be, LFS pointers, seams judged by the change in velocity against the motion around them (jumps forward and backward pop, steady, accelerating and sharply peaking smooth motion does not), the landmark map.
- `test_motionbricks_blender.py`, 5 tests on a synthetic skeleton with SOMA's names: build the rig and test poses, pack (FP16 request, per-target options, a held context, refusal of a rig with a longer arm), unpack a stand-in result onto an animated rig file (one animation out, a chained result refused without a seam tolerance) and pack the clip back within 1e-5 m, render a strip to a relative path.

## Not validated

- **Any Linux host, any cloud instance, any other GPU or driver.** Failing requirements (old GPU, old driver, old glibc, macOS) are judged only in unit tests and on the macOS machine.
- **A fresh install** following [setup.md](setup.md): the host already had its clone; a plan was built from scratch only for FP16.
- **`uv run --project`** as the interpreter: runs used the environment's interpreter directly.
- **Real project content beyond one generated test figure,** stepping clips that pass a clip check, and a moving four-pose target on the real model (four-pose sampling ran only in the Blender tests).
- **Settings not run on the model:** `--tf32 on|off`, `--no-endpoint-correction`, `--onnx-sha256`, and `--context-end` other than with `--context-hold`.
- **A host with several GPUs**, and `--device` other than `cuda:0` generating.
- **`clip_strip.py` on rigs other than SOMA's; glTF files holding several animations**, or rigs whose rest pose differs from SOMA's by less than the tolerance but more than zero.
- **Another MotionBricks release.**
