"""Unwrap one or several meshes into one UV layout: seams where they hide, even texel density, padded islands.

blender --background --factory-startup --python-exit-code 1 --python unwrap.py -- <model> <out-dir> --texture-size N
    [--name <stem>] [--method auto|seams|smart] [--seam-hints <hints.json>] [--keep-seams]
    [--sharp-angle 60] [--no-material-seams] [--padding-px N] [--separate]
    [--max-density-spread 3.0] [--max-overlap 0.002] [--blend]

<model> is a .glb, .gltf, .fbx, .obj or .blend. Every mesh in it is unwrapped into one shared 0-1 square (one
texture set), or each into its own with --separate.

  seams  cuts along material borders, edges sharper than --sharp-angle, the hints, and seams already marked in a
         .blend (--keep-seams); then cuts every piece that is still closed or still a tube along the side facing
         back and down, and flattens with least stretch. Few large islands: for organic and deforming meshes.
  smart  projects faces by direction. Many small islands, no stretch: for boxy, hard-surface meshes.
  auto   seams, and smart when the seams result fails the thresholds and no hints were given (default).

Islands are scaled to one texel density and packed with --padding-px between them (default texture-size/128).
The hints file is described in references/seams.md. The result has one UV set and plain materials (old textures
would be scrambled by the new layout; bake them across with jam-texture).

Writes <out-dir>/<stem>.glb, <out-dir>/unwrap-report.json and, with --blend, <out-dir>/<stem>.blend. Exits 1 when
the layout fails --max-density-spread, --max-overlap or the padding; the files are still written for inspection.
"""
import heapq
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import jamscene as js  # noqa: E402
import glb  # noqa: E402
import uv_report  # noqa: E402

p = js.parser(__doc__)
p.add_argument("model")
p.add_argument("out_dir")
p.add_argument("--texture-size", type=int, required=True)
p.add_argument("--name")
p.add_argument("--method", choices=["auto", "seams", "smart"], default="auto")
p.add_argument("--seam-hints")
p.add_argument("--keep-seams", action="store_true", help="keep the seams already marked in a .blend")
p.add_argument("--sharp-angle", type=float, default=60.0)
p.add_argument("--no-material-seams", action="store_true")
p.add_argument("--padding-px", type=float)
p.add_argument("--separate", action="store_true", help="give each mesh its own 0-1 square instead of one shared layout")
p.add_argument("--max-density-spread", type=float, default=3.0)
p.add_argument("--max-overlap", type=float, default=0.002)
p.add_argument("--blend", action="store_true", help="also save a .blend, which keeps quads and the marked seams")
args = js.parse(p)
out = js.out_dir(args.out_dir)
name = js.stem(args.model, args.name)
padding = args.padding_px if args.padding_px is not None else args.texture_size / 128
hints = {}
if args.seam_hints:
    try:
        with open(args.seam_hints) as handle:
            hints = json.load(handle)
    except (OSError, ValueError) as error:
        js.fail(f"cannot read the seam hints {args.seam_hints}: {error}", 2)

objects = js.load(args.model)
skinned = any(m.type == "ARMATURE" for ob in objects for m in ob.modifiers)
if not skinned:
    js.apply_transforms(objects)
