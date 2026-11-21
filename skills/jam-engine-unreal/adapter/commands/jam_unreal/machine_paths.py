"""Find absolute machine paths stored in an engine binary, which would tie the asset to one person's computer.

An imported asset remembers where its source file was. Read as bytes, a `.uasset` shows that path in ASCII or in
UTF-16; this is the same test as running `strings` over the file and looking for a drive letter or a home folder.
Engine-internal paths (`/Game/...`, `/Script/...`, `/Engine/...`) are not machine paths.
"""
import re

_TAIL = rb"[\w .\-()]+(?:[\\/][\w .\-()]+)*"
_PATTERNS = [
    re.compile(rb"(?<![A-Za-z0-9])[A-Za-z]:[\\/]" + _TAIL),                                        # C:\Users\..., D:/work/...
    re.compile(rb"(?<![\w\\])\\\\[\w.\-]+\\" + _TAIL),     # \\host\share\..., not an Interchange node id (Factory_\\SKMInstance\\...)
    re.compile(rb"(?<![\w/.\-])/(?:Users|home|Volumes|mnt|private|var|tmp|opt|root)/" + _TAIL),     # POSIX homes and mounts
]


def _wide_to_ascii(data):
    """UTF-16LE text runs as ASCII bytes, so one set of patterns reads both encodings."""
    return b"\n".join(m.group(0)[::2] for m in re.finditer(rb"(?:[\x20-\x7e]\x00){6,}", data))


_WIDE_DRIVE = re.compile(rb"[A-Za-z]:[\\/]" + _TAIL)   # in wide text a neighbouring string's last byte can sit right before the drive letter


def find(data):
    """Absolute machine paths in the bytes, in first-seen order, without duplicates."""
    found = []
    for blob, patterns in ((data, _PATTERNS), (_wide_to_ascii(data), [_WIDE_DRIVE] + _PATTERNS[1:])):
        for pattern in patterns:
            for match in pattern.finditer(blob):
                text = match.group(0).decode("ascii", "replace").rstrip(" .")
                if text not in found:
                    found.append(text)
    return found


def find_in_file(path):
    with open(path, "rb") as f:
        return find(f.read())
