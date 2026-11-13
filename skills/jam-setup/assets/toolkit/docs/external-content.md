# Add external content to the catalog

The catalog accepts sourced models, images and videos directly. Its dependencies come with the jam toolkit install (`jam-setup`). No Jam configuration, generation skill, run, profile or acceptance record is required. The project adapter combines the built-in manifest adapter with the optional Jam adapter so both kinds of content remain visible.

1. Put rights-cleared content under `Art/` and preserve its source URL and license. Models must be self-contained GLBs. Images and videos use the formats listed in the [catalog README](../catalog/README.md).
2. Add a JSON file under `Art/Catalog/`. Each file contains one unit or a `units` array. Use a stable ID for the game asset so replacing a file preserves its notes and review history. For example:

```json
{
  "id": "external/my-props/chair",
  "type": "external-asset",
  "name": "Wooden chair",
  "attrs": {
    "creator": "Asset creator",
    "source": "https://example.com/the-original-asset",
    "license": "CC0-1.0"
  },
  "links": [{ "role": "model", "asset": "Art/Imported/chair.glb" }]
}
```

The existing `external-asset` type also has `image` and `video` roles, each accepting multiple files. More content types, fields, visual roles and collections can be declared in `Art/catalog.json` through the built-in manifest format.

3. Read the result and reported problems:

```sh
node tools/jam/catalog/bin/catalog.mjs run unit.get --input '{"id":"external/my-props/chair"}'
node tools/jam/catalog/bin/catalog.mjs run problems
```

4. For a placeholder, add the catalog-owned tag. Use your own stable request ID and actor name:

```sh
node tools/jam/jam.mjs catalog run organize.set --actor-kind agent --actor-name my-agent \
  --request-id chair-placeholder-1 \
  --input '{"target":{"kind":"unit","id":"external/my-props/chair"},"tags":["placeholder"]}'
```

File new units into their category and collection as the `jam-catalog` skill describes under *Filing added content*. Tags written through catalog actions live under `.catalog/labels/`; commit them with the content. The initial placeholder batch labels units, visual assets and pack collections. Filter by the `placeholder` tag in the UI, or run:

```sh
node tools/jam/jam.mjs catalog run catalog.search --input '{"filters":{"tag":["placeholder"]}}'
```

When replacing a placeholder, retain its unit ID, update its linked content and provenance, then remove the catalog-owned tag with `organize.bulk` and `removeTags: ["placeholder"]` for the replaced unit and visual. A catalog label is independent of any Jam acceptance or catalog review verdict.

Serve the browser with `node tools/jam/jam.mjs catalog serve` (default `http://127.0.0.1:4600/`); add `--detach` to keep it running after the starting terminal or agent session closes. `node tools/jam/catalog/bin/catalog.mjs serve` is the same catalog without the Jam command shortcut. Both use `catalog.config.json`.

## Catalog adapter

`catalog.config.json` names the adapter that tells the catalog what the project contains. jam-setup sets `./tools/jam/catalog-adapter.mjs`, which shows jam runs (`Art/**/run.json`) together with the external-content manifest (`options.manifest`, default `Art/catalog.json`); a project that used the built-in `manifest` or `jam` adapter is moved to it with its manifest and other settings kept. A project with its own adapter module keeps it, and jam runs stay out of the catalog until that module also loads the jam adapter: import `tools/jam/catalog/adapters/jam.mjs`, call it with `{ root }` beside the project's own adapter, and merge their `load()` results as `tools/jam/catalog-adapter.mjs` does. Confirm with `node tools/jam/jam.mjs catalog run catalog.search --input '{}'` listing a jam asset.

## Optional format conversion

Already self-contained GLBs need no conversion. For glTF/GLB files with external buffers or textures, run (the decoder ships with the toolkit install):

```sh
node tools/jam/pack-glb.mjs source.gltf Art/Imported/chair.glb
```

This optional converter uses glTF Transform 4.5.1 and its extension handlers to embed the original buffer/image bytes. It is a file conversion command, not a Jam workflow; catalog browsing does not load these dependencies for external content. FBX conversion uses installed Blender in an isolated process:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python tools/jam/fbx-to-glb.py -- source.fbx Art/Imported/chair.glb
```

Inspect a catalog capture after conversion. This establishes the inspected catalog appearance, separately from native engine import, scale, retargeting, performance and art acceptance.

For a legacy FBX whose known opaque wood/skin materials import with unlinked constant-zero alpha, `fbx-to-glb.py` accepts `--opaque-untextured-materials` after the destination. Use it only after inspecting the source and failed render; record the material names printed as `CATALOG_ALPHA_REPAIRS`. Texture-driven opacity is preserved.
