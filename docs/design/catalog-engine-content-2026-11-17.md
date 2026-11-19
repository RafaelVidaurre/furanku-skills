# Catalog content from the engine: design

Date: 2026-11-17. Tracking: `furanku-skills-z3t`. Research: [unreal-content-inventory-2026-11-17.md](../research/unreal-content-inventory-2026-11-17.md).

## 1. Goal

A project is the source of truth for its catalog. A brownfield project gets its catalog from what it already contains: the assets in its engine, their types and engine attributes, what refers to what, and the source files they came from. Nothing has to be declared by hand to be visible.

The toolkit reads the engine. Each project adds what only it knows through catalog plugins:

- game semantics, such as archetypes (Weapon, Consumable) built from inheritance, components or data;
- data outside the engine, such as server definitions or loot tables;
- relations the engine cannot see;
- how its content is shown.

The toolkit makes that integration possible and documents how an agent works out what a project needs. It does not take sides on how a project makes its assets: hand-made, imported by script, or generated. Anything a game client uses ends up in the engine, so reading the engine works for all three.

Previews made by the engine are §3.5. Promoting files into the engine is the catalog action `engine.import` (§6).

**Catalog names.** The catalog side is written against the names the catalog API overhaul fixed (`docs/design/catalog-api-decisions-2026-11-17.md` on branch `catalog-api-overhaul`, `furanku-skills-drr.18`). These include configuration version 3 with options inside the plugin entry, `<plugin>.<operation>` action names, `access`, `ProblemInput.subject`, `browserModules`, `inspectors`, and the default scopes `main` and `material`. The catalog plugin (`z3t.4`) is built once Phase D of that work lands. The engine side (§3.1, §4) does not depend on it and is built now.

## 2. Principles

1. **The engine adapter is the only code that knows the engine.** The catalog reads an engine-neutral inventory, and `test/jam-neutrality.test.js` keeps engine names in adapters.
2. **Read files before starting the engine.** An adapter reads the engine's own files wherever their format allows, and starts the engine only for what files cannot give. No page load starts the engine.
3. **Only changed files are read.** Every file entry carries the size and mtime it was read at. A refresh re-reads exactly the files whose size or mtime changed, plus new ones, and drops deleted ones.
4. **Honest gaps.** A file the adapter could not read stays in the inventory with the reason, and is never presented as empty or current.
5. **Projects extend, never fork.** Semantics, extra sources, relations and views are plugin code in the project (`jam/catalog/`). The installed toolkit is not edited.
6. **Generic before bespoke.** Views that fit many games may ship with the toolkit, as opt-in browser modules. Nothing game-specific ships.

## 3. Shape

```
engine content files ──(adapter `inventory`: reads files; engine only as fallback)──> inventory JSON
                                                                                          │
catalog: built-in `engine` plugin ── units per engine file, uses/used-by relations, engine facts
         project plugins ─────────── enrich (archetypes, names), own sources (server data),
                                     relations, inspectors and panels, actions
```

### 3.1 The inventory (engine-neutral contract)

**Command.** `inventory` joins the standard adapter commands (`import`, `inspect`, `references`, `capture`, `check`, `conform-skeleton`). The toolkit runs it as `jam engine inventory [--out <file>] [--full] [--engine]`:

- `--out` names the inventory file. The default is `<roots.scratch>/.engine/inventory.json`, which is Git-ignored and machine-local. The catalog plugin uses the same file, so the command line and the catalog share one inventory.
- The toolkit hands the adapter `--out <file>`, plus `--previous <file>` when that file exists and `--full` was not given. The adapter reuses every entry of the previous inventory whose size and mtime still match.
- `--engine` lets the adapter start the engine for what files cannot give: files it cannot read itself, and effective property values (§3.3). Without it, unread files are listed with their reason and no engine starts.
- The adapter writes the inventory atomically, then prints a receipt:

```json
{ "inventory": "<project path>", "files": 4108, "assets": 4109, "read": 3, "reused": 4105, "removed": 0, "unread": 0 }
```

The toolkit validates the written file against `schemas/engine-inventory.schema.json` before printing the receipt. An adapter without `inventory` gets the usual `manual` outcome with its guide.

**File** (`EngineInventory`, format 1):

