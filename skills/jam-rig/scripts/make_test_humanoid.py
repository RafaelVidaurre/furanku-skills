"""Build a plain humanoid from capsules, remeshed into one closed surface, with its exact landmark file. Runs in Blender.

    blender --background --python-exit-code 1 --python make_test_humanoid.py -- <out-dir> [--height-meters 1.7] [--mittens]

The figure stands in an A-pose (arms 40 degrees below level), facing front, feet on the ground. Its hands have four
fanned fingers and a thumb, each with landmark joints; --mittens gives it finger-less hands and no finger landmarks.
Writes humanoid.glb (unskinned, glTF conventions) and landmarks.json. A test fixture for bind.py and a quick way to
try the scripts with nothing else at hand; no character is this regular, so it proves less than a real mesh.
"""
import argparse
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jamrig import figure, landmarks as lm, report  # noqa: E402

def capsule(bm, a, b, radius, flatten=None):
    """A cylinder from a to b with a ball at each end; flatten = (axis, factor) squashes it about its middle."""
    a, b = Vector(a), Vector(b)
    made = []
    for centre in (a, b):
        made += bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=radius, matrix=Matrix.Translation(centre))["verts"]
    length = (b - a).length
    if length > 1e-6:
        turn = Vector((0, 0, 1)).rotation_difference((b - a).normalized()).to_matrix().to_4x4()
        made += bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=radius, radius2=radius, depth=length,
                                      matrix=Matrix.Translation((a + b) / 2) @ turn)["verts"]
    if flatten:
        axis, factor = Vector(flatten[0]).normalized(), flatten[1]
        mid = (a + b) / 2
        for v in made:
            off = v.co - mid
            v.co = v.co - axis * off.dot(axis) * (1 - factor)


def build(height, mittens):
    J, tips = figure.joints(mittens)
    P = {k: Vector(v) for k, v in J.items()}
    bm = bmesh.new()
    front = (0, 1, 0)
    capsule(bm, P["hips"] + Vector((0, 0, -0.02)), P["chest"], 0.085, (front, 0.7))                      # trunk
    capsule(bm, P["chest"] + Vector((-0.07, 0, 0.0)), P["chest"] + Vector((0.07, 0, 0.0)), 0.05, (front, 0.8))   # shoulders
    capsule(bm, P["neck"] + Vector((0, 0, -0.02)), P["head"] + Vector((0, 0, 0.02)), 0.03)
    capsule(bm, P["head"] + Vector((0, 0, 0.065)), P["head"] + Vector((0, 0, 0.095)), 0.06)              # skull
    capsule(bm, P["hips"] + Vector((-0.05, 0, -0.03)), P["hips"] + Vector((0.05, 0, -0.03)), 0.055)      # pelvis
    for side, sx in (("l", 1.0), ("r", -1.0)):
        s = "." + side
        along, palm = (Vector(v) for v in figure.arm_axes(sx))
        capsule(bm, P["upper-arm" + s], P["lower-arm" + s], 0.028)
        capsule(bm, P["lower-arm" + s], P["hand" + s], 0.023)
        if mittens:
            capsule(bm, P["hand" + s] + along * 0.02, P["hand" + s] + along * 0.085, 0.03, (palm, 0.45))
        else:
            across = Vector((0, 0.026, 0))
            capsule(bm, P["hand" + s] + along * 0.03 - across, P["hand" + s] + along * 0.03 + across, 0.023, (palm, 0.45))
            for finger in ("thumb",) + tuple(f[0] for f in figure.FINGERS):
                chain = [P["%s-%d%s" % (finger, k, s)] for k in (1, 2, 3)] + [Vector(tips[finger + s])]
                for a, b in zip(chain, chain[1:]):
                    capsule(bm, a, b, 0.0062 if finger == "thumb" else 0.0054)
        capsule(bm, P["upper-leg" + s], P["lower-leg" + s], 0.048)
        capsule(bm, P["lower-leg" + s], P["foot" + s], 0.034)
        capsule(bm, P["foot" + s] + Vector((0, 0.025, -0.03)), P["toes" + s] + Vector((0, -0.035, 0.012)), 0.027)
    bmesh.ops.scale(bm, vec=(height, height, height), verts=bm.verts)
    low = min(v.co.z for v in bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, -low), verts=bm.verts)
    mesh = bpy.data.meshes.new("Humanoid"); bm.to_mesh(mesh); bm.free()
    ob = bpy.data.objects.new("Humanoid", mesh); bpy.context.scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    mesh.remesh_voxel_size = height * (0.006 if mittens else 0.0045); mesh.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()
    for p in ob.data.polygons:
        p.use_smooth = True
    mat = bpy.data.materials.new("Clay"); mat.diffuse_color = (0.72, 0.62, 0.52, 1.0)
    ob.data.materials.append(mat)
    points = {k: tuple((Vector(v) * height) + Vector((0, 0, -low))) for k, v in J.items()}
    return ob, points


def main():
    p = argparse.ArgumentParser(prog="make_test_humanoid.py", description=__doc__.split("\n\n")[0])
    p.add_argument("out"); p.add_argument("--height-meters", type=float, default=1.7); p.add_argument("--mittens", action="store_true")
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(a.out, exist_ok=True)
    ob, points = build(a.height_meters, a.mittens)
    glb = os.path.join(a.out, "humanoid.glb")
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(glb), export_format="GLB", use_selection=True, export_yup=True)
    report.write(os.path.join(a.out, "landmarks.json"), lm.validate(lm.from_working(points, "make_test_humanoid.py: the joints the figure was built on")))
    print('{"model": "%s", "landmarks": "%s", "vertices": %d}' % (glb.replace(os.sep, "/"), os.path.join(a.out, "landmarks.json").replace(os.sep, "/"), len(ob.data.vertices)))


if __name__ == "__main__":
    main()
