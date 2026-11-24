---
name: jam-engine-godot
description: Godot 4 adapter for the jam toolkit, read without the editor. It supplies Godot's engine facts, a content inventory of scenes, resources, imported files and scripts with their uids, import settings and references, catalog previews (imported images, WAV sounds, GLB models, and SpriteFrames animations as sprite sheets), reference lookup, and by-hand guides for import and inspection. Use when a Godot project uses the jam skills and needs this adapter installed or updated, or when its catalog should show the project's Godot content.
---

# Godot adapter

This skill ships the adapter folder `adapter/` (`adapter.json`, `commands/`, `docs/`). Once installed, asset skills use it only through `jam engine`; the `jam-engine` skill describes those commands and the contract. Its facts are those of the toolkit's `godot` preset; installing it adds the commands below.

## Requirements

- The jam toolkit installed in the project (`tools/jam/jam.mjs`; the `jam-setup` skill installs it). Its Node runs the commands.
- Optional: ffmpeg, to show Ogg Theora videos (`.ogv`) in the catalog; without it they are listed with no preview.
- A Godot 4 project whose scenes and resources are saved as text (`.tscn`, `.tres`), as Godot saves them by default. No Godot editor is needed on the machine.

## Install

1. From the project root: `node tools/jam/jam.mjs engine install <absolute path of this skill's adapter folder>`. It copies the folder to `jam/engines/godot/` and selects it in `jam.config.json`. Run it again after this skill is updated. Done when `node tools/jam/jam.mjs engine show` names `godot` with source `project` and lists `inventory`, `previews` and `references`.
2. When `project.godot` is not in the project root, set `engine.facts.assetId` in `jam.config.json` to `{ "scheme": "res://{path}", "from": "<folder holding project.godot>/{path}" }`. Done when `node tools/jam/jam.mjs engine inventory` prints a receipt with `unread` 0, or only files `jam engine docs inventory` explains.

## What is in it

| Need | Use | Guidance (`jam engine docs <topic>`) |
| --- | --- | --- |
| Everything the Godot project holds: classes, uids, import settings, image and sound sizes, scene root types and groups, SpriteFrames animations, references | `jam engine inventory` | `inventory` |
| Something to look at for each file in the catalog | `jam engine previews` | `previews` |
| What a file uses and what uses it | `jam engine references <res:// or uid:// id>...` | `inventory` |
| Put delivered files in the engine | no command: by hand | `import` |
| What the engine made of an asset | no command: by hand | `inspect` |

`capture`, `check` and `conform-skeleton` have no command and no guide; do them in the editor and record the step with evidence (`jam-engine`, "When the adapter has no command").

## What is validated

The commands were run against a 2D Godot 4.7 project of about 2,400 files: every file read, all 57 SpriteFrames made into sheets the catalog accepts. They have unit tests with small Godot projects built in temporary folders: `node --test <this skill>/adapter/commands/test/*.test.mjs`.