```json
{
  "format": 1,
  "adapter": "unreal",
  "generatedAt": "2026-11-17T12:00:00Z",
  "roots": [{ "id": "/Game", "path": "Content" }],
  "files": {
    "Content/Props/SM_Crate.uasset": {
      "id": "/Game/Props/SM_Crate",
      "size": 70049, "mtimeMs": 1794917000000, "hash": "<engine content hash, when the format has one>",
      "saved": "<engine version that wrote it>",
      "main": "/Game/Props/SM_Crate.SM_Crate",
      "assets": [{ "id": "/Game/Props/SM_Crate.SM_Crate", "class": "/Script/Engine.StaticMesh", "tags": { "Triangles": "12" } }],
      "references": [{ "to": "/Game/Props/MI_Crate", "kind": "hard" }, { "to": "/Script/Engine", "kind": "native" }],
      "names": [{ "on": "/Script/GameplayTags", "values": ["Item.Weapon.Sword"] }]
    },
    "Content/Old/T_Legacy.uasset": { "id": "/Game/Old/T_Legacy", "size": 1, "mtimeMs": 1, "unread": "package version 1009 is not one this reader knows; run with --engine" }
  }
}
```

- **Keys are project-relative paths.** `id` is the engine's own id for the file, which other files reference. `main` is the asset that stands for the file, if it has one.
- **`references[].kind`:**
  - `hard`: needed to load the file;
  - `soft`: named by path, loaded on demand;
  - `native`: a code module;
  - `build`: needed only to build the file;
  - `editorOnly: true` marks references the game does not need.
- **No duplicates.** A target appears once per file, with its strongest kind (hard over soft).
- **`names`** holds searchable names, such as gameplay tags, under what they name.
- **`unread`** marks a file the adapter could not read, with the reason. Such an entry has no assets or references.

The catalog depends only on this shape. An adapter for another engine fills the same fields from its own files: Godot `res://` paths and `.import` files, Unity GUIDs and `.meta` files.

### 3.2 The catalog `engine` plugin (built-in, like `jam`)

Configured as a `plugins` entry: `{ "plugin": "engine", "options": { … } }`.

- **Source.**
  - On load, the plugin runs `jam engine inventory`. With the reader that costs one size-and-date pass plus the changed files, so the catalog is never more than one load behind the files. The source's inputs are the inventory file and the content roots, so the catalog reloads it when an engine file changes.
  - Each readable file becomes one unit, with id `engine:<file id>`, among the project's source material (scope `material`). There is no section per origin: provenance is attributes and relations. A project moves the archetypes people look for (weapons, outfits) into `main` with `enrich`, and content defined elsewhere (server data) is its own units in `main`, related to the engine units made from it. Without the `engine` plugin nothing changes, and a project without an engine never lists it.
  - The unit's type comes from its main asset's class, through `options.types` (`{ "<class>": { "type": "<unit type>", "label": "…" } }`). Classes not mapped get a type named after the class.
  - Engine tags become derived fields: shown, filterable when the project marks them, and never review evidence.
- **Relations.** `uses` (inverse label "used by") from `hard` and `soft` references between files in the inventory. `native` references become a `module` field. References outside the inventory, such as engine content, are listed as text, not as relations.
- **Media.** The plugin links a unit's source file when the file is inside the catalog's asset roots:
  - Unreal records the source in an `AssetImportData` tag, as a path and an MD5. The plugin links the path when that file exists. With the option `matchSourcesByMd5`, it also finds a moved source by its MD5 among the media under the asset roots; the hashes are cached per file version in `.catalog/.local/engine/md5.json`.
  - A GLB source becomes the unit's `model`, and an image its `image`, so engine assets show what they were made from.
  - Engine previews, made by `jam engine previews`, are the unit's `preview` role and its thumbnail (§3.5).
- **Problems** (with `subject` the file):
  - each `unread` file, with the fix `jam engine inventory --engine`;
  - an adapter without `inventory`, with the fix of installing a full adapter;
  - a failed run, with the adapter's message.

  The rest of the catalog keeps working.
- **Action** `engine.refresh` (`access: "read"`, so no actor; it writes only the machine-local inventory). Input: `{ "full": boolean, "engine": boolean }`.
- **Options:** `types`, `exclude` (project path patterns), `filter` (metadata keys offered as search filters), `scope` (default `material`). The table is in `docs/catalog-integration.md`.

**Built (2026-11-18)** in `src/jam/catalog/engine.ts`, registered beside `jam` in `src/cli/compose.ts`. The engine host loads the first time the catalog asks for the inventory, so a catalog without `engine` loads nothing behind it.

