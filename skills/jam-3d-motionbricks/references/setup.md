# Setting MotionBricks up on a generating host

Read this when `host_check.py` says the host `qualifies` but is not `ready`, when it does not qualify, or when the person has chosen a new machine to generate on. Every step runs on that host, in the folder where `host_check.py` and `generate.py` were copied (step 1 of the skill). It follows NVIDIA's own setup (MotionBricks README, "Setup") and adds the checks this skill relies on.

## What the host needs

These are MotionBricks' requirements as this skill applies them; `host_check.py` judges each and prints its source.

| Requirement | Why |
| --- | --- |
| Windows or Linux on x86-64 (Linux: glibc 2.28 or newer) | The pinned TensorRT 10.8 ships wheels for these only; NVIDIA tested Windows and Linux x86-64. Warp's macOS wheels have no GPU support. |
| An NVIDIA GPU of compute capability 7.5 or higher, the one generation will use (`--device`) | TensorRT 10.x's floor; the engines need a CUDA device. |
| NVIDIA driver 525 or newer, supporting CUDA 12 | Warp 1.17 (pinned) built with CUDA 12 needs 525+; TensorRT is the `cu12` build. |
| Git, Git LFS, uv | NVIDIA's install: the ONNX models come through Git LFS, the environment through `uv sync`. uv also fetches Python 3.12 when the machine lacks it. |
| About 5 GB of disk for the clone, plus its environment and plans | v0.2.0's Git LFS files total 2.48 GB (the sizes their pointers state), and a clone keeps them twice: in the working tree and under `.git/lfs`. A warning, not a failure. |

MotionBricks documents no minimum VRAM, GPU model or CPU-only speed; `host_check.py` reports VRAM without judging it. A machine qualifies when any of its GPUs meets the GPU requirement (`compute-capability`); the `device` requirement then judges the GPU `--device` names. On a machine with several GPUs, CUDA numbers them fastest first while `nvidia-smi` numbers them by bus, so `host_check.py` knows which GPU `--device` is only with `--import-check`, or when `CUDA_DEVICE_ORDER=PCI_BUS_ID` is set for it and for `generate.py` alike; until then `device` is `unknown` when the GPUs disagree, so the host may qualify without being ready, and a cached plan built for only some of the GPUs is not counted as fitting.

## Install

```sh
git clone https://github.com/NVlabs/motionbricks.git
cd motionbricks
git checkout v0.2.0        # the release this skill was written against; use the release the person chose
git lfs pull
uv sync
```

`<mb-python>`, MotionBricks' interpreter, is then `uv run --project <clone> python`, or the environment's interpreter directly: `<clone>/.venv/bin/python` on Linux, `<clone>\.venv\Scripts\python.exe` on Windows.

Done when `<python> host_check.py --motionbricks <clone> --device <d> --import-check` passes `motionbricks`, `python` and `cuda-runtime`. A `motionbricks` failure naming "a Git LFS pointer" means `git lfs pull` did not run or Git LFS was installed after cloning: run `git lfs install` and `git lfs pull` again.

## Build the plans

A plan is TensorRT's compiled form of one model at one precision for one GPU. MotionBricks keys each cached plan on the ONNX file's hash, the TensorRT version, the build options (FP16, TF32 off, batch size), the GPU and the operating system and CPU architecture, so a plan fits only the machine that built it, and a driver, GPU or TensorRT change makes it build a new one by itself. Build plans on the host that generates; copying them to another machine gains nothing.

```sh
<mb-python> generate.py plan --precision fp32 [--device cuda:N]     # and/or fp16
```

It prints whether it built or loaded the plan and how long it took (a few minutes for a build). Plans land in `<clone>/.trt-cache/`, where NVIDIA's own apps also look. `--tf32 off` builds a separate plan with TF32 disabled; the SOMA model permits TF32 by default. Done when the command exits 0 and `<python> host_check.py --motionbricks <clone> --precision <p> --device <d>` passes `plan` (give it `--tf32 off` too when generation will use it).

## When something fails

| Symptom | Cause and fix |
| --- | --- |
| `is not a CUDA device` or `no device cuda:N` from `generate.py`, or `cuda-runtime` fails | Warp found no usable GPU at that device: the driver is older than 525, the GPU is not NVIDIA, or the ordinal is past the last GPU. Update the driver (Warp prints the driver it needs at start-up) or choose another `--device`. |
| TensorRT errors while building | Check the driver and free VRAM (`nvidia-smi`), then build again; a partial plan is discarded. |
| `packed for MotionBricks X, this host has Y` | The request names another release. Install that release in its own clone, or pack again with `--motionbricks-version Y` after checking that release's rules. |
| `names model file …` | The request pins an ONNX hash this clone does not have (another release or a modified model). Use the matching clone or drop `--onnx-sha256` knowingly. |
| `uv sync` cannot find wheels | The OS or architecture is outside the requirements above. |

## A machine that does not qualify

Say what `host_check.py` listed as missing and offer the routes the person can actually take; assume none of them:

- **Another machine they control** that meets the table, local or remote. Run `host_check.py` there first.
- **A cloud instance** whose GPU, driver and operating system meet the table. The same install and plan build apply; the plans stay on that instance.
- **Someone else** who runs `generate.py run` on a qualifying machine and returns `result.json`.
- **Another route** in `jam-3d-animate`: keying by hand, retargeting an existing clip, or another motion provider.

Running the ONNX models without TensorRT (ONNX Runtime or an engine's own runtime) is not a documented path for SOMA: NVIDIA shows it only as raw model calls, without the engine's input encoding, boundary trimming and endpoint correction. This skill does not support it.
