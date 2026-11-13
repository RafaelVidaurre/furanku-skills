"""Compare animated joint positions from the engine (pose_check.py) with Blender's (blender/joint_positions.py), relative to the pelvis.
python3 compare_joints.py <ue-joints.json> <import-report.json> <folder with blender-<Animation>.json> <out.json>
A few centimetres is the expected size of difference; a larger one means the engine is not reading the skeleton as Blender does."""
import json, math, os, sys
ue_p, imp_p, blender_dir, out_p = sys.argv[1:5]
imp = json.load(open(imp_p)); r = json.load(open(ue_p))
if "error" in r: sys.exit("pose_check.py reported: " + r["error"][-600:])
for n, i in imp["imports"].items():
    print(n, i.get("class"), "on Manny's skeleton:", i.get("usesMannySkeleton"), "LOD0 vertices", i.get("lod0Vertices"), "sections", i.get("lod0Sections"), "half extent cm", i.get("boundsExtentCm"))
print("root bone scale in the engine:", r["local"]["character"]["root"]["local"]["s"])
out = {}
for label in ("MM_Idle", "MF_Unarmed_Walk_Fwd"):
    b = json.load(open(os.path.join(blender_dir, "blender-%s.json" % label)))
    for fr, ue in r[label]["character"].items():
        rel = lambda d, k: [d[k][i] - d["pelvis"][i] for i in range(3)]
        d = {k: round(math.dist(rel(ue, k), rel(b[fr], k)), 2) for k in ue}
        out[label + "@" + fr] = {"maxDifferenceCm": max(d.values()), "worst": max(d, key=d.get), "all": d}
        print(label, "frame", fr, "largest pelvis-relative difference cm", max(d.values()), "at", max(d, key=d.get))
json.dump({"engine": imp["engine"], "import": imp["imports"], "unreal": r, "comparison": out}, open(out_p, "w"), indent=1)
