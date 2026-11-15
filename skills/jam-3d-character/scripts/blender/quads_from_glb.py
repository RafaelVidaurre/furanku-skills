"""Turn a provider's quad remesh delivered as GLB (glTF stores triangles, with vertices split along UV seams) back into
a welded quad mesh in a .blend, for warp_to_body.py: vertices at the same place are merged (UVs live per face corner,
so the layout survives) and triangle pairs are joined into quads.
blender --background --python-exit-code 1 --python quads_from_glb.py -- <in.glb> <out.blend> <report.json>"""
import bpy, bmesh, sys, json
src, out, rep = sys.argv[sys.argv.index("--") + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if len(meshes) != 1: raise SystemExit(f"expected one mesh, found {len(meshes)}")
o = meshes[0]
for x in list(bpy.context.scene.objects):
    if x is not o: bpy.data.objects.remove(x)
o.parent = None
bm = bmesh.new(); bm.from_mesh(o.data)
before = {"faces": len(bm.faces), "verts": len(bm.verts), "openEdges": sum(1 for e in bm.edges if e.is_boundary)}
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
bmesh.ops.join_triangles(bm, faces=bm.faces, angle_face_threshold=3.1416, angle_shape_threshold=3.1416, cmp_uvs=False, cmp_vcols=False, cmp_seam=False, cmp_sharp=False, cmp_materials=True)
after = {"faces": len(bm.faces), "quads": sum(1 for f in bm.faces if len(f.verts) == 4), "tris": sum(1 for f in bm.faces if len(f.verts) == 3),
         "ngons": sum(1 for f in bm.faces if len(f.verts) > 4), "openEdges": sum(1 for e in bm.edges if e.is_boundary), "nonManifold": sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)}
bm.to_mesh(o.data); bm.free()
for p in o.data.polygons: p.use_smooth = True
bpy.ops.wm.save_as_mainfile(filepath=out)
json.dump({"before": before, "after": after}, open(rep, "w"), indent=1); print(json.dumps({"before": before, "after": after}))
