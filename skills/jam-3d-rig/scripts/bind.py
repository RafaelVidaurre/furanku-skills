"""Bind a humanoid mesh to a skeleton placed on landmarks. Runs in Blender.

    blender --background --python-exit-code 1 --python bind.py -- <mesh.glb | mesh.gltf | mesh.blend> <landmarks.json> <out-dir>
            [--profile <profile.json> [--profile-id <id>]] [--max-influences 4] [--fingers auto|none]
            [--height-meters <h>] [--mesh <object name>]... [--name rigged] [--bone-axes along|world]
            [--weights auto|direct|proxy] [--min-own-weight 0.5] [--max-stray-share 0.25] [--stray-below 0.25]

The mesh stands upright in its bind pose (arms away from the body), facing front, at the size the landmarks were taken
at. --height-meters first scales it to that height and stands it on the ground, for a mesh that comes back from another
tool at another size. Every mesh object in the file is bound (clothes, hair), or only those named with --mesh. A mesh
that arrives skinned is rebound from scratch.

Without --profile the skeleton is the landmark skeleton: one bone per landmark, named by the landmark. A profile supplies
the bone names and, with `hierarchy`, extra bones (references/profiles.md). --fingers auto builds finger bones for every
finger whose three joints are in the landmark file; none leaves each hand on its hand bone.

--bone-axes along (default) points each bone at its child, as a DCC shows it; world gives every joint the world's axes in
the rest pose (identity rotations in the glTF file). --weights auto solves heat weights on the mesh itself when it is one
object and the solver accepts it, else on a welded voxel proxy of all objects, transferred back by nearest surface.

Writes <name>.glb (skinned, glTF conventions: metres, +Y up, front +Z), <name>.blend and rig-report.json to <out-dir>.
Exits 1 when the landmarks do not fit the mesh or the deformation check fails: a limb or the head is not mainly weighted
to its own bones (thresholds above). The report is written either way and says which region failed.
"""
import argparse
import json
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamrig  # noqa: E402
from jamrig import gltf, landmarks as lm, regions, report, skeleton  # noqa: E402


class BindError(Exception):
    pass


def parse(argv):
    p = argparse.ArgumentParser(prog="bind.py", description=__doc__.split("\n\n")[0])
    p.add_argument("mesh"); p.add_argument("landmarks"); p.add_argument("out")
    p.add_argument("--profile"); p.add_argument("--profile-id")
    p.add_argument("--max-influences", type=int, default=4)
    p.add_argument("--fingers", choices=("auto", "none"), default="auto")
    p.add_argument("--height-meters", type=float)
    p.add_argument("--mesh", dest="only", action="append", default=[])
    p.add_argument("--name", default="rigged")
    p.add_argument("--bone-axes", choices=("along", "world"), default="along")
    p.add_argument("--weights", choices=("auto", "direct", "proxy"), default="auto")
    p.add_argument("--min-own-weight", type=float, default=0.5)
    p.add_argument("--max-stray-share", type=float, default=0.25)
    p.add_argument("--stray-below", type=float, default=0.25)
    a = p.parse_args(argv)
    if a.max_influences < 1:
        p.error("--max-influences must be at least 1")
    return a


def activate(*objects):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[-1]


# ---- the mesh ------------------------------------------------------------------------------------------------------

def load_meshes(path, only):
    """The mesh objects to bind, unparented, unskinned, welded, with their world transform baked in; nothing else kept."""
    if path.lower().endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=path)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=path)
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    shapes = {pb.custom_shape for o in bpy.data.objects if o.type == "ARMATURE" for pb in o.pose.bones if pb.custom_shape}
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o not in shapes and len(o.data.vertices)]
    if only:
        absent = [n for n in only if n not in {o.name for o in meshes}]
        if absent:
            raise BindError("no mesh object named %s in %s (it has: %s)" % (", ".join(absent), path, ", ".join(sorted(o.name for o in meshes))))
        meshes = [o for o in meshes if o.name in only]
    if not meshes:
        raise BindError("%s holds no mesh" % path)
    welded = 0
    for o in meshes:
        world = o.matrix_world.copy()
        if o.data.users > 1:
            o.data = o.data.copy()
        for m in [m for m in o.modifiers if m.type == "ARMATURE"]:
            o.modifiers.remove(m)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(world)
        if world.determinant() < 0:
            o.data.flip_normals()
        o.vertex_groups.clear()
        # a glTF file stores a vertex once per UV and normal it has; heat weights need the surface connected
        bm = bmesh.new(); bm.from_mesh(o.data)
        before = len(bm.verts)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        welded += before - len(bm.verts)
        bm.to_mesh(o.data); bm.free(); o.data.update()
    for o in [o for o in bpy.data.objects if o not in meshes]:
        bpy.data.objects.remove(o)
    return meshes, welded


