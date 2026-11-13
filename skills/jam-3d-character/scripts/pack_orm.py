"""Pack baked Roughness and Metallic maps into one ORM map (R occlusion = 1, G roughness, B metallic), the packing the body maps use.
python3 pack_orm.py <texture-dir> <prefix>  (needs Pillow); writes <prefix>_<Piece>_ORM.png for every <prefix>_<Piece>_Roughness.png"""
import sys, os, glob
from PIL import Image
d, prefix = sys.argv[1:3]
for r in glob.glob(os.path.join(d, prefix + "_*_Roughness.png")):
    m = r.replace("_Roughness.png", "_Metallic.png")
    R = Image.open(r).convert("L"); M = Image.open(m).convert("L") if os.path.exists(m) else Image.new("L", R.size, 0)
    Image.merge("RGB", (Image.new("L", R.size, 255), R, M)).save(r.replace("_Roughness.png", "_ORM.png")); print("ORM", r)
