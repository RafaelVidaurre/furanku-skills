"""Split both hands off a rigged body into their own part (the spec's hands part), at an edge loop of the forearm near the wrist.
The two parts keep the cut loop's vertices, positions and weights exactly, so they meet without a gap. The body's smooth
normals are frozen as custom normals first, so the seam shades as one surface where the wrist is bare skin.
blender --background --python-exit-code 1 --python split_hands.py -- <rigged.blend> <out.blend> <report.json> [offset-cm] --character <character.json> [--modelled <modelled.blend> <out-modelled.blend>]
offset-cm: how far up the forearm from the wrist joint to look for the loop (default 1.5).
--modelled makes the same split, face for face, in the body as modelled (its textured file), so the modelled and rigged
files keep the same vertices part for part; outfits read both.

The cut is an existing edge loop: faces are assigned by their centre's side of a plane across the forearm, and the
offset is tried in small steps until each side's border is one closed loop that stays within MAX_SPREAD_CM of flat."""
import bpy, bmesh, sys, os, json
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec

args, spec = charspec.require()
modelled = None
if "--modelled" in args:
    i = args.index("--modelled"); modelled = args[i + 1:i + 3]; del args[i:i + 3]
blend, out_blend, report_path = args[:3]
BODY, HANDS = spec.part("body"), spec.part("hands")
if not HANDS: raise SystemExit("the character spec has no hands part: nothing to split")
offset_cm = float(args[3]) if len(args) > 3 else 1.5
MAX_SPREAD_CM = 1.5

bpy.ops.wm.open_mainfile(filepath=blend)
arm = bpy.data.objects["root"]; body = bpy.data.objects[BODY]
topology_before = (len(body.data.vertices), [tuple(p.vertices) for p in body.data.polygons])
to_cm = 100.0  # the Blender source is in metres

def bone_head(name):
    return arm.matrix_world @ arm.data.bones[name].head_local

report = {"source": blend, "sides": {}}
mesh = body.data
# Freeze the current smooth normals so separating the hands does not change how either side of the seam shades.
corner_normals = [Vector(cn.vector) for cn in mesh.corner_normals]
mesh.normals_split_custom_set(corner_normals)

