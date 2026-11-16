# Texture routes

What each route of [SKILL.md](../SKILL.md) takes, gives and gets wrong. `<S>` is the skill's `scripts/` folder; Blender scripts run as `jam blender --factory-startup <S>/blender/<script> -- <arguments>`.

## Bake

`bake_textures.py -- <target> <work> --source <model> --size <N> [--normal-source <model>] [--maps basecolor,normal,roughness,metallic]`

- **Target:** final topology, one UV set (from `jam-uv`). **Source:** anything that looks right and lies on the target, with any UVs and any number of materials.
- **The two must coincide.** The script measures it and stops when 95% of points are not within 3% of the bounding diagonal. A remesh that came back rescaled goes through `jam-retopo`'s `fit_to_source.py` (or `transfer_color.py`) first.
- **Detail in a second file:** a generation often gives a dense untextured mesh and a reduced textured one. Bake colour from the textured one (`--source`) and normals from the dense one (`--normal-source`).
- **Same model, new UVs:** the old file is the source, the newly unwrapped one the target. Several materials merge into one this way.
- **What it writes:** `<stem>_basecolor.png`, `<stem>_normal.png` (tangent space, green up), `<stem>_orm.png` (R occlusion = 1, G roughness, B metallic) and the GLB with one material reading them. A map that comes out constant becomes a material value instead of a texture (`materialValues` in the report): a model with one roughness and no metal carries only a base colour map.

Reading `bake-report.json`:

| Field | Meaning | Act when |
| --- | --- | --- |
| `hitShare` | Share of the target's texels whose ray found the source | Under 0.98 the script fails: the models do not coincide, or the target has surfaces the source lacks. Raise `--reach` (default 0.004 of the bounding diagonal) for a loose fit |
| `hitShareTightPass` | The same for the first, short pass | Much lower than `hitShare`: the fit is loose; look for colour pulled from a neighbouring surface (a sleeve onto a hand) |
| `normalTexelsMadeFlat` | Share of normal texels reset to flat because the ray missed or hit a surface facing away | Over a few percent: thin parts close together; inspect the lit stills there |
| `targetToSourceDeviation` | How far apart the two surfaces lie | Over about 1%: bake detail will be soft or doubled |

Known limits: surfaces the source never had (a panel added in a repair, the inside of something the generator closed) take their neighbours' colour, which reads as a smear; paint or fill those by hand. Thin layers closer than the reach (a collar on a neck) can take each other's colour; the unlit stills show it as a fringe along the border.

## Carry colour

`transfer_color.py -- <target> <source> <work> --size <N>` is for the moment a remesh comes back: it lays the target onto the source (uniform scale and move), gives a target without UVs a simple projected layout, and bakes base colour only. Continue from the GLB it writes: unwrap it properly, then Bake for the delivered maps. Its report's `aligned` holds the scale and offset applied, and `deviationShareOfDiagonal` how well the two then coincide.

## Shrink

`resize_textures.py <in.glb> <out.glb> --max-size <N>` scales down every embedded image over the size, drops images no material reads, and stores identical images once. It edits the file directly, so the mesh, UVs, skin and animations are untouched: safe on a rigged delivery. Texture memory falls by four for each halving.

## Retexture

The configured provider route's retexture capability (`jam provider list` shows which provider has it; its document under the toolkit's `docs/providers/` has the request fields, limits and current prices) repaints an existing mesh from a prompt or images. This step may spend: open the job (`jam job open <id> texture ...`) before submitting, and poll the job for its result.

- **Decide whether it keeps the UVs.** Keeping them preserves an accepted layout and density; a new layout from the provider needs `jam-uv`'s report again. After any geometry change, do not keep the old UVs.
- **Give it images of every surface the mesh has**: an unseen back comes out invented. For a bought model in the game's style, the references are the style's approved images (`jam-style`), named as style only.
- **Expect a softer result than an original generation bake.** When the original texture exists and only the mesh changed, Bake it across instead: it is free and sharper.
- **Check what came back:** the mesh may be rescaled (`fit_to_source.py --measure-only`), the maps larger than asked (`texture_report.py`), metal smeared onto wood (unlit and lit stills).

## Paint or procedural

Flat-coloured low-poly models need no texture at all when one material per colour fits `maxMaterials`; over it, give each colour a patch of one small texture (unwrap with `jam-uv`, Bake the model onto itself at 64 to 256 pixels). A tiling material is declared as tiling in the UV report.

## Faults to look for in the stills

| Fault | Shows in | Usual cause |
| --- | --- | --- |
| A line of wrong colour along a seam | Unlit close-up | Padding too small for the size, or colour pulled from a neighbour |
| Grey, black or smeared patches | Unlit, backs and undersides | The source had no surface there |
| Scrambled texture everywhere | Any view | The file has a second UV set ahead of the baked one (`uv_report.py`, `strip_uv_sets.py`) |
| Shading flips across a seam | Lit | Normal map baked for other normals, or green inverted |
| Shine on cloth or wood near metal | Lit | Metallic bleeding across islands |
| Blurry beside sharper siblings | Lit close-up beside an accepted asset | A retexture where a bake was possible, or texel density too low |