def gather(meshes):
    """Combined vertex positions (N x 3), edges and per-object vertex offsets."""
    coords, edges, offsets, at = [], [], [], 0
    for o in meshes:
        n = len(o.data.vertices)
        co = np.empty(n * 3); o.data.vertices.foreach_get("co", co)
        ed = np.empty(len(o.data.edges) * 2, dtype=np.int64); o.data.edges.foreach_get("vertices", ed)
        coords.append(co.reshape(-1, 3)); edges.append(ed.reshape(-1, 2) + at); offsets.append(at); at += n
    return np.concatenate(coords), np.concatenate(edges), offsets


def coincident(coords):
    """Groups of vertex indices that share a position (seams between objects): [[i, j, ...]]."""
    keys = np.round(coords / 1e-5).astype(np.int64)
    _, inverse, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.reshape(-1)
    groups = {}
    for i in np.nonzero(counts[inverse] > 1)[0]:
        groups.setdefault(int(inverse[i]), []).append(int(i))
    return list(groups.values())


def outside_surface(meshes, points):
    """Landmarks that are not enclosed by the surface: fewer than five of the six axis directions hit it."""
    trees = [BVHTree.FromPolygons([v.co.copy() for v in o.data.vertices], [tuple(p.vertices) for p in o.data.polygons]) for o in meshes]
    rays = [Vector(d) for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
    return [name for name, p in points.items()
            if sum(any(tree.ray_cast(Vector(p), d)[0] is not None for tree in trees) for d in rays) < 5]


# ---- armatures -----------------------------------------------------------------------------------------------------

def build_armature(name, bones, axes, deform_only):
    data = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(ob)
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    kept = {b["name"]: b for b in bones if b["deform"] or not deform_only}
    for b in kept.values():
        eb = data.edit_bones.new(b["name"])
        head, tail = Vector(b["head"]), Vector(b["tail"])
        length = max((tail - head).length, 1e-3)
        if axes == "world":
            tail = head + Vector((0.0, 0.0, length))
        elif (tail - head).length < 1e-3:
            tail = head + Vector((0.0, 0.0, length))
        eb.head, eb.tail = head, tail
        eb.align_roll(Vector((0.0, -1.0, 0.0)) if axes == "world" else Vector(skeleton.roll_reference(tuple(head), tuple(tail))))
        eb.use_deform = b["deform"]
    for b in kept.values():
        p = b["parent"]
        while p is not None and p not in kept:
            p = next(x["parent"] for x in bones if x["name"] == p)
        if p is not None:
            data.edit_bones[b["name"]].parent = data.edit_bones[p]
            data.edit_bones[b["name"]].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def read_weights(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups if g.weight > 1e-6} for v in ob.data.vertices]


def heat_weights(ob, guide):
    """Blender's automatic (heat) weights of one object against the guide: (weights per vertex, share left unweighted)."""
    ob.vertex_groups.clear()
    activate(ob, guide)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for m in [m for m in ob.modifiers if m.type == "ARMATURE"]:
        ob.modifiers.remove(m)
    ob.parent = None
    ob.matrix_world = Matrix.Identity(4)
    weights = read_weights(ob)
    ob.vertex_groups.clear()
    return weights, sum(1 for w in weights if not w) / max(len(weights), 1)


