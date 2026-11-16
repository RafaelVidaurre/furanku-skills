---
name: jam-texture
description: Produce or redo a model's surface on its final UVs, by baking from a detailed or generated source, carrying colour between meshes, retexturing through the configured provider, packing channels and converting normal maps for an engine, and bringing texture memory within budget, proven by a texture report and stills under neutral light. Use when asked to bake textures, texture or retexture a model (including a bought one), re-bake after a UV change, merge a model's materials into one, pack ORM or another channel layout, flip a normal map's green channel, shrink textures, or when a run's next step is texture.
---

# Textures and materials

The operation gives a mesh its **surface**: the maps a metallic-roughness material reads through the mesh's one UV set. It is defined by what goes in (a mesh with final UVs, a source of appearance, a budget), what comes out (the mesh with its material and maps, as one GLB) and the evidence (a measurement, a texture report, stills); the scripts here are one way to produce them.

`jam` below is `node tools/jam/jam.mjs`, the toolkit `jam-setup` installs. `<S>` is this skill's `scripts/` folder. Blender scripts run as `jam blender --factory-startup <S>/blender/<script> -- <arguments>`, Python ones as `jam python <S>/<script> <arguments>`; each script's header also gives the plain `blender` and `python3` line.

## Steps

1. **Read the budget and what exists.** The budget is `textureSize`, `maxTextureMiB` and `maxMaterials` of `jam config show budgets.<name>`; with no project, the numbers the request gives. See what the model has: `jam python <S>/texture_report.py <model.glb> --out <work>/texture-before.json --max-texture-size <size> --max-texture-mib <mib> --max-materials <n>`. In a run, `jam run next <id>` names the step's guide: read it, it holds what applies only in that recipe. Done when you know which maps exist, which limits they break, and what the surface should look like (the source model, the turnaround, or the request).
2. **Choose the route** from the table below. Done when one is chosen and its reason written down.
3. **Make the surface** by that route, as a new file beside the untouched input. Done when the textured GLB exists.
4. **Prove it.** Each of these must hold, or be an exception you name with its reason (`--allow <check>=<reason>`):
   - `jam measure <textured.glb>`: texture memory at most `maxTextureMiB`, materials at most `maxMaterials`.
   - `jam python <S>/texture_report.py <textured.glb> --out <work>/texture-report.json --max-texture-size <size> --max-texture-mib <mib> --max-materials <n> --expect basecolor` exits 0: every image within the size, every expected map present, no unused or duplicate image, every texture on the first UV set. Name in `--expect` the maps the style needs (`normal`, `metallic-roughness`).
   - `jam blender --factory-startup <S>/blender/render_textured.py -- <textured.glb> <work>/stills` wrote lit and unlit views and one sheet of each.
   - With a turnaround or other reference: `jam python <S>/compare_reference.py <work>/compare.png --pair front=<work>/stills/<label>-lit-front.png,<reference front> ...` wrote the pairs side by side.
5. **Look at the sheets:** unlit first (seams, colour bleeding across islands, grey or black patches where the bake missed), then lit (shading breaks at seams, metal where there should be none), then the comparison. Done when you find no fault a player would see, and each one you accept is named in the record.
6. **Record** (below), or hand over the model, the report and the sheets when there is no run.

## Routes

| Route | Choose when | Make the surface |
| --- | --- | --- |
| **Keep** | The textures already fit the budget and the look | Nothing changes |
| **Bake** | The look exists on another mesh: the generated or high-detail source, the same model before its UVs changed, or a bought model whose several materials must become one | `bake_textures.py -- <unwrapped target> <work> --source <model> --size <textureSize>`, with `--normal-source <dense mesh>` when the detail lives in an untextured file |
| **Carry colour** | A remesh came back without colour, or rescaled and moved | `transfer_color.py -- <target> <source> <work> --size <size>` aligns it and bakes base colour through whatever UVs it has |
| **Shrink** | The look is right and only memory or size is over | `resize_textures.py <in.glb> <out.glb> --max-size <textureSize>`: geometry and UVs stay byte-for-byte |
| **Retexture** | The look must change (a bought model in the game's style, a recolour), or no source has it | The retexture capability of the configured provider route, through its document and the job ledger; images that show every surface the mesh has |
| **Paint or procedural** | Flat colours, tiling materials, or a person painting | In the DCC; then prove it as any surface |

Read [references/routes.md](references/routes.md) before the first use of Bake, Carry colour or Retexture: it holds their inputs, what the bake report means and the known failures. [references/engine-maps.md](references/engine-maps.md) covers loose maps for an engine: channel packing (`pack_maps.py pack`) and normal-map green (`pack_maps.py normal`), from `jam engine facts textures`. [references/scripts.md](references/scripts.md) lists every script's arguments and outputs.

The delivered GLB always uses glTF's conventions: base colour in sRGB, roughness in G and metallic in B of one texture (occlusion in R when baked), normals in tangent space with green up. An engine's packing and normal convention apply to the loose maps its import takes, not to the GLB.

## Evidence already made

Reuse evidence that exists for this exact file: a report or still made by you, a sub-agent or an earlier step counts when the file's hash is unchanged (`jam measure` prints it). Measure or render again only when the evidence is missing, older than the file, or contradicted by something you see. Stills answer questions about a surface; record a turntable only when a person asks for one.

## Record

```
jam run record <id> texture --file <textured.glb> --evidence report=<work>/texture-report.json --evidence unlit=<work>/stills/<label>-unlit-sheet.png --evidence lit=<work>/stills/<label>-lit-sheet.png --note "<route, source, and faults accepted>" --tool "<tool and version>" --accept "<what you checked>"
```

- Kept textures: the note says why they suffice, and `--file` is that file.
- A paid retexture: `--job <job>` instead of `--tool` (`jam job open` before submitting).
- One operation that produced several steps (a provider result that arrives textured at budget, or an unwrap and bake that merge a model's materials): `jam run record <id> topology uv texture --file <model.glb> ...`, with each step's evidence in the same call.
- Work that starts from an existing file (retexturing a bought model, re-baking after a UV change): `jam run start <recipe> <id> --from texture`, and the record takes `--source "<origin>" --source-evidence <file>` alongside `--tool`.

The record is refused when `jam measure` finds the file over the texture budget.

## Without a run

Every step above works on a lone file. Retexture a bought model: report, choose Retexture or Bake, prove, hand back the GLB with its report and sheets. Re-bake after a UV change: Bake with the old file as `--source` and the newly unwrapped one as the target. Pack maps for an engine: `texture_report.py --extract <dir>` writes the GLB's images as files for `pack_maps.py`.

## When a script surprises you

[references/validation.md](references/validation.md) says what each script was run on, with the numbers seen and what has not been tried. Read it before trusting a script on a kind of model it does not list.
