# Skeleton profiles

A **skeleton profile** names a target skeleton as data, so one bind script can build any of them. Without a profile `bind.py` builds the **landmark skeleton**: one bone per landmark, named by the landmark, hanging as the landmarks do ([landmarks.md](landmarks.md)). With a profile it builds the profile's bones, with its names and its hierarchy, on the same landmarks.

Use a profile when something downstream reads bone names or needs a particular bone count: a humanoid avatar format, a studio's animation library, an engine's retargeting setup that maps bones by name. Use the landmark skeleton when nothing does.

## Shape

```json
{
  "label": "what skeleton this is",
  "bones": { "<landmark>": "<bone name>" },
  "hierarchy": { "<bone name>": "<parent bone name>", "<root bone name>": null },
  "notes": "anything a person should know"
}
```

- **`bones`** says which bone stands at each landmark. Leave out a landmark the skeleton has no bone for (no toes, no collarbones); that part of the mesh then follows the bones around it and the report says so. `hips` is required.
- **`hierarchy`** is optional. Without it the bones hang as the landmarks do, skipping the ones left out. With it, every bone named in `bones` must appear, and it may list bones that stand at no landmark:

| A bone that stands at no landmark and is | Is placed | Deforms the mesh |
| --- | --- | --- |
| between two landmark bones (extra spine or neck joints, a metacarpal) | evenly on the line between them; where the chain branches, on the way to the landmark the bone above points at (`chest` leads to `neck`, `hand` to `middle-1`) | yes, like any other |
| above the hips (a root) | at the origin, on the ground | no |
| anything else (twist, IK, attachment bones) | at its parent | no |

This is how a profile gives a different spine bone count than the landmarks: map `spine` and `chest` to two of its spine bones and let `hierarchy` name the rest.

The schema is `SkeletonProfile` in `tools/jam/schemas/engine-adapter.schema.json`. A profile lives in one of three places, and `bind.py` reads each directly:

| Where | Pass |
| --- | --- |
| A file of its own, like the example below | `--profile <file>` |
| The project's `jam.config.json` under `skeletons.<id>` (a target no engine adapter describes), or `engine.facts.skeletons.<id>` (the project's version of an engine's) | `--profile jam.config.json --profile-id <id>` |
| The engine adapter, `facts.skeletons.<id>` | `--profile jam/engines/<adapter>/adapter.json --profile-id <id>` |

A budget names the profile a kind of asset uses (`budgets.<name>.skeleton`); `node tools/jam/jam.mjs engine facts skeletons` prints the ones in force.

## What a profile does not say

- **Bone axes.** glTF joints carry a rest rotation and no convention for it. `bind.py --bone-axes along` (default) points each bone's Y axis at its child with Z toward the character's front (toward up for a bone that itself points front or back), which is how a DCC shows bones. `--bone-axes world` gives every joint the world's axes at rest, so every rest rotation in the file is identity; some avatar formats and retargeters expect that. Skin weights are the same either way.
- **A rest pose.** The skeleton stands in the pose the mesh was modelled in. Reworking a rig into one engine skeleton's exact rest pose, so that engine's animations play without retargeting, is the engine adapter's `conform-skeleton` command.
- **Where extra bones go**, beyond the rules above. A skeleton whose helper bones need exact positions needs that conform step or hand placement.

## Worked example: the VRM humanoid

[`assets/profiles/vrm-humanoid.json`](../assets/profiles/vrm-humanoid.json) builds a skeleton with the bone names and parents of the VRM 1.0 humanoid, taken from the "List of humanoid bones" in the VRM specification (`VRMC_vrm-1.0/humanoid.md`, <https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md>, read 2026-11-16).

How it was written, which is how to write any profile:

1. **List the target's bones and parents** from its authoritative source. VRM's table gives each humanoid bone its parent: `spine` under `hips`, `chest` under `spine`, `upperChest` under `chest`, `neck` and both shoulders under `upperChest`, and so on. Those pairs are `hierarchy`. The optional eyes and jaw are left out: nothing places them.
2. **Map each landmark to the bone at the same joint.** Most are direct (`upper-arm.l` is `leftUpperArm`, `toes.r` is `rightToes`, `pinky-1.l` is `leftLittleProximal`, `thumb-1.l` is `leftThumbMetacarpal`).
3. **Decide the joints that do not line up.** The landmark `chest` is where the neck and collarbones attach; in VRM that bone is `upperChest`. VRM's `chest` then stands at no landmark and, being between `spine` and `upperChest` in `hierarchy`, is placed halfway between them. The result has three bones between hips and neck where the landmark skeleton has two.
4. **Check it.** `python3 -m pytest <S>/test_jamrig.py` loads the shipped profile and builds its skeleton; for your own, bind a mesh with it and read `skeleton.bones` in `rig-report.json`: every bone, its parent, the landmark it stands at and how it was placed.

A model bound with this profile is a skinned glTF file whose joints carry VRM's humanoid names. It becomes a VRM file only when a VRM exporter adds the `VRMC_vrm` extension with its `humanBones` table, expressions and metadata; that step is outside this skill and untested here.
