"""Stills of a textured model from fixed views: lit under neutral light, and unlit base colour.

blender --background --factory-startup --python-exit-code 1 --python render_textured.py -- <model> <out-dir>
    [--label <text>] [--modes lit,unlit] [--views front,back,left,right,three-quarter,back-three-quarter]
    [--focus NAME=X,Y,Z,SIZE ...] [--resolution 900]

<model> is a .glb, .gltf, .fbx, .obj or .blend. `lit` uses an even grey sky and one soft sun, so colour, roughness
and normal detail read without a mood; `unlit` shows base colour alone, where a seam, a bleed or a missed texel
cannot hide in shading. Views `under` and `top` are also available for surfaces a camera rarely sees. Framing is
orthographic and fixed to the bounds, so two versions rendered with the same arguments compare directly.
Writes <label>-<mode>-<view>.png and one <label>-<mode>-sheet.png per mode to <out-dir>.
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
p.add_argument("--modes", default="lit,unlit")
js.add_view_arguments(p, default="front,back,left,right,three-quarter,back-three-quarter")
args = js.parse(p)
out = js.out_dir(args.out_dir)
label = args.label or js.stem(args.model)
modes = [m.strip() for m in args.modes.split(",") if m.strip()]
if any(m not in ("lit", "unlit") for m in modes):
    js.fail("--modes takes lit, unlit or both", 2)

objects = js.load(args.model)
scene = bpy.context.scene
js.grey_world(scene, 0.55, 1.0)
js.sun(scene, energy=2.5)
for ob in objects:
    for slot in ob.material_slots:
        tree = slot.material.node_tree if slot.material else None
        shader = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if tree else None
        if shader and shader.inputs["Base Color"].is_linked:
            node = shader.inputs["Base Color"].links[0].from_node
            while node.type != "TEX_IMAGE" and any(i.is_linked for i in node.inputs):
                node = next(i for i in node.inputs if i.is_linked).links[0].from_node
            if node.type == "TEX_IMAGE":
                tree.nodes.active = node
sheets = []
for mode in modes:
    if mode == "lit":
        js.cycles(scene, 32)
    else:
        js.workbench(scene, light="FLAT", color="TEXTURE")
    files = js.render_views(objects, out, f"{label}-{mode}", args.views, args.focus, args.resolution)
    sheets.append(js.contact_sheet(out, files, f"{label}-{mode}-sheet.png"))
print("TEXTURED", {"sheets": sheets})
