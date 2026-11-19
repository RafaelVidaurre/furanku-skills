# Bought, downloaded and placeholder content

Content made elsewhere enters the project in one of two ways. Both start from the same evidence of where it came from.

| Want | Way in |
| --- | --- |
| Browse it, tag it, use it as it is (a placeholder kit, a bought pack) | Declare it in the catalog. No run, no style, no budget |
| Work on it further or deliver it through gates (retexture a bought mesh, retopologize a scan) | Start a run part-way through a recipe |

## Origin evidence

Before either, keep beside the files a short document per item or pack:

- where it came from (the page, not a download link that expires) and who made it;
- the licence by name, and where its text is (a URL, or the licence file kept beside the content);
- what the licence requires of the game (credit, share-alike, no redistribution of the source files);
- the date fetched and the SHA-256 of each original file.

Keep the original download unchanged next to any converted file. When the person's own note lacks something on this list, add it to that note rather than starting a second one. A licence you could not find is recorded as unknown, and that content stays in ignored scratch as reference only. Free to download is not free to ship.

## Declare it in the catalog

The catalog's `manifest` plugin reads hand-declared content. `catalog.config.json` names the manifest file (option `file` of its `manifest` entry, `Art/catalog.json` by default). The manifest's `unitFiles` names a folder (`Art/Catalog` in the starter); put one JSON file per unit there, named after the unit (`chair.json`), or one file per pack holding a `units` array. Create the folder if it is missing.

```json
{
  "id": "bought/kit-name/chair",
  "type": "external-asset",
  "name": "Wooden chair",
  "attrs": {
    "creator": "Asset creator",
    "source": "https://example.com/the-original-asset",
    "license": "CC0-1.0",
    "provenance": "Art/Bought/kit-name/origin.md"
  },
  "links": [{ "role": "model", "asset": "Art/Bought/kit-name/chair.glb" }]
}
```

- Keep the id stable for the game object, so replacing the file later keeps its notes and review history.
- Models are self-contained GLBs. `external-asset` also takes `image` and `video` links, several of each. Its other fields (`objectType`, `pack`, `sourceFile`, `purpose`, ...) are listed in the manifest; fill the ones you know. Other types, fields and roles are declared in the manifest file.
- Confirm with `jam catalog run unit.get --input '{"id":"<id>"}'` and `jam catalog run problems`.
- File it where a person will look for it: the `jam-catalog` skill covers categories, collections and tags.

**Placeholders.** The `placeholder` tag is what marks stand-in content: `jam catalog run organization.set --actor-kind agent --actor-name <you> --request-id <id> --input '{"target":{"kind":"unit","id":"<id>"},"tags":["placeholder"]}'` (it sets the unit's whole tag list, so include tags it already has; `organization.setMany` adds and removes across many). Find it with `jam catalog run unit.search --input '{"filters":{"tag":["placeholder"]}}'`. When the real asset arrives, keep the unit id, point its link at the new file, update the origin, and remove the tag.

## Enter a recipe part-way

```
jam run start <recipe> <id> --brief-text "<what is wanted from this file>" --from <step>
jam run next <id>
```

The steps before `<step>` are marked not needed. Recording `<step>` requires the origin: `--source "<where it came from>" --source-evidence <the origin document>`. A file that already satisfies several steps (a bought mesh whose topology and UVs are kept) is recorded for all of them at once:

```
jam run record <id> topology uv --file <model.glb> --note "Kept as bought: <why it suffices>" \
  --source "<page>" --source-evidence <origin document> --accept "<what you checked>"
```

Each step's checks and gate still apply: a bought mesh is measured against the budget and reviewed like a generated one. Choose the recipe with `jam recipe list`; `asset` is the one for a single operation on an existing model.

## Converting files

A GLB that is already self-contained needs nothing.

```
jam pack-glb <source.gltf> <destination.glb>
jam blender --factory-startup toolkit:fbx-to-glb.py -- <source.fbx> <destination.glb>
```

`pack-glb` embeds external buffers and images without changing geometry or materials. The FBX conversion needs Blender. For an old FBX whose opaque materials import as fully transparent, add `--opaque-untextured-materials` after the destination, only after seeing the failed render, and note the material names it prints. Look at the converted file in the catalog or a viewer before relying on it; that shows how it looks there, not how an engine imports it.
