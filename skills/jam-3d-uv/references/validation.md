# What the jam-3d-uv scripts were run on

Run on 2026-11-16 with Blender 5.1.2 on macOS, Python 3 with numpy 2.4 and Pillow 11.3. Numbers are from those runs. "Viewed" means the images were opened and judged, not only written.

## Models

| Name here | What it is |
| --- | --- |
| Character | A provider's quad remesh of a generated character: 20,878 triangles after welding, one shell with layered clothing (jacket over shirt, scarf, beard, curly hair, hat), with a landmark file from an auto-rig's joints |
| Decimated prop | A generated prop (a mop in a bucket) reduced locally to 3,000 triangles |
| Reduced prop | The provider's own 5,075-triangle version with the provider's UVs |
| Bought bucket | A bought low-poly model, 976 triangles, 2 materials, planks mapped onto shared trim-sheet strips |
| Bought chair | A bought low-poly model, 170 triangles, flat colour read from UVs far outside 0-1 |
| Rigged character | A delivered rigged character, 2 materials each with its own texture set |

## Results

| Script | Run on | Result |
| --- | --- | --- |
| `uv_report.py` | Every model, before and after | Reduced prop (provider UVs): 735 islands, density spread 9.8, islands touching at 1024 px, coverage 55%: fails `density-spread`, `island-gap`, `border-gap`. Bought bucket: 90% overlap and 14% flipped faces; passes with `--declare-overlap`. Bought chair: fails `inside-unit-square`; passes with `--declare-tiling`. Rigged character: its two materials measured apart (18 and 355 islands, spreads 1.47 and 1.19). Layout drawings viewed, plain and over base colour |
| `unwrap.py`, seams with hints | Character at 2048, hints from `seam_hints_from_landmarks.py`, `--sharp-angle 180` | Passes: 847 islands, coverage 25%, overlap 0.14%, density spread 1.18, geometry unchanged. 1,174 seam edges cut the mesh into 32 pieces; three pieces (14,275 of 20,878 faces: torso with head, pelvis with legs) could not lie flat and were halved, and 5,334 faces of those were projected. Layout and checker stills viewed: sleeves, trouser legs, hands and shoes are single clean islands with even squares; the head, hair and jacket front are many small islands |
| `unwrap.py`, automatic | Decimated prop at 1024 | Seams failed with both solvers (overlap, flipped faces, spread 5.4); projection passed: 1,224 islands, coverage 13%, spread 1.17. Usable for a bake (see jam-3d-texture's validation), wasteful of texture |
| `unwrap.py`, automatic | Bought bucket at 1024 | Seams passed: 28 islands, coverage 42%, spread 1.06, no overlap, one shared layout for both materials. Checker stills viewed: even squares, the handle one opened tube |
| `unwrap.py`, automatic | Bought chair at 256 | Seams passed: 43 islands, coverage 48%, spread 1.08; hard edges kept (baked stills match the bought model) |
| `seam_hints_from_landmarks.py` | The character's landmark file | 8 loops, 8 paths, 4 side splits; every hint found edges |
| `strip_uv_sets.py` | The rigged character, given a stale second UV set ahead of the good one | One set left, materials pointed at it, skin joints and bind matrices identical, `jam measure` reads the result |
| `render_checker.py` | Character (with close-ups), decimated prop, bucket, chair | Stills and sheets viewed |

## What failed and was fixed

- A GLB's vertices are split along its old seams: the first character unwrap saw 1,443 disconnected pieces. `unwrap.py` now welds first.
- Welding lost the hard edges of flat-shaded models, and the baked chair came out smudged. The weld now keeps an edge hard where the input's normals differed across it.
- A loop hint took the ring nearest the joint, which on layered clothing was an inner shell; it now takes every ring around the point.
- A path hint whose ends landed on different shells cut nothing; it now stays on the shell of its first point.
- The least-stretch solver gives up on pieces that are not discs; such pieces are now halved front from back, then projected.
- Exact-margin packing took 82 s for the six faces of a box; layouts of 12 islands or fewer are packed by bounding box.
- The report counted two materials with their own textures as overlapping each other; they are measured apart.
- Overlap and padding of tiling layouts were measured on wrapped triangles and meant nothing; they are no longer measured.

## Not validated

- `--separate`, `--keep-seams` with a `.blend`, and `.fbx`, `.obj` or `.blend` inputs to `unwrap.py`.
- A rigged model through `unwrap.py` (it skips applying transforms and exports the skin; never run).
- A figure without layered clothing, a robe or skirt, and mittens, with landmark hints.
- A provider unwrap job: none was run.
- Hand-written hint files beyond one loop on a generated tube.
- The tests (`test_uv_scripts.py`, 14 cases; `test_uv_blender.py`, 7 cases on generated models) pass on this machine only.
