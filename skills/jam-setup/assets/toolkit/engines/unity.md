# Unity by hand (facts-only preset)

This preset states Unity's documented conventions (Unity 6) and runs nothing. Each fact's source is listed in `unity.json` under `facts.extra.sources`.

## Import

1. Deliver models as `.fbx`, Unity's stated best practice. glTF needs the separate Unity glTFast package. In the model's import settings, "Convert Units" applies the file's unit so that 1 unit is 1 meter, and "Bake Axis Conversion" bakes a different axis system into the data.
2. Put the file under `Assets/`. Unity writes a `.meta` file beside it holding the asset's GUID and import settings: commit it with the asset, and keep `Library/` out of version control.
3. Normal maps are Y+ (green up). A packed mask texture depends on the render pipeline: URP Lit reads metallic from red, occlusion from green and smoothness from alpha; HDRP's mask map adds a detail mask in blue.
4. For collision, enable "Generate Colliders" in the model's import settings, or add collider components; no name in the file creates one.
5. Deliver audio as `.wav`; choose the compression per clip in its import settings.

Done when the asset shows in the Project window at the size you delivered and you have recorded its `Assets/...` path with a still as the step's evidence.

## Inspect

Read the mesh's bounds in the editor; they are in meters when the import scale is right.

## Left out of the facts

- `assetId`: assets are identified by GUID (in `.meta`), which no path pattern derives.
- `textures.packed`: it differs between render pipelines (both are in `extra.maskMaps`).
- `naming`, `binaries`: Unity's manual publishes neither a naming convention nor Git LFS or locking guidance for assets.
- `unitsPerMeter` is 1 by the physics engine's stated assumption; rendering has no fixed unit.

## Budgets

Unity gives no triangle counts: it "depends on the visual quality you require and the platform you are targeting". For characters it recommends one skinned mesh, as few materials as possible, and at most four skin influences per vertex; the engine's vertex count after import exceeds the DCC's, because UV seams and hard edges split vertices. ([Creating models for optimal performance](https://docs.unity.com/en-us/engine/current/manual/assets-and-media/asset-types/models/creating-dccassets/modeling-optimized-characters))
