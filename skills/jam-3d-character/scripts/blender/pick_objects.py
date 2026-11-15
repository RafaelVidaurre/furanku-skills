"""Assemble a .blend from named mesh objects of other .blend files (materials and images come along).
blender --background --python-exit-code 1 --python pick_objects.py -- <out.blend> <source.blend>:<Object>[,<Object>...] ..."""
import bpy, sys
args = sys.argv[sys.argv.index("--") + 1:]
out, specs = args[0], args[1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
for spec in specs:
    path, names = spec.rsplit(":", 1); names = names.split(",")
    with bpy.data.libraries.load(path) as (s_, d_): d_.objects = [n for n in s_.objects if n in names]
    for o in d_.objects:
        if o is None: raise SystemExit(f"missing object in {path}")
        bpy.context.scene.collection.objects.link(o)
bpy.ops.wm.save_as_mainfile(filepath=out, relative_remap=True); print("PICKED", [o.name for o in bpy.data.objects])
