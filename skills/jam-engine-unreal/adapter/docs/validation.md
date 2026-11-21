# What was validated

Project A and project B below are two private projects used read-only for testing: UE 5.8 with 4,108 packages, and UE 5.9 with 1,198 packages.

No Unreal editor was available where this adapter was assembled, except for the inventory, the previews, the animation import and the stored sources of imports (below). Nothing else here was run in an editor after it was changed. Read each row as: where the code came from, what was changed, what was run since.

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
| `import_animation.py` | **New**, written for this adapter; run on 2026-11-20 (below) | |
| `import_static.py` | **New**, written for this adapter; run on 2026-11-21 ([below](#stored-sources-of-imports)) | |
| `inspect_asset.py` | **New.** Run on 2026-11-21 only to read stored sources back ([below](#stored-sources-of-imports)) on a static mesh, a texture, a sound and a skinned mesh, on 5.8.4 and 5.9.0; its other facts were not compared with the files. Through a commandlet the static mesh's vertex count (the static-mesh editor subsystem has no instance there) and the sound's sample rate came back under `unavailable`. Bounds, slots, skeleton, vertex and section counts and collision shape counts use calls from the jam's checks; triangle count, LOD count, Nanite state, bone names, sound and texture facts use calls the jam did not make | Each fact is read separately; one the engine refuses is named under `unavailable` and left out of the receipt |

## The inventory (`engine_inventory.py`, `jam_unreal/packages.py`, `editor/inventory.py`)

Written for this adapter, not from the jam. On 2026-11-17, on a Mac:
- **Fixtures:** the package reader matched the Asset Registry of Unreal 5.8.4 and 5.9.0 on fixture packages each engine wrote (`commands/test/fixtures/inventory/`) for classes, tag values, and hard and soft package references.
- **Real project:** it matched 5.8.4's registry on a real project of 4,108 packages: 0 differences in 15,390 tag values and 5,262 references. It read all of them in 2.4 s.
- **Through a real 5.8 commandlet,** on the fixtures, `editor/inventory.py` ran in two ways. `check --kind inventory` found no differences. The `--engine` fallback filled two packages that were forced to be unread.
- **Second project:** on a 1,198-package 5.9 project, the check through a real 5.9 commandlet agreed except for packages whose class comes from a project module the editor could not load. It reports that per class.
- **Result files** of projects whose `.uproject` is not at the project root were written where the adapter did not look. They are now written relative to the `.uproject`'s folder.
- **The `commandlet` route** used to hang on that Mac: `UnrealTraceServer`, which the editor starts, kept the editor's output pipe open after the editor exited. The transport now captures output in files, and those runs used it.

**Property values** (`jam_unreal/fields.py`, `packages.py`, `hierarchy.py`), checked on 2026-11-18:
- **Fixtures,** written by 5.8.4 and 5.9.0 (`make_fixtures.py`): data assets of a Blueprint class with 39 variables of every kind (instanced structs, per-platform values, formatted and localized texts among them), a Blueprint class hierarchy, actor Blueprints composed of components (added, inherited and changed, native), a level sequence whose shot metadata holds optionals.
  - **Against the engine:** every value the reader finds on those objects and their components was read with `get_editor_property` in the same engine (`dump_fields.py`, `fields.json`) and agrees; 5.8's Python cannot open an instanced struct, so those values come from its exported text there. Properties the editor's Python cannot read (protected) are listed in `fields.json` and not compared.
  - **References:** each one in the fields is one of its package's references, or an object of the same package.
- **The property tag layout before UE5 1012** is tested on a stream built from the engine's loader (`FPropertyTag`), at 1010 and 1011: no installed engine writes such a package.
- **Delegates, field paths and text histories** that no fixture holds (argument-data formats, currencies, dates, string tables, text generators: no stock engine module registers one) are tested on streams built from the engine's serializers.
- **Control Rig links,** 2026-11-21: on a Control Rig asset each of 5.8.4 and 5.9.0 wrote (`commands/test/fixtures/rig/make_rig.py`), the reader gives each link's two pin paths as the editor's own `get_pin_path` read them (`links.json`). The rig hierarchy still gets `fieldsError`.
- **Real project,** project B (5.9), read-only, through a wrapper project: with every class listed, all 1,198 packages and their 3,793 components and subobjects were read with no unparsed value. 50 subobjects (Control Rig graph links and one rig hierarchy) got `fieldsError`: their classes serialize themselves without tagged properties. Links are read since (above); this project was not read again. Before this work 73 values were unparsed (sync markers, pin types, sampling data, Slate vectors, per-platform frame rates, retarget settings, a localized text).
- **Timing:** project B's full scan with `/Script/Engine.DataAsset` listed takes 2.9 s through `jam engine inventory --full`, 1.4–2.0 s when nothing changed, Node start-up and validation included.

**Effective values** (`editor/fields.py`, `--engine`), 2026-11-18, through real headless editors (commandlet transport):
- **Fixtures:** 5.8.4 and 5.9.0 gave the values in `effective.json`, which the tests replay: inherited Blueprint defaults (a data asset that sets only `Damage` gets `Weight` and `Tag` from its parents), actor defaults, each Blueprint's components as the editor composes them, and the `Character -> Pawn -> Actor` parents that select a Character Blueprint under `Actor`. Every value a file sets equals the effective one. A first run takes 30–55 s (two editor starts when the engine finds new parents), later runs one start.
- **Project B,** listing `/Script/Engine.DataAsset`: the file reader selected 5 assets through the project's headers; the editor added the `PrimaryDataAsset -> DataAsset` parent and selected 28 (all 19 `Outfit`s, the sound event tables, input actions). The 28 engine-valued assets agree with the file's values on every property a file sets, and add the defaults the files leave out: `MassKg: 75.0` on 7 outfits, `Accessories: []` on 14, `ExteriorLpf: 8000`, `InteriorLpf: 8000` and `Priority: 1` on the acoustic presets. The run took 330 s the first time (two editor starts) and 120 s afterwards: this project's editor takes about 100 s to start on that Mac.
- **The project's module did not load at first:** its `Binaries` folder is a link to another volume, so the library paths the Mac build writes, relative to where the build thought the library was, resolve from the wrong place. The check used an editor project in the wrapper that links the real Content, Config, Plugins and Source and holds a copy of the module with absolute library paths. A project laid out like this needs the same, or its Binaries as a real folder.
- **Not checked:** engines other than 5.8 and 5.9; C++ headers whose `UCLASS(...)` nests parentheses more than two deep (the parse skips such a class).

## Animation import (`engine_import.py --kind animation`, `editor/import_animation.py`, `jam_unreal/gltf.py`)

Written for this adapter. On 2026-11-20, on a Mac, through real headless editors (commandlet transport, `-nullrhi`), on scratch projects holding only the fixtures of `commands/test/fixtures/animation/` (a column skinned to a three-bone chain, made in Blender 5.1):
- **5.9.0 and 5.8.4:** `test_animation.py`'s editor test passed on both (`JAM_UNREAL_EDITOR=<UnrealEditor-Cmd>`): the skinned mesh imported by a plain import task gave a skeleton; a one-animation clip landed as one sequence on it (30 frames, 30 fps, 1.0 s, stored source project-relative), twice under the same id; a two-animation clip gave two sequences named after their animations; a clip whose spine bone is named otherwise was refused before import.
- **The motion arrived:** on 5.9 the sampled spine rotation of the imported sequences peaked at 39.4 degrees (keyed 40) and 59.5 degrees (keyed 60) at the keyed frames, back to under 1 degree at the end.
- **Through the toolkit:** with the adapter installed in a 5.9 scratch project, `jam engine show` listed the kind, `jam engine import --kind animation --target <receipt file>` resolved the receipt's skeletal mesh, and a whole `animation` run recorded its import step with the sequence id and skeleton.
- **A rig with dotted joint names** (`foot.l`, a rig bound by `jam-3d-rig`), later on 2026-11-20 on 5.9: the engine names those bones `foot_l`, and the first import refused the clip as lacking them. Joints are now compared under the names the engine gives bones (`_` for each character an object name cannot hold). The 34-frame clip then landed as one sequence (1.1 s, 30 fps) on the skeleton the plain import of the rig made, and the world positions of hips, right hand, feet and head sampled in the engine at four frames equalled the clip's within 0.01 cm. `test_animation.py`'s editor test passed again on 5.9.0 and 5.8.4.
- **Replacing and saving**, later on 2026-11-20 on 5.9.0 and 5.8.4: `test_animation.py`'s editor test passed again with the sequence named by `--name`, after the change that refuses to replace a sequence imported from another file: a byte-identical copy of the clip under another file name was refused before import, naming the sequence and the file it came from, while the same file imported twice kept its id. The failed-save path (`save-failed`) is covered only by the test with a fake editor bridge.
- **A later attempt of the same run**, later on 2026-11-20 on 5.9.0 and 5.8.4: the toolkit now passes the run's id (`--run`) and each sequence keeps it in its `jam.run` metadata tag. `test_animation.py`'s editor test passed on both with the attempts: `work/walk/1/clip.glb` then `work/walk/2/clip.glb`, each with `--run walk`, landed under one id, the tag read back by a new editor process from the saved asset; the first attempt's file with `--run walk-fast`, or with no run, was then refused, naming the sequence, its file and its run. Through the toolkit in a 5.9 scratch project, a run's second attempt replaced the first attempt's 34-frame sequence with its 42-frame clip under the same id (the engine reported 41 frame intervals over 1.3667 s, the stored source in the second attempt's folder), and an import of another clip under that name outside the run was refused.
- **Found on the way:** an import task given an Interchange pipeline as its options ignored it and built a new skeleton; the pipeline has to go to the Interchange manager as an override. A sequence moved after import resolved its stored source from its new folder, to a path outside the project; the command therefore imports in place under its final name.
- **Not checked:** real characters, root motion that travels, curves and morph targets, non-1 scale or other axes than glTF's, a `command` transport to a running editor, Windows.

## Stored sources of imports

`import_static.py`, and the source each import kind leaves on its assets, on 2026-11-21 on a Mac, through real headless editors (commandlet transport, `-nullrhi`), on scratch projects holding only the fixtures of `commands/test/fixtures/import/` (made in Blender 5.1) and a generated WAV:
- **Found:** the first version imported a model into a scratch folder and renamed the mesh, its texture and its material into the destination. On 5.8.4 and 5.9.0 each moved asset then resolved its stored source from its new folder, to a path outside the project, and the import was refused with `machine-path`.
- **Now** the model is imported in place: the project's Interchange pipelines for the file, then a naming pipeline of the adapter's that sets each asset's name and folder before anything is created. `test_import.py`'s editor test passed on 5.8.4 and 5.9.0, and failed on the first version: two props whose own material and image names collide (`Material`, `Image`) landed as `SM_<Name>`, `Textures/T_<Name>_Image` and `Materials/MI_<Name>`, each with one convex hull from its `UCX_` shape; the same file again was refused before import, naming the three assets; textures, a sound and a skinned mesh (no `--slot`, on a skeleton already in the project) were imported. A new editor process read every asset's stored source back as the project-relative file it came from, and `check --kind sources` found no machine path.
- **A false machine path:** on 5.9 a skinned mesh imported through Interchange stores node ids such as `Factory_\\SKMInstance\\LODContainer\...`, which the `strings` test took for a network share. It no longer does.
- **Not checked here:** `--slot` on a skinned import; Nanite and `--collision-complexity`; a `command` transport.

## Previews

`engine_previews.py`, `jam_unreal/previews.py`, `jam_unreal/thumbnails.py` and `editor/previews.py` were written for this adapter. Checked on 2026-11-18 on a Mac (Apple GPU, Metal):
- **Rendering in a commandlet.** `UnrealEditor-Cmd` started with `-AllowCommandletRendering -RenderOffscreen` and no `-nullrhi` initialises Metal (SM6) with no window, on 5.8.4 and 5.9.0. With `-nullrhi` the glTF exporter still writes meshes, but every material comes out empty, because baking needs the renderer.
- **Exporters.** On the fixtures and on project B (5.9): the PNG texture exporter, the WAV sound exporter and the glTF exporter wrote files the catalog opens, for static and skeletal meshes, materials and their instances (on the preview sphere), animation sequences (with their preview mesh) and skeletons. An actor Blueprint with no component exports a GLB with no mesh, which the adapter refuses.
- **Stored thumbnails.** On project B, 460 of 1,198 packages store one (JPEG); the commandlet-saved fixtures and all of project A store none.
- **Project B, every package** (5.9, through a wrapper; table in the design doc §3.5): 1,073 of 1,198 got a preview in 7 min 31 s the first time (376 textures, 398 sounds, 127 material instances, 82 static and 40 skeletal meshes, 28 animations, 11 materials, 2 skeletons, 9 stored thumbnails). 124 have no preview for their class; 1 failed: a Blueprint of a plugin the run disables. Nothing changed: 2.0 s. The previews take 809 MB, 457 MB of it texture PNGs.
- **Project A, every package** (5.8, read-only through a wrapper): 4,014 of 4,108 got a preview, about 96 minutes of first runs; 93 have no preview for their class and 1 failed (a Blueprint that is not an actor). Nothing changed: 1.1 s. The previews take 1.9 GB. Texture arrays were refused by the PNG exporter, so they get no preview.
- **First run cost:** baking a material compiles its shaders. On project B that averaged about 1 s per package; on project A the first editor process compiled for 7.5 min before its first preview, and a material instance with its own static parameters took 70–110 s. The derived data cache keeps them: afterwards 0.12 s per GLB on project B and 0.5–0.8 s per material instance on project A. Each editor process takes 20–60 s to start.
- **Looks:** an animation shows its preview mesh, which for a modular character can be a single part. Translucent material instances whose opacity is set at run time are invisible on the preview sphere.
- **A project module that will not load stops the editor.** project B's freshly built Mac module links its engine plugins through paths relative to the folder it was built in. Its `Binaries` folder is a symbolic link elsewhere, and the loader resolves those paths from the real folder, so the editor exits with "The game module 'Gamejam' could not be loaded". The run used a project folder in `/tmp` whose content, config and plugins link to the checkout, with its own copy of the module at a depth where those paths resolve.
- **Not checked:** a `command` transport to a running editor, Windows, and textures whose source is HDR or a UDIM set.

## Scripts that run in Blender (`commands/dcc/`)

| Script | Origin | Changed here | Run here |
| --- | --- | --- | --- |
| `export_skinned.py` | Jam: the character FBX export | Name, armature and UV layer are arguments; one combined file unless `--per-mesh` | Blender 5.1.2 on a synthetic rig: combined file, `--per-mesh`, named and default UV layer. The FBX was not imported into Unreal |
| `ucx_collision.py` | Jam: hulls for static set pieces | Shape points and names come from `jam_unreal/hulls.py`; writes a hull report | Blender 5.1.2 on a synthetic GLB: boxes, a prism and a hull below a height. The GLB was not imported into Unreal |
| `joint_positions.py` | Jam | Bones and armature are arguments | Not run |
| `conform_skeleton.py`, `anatomy.py` | Jam: the Mannequin rig fitting | [skeletons.md](skeletons.md#what-was-validated) | Synthetic figure only, as described there |

## Commands and their engine-free code

`engine_import.py`, `engine_inspect.py`, `engine_references.py`, `engine_check.py`, `collision.py`, `skeleton_reference.py`, `conform_skeleton.py` and the `jam_unreal` package are new. `python3 -m pytest commands/test` covers configuration, path mapping, receipts, script composition, the three transports against a stand-in for the editor, locks against a stand-in for Git, hull geometry, the coverage rule, joint comparison, the landmark file and the machine-path scan. Only the commandlet transport was run against a real editor (the sections above), and no lock against a real LFS server.

## Before relying on it

Run each command once against your editor on a throwaway asset and compare with this page: `inspect` first, since it is new. Report what differs to the adapter's source.
