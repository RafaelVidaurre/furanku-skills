"""Small facts every report carries."""
import hashlib
import json
import os


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def stamp(role, path):
    """{"role", "path", "sha256"} with the path as given, forward slashes."""
    return {"role": role, "path": path.replace(os.sep, "/"), "sha256": sha256(path)}


def write(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
        f.write("\n")


def rounded(vec, digits=4):
    return [round(float(v), digits) + 0.0 for v in vec]
