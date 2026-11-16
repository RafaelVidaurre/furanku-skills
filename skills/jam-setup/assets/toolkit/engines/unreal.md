# Unreal Engine by hand (facts-only preset)

This preset states Epic's documented conventions and runs nothing. For commands (import, inspect, references, checks) install the full adapter from the `jam-engine-unreal` skill. Each fact's source is listed in `unreal.json` under `facts.extra.sources`.

## Import

1. Deliver static and skeletal meshes as `.fbx` (Epic's preferred format), or `.gltf`/`.glb`, which import through the Interchange dialog. The FBX import option "Convert Scene Unit" converts the file's units to the engine's centimeters.
2. For a static mesh's collision, add shapes named for the render mesh to the same file: `UCX_<mesh>` (or `UCX_<mesh>_01`, ...) for a closed convex shape, `UBX_`, `UCP_`, `USP_` for a box, capsule, sphere.
3. Import into a folder under `Content/` from the Content Browser. The asset's id is its package path, `/Game/<folder>/<Name>`.
4. Name assets by Epic's prefixes (`naming` facts).
5. Deliver audio as 16-bit `.wav`.

Done when the asset opens in the editor at the size you delivered and you have recorded its `/Game/...` id with a still as the step's evidence.

## Inspect

Read the mesh's bounds, material slots and collision in the editor. Lengths there are centimeters: divide by 100 for meters.

## Left out of the facts

- `textures.normalGreen`: Epic's engine pages document the texture's "Flip Green Channel" property and Interchange's "Flip Normal Map Green Channel" option, and do not state which convention the engine expects.
- `textures.packed`: Epic recommends packing masks into channels and gives no channel order.
- `audio.sampleRate`: any rate imports; a project sets its own.
- `skeletons`: a project names its own.
- Which Interchange or legacy importer handles FBX differs by engine version; check the project's version.

## Version control

`.uasset` and `.umap` files are binary and cannot be merged. Keep them in Git LFS, mark them `lockable`, and lock a file before changing it.

## Budgets

Epic publishes no per-asset triangle count. What it does publish bounds a whole view, so derive a budget from it with the expected instances and screen coverage (`docs/asset-workflows.md`):

- **Mobile:** at most about 500k triangles and 700 draw calls for the whole scene per view; square power-of-two textures. A legacy figure measured for 30 fps on iPad 4 and iPad Air: a scene ceiling, not an asset budget. ([Performance guidelines for mobile devices](https://dev.epicgames.com/documentation/en-us/unreal-engine/performance-guidelines-for-mobile-devices-in-unreal-engine))
- **Nanite** (desktop and console, DX12 SM6): enable it "wherever possible on platforms that support it", while "practical limits still remain". Forward rendering is unsupported. Nanite skeletal meshes use animation LODs and do not support morph-target deformation. A Nanite static mesh is bounded by disk, memory and authoring time rather than a triangle count, and favours geometric detail over baked normals. ([Nanite](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine))
- Interchange offers *Flip Normal Map Green Channel* and *Use MikkTSpace* on import: record the green-channel convention per normal map rather than assuming it. ([Interchange import reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/interchange-import-reference-in-unreal-engine))
