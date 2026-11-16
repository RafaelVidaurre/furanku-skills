"""Lay a retopology candidate onto its source mesh and measure how far the two surfaces lie apart.

blender --background --factory-startup --python-exit-code 1 --python fit_to_source.py -- <candidate> <source> <out-dir>
    [--name <stem>] [--measure-only] [--max-deviation 0.02]

A remesh made elsewhere often comes back rescaled or moved. The candidate is scaled uniformly and moved onto the
source (bounding boxes, then repeated nearest-point matching), keeping its UVs and materials, so the source can be
baked onto it and its silhouette compared. --measure-only leaves it where it is. Writes <out-dir>/<stem>.glb (unless
--measure-only) and <out-dir>/fit-report.json with the scale and offset applied and the deviation as shares of the
source's bounding diagonal. Exits 1 when the largest deviation is over --max-deviation: thin parts were lost or
merged, or the two files are not the same model.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402

p = js.parser(__doc__)
p.add_argument("candidate")
p.add_argument("source")
p.add_argument("out_dir")
p.add_argument("--name")
p.add_argument("--measure-only", action="store_true")
p.add_argument("--max-deviation", type=float, default=0.02)
args = js.parse(p)
out = js.out_dir(args.out_dir)
name = js.stem(args.candidate, args.name)

source = js.load(args.source)
js.apply_transforms(source)
tree, points = js.surface(source)
for ob in source:
    bpy.data.objects.remove(ob)
objects = js.load(args.candidate, reset=False)
js.apply_transforms(objects)
before = js.deviation(objects, tree, points)
applied = None
if not args.measure_only:
    applied = js.fit(objects, tree, points)
    js.export_glb(js.inside(out, f"{name}.glb"), objects)
after = js.deviation(objects, tree, points)
problems = []
if after["max"] > args.max_deviation:
    problems.append(f"the candidate lies up to {after['max']:.2%} of the source's bounding diagonal from it (limit {args.max_deviation:.2%})")
js.write_report(out, "fit-report.json", {"blender": bpy.app.version_string, "candidate": os.path.basename(args.candidate), "source": os.path.basename(args.source),
                                         "model": None if args.measure_only else f"{name}.glb", "applied": applied, "deviationBefore": before,
                                         "deviationShareOfDiagonal": after, "maxDeviation": args.max_deviation, "faces": js.face_stats(objects), "problems": problems})
print("FIT", {"applied": applied, "before": before, "after": after, "problems": problems})
if problems:
    js.fail("; ".join(problems))
