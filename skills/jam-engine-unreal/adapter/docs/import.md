# Importing into Unreal

`jam engine import --kind <kind> ...` runs `commands/engine_import.py`; its header lists every argument. Sources are project-relative files; the receipt names each asset by its `/Game/...` id. How the command reaches the editor is in [transport.md](transport.md); which parts were run in an editor is in [validation.md](validation.md).

Where things go: pass `--destination /Game/<folder>`, or set the project's folders once in `jam.config.json` under `engine.facts.extra.destinations` (`static`, `skinned`, `animation`, `textures`, `audio`); the toolkit's own call (`jam engine import --kind <kind> --run <id>`) passes only the files, so set them. An asset is named after its file unless `--name` says otherwise. A file `<source stem>.import.json` beside a source can carry `name`, `dest`, `skeleton`, `slots`, `twoSided`, `physicsAsset` and `normalGreen` for it; flags win over it. Names take the prefixes in the `naming` facts, which are Epic's published ones (`SM_`, `SK_`, `AS_`, `T_`, `M_`, `MI_`; [naming conventions](https://dev.epicgames.com/documentation/en-us/unreal-engine/recommended-asset-naming-conventions-in-unreal-engine-projects)); Epic's own template content names skeletal meshes `SKM_`, and a project that follows it sets `engine.facts.naming.skeletalMesh`.

## Static mesh

`--kind static <model.glb> --destination /Game/Props/<Setting> --name <Name>` gives `<dest>/SM_<Name>`, `<dest>/Materials/MI_<Name>` and `<dest>/Textures/T_<Name>_<image>`.

The file goes through Interchange with the project's own pipelines for it, and then a naming step of the adapter's that gives each asset its final name and folder before anything is created: the importer's own names (`Material_0`, `Image_0`) would collide between props. Nothing is renamed afterwards, because an asset moved after import looks for its stored source from its new folder, outside the project. A file holding more than one mesh, or any of those names that exists already, is refused before anything is created. `--collision-complexity simple-and-complex` sets the trace flag `CTF_UseSimpleAndComplex`: physics uses the simple hulls, complex traces use the render mesh ([collision.md](collision.md)).

By hand: import the file straight into its destination folder, and rename nothing afterwards.

Done when `jam engine inspect <id>` shows the bounds you expect in metres, one material slot per material, and the collision you intended.

What the jam saw with glTF through Interchange (UE 5.9):

- A model whose front faces glTF +Z (Blender −Y) faces **+Y** in the engine at zero rotation, with its pivot where the file's origin was. The engine's own forward is +X: turn the actor when placing it, or state the difference per budget in the `authoring` facts.
- Materials become instances of Interchange's glTF material; the packed map is glTF's (roughness in green, metallic in blue).
- A glTF material exported from Blender is double-sided unless backface culling is on, and then gets the double-sided parent (`MI_Default_Opaque_DS`). For a one-sided surface set backface culling before export and confirm the parent is the one-sided one.
- The toolset's import builds the mesh with Nanite on, and the triangle count then read back is the reduced fallback. Setting `nanite_settings` from Python did not rebuild the mesh; the static-mesh toolset's `SetNaniteEnabled` did. The command reports the Nanite state in `--details` and leaves it as imported.

### Replacing a mesh

The command refuses a static mesh that already exists. An import cannot replace a loaded asset: deleting then renaming, consolidating, and an import task with replace all failed silently in the jam and left the old mesh or material in place. To replace one and keep its id:

1. Save and stop the editor.
2. Delete the mesh's `SM_`, `MI_` and `T_` files in the editor's checkout ([locking.md](locking.md) first).
3. Start the editor fresh and import before any Play.
4. Read the result back: `jam engine inspect <id>`, and a capture when the look changed.

When only geometry changed, delete just the `SM_` file, import, and assign the existing material instance to the slot; materials and textures stay untouched.

## Textures

`--kind textures --texture color=<file> --texture normal=<file> --texture masks=<file> --destination /Game/<folder>`, or the files alone, each taking its role from its name (`_Normal` or `_N`: normal; `_ORM`, `_Masks` or `_MetallicRoughness`: masks; anything else: color). A normal map gets normal-map compression without sRGB; a masks map (occlusion, roughness, metallic in red, green, blue) gets mask compression without sRGB. `--normal-green up|down` states the convention of the files given (default `up`, what Blender and glTF bake); when it differs from the engine's fact (`down`), the texture's green channel is flipped on import.

