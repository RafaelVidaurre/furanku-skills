# Exporting a skinned mesh for Unreal

```
node tools/jam/jam.mjs blender jam/engines/unreal/commands/dcc/export_skinned.py -- <rigged.blend> <out-dir> <Name> [--armature root] [--uv <layer>] [--per-mesh | --per-mesh-only]
```

It writes `<Name>.fbx` (the armature and every mesh it deforms) and `export-info.json`. `jam engine conform-skeleton` runs it for you after conforming. Each rule below is one the jam paid for:

| Rule | Why |
| --- | --- |
| Bone data in centimetres under an armature object scaled 0.01 | Unreal reads the armature object as the root bone. Epic's own exports are laid out this way; anything else gave the root bone a scale of 100 in the engine. The script multiplies the data by 100 and scales the object by 0.01. |
| The armature object is named `root` | That object becomes the root bone, and the reference skeleton's root is `root`. |
| Mesh objects are renamed `Geo_<name>` | Unreal's names are case-insensitive (Epic: "FNames are case-insensitive"), so a mesh object `Head` collides with the bone `head`. |
| One UV set per mesh | Unreal reads the first UV set in the file as channel 0, the one materials sample. A file that kept an older layout ahead of the current one had every texture mapped through the wrong layout. `--uv` names the layer to keep; without it the render layer is kept. |
| Bone axes: primary Y, secondary X; no leaf bones | Matches the reference skeleton's bone orientations. |
| FBX scale applied as "FBX scale none"; no baked animation; quads kept | The scale layout above is already exact. |
| Smoothing by face, tangent space written, custom normals kept | A mesh split from another keeps its seam smooth. |

Done when `export-info.json` lists exactly one UV set per mesh, and `jam engine check --kind skinned` reports the mesh on the intended skeleton with a root bone scale of 1.

`--per-mesh` also writes one file per mesh object, each with the same armature, for a project that imports meshes of one character separately.

Normal maps baked in Blender have green up; the engine's convention is green down, so import them with `--normal-green up` (the default) and the import flips them ([import.md](import.md#textures)).