low, high = js.bounds(objects)
# glTF splits vertices along the old UV seams and hard edges; weld them so the surface is connected again. The
# shading is kept: an edge whose two faces had different normals at a shared corner stays a hard edge.
welded = 0
grain = (high - low).length * 1e-4 or 1e-9
key = lambda centre, point: tuple(round(c / grain) for c in (*centre, *point))
for ob in objects:
    mesh = ob.data
    seen = {}
    if hasattr(mesh, "corner_normals"):
        for poly in mesh.polygons:
            for loop_index in poly.loop_indices:
                seen[key(poly.center, mesh.vertices[mesh.loops[loop_index].vertex_index].co)] = mesh.corner_normals[loop_index].vector.copy()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    count = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=(high - low).length * 1e-6)
    welded += count - len(bm.verts)
    for face in bm.faces:
        face.smooth = True
    for edge in bm.edges:
        hard = False
        if seen and len(edge.link_faces) == 2:
            for vert in edge.verts:
                first, second = (seen.get(key(face.calc_center_median(), vert.co)) for face in edge.link_faces)
                hard = hard or first is None or second is None or first.dot(second) < 0.9995
        elif not seen and len(edge.link_faces) == 2:
            hard = edge.calc_face_angle(0.0) > math.radians(args.sharp_angle)
        edge.smooth = not hard
    bm.to_mesh(mesh)
    bm.free()
    if hasattr(mesh, "free_normals_split"):
        mesh.free_normals_split()
    for attribute in [a for a in mesh.attributes if a.name == "custom_normal"]:
        mesh.attributes.remove(attribute)
FRONT, UP = Vector((0, -1, 0)), Vector((0, 0, 1))


def to_blender(point):
    """Hints are written in the model file's own axes: glTF (+Y up, front +Z) unless the file says "space": "blender"."""
    x, y, z = point
    return Vector((x, y, z)) if hints.get("space") == "blender" else Vector((x, -z, y))


def exposure(edge):
    normal = sum((f.normal for f in edge.link_faces), Vector()).normalized() if edge.link_faces else Vector()
    return max(0.0, normal.dot(FRONT)) + 0.5 * max(0.0, normal.dot(UP))


def hidden_cost(edge):
    return edge.calc_length() * (1.0 + 3.0 * exposure(edge))


def dijkstra(starts, targets, allowed, cost):
    """Edges of the cheapest path from any start vertex to any target vertex."""
    targets = set(targets) - set(starts)
    best = {v: 0.0 for v in starts}
    previous, done = {}, set()
    heap = [(0.0, v.index, v) for v in starts]
    heapq.heapify(heap)
    while heap:
        distance, _, vertex = heapq.heappop(heap)
        if vertex in done:
            continue
        done.add(vertex)
        if vertex in targets:
            path = []
            while vertex in previous:
                edge, vertex = previous[vertex]
                path.append(edge)
            return path
        for edge in vertex.link_edges:
            if not allowed(edge):
                continue
            other = edge.other_vert(vertex)
            candidate = distance + cost(edge)
            if candidate < best.get(other, 1e30):
                best[other] = candidate
                previous[other] = (edge, vertex)
                heapq.heappush(heap, (candidate, other.index, other))
    return []


def chains(edges):
    """Groups of edges connected through shared vertices."""
    left, out_ = set(edges), []
    while left:
        edge = left.pop()
        group, stack = [edge], [edge]
        while stack:
            for vertex in stack.pop().verts:
                for other in vertex.link_edges:
                    if other in left:
                        left.remove(other)
                        group.append(other)
                        stack.append(other)
        out_.append(group)
    return out_


def pieces(bm):
    """Sets of faces connected without crossing a seam."""
    seen, out_ = set(), []
    for face in bm.faces:
        if face in seen:
            continue
        group, stack = {face}, [face]
        while stack:
            for edge in stack.pop().edges:
                if edge.seam:
                    continue
                for other in edge.link_faces:
                    if other not in group:
                        group.add(other)
                        stack.append(other)
        seen |= group
        out_.append(group)
    return out_


def connected_part(bm):
    """Vertex -> number of the connected part of the mesh it belongs to."""
    part, number = {}, 0
    for vertex in bm.verts:
        if vertex in part:
            continue
        part[vertex] = number
        stack = [vertex]
        while stack:
            for edge in stack.pop().link_edges:
                for end in edge.verts:
                    if end not in part:
                        part[end] = number
                        stack.append(end)
        number += 1
    return part


