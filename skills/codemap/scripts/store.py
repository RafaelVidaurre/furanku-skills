#!/usr/bin/env python3
"""Map store: where codemap keeps every artifact for a repository.

Root is ``$FURANKU_SKILLS_HOME`` or ``~/.furanku-skills``; each repository owns
``codemap/<basename>-<sha1(resolved root)[:8]>/`` beneath it. Every directory is
created with mode 700 and every JSON write is atomic (temp file + rename).
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import privacy

ARTIFACTS = ("scan", "skeleton", "draft", "decisions", "map", "changes")


def home() -> Path:
    override = os.environ.get("FURANKU_SKILLS_HOME")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".furanku-skills"


def repo_key(repo_root) -> str:
    root = Path(repo_root).expanduser().resolve()
    digest = hashlib.sha1(str(root).encode("utf-8")).hexdigest()[:8]
    return f"{root.name or 'root'}-{digest}"


def store_dir(repo_root) -> Path:
    return home() / "codemap" / repo_key(repo_root)


def ensure_dir(path: Path) -> Path:
    """Create ``path`` and its parents with mode 700."""
    parts = []
    current = Path(path)
    while not current.exists():
        parts.append(current)
        if current.parent == current:
            break
        current = current.parent
    for directory in reversed(parts):
        directory.mkdir(mode=0o700, exist_ok=True)
        os.chmod(directory, 0o700)
    return path


def paths(repo_root) -> dict:
    root = store_dir(repo_root)
    result = {name: root / f"{name}.json" for name in ARTIFACTS}
    result["html"] = root / "index.html"
    result["log"] = root / "codemap.log"
    result["snapshots"] = root / "snapshots"
    return result


def dumps(obj) -> str:
    return json.dumps(privacy.document(obj), sort_keys=True, indent=1, ensure_ascii=False) + "\n"


def write_text(path, text: str) -> Path:
    path = Path(path)
    ensure_dir(path.parent)
    fd, temp = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.chmod(temp, 0o600)
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise
    return path


def write_json(path, obj) -> Path:
    return write_text(path, dumps(obj))


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def sanitize_files(files) -> int:
    """Atomically redact legacy metadata without retaining unsafe backup bytes.

    Parse all inputs before changing any file. Diagnostics never quote contents.
    """
    updates = []
    for path in files:
        path = Path(path)
        if path.is_symlink() or path.parent.is_symlink():
            raise ValueError("cannot sanitize symlinked Codemap artifacts")
        try:
            original = path.read_text(encoding="utf-8")
            obj = json.loads(original)
        except (ValueError, UnicodeError):
            raise ValueError("cannot sanitize malformed Codemap JSON") from None
        clean = privacy.document(obj, strict=True)
        if clean != obj:
            updates.append((path, dumps(clean)))
    for path, text in updates:
        write_text(path, text)
    return len(updates)


def metadata_files(repo_root, *, include_map=True) -> list[Path]:
    """Only generated metadata and snapshots inside this repository's store."""
    artifacts = paths(repo_root)
    directory = store_dir(repo_root)
    snapshots = artifacts["snapshots"]
    if directory.is_symlink() or snapshots.is_symlink():
        raise ValueError("cannot sanitize symlinked Codemap directories")
    names = ("scan", "skeleton", "map") if include_map else ("scan", "skeleton")
    files = [artifacts[name] for name in names if artifacts[name].exists() or artifacts[name].is_symlink()]
    if snapshots.exists():
        for child in sorted(snapshots.iterdir()):
            if child.is_symlink():
                raise ValueError("cannot sanitize symlinked Codemap snapshots")
            if child.is_dir():
                files.extend(sorted(p for p in child.iterdir()
                                    if p.name == "map.json" or p.name.startswith("map.json.superseded-")))
    return files


def snapshot(repo_root, sha: str, map_obj) -> dict:
    """Write ``snapshots/<sha>/map.json`` without silently replacing history.

    An identical existing snapshot is left alone. A differing one is kept as
    ``map.json.superseded-<n>`` beside the new copy.
    """
    if not sha or "/" in sha or sha.startswith("."):
        raise ValueError("snapshot needs a commit sha")
    worktree = ((map_obj.get("meta") or {}).get("repo") or {}).get("worktree") or {}
    if worktree.get("clean") is False and worktree.get("fingerprint"):
        sha = f"{sha}-worktree-{worktree['fingerprint'][:12]}"  # a map of uncommitted changes is not the commit's map
    directory = paths(repo_root)["snapshots"] / sha
    target = directory / "map.json"
    text = dumps(map_obj)
    if directory.exists():
        sanitize_files(p for p in directory.iterdir()
                       if p.name == "map.json" or p.name.startswith("map.json.superseded-"))
    if target.exists():
        existing = target.read_text(encoding="utf-8")
        if existing == text:
            return {"path": str(target), "status": "unchanged"}
        n = 1
        while (directory / f"map.json.superseded-{n}").exists():
            n += 1
        superseded = directory / f"map.json.superseded-{n}"
        write_text(superseded, existing)
        write_text(target, text)
        return {"path": str(target), "status": "superseded", "superseded": str(superseded)}
    write_text(target, text)
    return {"path": str(target), "status": "created"}


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def log(repo_root, command: str, outcome: str, **fields) -> dict:
    entry = {"time": now(), "command": command, "outcome": outcome}
    entry.update(fields)
    path = paths(repo_root)["log"]
    ensure_dir(path.parent)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, sort_keys=True, ensure_ascii=False) + "\n")
    os.chmod(path, 0o600)
    return entry