def make_proxy(meshes, voxel):
    """One welded, closed stand-in for all the meshes, made by voxel remeshing their union."""
    copies = []
    for o in meshes:
        c = bpy.data.objects.new("proxy", o.data.copy())
        bpy.context.scene.collection.objects.link(c)
        while c.data.shape_keys:
            c.shape_key_remove(c.data.shape_keys.key_blocks[0])
        copies.append(c)
    activate(*copies)
    if len(copies) > 1:
        bpy.ops.object.join()
    proxy = bpy.context.view_layer.objects.active
    proxy.data.remesh_voxel_size = voxel
    proxy.data.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()
    return proxy


def transfer(proxy, proxy_weights, coords):
    """Weights for `coords` from the nearest point of the proxy's surface, interpolated across the face it lies on."""
    verts = [v.co.copy() for v in proxy.data.vertices]
    polys = [tuple(p.vertices) for p in proxy.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    out = []
    for p in coords:
        loc, _, index, _ = tree.find_nearest(Vector(p))
        w = {}
        if index is not None:
            corners = polys[index]
            for vi, share in zip(corners, poly_3d_calc([verts[i] for i in corners], loc)):
                for bone, x in proxy_weights[vi].items():
                    w[bone] = w.get(bone, 0.0) + share * x
        out.append({b: x for b, x in w.items() if x > 1e-5})
    return out


def solve_weights(meshes, guide, coords, names, bones, mode, height, warnings):
    """Raw weights for every vertex of the combined mesh and how they were made."""
    if mode in ("auto", "direct") and (len(meshes) == 1 or mode == "direct"):
        weights, worst = [], 0.0
        for o in meshes:
            w, bare = heat_weights(o, guide)
            weights += w; worst = max(worst, bare)
        if worst <= 0.02 or mode == "direct":
            if worst > 0.02:
                warnings.append("the heat solver left %d%% of an object's vertices unweighted; they follow their nearest bone. "
                                "--weights proxy solves on a welded stand-in instead" % round(worst * 100))
            return weights, {"method": "heat", "unweightedShare": round(worst, 4)}
    for attempt, voxel in enumerate((height / 220.0, height / 140.0)):
        proxy = make_proxy(meshes, voxel)
        w, bare = heat_weights(proxy, guide)
        if bare <= 0.02:
            weights = transfer(proxy, w, coords)
            info = {"method": "heat-on-proxy", "proxyVoxelM": round(voxel, 5), "proxyVertices": len(proxy.data.vertices), "unweightedShare": round(bare, 4)}
            bpy.data.objects.remove(proxy)
            return weights, info
        bpy.data.objects.remove(proxy)
    warnings.append("the heat solver failed on the mesh and on its voxel proxy; weights come from distance to the bones alone "
                    "and are cruder at the joints. Repair the mesh (references/troubleshooting.md) for heat weights")
    return regions.distance_weights(coords, names, bones), {"method": "distance"}


def write_weights(meshes, offsets, weights, bones):
    for o, start in zip(meshes, offsets):
        o.vertex_groups.clear()
        groups = {b["name"]: o.vertex_groups.new(name=b["name"]) for b in bones if b["deform"]}
        for i in range(len(o.data.vertices)):
            for bone, x in weights[start + i].items():
                groups[bone].add([i], x, "REPLACE")


def export_glb(path, objects, max_influences):
    activate(*objects)
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    wanted = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False, export_skins=True,
                  export_animations=False, export_def_bones=False, export_rest_position_armature=True, export_cameras=False,
                  export_lights=False, export_extras=False, export_armature_object_remove=True,
                  export_all_influences=max_influences > 4, export_influence_nb=max_influences)
    bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in known})


# ---- the run -------------------------------------------------------------------------------------------------------

def run(a):
    os.makedirs(a.out, exist_ok=True)
    out_report = os.path.join(a.out, "rig-report.json")
    warnings = []
    rep = {"tool": "jam-3d-rig bind.py " + jamrig.VERSION, "blender": bpy.app.version_string, "passed": False,
           "inputs": [report.stamp("mesh", a.mesh), report.stamp("landmarks", a.landmarks)],
           "options": {"maxInfluences": a.max_influences, "fingers": a.fingers, "heightMeters": a.height_meters, "boneAxes": a.bone_axes,
                       "weights": a.weights, "meshes": a.only or None}, "warnings": warnings}
    try:
        return bind(a, rep, warnings)
    except (BindError, lm.LandmarkError, skeleton.ProfileError) as e:
        rep["error"] = str(e)
        report.write(out_report, rep)
        raise


