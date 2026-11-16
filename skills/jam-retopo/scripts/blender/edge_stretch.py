"""Measure how much each edge stretches between two poses of the same mesh, to find where the surface tears when it bends.

blender --background --factory-startup --python-exit-code 1 --python edge_stretch.py -- <rest model> <posed model> <out-dir>
    [--max-stretch 2.0] [--label <text>]

Both files hold the same mesh (same faces in the same order), once at rest and once posed: two exports of a rigged
model, or two .blend files whose armature differs in pose (modifiers are evaluated). Edges are compared face by
face, so each shared edge counts twice. Writes <out-dir>/<label>-edge-stretch.json with how many face edges stretch
beyond 1.5x and beyond --max-stretch and the worst twenty with their rest positions (in the DCC's axes: Z up). Exits 1 when any edge stretches beyond --max-stretch, 2 when the two files
do not hold the same mesh.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402

p = js.parser(__doc__)
p.add_argument("rest")
p.add_argument("posed")
p.add_argument("out_dir")
p.add_argument("--max-stretch", type=float, default=2.0)
p.add_argument("--label", default="pose")
args = js.parse(p)
out = js.out_dir(args.out_dir)


def read(path):
    """Every face as the world positions of its corners. Faces keep their order and corners through an export, while
    vertices may be split differently (glTF splits them wherever normals differ), so edges are compared face by face."""
    objects = js.load(path)
    graph = bpy.context.evaluated_depsgraph_get()
    faces = []
    for ob in objects:
        evaluated = ob.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        points = [evaluated.matrix_world @ v.co for v in mesh.vertices]
        faces += [[points[i] for i in poly.vertices] for poly in mesh.polygons]
        evaluated.to_mesh_clear()
    return faces


rest = read(args.rest)
posed = read(args.posed)
if len(rest) != len(posed) or any(len(a) != len(b) for a, b in zip(rest, posed)):
    js.fail(f"the two files do not hold the same mesh ({len(rest)} faces at rest, {len(posed)} posed, or faces of different sizes): "
            "export both from the same rigged model with the same settings", 2)
rows = []
for a, b in zip(rest, posed):
    for i in range(len(a)):
        j = (i + 1) % len(a)
        length = (a[i] - a[j]).length
        if length > 1e-9:
            rows.append(((b[i] - b[j]).length / length, a[i], a[j]))
rows.sort(key=lambda row: row[0], reverse=True)
over = sum(1 for r in rows if r[0] > args.max_stretch)
report = {"blender": bpy.app.version_string, "rest": os.path.basename(args.rest), "posed": os.path.basename(args.posed), "faceEdges": len(rows),
          "maxStretch": args.max_stretch, "worst": round(rows[0][0], 3) if rows else 0.0,
          "edgesOverMax": over, "edgesOver1_5": sum(1 for r in rows if r[0] > 1.5),
          "worstEdges": [{"stretch": round(r, 3), "restA": [round(x, 4) for x in a], "restB": [round(x, 4) for x in b]} for r, a, b in rows[:20]]}
js.write_report(out, f"{args.label}-edge-stretch.json", report)
print("STRETCH", {k: report[k] for k in ("faceEdges", "worst", "edgesOverMax", "edgesOver1_5")})
if over:
    js.fail(f"{over} edges stretch more than {args.max_stretch}x in this pose (worst {report['worst']}x); the report lists where")
