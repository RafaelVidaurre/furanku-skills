"""Repaint hair-coloured texels in a hat's base colour map (where the generated hair met the hat, the generator often
painted hair onto the hat's band) with the colour of the texels around them that are not hair-coloured.
python3 clean_hair_colour.py <basecolor.png> <out.png> [report.json] --character <body character.json> [--widen]   (needs Pillow and numpy)

Hair colour is the body's `hair` class: its hsv window, or a window around its reference colour. Texels darker than
value 0.12 are never hair. --widen grows the window (hue 15 degrees each side, saturation down 0.05, any brightness) for a
piece with no colour of its own near the hair's, such as a grey or black hat."""
import sys, os, json, colorsys
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import charspec

args, spec = charspec.require()
widen = "--widen" in args; args = [a for a in args if a != "--widen"]
src, out = args[:2]
cname = spec.role_class("hair")
if cname is None: raise SystemExit("the body has no hair class (roles.hair): nothing to repaint")
w = {"hue": [0.0, 360.0], "saturation": [0.0, 1.0], "value": [0.0, 1.0], **spec.window(cname)}   # a key the window leaves out is unconstrained
if widen:
    w = {"hue": [(w["hue"][0] - 15) % 360, (w["hue"][1] + 15) % 360], "saturation": [max(0.0, w["saturation"][0] - 0.05), 1.0], "value": [0.0, 1.0]}
img = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255
hsv = np.asarray(Image.open(src).convert("HSV")).astype(np.float32) / 255
h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
a, b = w["hue"]
hair = ((h >= a) & (h <= b) if a <= b else ((h >= a) | (h <= b))) & (s >= w["saturation"][0]) & (s <= w["saturation"][1]) & (v >= max(0.12, w["value"][0])) & (v <= w["value"][1])
mask = Image.fromarray((hair * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
m = np.asarray(mask) > 0
fill = Image.fromarray((img * 255).astype(np.uint8))
res = np.asarray(fill).copy()
# grow the surrounding colours into the masked texels, ring by ring
known = ~m; cur = res.astype(np.float32)
for _ in range(64):
    if known.all(): break
    acc = np.zeros_like(cur); cnt = np.zeros(cur.shape[:2], np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == dy == 0: continue
            k = np.roll(np.roll(known, dy, 0), dx, 1); c = np.roll(np.roll(cur, dy, 0), dx, 1)
            acc += c * k[..., None]; cnt += k
    newly = (~known) & (cnt > 0)
    cur[newly] = acc[newly] / cnt[newly][:, None]; known |= newly
Image.fromarray(cur.clip(0, 255).astype(np.uint8)).save(out)
rep = {"texelsRepainted": int(m.sum()), "of": int(m.size), "hairWindow": w}
if len(args) > 2: json.dump(rep, open(args[2], "w"))
print(json.dumps(rep))
