"""Stills of a mesh's topology from fixed views: wireframe over clay, or clay alone, plus polygon counts.

blender --background --factory-startup --python-exit-code 1 --python render_wire.py -- <model> <out-dir>
    [--label <text>] [--style wire|clay] [--views front,back,left,right,three-quarter,top]
    [--focus NAME=X,Y,Z,SIZE ...] [--resolution 900]

<model> is a .glb, .gltf, .fbx, .obj or .blend. Views are orthographic and framed to the bounds, so two candidates
rendered with the same arguments compare directly. --focus adds a close-up (centre as shares of the bounding box:
X right, Y up from the base, Z depth from the front; SIZE as a share of the height), for a joint or a thin part.
`clay` drops the wireframe to show grooves, dents and creases that textures and edges hide.
Writes <label>-<view>.png, <label>-sheet.png (all views in one image) and <label>-stats.json to <out-dir>.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402

p = js.parser(__doc__)
p.add_argument("model")
p.add_argument("out_dir")
p.add_argument("--label")
p.add_argument("--style", choices=["wire", "clay"], default="wire")
js.add_view_arguments(p)
args = js.parse(p)
out = js.out_dir(args.out_dir)
label = args.label or f"{js.stem(args.model)}-{args.style}"

objects = js.load(args.model)
scene = bpy.context.scene
low, high = js.bounds(objects)
height = max(high - low)
stats = dict(js.face_stats(objects), label=label, model=os.path.basename(args.model), style=args.style,
             size=[round(v, 5) for v in high - low], blender=bpy.app.version_string,
             poles=None)
shown = list(objects)
for ob in objects:
    ob.color = (0.8, 0.8, 0.8, 1)
    if args.style == "wire":
        wire = ob.copy()
        wire.data = ob.data.copy()
        scene.collection.objects.link(wire)
        modifier = wire.modifiers.new("jam-wire", "WIREFRAME")
        modifier.thickness = height * 0.0012
        modifier.use_replace = True
        wire.color = (0.03, 0.03, 0.03, 1)
        shown.append(wire)
js.workbench(scene, light="STUDIO", color="OBJECT")
js.grey_world(scene, 0.5)
files = js.render_views(objects, out, label, args.views, args.focus, args.resolution)
sheet = js.contact_sheet(out, files, f"{label}-sheet.png")
stats.pop("poles")
stats["stills"] = files
stats["sheet"] = sheet
js.write_report(out, f"{label}-stats.json", stats)
print("WIRE", {"faces": stats["faces"], "quadShare": stats["quadShare"], "exportTriangles": stats["exportTriangles"], "sheet": sheet})
