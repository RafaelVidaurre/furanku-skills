"""Rebuild a mesh as quads with the local quad remesher (QuadriFlow), for meshes that bend.

blender --background --factory-startup --python-exit-code 1 --python quad_remesh.py -- <model> <out-dir>
    --target-faces N [--name <stem>] [--symmetry] [--voxel-size METERS] [--pre-decimate N] [--max-deviation F]

<model> is a .glb, .gltf, .fbx, .obj or .blend; its meshes are joined into one. The remesher needs a closed,
manifold surface: when the input is not one, pass --voxel-size (a voxel remesh at that cell size closes it first;
use about 1/200 of the height). Inputs above --pre-decimate triangles (default 200000) are collapsed to it first.
The result has new vertices and no UVs or materials: unwrap it (jam-uv) and bake the source onto it (jam-texture).
Writes <out-dir>/<stem>.blend (quads kept), <out-dir>/<stem>.glb (the same mesh as triangles) and
<out-dir>/quad-remesh-report.json. Exits 1 when the remesher refuses the input or the result is not all quads,
has open or non-manifold edges, or deviates from the source more than --max-deviation of the bounding diagonal.
"""
import os
import sys

import bpy
import bmesh
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402

p = js.parser(__doc__)
p.add_argument("model")
p.add_argument("out_dir")
p.add_argument("--target-faces", type=int, required=True, help="quads wanted; the GLB holds about twice as many triangles")
p.add_argument("--name")
p.add_argument("--symmetry", action="store_true", help="mirror-symmetric result across the model's left-right plane")
p.add_argument("--voxel-size", type=float, help="close a non-manifold input with a voxel remesh at this cell size first")
p.add_argument("--pre-decimate", type=int, default=200000)
p.add_argument("--max-deviation", type=float, default=0.02)
args = js.parse(p)
out = js.out_dir(args.out_dir)
name = js.stem(args.model, args.name)

objects = js.load(args.model)
js.apply_transforms(objects)
js.select(objects)
if len(objects) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
low, high = js.bounds([ob])
diagonal = (high - low).length or 1.0
before = js.face_stats([ob])
source, source_points = js.surface([ob])
steps = []


def edit(fn):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    result = fn(bm)
    bm.to_mesh(ob.data)
    bm.free()
    return result


def defects(bm):
    return {"openEdges": sum(1 for e in bm.edges if e.is_boundary), "nonManifoldEdges": sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)}


edit(lambda bm: bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=diagonal * 1e-6))
if args.voxel_size:
    ob.data.remesh_voxel_size = args.voxel_size
    ob.data.remesh_voxel_adaptivity = 0.0
    js.select([ob])
    bpy.ops.object.voxel_remesh()
    steps.append({"voxelRemesh": args.voxel_size, "triangles": js.triangle_count([ob])})
if js.triangle_count([ob]) > args.pre_decimate:
    modifier = ob.modifiers.new("jam-pre", "DECIMATE")
    modifier.ratio = args.pre_decimate / js.triangle_count([ob])
    js.select([ob])
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    steps.append({"preDecimate": js.triangle_count([ob])})
input_defects = edit(defects)
if input_defects["openEdges"] or input_defects["nonManifoldEdges"]:
    js.write_report(out, "quad-remesh-report.json", {"problems": ["input is not a closed manifold surface"], "inputDefects": input_defects, "steps": steps})
    js.fail(f"the quad remesher needs a closed manifold surface; this one has {input_defects['openEdges']} open and {input_defects['nonManifoldEdges']} non-manifold edges. "
            "Pass --voxel-size <about 1/200 of the height> to close it first, or use the provider remesh route")
# the remesher refuses edges shorter than 1e-4 units, which a fine mesh in metres has: work at a larger scale
grow = 1000.0 / diagonal
ob.data.transform(Matrix.Scale(grow, 4))
edit(lambda bm: bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4))
js.select([ob])
result = bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=args.symmetry, use_preserve_sharp=False, use_preserve_boundary=False,
                                          smooth_normals=True, mode="FACES", target_faces=args.target_faces, seed=0)
if "FINISHED" not in result:
    js.write_report(out, "quad-remesh-report.json", {"problems": ["the quad remesher did not finish"], "steps": steps})
    js.fail("the quad remesher did not finish on this mesh; try --voxel-size, a different --target-faces, or the provider remesh route")
ob = bpy.context.view_layer.objects.active
ob.data.transform(Matrix.Scale(1.0 / grow, 4))
after = js.face_stats([ob])
after.update(edit(defects))
after["poles"] = edit(lambda bm: sum(1 for v in bm.verts if len(v.link_edges) != 4))
deviation = js.deviation([ob], source, source_points)
for poly in ob.data.polygons:
    poly.use_smooth = True
ob.name = name
ob.data.materials.clear()
js.save_blend(js.inside(out, f"{name}.blend"))
js.export_glb(js.inside(out, f"{name}.glb"), [ob])
problems = []
if after["triangles"] or after["ngons"]:
    problems.append(f"{after['triangles']} triangles and {after['ngons']} n-gons remain")
if after["openEdges"] or after["nonManifoldEdges"]:
    problems.append(f"{after['openEdges']} open and {after['nonManifoldEdges']} non-manifold edges")
if deviation["max"] > args.max_deviation:
    problems.append(f"the result lies up to {deviation['max']:.2%} of the bounding diagonal from the source (limit {args.max_deviation:.2%}): thin parts such as fingers were merged or lost")
report = {"blender": bpy.app.version_string, "source": os.path.basename(args.model), "model": f"{name}.glb", "editable": f"{name}.blend",
          "operation": "QuadriFlow quad remesh", "targetFaces": args.target_faces, "symmetry": args.symmetry, "steps": steps,
          "before": before, "after": after, "deviationShareOfDiagonal": deviation, "maxDeviation": args.max_deviation, "problems": problems}
js.write_report(out, "quad-remesh-report.json", report)
print("QUADS", {"after": after, "deviation": deviation, "problems": problems})
if problems:
    js.fail("; ".join(problems))