## Skinned mesh

One skinned mesh per import, on a skeleton profile from the facts ([skeletons.md](skeletons.md)):

```
jam engine import --kind skinned <mesh.fbx> [--skeleton <profile id>] [--name <Name>] [--destination /Game/Characters/<Name>]
    [--slot "<material slot>=<color.png>,<normal.png>,<masks.png>"] ... [--two-sided <material slot>] ...
```

It runs three editor calls, each saving what it made (on the `commandlet` route each is its own editor process): textures into `<dest>/Textures`; a parent material `M_<Name>` with `BaseColor`, `Normal` and `ORM` parameters and one instance per `--slot` in `<dest>/Materials`; then the mesh into `<dest>/Meshes` on the profile's skeleton with each slot's instance and the profile's physics asset. A call whose assets the editor did not save fails the import with `save-failed`. An editor without a renderer (`-nullrhi`) saves the parent material uncompiled, and the receipt's notes say so; its shaders compile where it is next rendered. Give one `--slot` per material slot in the file, named exactly as the slot is; with none, the mesh keeps the materials it imported with and only the mesh step runs. Without `--skeleton` the profile comes from the file's `.import.json` (written by `conform-skeleton`), else the project's only or default profile. `--slot "<slot>=/Game/<material>"` assigns an existing material instead; `--parent-material` uses an existing parent with those three parameters.

- Export the FBX as [skinned-export.md](skinned-export.md) describes.
- `--two-sided` is for an open shell seen from inside (hair, a hat, a cape): single-sided, the sky shows through it from below.
- The profile's physics asset has the reference character's proportions. A character that is grabbed, knocked over or ragdolled needs a physics asset fitted to its own body; pass `--physics-asset <id>`, or `none`.
- The command confirms the skeleton the mesh landed on and fails with `wrong-skeleton` otherwise: the importer can ignore the skeleton option.
- The import uses the legacy FBX and texture factories, which store a source path relative to the project.

Done when the receipt lists the mesh, `jam engine inspect` shows its skeleton and slots, and `jam engine check --kind sources` on the new assets has no problems.

## Animation clip

One glTF clip (`.glb`: the skinned rig with its named animations; a delivered clip holds one) onto a skeleton already in the project:

```
jam engine import --kind animation <clip.glb> --target <skeleton or skeletal mesh id> [--name <Name>] [--destination /Game/Characters/<Name>/Animations]
```

- `--target` is the skeleton, or a skeletal mesh whose skeleton is used. With `--run`, the toolkit also takes the receipt of the skinned import and passes its first asset, the skeletal mesh.
- The command reads the clip's skinned joints from the file and refuses it, before importing anything, when the target's skeleton lacks any of them (`retarget the clip onto this skeleton first`). Extra bones in the skeleton are fine.
- It imports through Interchange's generic pipeline with "import only animations" on the target skeleton, straight into the destination: one animation becomes `<dest>/AS_<Name>`, several become `<dest>/AS_<Name><animation name>`, the importer's own rule. With `--run` the toolkit passes the run's clip spec id as `--name`, and the run's id as the adapter's `--run`, which each sequence keeps in its `jam.run` metadata tag. Importing the same file again replaces its sequences under the same ids, and so does a later attempt of the same run (its clip lies in that attempt's folder); a sequence imported from another file by anything else, another run or an import outside a run, is never replaced: the import is refused before anything is imported, naming the sequence, its file and its run (import under another `--name`, or delete the old sequence first). An import outside a run clears the tag. Nothing is renamed afterwards, because a moved sequence looks for its stored source from its new folder and loses it.
- A sequence the editor did not save fails the import with `save-failed`.
- Each receipt entry carries `skeleton`, the skeleton the sequence plays on; `--details` adds its frame count, frame rate and length as the engine reads them.

Done when the receipt lists one sequence per animation in the file, each on the target's skeleton, and the details' frame count and rate are the clip's.

## Audio

[audio.md](audio.md).
