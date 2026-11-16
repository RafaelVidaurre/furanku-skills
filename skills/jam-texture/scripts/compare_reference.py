"""Put stills of a model beside the reference images of the same views, one pair per row, in one image.

python compare_reference.py <out.png> --pair <view>=<still.png>,<reference.png> [--pair ...] [--height 512]

For judging a textured model against its turnaround or concept: the reviewer opens one image and compares each
view with its reference at the same height. Exits 2 on wrong input. Needs Pillow.
"""
import argparse
import os
import sys


def main(argv=None):
    parser = argparse.ArgumentParser(description="Stills beside their reference images, one pair per row.")
    parser.add_argument("out")
    parser.add_argument("--pair", action="append", required=True, metavar="VIEW=STILL,REFERENCE")
    parser.add_argument("--height", type=int, default=512)
    args = parser.parse_args(argv)
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("error: this script needs Pillow (pip install Pillow)", file=sys.stderr)
        return 2
    rows = []
    for pair in args.pair:
        view, _, files = pair.partition("=")
        parts = files.split(",")
        if not view or len(parts) != 2:
            print(f"error: --pair takes <view>=<still.png>,<reference.png>; got {pair!r}", file=sys.stderr)
            return 2
        try:
            tiles = [Image.open(path).convert("RGB") for path in parts]
        except OSError as error:
            print(f"error: {error}", file=sys.stderr)
            return 2
        tiles = [tile.resize((max(1, round(tile.width * args.height / tile.height)), args.height), Image.LANCZOS) for tile in tiles]
        rows.append((view, tiles))
    width = max(sum(t.width for t in tiles) + 12 for _, tiles in rows)
    sheet = Image.new("RGB", (width, (args.height + 28) * len(rows)), (128, 128, 128))
    pen = ImageDraw.Draw(sheet)
    for index, (view, tiles) in enumerate(rows):
        top = index * (args.height + 28)
        pen.text((6, top + 6), f"{view}: model | reference", fill=(255, 255, 255))
        x = 0
        for tile in tiles:
            sheet.paste(tile, (x, top + 28))
            x += tile.width + 12
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    sheet.save(args.out)
    print(f'{{"written": "{args.out}", "pairs": {len(rows)}}}')
    return 0


if __name__ == "__main__":
    sys.exit(main())