bm = bmesh.new(); bm.from_mesh(mesh); bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
mw = body.matrix_world
hand_faces = set()
for side in ("l", "r"):
    wrist = bone_head("hand_" + side); elbow = bone_head("lowerarm_" + side)
    axis = (wrist - elbow).normalized(); radius = (wrist - elbow).length * 0.6
    best = None
    for step in range(0, 21):
        off = (offset_cm + 0.25 * (step // 2) * (1 if step % 2 == 0 else -1)) / to_cm
        plane = wrist - axis * off
        # faces on the hand side of the plane, near the forearm-hand axis (so nothing else on the body is taken)
        chosen = set()
        for f in bm.faces:
            c = mw @ f.calc_center_median()
            d = (c - plane).dot(axis)
            if d > 0 and ((c - plane) - axis * d).length < radius and d < radius * 2:
                chosen.add(f.index)
        border = [e for e in bm.edges if sum(1 for f in e.link_faces if f.index in chosen) == 1]
        verts = {v for e in border for v in e.verts}
        # one closed loop: every border vertex has exactly two border edges, and they connect into one cycle
        ok = bool(verts) and all(sum(1 for e in v.link_edges if e in border) == 2 for v in verts)
        if ok:
            seen = set(); stack = [next(iter(verts))]
            while stack:
                v = stack.pop()
                if v in seen: continue
                seen.add(v); stack.extend(e.other_vert(v) for e in v.link_edges if e in border)
            ok = len(seen) == len(verts)
        ds = [((mw @ v.co) - plane).dot(axis) * to_cm for v in verts]
        spread = (max(ds) - min(ds)) if ds else 999
        if ok and (best is None or spread < best["spread"]):
            best = {"offsetCm": round(off * to_cm, 2), "spread": spread, "faces": chosen, "loopVerts": len(verts)}
        if ok and spread <= MAX_SPREAD_CM:
            break
    if best is None:
        raise SystemExit(f"no closed loop found near the {side} wrist")
    report["sides"][side] = {"offsetCmFromWrist": best["offsetCm"], "loopVertices": best["loopVerts"], "loopSpreadCm": round(best["spread"], 2),
                             "handFaces": len(best["faces"])}
    hand_faces |= best["faces"]

bm.free()
# Select through the mesh itself: writing the bmesh back would drop the vertex weights.
hand_verts = {v for i in hand_faces for v in mesh.polygons[i].vertices}
mesh.polygons.foreach_set("select", [i in hand_faces for i in range(len(mesh.polygons))])
mesh.vertices.foreach_set("select", [i in hand_verts for i in range(len(mesh.vertices))])
mesh.edges.foreach_set("select", [all(v in hand_verts for v in e.vertices) for e in mesh.edges])
groups_before = len(body.vertex_groups); weighted_before = sum(1 for v in mesh.vertices if v.groups)

bpy.ops.object.select_all(action="DESELECT"); body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_mode(type="FACE"); bpy.ops.mesh.separate(type="SELECTED"); bpy.ops.object.mode_set(mode="OBJECT")
hands = [o for o in bpy.context.selected_objects if o is not body][0]
hands.name = HANDS; hands.data.name = HANDS

def drop_empty_groups(o):
    used = {o.vertex_groups[g.group].name for v in o.data.vertices for g in v.groups if g.weight > 0}
    # by name: removing a group renumbers the ones after it
    for name in [vg.name for vg in o.vertex_groups if vg.name not in used]:
        o.vertex_groups.remove(o.vertex_groups[name])
for o in (body, hands): drop_empty_groups(o)

# The hands get their own material, so an outfit can swap it (gloves) without touching the body.
src_mat = hands.material_slots[0].material
hand_mat = src_mat.copy(); hand_mat.name = f"M_{spec.name}_{HANDS}"
hands.material_slots[0].material = hand_mat

def stats(o):
    m = o.data
    return {"vertices": len(m.vertices), "faces": len(m.polygons), "quads": sum(1 for p in m.polygons if len(p.vertices) == 4),
            "vertexGroups": [g.name for g in o.vertex_groups] if o is hands else len(o.vertex_groups),
            "maxInfluences": max(len(v.groups) for v in m.vertices)}
report["weightsBefore"] = {"vertexGroups": groups_before, "weightedVertices": weighted_before, "vertices": len(body.data.vertices) + len(hands.data.vertices)}
report["parts"] = {BODY: stats(body), HANDS: stats(hands)}
# Seam check: every border vertex of the hands has a body vertex at the same place with the same weights.
def border_coords(o):
    bm2 = bmesh.new(); bm2.from_mesh(o.data)
    vs = {v.index for e in bm2.edges if e.is_boundary for v in e.verts}
    bm2.free(); return vs
hb = border_coords(hands); bb = border_coords(body)
body_by_pos = {tuple(round(c, 6) for c in body.data.vertices[i].co): i for i in bb}
matched, weight_diff, unweighted = 0, 0.0, 0
for i in hb:
    key = tuple(round(c, 6) for c in hands.data.vertices[i].co)
    j = body_by_pos.get(key)
    if j is None: continue
    matched += 1
    wh = {hands.vertex_groups[g.group].name: g.weight for g in hands.data.vertices[i].groups}
    wb = {body.vertex_groups[g.group].name: g.weight for g in body.data.vertices[j].groups}
    if not wh: unweighted += 1
    weight_diff = max([weight_diff] + [abs(wh.get(k, 0) - wb.get(k, 0)) for k in set(wh) | set(wb)])
report["seam"] = {"handBorderVertices": len(hb), "matchedOnBody": matched, "maxWeightDifference": round(weight_diff, 6), "unweightedBorderVertices": unweighted}
bpy.ops.wm.save_as_mainfile(filepath=out_blend, relative_remap=True)
rig_after = {BODY: (len(body.data.vertices), [tuple(p.vertices) for p in body.data.polygons]), HANDS: (len(hands.data.vertices), [tuple(p.vertices) for p in hands.data.polygons])}
if modelled:
    # the same faces, by index, in the body as modelled: both files then keep the same vertices part for part
    bpy.ops.wm.open_mainfile(filepath=modelled[0]); mbody = bpy.data.objects[BODY]; mm_ = mbody.data
    same_before = (len(mm_.vertices), [tuple(p.vertices) for p in mm_.polygons]) == topology_before
    if not same_before: raise SystemExit("the modelled body part does not have the rigged one's topology; run split_hands on files of the same body")
    mm_.polygons.foreach_set("select", [i in hand_faces for i in range(len(mm_.polygons))])
    mm_.vertices.foreach_set("select", [i in hand_verts for i in range(len(mm_.vertices))])
    mm_.edges.foreach_set("select", [all(v in hand_verts for v in e.vertices) for e in mm_.edges])
    bpy.ops.object.select_all(action="DESELECT"); mbody.select_set(True); bpy.context.view_layer.objects.active = mbody
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_mode(type="FACE"); bpy.ops.mesh.separate(type="SELECTED"); bpy.ops.object.mode_set(mode="OBJECT")
    mh = [o for o in bpy.context.selected_objects if o is not mbody][0]; mh.name = HANDS; mh.data.name = HANDS
    mod_after = {BODY: (len(mm_.vertices), [tuple(p.vertices) for p in mm_.polygons]), HANDS: (len(mh.data.vertices), [tuple(p.vertices) for p in mh.data.polygons])}
    report["modelled"] = {"file": modelled[1], "samePartsAsRigged": mod_after == rig_after}
    if mod_after != rig_after: raise SystemExit("the modelled split does not match the rigged split part for part")
    bpy.ops.wm.save_as_mainfile(filepath=modelled[1], relative_remap=True)
json.dump(report, open(report_path, "w"), indent=1); print(json.dumps(report))
