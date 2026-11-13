# Outfit for an existing body

An outfit delivers its own pieces: the **outfit body** (garments and footwear, open at the neck and wrists), and when it has one, a **hat** and its **hat hair**. It is worn with the body's head and hands, and with the body's own hair when there is no hat. Generated heads, hands and hair are discarded.

Throughout, `<W>` is the run folder `Art/.scratch/<asset>/<run>`, `<S>` and the command form are as in [SKILL.md](../SKILL.md), `<Name>` is the outfit's piece suffix (a PascalCase word, for example `Ranger`), and **the body** names four files its delivery's `README.md` lists ([body.md](body.md#delivery)):

- `BODY_SPEC`: the body's `character.json` ([character-spec.md](character-spec.md)). Every script below that reads the body takes `--character BODY_SPEC`: it supplies the body's part names, its skin and hair colours and whether it has hair at all.
- `BODY_JOINTS`: Meshy's joint positions for the body's own generation (`meshy-joints.json`).
- `BODY_MODELLED`: the body's parts as modelled, straight arms.
- `BODY_RIGGED`: the body's parts and armature in the bind pose. It holds the same parts as `BODY_MODELLED` under the same names with the same vertices, part for part (a body whose hands were split off has them split in both); `to_bind_pose.py` stops and names the part when they differ.

A step marked **review** is decided under the run's effective review policy (`tools/jam/docs/review.md`); a human decision goes through the catalog ([SKILL.md](../SKILL.md#rules-for-every-branch)).

## 1. Concept (review)

Use `jam-concept` with the body's concept image attached as **character, pose and framing**, changing only the clothes; attach a hero shot or other source as **outfit only** when one exists. Offer two or three directions when the design is open. Write the brief's hidden-side and asymmetric details (pocket square side, hat bow side, back vents) before the turnaround.

Done when a concept is accepted under the run's review policy.

## 2. Turnaround (review)

Use `jam-turnaround`, but generate the five views one at a time in a single image session (with Codex, see `tools/jam/docs/codex-cli.md`), each with the concept, the body's turnaround view of the same angle (pose, angle, scale, background) and, from the second view on, the generated front (consistency). Join and crop with `tools/jam/crop_turnaround.py` so the record has its crop report.

- Backs invent things (pocket flaps on a jacket back) and copy the body's back hair; check backs against the brief and edit a view when it is wrong.
- The image tool sometimes refuses a side view for no visible reason. For a symmetric design, the opposite side view mirrored (`ImageOps.mirror`) is a faithful substitute; record it in the origin note.
- Hands and the face do not matter: they are discarded.

Done when the five views are accepted under the run's review policy.

## 3. Mesh (review)

Use `jam-model`, multiview from front, left, back and right, 2k geometry, 4k PBR textures. Either route works:

- **Meshy direct** (`meshy multi-image-to-3d create`, 35 credits), then **joints** (`meshy rigging create --input-task-id <mesh task> --height-meters <body height + hat>`, 5) and **quad remesh** (`meshy remesh create --input-task-id <mesh task> --topology quad --target-polycount 10000 --target-formats glb,fbx,blend`, 5). Use the remesh's `.blend`: it keeps quads.
- **Scenario** (`model_meshy-7-1-multi-image-to-3d` with `topology: quad`, `targetPolycount: 10000`, `savePreRemeshedModel: true`; 140 CU), then `model_meshy-rigging` on the remeshed asset (20 CU). Rigging returns five GLBs; the rigged character is the one with the mesh and the `clip0` action. The remesh arrives as triangulated GLB: weld it back into quads with `node tools/jam/jam.mjs blender <S>/blender/quads_from_glb.py -- <model.glb> <W>/remesh/model.blend <report.json>`.

Flags and model IDs were current when these were last run; check the provider's live help or schema first (`tools/jam/docs/providers.md`). Then `node tools/jam/jam.mjs blender <S>/blender/meshy_rig_joints.py -- <rigged_character.glb> <W>/rig-joints/meshy-joints.json`. Inspect the mesh from four sides against the turnaround.

Done when the mesh is accepted under the run's review policy, and the joints and the quad remesh are downloaded and their charges reconciled.

## 4. Fit (review)

Each command reads the previous one's output; render every result worn over `BODY_MODELLED` before going on.

1. **Warp**: `node tools/jam/jam.mjs blender <S>/blender/warp_to_body.py -- <remesh.blend> <rigged_character.glb> <W>/rig-joints/meshy-joints.json BODY_JOINTS <W>/fit/warped.blend <W>/fit/warp-report.json`. Each limb moves, turns and stretches from the outfit's joints onto the body's; the head and the feet keep their own size.
2. **Split**: `node tools/jam/jam.mjs blender <S>/blender/split_outfit.py -- <W>/fit/warped.blend BODY_MODELLED BODY_JOINTS <Name> <W>/fit/split.blend <W>/fit/split-report.json --character BODY_SPEC`. Faces are labelled by the nearest body part and their texture colour against the body's skin and hair classes: skin and hair beside the head go, the hands beyond the wrist planes go, anything else above the head joint is the hat (`--no-hat` when there is none; `--hat-hair` keeps the generated hair below the brim with the hat). Small holes are filled. When the report's labels look wrong (hat faces discarded as hair, collar kept as skin), tighten that class's `hsv` window in `BODY_SPEC` and split again.
3. **Conform**: `node tools/jam/jam.mjs blender <S>/blender/conform_outfit.py -- <W>/fit/split.blend BODY_MODELLED BODY_JOINTS <W>/fit/conformed.blend <W>/fit/conform-report.json 4 --hair-under-hat --character BODY_SPEC`. The hat is fitted as one rigid piece (lift and uniform scale) to clear the head, footwear is scaled over the body's shoes, then every remaining point of the body inside the cloth is pushed out 4 mm and the pushes are relaxed. Later passes on the same hat take `--no-rigid-hat`, or the hat is lifted again.

Check from four sides, at the head, at both wrists and at the feet: no skin, hair or shoe through the cloth; the hat close to its natural height. Done when the pieces and the fit are accepted under the run's review policy.

## 5. Borders, bind pose, hat hair

1. `node tools/jam/jam.mjs blender <S>/blender/smooth_borders.py -- <W>/fit/conformed.blend <W>/uv/smoothed.blend`, then conform again (`--hair-under-hat --no-rigid-hat --character BODY_SPEC`): ragged collar and cuff edges become clean lines.
2. `node tools/jam/jam.mjs blender <S>/blender/to_bind_pose.py -- <conformed.blend> BODY_MODELLED BODY_RIGGED BODY_JOINTS <W>/uv/fitted-bind.blend <report.json> --character BODY_SPEC`: the pieces follow the body's surface into the bind pose (bent elbows).
3. With a hat, in this order:
   - `node tools/jam/jam.mjs blender <S>/blender/hair_under_hat.py -- <pieces with the hat> BODY_RIGGED <Name> <out> <report> --character BODY_SPEC` makes `Hair_<Name>`, the body's hair pressed in under the crown; hair below the hat's opening stays as it is. A body without hair gets none (the report says so); skip the cut below.
   - `node tools/jam/jam.mjs blender <S>/blender/seal_opening.py -- <pieces> BODY_RIGGED Hat_<Name> Hair_<Name> <out> <report> --character BODY_SPEC` closes the gap between the hat's opening and the head and hat hair (`-` in place of `Hair_<Name>` when there is no hat hair). Run it again whenever the hat hair changes.
   - `node tools/jam/jam.mjs blender <S>/blender/cut_covered.py -- <pieces> Hair_<Name> Hat_<Name> <out> <report>` cuts the hat hair's faces 2 cm and more inside the crown.
   - Check in Unreal, close up and looking up under the brim: hair a few millimetres off the scalp can vanish in the engine though it shows in Blender.

Done when no point of the body or the hat hair shows through any piece in the bind pose, and the opening shows no sky or gap.

## 6. UVs and textures (review)

1. `node tools/jam/jam.mjs blender <S>/blender/uv_outfit.py -- <pieces-in-bind-pose.blend> BODY_RIGGED <W>/uv/outfit-uv.blend <W>/uv/layout`, then `node tools/jam/jam.mjs python <S>/draw_uv_layout.py <W>/uv/layout/*-layout.json`. The outfit body is cut like a garment (armholes, waist, crotch, inner seams); layered garments that cannot flatten (an open jacket over a waistcoat) fall back to Smart UV Project and the report says so. Hats split at their folds.
2. `node tools/jam/jam.mjs blender <S>/blender/bake_outfit.py -- <W>/uv/outfit-uv.blend <provider maps dir> <W>/texture/outfit-textured.blend <W>/texture T_<Name>`, then `node tools/jam/jam.mjs python <S>/pack_orm.py <W>/texture T_<Name>`. The bake drops the generation's UV set afterwards, so `UV0` is the only one.
3. For a hat on a body with hair, `node tools/jam/jam.mjs python <S>/clean_hair_colour.py <T_<Name>_Hat_BaseColor.png> <same> <report> --character BODY_SPEC` repaints the body's hair colour where the generator painted it onto the hat; add `--widen` for a hat with no colour of its own near the hair's (grey, black), and skip it for a hat whose own colour is close to the hair's.

Done when `uv-report.json` shows no flipped faces and even density (P10–P90 within about 0.85–1.15), the textured pieces look like the mesh from four sides, and both are accepted under the run's review policy.

## 7. Weights, export, delivery (review)

1. `node tools/jam/jam.mjs blender <S>/blender/weight_outfit.py -- <textured pieces in bind pose> BODY_RIGGED <W>/rig/outfit-rigged.blend <report>`: the outfit body copies the body's weights from the nearest body surface (at most 4 bones), hats and hat hair are rigid on `head`. The armature is the body's, unchanged.
2. Test poses on the body wearing it: `node tools/jam/jam.mjs blender <S>/blender/render_pose.py` with `--pose reach`, `crouch`, `look`, `curl` and the bind pose, on the body's rigged file with the pieces added (`node tools/jam/jam.mjs blender <S>/blender/pick_objects.py` combines them; remove the body's hair when the outfit brings hat hair).
3. `node tools/jam/jam.mjs blender <S>/blender/export_ue.py -- <W>/rig/outfit-rigged.blend <W>/rig/ue SKM --parts-only` (pieces become `SKM_<Piece>_<Name>.fbx`) and `node tools/jam/jam.mjs blender <S>/blender/export_glb.py -- <rigged.blend> <delivery>/model/<asset>.glb` (keeps `UV0` only), then `node tools/jam/jam.mjs blender <S>/blender/relative_paths.py` on every delivered `.blend`.
4. Engine and game checks ([SKILL.md](../SKILL.md#engine-and-game)), with the CONFIG block of `<S>/unreal/import_outfit.py` set for this outfit. Register the `outfitParts` it returns with the game's outfit or wearable mechanism.
5. Assemble `Art/Assets/<asset>/<revision>/` (reference, provider originals and requests, body inputs, stages, source and the scripts you ran, rig evidence, unreal, model, `README.md`, `origin.md`, `brief.md`), register its run with the earlier stages carried, then the delivery.

Done when `node tools/jam/jam.mjs check-delivery --run <run.json>` passes, the delivery is accepted under the run's review policy, and the project's shared-skeleton test passes with the outfit in the game.

## Cost

One clean outfit: 45 Meshy credits direct, or 160 CU on Scenario. Image work runs on the chosen image route (`tools/jam/docs/images.md`). Retries cost a full mesh; most problems after the mesh are local work.
