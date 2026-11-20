# The engine adapter contract

The authority for field shapes is the toolkit's published schemas in `tools/jam/schemas/`: `engine-adapter.schema.json` (an adapter or preset), `engine-import-receipt.schema.json`, `engine-inspect-receipt.schema.json`, `engine-conform-receipt.schema.json` and `landmarks.schema.json`. This page says what the fields mean and how the toolkit uses them.

## Where adapters live

`engine.adapter` in `jam.config.json` is an id. It resolves to `jam/engines/<id>/adapter.json` in the project first, then to a preset the toolkit ships (`tools/jam/engines/<id>.json`, facts only). `null` means no engine: glTF's conventions.

```
jam/engines/<id>/
  adapter.json     id, label, versions, facts, commands, docs
  commands/        the scripts the commands run
  docs/            guidance, one Markdown file per topic
```

`jam engine install <folder>` copies such a folder into the project (skipping `node_modules`, `__pycache__` and `.git`) and selects it. An upgrade of the toolkit never touches `jam/engines/`.

## `adapter.json`

| Field | Meaning |
| --- | --- |
| `id` | Lowercase id (`a-z0-9-`); the folder's name once installed |
| `label` | The engine's name, for people |
| `versions` | Engine versions the adapter was written for |
| `facts` | The engine's conventions (below). The four core facts must be stated: `unitsPerMeter`, `up`, `forward`, `handedness` |
| `commands` | One entry per verb: a command, or `null` (done by hand) |
| `docs` | Topic to Markdown file, relative to the adapter folder. A topic named after a verb is that verb's by-hand guide |

### Facts

Every fact is optional beyond the core four, and a project overrides any of them under `engine.facts` in `jam.config.json` (objects merge key by key). State only what you can point to a source for.

