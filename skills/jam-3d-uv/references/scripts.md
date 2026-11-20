# jam-3d-uv scripts

Every script takes explicit arguments, writes only inside the output folder or file it is given, prints one summary line, and exits 0 on success, 1 when its own check fails (the files are still written), 2 on wrong input. Blender scripts were written for Blender 4.3 and newer and validated on 5.1.

| Script | Run with | Command line | Writes |
| --- | --- | --- | --- |
| `uv_report.py` | `jam python` | `<model.glb> --out <dir> --texture-size N [--max-density-spread 3.0] [--max-overlap 0.002] [--min-gap-px N] [--declare-overlap "<why>"] [--declare-tiling "<why>"] [--same-geometry-as <other.glb>] [--no-layout]` | `uv-report.json`, `uv-layout.png`, and `uv-layout-over-base-color.png` when the model embeds a base colour texture |
| `strip_uv_sets.py` | `jam python` | `<in.glb> <out.glb> [--keep N]` | The GLB with that one UV set; nothing else in the file changes |
| `seam_hints_from_landmarks.py` | `jam python` | `<landmarks.json> <hints.json>` | The hints file |
| `blender/unwrap.py` | `jam blender` | `<model> <out-dir> --texture-size N [--name <stem>] [--method auto\|seams\|smart] [--seam-hints <file>] [--keep-seams] [--sharp-angle 60] [--no-material-seams] [--padding-px N] [--separate] [--max-density-spread 3.0] [--max-overlap 0.002] [--blend]` | `<stem>.glb`, `unwrap-report.json`, and `<stem>.blend` with `--blend` |
| `blender/render_checker.py` | `jam blender` | `<model> <out-dir> [--label <text>] [--texture-size 1024] [--views ...] [--focus NAME=X,Y,Z,SIZE ...] [--resolution N]` | `<label>-<view>.png`, `<label>-sheet.png` |
| `blender/make_fixtures.py` | `jam blender` | `<out-dir>` | The generated models the tests use |

`uv_report.py` and `strip_uv_sets.py` read the GLB directly: they need Python with numpy (and Pillow for the drawings), no DCC, and work on a file from any tool.

## Reading the UV report

Meshes that share one UV square are measured as one layout; materials that each fill the square with their own texture are measured apart, one entry under `layouts` each.

| Field | Meaning |
| --- | --- |
| `islands` | Connected pieces of the layout |
| `coverage` | Share of the 0-1 square covered by faces. Under about 0.4 the texture is mostly padding |
| `overlapShare` | Share of covered texels claimed by more than one face |
| `flippedShare` | Share of faces mapped mirror-wise. Up to 0.5% is taken as slivers; more is a mirrored island |
| `zeroAreaUVShare` | Share of faces with surface area and no UV area: they cannot hold texture |
| `texelDensityPxPerMeter` | Pixels per metre of surface at the texture size (P5, median, P95, weighted by area), reading 1 unit as 1 m |
| `densitySpreadP95overP5` | How uneven the density is; 1 is perfectly even |
| `padding.islandGapPx` | Smallest gap between two islands, in pixels at the texture size; `null` with `islandGapAtLeastPx` when it is wider than the search |
| `padding.borderGapPx` | Smallest distance from any UV to the square's edge |

Checks: `has-uvs`, `single-uv-set`, `overlap`, `flipped`, `zero-area`, `inside-unit-square`, `density-spread`, `island-gap`, `border-gap`, and `same-geometry` with `--same-geometry-as`. `--declare-overlap` accepts failing `overlap`, `flipped`, `zero-area`, `density-spread` and the gaps; `--declare-tiling` accepts `inside-unit-square` and `density-spread`. A layout that leaves the 0-1 square has no meaningful overlap or padding: those fields are `null` and their checks are left out.

Padding: the default smallest gap is `texture-size/256` pixels (4 at 1024, 8 at 2048), so each island keeps half of that as its own margin through two mip levels. `unwrap.py` packs with twice that (`--padding-px`, default `texture-size/128`).

## Checker stills

Views are `front`, `back`, `left`, `right`, `three-quarter`, `back-three-quarter`, `top`, `under`. `--focus NAME=X,Y,Z,SIZE` adds a close-up: X across the width, Y up from the base and Z back from the front, each as a share of the bounding box, and SIZE as a share of the height.

## Tests

`python3 -m pytest skills/jam-3d-uv/scripts -q` runs the report, stripping and hint maths anywhere, and the Blender scripts on generated models when Blender is found (`BLENDER=<binary>`, or `blender` on PATH); without it those tests are skipped with a message saying so.
