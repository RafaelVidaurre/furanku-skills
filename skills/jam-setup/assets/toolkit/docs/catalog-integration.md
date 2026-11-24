# A project's content in the catalog

The catalog takes its content from the project itself:
- the game engine's content, through the built-in `engine` plugin;
- what only the project knows, through a project plugin under `jam/catalog/`. That covers archetypes, data outside the engine (server definitions, loot tables), references the engine cannot see, and the project's own inspectors.

Do the steps in order. Stop after step 1 when the person only needs to see the engine's content.

When the project declares which assets belong in its catalog, its `jam` plugin can use `{ "plugin": "jam", "options": { "includeRuns": false } }`. This keeps media measurements and doctor checks available. Recipe runs appear as catalog units by default.

## 1. The engine's content

1. Check that `jam engine show` lists `inventory` among the commands the adapter runs. Without it, install a full adapter for the engine (the `jam-engine` skill).
2. Run `jam engine inventory`. It prints how many files it read and how many it could not. For each file it could not read, follow the adapter's guide: `jam engine docs inventory`. That guide also covers projects whose content folder is not where the adapter expects it.
3. Add the plugin to `plugins` in `catalog.config.json`:

```json
{ "plugin": "engine", "options": { "types": { "/Script/MyGame.ItemDefinition": { "type": "item", "label": "Item" } }, "exclude": ["Content/Developers/**"], "filter": ["Rarity"] } }
```

| Option | Meaning | Default |
| --- | --- | --- |
| `types` | Unit type and label per engine class | `engine-<class>`, labelled with the class name |
| `exclude` | Project path patterns to leave out (`*` within a folder, `**` any depth) | none |
| `filter` | Engine metadata keys to offer as search filters | none |
| `scope` | The page section the units appear in. Set it when the project registers its own sections | `material` |
| `importWith` | The project's own action for putting content into the engine, when it builds that content itself rather than importing file by file; `engine.import` then refuses and names it | none |
| `currentPreviewsOnly` | Hide a generated preview or animation as soon as its source or any recorded input changes. Regenerate it with `jam engine previews`. | `false` |
| `matchSourcesByMd5` | When the path the engine stored for a source file does not resolve (it imported from a temporary folder or another checkout), find the file among the catalog's media by the MD5 the engine stored. The first run hashes the media under the asset roots; each file version is hashed once per machine | `false` |

**What each unit holds.** Each engine file the adapter could read becomes the unit `engine:<engine id>`, for example `engine:/Game/Props/SM_Crate`. It sits with the project's source material (the `material` scope, "Source material"). The catalog has no section per origin: where something comes from is in its attributes and relations, and what a person looks for (items, characters, levels) is the project's main content, which steps 2 to 4 set up. Its attributes:
- `class`, `engineId`, `file` and `saved`;
- the engine's metadata, one attribute per key (`Triangles`, `ParentClass`, …);
- `uses`: the engine units it references, which the page shows as "Uses" and "Used by";
- `modules`: the code modules it needs;
- `external`: references outside the project;
- `names`: searchable names such as gameplay tags;
- `sourceFiles`: the files it was imported from, each with `stored`, `path` (only when the file is in this checkout) and `md5`. Source files the catalog can show also appear in its `source` role; the folders of those in the checkout count as media folders.
- `preview`: how its engine preview was made, that the preview is from an earlier version of the file, or why it has none (below).
- **property values**, for the classes the adapter is told to read and their subclasses (`jam engine docs inventory` says how). Each property is an attribute under "Properties". A reference becomes the unit it names, so a data asset shows the meshes, icons or sounds it holds. `fieldsSource` says what the values are: `file`, what the file itself sets (a property left at its class default is absent), or `engine`, effective values with defaults included, after `engine.refresh` with `engine: true`;
- `components`: the classes of the components the asset holds, inherited ones included, for filters and archetype rules ("has a WeaponComponent"); `componentValues` holds each component's name, class and values.

