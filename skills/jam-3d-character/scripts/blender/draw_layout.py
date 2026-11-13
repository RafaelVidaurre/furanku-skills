"""Draw UV layouts from the JSON dumped by unwrap_parts.py: one colour per island, seams and borders in dark red.
python3 draw_layout.py <out-dir>"""
import json, sys, colorsys, glob, os
from PIL import Image, ImageDraw
out = sys.argv[1]; S = 1400
sheets = []
files = sorted(glob.glob(os.path.join(out, "uv-layout-*.json")))
for path in files:
    name = os.path.basename(path)[len("uv-layout-"):-len(".json")]; d = json.load(open(path))
    im = Image.new("RGB", (S, S), (245, 245, 245)); dr = ImageDraw.Draw(im)
    P = lambda u: (u[0] * S, (1 - u[1]) * S)
    for f in d["faces"]:
        r, g, b = colorsys.hsv_to_rgb((f["island"] * 0.381966) % 1.0, 0.28, 0.95)
        dr.polygon([P(u) for u in f["uv"]], fill=(int(r * 255), int(g * 255), int(b * 255)), outline=(150, 150, 150))
    for f in d["faces"]:
        n = len(f["uv"])
        for i in range(n):
            if f["seam"][i]: dr.line([P(f["uv"][i]), P(f["uv"][(i + 1) % n])], fill=(150, 20, 20), width=3)
    dr.rectangle([0, 0, S - 1, S - 1], outline=(0, 0, 0)); im.save(f"{out}/uv-layout-{name}.png"); sheets.append(im)
sheet = Image.new("RGB", (S * len(sheets), S), (255, 255, 255))
for i, im in enumerate(sheets): sheet.paste(im, (i * S, 0))
sheet.resize((900 * len(sheets), 900), Image.LANCZOS).save(f"{out}/uv-layouts.png")
