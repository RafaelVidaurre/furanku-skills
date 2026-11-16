"""Bake a source model's surface onto a target model's UVs and deliver the target with the new textures.

blender --background --factory-startup --python-exit-code 1 --python bake_textures.py -- <target> <out-dir>
    --source <model> --size N [--normal-source <model>] [--maps basecolor,normal,roughness,metallic]
    [--name <stem>] [--reach F] [--margin-px 16] [--min-hit-share 0.98] [--samples 2]

<target> has the final topology and one UV set (from jam-uv). --source is what it should look like: the generated
or high-detail model, the same model before its UVs changed, or a bought model with several materials to merge
into one. --normal-source gives the surface detail for the normal map when it lives in another file (a dense
untextured mesh); default: the source. Models are .glb, .gltf, .fbx, .obj or .blend and must lie on each other
(lay a rescaled remesh onto its source first; jam-retopo's fit_to_source.py does).

Rays are cast from the target within --reach of its surface (default 0.004 of the bounding diagonal; a second pass
at three times that fills what the first missed). Texels no ray reached take their neighbours' colour, and islands
are padded by --margin-px. Normals are tangent space, green up. A map that comes out constant (one roughness, no
metal, a flat normal) is written as a material value instead of a texture.

Writes <out-dir>/<stem>.glb (one material, textures embedded), the maps as <stem>_basecolor.png, <stem>_normal.png
and <stem>_orm.png (R occlusion = 1, G roughness, B metallic), and <out-dir>/bake-report.json. Exits 1 when the
models do not lie on each other, the target has no UVs, or fewer than --min-hit-share of its texels found the source.
"""
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402
import bakecore  # noqa: E402

p = js.parser(__doc__)
p.add_argument("target")
p.add_argument("out_dir")
p.add_argument("--source", required=True)
p.add_argument("--normal-source")
p.add_argument("--size", type=int, required=True)
p.add_argument("--maps", default="basecolor,normal,roughness,metallic")
p.add_argument("--name")
p.add_argument("--reach", type=float, default=0.004, help="tight ray length as a share of the target's bounding diagonal")
p.add_argument("--margin-px", type=int, default=16)
p.add_argument("--min-hit-share", type=float, default=0.98)
p.add_argument("--samples", type=int, default=2)
args = js.parse(p)
out = js.out_dir(args.out_dir)
name = js.stem(args.target, args.name)
maps = [m.strip() for m in args.maps.split(",") if m.strip()]
unknown = [m for m in maps if m not in ("basecolor", "normal", "roughness", "metallic")]
if unknown:
    js.fail(f"unknown maps {unknown}: choose from basecolor, normal, roughness, metallic", 2)

targets = js.load(args.target)
skinned = any(m.type == "ARMATURE" for ob in targets for m in ob.modifiers)
if not skinned:
    js.apply_transforms(targets)
missing = [ob.name for ob in targets if not ob.data.uv_layers]
if missing:
    js.fail(f"the target has no UVs on: {', '.join(missing)}. Unwrap it first (jam-uv)")
for ob in targets:
    ob.data.uv_layers.active = ob.data.uv_layers[0]
    ob.data.uv_layers[0].active_render = True
sources = js.load(args.source, reset=False)
js.apply_transforms(sources)
normal_sources = None
if args.normal_source:
    normal_sources = js.load(args.normal_source, reset=False)
    js.apply_transforms(normal_sources)
low, high = js.bounds(targets)
diagonal = (high - low).length or 1.0
tree, points = js.surface(sources)
apart = js.deviation(targets, tree, points)
report = {"blender": bpy.app.version_string, "target": os.path.basename(args.target), "source": os.path.basename(args.source),
          "normalSource": os.path.basename(args.normal_source) if args.normal_source else None, "maps": maps,
          "targetToSourceDeviation": apart, "normalConvention": "tangent space, green up (glTF)"}
if apart["p95"] > 0.03:
    report["problems"] = ["target and source do not lie on each other"]
    js.write_report(out, "bake-report.json", report)
    js.fail(f"the target and the source do not lie on each other (95% of points within {apart['p95']:.1%} of the bounding diagonal; at most 3% expected). "
            "Lay the target onto the source first (jam-retopo's fit_to_source.py)")
for hidden in (normal_sources or []):
    hidden.hide_render = True
baked, facts = bakecore.bake_maps(targets, sources, args.size, [m for m in maps if m != "normal"], args.reach * diagonal, margin_px=args.margin_px, samples=args.samples)
covered = facts.pop("_covered")
if "normal" in maps:
    for ob in (normal_sources or []):
        ob.hide_render = False
    if normal_sources:
        for ob in sources:
            ob.hide_render = True
    normal, normal_facts = bakecore.bake_maps(targets, sources, args.size, ["normal"], args.reach * diagonal, normal_sources=normal_sources, margin_px=args.margin_px, samples=args.samples)
    normal_facts.pop("_covered")
    baked["normal"] = normal["normal"]
    facts.update({k: v for k, v in normal_facts.items() if k.startswith("normal")})
files, factors, written = {}, {}, {}
if "basecolor" in baked:
    files["basecolor"] = js.inside(out, f"{name}_basecolor.png")
    bakecore.save_png(baked["basecolor"], files["basecolor"], "sRGB")
for channel in ("roughness", "metallic"):
    if channel in baked:
        value = bakecore.constant(baked[channel], covered)
        if value is not None:
            factors[channel] = round(value, 4)
if any(c in baked and c not in factors for c in ("roughness", "metallic")):
    orm = np.ones((args.size, args.size, 3), dtype=np.float32)
    orm[:, :, 1] = baked["roughness"][:, :, 0] if "roughness" in baked else 0.5
    orm[:, :, 2] = baked["metallic"][:, :, 0] if "metallic" in baked else 0.0
    files["orm"] = js.inside(out, f"{name}_orm.png")
    bakecore.save_png(orm, files["orm"], "Non-Color")
    factors = {}
if "normal" in baked and not facts.get("normalIsFlat"):
    files["normal"] = js.inside(out, f"{name}_normal.png")
    bakecore.save_png(baked["normal"], files["normal"], "Non-Color")
for ob in sources + (normal_sources or []):
    bpy.data.objects.remove(ob)
material = bakecore.final_material(name, files, factors)
for ob in targets:
    ob.data.materials.clear()
    ob.data.materials.append(material)
js.export_glb(js.inside(out, f"{name}.glb"), targets, skins=skinned)
problems = []
if facts["hitShare"] < args.min_hit_share:
    problems.append(f"only {facts['hitShare']:.1%} of the target's texels found the source (at least {args.min_hit_share:.0%} expected): raise --reach, or check that the two models coincide")
report.update(facts, model=f"{name}.glb", textures={k: os.path.basename(v) for k, v in files.items()}, materialValues=factors,
              packing="orm.png holds occlusion (1) in R, roughness in G, metallic in B", problems=problems)
js.write_report(out, "bake-report.json", report)
print("BAKE", {"textures": report["textures"], "materialValues": factors, "hitShare": facts["hitShare"], "normalIsFlat": facts.get("normalIsFlat"), "problems": problems})
if problems:
    js.fail("; ".join(problems))
