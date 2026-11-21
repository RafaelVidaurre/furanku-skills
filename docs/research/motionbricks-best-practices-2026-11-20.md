# NVIDIA MotionBricks: requirements, model contract and best practice

Research note, 2026-11-20. Scope: what a skill needs to know to offer NVIDIA MotionBricks as **one** way to create character animation in **any** game project, without assuming the user's OS, GPU, engine or machines. The note covers hardware and install requirements, the model's input/output contract, NVIDIA's intended uses and limits, retargeting, root motion, quality checks, runtime use and licensing.

**What was read.**
- **Repository.** [NVlabs/motionbricks](https://github.com/NVlabs/motionbricks) at tag `v0.2.0`, commit `54fc563aeaaf819a753d72cc9fdc6713989cdd43` (2026-10-23, "v0.2.0 commit"). This is the latest commit and the only tag/release on the date of reading. The tag object is `40f54859d9b496206b20ff614d968d292f26e620`. `M` below abbreviates `https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/`. The repository was cloned with its Git LFS objects and read as data. None of its scripts were run.
- **Checkpoints.** Hugging Face [`nvidia/MotionBricks`](https://huggingface.co/nvidia/MotionBricks/tree/3cb362d9b95aa40462abcb4d8cfae9ffb6d97410), revision `3cb362d9b95aa40462abcb4d8cfae9ffb6d97410` (2026-10-23).
- **Paper.** Wang et al., *MotionBricks: Scalable Real-Time Motions with Modular Latent Generative Model and Smart Primitives*, [arXiv:2604.24833v1](https://arxiv.org/abs/2604.24833v1) (submitted 2026-04-27; ACM TOG 45(4), DOI 10.1145/3811334). Cited as "Paper §x".
- **Other first-party sources.** NVIDIA TensorRT, Warp/Newton, SOMA-X and SOMA Retargeter docs, the NVIDIA Open Model Agreement page, Epic's Unreal Engine docs, the Blender manual and the Unity manual. Each link says which version it was read at.

**How to read this note.** The note has three parts. **Part A** holds what NVIDIA states in docs, model cards, code or the paper. **Part B** holds general animation practice from other first-party docs, for the questions NVIDIA does not answer. **Part C** lists open questions. Facts marked **Code** come from reading MotionBricks source, which NVIDIA owns. Facts marked **Measured** come from inspecting the cloned files, for example file sizes or the USD rest pose. **Inference** marks a conclusion drawn from facts; it is never used as a rule on its own. A test project tried MotionBricks earlier. Nothing in this note is based on it.

---

## Part A — What NVIDIA states

### A1. Hard requirements

**GPU and runtime.**
- "The runtime uses TensorRT, which requires an NVIDIA GPU. The demos were tested on Windows and Linux (x86-64) with an NVIDIA GeForce RTX 4090" ([M/README.md, Setup](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/README.md#setup)).
- Both model cards list "Tested operating system: Windows" and "Documented deployment hardware: NVIDIA Ada Lovelace GeForce RTX 4090". They add: "The table identifies the tested setup, not a complete compatibility matrix" ([M/docs/soma_model.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#software-integration), [M/docs/unitree_g1_model.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/unitree_g1_model.md#software-integration)). The README and the model cards disagree about Linux (see C1).
- **Code.** Engines "need a CUDA device" ([M/docs/runtime_api.md, Engines](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#engines)). `InferenceEngine` raises `ValueError("TensorRT requires a CUDA device …")` when the Warp device is not CUDA ([M/motionbricks/inference/engine.py#L78-L80](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/inference/engine.py#L78-L80)).
- **No minimum GPU, VRAM figure or driver version is documented by MotionBricks.** The floor comes from its pinned dependencies:
  - **TensorRT 10.8.** Pinned as `tensorrt-cu12==10.8.0.43` ([M/pyproject.toml#L22](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/pyproject.toml#L22)). The 10.8.0 release notes say it applies to "x86 Linux and Windows users, and ARM-based CPU cores for Server Base System Architecture". It requires "at least NVIDIA driver r450 on Linux or r452 on Windows", supports CUDA 12.0u1–12.8 (and 11.x), and needs glibc ≥ 2.28 on Linux x86-64. macOS is not mentioned ([TensorRT 10.8.0 release notes](https://docs.nvidia.com/deeplearning/tensorrt/10.x.x/getting-started/release-notes-10/10.8.0.html)). The 10.x support matrix says "TensorRT supports NVIDIA hardware with compute capability SM 7.5 or higher" ([TensorRT 10.x support matrix](https://docs.nvidia.com/deeplearning/tensorrt/10.x.x/getting-started/support-matrix.html)).
  - **TensorRT wheels.** The lock file resolves `tensorrt-cu12-bindings` wheels only for `manylinux_2_28_x86_64`, `manylinux_2_31_aarch64` and `win_amd64`. There is no macOS wheel ([M/uv.lock#L333-L341](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/uv.lock#L333-L341)).
  - **Warp.** Locked at 1.17.0, with Newton 1.6.0. Newton's README says Warp ≥ 1.18 wheels need "an NVIDIA Turing GPU (compute capability 7.5+) and driver R580+". It also says "On an R545–R579 driver or an older supported GPU, install with `warp-lang==1.17.0`", and "macOS runs on CPU" ([Newton README @ 9aa2144](https://github.com/newton-physics/newton/blob/9aa2144ae8f3d94dc7ce3b4c0f60d086387528ed/README.md)). Warp's own README: "The macOS wheels support CPU execution but not Metal acceleration" ([Warp README @ 8a60f73](https://github.com/NVIDIA/warp/blob/8a60f7374230dc90b2eea5c0b28da1e44c72c0a7/README.md)).
  - **Inference.** The shipped runtime therefore needs Windows or Linux and an NVIDIA GPU of compute capability ≥ 7.5. It cannot run on macOS or on non-NVIDIA GPUs.

**Python and install.**
- `requires-python = ">=3.12"`, and `.python-version` is `3.12` ([M/pyproject.toml#L10](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/pyproject.toml#L10)).
- Install: get Git LFS and `uv`, clone, then run `git lfs pull` and `uv sync` ([M/README.md, Setup](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/README.md#setup)).
- "The first launch of each model and precision builds a TensorRT plan. This takes a few minutes. Plans are cached in `.trt-cache/`" (same section).
- **Code.** The plan cache is keyed by the ONNX SHA-256, the TensorRT version, the build options, a GPU fingerprint, and the OS and CPU architecture ([M/motionbricks/inference/cache.py#L38](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/inference/cache.py#L38)). A plan only works on the machine and GPU that built it.

**Disk.**
- **Measured.** ONNX files: SOMA FP32 728 MB and mixed FP16 376 MB; G1 FP32 704 MB and FP16 352 MB ([M/motionbricks/assets/onnx](https://github.com/NVlabs/motionbricks/tree/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/assets/onnx)). A full clone with LFS objects took about 4.7 GB on disk, of which about 2.4 GB was `.git`.
- The ONNX exporter says "Allow several GB of free disk space" for its temporary files ([M/tools/onnx/README.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/tools/onnx/README.md#export)).
- The SOMA pose-module checkpoint on Hugging Face alone is 546 MB ([HF tree](https://huggingface.co/nvidia/MotionBricks/tree/3cb362d9b95aa40462abcb4d8cfae9ffb6d97410/soma)).
- The apps "use the ONNX models bundled … so you do not need to download a checkpoint" ([M/README.md, Checkpoints](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/README.md#checkpoints)).

**Headless use.**
- Two scripts "call the library without a viewer or the apps": `docs/examples/generate_once.py` and `docs/examples/locomotion_loop.py` ([M/docs/runtime_api.md, Runnable examples](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#runnable-examples)).
- **Code.** The four apps restrict `--viewer` to the OpenGL viewer and hide Newton's `--headless` option ([M/app/utils/cli.py#L13-L51](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/app/utils/cli.py#L13-L51)). The documented headless route is therefore the library and the examples, not the apps.

**Without an NVIDIA GPU.**
- The models are plain ONNX, opset 17 ([M/docs/soma_model.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md)).
- NVIDIA's batching page runs a model with ONNX Runtime's `CPUExecutionProvider`. Its example uses the G1 model. The page adds that "ONNX Runtime is not a MotionBricks dependency" ([M/docs/onnx_inference.md, Prepare a batch](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/onnx_inference.md#prepare-a-batch)).
- "A CPU-versus-GPU inference comparison is not provided." The checkpoint-to-ONNX exporter "runs on CPU and is separate from this GPU inference path" ([M/docs/soma_model.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#software-integration)).
- Raw ONNX output "includes the boundary frames and has no endpoint correction". The engines do the trimming and correction ([M/docs/onnx_inference.md, Read the outputs](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/onnx_inference.md#read-the-outputs)). For SOMA, the CUDA engine's Warp kernels also do the input encoding: heading alignment, 6D rotations and root velocities ([M/motionbricks/model/soma/kernels.py](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/model/soma/kernels.py)).
- **Inference.** A non-NVIDIA path is possible but undocumented. It means running the ONNX in another runtime and re-implementing the SOMA encode, decode, trim and correction steps from the Apache-2.0 kernels. Its speed and its match to TensorRT are unknown (C1).

**Producing files.**
- **Code.** The library loads BVH, CSV and USD. Its only motion writer is `save_csv` for G1 `DOFAnimationBuffer`s ([M/motionbricks/io/csv.py#L75](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/io/csv.py#L75)). No exporter writes SOMA motion to BVH, FBX, glTF or USD. Whoever generates SOMA motion offline must write the export step.

### A2. The model contract (SOMA model, `MotionBricks-SOMA-RP-v1`)

**Skeleton and space.**
- The skeleton is "SOMA, 30 joints" and the root joint is `Hips` ([M/docs/soma_model.md, Pose Representation](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#pose-representation)). The joint order is in [M/motionbricks/assets/onnx/soma/soma_n1.json](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/assets/onnx/soma/soma_n1.json): Hips, Spine1, Spine2, Chest, Neck1, Neck2, Head, Jaw, LeftEye, RightEye, LeftShoulder, LeftArm, LeftForeArm, LeftHand, LeftHandThumbEnd, LeftHandMiddleEnd, the same six for the right arm, then LeftLeg, LeftShin, LeftFoot, LeftToeBase and the same four for the right leg.
- "SOMA model space is Y up, with XZ as the ground plane. Positions use meters. Each 6D rotation holds the first two columns of a joint's rotation matrix in SOMA model space" (same section).
- `model_to_runtime` maps model space to the application's world. The apps use Z-up world space ([M/docs/runtime_api.md, Pose layouts and model space](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#pose-layouts-and-model-space)).
- The engine "finds the model's 30 joints in a skeleton by name. The root must be at index zero. The skeleton can hold more joints, such as the SOMA fingers, which the model does not predict." It goes on: "The model uses the SOMA joint layout and proportions, so a character with another skeleton needs a retargeting step" ([M/docs/runtime_api.md, Engines](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#engines)).

**How poses enter and leave the model (Code).**
- **Input.** The encoder composes the caller's local transforms into world space over the caller's skeleton hierarchy. It then writes each joint's **world** rotation as its 6D input and each joint's world position relative to the root's ground point ([M/motionbricks/model/soma/kernels.py#L88-L161](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/model/soma/kernels.py#L88-L161)).
- **Output.** The decoder rebuilds local rotations as `parent⁻¹ · child` from the predicted world rotations. It takes **bone translations from the skeleton's reference pose**, not from predicted positions ([#L164-L245](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/model/soma/kernels.py#L164-L245)).
- **Joints outside the model.** Non-model joints, such as fingers, are written as the skeleton's reference-pose local transform on every frame ([#L220-L223](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/model/soma/kernels.py#L220-L223)).
- **Rest-pose offsets.** The exported graph converts rotations between a "capture T pose" and a "standard" T pose using fixed offsets ([M/tools/onnx/models/soma/model.py#L60-L120](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/tools/onnx/models/soma/model.py#L60-L120)).
- **Inference, strong.** The model reads world-space joint frames. Joint orientation conventions therefore matter, and joint names alone do not. A project rig with renamed bones but its own bone axes and rest pose would feed the model rotations it never saw in training. Poses must be expressed on the SOMA skeleton itself.

**The bundled SOMA skeleton (Measured).**
- `motionbricks/assets/human/soma_base_skel_minimal_no_root.usd` has 77 joints, including fingers, under `Hips`. It is `upAxis = Y` with `metersPerUnit = 0.01`.
- Its **rest** transforms form a T-pose: the arms are horizontal at about 1.44 m, the hips are at about 1.01 m, and the toes point toward +Z. Its **bind** transforms have the arms lowered about 50°, like an A-pose.
- MotionBricks uses the rest pose: "The USD rest pose becomes the skeleton's reference pose" ([M/motionbricks/io/usd.py#L4-L7](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/io/usd.py#L4-L7)).
- SOMA-X documents the native rig as "centimeters, up axis `+Y`, forward axis `+Z`", with a "bind/T-pose" template ([SOMA-X data assets @ 01ab5b5](https://github.com/NVlabs/SOMA-X/blob/01ab5b5c0876058bd27d34b1607d74b2e55e0cf4/docs/data_assets.md)).
- The bundled BVH clips are in centimeters at 120 Hz (`Frame Time: 0.008333`) and carry 77 joints under a `Root` joint. The BVH loader converts centimeters to meters ([M/motionbricks/io/bvh.py](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/io/bvh.py)).

**Timing and length.**
- Each generation runs at 30 Hz. The context is "the four most recent poses". The target is "one to four poses" ([M/README.md, How MotionBricks works](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/README.md#how-motionbricks-works)).
- "One generation produces 6 to 16 tokens, or 24 to 64 raw frames … The engine removes three boundary frames at each end. The generated motion then starts at the last context pose and ends at the first target pose. That leaves 18 to 58 valid frames, or about 0.6 to 1.9 s of motion" ([M/docs/runtime_api.md, Generation length](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#generation-length)).
- The default allowed token range is 8 to 14 ([M/motionbricks/model/config.py#L12](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/model/config.py#L12)). The Smart Primitive Editor defaults to 6 to 14.
- "A single count gives the target exact control over how many frames to generate." Tokens should fit the distance: "A longer distance between targets needs more tokens … A shorter distance needs fewer tokens, so that the character does not add extra motion to fill the time" ([M/docs/guided_tutorial.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/guided_tutorial.md)).

**Target count sets velocity.**
- "One pose sets the destination. The model treats it as a stop with no velocity. A second pose adds velocity. A third and fourth pose add acceleration and momentum" ([M/docs/inbetweener.md, Set Poses to Use](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/inbetweener.md#set-poses-to-use)).
- **Code.** Root velocities are finite differences to the next pose. The velocity mask is left unset at the last context pose and at the last *given* target pose. Unused target slots are padded with the last given pose and masked off ([M/motionbricks/model/kernels.py#L14-L49](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/model/kernels.py#L14-L49)).
- Context poses are the four poses that **end** at the start time. Target poses are the poses that **begin** at the target time ([M/docs/inbetweener.md, Sample the four-pose window](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/inbetweener.md#sample-the-four-pose-window)).

**Hard and soft targets.**
- `correct_generated_diff` is on by default. It "spreads small corrections over the motion so it starts at the last context pose and ends at the target" ([M/docs/runtime_api.md, Generation settings](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#generation-settings)). **Code:** start and end deltas are blended linearly over the generated frames ([M/motionbricks/model/soma/kernels.py#L285-L317](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/model/soma/kernels.py#L285-L317)).
- `transition_early_by_frames` (0 to 20, [M/motionbricks/runtime/target_pose.py#L24](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/runtime/target_pose.py#L24)) "does not change the target sent to the model. It moves the transition point earlier … This makes a target useful as a guide" ([M/docs/inbetweener.md, Set Transition Early By](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/inbetweener.md#set-transition-early-by)).
- The paper calls this the drop-frame attribute τ. "Setting τ = 0 treats the keyframe as a hard constraint … essential for precise contact interactions. Setting τ > 0 treats the keyframe as soft guidance" (Paper §6.2).
- For a precise target, the tutorial says to "Use a smaller value when the motion must match the target as closely as it can" ([M/docs/guided_tutorial.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/guided_tutorial.md)).
- SOMA-only IK pins pull chosen hands and feet onto the first target pose with two-bone IK, "halfway through the generated step" until the transition point ([M/docs/smart_primitive_editor.md, IK Pins](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/smart_primitive_editor.md#ik-pins)).

**Root, heading and height.**
- "Before inference, the engine removes the ground position and heading of the last context pose. It keeps the root height." The heading turns to +X by default (`heading_alignment`) ([M/docs/soma_model.md, Runtime Generation](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#runtime-generation)).
- **Code.** Heading comes from the positions of the `RightLeg` and `LeftLeg` joints ([M/motionbricks/model/soma/contract.py](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/model/soma/contract.py), [kernels.py#L14-L84](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/model/soma/kernels.py#L14-L84)). The alignment transform has zero height, so the model sees the hips' **absolute** height above model-space Y = 0.

**Outputs.**
- `pred_global_motions [N,64,366]` holds, per frame: root position and heading (5), joint positions (87), 6D rotations (180), joint velocities (90) and foot contacts (4). `pred_num_tokens [N]` holds the chosen token count ([M/docs/soma_model.md, Outputs](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#outputs)).
- The engine returns world-space local joint transforms in an `AnimationBuffer` at 30 Hz. `output.num_frames` marks the valid range ([M/docs/runtime_api.md, Engines](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#engines)).
- Each frame has four foot contacts: "a confidence from 0 to 1 that a heel or a toe is planted", for `LeftFoot`, `LeftToeBase`, `RightFoot` and `RightToeBase`. "Clips loaded from files have no foot contacts" ([M/docs/runtime_api.md, Foot contacts](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#foot-contacts)). The demos draw contacts above a default threshold of 0.5 ([M/motionbricks/renderers/foot_contact_renderer.py#L71](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/renderers/foot_contact_renderer.py#L71)).

**Chaining.**
- "Each new context must hold the poses that were actually shown. Otherwise the next generation starts from another pose, and the character jumps" ([M/docs/runtime_api.md, Chaining generations](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#chaining-generations)).
- `MotionRecorder` resamples recorded poses to 30 Hz from any update rate. "Record the pose after every change that your app makes to it. Clip frames, target pose IK, and physics all count" ([M/docs/runtime_api.md, Record what you show](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#record-what-you-show)).
- Clips and generated motion mix freely. To go into a clip, generate toward the clip's first four poses with Transition Early By 0, then play the clip. To come out of a clip, keep recording its frames ([M/docs/runtime_api.md, Clips and generated motion](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#clips-and-generated-motion)).

**Determinism and precision.**
- **Code.** The release graph uses argmax token selection: `raise ValueError("The release exporter uses argmax token selection.")` ([M/tools/onnx/models/soma/inference.py#L438-L441](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/tools/onnx/models/soma/inference.py#L438-L441)). The token count is also an argmax ([networks.py#L526](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/tools/onnx/models/soma/networks.py#L526)). There is no seed or sampling parameter. The paper's Unreal demo relies on "the deterministic replanning behavior of MotionBricks" (Paper App. G).
- "Mixed FP16 and FP32 can produce different motion, because rounding affects the choice of motion tokens." "Generated motion can vary with precision and inference runtime. Differences can accumulate when generated motion is fed back as context" ([M/docs/soma_model.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#inference)).
- For G1, TF32 is disabled because with it "joint angles can differ by several degrees on identical inputs" ([M/docs/unitree_g1_model.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/unitree_g1_model.md#inference)). SOMA permits TF32 ([M/docs/runtime_api.md, TensorRT builds](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/runtime_api.md#tensorrt-builds)).

**Batching.**
- The ONNX models take a variable `N`. "Each request has its own poses, masks, and allowed token counts. Requests are processed independently" ([M/docs/onnx_inference.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/onnx_inference.md#prepare-a-batch)).
- TensorRT plans are built for a fixed batch size. The SOMA and G1 engine classes accept only `N=1`. Larger batches go through `InferenceEngine` directly, and the caller trims, corrects and places each request ([same page, TensorRT and the demos](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/onnx_inference.md#tensorrt-and-the-demos)).

**Inputs the model does not take.**
- "Text prompts and scene geometry are outside this model's input interface. The application places targets and handles obstacles" ([M/docs/soma_model.md, Limitations](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#limitations)).
- Targets need not come from clips: "It can load any finite poses with the correct SOMA or G1 layout". Kimodo or ARDY "could generate them instead" ([M/docs/inbetweener.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/inbetweener.md#select-a-clip-and-frame)).

### A3. Intended uses, limitations and NVIDIA's own usage patterns

**Intended uses** ([M/docs/soma_model.md, Intended Uses](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#intended-uses)):
- "Generate transitions between authored or sampled human poses."
- "Drive interactive locomotion by placing targets from the application."
- "Animate approaches to objects and interactions described by target poses."
- "Prototype character animation in games, media tools, and simulation scenes."

The model "is intended for commercial and non-commercial motion-generation applications."

**Documented limitations.**
- **Model card** ([M/docs/soma_model.md, Limitations](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#limitations)):
  - Other skeletons need retargeting.
  - Text and scene geometry are not inputs.
  - "The model works best with target poses within its training distribution."
  - Motion varies with precision and backend.
  - Kinematic output does not establish "collision avoidance, or safe contact".
  - Known risks: "Pose/contact artifacts, unwanted motion under out-of-distribution constraints".
  - "The fixed SOMA representation does not establish equivalent quality across body proportions or motion categories."
- **Paper §8.1:**
  - "limited coverage of rare motion types (e.g., only one clip for vaulting at 0.5m)".
  - "object interactions are not explicitly modeled".
  - "may generate physically implausible motions (self-collisions)".
  - "Runtime retargeting (used in our UE5 demo) is fast but low-quality; offline retargeting (used for G1) is accurate but requires months of iteration".
- **Paper App. E:**
  - "the dataset currently lacks finger and object motion data".
  - "no samples include continuous terrain information, limiting the model's ability to generate realistic motions on uneven surfaces".
  - Height variations are sparse: "vaulting over a 1m obstacle has only one or two captured clips".
- **Not addressed anywhere NVIDIA writes.** Turn-in-place, very short moves, non-humanoid characters (beyond "Another robot or joint layout requires a matching conversion and model", G1 card) and quality on non-SOMA proportions. See Part C.

**How NVIDIA's own tools choose context, targets and token counts.**

| Tool | Context | Targets | Token counts and timing |
|---|---|---|---|
| `generate_once.py` ([M/docs/examples/generate_once.py#L24-L25](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/examples/generate_once.py#L24-L25)) | Four walk-clip poses ending at 1.0 s | The same clip at 1.8 s, then 3.4 s | Defaults (8–14). Plays the whole result, then uses the last four frames as the next context |
| `locomotion_loop.py` ([M/docs/examples/locomotion_loop.py#L33-L45](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/examples/locomotion_loop.py#L33-L45)) | Recorder at a 60 Hz update rate | Four jog poses re-centred to face +X, scaled to the desired speed (SOMA 1.9 m/s; "A higher G1 speed makes its feet slide"), placed 1 s of travel ahead | Transition Early By 4. Regenerates on a turn of more than 15° or at the transition point |
| Inbetweener ([M/docs/inbetweener.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/inbetweener.md)) | Start = four poses ending at the chosen frame | User-placed poses (1–4 each); height and tilt locked by default | 8–14 default, Transition Early By per target |
| Scene Preview locomotion ([M/docs/scene_preview.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/scene_preview.md#continuous-locomotion), [M/app/runtime/soma/presets.py](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/app/runtime/soma/presets.py)) | Recorder | Target poses blended in a 1D/2D blend space ("not classic animation blend spaces … nothing to synchronize or stretch"), scaled to speed, placed `position_scale` seconds ahead, four poses | Forward mode: Transition Early By 10, tokens 8–14. Regenerates on a mode change, at the transition point, or on an input change past thresholds ([M/app/runtime/common/motion.py#L77-L87](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/app/runtime/common/motion.py#L77-L87)) |
| Scene Preview idle | Recorder | First four poses of an idle clip, placed 1 s ahead | Transition Early By 0, then the clip loops |
| Smart Primitives ([M/docs/smart_primitive_editor.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/smart_primitive_editor.md)) | Recorder | Ordered target-pose sequences around an object. A pivot turns and slides them toward the approach. Only roots move | 6–14 default. Guide targets use Transition Early By > 0. Holds end on a loop clip's first frame with Constrain Root |
| Paper Unreal demo (Paper §6.1, §7.4, App. C, App. G) | Context buffer updated every frame | Locomotion keyframes on a spring-smoothed root path 1.0 s ahead. Interaction keyframes come from "task actors" | Inference "only when new target keyframes are received". Recommended "replanning interval of 3 to 9 frames, combined with instant replanning upon command changes". On a robot: 10 Hz or on a command change |

NVIDIA frames all of these as examples: "The demos show one way to drive the model. Your application decides where the targets come from" ([M/README.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/README.md)). The Smart Primitive Editor "is not a production tool" ([M/docs/smart_primitive_editor.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/smart_primitive_editor.md)).

### A4. Retargeting: what NVIDIA says and ships

- **Model card.** "Other skeletons require an appropriate representation or a retargeting step" ([M/docs/soma_model.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#limitations)).
- **Paper §7.4.** "Since the training skeleton differs from the demo characters, we use UE5's built-in real-time retargeter to retarget motions on the fly". §8.1 calls that path "fast but low-quality".
- **No game-rig retargeter ships.** NVIDIA's [SOMA Retargeter](https://github.com/NVIDIA/soma-retargeter/blob/cbdb2b494a2af82137bf9b6f15122d60167281c4/README.md) "converts human motion in a SOMA-skeleton BVH file into joint animation for a humanoid robot". It covers robots only.
- **Fingers.** The model predicts none. On output, non-model joints keep the skeleton's reference pose (A2 Code), which is the flat T-pose hand of the bundled skeleton.

### A5. Root motion

- The root is `Hips`. Its features are ground position, heading, ground velocity and height ([M/docs/soma_model.md, Input Tensors](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#input-tensors)).
- The paper defines root states as "the projected global position and heading angle of the pelvis joint". In its pipeline, the root module and then the decoder refine the root path "in coordination with full-body details such as footsteps and velocities" (Paper §6.1, Table 1).
- Generated motion is returned in world space through `model_to_runtime`. It therefore carries travel and pelvis motion together on the `Hips` joint. The bundled SOMA skeleton has no separate ground-level root bone; the USD prim path starts at `Hips` ([M/motionbricks/io/utils.py#L15](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/io/utils.py#L15)).
- **Ground.** Model space has "XZ as the ground plane", the hips' absolute height is kept (A2), and training data has no continuous terrain (A3).

### A6. Quality evidence NVIDIA reports

- **Released ONNX models.** "Quantitative motion quality and an FP32-versus-mixed-FP16 quality comparison are not reported." Training measured "tokenizer reconstruction and foot skating", which "do not evaluate the exported ONNX models" ([M/docs/soma_model.md, Evaluation](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/soma_model.md#evaluation-dataset-and-results)).
- **Paper model, Table 3** (350k dataset, in-betweening between random test keyframes):

  | Metric | MotionBricks | Ground truth |
  |---|---|---|
  | Foot skate (m/frame) | 0.003 | 0.0008 |
  | Ground penetration (m) | 0.008 | 0.0009 |
  | Foot contact accuracy vs ground-truth labels | 92.6% | — |
  | Reaching success ("within 5 cms and 15 degrees") | 99.6% | — |

  The paper adds: "More accurate foot prediction will be helpful for postprocessing in downstream applications when necessary" (Paper §7.1–7.2).
- **Continuity.** With endpoint correction on and a context of what was shown, each generation starts exactly at the last shown pose (A2). For holds, the target is "the first frame of the looping clip, [so] the handoff from generated motion to the clip is smooth" ([M/docs/smart_primitive_editor.md, Example: a sitting hold](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/smart_primitive_editor.md#example-a-sitting-hold)).

### A7. Runtime (in-game) generation

**Released models, TensorRT 10.8.0.43** ([M/docs/onnx_inference.md, Inference performance](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/onnx_inference.md#inference-performance)). The measurement conditions are:
- GPU time of the TensorRT plan alone, timed with `trtexec` on a GeForce RTX 4090 under Windows.
- "Input preparation, output decoding, and endpoint correction are not included."
- Inputs were already on the GPU, a CUDA graph replayed each inference, and each batch repeated one real request.
- Each value is the fastest of six plan builds. "Timings vary from one build to the next."

| Model | N=1 | N=8 | N=16 | N=32 |
|---|---|---|---|---|
| SOMA FP32 | 2.50 ms | 2.96 ms | 3.74 ms | 5.28 ms |
| SOMA mixed FP16 | 1.28 ms | 1.54 ms | 1.87 ms | 3.93 ms |

**Paper figures.**
- "2ms latency and 15,000 FPS throughput on a desktop with an RTX 5090 GPU". These numbers are for the paper's model, not the released ONNX.
- On a Jetson Orin, "latency increases to 5ms per inference" (Paper §7.4).

**Integration routes NVIDIA documents.**
- The bundled Python TensorRT engines.
- Direct ONNX in "another inference library", with ONNX Runtime as the worked example ([M/docs/onnx_inference.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/docs/onnx_inference.md)).
- The paper's Unreal demo: "Models are exported via ONNX and loaded in a native C++ plugin using TensorRT" (Paper §7.4). That plugin is not released. Issue [#2](https://github.com/NVlabs/motionbricks/issues/2), "any plans to ship the unreal demo?", had no maintainer reply when read.

NVIDIA does not mention Unreal NNE, Unity Sentis or a fallback for players without NVIDIA GPUs.

### A8. Licensing

The four license layers are listed in [M/README.md, License](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/README.md#license).
- **Code:** Apache 2.0, "including code examples and snippets in the documentation."
- **Docs and media:** CC-BY-4.0.
- **Models (checkpoints and bundled ONNX):** [NVIDIA Open Model Agreement](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-agreement/) (OMA). It "permits commercial use and redistribution of modified models, subject to the agreement's terms." [M/motionbricks/assets/onnx/LICENSE.md](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/assets/onnx/LICENSE.md) carries the notice "Licensed by NVIDIA Corporation under the NVIDIA Open Model Agreement."
- **Sample motions** (38 SOMA BVH and 37 G1 CSV files, Bones RP1-derived): [NVIDIA Sample Data Evaluation License](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/assets/motions/LICENSE.txt). The [notice](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/assets/motions/README.md) lists the files and says it does not cover "model weights, ONNX models, robot assets, rig metadata, Smart Primitive documents, or scene files".
- **TensorRT runtime packages** (`tensorrt-cu12*`) are "governed by the NVIDIA TensorRT Software License Agreement distributed with the packages", not the OSS notice.

**OMA terms relevant to games.** Read 2026-11-20; the page shows "Release Date: April 2, 2026" and "v. March 9, 2026".
- Intro: "Works are commercially usable." "NVIDIA does not claim ownership to any outputs generated using the Works or Derivative Works."
- §2 grants a "perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable license" to reproduce, prepare derivative works, sublicense and distribute. The grant terminates for a party that files patent or copyright litigation alleging the Work or its outputs infringe.
- §3: recipients must get a copy of the license and notices must be retained. Where a NOTICE applies, distributed derivatives carry "Licensed by NVIDIA Corporation under the NVIDIA Open Model Agreement."
- §4: no trademark rights. §7: the licensee indemnifies NVIDIA against third-party claims, including claims over outputs. §10: export compliance.
- The page contains no acceptable-use policy and no output-use restrictions.

**Sample Data Evaluation License terms.**
- §1: use is limited to "internally … solely to evaluate and test NVIDIA technologies". The license also covers "Derivative Works".
- §2(c): "you may not … sell, rent, sublicense, transfer, distribute … the Sample Dataset and Derivative Works".
- §6: NVIDIA "may terminate this Agreement at any time with prior written notice", after which the licensee must "destroy all copies of the Sample Dataset and Derivative Works".

**Code.** The bundled Smart Primitive and locomotion documents sample their target poses from those clips at load time. For example, `locomotion_bs1_linear.smart_primitive.json` references `../../motions/soma/locomotion/...bvh` ([M/assets/smart_primitives/soma/locomotion_bs1_linear.smart_primitive.json](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/assets/smart_primitives/soma/locomotion_bs1_linear.smart_primitive.json)).

**Implications (Inference from the texts above).**
- Shipping the ONNX or weights inside a game is redistribution under the OMA. Include the agreement and the notice.
- Generated animations are outputs. NVIDIA claims no ownership of them, and the OMA puts no restriction on their use.
- The sample BVH/CSV clips, and anything derived from them, cannot ship and are for evaluating NVIDIA technology only. That includes target poses sampled from them and very likely motion generated toward those targets. A shipping project needs its own target poses.
- Redistributing the TensorRT runtime is governed by a separate agreement that this note did not read (C8).

---

## Part B — General animation practice from other first-party sources

### B1. Machines that cannot run MotionBricks

NVIDIA documents no remote or cloud workflow. Part A fixes three facts: the runtime needs an NVIDIA GPU under Windows or Linux; TensorRT plans are built per machine; and no SOMA motion exporter ships. Any machine that meets A1 can therefore generate, and the results must be exported to files that travel to the project. Valid options are the user's own NVIDIA machine, a remote host, a cloud GPU instance, or another person who generates and hands over files. These are options to offer, not defaults.

### B2. Retargeting between a project rig and SOMA

Epic's IK Retargeter docs state these general practices. The page was read at UE 5.9: [IK Rig Animation Retargeting](https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-rig-animation-retargeting-in-unreal-engine).
- **Align rest poses first.** Source and target reference poses can differ, for example an A-pose source and a T-pose target. "Matching these retarget poses increases the accuracy of the retargeting." In the op stack, "Retarget Pose must be the first op in the stack", and Copy Base Pose "aligns the default resting pose of a target character to match the source character" ([Retargeting Operation Stack, UE 5.8](https://dev.epicgames.com/documentation/unreal-engine/retargeting-operation-stack-in-unreal-engine-5-8)).
- **Map by chains, not bones.** Chains "must be defined on both the source and target IK rigs". An arm chain covers "the entire arm chain, no matter the number of bones." Finger chains (thumb to pinky) are standard chain names.
- **Designate the pelvis.** Designate the pelvis "so the character's root motion can be defined and transferred in a proportional way." Pelvis Motion ensures "translation data is scaled properly between characters of different proportions." FK chain ops "run before the IK pass to establish the base pose" (op stack page).
- **Preserve contacts with IK.** Retargeting can be done "while optionally maintaining precise hand or foot contact points using IK". IK goals "stabilize limbs or chains which may not be retargeting with good accuracy". The op stack offers Floor Constraint ("constrains IK goals to the floor"), Stride Warping and Speed Planting.
- **Bone translation (added 2026-11-21).** Retargeters carry rotations and leave other bones' translation at the target's own pose unless asked. The FK Chains op's Translation Mode offers None ("No translation copying occurs, causing bone translations to remain at their reference pose. In most cases this is the best option to choose"), Globally Scaled, Absolute, two Stretch Bone Length modes, and Orient and Scale, which "Transfers local translation or scale animations from the source to the target bone. This provides for stretching animations to retarget faithfully" (op stack page); the Python API gives the chain default as None ([RetargetFKChainSettings](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/RetargetFKChainSettings)). UE4's per-bone translation retargeting had Animation, Skeleton ("Bone Translation comes from the Target Skeleton's bind pose") and AnimationScaled ("scaled by the Skeleton's proportions", "the ratio between the bone length of the Target Skeleton … and the Source Skeleton"), with root and IK bones on Animation, the pelvis on AnimationScaled and "All other bones will use Skeleton" ([Animation Retargeting, UE 4.27](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-retargeting?application_version=4.27)). For Blender, the Auto-Rig Pro add-on's remap uses "only rotation" unless a bone is set as root or its Location box is ticked, "location retargeting in local space (relative to the parent bone)", meant mainly for facial bones ([Remap](https://lucky3d.fr/auto-rig-pro/doc/remap_doc.html)). **Inference:** onto SOMA, keep translation off; the model "uses the SOMA joint layout and proportions" (A2), so a clip that stretches the project rig's bones should arrive on SOMA at SOMA's own lengths.
- **Root motion during retargeting.** Root Motion Source can be "Copy From Source Root … scales it according to relative height difference" or "Generate From Target Pelvis". "Maintain Offset from Pelvis" keeps the target retarget pose's root-to-pelvis offset.
- **Axes, units and frame rate on import (Blender 5.3 manual, [BVH](https://docs.blender.org/manual/en/latest/files/import_export/bvh.html)).** "Scale: Factor to increase the physical size of the BVH." Forward and Up exist "Since many applications use a different axis for pointing upwards … it's common for applications to use Y as the up axis, in that case -Z forward, Y up is needed." "Scale FPS: Scales the frame rate from the BVH file to the scene frame rate."
- **Fingers and other joints MotionBricks lacks (Inference from A2 and A4).** The model returns rest-pose fingers. Hand and finger animation must come from another source and be kept separate from the transferred body chains. Leaving them at SOMA's flat rest pose and retargeting them would carry flat hands into the project.

### B3. Root motion conventions

- **Unreal** ([Root Motion, UE 5.9](https://dev.epicgames.com/documentation/en-us/unreal-engine/root-motion-in-unreal-engine)): root motion is "motion data assigned to the Skeleton's Root Bone". "Animations with a stationary Root Bone will play in place with no actual movement or displacement."
- **Unity** ([How Root Motion works, Unity 6.6](https://docs.unity.com/en-us/engine/current/manual/animation-section/animation-mecanim/avatar-creationand-setup/root-motion)): "The Root Transform is a projection on the Y plane of the Body Transform." Rotation and height can be baked into the pose. With "Feet", "the Root Transform Position Y will match the lowest foot Y for all frames … which prevents floating problem".
- **Inference.** MotionBricks' own root definition (projected pelvis plus heading, A5) matches these conventions. A project that needs a ground-level root bone can derive one from the hips' ground projection and heading. The pelvis keeps the residual weight shift and height. A project that wants in-place clips removes that ground travel instead.

### B4. Quality checks

- Retargeting changes proportions, and Epic scales pelvis translation specifically to avoid sliding (B2). Foot-slide and penetration therefore have to be measured on the **target** rig after retargeting, not only on SOMA.
- Epic's floor constraint assumes a flat floor at Z = 0 (op stack page). That matches the flat-ground assumption in A5.
- **Loops.** Unity's Loop Pose computes "the relative Pose difference between Start and Stop frame" and distributes it "over the range of the clip". MotionBricks' endpoint correction already spreads start and end deltas the same way (A2). A loop can be made by targeting the clip's own first poses. That is an Inference, not an NVIDIA recipe.

### B5. Runtime integration outside TensorRT

- Unreal's Neural Network Engine is "Beta … use caution when shipping with it". It has CPU, GPU and RDG runtime interfaces, imports files "such as `*.onnx`", and warns that "Not all runtimes are available on all platforms" ([NNE overview, UE 5.9](https://dev.epicgames.com/documentation/en-us/unreal-engine/neural-network-engine-overview-in-unreal-engine)).
- **Inference.** Whether MotionBricks' opset-17 graph runs on any given NNE runtime is untested (C6). Since TensorRT needs an NVIDIA GPU (A1), a shipped game that generates at runtime needs a non-generative fallback, such as pre-baked clips, for hardware that cannot run the chosen runtime.

---

## Part C — Open questions

1. **Hardware floor.**
   - Minimum GPU, VRAM, driver and CPU-only speed are undocumented.
   - The README says the demos were tested on Windows and Linux. Both model cards say only Windows.
   - The SM 7.5 floor is derived from TensorRT and Warp, not stated by MotionBricks.
2. **Non-TensorRT equivalence.** NVIDIA says its timed plans "matched ONNX Runtime on the same request" for the timing runs. It does not document SOMA through ONNX Runtime CPU, DirectML, CoreML or NNE end to end, or how far chained results drift on those backends.
3. **Non-SOMA proportions.** How quality degrades when the SOMA skeleton is fed a different body shape (SOMA-X identities) or heavily retargeted poses is not measured ("does not establish equivalent quality across body proportions").
4. **Motions NVIDIA does not address.** Turn-in-place, very small displacements at the 18-frame minimum, very fast moves, and non-humanoid characters.
5. **Height changes.** The engine keeps absolute hip height and the data has no terrain. How the paper's Unreal demo handled falls and landings at other heights beyond "placing the appropriate landing keyframe based on the fall height" (Paper App. G) is not documented. Stairs and slopes are unaddressed.
6. **Shipped integration.** There is no released Unreal or other engine plugin; issue #2 is unanswered. NNE compatibility of the graph is untested.
7. **Variation.** The release uses argmax decoding, so identical inputs give identical motion. The paper's diversity metric (20 runs) implies sampling in research builds. Whether NVIDIA intends variation only through different targets, token counts or context is not stated.
8. **Licensing edges.**
   - The OMA disclaims NVIDIA's ownership of outputs but says nothing about who owns them.
   - Whether motion generated toward targets sampled from the evaluation-only clips is a "Derivative Work" of those clips is not settled by NVIDIA.
   - TensorRT runtime redistribution terms (its SLA) were not read.
   - The training data's (Bones RP1) terms are "governed separately"; their effect, if any, on outputs is not stated.
9. **Contact reliability of the release.** The 92.6% contact accuracy and the skate and penetration numbers are for the paper's model. No figures exist for the released ONNX or for FP16.

---

## Rules any project can rely on

Each rule is backed by Part A or Part B.

1. **Detect, don't assume, the generation host.** The shipped runtime needs an NVIDIA GPU with CUDA on Windows or Linux. It has no macOS wheel, and the floor is compute capability ≥ 7.5 through TensorRT 10.8 (A1). Without one, use a different machine or a different animation route (B1).
2. **Build TensorRT plans on the machine that runs them.** Expect a minutes-long first build per model, precision and batch size. Never copy plans between machines (A1).
3. **Feed the model poses on the SOMA skeleton.** That means SOMA joint names, `Hips` at index 0, SOMA joint frames, meters, Y-up model space or a correct `model_to_runtime`. A renamed project rig is not SOMA (A2).
4. **Retarget between the project rig and SOMA in both directions.** Align rest poses first (SOMA's reference pose is a T-pose), map limbs as chains, designate the pelvis, and keep foot and hand contacts with IK goals (A2, A4, B2).
5. **Supply fingers and any other non-model joints from elsewhere.** MotionBricks returns them at the skeleton's reference pose (A2, A4).
6. **Build each context from the last four poses actually shown,** sampled at 30 Hz and recorded after any IK, physics or clip playback. Anything else makes the character jump (A2).
7. **Choose the target pose count by intent.** One pose stops the character there. Four consecutive 30 Hz poses that begin at the target carry its velocity through (A2).
8. **Use Transition Early By > 0 for guide targets and 0 for exact poses,** contacts and hand-offs into clips. End a generation on a clip's first poses before playing the clip (A2, A3).
9. **Respect the length bounds.** A generation is 18–58 valid frames (0.6–1.9 s). Longer motion is chained. Match the allowed token range to the distance, or fix it with a single count (A2).
10. **Keep endpoint correction on** unless raw predictions are wanted. ONNX callers must trim three boundary frames at each end and apply the correction themselves (A2).
11. **Treat output as flat-ground motion at model-space height zero.** Handle terrain and height changes outside the model (A2, A3, A5, B4).
12. **Hips carry both travel and pelvis motion.** If the engine uses a ground-level root bone, derive it (ground projection plus heading) and leave the residual on the pelvis. For in-place clips, remove that travel instead (A5, B3).
13. **Treat foot contacts as 0–1 confidences.** Choose a threshold, and measure slide and penetration on the final retargeted rig rather than trusting SOMA-side numbers (A2, A6, B4).
14. **Pin and record precision, backend and TF32 settings for reproducible bakes.** Output is deterministic for identical inputs on one backend and precision, but changes across them and drifts through chaining (A2).
15. **Never ship the sample clips or anything derived from them.** That includes bundled Smart Primitive or locomotion targets sampled from them. Ship weights only with the OMA text and notice (A8).
16. **Runtime generation needs a fallback** on hardware that cannot run the chosen inference runtime (A1, B5).

## Setup-dependent choices (ask or detect)

- **Where generation runs:** local NVIDIA machine, remote host, cloud GPU, or another person. Also the OS, GPU model, compute capability, driver and free VRAM and disk on that host.
- **Offline or runtime:** offline baking to files or in-game generation. For runtime: TensorRT, ONNX Runtime, the engine's own ONNX path (for example Unreal NNE) or another runtime, plus the fallback.
- **Inference settings:** precision (FP32 or mixed FP16) and batch size.
- **The project rig:** rest pose (A, T or other), bone naming, up axis, forward axis, units, frame rate, and whether a ground root bone exists.
- **Retarget tool:** the engine's retargeter, a DCC tool, or custom code, and where finger and face animation come from.
- **Export format:** none ships for SOMA (A1). BVH, FBX, glTF or USD depends on the project.
- **Root convention:** root motion versus in-place clips.
- **Ground:** flat ground or terrain and height changes, and how the project corrects for them.
- **Target poses:** the project's own mocap, hand-authored poses or another generator, never the evaluation clips.
- **Acceptance thresholds** for foot slide, penetration and boundary pops. NVIDIA publishes none for the release.
- **Legal review** of TensorRT runtime redistribution and of output ownership, when the result ships.