def nearest_vertex(verts, point, side=None):
    distance = lambda v: (v.co - point).length
    closest = min(verts, key=distance)
    if side is None:
        return closest
    reach = distance(closest) * 1.35 + 1e-6
    return max((v for v in verts if distance(v) <= reach), key=lambda v: (v.co - point).dot(side))


def apply_hints(bm, notes):
    for loop in hints.get("loops", []):
        at, axis = to_blender(loop["at"]), to_blender(loop["axis"]).normalized()
        above = {f: (f.calc_center_median() - at).dot(axis) > 0 for f in bm.faces}
        crossing = [e for e in bm.edges if len(e.link_faces) == 2 and above[e.link_faces[0]] != above[e.link_faces[1]]]
        groups = chains(crossing)
        if not groups:
            notes.setdefault("hintsWithoutEffect", []).append(loop.get("name", "loop"))
            continue
        # every ring that runs around the point (an inner and an outer shell both count); rings around other limbs do not
        def around(group):
            points = [(e.verts[0].co + e.verts[1].co) / 2 for e in group]
            centre = sum(points, Vector()) / len(points)
            return (at - centre).length < sum((q - centre).length for q in points) / len(points)

        rings = [g for g in groups if around(g)] or [min(groups, key=lambda g: min(((e.verts[0].co + e.verts[1].co) / 2 - at).length for e in g))]
        ring = [e for g in rings for e in g]
        for edge in ring:
            edge.seam = True
        notes.setdefault("loops", {})[loop.get("name", f"loop{len(notes.get('loops', {}))}")] = len(ring)
    part = connected_part(bm)
    for path in hints.get("paths", []):
        side = to_blender(path["side"]).normalized() if "side" in path else None

        def stop(point, verts):
            if isinstance(point, dict):
                return nearest_vertex(verts, to_blender(point["at"]), to_blender(point["side"]).normalized() if "side" in point else None)
            return nearest_vertex(verts, to_blender(point))

        # a path stays on one connected part of the mesh: the one its first point lands on
        first = stop(path["from"], bm.verts)
        same_part = [v for v in bm.verts if part[v] == part[first]]
        stops = [first] + [stop(point, same_part) for point in [*path.get("via", []), path["to"]]]
        if side is None:
            cost = hidden_cost
        else:
            cost = lambda e, side=side: e.calc_length() * (1.0 + 3.0 * (1.0 - max(0.0, sum((f.normal for f in e.link_faces), Vector()).normalized().dot(side))))
        total = 0
        for start, end in zip(stops, stops[1:]):
            for edge in dijkstra({start}, {end}, lambda e: True, cost):
                edge.seam = True
                total += 1
        notes.setdefault("paths", {})[path.get("name", f"path{len(notes.get('paths', {}))}")] = total
    for split in hints.get("sides", []):
        at = to_blender(split["at"])
        seed = min(bm.faces, key=lambda f: (f.calc_center_median() - at).length)
        group = next(g for g in pieces(bm) if seed in g)
        if "axis" in split:
            axis = to_blender(split["axis"]).normalized()
        else:
            import numpy as np
            points = np.array([v.co[:] for v in {v for f in group for v in f.verts}])
            axis = Vector(np.linalg.svd(points - points.mean(axis=0), full_matrices=False)[2][2])
        threshold = float(split.get("threshold", 0.0))
        label = {f: f.normal.dot(axis) > threshold for f in group}
        for _ in range(3):   # majority smoothing, so single stray faces do not become islands
            change = {}
            for face in group:
                around = [g for e in face.edges for g in e.link_faces if g is not face and g in label]
                other = sum(1 for g in around if label[g] != label[face])
                if around and other > len(around) / 2:
                    change[face] = not label[face]
            label.update(change)
        count = 0
        for edge in {e for f in group for e in f.edges}:
            sides = [label[f] for f in edge.link_faces if f in label]
            if len(sides) == 2 and sides[0] != sides[1]:
                edge.seam = True
                count += 1
        notes.setdefault("sides", {})[split.get("name", f"sides{len(notes.get('sides', {}))}")] = count


