# Topology routes

What each route of [SKILL.md](../SKILL.md) takes, gives and gets wrong. `<S>` is the skill's `scripts/` folder; Blender scripts run as `jam blender --factory-startup <S>/blender/<script> -- <arguments>`.

## Keep

A model that is within budget needs no new topology. Run `topology_report.py` on it once and read the failures before accepting: bought kits often have open edges where parts meet (planks, handles) and a few zero-area triangles, which are harmless on a static prop; name each with `--allow <check>=<reason>`. A material count over the budget is not a topology fault: see the material merge in [SKILL.md](../SKILL.md#routes).

## Provider remesh

The configured mesh route (`jam config show routes.mesh`, `jam provider list`) may offer a target polycount at generation time, a remesh of an existing mesh, and quad output. Its document under the toolkit's `docs/providers/` has the current limits and request fields; `jam-3d-model` covers quoting and the job ledger. This step may spend: open the job (`jam job open <id> topology ...`) before submitting.

- **At generation time** ask for the budget's `triangles.target`, nearer `triangles.max` for thin parts (chair legs, railings), and for the unreduced mesh as well when the provider can return it: it is the source to bake detail from and to measure deviation against.
- **Remeshing an existing mesh:** upload geometry only, with vertices welded. A textured file has its vertices split along UV seams, and a remesh of one came back with about 2,000 open edges. Export the upload from the DCC with UVs and materials removed and vertices merged by distance, and confirm with `topology_report.py` that exported and welded vertex counts are equal.
- **Quads:** ask for half the triangle budget in faces. A quad mesh delivered as GLB arrives as triangles; `quads_from_tris.py -- <remesh.glb> <work>` welds it and joins the pairs, and fails when under 90% of the faces come back as quads.
- **The result is often rescaled or moved.** `fit_to_source.py -- <remesh> <source> <work>` scales and moves it onto the source and reports the deviation; continue from the file it writes.
- **Look at thin parts.** Fingers closer than about a centimetre fuse; handles and straps vanish. A deviation over 2%, or a close-up (`render_wire.py --focus`) showing merged fingers, sends the mesh back: fix the source or raise the target, and remesh again.

## Decimate

`decimate.py -- <source> <work> --target-triangles <n> [--max-triangles <n>] [--symmetry x]` welds, then collapses edges until the total is at or under the target, keeping UVs and materials (a texture stays usable, slightly smeared at seams; rebake it with `jam-3d-texture` when it matters).

- It gives triangles with no edge flow: for meshes that do not deform.
- Thin parts go first. The script fails when the result lies more than `--max-deviation` (2% of the bounding diagonal) from the source in either direction; raise the target, or model the thin part separately.
- Dense organic clumps (rope, foliage, hair) survive as a silhouette but unwrap into many small islands afterwards; expect a low texture coverage, and prefer a provider remesh when the texture budget is tight.

## Local quad remesh

`quad_remesh.py -- <source> <work> --target-faces <n> [--voxel-size <m>] [--symmetry]` uses the DCC's built-in quad remesher.

- It needs a closed manifold surface. For anything else pass `--voxel-size` (about 1/200 of the height): a voxel remesh closes the surface first, and merges parts closer than that size.
- It suits simple closed shapes: a creature's body without fingers, a sack, a cushion, a rock. On a full character at 10,000 faces it left holes at the fingers and face and lost one leg with `--symmetry`; the script reports this as open edges and a deviation over the limit and exits 1. Use the provider remesh for characters.
- The result has new vertices, no UVs and no materials: unwrap it and bake the source onto it.
- The `.blend` it writes keeps the quads for unwrapping and rigging; the GLB holds the same mesh as triangles for measuring.

## Procedural

For a shape that is a box, a turned profile or a few of each, write a short DCC script that builds it from primitives: boxes and bevelled boxes for furniture and doors, a lathed profile for bottles, bowls, barrels and lamp shades, cylinders for legs and rails. Take the proportions from the accepted reference (measure them on the front and side views) and the real size from the brief.

- Keep one material, give every part smooth or flat shading on purpose, and leave out faces nothing can see (the underside of a wardrobe against the floor stays; the inside of a closed box goes).
- Build it at its real size in metres, standing on the origin, facing the delivery's front (`jam engine facts`).
- The script is the source: keep it with the model, and record it as the step's input.
- Check it as any candidate: report, stills, and the stills beside the reference.

## Meshes that deform

A deforming budget (`kind: deforming`) needs more than a triangle count:

- **Quads in loops around each joint** (shoulder, elbow, wrist, hip, knee, ankle, neck, each finger joint when fingers move), at least three loops per joint, so the bend spreads instead of collapsing one edge. `topology_report.py --min-quad-share 0.8` and a `--focus` close-up of each joint are the evidence.
- **Limbs held away from the body and fingers apart** in the source, or the remesh bridges them.
- **No stretch at the poses the game uses.** Once the mesh is rigged (`jam-3d-rig`), export it at rest and in each extreme pose and run `edge_stretch.py -- <rest> <posed> <work> --label <pose>`: it fails when a face edge stretches more than twice its rest length and lists where. That evidence belongs to the rig step; a failure there comes back here as too few loops at the joint it names.
