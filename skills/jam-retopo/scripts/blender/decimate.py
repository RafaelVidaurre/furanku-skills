"""Reduce a mesh to a triangle budget by edge collapse, keeping its shape, UVs and materials.

blender --background --factory-startup --python-exit-code 1 --python decimate.py -- <model> <out-dir>
    --target-triangles N [--max-triangles N] [--name <stem>] [--symmetry x|y|z] [--no-weld] [--max-deviation F]

<model> is a .glb, .gltf, .fbx, .obj or .blend. Vertices at the same place are welded first (glTF splits them along
UV seams, which makes collapse tear the surface), then every mesh is collapsed by the same ratio until the total is
at or under the target. Writes <out-dir>/<stem>.glb and <out-dir>/decimate-report.json with triangle counts before
and after, bounds, and how far the result's vertices lie from the source surface as a share of the bounding diagonal.
Exits 1 when the result is over --max-triangles (default: the target) or deviates more than --max-deviation.
Collapse gives triangles with no edge flow: use it for meshes that do not deform.
"""
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402

p = js.parser(__doc__)
p.add_argument("model")
p.add_argument("out_dir")
p.add_argument("--target-triangles", type=int, required=True)
p.add_argument("--max-triangles", type=int)
p.add_argument("--name")
p.add_argument("--symmetry", choices=["x", "y", "z"], help="keep the mesh mirror-symmetric across this axis (as the file's own axes read in Blender)")
p.add_argument("--no-weld", action="store_true")
p.add_argument("--max-deviation", type=float, default=0.02, help="largest accepted distance from the source surface, as a share of the bounding diagonal (default 0.02)")
args = js.parse(p)
if args.target_triangles < 4:
    js.fail("--target-triangles must be at least 4", 2)
limit = args.max_triangles or args.target_triangles
out = js.out_dir(args.out_dir)
name = js.stem(args.model, args.name)

objects = js.load(args.model)
js.apply_transforms(objects)
low, high = js.bounds(objects)
diagonal = (high - low).length or 1.0
before = js.face_stats(objects)
source, source_points = js.surface(objects)
welded = 0
if not args.no_weld:
    for ob in objects:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        count = len(bm.verts)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=diagonal * 1e-6)
        welded += count - len(bm.verts)
        bm.to_mesh(ob.data)
        bm.free()
start = js.triangle_count(objects)
originals = {ob.name: ob.data.copy() for ob in objects}
ratio = min(1.0, args.target_triangles / start)
passes = []
for attempt in range(6):
    if ratio >= 1.0:
        break
    for ob in objects:
        ob.data = originals[ob.name].copy()
        modifier = ob.modifiers.new("jam-decimate", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        if args.symmetry:
            modifier.use_symmetry = True
            modifier.symmetry_axis = args.symmetry.upper()
        js.select([ob])
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    now = js.triangle_count(objects)
    passes.append({"ratio": round(ratio, 6), "triangles": now})
    if now <= args.target_triangles:
        break
    ratio *= args.target_triangles / now * 0.995
after = js.face_stats(objects)
low2, high2 = js.bounds(objects)
deviation = js.deviation(objects, source, source_points)
for ob in objects:
    for poly in ob.data.polygons:
        poly.use_smooth = True
model_file = f"{name}.glb"
js.export_glb(js.inside(out, model_file), objects)
report = {"blender": bpy.app.version_string, "source": os.path.basename(args.model), "model": model_file, "operation": "edge collapse",
          "targetTriangles": args.target_triangles, "maxTriangles": limit, "before": before, "after": after,
          "weldedVertices": welded, "passes": passes, "symmetry": args.symmetry,
          "sizeBefore": [round(v, 5) for v in high - low], "sizeAfter": [round(v, 5) for v in high2 - low2],
          "deviationShareOfDiagonal": deviation, "maxDeviation": args.max_deviation,
          "hadUVs": any(ob.data.uv_layers for ob in objects), "materials": sorted({s.material.name for ob in objects for s in ob.material_slots if s.material})}
problems = []
if after["exportTriangles"] > limit:
    problems.append(f"{after['exportTriangles']} triangles is over the limit of {limit}")
if deviation and deviation["max"] > args.max_deviation:
    problems.append(f"the result lies up to {deviation['max']:.2%} of the bounding diagonal from the source (limit {args.max_deviation:.2%}): thin parts were lost; raise the target or choose another route")
report["problems"] = problems
js.write_report(out, "decimate-report.json", report)
print("DECIMATE", {"before": before["exportTriangles"], "after": after["exportTriangles"], "deviation": deviation, "problems": problems})
if problems:
    js.fail("; ".join(problems))