def open_pieces(bm, notes, rounds=64):
    """Cut every piece that cannot lie flat: a closed surface gets one cut from its top to its bottom, a tube (two
    borders of similar length) one cut between them. Cuts keep to the side facing back and down."""
    cuts = {"closed": 0, "tube": 0}
    for _ in range(rounds):
        changed = False
        for group in pieces(bm):
            if len(group) < 4:
                continue
            border = [e for e in {e for f in group for e in f.edges} if e.seam or e.is_boundary]
            inside_only = lambda e, group=group: not e.seam and all(f in group for f in e.link_faces)
            if not border:
                verts = {v for f in group for v in f.verts}
                top, bottom = max(verts, key=lambda v: v.co.z), min(verts, key=lambda v: v.co.z)
                if (top.co - bottom.co).length < 1e-9:
                    continue
                path = dijkstra({top}, {bottom}, inside_only, hidden_cost)
                kind = "closed"
            else:
                loops = sorted(chains(border), key=lambda g: -sum(e.calc_length() for e in g))
                if len(loops) < 2:
                    continue
                first, second = (sum(e.calc_length() for e in g) for g in loops[:2])
                if second < 0.5 * first:
                    continue
                starts, ends = {v for e in loops[0] for v in e.verts}, {v for e in loops[1] for v in e.verts}
                path = dijkstra(starts, ends, inside_only, hidden_cost)
                kind = "tube"
            if path:
                for edge in path:
                    edge.seam = True
                cuts[kind] += 1
                changed = True
        if not changed:
            break
    notes["cuts"] = cuts


def mark_seams(ob):
    notes = {}
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    if not args.keep_seams:
        for edge in bm.edges:
            edge.seam = False
    limit = math.radians(args.sharp_angle)
    material = sharp = 0
    for edge in bm.edges:
        if len(edge.link_faces) != 2:
            continue
        a, b = edge.link_faces
        if not args.no_material_seams and a.material_index != b.material_index:
            edge.seam = True
            material += 1
        elif edge.calc_face_angle(0.0) > limit:
            edge.seam = True
            sharp += 1
    notes["materialBorderEdges"], notes["sharpEdges"] = material, sharp
    if hints:
        apply_hints(bm, notes)
    open_pieces(bm, notes)
    notes["seamEdges"] = sum(1 for e in bm.edges if e.seam)
    notes["pieces"] = len(pieces(bm))
    bm.to_mesh(ob.data)
    bm.free()
    return notes


def fresh_layer(ob):
    while ob.data.uv_layers:
        ob.data.uv_layers.remove(ob.data.uv_layers[0])
    layer = ob.data.uv_layers.new(name="UVMap")
    ob.data.uv_layers.active = layer
    layer.active_render = True


