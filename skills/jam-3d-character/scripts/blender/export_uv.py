"""Export the unwrapped parts (UV0 active) to GLB and FBX, and confirm geometry is unchanged from the topology file.
blender --background --python-exit-code 1 --python export_uv.py -- <uv.blend> <topology.blend> <out-dir>"""
import bpy, sys, os, json, hashlib
uvb, topo, out = sys.argv[sys.argv.index("--") + 1:][:3]
def geo(path):
    bpy.ops.wm.open_mainfile(filepath=path); r = {}
    for n in sorted(o.name for o in bpy.data.objects if o.type == "MESH"):
        me = bpy.data.objects[n].data; h = hashlib.sha256()
        for v in me.vertices: h.update(("%.6f,%.6f,%.6f;" % tuple(v.co)).encode())
        for p in me.polygons: h.update((",".join(map(str, p.vertices)) + ";").encode())
        r[n] = {"verts": len(me.vertices), "faces": len(me.polygons), "geometrySha256": h.hexdigest()}
    return r
a = geo(topo); b = geo(uvb)
same = {n: a[n] == b[n] for n in a}
json.dump({"topology": a, "uv": b, "identicalGeometry": same}, open(os.path.join(out, "geometry-check.json"), "w"), indent=2); print(json.dumps(same))
for o in bpy.context.scene.objects:
    o.select_set(o.type == "MESH")
    if o.type == "MESH":
        o.data.uv_layers.active = o.data.uv_layers["UV0"]; o.data.uv_layers["UV0"].active_render = True
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "character-uv.glb"), export_format="GLB", use_selection=True, export_apply=True)
bpy.ops.export_scene.fbx(filepath=os.path.join(out, "character-uv.fbx"), use_selection=True, object_types={"MESH"}, use_triangles=False, mesh_smooth_type="FACE")
