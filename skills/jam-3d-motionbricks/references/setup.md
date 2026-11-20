# Setting MotionBricks up on a generating host

Read this when `host_check.py` says the host `qualifies` but is not `ready`, or when the person has chosen a new machine to generate on. Every step runs on that host. It follows NVIDIA's own setup (MotionBricks README, "Setup") and adds the checks this skill relies on.

## What the host needs

| Requirement | Why |
| --- | --- |
| Windows or Linux on x86-64 (Linux: glibc 2.28 or newer) | The pinned TensorRT 10.8 ships wheels for these only; NVIDIA tested Windows and Linux x86-64. Warp's macOS wheels have no GPU support. |
| An NVIDIA GPU of compute capability 7.5 or higher | TensorRT 10.x's floor; the engines need a CUDA device. |
| NVIDIA driver 525 or newer, supporting CUDA 12 | Warp 1.17 (pinned) built with CUDA 12 needs 525+; TensorRT is the `cu12` build. |
| Git, Git LFS, uv | NVIDIA's install: the ONNX models come through Git LFS, the environment through `uv sync`. uv also fetches Python 3.12 when the machine lacks it. |
| About 4.7 GB of disk for the clone, plus the plans | A full clone with its LFS objects measured 4.7 GB. |

MotionBricks documents no minimum VRAM, GPU model or CPU-only speed; `host_check.py` reports VRAM without judging it.

## Install

```sh
git clone https://github.com/NVlabs/motionbricks.git
cd motionbricks
git checkout v0.2.0        # the release this skill was written against; use the release the person chose
git lfs pull
uv sync
```

Done when `python3 <S>/host_check.py --motionbricks <clone> --import-check` passes `motionbricks`, `python` and `cuda-runtime`. A `motionbricks` failure naming "a Git LFS pointer" means `git lfs pull` did not run or Git LFS was installed after cloning: run `git lfs install` and `git lfs pull` again.

## Build the plans

A plan is TensorRT's compiled form of one model at one precision for this GPU. MotionBricks keys each cached plan on the ONNX file's hash, the TensorRT version, the build options, the GPU and the operating system, so a plan fits only the machine that built it; a driver, GPU or TensorRT change makes it build a new one by itself.

```sh
<mb-python> <S>/generate.py plan --precision fp32     # and/or fp16
```

It prints whether it built or loaded the plan and how long it took (a few minutes for a build). Plans land in `<clone>/.trt-cache/`, where NVIDIA's own apps also look. `--tf32 off` builds a separate plan with TF32 disabled; the SOMA model permits TF32 by default. Done when the command exits 0 and `host_check.py --motionbricks <clone> --precision <p>` passes `plan`.

`<mb-python>` is `uv run --project <clone> python`, or the environment's interpreter directly: `<clone>/.venv/bin/python` on Linux, `<clone>\.venv\Scripts\python.exe` on Windows. `generate.py` and `host_check.py` can live anywhere; they need nothing from this skill besides themselves.

## When something fails

| Symptom | Cause and fix |
| --- | --- |
| `is not a CUDA device` from `generate.py`, or `cuda-runtime` fails | Warp found no usable GPU: the driver is older than 525 or the GPU is not NVIDIA. Update the driver; Warp prints the driver it needs at start-up. |
| TensorRT errors while building | Check the driver and free VRAM (`nvidia-smi`), then build again; a partial plan is discarded. |
| `packed for MotionBricks X, this host has Y` | The request names another release. Install that release in its own clone, or pack again with `--motionbricks-version Y` after checking that release's rules. |
| `names model file …` | The request pins an ONNX hash this clone does not have (another release or a modified model). Use the matching clone or drop `--onnx-sha256` knowingly. |
| `uv sync` cannot find wheels | The OS or architecture is outside the requirements above. |

## A machine that does not qualify

Say what `host_check.py` listed as missing and offer the routes the person can actually take; assume none of them:

- **Another machine they control** that meets the table (a desktop, a workstation, a remote machine). Run `host_check.py` there first.
- **A cloud instance** with an NVIDIA GPU of compute capability 7.5 or higher and a Linux image with glibc 2.28 or newer. The same install and plan build apply; the plans stay on that instance.
- **Someone else** who runs `generate.py run` on a qualifying machine and returns `result.json`.
- **Another route** in `jam-3d-animate`: keying by hand, retargeting an existing clip, or another motion provider.

Running the ONNX models without TensorRT (ONNX Runtime or an engine's own runtime) is not a documented path for SOMA: NVIDIA shows it only as raw model calls, without the engine's input encoding, boundary trimming and endpoint correction. This skill does not support it.