def failed_pieces(ob, split=False):
    """Select the faces of pieces the solver could not lay flat: faces without UV area, or a texel density that
    varies more than a hundredfold inside the piece. With split, each such piece also gets a seam between its
    front-facing and back-facing halves. Returns how many pieces and faces were selected."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    layer = bm.loops.layers.uv.active
    marked = faces = 0
    for group in pieces(bm):
        bad, ratios = 0, []
        for face in group:
            uv = [loop[layer].uv for loop in face.loops]
            area = 0.5 * sum(uv[i].x * uv[(i + 1) % len(uv)].y - uv[(i + 1) % len(uv)].x * uv[i].y for i in range(len(uv)))
            world = face.calc_area()
            if world > 1e-12 and area <= 1e-12:
                bad += 1
            elif world > 1e-12:
                ratios.append(area / world)
        ratios.sort()
        uneven = len(ratios) > 8 and ratios[int(len(ratios) * 0.98)] > 100 * max(ratios[int(len(ratios) * 0.02)], 1e-30)
        fail = bad > max(1, 0.01 * len(group)) or uneven
        for face in group:
            face.select = fail
        if fail:
            marked += 1
            faces += len(group)
        if fail and split:
            front = {f: f.normal.dot(FRONT) > 0 for f in group}
            for _ in range(3):
                change = {}
                for face in group:
                    around = [g for e in face.edges for g in e.link_faces if g is not face and g in front]
                    if around and sum(1 for g in around if front[g] != front[face]) > len(around) / 2:
                        change[face] = not front[face]
                front.update(change)
            for edge in {e for f in group for e in f.edges}:
                halves = [front[f] for f in edge.link_faces if f in front]
                if len(halves) == 2 and halves[0] != halves[1]:
                    edge.seam = True
    for edge in bm.edges:
        edge.select = all(f.select for f in edge.link_faces) and bool(edge.link_faces)
    for vert in bm.verts:
        vert.select = all(f.select for f in vert.link_faces) and bool(vert.link_faces)
    bm.to_mesh(ob.data)
    bm.free()
    return marked, faces


def uv_islands(ob):
    """How many islands the mesh's layout has: faces joined through corners that share a vertex and a UV."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    layer = bm.loops.layers.uv.active
    parent = {}

    def find(key):
        while parent.setdefault(key, key) != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    for face in bm.faces:
        keys = [(loop.vert.index, round(loop[layer].uv.x, 5), round(loop[layer].uv.y, 5)) for loop in face.loops]
        for key in keys[1:]:
            parent[find(key)] = find(keys[0])
    count = len({find(key) for key in list(parent)})
    bm.free()
    return count


def flatten(group, method, solver="MINIMUM_STRETCH"):
    """Lay the meshes of one layout flat and pack them. Returns what had to be redone because the solver failed on it."""
    redone = {}
    smart = dict(angle_limit=math.radians(66), island_margin=0.0, correct_aspect=True, scale_to_bounds=False)
    js.select(group)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    if method == "smart":
        bpy.ops.uv.smart_project(**smart)
    else:
        solvers = [e.identifier for e in bpy.ops.uv.unwrap.get_rna_type().properties["method"].enum_items]
        bpy.ops.uv.unwrap(method=solver if solver in solvers else "ANGLE_BASED", fill_holes=True, correct_aspect=True, margin=0.0)
        # a piece the solver gives up on is first halved into front and back and solved again, then projected
        for step in ("halved", "projected"):
            bpy.ops.object.mode_set(mode="OBJECT")
            found = [failed_pieces(ob, split=step == "halved") for ob in group]
            bpy.ops.object.mode_set(mode="EDIT")
            redone[step] = {"pieces": sum(f[0] for f in found), "faces": sum(f[1] for f in found)}
            if not redone[step]["faces"]:
                break
            bpy.ops.mesh.select_mode(type="FACE")
            if step == "halved":
                bpy.ops.uv.unwrap(method=solver if solver in solvers else "ANGLE_BASED", fill_holes=True, correct_aspect=True, margin=0.0)
            else:
                bpy.ops.uv.smart_project(**smart)
        bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    islands = sum(uv_islands(ob) for ob in group)
    bpy.ops.object.mode_set(mode="EDIT")
    # exact-shape packing fits irregular islands closely, but takes tens of seconds on a handful of large ones
    # (six faces of a box); those pack as well by their bounding boxes
    shape = "AABB" if islands <= 12 else "CONCAVE"
    bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=padding / args.texture_size, shape_method=shape)
    bpy.ops.object.mode_set(mode="OBJECT")
    return redone


