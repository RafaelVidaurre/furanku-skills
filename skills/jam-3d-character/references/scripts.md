# Character scripts

Reference for this skill's `scripts/` folder (`<S>`), used by [body.md](body.md) and [outfit.md](outfit.md). Each script's own header gives its command line. Everything a script knows about a character comes from the body's `character.json` ([character-spec.md](character-spec.md)), passed as `--character <path>`: part object names, height, material classes with their colours and roles, texture sizes, hands and influences. Anatomy (head, limbs, hands, feet) never comes from colours: `blender/anatomy.py` labels every vertex from the Meshy joints. Colours are read through one rule, `charspec.label_map` (first explicit window in spec order, else the nearest reference colour). Lengths inside the scripts are millimetres of the real character (model units are converted through `heightMeters`), tuned on the first body built with them. Run the scripts as they ship; a change that one character needs belongs in the spec or, when the spec cannot express it, in the script for every character.

`node tools/jam/jam.mjs python <S>/character.py run --character … --work <W> …` drives the default single-mesh flow (transfer, class check, topology, UVs, textures, rig, export) and stops at each review gate; `status --work <W>` shows where a run stands, `--dry-run` lists the commands.

Blender stage files are `character-*.blend`; the delivered map, material and Unreal file names are listed under [Unreal scripts](#unreal-scripts-sunreal).

## Blender scripts (`<S>/blender/`)

| Script | Reads | Writes | From the spec |
| --- | --- | --- | --- |
| `meshy_rig_joints.py` | Meshy's rigged GLB | joint positions as JSON | nothing |
| `spread_fingers.py` | generated mesh, joints, scale to the joints' space | `model-spread.glb` (textured, the bake source), `model-spread-geometry.glb` (welded, for the remesh), `spread-report.json` | `hands.cleanSide` (mirror that half, or none), `hands.fingers` and `fanDegrees` (fan, or skip with mittens) |
| `transfer_color.py` | remesh FBX, high-resolution GLB, texture size | colour texture in the remesh's own UV layout, aligned FBX | height (ray distances) |
| `split_parts.py` (swappable parts) | aligned FBX, colour texture | `character-parts.blend` with the head, hair and body parts; `model-snapped.fbx`; `split-stats.json` | part names; the hair role's class above `hairMinHeightShare`; the neckline role's class (or `neckHeightShare`) for the head/outfit border; no hair part: head and body only |
| `export_parts.py` | the aligned FBX (one mesh) or the parts file | `character-topology.blend`, `.glb`, `.fbx` | the body part's name, for one mesh |
| `anatomy.py` | imported by the rig and UV scripts | per-vertex body regions from the Meshy joints (head, neck, torso, pelvis, upper/lower arm, hand, thigh, calf, foot per side), wrist planes, hand vertex sets | `heightMeters` |
| `preview_classes.py` | model, colour texture | flat class renders from four sides, a texture-space label map (ambiguous texels magenta), `classes-report.json` (share per class, unclassified and ambiguous share, empty classes) | classes |
| `unwrap_parts.py` | topology file, colour texture, the body's Meshy joints | `character-uv.blend`, layout JSON, `uv-report.json` with `gate` (exits nonzero when it fails); keeps the old layout as `UV_Meshy` and writes the new one as `UV0` | anatomy seams from the joints, class borders as extra cuts, footwear role (else the anatomical foot), part names, texture sizes |
| `draw_layout.py` (run with `node tools/jam/jam.mjs python`), `export_uv.py` | UV file | layout images, UV `.glb` and `.fbx`, `geometry-check.json` | nothing (every mesh in the file) |
| `render_checker.py` | UV file | checker renders | part names, texture sizes |
| `bake_textures.py` | UV file, colour texture, high-resolution GLB, optional `--metallic-map <png>` | three maps per part (ORM blue = metallic), `character-textured.blend` and `.glb`, `texture-report.json` with `repairs` per part | each class's reference colour (the correction target), roughness and metallic; the source painting is kept unless `repair.hairline` / `repair.skinDarkSpots` ask (before/after images under `debug/`); part names and texture sizes |
| `render_textured.py`, `render_hair_check.py`, `render_parts.py` | a stage's Blender file | review renders; `render_hair_check.py` takes `--flat` (plain part colours with quad edges) or `--unlit` (base colour only) | part names; framing scales with the model |
| `render_wire.py` | any model | wireframe renders and stats | nothing |
| `fit_rig.py` | textured file, Manny's FBX, joints | `character-rigged.blend`, `character-rig-fit-pose.blend`, `rig-report.json` (`deformationCheck`), `vertex-regions.json` | height; part names; bone-heat weights limited per vertex to the bones of the anatomical regions around it; `hands.fingers` 5: fingers found from the hand region's shape (stops when fewer than four or no thumb), 0: hands on `hand_*` alone; `maxInfluences`; stops when a limb is not mainly on its own bones |
| `render_pose.py`, `joint_positions.py`, `edge_stretch.py` | rigged file, optionally a Manny animation FBX | pose and animation renders, joint positions, a stretch listing | nothing (framing from the model's height) |
| `export_ue.py` | rigged file, optional name prefix, `--parts-only` | `<prefix>.fbx` (the whole character), and with several parts `<prefix>_<part>.fbx` per mesh the armature deforms, `export-info.json`; `UV0` alone, custom normals kept | the name for the default prefix `SKM_<name>` |
| `export_glb.py` | rigged file | runtime GLB with `UV0` only (glTF maps textures through the first UV set) | nothing |
| `relative_paths.py` | a delivery folder and the `.blend` files in it to fix | those files with texture paths relative to the folder's `stages/texture` | nothing; without named files, the four delivered body files (`source/character-rigged.blend` and the topology, UV and texture stages) |

Fixed behaviour worth knowing:

- Colour classification: a class's `hsv` window decides first; otherwise the nearest reference colour, measured mostly by hue and saturation so a shaded garment stays in its class. The split and the bake use the same classes, so a window that fits the split fits the bake.
- `split_parts.py` moves vertices beside the hairline and the collar onto the colour borders and builds the scalp 1–3 mm under the hair. Its smoothing visits vertices in an order that changes between runs, so two runs differ by fractions of a millimetre; the colour projected onto `model-snapped.fbx` belongs to the run that wrote it.
- `unwrap_parts.py` reports `tubeCuts`: islands that were still tubes after the deliberate seams and were cut along the back. A long list means a garment the anatomical seams do not describe well (a robe, a skirt); check its checker render.
- `export_ue.py` writes bones in centimetres under an armature object named `root` scaled 0.01, as Epic's own export does, so the engine's root bone has scale 1. It names mesh objects `Geo_<Part>` because Unreal treats `Head` and the bone `head` as the same name, and it exports `UV0` alone.
- Normal maps are baked in Blender's convention; flip the green channel on import into Unreal. `import_1_textures.py` and `import_outfit.py` do.
- Tested shapes: one mesh (the default flow) for the first body's mesh recoloured, renamed and 1.65 m tall, with mittens, and without footwear; swappable parts as the first body was made (three parts plus split hands, reproducing its original outputs), without a hair part, and with mittens. A skirt or robe (no crotch between the knees and hips) runs through the tube cuts but has not been tried on a real model.

## Unreal scripts (`<S>/unreal/`)

They read the body's `character.json` for its name and parts, so nothing per character is edited into them. Delivered sources they expect (written by the Blender scripts): maps `stages/texture/T_<name>_<Part>_<kind>.png`, the whole body `unreal/SKM_<name>.fbx` and each part `unreal/SKM_<name>_<Part>.fbx`, material slots `M_<name>_<Part>`, where `<Part>` is the part's object name; an outfit's pieces `unreal/SKM_<Piece>_<Name>.fbx` and maps `stages/texture/T_<Name>_<Piece>_<kind>.png`.

| Script | Run as | Does | Configured by |
| --- | --- | --- | --- |
| `export_manny_reference.py` | headless commandlet | exports `SKM_Manny_Simple`, `MM_Idle`, `MF_Unarmed_Walk_Fwd`, `MF_Unarmed_Jog_Fwd` to `<JAM_UE_DIR>/out/` | env `JAM_UE_DIR`, `JAM_UE_MANNEQUINS` |
| `import_check.py` | headless commandlet | imports every FBX in `<JAM_UE_DIR>/import/` on `SK_Mannequin` into the throwaway folder `/Game/JamCheck`, reports skeleton, bounds, material slots, vertices and sections; saves nothing | env `JAM_UE_DIR`, `JAM_UE_MANNEQUINS` |
| `pose_check.py` | headless commandlet | evaluates Manny's idle and walk on the whole-body mesh `SKM_<name>` and on Manny, writes joint positions | env `JAM_UE_DIR`, `JAM_UE_CHARACTER` (the body's `character.json`; or `JAM_UE_MESH` naming the file), `JAM_UE_MANNEQUINS` |
| `compare_joints.py` | `node tools/jam/jam.mjs python <S>/unreal/compare_joints.py <ue-joints.json> <import-report.json> <blender joints dir> <out.json>` | compares those positions with Blender's, relative to the pelvis | the two animation names |
| `import_1_textures.py` to `import_4_save.py` | the editor's Python tool, one call each | imports the maps, builds a parent material `M_<name>` with one instance per part (the hair part's two-sided), imports `SKM_<name>` and every `SKM_<name>_<Part>` on `SK_Mannequin` with their instances and Manny's `PA_Mannequin`, saves | the CONFIG block, identical in all four: `delivery` (required), `character` (default `<delivery>/character.json`), `dest` (default `/Game/Characters/<name>`), `mannequins` |
| `import_outfit.py` | the editor's Python tool, one call | imports the outfit's pieces found in its `unreal/` folder and their maps under `<dest>`, one material instance per piece under the body's `M_<name>`, hats two-sided, hat hair on the body's hair instance; returns `outfitParts` (the body's head, hands and, without hat hair, its hair part meshes, then the outfit's meshes) to register with the game's outfit mechanism | the CONFIG block: `delivery`, `name`, `character` (the body's, required), `body_dest` (default `/Game/Characters/<body name>`), `dest` (default `/Game/Characters/Outfits/<name>`), `mannequins` |
| `compare_bones_in_game.py` | the editor's Python tool during Play In Editor | compares every character mesh's bones with Manny's | `SKM_Manny_Simple` as the reference; needs a Manny in the level |

