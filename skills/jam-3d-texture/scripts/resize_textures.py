"""Bring a GLB's embedded textures within a size limit, and drop images nothing uses, without touching geometry.

python resize_textures.py <in.glb> <out.glb> --max-size N [--keep-unused] [--jpeg-quality 90]

Every embedded image larger than --max-size on either side is scaled down to fit, keeping its aspect and format;
images no material reads are removed, and identical images are stored once. The file is edited directly (no DCC
round trip): meshes, UVs, skins and animations stay byte-for-byte the same. Prints what changed. Exits 2 on wrong
input. Needs numpy and Pillow.
"""
import argparse
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glb  # noqa: E402


def fitted(size, limit):
    width, height = size
    if max(width, height) <= limit:
        return None
    scale = limit / max(width, height)
    return max(1, round(width * scale)), max(1, round(height * scale))


def resize(model, max_size, keep_unused=False, jpeg_quality=90):
    """(doc, blob, changes) with images bounded to max_size."""
    from PIL import Image
    doc = model.doc
    images = model.images()
    replace, changes, drop = {}, [], set()
    first = {}
    for image in images:
        entry = doc["images"][image["index"]]
        if not image["usedBy"] and not keep_unused:
            drop.add(image["index"])
            changes.append({"image": image["name"], "removed": "nothing uses it"})
            continue
        if image["bytes"] is None or "bufferView" not in entry:
            continue
        if image["sha256"] in first and image["usedBy"]:
            keep = first[image["sha256"]]
            for texture in doc.get("textures", []):
                for holder in [texture] + [e for e in texture.get("extensions", {}).values() if isinstance(e, dict)]:
                    if holder.get("source") == image["index"]:
                        holder["source"] = keep
            drop.add(image["index"])
            changes.append({"image": image["name"], "removed": f"identical to {images[keep]['name']}"})
            continue
        first[image["sha256"]] = image["index"]
        target = fitted(image["size"], max_size) if image["size"] else None
        if target:
            picture = Image.open(io.BytesIO(image["bytes"]))
            picture = picture.resize(target, Image.LANCZOS)
            buffer = io.BytesIO()
            if image["mimeType"] == "image/jpeg":
                picture.convert("RGB").save(buffer, "JPEG", quality=jpeg_quality)
            elif image["mimeType"] == "image/webp":
                picture.save(buffer, "WEBP", quality=jpeg_quality)
            else:
                picture.save(buffer, "PNG")
            replace[entry["bufferView"]] = buffer.getvalue()
            changes.append({"image": image["name"], "from": image["size"], "to": list(target)})
    new_doc, blob = model.rebuilt(replace_views=replace, drop_images=drop)
    return new_doc, blob, changes


def main(argv=None):
    parser = argparse.ArgumentParser(description="Bound a GLB's embedded textures to a size and drop unused images.")
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument("--max-size", type=int, required=True)
    parser.add_argument("--keep-unused", action="store_true")
    parser.add_argument("--jpeg-quality", type=int, default=90)
    args = parser.parse_args(argv)
    if os.path.abspath(args.source) == os.path.abspath(args.destination):
        print("error: write to a new file; the source is left as it is", file=sys.stderr)
        return 2
    try:
        doc, blob, changes = resize(glb.read(args.source), args.max_size, args.keep_unused, args.jpeg_quality)
    except (glb.GlbError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    except ImportError:
        print("error: this script needs Pillow (pip install Pillow)", file=sys.stderr)
        return 2
    os.makedirs(os.path.dirname(os.path.abspath(args.destination)), exist_ok=True)
    glb.write(args.destination, doc, blob)
    print(json.dumps({"written": args.destination, "maxSize": args.max_size, "changes": changes}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
