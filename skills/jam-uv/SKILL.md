---
name: jam-uv
description: Unwrap or repair a mesh's UVs so its surface can be textured and baked, with seams where they hide, even texel density, no unintended overlap, padding for the texture size and a single UV set, proven by a UV report, a layout drawing and checker stills. Use when asked to unwrap a model, fix or redo its UVs, check texel density, stretch, overlap or padding, remove extra UV sets, or when a run's next step is uv.
---

# UV layout

The operation gives a mesh one **layout**: the map from its surface to a texture. It is defined by what goes in (a mesh with final topology, a texture size), what comes out (the same mesh with one UV set) and the evidence (a report within stated thresholds, a layout drawing, checker stills); the scripts here are one way to produce them.

`jam` below is `node tools/jam/jam.mjs`, the toolkit `jam-setup` installs. `<S>` is this skill's `scripts/` folder. Blender scripts run as `jam blender --factory-startup <S>/blender/<script> -- <arguments>`, Python ones as `jam python <S>/<script> <arguments>`; each script's header also gives the plain `blender` and `python3` line.

## Steps

1. **Read the texture size and the mesh.** The size is `textureSize` of `jam config show budgets.<name>`; with no project, the size the request gives. Measure what the mesh has: `jam python <S>/uv_report.py <model.glb> --out <work>/uv-before --texture-size <size>`. In a run, `jam run next <id>` names the step's guide: read it, it holds what applies only in that recipe. Done when you know which checks the existing UVs fail, or that there are none.
2. **Choose the route** from the table below. Done when one is chosen and its reason written down.
3. **Make the layout** by that route, as a new file beside the untouched input. Done when the unwrapped GLB exists.
4. **Prove it.** Each of these must hold:
   - `jam python <S>/uv_report.py <unwrapped.glb> --out <work>/uv --texture-size <size> --same-geometry-as <input.glb>` exits 0: one UV set, overlap at most 0.2% of covered texels, texel density P95/P5 at most 3, islands at least `size/256` pixels apart and half that from the border, and the geometry unchanged. State other thresholds with `--max-density-spread`, `--max-overlap` and `--min-gap-px` when the asset needs them, and say why in the record.
   - Overlap or UVs outside 0-1 that are meant (mirrored halves, stacked repeats, a tiling material) are declared: `--declare-overlap "<why>"`, `--declare-tiling "<why>"`. The report records the reason.
   - `jam blender --factory-startup <S>/blender/render_checker.py -- <unwrapped.glb> <work>/stills --texture-size <size>` wrote the fixed views and one sheet.
5. **Look at two images:** `uv-layout.png` and the checker sheet. Done when the seams lie where the table below says they hide, the squares are of one size and unstretched on every surface a player sees, and no island is a sliver that wastes its padding.
6. **Record** (below), or hand over the model, the report and the two images when there is no run.

## Routes

| Route | Choose when | Make the layout |
| --- | --- | --- |
| **Keep** | The existing UVs pass the report, or fail only on what you can declare (a bought kit's stacked trim-sheet islands) | Nothing changes; when the file has several UV sets, `strip_uv_sets.py <in.glb> <out.glb> --keep <n>` leaves the one the textures use |
| **Seams** | Organic and deforming meshes: few large islands, cut where the cuts hide | `unwrap.py -- <model> <work> --texture-size <size> --method seams`, with `--seam-hints <file>` for a figure or any mesh whose cuts you can name |
| **Projection** | Boxy, hard-surface meshes, and dense generated ones with no clean seams | `unwrap.py -- <model> <work> --texture-size <size> --method smart` |
| **Automatic** | You cannot tell which of the two fits | `unwrap.py -- <model> <work> --texture-size <size>` tries seams, then projection, and reports which passed |
| **Provider** | The mesh route offers an unwrap and local results fail the thresholds | Through the provider's document, with the job ledger; then prove it as any layout |

Where seams hide: on the side facing away from the camera and down (the back of a head, the underside of an arm, the inside of a leg); along edges that are hard anyway (a box's corners, a hem, a sole); along borders between materials. `unwrap.py` prefers these by itself; hints say where the cuts of a particular mesh go. For a two-legged figure with a landmark file (the joint positions `jam-rig` uses), `jam python <S>/seam_hints_from_landmarks.py <landmarks.json> <work>/seam-hints.json` writes garment-style hints.

Read [references/seams.md](references/seams.md) before writing or editing a hints file, and when `unwrap.py` reports pieces it halved or projected instead. [references/scripts.md](references/scripts.md) lists every script's arguments, outputs and report fields.

`unwrap.py` welds vertices, writes one UV set, and replaces textured materials with plain ones, because the old textures no longer fit: the `texture` step bakes them across from the input file.

## Evidence already made

Reuse evidence that exists for this exact file: a report, drawing or still made by you, a sub-agent or an earlier step counts when the file's hash is unchanged (`jam measure` prints it). Measure or render again only when the evidence is missing, older than the file, or contradicted by something you see. Checker stills answer questions about stretch; record a turntable only when a person asks for one.

## Record

```
jam run record <id> uv --file <unwrapped.glb> --evidence report=<work>/uv/uv-report.json --evidence layout=<work>/uv/uv-layout.png --evidence checker=<work>/stills/<label>-sheet.png --note "<route, thresholds, and anything declared>" --tool "<tool and version>" --accept "<what you checked>"
```

- Kept UVs: the note says why the existing layout suffices, and `--file` is that file.
- One operation that produced several steps (a provider result that arrives unwrapped and textured, or an unwrap and bake that merge a model's materials): `jam run record <id> topology uv texture --file <model.glb> ...` or `jam run record <id> uv texture --file <model.glb> ...`, with each step's evidence in the same call.
- Work that starts from an existing file: `jam run start <recipe> <id> --from uv`, and the record takes `--source "<origin>" --source-evidence <file>` alongside `--tool`.

A new layout makes the textures stale: the `texture` step follows it.

## Without a run

Every step above works on a lone file: pass the texture size and thresholds as arguments, write into a folder you choose, and hand back the unwrapped model, `uv-report.json`, `uv-layout.png` and the checker sheet with the route and its reason.

## When a script surprises you

[references/validation.md](references/validation.md) says what each script was run on, with the numbers seen and what has not been tried. Read it before trusting a script on a kind of mesh it does not list.
