"""Mapping between project files and engine asset ids, and the path rules receipts must keep."""
import hashlib
import os
import re

from .errors import AdapterError

# The toolkit's own rule for a stored path: project-relative, forward slashes, no drive, no `.` or `..` part.
PORTABLE = re.compile(r"^(?![A-Za-z]:)(?!/)(?!.*\\)(?!.*(?:^|/)\.{0,2}(?:/|$)).+$")
ASSET_NAME = re.compile(r"^[A-Za-z0-9_]+$")
ASSET_ID = re.compile(r"^(?:/[A-Za-z0-9_\-]+){2,}(?:\.[A-Za-z0-9_\-]+)?$")   # a package path, or an object path


def portable(path, what="path"):
    """A project-relative forward-slash path, or an error naming what was wrong."""
    if not isinstance(path, str) or not PORTABLE.match(path):
        raise AdapterError("invalid-path", "%s must be project-relative with forward slashes and no . or .. parts: %r" % (what, path),
                           fix="pass the path as it reads from the project root, for example Art/Assets/chair/v1/model/chair.glb")
    return path


def absolute(project, relative):
    return os.path.join(project, *portable(relative).split("/"))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def source_stamp(project, relative, what="source"):
    """(project-relative path, sha256) of a source file that must exist in this checkout."""
    path = absolute(project, relative)
    if not os.path.isfile(path):
        raise AdapterError("missing-source", "%s not found in the project: %s" % (what, relative))
    return relative, sha256(path)


def _split_scheme(pattern):
    if pattern.count("{path}") != 1:
        raise AdapterError("invalid", "asset id pattern needs exactly one {path}: %r" % pattern)
    head, tail = pattern.split("{path}")
    return head, tail


def asset_id(dest, name):
    """`/Game/Folder` + `SM_Chair` -> `/Game/Folder/SM_Chair`."""
    if not ASSET_NAME.match(name or ""):
        raise AdapterError("invalid-name", "asset name may hold letters, digits and underscores only: %r" % name)
    if not dest.startswith("/") or "." in dest or "\\" in dest or "//" in dest:
        raise AdapterError("invalid-destination", "content folder must be an engine path such as /Game/Props/Saloon: %r" % dest)
    return dest.rstrip("/") + "/" + name


def package_of(asset):
    """`/Game/A/B.B` (object path) or `/Game/A/B` (package path) -> `/Game/A/B`."""
    return asset.split(".", 1)[0]


def object_name(asset):
    return package_of(asset).rsplit("/", 1)[-1]


def asset_file(asset, facts):
    """Engine asset id -> the project file that stores it, by the facts' `assetId` scheme."""
    scheme = facts.get("assetId") or {}
    id_head, id_tail = _split_scheme(scheme.get("scheme", "/Game/{path}"))
    file_head, file_tail = _split_scheme(scheme.get("from", "Content/{path}.uasset"))
    if not ASSET_ID.match(asset or ""):
        raise AdapterError("invalid-asset", "%r is not an engine asset id such as /Game/Props/SM_Chair" % asset)
    package = package_of(asset)
    if not package.startswith(id_head) or (id_tail and not package.endswith(id_tail)):
        raise AdapterError("invalid-asset", "%r is not a project asset id of the form %s" % (asset, scheme.get("scheme", "/Game/{path}")))
    middle = package[len(id_head):len(package) - len(id_tail) if id_tail else None]
    return portable(file_head + middle + file_tail, "asset file")


def asset_from_file(path, facts):
    """Project file -> engine asset id; `.umap` files map the same way as `.uasset`."""
    scheme = facts.get("assetId") or {}
    id_head, id_tail = _split_scheme(scheme.get("scheme", "/Game/{path}"))
    file_head, file_tail = _split_scheme(scheme.get("from", "Content/{path}.uasset"))
    normal = path.replace("\\", "/")
    stem, ext = os.path.splitext(normal)
    if ext.lower() == ".umap":
        normal = stem + file_tail[file_tail.rfind("."):]
    if not normal.startswith(file_head) or not normal.endswith(file_tail):
        raise AdapterError("invalid-asset", "%r is not an engine binary under %s" % (path, file_head))
    return id_head + normal[len(file_head):len(normal) - len(file_tail)] + id_tail


def project_relative(stored, project_dir):
    """The source path an asset stores, relative to the project, or an error when it points outside it.

    `project_dir` is the editor's own project folder (it may be another machine's), so this is pure string work.
    """
    if not stored:
        return None
    text = str(stored).replace("\\", "/")
    root = str(project_dir).replace("\\", "/").rstrip("/") + "/"
    if text.lower().startswith(root.lower()):
        text = text[len(root):]
    if not PORTABLE.match(text):
        raise AdapterError("machine-path", "the asset stores a source outside the project: %s" % stored,
                           fix="import from a file inside the project checkout so the stored path is relative to it")
    return text
