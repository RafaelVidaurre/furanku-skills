"""Thumbnails the editor stored in a package, read without the engine.

An editor that saves an asset after showing it in the Content Browser stores its thumbnail in the package: a table
of contents at the summary's ThumbnailTableOffset (count, then per object its class name, its path without the
package, and the file offset of its image), each image a width, a height (negative when the bytes are JPEG) and the
compressed bytes. A package saved by a script or a commandlet usually has none.
"""
import os

from .packages import Unreadable, _Reader, _summary

IMAGE_SIGNATURES = ((b"\xff\xd8\xff", "jpg"), (b"\x89PNG\r\n\x1a\n", "png"))


def stored_thumbnails(path):
    """{object path without the package: (extension, bytes)} of every non-empty stored thumbnail of a package."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        r = _Reader(f, size)
        r.window(0, 1 << 16)
        try:
            s = _summary(r)
            offset = s.get("thumbnail_offset", 0)
            if offset <= 0:
                return {}
            r.seek(offset)
            table = []
            for _ in range(r.count("thumbnail")):
                r.string()  # class name
                table.append((r.string(), r.i32()))
            out = {}
            for name, at in table:
                r.seek(at)
                width, height = r.i32(), r.i32()
                if width == 0 or height == 0:
                    continue    # a shared, empty thumbnail: the class's stock icon
                data = r.take(r.count("thumbnail byte"))
                ext = next((e for magic, e in IMAGE_SIGNATURES if data.startswith(magic)), None)
                if ext:
                    out[name] = (ext, data)
            return out
        except (UnicodeDecodeError, ValueError) as e:
            raise Unreadable("the thumbnail table does not parse: %s" % e)


def main_thumbnail(path, main):
    """(extension, bytes) of the stored thumbnail of the package's main asset (`/Game/X/SM_A.SM_A`), or None."""
    name = main.split(".", 1)[1] if "." in main else main.rsplit("/", 1)[-1]
    return stored_thumbnails(path).get(name)
