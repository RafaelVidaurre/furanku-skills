"""Lossless five-view extraction with explicit crop boxes. Requires Pillow.

python crop_turnaround.py sheet.png layout.json output-directory
layout: {"front": [x, y, width, height], "left": [...], "back": [...],
         "right": [...], "three-quarter": [...]}
All boxes must have equal dimensions. Output must not already exist.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

VIEWS = ("front", "left", "back", "right", "three-quarter")


def crop(sheet, layout, output):
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
                bx, by, bw, bh = layout[b]
                if ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah:
                    raise ValueError("view crop boxes overlap")
        output.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=".jam-crop-", dir=output.parent))
        try:
            report = {"sourceSha256": hashlib.sha256(sheet.read_bytes()).hexdigest(), "orientedSize": list(image.size), "views": {}, "visualReview": "pending"}
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheet", type=Path)
    parser.add_argument("layout", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        report = crop(args.sheet, json.loads(args.layout.read_text(encoding="utf-8")), args.output)
        print(json.dumps({"views": len(report["views"]), "output": str(args.output), "visualReview": "pending"}))
    except ImportError:
        parser.exit(1, "Pillow is unavailable; install tools/jam/requirements.txt through jam-setup. No substitute crop was made.\n")
    except (ValueError, OSError) as error:
        parser.exit(1, f"Turnaround crop failed: {error}\n")


if __name__ == "__main__":
    main()
