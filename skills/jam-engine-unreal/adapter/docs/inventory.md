# Inventory

`jam engine inventory` lists every package under `/Game` and under each project plugin whose `.uplugin` sets `"CanContainContent": true`. It writes one inventory file, by default `.engine/inventory.json` in the scratch root, and prints its path.

## What it reads

Each `.uasset` and `.umap` is read from the package file, without the editor, so it works on a machine with no Unreal installed. For each package the inventory holds:

- **Its assets:** each one's class and Asset Registry tags, such as texture dimensions, triangle counts, a Blueprint's parent class, and the source file it was imported from.
- **The main asset:** the one named like the package. A Blueprint's generated class (`*_C`) is listed beside it, never as the main asset.
- **References:**
  - `hard`: imports;
  - `soft`: soft object paths;
  - `native`: `/Script/<Module>`;
  - `build`: build-only dependencies;
  - `editorOnly`: true when the game does not need the reference.
- **Searchable names**, such as gameplay tags.
- **Property values** of the classes the project lists (below).

## Property values

To read the values a project's assets hold, list their classes in `jam.config.json`:

```json
{ "engine": { "facts": { "extra": { "inventory": { "fields": [
  { "class": "/Script/MyGame.ItemDefinition", "properties": ["DisplayName", "Icon"] },
  { "class": "/Game/Items/BP_Item.BP_Item_C" },
  { "class": "/Script/Engine.Actor", "properties": [] }
] } } } } }
```

- `class` selects assets of that class and of its subclasses:
  - an object of the class (a data asset) gets its own values;
  - a Blueprint whose generated class derives from it gets that class's defaults (`Default__<Name>_C`).
- `properties` names top-level properties. Leave it out to read all of them; `[]` reads only the components. A class under several listed classes reads the union of their properties.

### Subclasses

The reader knows a class's parents from:
- Blueprint assets' `ParentClass` tags, through every Blueprint in the inventory;
- the project's C++ headers (`Source/**/*.h` and each plugin's `Source`): `UCLASS() class UItem : public UPrimaryDataAsset`;
- parents an `--engine` run learned from the editor, kept in the inventory as `parents`, even by `--full`.

Without an `--engine` run, an engine class's own parents are unknown: listing `/Script/Engine.Actor` selects a Blueprint of `Actor`, but not one of `Character` (`Character -> Pawn -> Actor`). After one `--engine` run it does.

### Values

`fields` holds the values by property name. `fieldsSource` says where they come from:
- `file`: what the file itself sets. A property left at its class default is not in the file, so it is missing.
- `engine`: effective values, inherited and native defaults included (below).

Encoding:
- numbers, booleans and strings as they are;
- names as strings;
- texts as their source string; a string-table text as `{"table", "key"}`; a formatted text as what builds it: `{"format", "args"}`, `{"asNumber"|"asPercent"|"asCurrency"|"asDate"|"asTime"|"asDateTime": value}`, `{"transform": "ToUpper", "text"}`;
- enums as `EEnum::Value`;
- structs as objects, arrays and sets as lists, maps as lists of `{"key", "value"}`;
- an instanced struct as `{"struct": "<struct>", "value": {...}}`, an unset one or an unset optional as `null`;
- per-platform values as `{"Default", "PerPlatform": {"<platform>": value}}`;
- a delegate as `{"function", "target"}`, a multicast delegate as a list of them, a field path as `{"field": "<owner>:<name>"}`;
- bulk data as a summary: a sequencer curve as `{"keys", "DefaultValue", "TickResolution", ...}`, a mesh's sampling table as `{"samples", "TotalWeight"}`;
- a static array's element `i > 0` under `Name[i]`.

References:
- an object reference is `{"object": "<engine id>", "class": "<class>"}`;
- a soft reference is `{"soft": "<engine id>"}`;
- an empty one is `null`.

`fieldReferences` lists every reference with the property path that holds it (`Parts[0]`, `Rules.Mesh`). Its `kind` is `hard`, `soft`, or `native` for a code class. A reference can point into the same package, for example to a component.

A value the reader cannot decode is `{"unparsed": "<type>"}`; the rest of the asset is still read. If the export cannot be read at all, the asset gets `fieldsError` with the reason, and keeps its class, tags and references. A component whose class serializes itself without tagged properties gets `fieldsError` the same way.

### Components

A selected asset's `components` lists what it is composed of, each `{"name", "class", "path", "fields", "fieldReferences"}`:
- an actor Blueprint: its construction script's components (`Body`), its class defaults' native components, named by the property that holds them (`CharacterMovement`), and the inherited components it changes, with `from` the class that adds them;
- the components of its Blueprint parents in the inventory that it does not change, marked `inherited`;
- any other asset: its instanced subobjects, named by their path below it.

A component's `fields` are what its file sets; with `fieldsSource: "engine"` they are effective values, and the list is the editor's, `native` and `inherited` included.

### Effective values: `--engine`

`jam engine inventory --engine` starts the editor through the transport in `jam.local.json` (`docs/transport.md`) and reads, for each asset the list selects, every listed property with `get_editor_property`: on the asset, or on a Blueprint's class default object, and on its components. The editor decides the parent chain from the loaded classes, so it also selects what the files could not, and records those parents in the inventory.

- A property the editor's Python cannot read (protected) keeps the file's value when the file sets it, else is `{"unparsed": ...}`.
- With no `properties`, the editor reads every editor-visible property the listed class and its subclasses declare, not those inherited from above it. Python names them in snake case: a name the file uses keeps its case; any other is rebuilt (`MaxSpeed`, `bIsMoving`) and checked against the class.
- Python does not tell a soft reference from a hard one: the file's, or a Blueprint parent's, kind is used, else `{"object"}`.
- A text gives its display string.
- An asset the editor cannot read keeps its file values and gets `fieldsEngineError`.

Effective values stay in the inventory until the asset's file changes; that file is then read again and its values are `file` until the next `--engine` run. Changing a parent class or C++ defaults does not change the child's file: run `--engine` again. One run costs an editor start (a minute or more on a large project) plus loading the selected assets.

### Reuse

The inventory records a hash of the list, subclasses included, as `fieldsConfig`. When it changes, the next run reads again every package that has fields or holds a selected asset.

## Speed

Running it again reads only packages whose size or modification time changed; the rest come from the previous file. `--full` reads everything again.

## Packages it cannot read

The reader knows UE5 editor packages up to object version 1018, which covers 5.8 and 5.9. Cooked packages and newer versions are listed with `unread` and the reason. To fill them from the editor's Asset Registry, run with `--engine`, which also reads effective values (above): it goes through the transport in `jam.local.json` (`docs/transport.md`). Their classes and package references are filled, but not their tags, because the editor's Python cannot list them.

## After an engine upgrade

Run `jam engine check --kind inventory [/Game/<folder>]`. It asks the editor's Asset Registry about the same packages and reports every class, tag value or `/Game` reference where the reader and the engine disagree.

Three differences are expected and are not reported:
- the registry hides Blueprint generated classes;
- it lists only some of the code modules a package imports;
- it lists a soft reference only as hard when the same package is also a hard reference.

Done when the check prints no problems. Otherwise the reader needs updating for that engine version before the inventory is trusted.

## Projects whose Content folder is not at the root

Set `engine.facts.assetId` in `jam.config.json`, for example:

```json
{ "scheme": "/Game/{path}", "from": "apps/client/Content/{path}.uasset" }
```

The plugins folder beside that `Content` folder is searched for content plugins.
