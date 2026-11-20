# NVIDIA MotionBricks

Serves the motion route in the `inbetween` mode: motion between poses the project supplies. Unit: none per job; the compute is the person's, on their own machine or a GPU they rent. The neutral procedure is [providers.md](../providers.md). Everything below is from NVIDIA's repository at tag `v0.2.0` (commit `54fc563`, 2026-10-23), its model cards and the paper, read 2026-11-20; nothing here was confirmed by a generation.

## Reach

Through the `jam-3d-motionbricks` skill, which checks the generating host, packs requests, runs generation and unpacks the result. Packing and unpacking run where Blender is; generation runs where the requirements below are met, with only MotionBricks' own environment and plain JSON files. The two may be one machine or two; the files are moved by whatever the person uses.

## What the generating host needs

The release is [NVlabs/motionbricks](https://github.com/NVlabs/motionbricks) `v0.2.0` with the model `MotionBricks-SOMA-RP-v1`; checkpoints are on Hugging Face as [`nvidia/MotionBricks`](https://huggingface.co/nvidia/MotionBricks), and the apps use the ONNX models bundled in the repository.

- **An NVIDIA GPU with CUDA.** "The runtime uses TensorRT, which requires an NVIDIA GPU. The demos were tested on Windows and Linux (x86-64) with an NVIDIA GeForce RTX 4090" ([README, Setup](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/README.md#setup)). The model cards list Windows as the tested system, "not a complete compatibility matrix". The release has no macOS or non-NVIDIA route.
- **What the pinned runtime sets.** No minimum GPU, VRAM or driver is documented by MotionBricks itself. It pins TensorRT 10.8.0.43, which supports compute capability 7.5 or higher on Windows and Linux x86-64 and needs glibc 2.28 or later on Linux ([release notes](https://docs.nvidia.com/deeplearning/tensorrt/10.x.x/getting-started/release-notes-10/10.8.0.html), [support matrix](https://docs.nvidia.com/deeplearning/tensorrt/10.x.x/getting-started/support-matrix.html)), and Warp 1.17.0, built with CUDA 12, which needs a driver of version 525 or later.
- **Install.** Python 3.12 or later, Git LFS and `uv`: clone, `git lfs pull`, `uv sync`. A clone with its LFS objects is about 4.7 GB.
- **TensorRT plans.** "The first launch of each model and precision builds a TensorRT plan. This takes a few minutes. Plans are cached in `.trt-cache/`", keyed by the ONNX hash, the TensorRT version, the build options, the GPU and the OS: a plan never moves to another machine. Once it exists a request takes seconds.
- Running the ONNX models elsewhere (another runtime, a CPU) is possible but undocumented end to end for the character model ([ONNX inference](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/onnx_inference.md)).

## The model

- **Skeleton.** "SOMA, 30 joints", root `Hips`; Y up, metres ([SOMA model card](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md)). The model reads world-space joint frames, so poses must be on the SOMA skeleton itself, not on a renamed project rig. The descriptor's `rig.landmarks` maps the 30 joints of NVIDIA's joint list (`soma_n1.json`) to landmarks; `Spine2`, `Neck2`, `Jaw`, the eyes and the hand end joints stand at no landmark.
- **Input.** Four context poses that end at the start, and one to four target poses that begin at the target time. "One pose sets the destination. The model treats it as a stop with no velocity. A second pose adds velocity. A third and fourth pose add acceleration and momentum" ([Inbetweener](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/inbetweener.md)). "Text prompts and scene geometry are outside this model's input interface."
- **Length.** 30 Hz. One generation keeps 18 to 58 frames, "about 0.6 to 1.9 s of motion"; longer motion is chained, each new context being the poses actually shown ([runtime API](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md)).
- **Exact or guide targets.** Transition Early By 0 treats a target as a hard constraint; a value above 0 makes it a guide. Endpoint correction, on by default, starts the motion at the last context pose and ends it at the target.
- **Root.** `Hips` carries both travel and pelvis motion; the bundled skeleton has no ground-level root bone. Motion is on flat ground at model-space Y = 0: the training data has no continuous terrain.
- **Fingers** are not predicted; joints outside the model keep the skeleton's reference pose (a flat T-pose hand).
- **Foot contacts** come with each frame as confidences from 0 to 1 for heel and toe of each foot.
- **Files.** No exporter writes SOMA motion to BVH, FBX, glTF or USD; the skill writes that step.
- **Repeatability.** Identical inputs give identical motion on one backend and precision; FP16 and FP32, or another runtime, can give different motion.
- **Quality.** NVIDIA reports no quality figures for the released ONNX models; the paper's figures are for its own model. Its listed risks include "pose/contact artifacts" and unwanted motion under out-of-distribution targets, and "The fixed SOMA representation does not establish equivalent quality across body proportions or motion categories."

## Licence

([README, License](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/README.md#license))

- Code: Apache 2.0. Documentation and media: CC-BY-4.0.
- Models: the [NVIDIA Open Model Agreement](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-agreement/) (v. March 9, 2026): "Works are commercially usable" and "NVIDIA does not claim ownership to any outputs". Shipping the models themselves inside a game is redistribution: include the agreement and the notice "Licensed by NVIDIA Corporation under the NVIDIA Open Model Agreement."
- **Sample motions** (the bundled SOMA BVH and robot CSV clips) are under the NVIDIA Sample Data Evaluation License: internal evaluation only, no distribution of them or their derivative works. That covers the bundled locomotion and Smart Primitive targets sampled from them. A shipping project uses its own target poses.
- The TensorRT runtime packages have their own licence agreement, distributed with them.

Tell the person the licence points before the first generation that may ship.
