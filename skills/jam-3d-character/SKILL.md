---
name: jam-3d-character
description: Make a rigged, animatable game character for an Unreal Engine 5 project on Epic's UE5 Mannequin skeleton (SK_Mannequin), on top of jam-3d, as one textured mesh with optional swappable parts and outfits. Use for a new player or NPC character, splitting a character into swappable head, hair and hands, an outfit, hat or other wearable for an existing character, or importing any of them into Unreal.
---

# Rigged characters

The job is one **character**: a generated mesh, quad-remeshed, unwrapped, textured and rigged to Epic's `SK_Mannequin` bone names with the character's own bone lengths, so it plays the Mannequin's animations without retargeting. By default it is one mesh. Two optional branches build on it: **swappable parts** (head, hair, body and hands as separate meshes) and **outfits** fitted to an existing character.

`jam-3d`, its stage skills and `tools/jam/docs/contracts.md` govern briefs, paid jobs, records and reviews; this skill adds what a character that animates needs. When `tools/jam/jam.mjs` is missing from the project, use the `jam-setup` skill first (when it is not installed: `npx skills add rafaelvidaurre/furanku-skills --skill jam-setup`).

Everything the scripts know about a character comes from its **`character.json`** ([character-spec.md](references/character-spec.md)): name, height, part names, colour classes, hands. The scripts ship in this skill's `scripts/` folder; `<S>` stands for that folder's absolute path and `<W>` for the run folder. Every command runs from the project root through the jam CLI, `node tools/jam/jam.mjs blender <script> -- <args>` (headless Blender) or `node tools/jam/jam.mjs python <script> <args>`, which pick Blender and Python from `jam.local.json` or PATH and pass the arguments without a shell: the same line works in PowerShell, cmd and POSIX shells. Fill in the placeholders and wrap any path that contains spaces in double quotes. [scripts.md](references/scripts.md) lists what each script reads, writes and assumes.

## Choose the branch

- **A new character** (player, NPC, creature on the Mannequin skeleton): follow [body.md](references/body.md); `<S>/character.py run` drives its local stages and stops at each review gate. Its decisions (proportions, hands, parts, physics) are settled in its `character.json` before any image is made.
- **Swappable parts** for a character whose head, hair or hands must be shared or swapped: the swappable-parts section of [body.md](references/body.md#swappable-parts), chosen at the start because it adds steps.
- **An outfit, hat or other wearable** for an existing character: follow [outfit.md](references/outfit.md), which needs that character's delivery and `character.json`.
- **A script change** only: [scripts.md](references/scripts.md).

## Rules for every branch

- **One asset at a time, end to end.** Finish and deliver one before starting the next.
- **Reviews follow the run's policy.** After each stage, `node tools/jam/jam.mjs status --run <run.json>` names the reviewer. A human review is a catalog submission (`node tools/jam/jam.mjs catalog run review.submit`) served with `node tools/jam/jam.mjs catalog serve --detach`; give the person its printed review URL with the key images through the environment's question or notification surface, read verdicts from the catalog too (`reviews.list`), and transcribe each decision into the run (`node tools/jam/jam.mjs review`) and the catalog (`review.decide`). An agent review follows `tools/jam/docs/review.md`.
- **Look at what the reviewer will open, where they will open it.** Inspect every image and model you submit in the viewer they will use: the catalog's 3D viewer shows the GLB, and a GLB maps textures through its first UV set. Check close-ups of every border, seam and joint, in Blender and in Unreal. Submit only work you find no fault in, and name the limits that remain.
- **Fit position and scale first, local edits after.** Whenever something is put onto the character, first move, turn and scale it as a whole (or per limb), then push individual vertices. Broken generations (fused fingers, holes, scrambled textures) are a separate repair, not fitting.
- **Open shells render both sides.** Hair, hats and any piece seen from inside get two-sided materials, or the sky shows through from below.
- **Custody.** Work in `Art/.scratch/<asset>/<run>/`. Deliver to a new `Art/Assets/<asset>/<revision>/` with `character.json` at its root: copy every input into it before its first record, write `README.md` and `origin.md` before registering, and leave an accepted revision untouched; a correction is the next revision folder. Any edit to a file a record cites makes that record and every later one stale.
- **One decision, recorded in order.** A later stage registers only after the earlier one is accepted. When one answer covers several stages, submit them as one review and record the answer against each stage in turn.

## Engine and game

Import and check in Unreal before the delivery review: `<S>/unreal/import_1_textures.py` to `import_4_save.py` for a character, `import_outfit.py` for an outfit, each through the editor's Python tool after setting its CONFIG block (the delivery folder; the rest comes from `character.json`; [scripts.md](references/scripts.md#unreal-scripts-sunreal)). Follow the project's own Unreal editor guidance when it has one. Then:

1. Confirm every mesh's skeleton is `SK_Mannequin` in the import result, and that no `.uasset` holds an absolute machine path (run `strings` over each new `.uasset`).
2. Run the project's engine tests. With parts or outfits, every piece worn together must share the character's reference skeleton: add or run a test that checks it.
3. Capture the head, hands and every border in the editor with the project's capture tooling (or the editor's `CaptureAssetImage`), framed from 25 cm or more: the near clip cuts closer geometry into holes that look like broken meshes.
4. Play it: idle, walk, crouch and any other pose the game uses, and look at the frames.

**Done:** the delivery passes `node tools/jam/jam.mjs check-delivery --run <run.json>`, its reviews are recorded under the run's policy, its game assets are imported and tested, and every provider job is reconciled.