def plain_materials():
    """Replace textured materials with plain ones of the same name and base colour, so the layout change scrambles nothing."""
    for ob in objects:
        for slot in ob.material_slots:
            old = slot.material
            if old is None or not old.node_tree or not any(n.type == "TEX_IMAGE" for n in old.node_tree.nodes):
                continue
            shader = next((n for n in old.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            colour = tuple(shader.inputs["Base Color"].default_value) if shader else (0.8, 0.8, 0.8, 1)
            label = old.name
            old.name = label + "-source"
            new = bpy.data.materials.new(label)
            if new.node_tree is None:
                new.use_nodes = True
            plain = next((n for n in new.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if plain:
                plain.inputs["Base Color"].default_value = colour if not shader or not shader.inputs["Base Color"].is_linked else (0.8, 0.8, 0.8, 1)
            slot.material = new


def measured(method, solver, seams):
    redone = [flatten(group, method, solver) for group in ([[ob] for ob in objects] if args.separate else [objects])]
    projected = {step: {key: sum(r.get(step, {}).get(key, 0) for r in redone) for key in ("pieces", "faces")} for step in ("halved", "projected")}
    path = js.inside(out, f"{name}.glb")
    js.export_glb(path, objects, skins=skinned)
    primitives = glb.read(path).primitives()
    per_square = [primitives] if not args.separate else [[q for q in primitives if q["mesh"] == m] for m in sorted({q["mesh"] for q in primitives})]
    results = []
    for primitives in per_square:
        metrics = uv_report.measure(primitives, args.texture_size)
        metrics.pop("_layout", None)
        checks = uv_report.compare(metrics, args.max_density_spread, args.max_overlap)
        results.append({"metrics": metrics, "failed": [c["id"] for c in checks if not c["passed"]]})
    return {"method": method, "solver": solver if method == "seams" else "projection", "seams": seams, "piecesRedone": projected, "layouts": results,
            "passed": not any(r["failed"] for r in results)}


def attempt(method, solver=None):
    seams = {}
    for ob in objects:
        fresh_layer(ob)
        if method == "seams":
            seams[ob.name] = mark_seams(ob)
    if method == "smart":
        return [measured(method, None, seams)]
    # least stretch first; it gives up on a piece that is not a disc, where the angle-based solver still answers
    results = []
    for choice in ([solver] if solver else ["MINIMUM_STRETCH", "ANGLE_BASED"]):
        results.append(measured(method, choice, seams))
        if results[-1]["passed"]:
            break
    return results


plain_materials()
order = {"auto": ["seams", "smart"] if not hints else ["seams"], "seams": ["seams"], "smart": ["smart"]}[args.method]
attempts = []
for method in order:
    attempts += attempt(method)
    if attempts[-1]["passed"]:
        break
final = attempts[-1] if attempts[-1]["passed"] else min(attempts, key=lambda a: sum(len(r["failed"]) for r in a["layouts"]))
if final is not attempts[-1]:
    attempt(final["method"], final["solver"] if final["method"] == "seams" else None)
if args.blend:
    js.save_blend(js.inside(out, f"{name}.blend"))
report = {"blender": bpy.app.version_string, "source": os.path.basename(args.model), "model": f"{name}.glb", "textureSize": args.texture_size,
          "paddingPx": padding, "weldedVertices": welded, "requested": args.method, "used": final["method"], "solver": final["solver"], "hints": os.path.basename(args.seam_hints) if args.seam_hints else None,
          "sharedLayout": not args.separate, "faces": js.face_stats(objects), "attempts": attempts, "passed": final["passed"],
          "thresholds": {"maxDensitySpread": args.max_density_spread, "maxOverlap": args.max_overlap}}
js.write_report(out, "unwrap-report.json", report)
summary = [{k: r["metrics"].get(k) for k in ("islands", "coverage", "overlapShare", "densitySpreadP95overP5")} | {"failed": r["failed"]} for r in final["layouts"]]
print("UNWRAP", {"used": final["method"], "solver": final["solver"], "redone": final["piecesRedone"], "tried": [f"{a['method']}/{a['solver']}" for a in attempts], "layouts": summary})
if not final["passed"]:
    js.fail("the layout fails: " + "; ".join(", ".join(r["failed"]) for r in final["layouts"] if r["failed"])
            + ". See unwrap-report.json; add seam hints, choose --method smart, or state looser thresholds")