Supply CONFIG values by sending `JAM_CONFIG = {"delivery": "Art/Assets/<asset>/<revision>"}` (plus any other key to override) ahead of the script's code in the same call to the editor's Python tool; the script merges it over its defaults. A missing required value stops the script with the key to set. The body steps were run on a three-part body; importing a separate hands part follows the same code path but has not been run in an editor yet.

The headless commandlets run `<engine>/Binaries/<platform>/UnrealEditor-Cmd` of the project's engine install. They need a project that holds Epic's mannequin content (`/Game/Characters/Mannequins` from the third-person template, or wherever `JAM_UE_MANNEQUINS` points).

## Body revisions (`<S>/blender/`)

| Script | Reads | Writes | From the spec |
| --- | --- | --- | --- |
| `split_hands.py` | rigged body; with `--modelled`, the body as modelled too | both files with the hands part split from the body part at an edge loop above each wrist, report (`samePartsAsRigged`) | the body and hands part names; armature `root`; Manny's `hand_*` and `lowerarm_*` bones |
| `bake_hands.py` | the split file, optional maps dir; with `--modelled`, the split modelled file | the hands part with its own `UV0` and maps `T_<name>_<Hands>_*` at the hands' texture size; the modelled file gets the same layout and material | name, hands part name and texture size |

