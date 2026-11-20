# What the jam-3d-retopo scripts were run on

Run on 2026-11-16 with Blender 5.1.2 on macOS, Python 3 with numpy 2.4. Numbers are from those runs. "Viewed" means the stills were opened and judged, not only written.

## Models

| Name here | What it is |
| --- | --- |
| Dense character | A generated character, 663,014 triangles, geometry only, closed, two connected parts |
| Remeshed character | A provider's quad remesh of it, delivered as 20,881 triangles, 5% larger than its source |
| Dense prop | A generated prop (a mop standing in a bucket, with a wire bail), 635,400 triangles |
| Reduced prop | The provider's own reduction of it, 5,075 triangles, textured |
| Bought bucket | A bought low-poly model, 976 triangles, 2 materials, four connected parts |
| Bought chair | A bought low-poly model, 170 triangles, 1 material |
| Rigged character | A rigged character of 20,944 triangles, exported at rest and with both elbows turned 100 degrees |

## Results

| Script | Run on | Result |
| --- | --- | --- |
| `topology_report.py` | All of the above | Dense character: clean, 2 parts, a few seconds. Remeshed character: 3 non-manifold edges, 3 duplicate faces, 1 small part, 100 open edges, quad estimate 0.87; exits 0 once the three failures are allowed with reasons. Reduced prop: 55 non-manifold edges, quad estimate 0.48. Bought bucket: 72 open edges, fails `materials` (2 against 1). Bought chair: 8 degenerate faces, 18 open edges |
| `decimate.py` | Dense prop to 3,000 triangles | 3,000 triangles in about 17 s; deviation at most 0.72% of the bounding diagonal (P95 0.21%). Wire stills viewed: bucket, handle, wire bail and mop head all kept; strands simplified |
| `quad_remesh.py` | Dense character, 10,000 faces, `--voxel-size 0.006` | Exits 1, as it should: 8,402 quads with 14 open edges and a deviation of 5.05%. Stills viewed: fingers merged, face collapsed; with `--symmetry` one leg was torn away. On the generated blob of the tests it gives a closed all-quad mesh |
| `quads_from_tris.py` | Remeshed character | 10,282 quads and 314 triangles (97.0% quads), 106 open and 2 non-manifold edges |
| `fit_to_source.py` | Remeshed character onto the dense one | Scale 0.95041 applied; largest deviation 2.13% before, 1.03% after (P95 0.27%) |
| `render_wire.py` | Decimated prop (wire), the failed quad remesh from its `.blend` (wire, with `--focus` close-ups of a hand and the face), reduced prop (`--style clay`) | Stills and sheets viewed; quads drawn as quads from the `.blend` |
| `edge_stretch.py` | Rigged character, rest against elbows turned | 62,832 face edges; 46 beyond 1.5x, 32 beyond 2x (worst 3.41x): exits 1. With `--max-stretch 4`: exits 0 |

A run recorded the dense prop's reduction, unwrap and bake in one call (`jam run record <id> topology uv texture ...`): three records, each passing its checks, measured at 3,000 triangles, 1 material and 16 MiB. Recording the bought bucket's topology alone was refused (2 materials over a budget of 1); after the material merge the same three-step call was accepted.

## What failed and was fixed

- The quad remesher refused every dense mesh in metres: it rejects edges shorter than 0.0001 units. The script now works at a larger scale and scales back.
- `edge_stretch.py` compared vertices by index and refused two exports of one mesh, because glTF splits vertices differently when normals change. It now compares edges face by face.
- Deviation was first measured from the candidate to the source only, which cannot see a part that vanished; it is now measured both ways.

## Not validated

- `.fbx` and `.obj` inputs (only `.glb` and `.blend` were loaded).
- `decimate.py --symmetry`, and meshes of several objects.
- A provider remesh job itself: the remeshed character came from an earlier job; no paid job was run here.
- The procedural route has no script; nothing was run for it.
- `edge_stretch.py` with a `.blend` posed by its armature (two exported files were used).
- The tests (`test_topology_report.py`, 12 cases; `test_retopo_blender.py`, 7 cases on generated models) pass on this machine only.
