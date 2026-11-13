"""Carry fitted outfit pieces from the body's modelled pose (straight arms) into the body's delivered bind pose (Manny's:
bent elbows, relaxed fingers), by following the body's own surface through that change.
blender --background --python-exit-code 1 --python to_bind_pose.py -- <pieces.blend> <body-modelled.blend> <body-rigged.blend> <body-joints.json> <out.blend> <report.json> --character <body character.json>

body-modelled.blend and body-rigged.blend must hold every part the body's character spec names, under those object
names, with the same vertices in the same order part for part (the rig step moves vertices, it does not change topology;
a part split later, such as the shared hands, must be split in both files). The script checks this and names the part
that differs. The modelled parts are scaled into the joints' space as the earlier outfit steps do. Each piece
is bound to that surface with Surface Deform, the surface is moved to its rigged (bind pose) positions, and the result is
kept. Afterwards no point of the body should lie outside the cloth; conform_outfit.py can be run again in the bind pose."""
import bpy, sys, os, json
from mathutils import Matrix
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import charspec

args, spec = charspec.require()
pieces_blend, modelled_blend, rigged_blend, joints_path, out_blend, report_path = args[:6]
height = json.load(open(joints_path))["meshBounds"][1][2]
bpy.ops.wm.open_mainfile(filepath=pieces_blend)
pieces = [o for o in bpy.data.objects if o.type == "MESH"]

names = spec.present_parts()
def load(path, tag):
    with bpy.data.libraries.load(path) as (src, dst):
        missing = [n for n in names if n not in src.objects]
        if missing: raise SystemExit(f"{path}: no object named {missing}; both body files must hold every part the character spec names ({names})")
        dst.objects = list(names)
    parts = {}
    for n, o in zip(names, dst.objects):
        if o.type != "MESH": raise SystemExit(f"{path}: {n} is not a mesh")
        o.name = tag + n; parts[n] = o
    return parts
mod = load(modelled_blend, "M_"); rig = load(rigged_blend, "R_")
names = sorted(names)
for n in names:
    a, b = len(mod[n].data.vertices), len(rig[n].data.vertices)
    if a != b: raise SystemExit(f"part {spec.role_of_object(n)} ({n}): body-modelled has {a} vertices, body-rigged has {b}; the two body files must hold the same parts with the same vertices (split the hands in both, or in neither)")
lo = min(min((o.matrix_world @ v.co).z for v in o.data.vertices) for o in mod.values())
hi = max(max((o.matrix_world @ v.co).z for v in o.data.vertices) for o in mod.values())
s = height / (hi - lo); M = Matrix.Translation((0, 0, -lo * s)) @ Matrix.Scale(s, 4)

# One target mesh: the modelled parts in the joints' space, with a shape key holding their bind-pose positions.
verts, faces, bind = [], [], []
for n in names:
    a, b = mod[n], rig[n]
    base = len(verts)
    verts += [M @ a.matrix_world @ v.co for v in a.data.vertices]
    bind += [b.matrix_world @ v.co for v in b.data.vertices]
    faces += [[base + i for i in p.vertices] for p in a.data.polygons]
me = bpy.data.meshes.new("BodyTarget"); me.from_pydata(verts, [], faces); me.update()
target = bpy.data.objects.new("BodyTarget", me); bpy.context.scene.collection.objects.link(target)
target.shape_key_add(name="modelled"); key = target.shape_key_add(name="bind")
for i, p in enumerate(bind): key.data[i].co = p
key.value = 0.0

report = {"bodyParts": names, "pieces": {}}
for o in pieces:
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    sd = o.modifiers.new("follow", "SURFACE_DEFORM"); sd.target = target; sd.falloff = 4.0
    bpy.ops.object.surfacedeform_bind(modifier=sd.name)
    if not sd.is_bound: raise SystemExit(f"{o.name}: Surface Deform did not bind (is the piece far inside or outside the body? check the conform report)")
    report["pieces"][o.name] = {"vertices": len(o.data.vertices)}
key.value = 1.0; bpy.context.view_layer.update()
for o in pieces:
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier="follow")
for o in list(bpy.data.objects):
    if o not in pieces: bpy.data.objects.remove(o)
for m in list(bpy.data.meshes):
    if m.users == 0: bpy.data.meshes.remove(m)
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
json.dump(report, open(report_path, "w"), indent=1); print(json.dumps(report))
