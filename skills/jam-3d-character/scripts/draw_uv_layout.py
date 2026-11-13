"""Draw UV layouts written by uv_outfit.py (<piece>-layout.json, polygons in 0-1 UV space) as PNG, one per file.
python3 draw_uv_layout.py <layout.json> ... (needs Pillow)"""
import json, sys
from PIL import Image, ImageDraw
for path in sys.argv[1:]:
    polys = json.load(open(path)); S = 1024
    img = Image.new("RGB", (S, S), (24, 24, 28)); d = ImageDraw.Draw(img)
    for p in polys:
        pts = [(u * S, (1 - v) * S) for u, v in p]
        d.polygon(pts, fill=(70, 110, 160), outline=(200, 220, 255))
    img.save(path.replace(".json", ".png"))
