# Skeleton profiles and conform

## Why this engine wants a conform step

Unreal plays an animation on any skeletal mesh that shares the animation's skeleton asset: same bone names, same hierarchy. It then places each bone along the animation's own bone direction, scaled to that mesh's bone length. So a character whose rest pose has every joint on the reference skeleton's bone directions, with its own bone lengths, plays the reference's animations with no retargeting, and keeps the foot rig and every bone the game's code reads. A neutral rig (bones laid head to tail along the limbs) does not: it needs a retarget asset per character.

**Conform** makes the first kind from a mesh and a landmark file. It is optional: a project that retargets from any humanoid skeleton imports the neutral rig instead.

## Profiles

A profile is a named target skeleton in the engine facts. The adapter ships one, `mannequin`: Epic's UE5 Mannequin as the third-person template installs it. Nothing assumes it is the only one; a project adds or overrides profiles in `jam.config.json`:

| Where | Field | Meaning |
| --- | --- | --- |
| `engine.facts.skeletons.<id>` | `label`, `notes` | For people |
| | `bones` | Landmark to bone name: `hips`, `spine`, `chest`, `neck`, `head`; per side (`.l`, `.r`) `shoulder`, `upper-arm`, `lower-arm`, `hand`, `upper-leg`, `lower-leg`, `foot`, `toes`; and the optional finger joints `thumb-1` to `pinky-3` |
| | `reference` | Project-relative FBX of a skeletal mesh on that skeleton, exported in step 1 (ignored scratch; the shipped profile leaves it unset) |
| `engine.facts.extra.skeletons.<id>` | `skeleton` | The skeleton asset's id in the engine |
| | `root` | The root bone, which is the armature object's name in an exported file |
| | `physicsAsset` | Assigned to imported meshes unless `--physics-asset` says otherwise |
| | `referenceMesh` | The skeletal mesh exported as the rigging reference and compared against in play |
| | `animations` | `[{label, asset, frames}]` evaluated by the pose check |
| | `referenceAnimations` | Further animations exported for pose renders |
| | `poseBones`, `localBones`, `poseAnchor` | Bones the pose check reports, and the bone positions are compared relative to |
| `engine.facts.extra.defaultSkeleton` | | The profile used when a command is given none and there are several |

The shipped profile maps `spine` to `spine_02` and `chest` to `spine_04`. Conform does not read those two entries (it lays the spine chain out itself), so that choice has not been exercised.

The reference character's proportions matter when gameplay values were tuned on it. Manny at 180 cm: shoulder to wrist 55 cm (0.31 of height), hip to ankle 86 cm (0.47), wrist to middle knuckle 9.5 cm, ankle to ball of foot 17 cm. The jam's first body had arms 19% shorter and hands and feet a quarter shorter; seven gameplay tests failed. Give a character's target limb lengths as shares of its height in the brief.

## Steps