On the real projects, through wrappers in `/tmp` that link to them:

| Project | Units | Catalog call (`summary`, inventory reused) |
| --- | --- | --- |
| Project A | 4,108 | 0.7–0.85 s |
| Project B | 1,198 | 0.45 s |

- **Source files are linked only when they exist.** Both projects import from temporary folders: project A from `Intermediate/`, project B from `Saved/`. Those files are often gone, so a source file is linked only when it is in the checkout, and its stored path and MD5 stay as attributes.
- **The guide's example works on project B.** A three-line `enrich` turned its 19 `Outfit` assets into "Outfit" units. Each outfit uses its character's meshes and physics asset.

### 3.3 Field values (designer data)

Two routes, both later than §3.1–3.2:

- **From files** (`z3t.11`): exported property values, parsed as UE-Agent-Asset-Toolkit does. They give the values a file sets itself, and which property holds each reference.
- **From the engine** (`z3t.5`): effective values, including inherited and native defaults, for classes the project lists.

Both land in the inventory as `files[].assets[].fields`. A project lists what it wants:

```json
"fields": [{ "class": "/Script/MyGame.ItemDefinition", "properties": ["DisplayName", "Weight", "Icon", "Components"] }]
```

Object references in fields become relations, and instanced components are listed by class. That lets a project classify archetypes by composition: has a Stackable component → stackable; has a Weapon component → Weapon.

**Built from files (2026-11-18, `z3t.11`, `z3t.12`–`z3t.15`).** The list lives in `jam.config.json` at `engine.facts.extra.inventory.fields`. The Unreal reader (`jam_unreal/fields.py`, `packages.py`) decodes the tagged properties of each selected export; other files are not read past their header.
- **Selection** (`hierarchy.py`): a listed class selects its subclasses too.
  - The parents come from Blueprint `ParentClass` tags across the inventory, from `UCLASS` declarations in the project's C++ headers, and from parents an engine run learned (kept as the inventory's `parents`).
  - An object of a selected class gets its own values. A Blueprint whose generated class is selected gets that class's defaults.
  - Without an engine run, an engine class's own parents are unknown (`Character -> Pawn -> Actor`).
- **Values:** what the file sets, `fieldsSource: "file"`. These are deltas against the class default or template, so a property left at its default is absent.
- **Components** (`assets[].components`, each `{name, class, path, fields}`):
  - an actor Blueprint's construction-script components, its native components (named by the property that holds them), and the inherited ones it changes (`from` the declaring class);
  - its Blueprint parents' components, marked `inherited`;
  - for any other asset, its instanced subobjects.
