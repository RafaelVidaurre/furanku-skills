# Seams and hints

How `unwrap.py --method seams` decides where to cut, the hints file that steers it, and what to do when pieces will not lie flat. Read with [scripts.md](scripts.md) for the command line.

## What the script cuts by itself

In this order:

1. Seams already marked in a `.blend`, with `--keep-seams`.
2. Borders between materials (`--no-material-seams` turns this off).
3. Edges sharper than `--sharp-angle` (60 degrees; raise it to 180 for an organic mesh with creases that should not be cut).
4. The hints.
5. Every piece that still cannot lie flat: a closed surface gets one cut from its top to its bottom, a tube (two borders of similar length: a sleeve, a leg, a handle) one cut between them. These cuts run along the side facing back and down.

Then each piece is flattened with least stretch. A piece the solver gives up on (it is not a disc: layered clothing fused into one shell, hair, a mesh with handles) is first halved into its front-facing and back-facing faces and solved again, and what still fails is projected by face direction. The report's `piecesRedone` says how many faces went each way.

## The hints file

JSON, in the model file's own axes: glTF's (+Y up, the model's front +Z, its left +X, metres) unless it says `"space": "blender"` (Z up, front -Y).

```json
{
  "space": "gltf",
  "loops": [{"name": "wrist.l", "at": [0.70, 1.45, 0.0], "axis": [1, 0, 0]}],
  "paths": [{"name": "arm-underside.l",
             "from": {"at": [0.70, 1.45, 0.0], "side": [0, -1, 0]},
             "via": [{"at": [0.45, 1.45, 0.0], "side": [0, -1, 0]}],
             "to": {"at": [0.20, 1.45, 0.0], "side": [0, -1, 0]},
             "side": [0, -1, 0]}],
  "sides": [{"name": "hand.l", "at": [0.78, 1.45, 0.0]},
            {"name": "sole.l", "at": [0.10, 0.04, 0.08], "axis": [0, 1, 0], "threshold": -0.5}]
}
```

| Hint | Cuts | Fields |
| --- | --- | --- |
| `loops` | A ring around a limb: every ring of edges crossing the plane through `at` that runs around `at` (an inner and an outer shell both count; rings around other limbs do not) | `at`: a point inside the limb, such as a joint. `axis`: the limb's direction there |
| `paths` | The cheapest line of edges through the listed points | `from`, `via`, `to`: points, or `{"at", "side"}` to take the surface vertex near `at` that lies furthest toward `side` (a joint is inside the limb; `side` says which face of the limb the seam runs on). `side` on the path makes it prefer faces looking that way. A path stays on the connected part its first point lands on |
| `sides` | The outline between two faces of a flat piece: the piece nearest `at` is split by which way its faces look | `at`: a point inside the piece. `axis`: the direction that separates the sides (default: the piece's flattest direction, right for a hand). `threshold`: faces whose normal along `axis` is under it form the second side (`-0.5` with `axis` up cuts a sole from its shoe) |

A hint that finds nothing is listed under `hintsWithoutEffect` in the report; a path of 0 edges means both ends landed on the same vertex.

## Figures

`seam_hints_from_landmarks.py <landmarks.json> <hints.json>` writes the cuts a garment has, from the joint positions: loops at the neck, waist, shoulders, wrists and ankles; the underside of each arm; each side of the torso from armpit to waist; the seat; the inside of each leg; the back of the head; the outline of each hand; each sole. Pass the result with `--sharp-angle 180`.

Edit the file for a figure it does not fit: drop the inseams and seat for a robe or skirt, drop `sides` for mittens you want in one island, add a loop at a hat's brim or a boot's top.

What to expect: sleeves, hands and shoes of a generated character come out as single clean islands. A torso with layered clothing fused into one shell (a jacket over a shirt, a scarf, a beard, curly hair) is not a disc, and falls to the halving and projection described above, with many small islands and low coverage. That passes the thresholds and bakes correctly; when the texture budget is tight, cut that part by hand in a DCC (mark seams, save a `.blend`, run `unwrap.py --keep-seams`) or use the provider's unwrap.

## When the result fails

| The report says | Do |
| --- | --- |
| `density-spread` over the limit with `--method seams` | A piece is stretched: add a loop or path through it, or use `--method smart` |
| `overlap` or `zero-area` | A piece did not flatten: see `piecesRedone`; add cuts through it |
| Coverage under about 0.4 with hundreds of islands | The mesh is noisy (a decimated organic clump, hair). Accept it for a small prop, or lower `--padding-px` toward `size/256`, or get a cleaner mesh from `jam-3d-retopo` |
| `island-gap` under the limit on kept UVs | The layout was packed for a larger texture: repack with `unwrap.py`, or state the texture size it was made for |
| `single-uv-set` | `strip_uv_sets.py --keep <the set the textures use>` |
