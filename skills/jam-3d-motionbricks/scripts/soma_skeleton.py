"""Build the SOMA rig as a glTF file from the skeleton file `generate.py skeleton` wrote. Runs in Blender.

    blender --background --python-exit-code 1 --python soma_skeleton.py -- <soma-skeleton.json> <soma-skeleton.glb>

The file holds an armature in SOMA's reference pose (a T-pose, metres, +Y up, facing +Z), every joint of the skeleton
named as MotionBricks names it, and a stick-figure proxy mesh skinned rigidly to it so that viewers show the pose. It is
the rig that poses are retargeted onto before pack.py and that unpack.py animates. Prints a JSON summary.
"""
import json
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mbx import blend, math3d as m, soma  # noqa: E402

LEAF_LENGTH = 0.03
PROXY_WIDTH = 0.025


def side(name):
    return "Left" if name.startswith("Left") else "Right" if name.startswith("Right") else ""


def tails(skel, world):
    """A tail per joint: toward its main child (same side, most descendants, then farthest), else along its parent."""
    children = {i: [] for i in range(len(skel["joints"]))}
    for i, p in enumerate(skel["parents"]):
        if p >= 0:
            children[p].append(i)

    def descendants(i):
        return sum(1 + descendants(c) for c in children[i])
    out = []
    for i, name in enumerate(skel["joints"]):
        head = world[i][0]
        same = [c for c in children[i] if side(skel["joints"][c]) == side(name)] or children[i]
        if same:
            c = max(same, key=lambda c: (descendants(c), m.vlen(m.vsub(world[c][0], head))))
            d = m.vsub(world[c][0], head)
            if m.vlen(d) > 1e-4:
                out.append(world[c][0])
                continue
        p = skel["parents"][i]
        d = m.vsub(head, world[p][0]) if p >= 0 else (0.0, 1.0, 0.0)
        n = m.vlen(d) or 1.0
        out.append(m.vadd(head, tuple(LEAF_LENGTH * c / n for c in d)))
    return out


def build(skel):
    world = soma.reference_world(skel)
    tail = tails(skel, world)
    data = bpy.data.armatures.new("SOMA")
    arm = bpy.data.objects.new("SOMA", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    bones = []
    for i, name in enumerate(skel["joints"]):
        eb = data.edit_bones.new(name)
        eb.head = Vector(m.vec_to_blender(world[i][0]))
        eb.tail = Vector(m.vec_to_blender(tail[i]))
        bones.append(eb)
    for i, p in enumerate(skel["parents"]):
        if p >= 0:
            bones[i].parent = bones[p]
    bpy.ops.object.mode_set(mode="OBJECT")

    mesh = bpy.data.meshes.new("SOMA-proxy")
    bm = bmesh.new()
    groups = []
    for i, name in enumerate(skel["joints"]):
        a, b = Vector(m.vec_to_blender(world[i][0])), Vector(m.vec_to_blender(tail[i]))
        axis = (b - a)
        if axis.length < 1e-5:
            continue
        u = axis.orthogonal().normalized() * PROXY_WIDTH
        v = axis.normalized().cross(u)
        corners = [a + s * u + t * v for s, t in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        verts = [bm.verts.new(c) for c in corners] + [bm.verts.new(c + axis) for c in corners]
        for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            bm.faces.new([verts[k] for k in f])
        groups.append((name, len(bm.verts) - 8))
    bm.to_mesh(mesh)
    bm.free()
    proxy = bpy.data.objects.new("SOMA-proxy", mesh)
    bpy.context.scene.collection.objects.link(proxy)
    for name, first in groups:
        g = proxy.vertex_groups.new(name=name)
        g.add(list(range(first, first + 8)), 1.0, "REPLACE")
    proxy.parent = arm
    proxy.modifiers.new("Armature", "ARMATURE").object = arm
    return arm


def main(argv):
    if len(argv) != 2:
        raise SystemExit(__doc__)
    skel = soma.load_skeleton(argv[0])
    blend.reset()
    build(skel)
    blend.export_glb(argv[1], animations=False)
    print(json.dumps({"rig": argv[1], "joints": len(skel["joints"]),
                      "source": skel.get("source", {}).get("motionbricksVersion")}))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
