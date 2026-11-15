# Draw UV polygons from uv_layout.py over the base colour map (needs Pillow).
# Usage: python3 uv_overlay.py <uv.json> <base.png> <out.png>
import json, sys
from PIL import Image, ImageDraw
uv, base, out = sys.argv[1:4]
img = Image.open(base).convert("RGB").resize((1024, 1024)); d = ImageDraw.Draw(img)
for poly in json.load(open(uv)):
    d.polygon([(u * 1024, (1 - v) * 1024) for u, v in poly], outline=(255, 255, 0))
img.save(out)