def bind(a, rep, warnings):
    out_report = os.path.join(a.out, "rig-report.json")
    profile = None
    if a.profile:
        with open(a.profile, encoding="utf-8") as f:
            profile = skeleton.load_profile(json.load(f), a.profile_id)
        rep["inputs"].append(report.stamp("profile", a.profile))
    marks = lm.read(a.landmarks)
    points = lm.to_working(marks)

    meshes, welded = load_meshes(a.mesh, a.only)
    coords, edges, offsets = gather(meshes)
    lo, hi = coords.min(axis=0), coords.max(axis=0)
    scale = 1.0
    if a.height_meters:
        scale = a.height_meters / float(hi[2] - lo[2])
        move = Matrix.Scale(scale, 4) @ Matrix.Translation((0.0, 0.0, -float(lo[2])))
        for o in meshes:
            o.data.transform(move); o.data.update()
        coords, edges, offsets = gather(meshes)
        lo, hi = coords.min(axis=0), coords.max(axis=0)
    height = float(hi[2] - lo[2])
    rep["mesh"] = {"objects": [o.name for o in meshes], "vertices": int(len(coords)),
                   "triangles": int(sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)),
                   "verticesWelded": welded, "scaleApplied": round(scale, 6), "heightMeters": round(height, 4),
                   "bounds": {"min": report.rounded(lo), "max": report.rounded(hi), "frame": "Z up, front -Y"}}

    findings = lm.check(points, (tuple(lo), tuple(hi)))
    rep["landmarks"] = {"source": marks["source"], "findings": findings, "fingers": ["%s.%s" % c for c in lm.finger_chains(points)]}
    if lm.errors(findings):
        hint = "" if a.height_meters else " If the mesh is the right one at another size, pass --height-meters."
        raise BindError("the landmarks do not fit this mesh:\n  " + "\n  ".join(lm.errors(findings)) + hint)
    warnings += [f["message"] for f in findings if f["level"] == "warning"]
    outside = outside_surface(meshes, points)
    if outside:
        rep["landmarks"]["outsideSurface"] = outside
        warnings.append("landmarks not enclosed by the mesh surface: %s" % ", ".join(outside))

    # body regions from the landmarks
    names, region_info = regions.label(coords, edges, points, height)
    use_fingers = a.fingers == "auto" and bool(lm.finger_chains(points))
    if use_fingers:
        region_info["fingers"] = regions.label_fingers(coords, names, points)
        fused = regions.fused_fingers(coords, names, edges.tolist(), points)
        if fused:
            region_info["edgesBetweenFingers"] = fused
            warnings.append("the mesh joins neighbouring fingers beyond their second joints (%s): they cannot bend apart. Separate the "
                            "fingers on the mesh, or pass --fingers none" % ", ".join("%s hand: %d edges" % ("left" if s == "l" else "right", n) for s, n in sorted(fused.items())))
    rep["regions"] = region_info
    absent = [r for r in regions.CHECKED if r not in region_info["counts"]]
    if absent:
        raise BindError("the landmarks do not fit this mesh: no vertices found for %s. Check that the landmark file belongs to "
                        "this mesh, in metres at its size (%.3f m tall here)" % (", ".join(absent), height))

    # the skeleton
    extents = {"top": float(hi[2]), "height": height}
    for s in lm.SIDES:
        hand = np.array(points["hand." + s]); fore = hand - np.array(points["lower-arm." + s]); fore /= max(np.linalg.norm(fore), 1e-9)
        idx = [i for i, r in enumerate(names) if lm.split(r)[1] == s and (lm.split(r)[0] == "hand" or lm.split(r)[0] in lm.FINGER_NAMES)]
        extents["hand." + s] = float(((coords[idx] - hand) @ fore).max()) if idx else 0.0
    bones = skeleton.plan(points, profile, a.fingers, extents)
    names_seen = [b["name"] for b in bones]
    rep["skeleton"] = {"profile": (profile or {}).get("label") or ("profile" if profile else "landmark skeleton"),
                       "boneAxes": a.bone_axes, "bones": [{"name": b["name"], "parent": b["parent"], "landmark": b["landmark"],
                                                           "anchor": b["anchor"], "placed": b["placed"], "deform": b["deform"],
                                                           "head": report.rounded(b["head"]), "tail": report.rounded(b["tail"])} for b in bones]}
    if profile:
        lacking = [name for name in lm.CORE if name not in profile["bones"]]
        if lacking:
            warnings.append("the profile has no bone at %s; that part follows the bones around it" % ", ".join(lacking))

    # weights
    guide = build_armature("guide", bones, "along", deform_only=True)
    raw, how = solve_weights(meshes, guide, coords, names, bones, a.weights, height, warnings)
    bpy.data.objects.remove(guide)
    same = coincident(coords)
    blend = 0.03 * height                                         # weights blend across a region border over this distance
    near = regions.nearby_regions(names, edges, coords, blend, same)
    by_position = regions.finger_weights(coords, names, points, bones, height) if use_fingers else None
    weights, stats = regions.clean_weights(raw, names, near, blend, bones, coords, a.max_influences, points["head"][2] + 0.02 * height, by_position)
    for group in same:                                            # and their weights, so a seam never opens
        for i in group[1:]:
            weights[i] = dict(weights[group[0]])
    hist, most = regions.influence_histogram(weights)
    rep["weights"] = dict(how, **stats, blendBandM=round(blend, 4), seamGroups=len(same), maxInfluences=most, influenceHistogram=hist)
    write_weights(meshes, offsets, weights, bones)

    check = regions.deformation_check(weights, names, bones, a.min_own_weight, a.max_stray_share, a.stray_below)
    rep["deformationCheck"] = check
    if most > a.max_influences:
        check["failures"].append("a vertex follows %d bones; the limit is %d" % (most, a.max_influences)); check["passed"] = False

    # the delivered rig
    rig = build_armature(a.name, bones, a.bone_axes, deform_only=False)
    for o in meshes:
        o.parent = rig
        o.modifiers.new("Armature", "ARMATURE").object = rig
    blend = os.path.join(a.out, a.name + ".blend"); glb = os.path.join(a.out, a.name + ".glb")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend))
    export_glb(os.path.abspath(glb), meshes + [rig], a.max_influences)
    seen = gltf.verify_skinned(glb, a.max_influences)
    rep["outputs"] = [report.stamp("model", glb), report.stamp("blend", blend)]
    rep["glb"] = {k: seen[k] for k in ("meshes", "primitives", "vertices", "maxInfluences", "worstWeightSum", "problems")}
    rep["glb"]["joints"] = len(seen["joints"])
    lost = [n for n in names_seen if n not in seen["joints"]]
    if lost:
        seen["problems"].append("bones missing from the exported skin: " + ", ".join(lost))
    check["failures"] += ["exported file: " + p for p in seen["problems"]]
    check["passed"] = not check["failures"]
    rep["passed"] = check["passed"]
    report.write(out_report, rep)
    summary = {"passed": rep["passed"], "model": glb.replace(os.sep, "/"), "blend": blend.replace(os.sep, "/"),
               "report": out_report.replace(os.sep, "/"), "bones": len(bones), "weights": how["method"],
               "maxInfluences": most, "warnings": warnings, "failures": check["failures"]}
    print(json.dumps(summary))
    if not rep["passed"]:
        raise BindError("deformation check failed; the rig would not move these regions with their bones:\n  "
                        + "\n  ".join(check["failures"]) + "\n%s has the regions and weights" % out_report.replace(os.sep, "/"))
    return summary


if __name__ == "__main__":
    args = parse(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    try:
        run(args)
    except (BindError, lm.LandmarkError, skeleton.ProfileError, OSError) as e:
        print("error: %s" % e, file=sys.stderr)
        sys.exit(1)