## Outfit scripts (`<S>/blender/` unless noted)

Spaces: Meshy's joints and the body's modelled parts are in metres with the feet at 0 after scaling to the joints' height; the warp writes in that space; `to_bind_pose.py` moves the pieces into the rigged body's bind pose. Because both spaces are real size, millimetre and centimetre settings (cloth offset, cut margin, seal reach) mean the same for any body height. The modelled body is scaled so its top meets the joints' top (`meshBounds`): both must come from the same generation.

Scripts marked **spec** take `--character <body character.json>` and read the body's part objects, and its `skin` and `hair` classes, from it; a body without a `hair` part gets no hat hair.

| Script | Reads | Writes | Notes |
| --- | --- | --- | --- |
| `quads_from_glb.py` | a triangulated quad remesh GLB (Scenario) | welded quad mesh `.blend`, report | merges seam-split vertices, joins triangle pairs |
| `warp_to_body.py` | remesh `.blend`, Meshy rigged GLB and joints of the outfit, the body's joints | `Outfit` in the body's joint space | Meshy's armature object is scaled 0.01; `head_end` and `headfront` are markers, not joints; feet keep their length; widths are kept |
| `split_outfit.py` (spec) | warped file, body modelled, body joints, name | `Outfit_<name>`, `Hat_<name>` | labels by nearest body part and texture colour (skin and hair classes: their `hsv` window, else a window around `rgb`); `--no-hat`, `--hat-hair` (hat keeps generated hair) |
| `conform_outfit.py` (spec) | pieces, body modelled, body joints, offset mm | pieces outside the body | outfit pieces clear the outfit, head and hands parts, hats the head and hair; rigid hat fit, footwear pre-fit, push and relax; `--hair-under-hat`, `--no-rigid-hat`, `--hat-hair` |
| `smooth_borders.py` | pieces | pieces with smoothed open borders | conform again afterwards |
| `to_bind_pose.py` (spec) | pieces (modelled pose), body modelled, body rigged, body joints | pieces in the bind pose | every spec part in both body files, same vertices part for part; stops naming the part that differs |
| `hair_under_hat.py` (spec) | pieces with `Hat_<name>` in bind pose, body rigged, name | adds `Hair_<name>` | hair below the hat's opening (per angle) is left as it is; 2 mm off the scalp; no hair part: nothing added |
| `seal_opening.py` (spec) | pieces, body rigged, hat, hat hair or `-` | hat with its opening on the head | 2 mm outside, fading over 3 cm of the hat |
| `cut_covered.py` | pieces, covered object, wearable, margin cm | covered object without the faces the wearable covers | margin 2 cm inside the opening |
| `pick_objects.py` | `.blend:Object,...` sources | one `.blend` with those objects | materials and images come along |
| `strip_uv_sets.py` | a `.blend` (in place) | meshes with `UV0` only | for files made before `bake_outfit.py` dropped `UV_Meshy` |
| `uv_outfit.py` | pieces in bind pose, body rigged | `UV0` per piece (old layout kept as `UV_Meshy`), layout JSON, report | garment cut from the body's bone regions (Manny's bone names), Smart UV fallback, hats by Smart UV |
| `bake_outfit.py` | UV file, provider maps dir, prefix | `<prefix>_<Piece>_<BaseColor|Normal|Roughness|Metallic>.png`, textured file | removes `UV_Meshy` after baking; 2048 maps for `Outfit_*`, 1024 for the rest unless `<Piece>=<size>` is given |
| `weight_outfit.py` | textured pieces, body rigged | pieces skinned to the body's armature | `Hat_*` and `Hair_*` rigid on `head` |
| `<S>/draw_uv_layout.py` | layout JSON | layout PNG | GPU drawing is unavailable in background Blender |
| `<S>/pack_orm.py` | texture dir, prefix | `<prefix>_<Piece>_ORM.png` (R 1, G roughness, B metallic) | |
| `<S>/clean_hair_colour.py` (spec) | base colour PNG | the same with the body's hair colour repainted | `--widen` for a piece with no colour of its own near the hair's; needs numpy |

The Python helpers outside Blender need Pillow and numpy (`tools/jam/requirements.txt`, installed by `jam-setup`); use the `python` from `jam.local.json` when it is set.

Blender gotcha: remove vertex groups by name, never by index in a loop: removing one renumbers the rest.
