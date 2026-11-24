# Import by hand

This adapter has no import command: Godot imports a file when the editor sees it under the project folder. The facts (`jam engine facts`) state the conventions below; each has its source in `adapter.json` under `sources`.

1. Deliver models as glTF 2.0 (`.glb` or `.gltf`), Godot's recommended format, in meters, Y up, with the asset's front toward +Z (in Blender: front toward −Y). A model with blend shapes needs the glTF exporter's "Export Deformation Bones Only" enabled.
2. For collision, name an object in the file with a suffix: `-col` or `-convcol` keeps the mesh and adds a collision of its geometry (triangle mesh or convex); `-colonly` or `-convcolonly` replaces the object with a static body. `-`, `$` and `_` all work as the separator, in any letter case.
3. Put the file anywhere under the Godot project folder (the one holding `project.godot`) outside hidden folders and folders holding a `.gdignore`; its id is `res://<path>`. Godot writes `<file>.import` beside it when it imports the file: commit that file, and keep `.godot/` out of version control.
4. Normal maps use OpenGL style (green up). For a DirectX-style map enable "Normal Map Invert Y" in its import settings. A packed map is ORM: occlusion red, roughness green, metallic blue.
5. Use WAV for short, repeated sound effects and Ogg Vorbis for music, speech and long sounds.
6. Name files and folders in `snake_case`.
7. Open the project in the editor so it imports the file, then run `jam engine inventory`.

Done when the inventory lists the file with the class you expect and no `unread`, the scene opens in the editor at the size you delivered, and you have recorded its `res://` path with a still as the step's evidence.
