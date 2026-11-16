"""Stills of a mesh under a numbered checker grid read through its first UV set, to show stretch, density and seams.

blender --background --factory-startup --python-exit-code 1 --python render_checker.py -- <model> <out-dir>
    [--label <text>] [--texture-size 1024] [--views front,back,left,right,three-quarter,top]
    [--focus NAME=X,Y,Z,SIZE ...] [--resolution 900]

<model> is a .glb, .gltf, .fbx, .obj or .blend. Even squares of one size everywhere mean even texel density and
low stretch; squashed or huge squares mark the faces to fix; a jump in the grid marks a seam. Unlit, so shading
cannot hide a fault. Writes <label>-<view>.png and <label>-sheet.png to <out-dir>. Exits 1 when a mesh has no UVs.
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
p.add_argument("--texture-size", type=int, default=1024)
js.add_view_arguments(p)
args = js.parse(p)
out = js.out_dir(args.out_dir)
label = args.label or f"{js.stem(args.model)}-checker"

objects = js.load(args.model)
missing = [ob.name for ob in objects if not ob.data.uv_layers]
if missing:
    js.fail(f"no UVs on: {', '.join(missing)}. Unwrap first (unwrap.py)")
grid = bpy.data.images.new("jam-checker", args.texture_size, args.texture_size)
grid.generated_type = "COLOR_GRID"
material = bpy.data.materials.new("jam-checker")
material.use_nodes = True
nodes = material.node_tree
texture = nodes.nodes.new("ShaderNodeTexImage")
texture.image = grid
shader = next(n for n in nodes.nodes if n.type == "BSDF_PRINCIPLED")
nodes.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
nodes.nodes.active = texture
for ob in objects:
    ob.data.uv_layers.active = ob.data.uv_layers[0]
    ob.data.uv_layers[0].active_render = True
    ob.data.materials.clear()
    ob.data.materials.append(material)
scene = bpy.context.scene
js.workbench(scene, light="FLAT", color="TEXTURE")
js.grey_world(scene, 0.5)
files = js.render_views(objects, out, label, args.views, args.focus, args.resolution)
sheet = js.contact_sheet(out, files, f"{label}-sheet.png")
print("CHECKER", {"stills": files, "sheet": sheet})