| Fact | Meaning |
| --- | --- |
| `unitsPerMeter` | Engine units in one meter |
| `up`, `forward` | The axis that is up, and the axis an asset's front faces (`+X` to `-Z`) |
| `handedness` | `left` or `right` |
| `contentRoot` | Project folder the engine imports into |
| `assetId` | `scheme`: the engine's id for an asset, with `{path}`; `from`: the project file pattern that id is derived from |
| `mesh.static`, `mesh.skinned` | Interchange format (file extension) to deliver for each |
| `textures.normalGreen` | `up` or `down`: the normal map's green channel convention |
| `textures.packed` | Channel packing of the combined mask map, for example `ORM` |
| `collision` | `convention` (how collision is authored for import) and, where it is by name, the `prefix` |
| `skeletons.<id>` | A skeleton profile: `label`, `bones` (landmark to the skeleton's bone name), `reference` (a file holding the skeleton), `hierarchy`, `notes`. A budget names one |
| `audio` | `container`, `sampleRate`, `channels`, `bitDepth`, `loudness` targets |
| `naming` | Name prefix per asset type |
| `binaries` | `lfs`: glob patterns of engine binaries to keep in Git LFS; `lockable` |
| `authoring.<budget>` | Export conventions for a budget where they differ from the engine's own axes: `units`, `up`, `forward`, `pivot` |
| `extra` | Anything else the adapter's own commands read. The toolkit passes it through unread |

### Commands

```json
"import": { "run": ["python", "commands/import.py"], "kinds": ["static", "skinned"], "timeoutSeconds": 600, "description": "..." }
```

The verbs are `import`, `inspect`, `references`, `capture`, `check`, `conform-skeleton`, `inventory` and `previews`. For each, the toolkit builds the command line from `run`:

- A first element of `python`, `blender` or `node` becomes this machine's own (from `jam.local.json`, else `PATH`; `node` is the one running the toolkit).
- An element that is a path existing inside the adapter folder becomes that file's absolute path.
- `{adapter}`, `{project}` and `{toolkit}` are replaced with those folders.
- The verb's own arguments are appended.

It runs the command from the project root, with a timeout (`timeoutSeconds`, default 600), and these environment variables:

| Variable | Value |
| --- | --- |
| `JAM_PROJECT_ROOT` | The project root |
| `JAM_ADAPTER_DIR` | The installed adapter folder |
| `JAM_TOOLKIT_DIR` | The toolkit folder |
| `JAM_ENGINE_SETTINGS` | The `engine` object of `jam.local.json`, as JSON |

**The command contract:** arguments in; exactly one JSON object on standard output; paths in it project-relative with forward slashes; exit 0 on success. Anything for a person goes to standard error. On a non-zero exit the toolkit reports the command's last lines (standard error, else standard output) as the failure.

What the toolkit passes after the verb:

| Verb | Arguments | Receipt |
| --- | --- | --- |
| `import` | `--kind <kind> <file>... [--destination <where>] [--skeleton <profile id>] [--target <engine id>] [--name <asset name>] [--run <run id>]` (the kind must be one the command takes: see Import kinds) | `{"assets": [{"id", "kind", "source"?, "sha256"?, "skeleton"?}]}`: the engine's id of each asset made or updated, with the source file and its hash where it has one. **Idempotent: importing the same source to the same place again returns the same id.** With `--run`, the toolkit records the step with these ids |
| `inspect` | whatever follows the verb; by convention the asset id | `{"id", "kind"?, "bounds"?: {"min", "max"}, "pivot"?, "triangles"?, "vertices"?, "materials"?, "skeleton"?: {"root", "bones"}, "collision"?: {"shapes", "kinds"?}}`. Lengths in **meters** whatever the engine's unit; `materials` are slot names in slot order. Leave out what the engine did not give |
| `conform-skeleton` | `--skeleton <id> [--out <folder>] <model>...` | `{"model": "<project file>", "skeleton"?, "evidence"?: [files]}`: the reworked model, recorded as the step's model |
| `inventory` | `--out <file> [--previous <file>] [--engine]` | `{"inventory", "files", "assets", "read", "reused", "removed", "unread"}` after writing the inventory file (`schemas/engine-inventory.schema.json`); reuse the `--previous` entries whose size and mtime are unchanged; start the engine only with `--engine` |
| `previews` | `--inventory <file> --out <folder> [--full] [--no-engine] [--only <pattern>]... [--limit <n>]` | `{"index", "previews", "made", "reused", "failed", "waiting", "none"}` after writing previews and `<folder>/index.json` (`schemas/engine-previews.schema.json`): per inventory path, the version made for (its `hash`, else `<size>:<mtimeMs>`), the file (an image, a self-contained GLB or a WAV) or why there is none. Make again only what changed; start no engine with `--no-engine` |
| `references`, `capture`, `check` | whatever follows the verb | One JSON object. The toolkit fixes no shape for these yet; use `{"references": [{"id", "referencers": [...]}]}`, `{"captures": [files]}` and, as project checks do, `{"problems": [{"message", "fix"?}]}` |

### Import kinds

`kinds` lists what `import` accepts; list every kind the command handles, and `jam engine show` prints them. A command that lists no kinds takes any kind except `animation`, which it takes only when listed. `jam engine import` refuses a kind the command does not take, and a recipe step conditioned on a kind (`"when": {"engine": "import", "kind": "animation"}`) is skipped by the same rule.

| Kind | Takes | Receipt |
| --- | --- | --- |
| `static` | One model file | The mesh first, then the materials and textures it made |
| `skinned` | One skinned model file; `--skeleton` names the skeleton profile it binds to | **The skinned asset first**, then the rest: a receipt of this import is what an animation import's `--target` may name |
| `animation` | One clip file in the clip format of `jam-3d-animate`, whose skeleton matches a skinned asset already in the engine; `--target <engine id>` names that asset or its skeleton. The toolkit resolves a receipt file given as `--target` to the receipt's first asset, and for a run passes `--name <the run's clip spec id>` and `--run <the run's id>` | One asset per animation in the file, each with `skeleton`: the engine id of the skeleton it plays on. Refuse a clip whose bones the target's skeleton lacks, rather than importing a clip that plays on nothing, and refuse to replace an asset that was imported from another file, unless an import with the same `--run` made it (a later attempt of that run replaces its own clip) |
| `textures`, `audio`, ... | The adapter's own | The adapter's own |

An adapter that cannot import a kind leaves it out of `kinds`; the step that needs it is then skipped with that reason on record.

Every command is optional. For a verb whose command is `null` or absent, `jam engine <verb>` prints what to do and the path of `docs.<verb>` when the adapter has that guide; the step is done by hand and recorded with evidence.

## Machine settings

How a command reaches the engine (an editor executable, a bridge program, a host, a port) is the adapter's own design, read from the `engine` object of `jam.local.json`, which is Git-ignored and holds no credentials. The toolkit does not interpret it: it hands it to every command in `JAM_ENGINE_SETTINGS`. An adapter documents its fields in its own guide, takes nothing machine-specific from its code or from tracked files, and fails with a message naming the missing field when the block is incomplete.

## Rules for receipts and records

- An engine asset id is stable: it survives a reimport and is what the game refers to.
- A stored path is project-relative with forward slashes. An absolute path, a credential or a signed URL never appears in a receipt.
- A command measures what it reports. A fact it could not read is left out, not estimated.
