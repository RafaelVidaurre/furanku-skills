"""Make the texture paths stored in a delivery folder's Blender files relative to that folder, so no machine path is delivered.
blender --background --python relative_paths.py -- <delivery-folder> [blend ...]
Without blend paths (relative to the folder), the first character's four files are processed."""
import bpy, sys, os
args = sys.argv[sys.argv.index("--") + 1:]; root = args[0]; tex = os.path.join(root, "stages", "texture")
blends = args[1:] or ["source/character-rigged.blend", "stages/texture/character-textured.blend", "stages/uv/character-uv.blend", "stages/topology/character-topology.blend"]
for blend in blends:
    path = os.path.join(root, blend); bpy.ops.wm.open_mainfile(filepath=path); changed = []
    for img in list(bpy.data.images):
        if not img.filepath: continue
        name = os.path.basename(img.filepath.replace("\\", "/"))
        local = os.path.join(tex, name)
        if os.path.exists(local): img.filepath = bpy.path.relpath(os.path.abspath(local), start=os.path.dirname(os.path.abspath(path))); changed.append(name)
        elif img.users == 0: bpy.data.images.remove(img)
        else: img.filepath = "//" + name   # an input that is not part of the delivery; keep only its name
    bpy.ops.wm.save_as_mainfile(filepath=path, relative_remap=False)
    leftovers = [i.filepath for i in bpy.data.images if i.filepath and not i.filepath.startswith("//")]
    print("RELPATH", blend, "remapped", len(changed), "absolute left", leftovers)