1. **Export the reference once.** `node tools/jam/jam.mjs python jam/engines/unreal/commands/skeleton_reference.py --skeleton <id> --out <ignored scratch folder>` writes the reference mesh and animations as FBX. They are Epic's or the project's content: keep them out of deliveries. Then set `engine.facts.skeletons.<id>.reference` in `jam.config.json` to the mesh's FBX. Done when the receipt lists every export with `"exported": true` and `jam engine facts skeletons.<id>.reference` prints the path.
2. **Have the joints.** Either a landmark file for the mesh, `{"units": "meters", "up": "+Y" | "+Z", "landmarks": {"hips": [x, y, z], "upper-arm.l": [...], ...}, "source": "..."}` (the toolkit's `schemas/landmarks.schema.json`), or a model that arrives rigged with bones named by landmark or by the profile's bone names. In a landmark file, positions are for the character at its real height, standing on the ground, with +X its left; `"up": "+Y"` means glTF's frame (front +Z), `"+Z"` Blender's (front −Y). Any source that writes the file will do: an auto-rig's joints mapped to landmarks, a DCC estimate, a person.
3. **Conform.**
   ```
   jam engine conform-skeleton <model.glb|.blend> [--skeleton <id>] [--out <folder>]
   ```
   The command also takes `--landmarks <file>` (default: `<model stem>.landmarks.json` or `landmarks.json` beside the model, else the model's own rig), `--height-meters <h>` (default: the model is real size), `--fingers auto|5|0`, `--max-influences 4`, `--mesh <object>`, `--reference <fbx>`, `--name <Name>` and `--uv <layer>`; pass them after `--` when the toolkit's command does not name them, or run `commands/conform_skeleton.py` directly.
   It scales the mesh to the height with feet on the ground, places the reference skeleton on the joints, finds finger joints on the hand geometry (`--fingers 5`; `auto` chooses 5 when the joint source has finger joints) or binds each hand to its hand bone alone (`--fingers 0`, mittens), weights the mesh with each vertex limited to the bones of its body region and neighbours, and re-poses the mesh into the reference's rest pose. A mesh that arrives skinned is rebound from scratch. Under `--out` it writes `character-rigged.blend` (bind pose), `character-rig-fit-pose.blend` (as modelled), `rig-report.json`, `vertex-regions.json`, and `engine/<Name>.fbx` with `export-info.json` ([skinned-export.md](skinned-export.md)). The receipt's `model` is that FBX, and a file `<Name>.import.json` beside it tells `jam engine import --kind skinned` which skeleton it is for.
   Done when it exits 0: it stops with an error when the joints do not fit the mesh, when `--fingers 5` finds fewer than four fingers or no thumb, or when a limb is not mainly weighted to its own bones (`rig-report.json`, `deformationCheck`).
4. **Check in the engine before the real import.** Write the DCC's joint positions for each profile animation, one file per label: `node tools/jam/jam.mjs blender jam/engines/unreal/commands/dcc/joint_positions.py -- <character-rigged.blend> <animation.fbx> <frames> <folder>/<label>.json --bones <poseBones, comma-separated>` (Blender frame = engine frame + 1). Then `jam engine check --kind skinned --source <Name>.fbx --name <Name> --skeleton <id> --dcc-joints <folder>`. Done when `problems` is empty: the mesh is on the profile's skeleton, the root bone's scale is 1, and animated joints sit within the tolerance of the DCC's (5 cm by default, `engine.facts.extra.checks.poseToleranceCm`; a few centimetres is the expected size of difference).
5. **In play**, `jam engine check --kind bones-in-game --skeleton <id>` with a character wearing the reference mesh in the level.

## What conform supports

The script supports skeletons with the UE5 Mannequin's bone layout: it names those bones throughout (the five-bone spine, two-bone neck, clavicles, metacarpals and three-joint fingers, `ball` toes, IK bones placed on the joints they mirror). It checks the profile's `bones` table and the reference file against that layout and stops when they differ. A different target skeleton needs its own conform command.

It works on bipeds standing upright in an A-pose with arms away from the body. Lengths inside it are real sizes tuned on one character: a finger needs a free length of 1% of the height to count as separate, and the skull from 3.5 cm above the head joint is rigid.

## What was validated

In the jam (Unreal 5.9, Blender 5.1), the script this was made from rigged humanoid characters to the Mannequin with joint estimates from one provider's auto-rig, and those characters played the Mannequin's animations in the game.

Changed here and not re-run on a real character or in an editor:

- Joint input is the landmark file. The earlier script read one provider's joint names and used its middle spine joint for the body-region labelling; the landmark set has two spine landmarks, so the middle one is now their midpoint.
- One mesh only. The branches for a separate head mesh (neck seam weights copied from the body) and a separate hair mesh (rigid on the head) are gone.
- Input may be a GLB, and a mesh that arrives skinned, parented or transformed has that baked in and its old rig dropped. Height, fingers, influences and the mesh's name are arguments, each with a default (real size, `auto`, 4, the only mesh).
- Joints can be read from the rig the model arrives with instead of a landmark file. This path is new.
- The reference file and profile table are checked against the supported layout before fitting.

What was run here, in Blender 5.1.2, on a synthetic figure of primitives with a synthetic reference skeleton carrying the Mannequin's bone names:

- GLB and `.blend` input with a landmark file and mittens: to the end, deformation check passing, FBX written.
- `--fingers 5`: to its "no separate fingers" refusal (the figure has none), so finger detection beyond that point did not run.
- Joints read from a rigged GLB (the previous output, exported): through joint reading, body regions, fitting and weighting, then stopped by the deformation check (thighs 39% of vertices mainly on other bones, 25% allowed). That path has not completed on any input.

That shows the refactor executes; it shows nothing about deformation quality on a real character, and nothing about the engine.
