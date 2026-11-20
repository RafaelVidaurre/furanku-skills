# jam-3d-retopo scripts

Every script takes explicit arguments, writes only inside the output folder or file it is given, prints one summary line, and exits 0 on success, 1 when its own check fails (the report is still written), 2 on wrong input. `--help` after `--` prints the arguments. Blender scripts were written for Blender 4.3 and newer and validated on 5.1.

| Script | Run with | Command line | Writes |
| --- | --- | --- | --- |
| `topology_report.py` | `jam python` | `<model.glb> --out <report.json> [--max-triangles N] [--target-triangles N] [--max-materials N] [--min-quad-share F] [--require-closed] [--allow <check>=<reason> ...]` | The report: metrics, one row per check, the named exceptions |
| `blender/decimate.py` | `jam blender` | `<model> <out-dir> --target-triangles N [--max-triangles N] [--name <stem>] [--symmetry x\|y\|z] [--no-weld] [--max-deviation F]` | `<stem>.glb`, `decimate-report.json` |
| `blender/quad_remesh.py` | `jam blender` | `<model> <out-dir> --target-faces N [--name <stem>] [--symmetry] [--voxel-size M] [--pre-decimate N] [--max-deviation F]` | `<stem>.blend` (quads), `<stem>.glb`, `quad-remesh-report.json` |
| `blender/quads_from_tris.py` | `jam blender` | `<model> <out-dir> [--name <stem>] [--min-quad-share F]` | `<stem>.blend` (quads), `quads-report.json` |
| `blender/fit_to_source.py` | `jam blender` | `<candidate> <source> <out-dir> [--name <stem>] [--measure-only] [--max-deviation F]` | `<stem>.glb` (unless `--measure-only`), `fit-report.json` |
| `blender/render_wire.py` | `jam blender` | `<model> <out-dir> [--label <text>] [--style wire\|clay] [--views ...] [--focus NAME=X,Y,Z,SIZE ...] [--resolution N]` | `<label>-<view>.png`, `<label>-sheet.png`, `<label>-stats.json` |
| `blender/edge_stretch.py` | `jam blender` | `<rest model> <posed model> <out-dir> [--max-stretch 2.0] [--label <text>]` | `<label>-edge-stretch.json` |
| `blender/make_fixtures.py` | `jam blender` | `<out-dir>` | The generated models the tests use |

## Reading the topology report

| Check | Fails when | Usual meaning |
| --- | --- | --- |
| `triangles`, `materials` | Over the limits passed | Over budget |
| `non-manifold-edges` | An edge has more than two faces | Fused shells or an internal face; breaks baking and collision |
| `degenerate-faces` | A triangle has no area | Slivers left by a reduction; harmless when few, drop them when re-exporting |
| `duplicate-faces` | Two triangles use the same three points | Doubled geometry; z-fights |
| `small-parts` | A connected piece has fewer than 0.2% of the triangles (at least 8) | Floating debris from generation |
| `open-edges` (with `--require-closed`) | An edge has one face | A hole; expected on open garments, hair cards and props open at the back |
| `quad-share` (with `--min-quad-share`) | Too few triangles pair into quads | Not a quad mesh |

`parts` counts connected pieces and is not a check: a bucket and its handle are two. `quadPairShare` is an estimate made from triangles (two triangles count as a quad when the edge they share is the longest edge of both): a true quad mesh reads about 0.85 to 1.0, a decimated or generated triangle mesh about 0.5. For the exact figure open the `.blend` or `.fbx` that keeps the quads with `render_wire.py`, whose stats file counts real polygons.

## Stills

Views are `front`, `back`, `left`, `right`, `three-quarter`, `back-three-quarter`, `top`, `under`; `left` looks at the model's own left side. `--focus NAME=X,Y,Z,SIZE` adds a close-up: X across the width, Y up from the base and Z back from the front, each as a share of the bounding box from 0 to 1, and SIZE as a share of the height. `--style clay` drops the wireframe, which shows carved grooves, dents and creases that a texture hides: use it to inspect a generated mesh before reducing it.

## Tests

`python3 -m pytest skills/jam-3d-retopo/scripts -q` runs the report maths and GLB reader anywhere, and the Blender scripts on generated models when Blender is found (`BLENDER=<binary>`, or `blender` on PATH); without it those tests are skipped with a message saying so.
