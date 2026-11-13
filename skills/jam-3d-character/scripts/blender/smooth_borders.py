"""Smooth the open borders of outfit pieces (the cut at the neck, the wrists, a hat's opening) along themselves, so a cut
that followed face edges reads as a clean line. Each border vertex moves toward the mean of its two border neighbours;
the ring of faces next to the border follows by half as much.
blender --background --python-exit-code 1 --python smooth_borders.py -- <pieces.blend> <out.blend> [iterations]
Run conform_outfit.py afterwards: smoothing can pull a border vertex back inside the body."""
import bpy, bmesh, sys, json
args = sys.argv[sys.argv.index("--") + 1:]
src, out = args[:2]; its = int(args[2]) if len(args) > 2 else 12
bpy.ops.wm.open_mainfile(filepath=src); report = {}
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    border = {v for e in bm.edges if e.is_boundary for v in e.verts}
    nbrs = {v: [e.other_vert(v) for e in v.link_edges if e.is_boundary] for v in border}
    ring = {w for v in border for w in (e.other_vert(v) for e in v.link_edges) if w not in border}
    moved = 0.0
    for _ in range(its):
        new = {v: v.co * 0.5 + (sum((w.co for w in nbrs[v]), v.co * 0) / len(nbrs[v])) * 0.5 for v in border if len(nbrs[v]) == 2}
        for v, c in new.items(): moved = max(moved, (c - v.co).length); v.co = c
        for w in ring:
            ns = [e.other_vert(w) for e in w.link_edges]
            w.co = w.co * 0.75 + (sum((x.co for x in ns), w.co * 0) / len(ns)) * 0.25
    bm.to_mesh(o.data); bm.free()
    report[o.name] = {"borderVertices": len(border), "iterations": its}
bpy.ops.wm.save_as_mainfile(filepath=out); print(json.dumps(report))
