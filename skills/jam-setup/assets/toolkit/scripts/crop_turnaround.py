"""Lossless five-view extraction with explicit crop boxes. Requires Pillow.

python crop_turnaround.py sheet.png layout.json output-directory [--symmetric]
python crop_turnaround.py --facing left.png right.png

layout: {"front": [x, y, width, height], "left": [...], "back": [...],
         "right": [...], "three-quarter": [...]}
All boxes must have equal dimensions. Output must not already exist.
The left and right views must face opposite ways: their silhouettes must match
each other better mirrored than as drawn. A subject whose sides are identical
(a barrel, a ball) cannot show that; declare it with --symmetric, which also
lets left and right be the same box. --facing prints the two overlaps for a
pair of side views without cropping anything.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

VIEWS = ("front", "left", "back", "right", "three-quarter")
SILHOUETTE = (128, 256)


def silhouette(view):
    """The figure as a mask on its flat background, cropped to the figure and scaled to SILHOUETTE."""
    from PIL import Image, ImageChops
    rgb = view.convert("RGB")
    width, height = rgb.size
    edge = [rgb.getpixel((x, y)) for x in range(0, width, 4) for y in (0, height - 1)]
    edge += [rgb.getpixel((x, y)) for y in range(0, height, 4) for x in (0, width - 1)]
    background = tuple(sorted(channel)[len(channel) // 2] for channel in zip(*edge))
    difference = ImageChops.difference(rgb, Image.new("RGB", rgb.size, background)).convert("L")
    mask = difference.point(lambda value: 255 if value > 30 else 0)
    if view.mode == "RGBA":
        mask = ImageChops.multiply(mask, view.getchannel("A").point(lambda value: 255 if value > 10 else 0))
    box = mask.getbbox()
    if box is None:
        raise ValueError("a view shows no figure on its background")
    return mask.crop(box).resize(SILHOUETTE).point(lambda value: 255 if value > 127 else 0).convert("1")


def overlap(a, b):
    """Intersection over union of two equal-size masks."""
    from PIL import ImageChops
    both = ImageChops.logical_and(a, b).histogram()[-1]
    either = ImageChops.logical_or(a, b).histogram()[-1]
    return both / either if either else 0.0


def side_facing(left, right):
    """How well the side views match as drawn and mirrored; opposite-facing sides match better mirrored."""
    from PIL import ImageOps
    a, b = silhouette(left), silhouette(right)
    return {"asDrawn": round(overlap(a, b), 3), "mirrored": round(overlap(a, ImageOps.mirror(b)), 3)}


def crop(sheet, layout, output, symmetric=False):
    from PIL import Image, ImageOps
    sheet, output = Path(sheet), Path(output)
    if output.exists():
        raise ValueError("output exists; choose a new candidate directory")
    if set(layout) != set(VIEWS):
        raise ValueError("layout must name exactly the five required views")
    with Image.open(sheet) as original:
        image = ImageOps.exif_transpose(original)
        if getattr(original, "n_frames", 1) != 1:
            raise ValueError("animated sheets are not supported")
        dimensions = set()
        for name in VIEWS:
            box = layout[name]
            if not isinstance(box, list) or len(box) != 4 or any(type(n) is not int for n in box):
                raise ValueError(f"{name}: expected integer x,y,width,height")
            x, y, width, height = box
            if min(x, y) < 0 or min(width, height) <= 0 or x + width > image.width or y + height > image.height:
                raise ValueError(f"{name}: crop is outside the oriented sheet")
            dimensions.add((width, height))
        if len(dimensions) != 1:
            raise ValueError("all view canvases must have equal dimensions")
        for i, a in enumerate(VIEWS):
            ax, ay, aw, ah = layout[a]
            for b in VIEWS[i + 1:]:
                # A symmetric subject may reuse one side view for both sides.
                if symmetric and {a, b} == {"left", "right"} and layout[a] == layout[b]:
                    continue
                bx, by, bw, bh = layout[b]
                if ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah:
                    raise ValueError("view crop boxes overlap")
        facing = side_facing(*(image.crop((x, y, x + w, y + h)) for x, y, w, h in (layout["left"], layout["right"])))
        if not symmetric and facing["asDrawn"] >= facing["mirrored"]:
            raise ValueError(f"left and right views face the same way (silhouette overlap as drawn {facing['asDrawn']}, mirrored {facing['mirrored']}); regenerate one to face the other way, or declare a subject whose sides are identical with --symmetric")
        output.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=".jam-crop-", dir=output.parent))
        try:
            report = {"sourceSha256": hashlib.sha256(sheet.read_bytes()).hexdigest(), "orientedSize": list(image.size), "views": {}, "sideFacing": facing, "symmetric": bool(symmetric), "visualReview": "pending"}
            for name in VIEWS:
                x, y, width, height = layout[name]
                file = staging / f"{name}.png"
                image.crop((x, y, x + width, y + height)).save(file, icc_profile=image.info.get("icc_profile"))
                report["views"][name] = {"file": file.name, "box": layout[name], "size": [width, height], "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
            (staging / "crops.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            # Reserve the name first. Never replace a directory created by a concurrent writer.
            output.mkdir()
            for file in staging.iterdir():
                os.replace(file, output / file.name)
            return report
        finally:
            shutil.rmtree(staging, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sheet", type=Path, nargs="?")
    parser.add_argument("layout", type=Path, nargs="?")
    parser.add_argument("output", type=Path, nargs="?")
    parser.add_argument("--symmetric", action="store_true", help="the subject's sides are identical")
    parser.add_argument("--facing", nargs=2, type=Path, metavar=("LEFT", "RIGHT"), help="only compare two side views")
    args = parser.parse_args()
    try:
        if args.facing:
            from PIL import Image
            with Image.open(args.facing[0]) as left, Image.open(args.facing[1]) as right:
                print(json.dumps(side_facing(left, right)))
            return
        if not (args.sheet and args.layout and args.output):
            parser.error("sheet, layout and output are required")
        report = crop(args.sheet, json.loads(args.layout.read_text(encoding="utf-8")), args.output, symmetric=args.symmetric)
        print(json.dumps({"views": len(report["views"]), "output": str(args.output), "symmetric": report["symmetric"], "visualReview": "pending"}))
    except ImportError:
        parser.exit(1, "Pillow is unavailable; install the toolkit's requirements.txt (jam doctor says how). No substitute crop was made.\n")
    except (ValueError, OSError) as error:
        parser.exit(1, f"Turnaround crop failed: {error}\n")


if __name__ == "__main__":
    main()