The inventory runs again only when an engine file changes. To read everything again, run `jam catalog run engine.refresh --input '{"full":true}'`.

**Previews.** Engine files are binary, so a unit shows nothing until the adapter makes previews: `jam engine previews`, or the catalog action `engine.previews` (input `full`, `engine`, `only`, `limit`, as the command's flags). Each unit then gets an image, a GLB model, a sound or a video in its `preview` role, which is also its thumbnail, and an asset that holds sprite animations gets each one in its `animation` role, playing; `jam engine docs previews` says what each class gets. Making them may start the engine and take minutes, so it is never done on page load; run it again after engine files change, and it makes only those of the changed files. Until then the unit keeps its old preview and its `preview` attribute says it is from an earlier version. The previews folder (`.engine/previews` in the scratch root) is machine-local and is a media folder of the catalog.

To put files into the engine from the catalog, run `engine.import` with a unit, whose linked model, image or audio files are imported, or with `files`. It also needs the adapter's `kind`, and a `destination` when the adapter has no default. For example: `jam catalog run engine.import --actor-kind agent --actor-name <you> --request-id <id> --input '{"unit":"kit/barrel","kind":"static"}'`. The new assets appear as engine units. A project whose engine content is generated from its own data, and not imported file by file, adds its own action that runs that build and names it in `importWith`.

Done when `jam catalog run summary` counts the engine's units, `jam catalog run problems` has nothing from the engine, and `unit.get` of one asset shows what it uses, what uses it and, after `jam engine previews`, its preview link.

## 2. Where each kind of content is defined

Write a table, one row per kind of content the person works with: items, creatures, levels, sounds, loot tables, and so on. Ask the person which kinds matter rather than inferring the list. For each row, find:
- **the source of truth**, meaning where the content is authored: the engine's assets, data files (JSON, YAML, CSV, DataTables), server code and its schemas, or scripts;
- what identifies one entry (an id, a path, an engine id);
- what it references, and where those references are written;
- which engine assets show it.

Engine assets can be build products of data upstream: a project may import its art from its own data folder with a script. When they are, the upstream data is the source of truth, and the engine units are what it produced.

Done when every row names one source of truth and the person has confirmed the list of kinds.

## 3. Units, types and archetypes

- **Units.** A unit is one thing a person looks up or reviews, wherever it is defined. A kind whose truth is in the engine uses the engine units, retyped and moved to the content (the `main` scope, "Content") in step 4. A kind whose truth is elsewhere (server data, data files) gets its own units from a project source, in the content. Those units link to the engine units that show them (`engine:<engine id>`) with a relation, so one page shows an item's data and its engine assets together. Content split across places, such as an item defined on the server whose mesh and icon live in the engine, is one unit with relations, not one unit per place.
- **Archetypes.** For each archetype (Weapon, Consumable, Boss…), write the rule that decides it and the fact it reads. Prefer, in this order:
  1. the class or parent class (`class`, `ParentClass`);
  2. the components, facets or property values the data declares;
  3. gameplay tags (`names`);
  4. folder conventions, as the last resort.

  A rule that no fact in the data can decide is a question for the person, not a guess. Check the project's glossary for the archetype names, because a word may already mean something else there.

Done when every archetype has a rule whose fact you have seen in the data.

## 4. The project plugin

Create `jam/catalog/<project>.ts` and list it in `plugins` after `engine`. The contract is `tools/jam/src/catalog/README.md` (section "Plugins"), and `tools/jam/examples/plugins/storybook.ts` uses every extension point. Use only the pieces the table and the rules of steps 2 and 3 call for:

| The project has | Plugin piece |
| --- | --- |
| Kinds of content (characters, items, effects) | a type each, with a `plural` for lists; they share the Content scope, and the page lists that scope by type. Register a scope only for a separate library |
| Content outside the engine | a source that reads its files and returns units, listing those files as `inputs` |
| Archetypes of engine assets | `enrich`: retype or categorise `engine:` units by the rule's fact |
| References in data or code that the engine cannot see | a relation whose `from(unit)` returns the unit ids an attribute names |
| Still images cut from an atlas | a `crop: [x, y, width, height]` on each link to the source image. Reviews cover the chosen region and original image bytes. |
| Animations cut from sprite sheets, with their frame layout and speed in data, code or file names | a `sheet` on each link to the sheet image (`tools/jam/src/catalog/README.md`, "Sprite sheets"): the page plays it, and reviews cover its timing |
| A view the generic page lacks: loot odds, a creature's drops, lighting | an inspector or panel: a browser module declared under `browserModules` |
| Work a person or agent starts from the catalog | an action named `<plugin>.<operation>` |

For example, an `enrich` that makes engine assets of one class into weapons, part of the project's main content. The new type starts from the engine type, so it keeps its field labels and its "Imported from" role:

```ts
import { definePlugin } from "../../tools/jam/catalog-plugin.ts"

const WEAPON = "/Script/MyGame.WeaponDefinition"
export default definePlugin({
  name: "my-game",
  enrich: (merged) => {
    const weapons = merged.units.filter((unit) => unit.id.startsWith("engine:") && unit.attrs?.["class"] === WEAPON)
    if (weapons.length === 0) return
    return {
      types: { weapon: { ...merged.types[weapons[0]!.type], label: "Weapon", scope: "main" } },
      units: Object.fromEntries(weapons.map((unit) => [unit.id, { type: "weapon", category: "Items/Weapons" }]))
    }
  }
})
```

Done when each row of step 2 and each archetype of step 3 is covered by a source, an enrich rule or a relation, or by nothing because the engine units already show it.

### Use the project's build or export inventory

Use `defineSourceInventory` when the project's build or export process defines which files belong in Source material. Give it a map keyed by project-relative file paths. Each file can name its build `targets` and the paths it `uses`.

```ts
import { definePlugin, defineSource, defineSourceInventory, type SourceInventoryFile } from "../../tools/jam/catalog-plugin.ts"

const inventory = defineSourceInventory()

export default definePlugin({
  name: "build-files",
  sources: [defineSource({
    name: "inventory",
    inputs: () => ["exported-files.json"],
    load: async (context) => {
      const files = await context.files.readJson("exported-files.json") as Record<string, SourceInventoryFile>
      return inventory.source(files)
    }
  })],
  enrich: (merged) => inventory.project(merged).patch,
  relations: inventory.relations
})
```

If the project uses `engine`, list the project plugin after it. Listed files keep the engine's id, type, and metadata when the project paths match exactly. If several engine rows share a path, the first id in lexical order represents the file. A listed file with no engine row gets a `source:<path>` entry. Engine rows outside the list are removed. Leave out the inventory output when the project cannot provide it. An explicitly empty inventory selects zero files.

Build targets appear as a filter where they are supplied. Supplied dependencies replace the engine's dependency edges for that file, and `uses: []` clears them. When `uses` is omitted, the catalog keeps the adapter's dependencies to surviving entries and its external references. The `Uses` and `Used by` relations also work with a project inventory alone.

The `Source files` relation links content to inventory entries through each unit's `sources` and linked asset paths. To add paths from link metadata, pass `linkSourcePaths(link)` to `defineSourceInventory`. In a source that already produces content, merge the inventory's `types` and append its `units` to the source's output.

## 5. Check the result

- `jam catalog run problems` is empty, and `jam catalog doctor` passes.
- For one unit of every type and archetype, `jam catalog run unit.get --input '{"id":"<unit>"}'` shows the type, the attributes the rule used, and the relations you expect in both directions.
- Each new inspector or panel is checked by capturing it: `jam catalog capture --target unit:<id> --part inspector:<key> --out <scratch>/<key>.png`. Open the image.
- `jam catalog run summary` answers within a couple of seconds on the full project. A source that rereads everything on every call shows up here.

Done when all four hold. Tell the person which types, archetypes and relations now exist, and which kinds from step 2 are still not covered.
