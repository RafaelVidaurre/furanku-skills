# Godot by hand (facts-only preset)

This preset states Godot's documented conventions (4.x) and runs nothing. Each fact's source is listed in `godot.json` under `facts.extra.sources`.

## Import

1. Deliver models as glTF 2.0 (`.glb` or `.gltf`), Godot's recommended format, in meters, Y up, with the asset's front toward +Z (in Blender: front toward −Y). A model with blend shapes needs the glTF exporter's "Export Deformation Bones Only" enabled.
2. For collision, name an object in the file with a suffix: `-col` or `-convcol` keeps the mesh and adds a collision of its geometry (triangle mesh or convex); `-colonly` or `-convcolonly` replaces the object with a static body. `-`, `$` and `_` all work as the separator, in any letter case.
3. Put the file anywhere under the project root (the folder holding `project.godot`); its id is `res://<path>`. Godot writes `<file>.import` beside it when it imports the file: commit that file, and keep `.godot/` out of version control.
4. Normal maps use OpenGL style (green up). For a DirectX-style map enable "Normal Map Invert Y" in its import settings. A packed map is ORM: occlusion red, roughness green, metallic blue.
5. Use WAV for short, repeated sound effects and Ogg Vorbis for music, speech and long sounds.
6. Name files and folders in `snake_case`.

Done when the scene opens in the editor at the size you delivered and you have recorded its `res://` path with a still as the step's evidence.

## Inspect

Open the imported scene in the editor and read the mesh's bounding box; it is in meters.

## Left out of the facts

- `contentRoot`: the content root is the project root itself.
- `naming`: Godot publishes a casing style (in `extra`), not prefixes.
- `binaries.lockable`: the version-control page gives a Git LFS sample and says nothing about locking.
- `.uid` sidecar files: not covered by the pages read for this preset; follow the editor's own guidance.
