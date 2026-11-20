# The files

Read this when writing or reading these files with another tool, or when a check names a field. All JSON is UTF-8; transforms are `[px, py, pz, qx, qy, qz, qw]` (position in metres, then a unit quaternion in MotionBricks' x, y, z, w order).

## Space

Every pose is in **SOMA model space**: metres, +Y up, the ground on XZ at Y = 0, the character in its reference pose facing +Z with +X its own left. That is also the glTF frame, so the `.glb` files need no conversion. `generate.py` runs the engine with the identity model-to-runtime transform, so poses go in and come out in this space.

## `soma-skeleton.json` (from `generate.py skeleton`)

| Field | Content |
| --- | --- |
| `format` | `jam-3d-motionbricks/skeleton@1` |
| `source` | MotionBricks version, clone commit, the USD file it was read from and its SHA-256 |
| `joints`, `parents` | Joint names and parent indices (`-1` for the root, `Hips`, at index 0), in MotionBricks' order |
| `reference` | Reference local transform per joint: the USD rest pose, which MotionBricks uses as the skeleton's reference pose |
| `modelJoints` | The 30 joints the model reads and predicts (the model's contract) |
| `footContactJoints` | The joints of the four contact columns: `LeftFoot`, `LeftToeBase`, `RightFoot`, `RightToeBase` |

## How poses cross rigs

`pack.py` and `unpack.py` move a pose between a glTF rig and SOMA as world-space rotations relative to each rig's own rest pose, plus the root's position. A DCC that re-orients bones on import therefore changes nothing, provided the rig's rest pose has SOMA's joint positions (checked within `--rest-tolerance`). Non-root joints take SOMA's reference translations, as the engine's decoder does. A joint the rig lacks keeps its reference rotation relative to its parent.

## `request.json` (from `pack.py`)

| Field | Content |
| --- | --- |
| `format`, `fps` | `jam-3d-motionbricks/request@1`, `30` |
| `model` | `name`, `motionbricksVersion` (the release it was packed for; `generate.py` refuses another), optional `onnxSha256` (pins the exact model file) |
| `inference` | `precision` (`fp32` or `fp16`), `backend` (`tensorrt`), `tf32` (`null` for the model's default, or `true`/`false`) |
| `settings` | `correctEndpoints` (endpoint correction), `tokens` (`{"min", "max"}`, 6 to 16; default 8 to 14) |
| `joints` | Joint names, `Hips` first; every pose has one transform per joint in this order. Joints of the skeleton missing here take the reference pose; model joints may not be missing |
| `context.poses` | Exactly four poses at 30 Hz, the last being where the motion starts |
| `targets[]` | In order: `poses` (1 to 4 at 30 Hz, the first being the pose to reach), `transitionEarlyBy` (0 to 20), `tokens` (`null` for `settings.tokens`, or `{"min", "max"}`) |
| `sources` | Each input file with its role, SHA-256, animation and sampled times, for the record |

## `result.json` (from `generate.py run`)

| Field | Content |
| --- | --- |
| `format`, `fps`, `space` | `jam-3d-motionbricks/result@1`, `30` |
| `request` | The request's file name and SHA-256 |
| `model` | Name, MotionBricks version, clone commit, ONNX file and its SHA-256 |
| `inference` | Backend, precision, TF32 setting, TensorRT and Warp versions, GPU and its architecture, OS, whether this run built the plan, endpoint correction |
| `joints` | The skeleton's joints in MotionBricks' order |
| `frames` | Every played pose, one local transform per joint; frame 0 is the last context pose |
| `root` | The root (`Hips`) transform per frame, world space |
| `contacts` | `joints` (the four contact joints) and `values`: per frame, four confidences from 0 to 1, clamped as the engine does |
| `segments[]` | Per target: `generatedFrames` (valid frames of that generation), `tokens`, `playedFrames`, `transitionEarlyBy`, `allowedTokens`, stage timings in milliseconds |

**Chaining**, as MotionBricks' Inbetweener does it: each generation starts at the last context pose and ends at the first target pose. It plays to its transition point, `max(4, generatedFrames − transitionEarlyBy)` frames, and the last four played frames become the next context. Generations after the first drop their first frame, which repeats the frame before, so `frames` holds `Σ playedFrames − (targets − 1)` poses. With Transition Early By above 0 the clip leaves that target before reaching it, by design; for the last target that means the clip ends short of it.

## `contacts.json` and `unpack-report.json` (from `unpack.py`)

`contacts.json` (`jam-3d-motionbricks/contacts@1`) copies the result's contact columns and values per frame of `generated.glb`, with the result's hash. `unpack-report.json` gives frames and seconds, the segments, the root's start, end, ground travel, path length and height range, `frameSteps` (the largest one-frame move of any joint, overall and at each seam between generations, with frame and joint), the lowest foot joint against SOMA's standing reference (`floorOffset`), and the model and inference records from the result.