- **References:**
  - an object reference is `{object, class}` and a soft reference is `{soft}`, each an engine id;
  - `assets[].fieldReferences` (and each component's) lists each one with the property path that holds it (`Parts[0]`), so the catalog can label relations by property.
- **Gaps:**
  - a value it cannot decode is `{unparsed: <type>}`;
  - a broken export, or a subobject whose class serializes itself without tags, gives `fieldsError` and keeps the header data.
- **Reuse:** the inventory records a hash of the expanded list (`fieldsConfig`). Changing it reads again only the files that had fields or hold a selected asset.
- **Decoded:** every scalar, string, name, enum and reference property; texts with every history but generated ones; delegates and field paths; tagged structs, arrays, sets, maps and optionals; instanced structs; the common native structs (vectors, rotators, quats, colors, GUIDs, int points, boxes, soft paths, gameplay tag containers, per-platform values, pin types, material inputs, frame ranges); and native structs whose serializer writes tags. Curves and sampling tables become summaries.
- **Tests:** packages 5.8 and 5.9 wrote, compared value by value with the same engine's `get_editor_property`. The tag layout before UE5 1012, which no installed engine writes, is tested on built streams.

**Built from the engine (2026-11-18, `z3t.5`).** `jam engine inventory --engine` runs `editor/fields.py` through the adapter's transport, by commandlet when no editor is open.
- **What it reads:** each selected asset's listed properties with `get_editor_property`, on the asset or a Blueprint's class default object, and on its components. Without `properties`, it reads those the listed class and its subclasses declare.
- **What it gives:**
  - effective values, marked `fieldsSource: "engine"`;
  - the component list the editor composes, native and inherited included;
  - the code-class parents it found. Those select more subclasses, read in the same run, and are kept for runs without the engine.
- **Where the editor's Python falls short:** it cannot read protected properties, cannot tell soft references from hard ones, and gives a text's display string. A value a file sets fills such gaps.
- **When values go stale:** effective values stay until the asset's file changes. Changing a parent or C++ default calls for another `--engine` run.
- **Measured:** 30–55 s on the fixtures; on project B 120 s (its editor takes about 100 s to start), 330 s the first time, when the editor's parents selected 23 more assets and a second start was needed.

### 3.4 Project integration

A project plugin builds on the `engine` units and never re-reads the engine itself:

- **`enrich`** adds archetypes, display names and categories derived from fields, tags, classes or paths, and can retype units.
- **Its own sources** add content the engine does not hold, such as server item definitions, loot tables and spawners. These are units that relate to engine units by id.
- **Relations** add links the engine cannot see: string paths in data or code, server ids.
- **Inspectors and panels** add the project's own views: a loot table with odds, the creatures that drop an item, lighting presets, animation playback.

A guide for agents, `tools/jam/docs/catalog-integration.md`, is reached from the `jam-catalog` skill when a project needs more than the engine gives. It walks through:
1. finding where each kind of content is defined (engine, data files, server code);
2. choosing unit types and archetypes, and the facts that decide them;
3. writing the plugin pieces;
4. checking the result: `doctor`, `problems`, spot checks of `unit.get`, and a capture of each new inspector.

### 3.5 Previews (`z3t.8`)

Engine files are binary, so an engine unit has nothing to look at until something renders it. Previews are made on request, never on page load, because making them may start the engine.

- **Command.** `previews` joins the standard adapter commands. The toolkit runs it as `jam engine previews [--out <folder>] [--full] [--no-engine] [--only <pattern>]... [--limit <n>]`, after `jam engine inventory`, and hands the adapter `--inventory <file> --out <folder>` and the flags. The default folder is `<roots.scratch>/.engine/previews`: machine-local, like the inventory.
- **Index** (`EnginePreviews`, format 1, `<folder>/index.json`): by project path, `{ version, file?, kind?: image | model | audio, how?, failed? }`. `version` is the file's inventory `hash`, or `<size>:<mtimeMs>` without one. Preview files are named by that version, so a changed file gets a new name and the page never shows a cached old image.
- **Only changed files.** The adapter makes a preview again only when the version changed; a failure is not retried for the same version. `--full` redoes what `--only` selects; the rest keep their previews.
- **Receipt:** `{ index, previews, made, reused, failed, waiting, none }`. `waiting` counts files whose preview needs the engine, which did not make it in this run (`--no-engine`, `--limit`).
- **Catalog.** The `engine` plugin reads the index on load (its path is a source input, so new previews reload the source) and declares the folder a media folder. A unit with a preview links it in the `preview` role, which is the type's thumbnail role; its `preview` attribute says how it was made, that it was made for an earlier version (it stays shown), or why there is none. The action `engine.previews` (`access: "read"`; input `full`, `engine`, `only`, `limit`) runs the command.

**Unreal** (`commands/engine_previews.py`, `jam_unreal/previews.py`, `editor/previews.py`; per class in the adapter's `docs/previews.md`):
- **Without the editor:** thumbnails the editor stored in the package (the summary's thumbnail table, `jam_unreal/thumbnails.py`), for any class.
- **Through the editor, no rendering needed:** a texture's source image as PNG, a sound's source as WAV.
- **Through the editor with a renderer:** meshes, materials, animations, skeletons and actor Blueprints as self-contained GLB from the editor's glTF exporter, materials baked to 512 px. Baking needs a renderer, so the transport starts the commandlet with `-AllowCommandletRendering -RenderOffscreen` in place of `-nullrhi` (option `renderArgs`). Measured on a Mac: Metal starts in a commandlet that way, with no window.
- **Batches** of 200 packages per editor process. Each result is appended to a progress file as soon as it is made, so an editor that stops early costs only the package it was on.
- **Not covered:** physics assets (no preview mesh reachable from Python), data assets, sound cues, MetaSounds and maps get only a stored thumbnail, when there is one.

**Built (2026-11-18).** Measured on project B (UE 5.9, through a wrapper):

| Run | Time | Result |
| --- | --- | --- |
| `--no-engine`, first time | 1.1 s | 460 stored thumbnails |
| Everything, first time (shaders compiled) | 7 min 31 s | 1,073 of 1,198 files have a preview; 943 made in 5 editor processes |
| Nothing changed | 2.0 s | all reused, no editor |
| A sample of 117 again with `--full`, shaders cached | 60 s | editor time 0.12 s per GLB, 0.11 s per texture; the rest is the editor starting |

And on project A (UE 5.8, 4,108 packages), where no package stores a thumbnail:

| Run | Time | Result |
| --- | --- | --- |
| Everything, first time, in four runs (one stopped and resumed, then textures first) | about 96 min | 4,014 of 4,108 files have a preview: all 1,780 material instances, 1,361 textures, 464 static and 60 skeletal meshes, 260 animations, 59 skeletons, 30 materials. 93 have none for their class; 1 failed (a Blueprint that is not an actor) |
| Nothing changed | 1.1 s | all reused |

- **The first run is shader compilation.** The first editor process spent 7.5 min compiling before its first preview. A material whose static parameters need their own shaders took 70–110 s the first time; once the derived data cache held them, the same kind took 0.5–0.8 s. Textures took 0.05 s each.
- **Disk:** 1.9 GB on project A (1.0 GB of it texture PNGs), 0.8 GB on project B.
- **Limits seen:** an animation shows its preview mesh, which for a modular character can be one part (one character's animations showed only its hair). Translucent material instances whose opacity is set at run time come out invisible on the sphere.

## 4. Unreal

### 4.1 Running the smallest engine

No standalone tool reads Unreal's asset registry. The smallest engine process is the editor binary in commandlet mode (`UnrealEditor-Cmd … -run=pythonscript`), with no window, no rendering and no levels loaded.

**Measured (2026-11-17, `furanku-skills-z3t.1`).** These ran on a Mac (UE 5.8.4) against project A's main checkout: 4,108 packages, read-only, with the OS file cache warm. Each run was a Python script that lists `/Game`, reads 21 named tags per asset, and reads hard and soft dependencies (10,332 edges).

| Route | Wall time | Notes |
| --- | --- | --- |
| One-shot commandlet, `-unattended -nosplash -nullrhi -NoSound -NoP4` | 10.8–11.4 s | Engine start is 9.5–10.1 s, the query 0.15 s, and exit 0.5 s |
| Same, with the project's MCP and Toolset plugins disabled (`-DisablePlugins=…`) | 9.8–10.1 s | Saves about 1 s. The rest is about 256 engine plugins and 650 libraries the editor loads |
| Same, with no registry cache (`-NoAssetRegistryCacheRead -NoAssetRegistryCacheWrite`) | 10.6 s | Gathering 4,108 packages from disk costs well under a second. The cache does not matter here |
| One-shot on an empty scratch project (41 copied textures, no C++ modules) | 9.6 s to ready | The floor is the editor itself, not the project's size |
| **Resident process:** one commandlet that stays up and answers requests | Starts in 10.1 s; a full snapshot then takes **0.14 s**, round trip | It does not notice file changes by itself. `scan_files_synchronous(changed files, force)` picks up added, changed and deleted packages in about 1 ms (verified in the scratch project). It holds 1.4 GB of memory (1.9 GB RSS) and uses no CPU when idle |

**Direct file reader (2026-11-17, second test).** This was a TypeScript reader of the editor package header (summary, names, imports, exports, soft package references, asset registry tag block), run in Node with no engine, on the same 4,108 packages:

| Measure | Result |
| --- | --- |
| Packages read | 4,108 of 4,108, 0 errors |
| Time | Walk 71 ms. Parse 0.18 s with the OS file cache warm (0.75 s on the first run) |
| Change check | Size and mtime of every package: 10 ms |
| Assets and classes against the engine | 4,108 matched, 0 class differences. One extra: a Blueprint-generated class (`BP_UiInputData_C`) that the engine's path query hides |
| Tag values against the engine | 15,390 compared, 0 differences. The reader returns all 61,845 tags; the engine's Python can only return tags it names |
| `/Game` references against the engine | All 5,262 engine edges found. Plus 50 soft references, most to Material Parameter Collections, that the engine query left out. These are probably editor-only; the reader must read the per-reference editor-only flags in the dependency data to label them |
| C++ references | Import packages under `/Script/...` say which C++ modules each asset needs, as the Reference Viewer's "C++ Packages" do (for example `/Script/Engine` 4,077, `/Script/InterchangeEngine` 3,415) |

**Choice.**
- **The catalog reads packages directly** on every load and refresh. A size-and-date pass finds changed files, and only those are re-read, so a refresh costs milliseconds.
- **The reader accepts only package versions it was checked against** (`LegacyFileVersion` −9, `FileVersionUE5` 1016–1018 here). Anything else is marked "needs engine refresh" and goes to the engine route.
- **The engine is used only for what the files cannot give:**
  - packages in versions the reader does not know;
  - effective property values (§3.3);
  - previews;
  - a conformance check in CI: the engine dump is diffed against the reader on the same checkout, as this test did.
- **The engine runs in one of two ways.** When the catalog server is running, a resident process is started on first need and closed after an idle time. Otherwise, a one-shot commandlet (about 10 s) runs. When an editor is open, the `command` transport replaces both.

A custom C++ commandlet would only save Python's start-up (about 1.7 s), so it is not worth building for speed.

**Constraints found.**
- **Editor modules must be built.** The project's editor modules have to be compiled for the exact engine install that runs the inventory. On project A, launching through the `/Users/Shared/Epic Games/UE_5.8` copy fails with "The game module 'CoreLink' could not be found", because the binaries link to the install at a second engine install. The inventory must report this as a distinct, actionable error.
- **Python cannot list an asset's tags.** It can only read a tag it names (`AssetRegistryHelpers.get_tag_value`). The direct reader removes this problem for packages it can read.
- **Provenance of the reader.** This test was written from Epic's engine source, which is under the Unreal EULA. Before the reader ships in this public MIT repository, decide whether to write it from the MIT/Apache readers (UAssetAPI, CUE4Parse) as reference instead. That is the user's decision, not a technical one.
- **Not measured:** the Windows host, cold disk, and larger projects.

### 4.2 The Unreal inventory

`commands/engine_inventory.py`, with the reader in `jam_unreal/packages.py` and the scan in `jam_unreal/inventory.py`. Python standard library only, like the rest of the adapter.

**Roots.**
- `/Game` comes from the `assetId` fact (`Content/{path}.uasset` by default; project A overrides it).
- Each project plugin under `<project>/Plugins/**/<Name>.uplugin` with `"CanContainContent": true` adds `/<Name>` at `<plugin>/Content`.
- `.uasset` and `.umap` files are read. Folders named `__ExternalActors__` and `__ExternalObjects__` are read like any other.

**What the reader reads**, from the package header (export data only for the property values of §3.3):

| Inventory field | Package source |
| --- | --- |
| `hash` | `SavedHash` in the summary (UE5 1016+) |
| `saved` | `SavedByEngineVersion` |
| `assets[]` | The asset registry block at `AssetRegistryDataOffset`: object path, class path, tags |
| `main` | The asset whose name equals the package's name, else the only top-level asset. This is the engine's own "most important asset" rule. A Blueprint's generated class (`*_C`) is kept in `assets` and is never `main` |
| `references` `hard` | Each import's package, found by walking outers to the `Package` import or reading the import's `PackageName` |
| `references` `soft` | The soft package reference list |
| `references` `native` | Imported `/Script/<Module>` packages |
| `references` `build` | The extra package dependencies of the dependency block (UE5 1013+) |
| `editorOnly` | The dependency block's per-import and per-soft-reference "used in game" bits. A target is editor-only only when every reference to it is |
| `names` | The searchable names map |

**Version gate.** The reader accepts `LegacyFileVersion` −8 and −9 and `FileVersionUE5` 1000–1018, branching on each version condition the engine's own reader uses. Fixtures are checked for 5.8 (1018). A cooked package (`PKG_FilterEditorOnly`), an unknown version, or any read error makes the file `unread` with the reason; nothing is guessed.

**Engine fallback** (`--engine`): the `unread` files go to the editor through the adapter's existing transport. Editor script `editor/inventory.py` reads them from the Asset Registry: classes and hard and soft package dependencies. Python cannot list tags, so those entries carry `tagsFromEngine: false`.

**Conformance check:** `jam engine check --kind inventory`. The same editor script dumps the registry for every file, and the check compares it with the reader. It reports classes, tag values and `/Game` references that differ, so an engine upgrade that changes the format shows up as check problems rather than silent errors. CI and the project run it after an engine upgrade.

**Tests:**
- Real packages written by the engine from our own inputs: `commands/test/fixtures/inventory/<engine version>/`. They hold a texture, a plugin texture, a static mesh, a material and an instance of it, a primary asset label with soft references, a Blueprint, and a data asset of a Blueprint class with a variable of each kind (for §3.3, compared with `fields.json`, the engine's own values).
- Beside each set, the engine's registry dump. The reader must match it, ignoring the documented differences: the engine hides the generated class, and drops a soft reference to a package that is also a hard one.
- `make_fixtures.py`, `dump_registry.py` and `dump_fields.py` regenerate them with any installed engine.

**Built (2026-11-17).** The Python reader matched the Asset Registry of 5.8.4 and 5.9.0 on the fixtures, and of 5.8.4 on project A: 0 differences in classes, in 15,390 tag values and in 5,262 references. Through `jam engine inventory`, project A's 4,108 packages take 2.2 s on the first run and 0.6 s when nothing changed, including Node and Python start-up and validation. The inventory file is 6.9 MB. The fallback and the conformance check ran through a real 5.8 commandlet; the check took 18 s on the fixtures and found no differences.

**Second project: project B** (UE 5.9, 1,198 packages including 11 maps and a content plugin; some packages saved by 5.5, 5.6 and 5.7):
- The reader read all of them in 1.3 s, and in 0.5 s when nothing changed.
- `check --kind inventory` agreed with the 5.9 registry on every class, tag and reference, except in 26 packages. Those packages' classes come from the project's own C++ module, which the Mac editor could not load: its Mac build is older than its source. The editor then records no references for them. The check now reports that as one problem per unloaded class, and the `--engine` fallback leaves such packages `unread` instead of claiming they reference nothing.

Building it exposed two bugs in the existing transport. The first was in the `commandlet` route. It read the editor's output through pipes, and a helper the editor starts (`UnrealTraceServer`) inherits them and outlives the editor, so every commandlet command hung. Output now goes to temporary files.

The second: the editor writes its result file relative to its own project folder, while the adapter read it relative to the jam project root. Any project whose `.uproject` is not at the root, project A and this test's wrapper included, lost every editor result. Result paths are now made relative to the `.uproject`'s folder.

### 4.3 Not now

- An editor plugin that keeps an inventory current on asset events.
- The cooked `AssetRegistry.bin`.

## 5. The test projects

Two private projects were used, called project A and project B here.

- **Project A** (UE 5.8, 4,108 packages) builds its Unreal content from its own data with an import script, from committed source art (GLB and PNG); the generated content is not committed. Its archetypes and server data live in that data and a server-side schema. Its catalog plugin reads them and links each content unit to the engine units made from its art, through the import's own manifests. Its `.uproject` is not at the repository root, so `engine.facts.assetId.from` points into its client folder.
- **Project B** (UE 5.9, 1,198 packages, maps and a content plugin) keeps its truth in Unreal, as data assets of its own C++ classes.
- Whether a project generates its Unreal content or authors it in the editor is its own decision; this design works either way.

## 6. Order

| Step | Issue | Depends on |
| --- | --- | --- |
| Inventory contract and `jam engine inventory` | `z3t.2` | — |
| Unreal reader, `inventory` command, engine fallback, conformance check | `z3t.3` | `z3t.2` |
| Catalog `engine` plugin (built, on `catalog-engine`) | `z3t.4` | `z3t.2`, catalog API Phase D (`drr.18.14`) |
| Field values from files | `z3t.11` | `z3t.3` |
| Effective values from the engine (built) | `z3t.5` | `z3t.3` |
| Project A trial | `z3t.7` | `z3t.3`, `z3t.4` |
| Integration guide for agents (`docs/catalog-integration.md`) | `z3t.6` | `z3t.7` |
| Engine previews: `jam engine previews`, catalog action `engine.previews` (built, §3.5) | `z3t.8` | `z3t.3`, `z3t.4` |
| Promotion: catalog action `engine.import` (built; a real 5.8 import of a PNG took 41 s and came back as an engine unit linked to its source) | `z3t.9` | `z3t.4` |

## 7. Open questions

- **Committed inventory.** Should a project be able to commit the inventory, so machines without the engine's content still see it? Not needed while the reader is this fast, so it is not built.
- **Granularity.** Every engine file is a unit: 4,108 in project A, 1,780 of them material instances. A project that wants fewer excludes classes or paths in `options.exclude`. Revisit after the trial.
- **Opt-in views to ship.** Candidates are lighting presets for models, animation playback, and a generic table panel for list-shaped fields.
