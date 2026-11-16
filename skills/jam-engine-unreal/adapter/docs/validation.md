# What was validated

No Unreal editor was available where this adapter was assembled. Nothing here was run in an editor after it was changed. Read each row as: where the code came from, what was changed, what was run since.

**Jam** means: run as part of the game-jam project this adapter was extracted from (Unreal 5.9, Blender 5.1, November 2026), in the form it had there. Every script from the jam was then changed mechanically: its body wrapped in `main(ARGS)`, project literals replaced by arguments, and its result returned instead of printed or written to a fixed file.

## Scripts that run in the editor (`commands/editor/`)

| Script | Origin | Changed here, not re-run in an editor |
| --- | --- | --- |
| `import_textures.py` | Jam: step 1 of the character import, through the editor's Python tool | Texture list, names and roles are arguments; green-channel flip is an argument (the jam always flipped); source bytes checked against a digest; stored source read back |
| `import_materials.py` | Jam: step 2 | Instances and slots are arguments; an existing parent can be used as is; two-sided is a flag per instance |
| `import_skinned.py` | Jam: steps 3 and 4 | One mesh per call; slots matched by exact name (the jam stripped a name prefix); with no slot given the imported materials are left (new branch); skeleton and physics asset are arguments, the physics asset optional |
| `import_audio.py` | Jam: sound import | Sources resolved from the project folder; the yield between items removed; stored source read back |
| `audio_variants.py` | Jam: random-variant source | Patch, toolset names and author are arguments |
| `collision.py` | Jam: prop collision measure and fit | Meshes are arguments (the jam read the game's prop definitions); the coverage rule is an argument; two game-specific cases removed (a console command for stacking crockery, a fixed skip list) |
| `references.py` | Jam: the referencer audit inside asset deletion | Listing without deleting is a new use of the same calls; deleting is optional |
| `check_skinned_import.py` | Jam: headless import check, by commandlet | Sources are project-relative arguments (the jam read a work folder outside the checkout) |
| `check_pose.py` | Jam: headless pose check, by commandlet | Skeleton, reference mesh, animations, frames and bones are arguments |
| `compare_bones_in_game.py` | Jam: during Play In Editor | Reference mesh name is an argument; fails clearly when it is not in play |
| `export_skeleton_reference.py` | Jam: reference export, by commandlet | Assets and output folder are arguments |
| `import_static.py` | **New, never run.** The jam imported static meshes by hand through the editor's static-mesh toolset ([import.md](import.md)) | Whole script. It refuses to overwrite, and reports what it could not apply under `unavailable` |
| `inspect_asset.py` | **New, never run.** Bounds, slots, skeleton, vertex and section counts and collision shape counts use calls from the jam's checks; triangle count, LOD count, Nanite state, bone names, sound and texture facts use calls the jam did not make | Each fact is read separately; one the engine refuses is named under `unavailable` and left out of the receipt |

## Scripts that run in Blender (`commands/dcc/`)

| Script | Origin | Changed here | Run here |
| --- | --- | --- | --- |
| `export_skinned.py` | Jam: the character FBX export | Name, armature and UV layer are arguments; one combined file unless `--per-mesh` | Blender 5.1.2 on a synthetic rig: combined file, `--per-mesh`, named and default UV layer. The FBX was not imported into Unreal |
| `ucx_collision.py` | Jam: hulls for static set pieces | Shape points and names come from `jam_unreal/hulls.py`; writes a hull report | Blender 5.1.2 on a synthetic GLB: boxes, a prism and a hull below a height. The GLB was not imported into Unreal |
| `joint_positions.py` | Jam | Bones and armature are arguments | Not run |
| `conform_skeleton.py`, `anatomy.py` | Jam: the Mannequin rig fitting | [skeletons.md](skeletons.md#what-was-validated) | Synthetic figure only, as described there |

## Commands and their engine-free code

`engine_import.py`, `engine_inspect.py`, `engine_references.py`, `engine_check.py`, `collision.py`, `skeleton_reference.py`, `conform_skeleton.py` and the `jam_unreal` package are new. `python3 -m pytest commands/test` covers configuration, path mapping, receipts, script composition, the three transports against a stand-in for the editor, locks against a stand-in for Git, hull geometry, the coverage rule, joint comparison, the landmark file and the machine-path scan. No transport was run against a real editor, and no lock against a real LFS server.

## Before relying on it

Run each command once against your editor on a throwaway asset and compare with this page: `import --kind static` and `inspect` first, since they are new. Report what differs to the adapter's source.
