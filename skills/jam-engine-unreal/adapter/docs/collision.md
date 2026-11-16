# Collision

Unreal takes a static mesh's simple collision from shapes named for it in the imported file: `UBX_` (box), `UCP_` (capsule), `USP_` (sphere) and `UCX_` (convex), as `UCX_<RenderMeshName>` or `UCX_<RenderMeshName>_##`; a convex shape must be completely closed and convex (Epic, FBX static mesh pipeline; Interchange has the same "Import Collision According to Mesh Name"). The facts carry the convex prefix as `collision.prefix`.

Choose by what the mesh is for:

| The mesh is | Collision |
| --- | --- |
| A static set piece (counter, bench, wall unit) | Author hulls before import |
| A physical prop that is carried, pushed or knocked over | Fit in the editor so it collides as it looks |
| A look only (a body stands in for it in game code) | None; leave the hulls out |
| Something whose collision is designed for a purpose | Author it and keep it out of the fit |

## Author hulls before import

```
node tools/jam/jam.mjs blender --factory-startup jam/engines/unreal/commands/dcc/ucx_collision.py -- <model.glb> <out.glb> <spec.json>
```

The spec lists shapes in metres in the model's own frame as Blender shows it (Z up, front −Y): `{"boxes": [[xmin,ymin,zmin,xmax,ymax,zmax]], "prisms": [[cx,cy,radius,zmin,zmax,sides]], "hullBelow": z, "merge": m}`. A cylinder is a prism (16 sides in the jam); `hullBelow` wraps every vertex at or under a height, for a base or a foot. Leave the space under tables and seats open so legs and feet fit. A hull over 48 points has points within `merge` metres (default 0.012) merged and is rebuilt. Import `<out.glb>` in place of the model.

Done when `<out>.collision.json` lists the hulls you meant, and after import `jam engine inspect <id>` reports that many convex shapes.

## Fit in the editor

```
node tools/jam/jam.mjs python jam/engines/unreal/commands/collision.py measure /Game/<mesh> ...
node tools/jam/jam.mjs python jam/engines/unreal/commands/collision.py fit /Game/<mesh> ...
```

`measure` samples up to 1500 render-mesh vertices and reports the share within the cover distance of the simple collision, the worst gap and the box round the gaps. `fit` refits each mesh that fails with the engine's convex decomposition (V-HACD, the mesh editor's Auto Convex Collision), trying 4, 8, 12 and 16 hulls of at most 48 vertices at two voxel budgets (300,000 and 1,000,000) until the mesh is covered; it saves the best fit, and leaves alone a mesh that is covered already or that no fit covers better. `jam engine check --kind collision <ids>` is `measure` as a check. Both need a live editor ([transport.md](transport.md)).

**Covered** means at least 98% of the sampled vertices lie within 1.5 cm of the collision (2% of a large mesh's size, up to 2.5 cm), or no vertex lies more than 4.5 cm out. The second clause is for round furniture that the decomposition fits a little small all over: nothing is missing. The smallest part that was missing before this rule, the pens in a pen cup, stood 6.4 cm out. A project changes any number under `engine.facts.extra.collision.rule`.

Why these budgets: 48 vertices keep a 60 cm barrel's hull within a centimetre of its staves; the larger voxel budget is under 1 cm across a 115 cm mop, for its 2 cm handle, and the coarser one fits some round furniture closer. A few convex pieces per mesh, never the render mesh as collision.

Run `fit` after adding or replacing a physical prop's mesh, and commit the saved assets from the editor's checkout. Done when the receipt's `uncovered` is empty.

Leave out of the fit:

- **Foliage and anything that should give way.** A potted palm fitted to its fronds pressed into the wall behind it and fell over; its authored collision was the pot and trunk.
- **Things that stack or nest.** Convex pieces fitted to a plate or bowl do not let the next one sit in it. The jam gave crockery purpose-built collision in game code (a disc inside the foot and a ring of thin pieces over the walls and rim).

## In the running game

- A static mesh component takes collision from the mesh's defaults, and imported meshes default to blocking everything. Disabling collision on the component alone was undone the next time the physics state was rebuilt: turn off "use default collision" before setting the mesh, then set the no-collision profile.
- The engine's sphere stays a sphere when scaled unevenly, as wide as its narrowest axis. Use a cylinder or cube for a shape taller than it is wide.
- Read the collision state from the spawned actors during play, not from the code that sets it.
