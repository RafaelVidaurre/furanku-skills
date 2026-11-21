"""Find machine paths stored in an engine binary, which would tie the asset to one person's computer.

An imported asset remembers where its source file was, relative to its own package folder. Read as bytes, a `.uasset`
shows that path in ASCII or in UTF-16; this is the same test as running `strings` over the file and looking for a
drive letter, a network share, a home folder or a mount, or a relative path that climbs out of the project.
Engine-internal paths (`/Game/...`, `/Script/...`, `/Engine/...`), URLs and Interchange node ids are not machine paths.
"""
import os
import re

_SEGMENT = rb"[\w .\-()$]+"
_TAIL = _SEGMENT + rb"(?:[\\/]+" + _SEGMENT + rb")*"
_ROOTS = rb"Users|Volumes|Network|home|mnt|media|run|srv|workspace|workspaces|data|private|var|tmp|opt|root|net|usr|cygdrive"
_DRIVE = rb"[A-Za-z]:[\\/]+" + _TAIL                                                         # C:\Users\..., D:/work/...
_UNC = re.compile(rb"\\\\[\w.\-$]+\\(?!\\)" + _TAIL)                                          # \\host\share\...
_INTERCHANGE_ID = re.compile(rb"\\\\[\w.\-]+$")   # Factory_\\SKMInstance\\LODContainer\...: a node id, each part after a doubled backslash
_PATTERNS = [
    re.compile(rb"(?<![A-Za-z0-9])" + _DRIVE),
    re.compile(rb"\\\\[?.]\\" + rb"(?:[A-Za-z]:[\\/]+)?" + _TAIL),                            # \\?\C:\..., \\?\UNC\host\share\..., \\.\...
    re.compile(rb"(?<![:/\w])//[\w.\-$]+/+" + _TAIL),                                          # //host/share/... (a URL has its scheme's colon before)
    re.compile(rb"(?<![\w/.\-])/(?:" + _ROOTS + rb")/" + _TAIL),                                 # POSIX homes and mounts
]
_RELATIVE = re.compile(rb"(?<![\w.\-/\\])((?:\.\.[\\/]+)+)" + _TAIL)
_WIDE_DRIVE = re.compile(_DRIVE)   # in wide text a neighbouring string's last byte can sit right before the drive letter


def _wide_to_ascii(data):
    """UTF-16LE text runs as ASCII bytes, so one set of patterns reads both encodings."""
    return b"\n".join(m.group(0)[::2] for m in re.finditer(rb"(?:[\x20-\x7e]\x00){6,}", data))


def _matches(blob, patterns, depth):
    for pattern in patterns:
        for match in pattern.finditer(blob):
            yield match.group(0)
    for match in _UNC.finditer(blob):
        if not _INTERCHANGE_ID.search(blob[max(0, match.start() - 256):match.start()]):
            yield match.group(0)
    if depth is not None:   # a relative source climbs from the asset's folder; more steps than the folder's depth leave the project
        for match in _RELATIVE.finditer(blob):
            if match.group(1).count(b"..") > depth:
                yield match.group(0)


def find(data, depth=None):
    """Machine paths in the bytes, in first-seen order, without duplicates. `depth`: how many folders the asset's
    file lies below the project folder; relative paths are judged only when it is given."""
    found = []
    for blob, patterns in ((data, _PATTERNS), (_wide_to_ascii(data), [_WIDE_DRIVE] + _PATTERNS[1:])):
        for raw in _matches(blob, patterns, depth):
            text = raw.decode("ascii", "replace").rstrip(" .")
            if text not in found:
                found.append(text)
    return found


def find_in_file(path, project_dir=None):
    """Machine paths in an asset file; with `project_dir` (the editor's project folder), also relative paths that leave it."""
    depth = None
    if project_dir:
        depth = len(os.path.relpath(os.path.dirname(os.path.abspath(path)), os.path.abspath(project_dir)).split(os.sep))
    with open(path, "rb") as f:
        return find(f.read(), depth)
