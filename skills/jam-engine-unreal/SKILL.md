---
name: jam-engine-unreal
description: Unreal Engine adapter for the jam toolkit. It supplies engine facts, import of static meshes, one skinned mesh on a reference skeleton, animation clips onto a skeleton already in the project, textures and sounds, a content inventory read without the editor, inspection, reference lookup, collision authoring and fitting, conforming a rig to the UE5 Mannequin, and Unreal acceptance guidance. Use when an Unreal project uses the jam skills and needs this adapter installed, configured to reach its editor, or updated, or when a jam step in that project imports, inspects, checks or deletes engine assets.
---

# Unreal adapter

This skill ships the adapter folder `adapter/` (`adapter.json`, `commands/`, `docs/`). Once installed, asset skills use it only through `jam engine`; the `jam-engine` skill describes those commands and the contract.

## Install

1. From the project root: `node tools/jam/jam.mjs engine install <absolute path of this skill's adapter folder>`. It copies the folder to `jam/engines/unreal/` and selects it in `jam.config.json`. Run it again after this skill is updated. Done when `node tools/jam/jam.mjs engine show` names `unreal` with source `project`.
2. Tell it how this machine reaches the editor: read `jam/engines/unreal/docs/transport.md` and set `engine` in `jam.local.json`. Without it, commands prepare their editor scripts and hand them to you to run. Done when `node tools/jam/jam.mjs engine inspect <any existing /Game asset id>` prints a receipt, or a handoff you can complete.
3. Set the project's own values in `jam.config.json` under `engine.facts`: content folders (`extra.destinations`), any fact that differs (the skeletal-mesh name prefix, the audio sample rate), and the skeleton profile's asset paths when the reference content is not where Epic's third-person template puts it (`jam/engines/unreal/docs/skeletons.md`). Done when `node tools/jam/jam.mjs engine facts` shows them.

## What is in it

| Need | Use | Guidance (`jam engine docs <topic>`) |
| --- | --- | --- |
| Import a static mesh, textures, a skinned mesh, an animation clip, sounds, a random-variant sound source | `jam engine import --kind static\|textures\|skinned\|animation\|audio\|audio-variants` | `import`, `audio` |
| What the engine made of an asset | `jam engine inspect <id>` | `acceptance` |
| Every package under `/Game` and content plugins: classes, engine tags, references, property values of the classes the project lists | `jam engine inventory [--engine]` | `inventory` |
| What refers to an asset; delete it safely | `jam engine references <id>... [--delete]` | `locking` |
| Stored sources, skinned import and pose, bones in play, collision coverage, inventory against the editor | `jam engine check --kind sources\|skinned\|bones-in-game\|collision\|inventory` | `acceptance`, `collision`, `inventory` |
| Rework a character model onto the Mannequin's exact skeleton | `jam engine conform-skeleton <model>` | `skeletons`, `skinned-export` |
| Collision hulls before import; fit collision in the editor | scripts under `jam/engines/unreal/commands/` | `collision` |
| See something in the engine | no command: the project's own capture tooling | `cheap-looks` |

A command the toolkit does not route yet runs directly: `node tools/jam/jam.mjs python jam/engines/unreal/commands/<script>.py <arguments>`; each script's header lists its arguments.

## What is validated

Except the inventory, the previews and the animation import, nothing in the adapter was run in an Unreal editor after it was generalized. `jam engine docs validation` lists, per script, what ran in the game jam it came from, what was changed since, and the two scripts that are new and have never run (`import --kind static`, `inspect`). Treat the first run of each command in a project as its test: use a throwaway asset and compare the result with that page.

The engine-free code has unit tests: `python3 -m pytest <this skill>/adapter/commands/test`.
