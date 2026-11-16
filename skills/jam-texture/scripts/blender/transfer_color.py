"""Carry the colour of one mesh onto another: lay the target onto the source, then bake the source's base colour
through the target's own UVs.

blender --background --factory-startup --python-exit-code 1 --python transfer_color.py -- <target> <source> <out-dir>
    --size N [--name <stem>] [--no-align] [--reach F] [--margin-px 16] [--min-hit-share 0.98]

For a remesh that came back without colour, or rescaled and moved: the target is scaled uniformly and moved onto
the source first (--no-align keeps it in place). A target without UVs gets a simple projected layout so the colour
can travel with it to the next step; unwrap it properly (jam-uv) and bake again (bake_textures.py) for delivery.
Writes <out-dir>/<stem>.glb (the aligned target, coloured), <out-dir>/<stem>_basecolor.png and
<out-dir>/transfer-report.json with the alignment, the distance between the surfaces and the share of texels that
found the source. Exits 1 when that share is under --min-hit-share.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402
import bakecore  # noqa: E402

p = js.parser(__doc__)
p.add_argument("target")
p.add_argument("source")
p.add_argument("out_dir")
p.add_argument("--size", type=int, required=True)
p.add_argument("--name")
p.add_argument("--no-align", action="store_true")
p.add_argument("--reach", type=float, default=0.004)
p.add_argument("--margin-px", type=int, default=16)
p.add_argument("--min-hit-share", type=float, default=0.98)
args = js.parse(p)
out = js.out_dir(args.out_dir)
name = js.stem(args.target, args.name)

targets = js.load(args.target)
js.apply_transforms(targets)
sources = js.load(args.source, reset=False)
js.apply_transforms(sources)
tree, points = js.surface(sources)
applied = None if args.no_align else js.fit(targets, tree, points)
apart = js.deviation(targets, tree, points)
temporary_uvs = []
for ob in targets:
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
        js.select([ob])
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
        bpy.ops.object.mode_set(mode="OBJECT")
        temporary_uvs.append(ob.name)
    ob.data.uv_layers.active = ob.data.uv_layers[0]
low, high = js.bounds(targets)
baked, facts = bakecore.bake_maps(targets, sources, args.size, ["basecolor"], args.reach * ((high - low).length or 1.0), margin_px=args.margin_px)
facts.pop("_covered")
colour = js.inside(out, f"{name}_basecolor.png")
bakecore.save_png(baked["basecolor"], colour, "sRGB")
for ob in sources:
    bpy.data.objects.remove(ob)
material = bakecore.final_material(name, {"basecolor": colour}, {})
for ob in targets:
    ob.data.materials.clear()
    ob.data.materials.append(material)
js.export_glb(js.inside(out, f"{name}.glb"), targets)
problems = []
if facts["hitShare"] < args.min_hit_share:
    problems.append(f"only {facts['hitShare']:.1%} of the target's texels found the source (at least {args.min_hit_share:.0%} expected)")
report = dict(facts, blender=bpy.app.version_string, target=os.path.basename(args.target), source=os.path.basename(args.source), model=f"{name}.glb",
              texture=os.path.basename(colour), aligned=applied, deviationShareOfDiagonal=apart, temporaryUVsOn=temporary_uvs, problems=problems)
js.write_report(out, "transfer-report.json", report)
print("TRANSFER", {"aligned": applied, "deviation": apart, "hitShare": facts["hitShare"], "temporaryUVsOn": temporary_uvs, "problems": problems})
if problems:
    js.fail("; ".join(problems))
