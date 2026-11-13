"""Write the joint positions of a Meshy auto-rig (its rigged GLB) to JSON: bone heads and tails in world space, with the mesh bounds.
Only these positions are used, to place Manny's skeleton on the character; Meshy's skeleton and weights are not delivered.
blender --background --python-exit-code 1 --python meshy_rig_joints.py -- <rigged_character.glb> <meshy-joints.json>"""
import bpy, sys, json
glb, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE"); M = arm.matrix_world
bones = {b.name: {"parent": b.parent.name if b.parent else None, "head": [round(x, 4) for x in (M @ b.head_local)], "tail": [round(x, 4) for x in (M @ b.tail_local)]} for b in arm.data.bones}
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
vs = [m.matrix_world @ v.co for m in meshes for v in m.data.vertices]
info = {"boneCount": len(bones), "meshBounds": [[round(min(v[i] for v in vs), 4) for i in range(3)], [round(max(v[i] for v in vs), 4) for i in range(3)]], "bones": bones}
json.dump(info, open(out, "w"), indent=1)
print(info["boneCount"], info["meshBounds"])
for n, b in bones.items(): print(n, b["parent"], b["head"])
