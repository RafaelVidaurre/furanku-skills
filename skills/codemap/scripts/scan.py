#!/usr/bin/env python3
"""codemap scan: enumerate tracked source files, detect units, extract imports.

Produces the ``codemap.scan/1`` document. Python 3 standard library only.

    python3 scan.py --repo <root> [--ref HEAD] [--output <file>]

The scan is deterministic: the same working tree yields byte-identical JSON,
except for ``scanned_at`` (overridable through ``scan(..., now=...)``).

Every unit carries ``hints``, manifest and layout evidence that the decide step
hands to Jev: ``executable`` (``src/main.rs``, ``[[bin]]``, package ``bin``,
``project.scripts``, or a ``main``/``cli`` entry file), ``wasm`` (``cdylib``,
wasm-pack config, wasm-bindgen), ``server_libs``, ``client_libs``, ``desktop``,
``test_libs`` (dependency names matched against known families), ``directory_kind``
(``tools``, ``tests``, ``docs``, ``content``, ``prototypes``, ``art``, ``output``
from the unit's top-level path segment, else null) and ``test_file_share``.

``contracts`` lists tracked contract and schema files found by name alone
(protobuf, GraphQL, OpenAPI, AsyncAPI, JSON Schema, Avro, Thrift, Cap'n Proto,
FlatBuffers, XML Schema, Smithy) with the unit that owns their directory.

Every file carries ``changes``: the commits that touched it in the 90 days
before the scanned commit's own date (``activity`` records the window), so the
count depends on the commit, never on when the scan ran.

A manifest-less top-level directory with 40 or more source files splits into one
unit per first-level subdirectory holding 8 or more of them (when at least two
do), so ``tools/`` reads as ``tools-dev``, ``tools-gltf``, ... rather than one blob;
a lone hub subdirectory that holds the bulk is descended into first.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import glob as _glob
import json
import os
import posixpath
import re
import subprocess
import sys
from pathlib import Path

SCHEMA = "codemap.scan/1"
MAX_FILE_BYTES = 2 * 1024 * 1024

LANG_BY_EXT = {
    "ts": "ts", "tsx": "ts", "mts": "ts", "cts": "ts",
    "js": "js", "jsx": "js", "mjs": "js", "cjs": "js",
    "rs": "rust",
    "py": "python",
}
IGNORED_SEGMENTS = {
    "node_modules", "target", "dist", "build", "out", ".git", "__pycache__",
    ".venv", "venv", "coverage", "vendor",
}
JS_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"]
JS_TO_TS = {".js": [".ts", ".tsx", ".d.ts"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"]}
RUST_BUILTIN_CRATES = {"std", "core", "alloc", "proc_macro", "test"}
NODE_BUILTINS = {
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
    "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
    "events", "fs", "http", "http2", "https", "inspector", "module", "net",
    "os", "path", "perf_hooks", "process", "punycode", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads",
    "zlib",
}
PY_STDLIB = set(getattr(sys, "stdlib_module_names", ())) | {"__future__", "typing", "dataclasses"}


class ScanError(Exception):
    pass


# --------------------------------------------------------------------------
# git helpers
# --------------------------------------------------------------------------

def _git(root: Path, *args: str, check: bool = True) -> str | None:
    proc = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=False,
    )
    if proc.returncode != 0:
        if check:
            raise ScanError(
                "git %s failed: %s" % (" ".join(args), proc.stderr.decode("utf-8", "replace").strip())
            )
        return None
    return proc.stdout.decode("utf-8", "replace")


def _tracked_files(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"], capture_output=True,
    )
    if out.returncode != 0:
        raise ScanError("not a git repository: %s" % root)
    return sorted(p for p in out.stdout.decode("utf-8", "replace").split("\0") if p)


def worktree_state(root: Path) -> dict:
    """Uncommitted changes to tracked files, with a fingerprint of their contents.

    The scan reads files from the working tree, so a map of a checkout with such
    changes describes more than its HEAD commit; the fingerprint tells two such
    states apart.
    """
    import hashlib
    out = _git(root, "diff", "--name-only", "-z", "HEAD", check=False)
    if out is None:
        return {"clean": True, "changed_paths": 0, "fingerprint": None}
    changed = sorted(p for p in out.split("\0") if p)
    digest = hashlib.sha256()
    for path in changed:
        try:
            content = (root / path).read_bytes()
        except OSError:
            content = b"<deleted>"
        digest.update(path.encode() + b"\0" + hashlib.sha256(content).digest())
    return {"clean": not changed, "changed_paths": len(changed), "fingerprint": digest.hexdigest() if changed else None}


ACTIVITY_DAYS = 90
# contract and schema files, recognized by name alone so any stack's interface definitions count
CONTRACT_KINDS = (
    (re.compile(r"\.proto$"), "protobuf"),
    (re.compile(r"\.(graphql|graphqls|gql)$"), "graphql"),
    (re.compile(r"(^|/)(openapi|swagger)[^/]*\.(json|ya?ml)$", re.I), "openapi"),
    (re.compile(r"(^|/)asyncapi[^/]*\.(json|ya?ml)$", re.I), "asyncapi"),
    (re.compile(r"\.schema\.json$|(^|/)schemas?/[^/]+\.json$", re.I), "json-schema"),
    (re.compile(r"\.(avsc|avdl)$"), "avro"),
    (re.compile(r"\.thrift$"), "thrift"),
    (re.compile(r"\.capnp$"), "capnproto"),
    (re.compile(r"\.fbs$"), "flatbuffers"),
    (re.compile(r"\.(xsd|wsdl)$"), "xml-schema"),
    (re.compile(r"\.smithy$"), "smithy"),
)


def contract_kind(path: str) -> str | None:
    for pattern, kind in CONTRACT_KINDS:
        if pattern.search(path):
            return kind
    return None



def _activity(root: Path, sha: str | None) -> tuple[dict, dict[str, int]]:
    """Commits per path in the ACTIVITY_DAYS before the scanned commit.

    The window ends at the commit's own date, so the same commit always yields
    the same counts no matter when the scan runs.
    """
    if not sha:
        return {"window_days": ACTIVITY_DAYS, "since": None, "until": None, "commits": 0}, {}
    until = (_git(root, "show", "-s", "--format=%cI", sha, check=False) or "").strip()
    if not until:
        return {"window_days": ACTIVITY_DAYS, "since": None, "until": None, "commits": 0}, {}
    end = _dt.datetime.fromisoformat(until)
    since = (end - _dt.timedelta(days=ACTIVITY_DAYS)).isoformat()
    log = _git(root, "log", "--no-renames", "--format=%x00%H", "--name-only",
               "--since=%s" % since, "--until=%s" % until, sha, check=False) or ""
    counts: dict[str, int] = {}
    commits = 0
    for block in log.split("\0")[1:]:
        commits += 1
        for line in block.splitlines()[1:]:
            path = line.strip()
            if path:
                counts[path] = counts.get(path, 0) + 1
    return {"window_days": ACTIVITY_DAYS, "since": since, "until": until, "commits": commits}, counts


def _is_ignored(path: str) -> bool:
    return any(seg in IGNORED_SEGMENTS for seg in path.split("/"))


# --------------------------------------------------------------------------
# small manifest readers
# --------------------------------------------------------------------------

def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _load_json_lenient(path: Path) -> dict | None:
    text = _read_text(path)
    if text is None:
        return None
    try:
        data = json.loads(text)
    except ValueError:
        stripped = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        stripped = re.sub(r"(^|[\s,{\[])//[^\n]*", r"\1", stripped)
        stripped = re.sub(r",(\s*[}\]])", r"\1", stripped)
        try:
            data = json.loads(stripped)
        except ValueError:
            return None
    return data if isinstance(data, dict) else None


def _toml_sections(text: str) -> dict[str, dict[str, str]]:
    """Very small TOML reader: section -> {key: raw value}. Enough for manifests."""
    sections: dict[str, dict[str, str]] = {"": {}}
    current = sections[""]
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^\[\[?([^\]]+)\]\]?\s*(#.*)?$", line)
        if m:
            name = m.group(1).strip().strip('"')
            current = sections.setdefault(name, {})
            continue
        m = re.match(r"^([A-Za-z0-9_.\-\"']+)\s*=\s*(.*)$", line)
        if not m:
            continue
        key = m.group(1).strip().strip('"').strip("'")
        value = m.group(2)
        # multi-line arrays / inline tables
        opens = value.count("[") - value.count("]") + value.count("{") - value.count("}")
        while opens > 0 and i < len(lines):
            nxt = lines[i]
            i += 1
            value += "\n" + nxt
            opens += nxt.count("[") - nxt.count("]") + nxt.count("{") - nxt.count("}")
        current[key] = value.strip()
    return sections


def _toml_string(raw: str | None) -> str | None:
    if raw is None:
        return None
    m = re.match(r'^\s*"((?:[^"\\]|\\.)*)"', raw) or re.match(r"^\s*'([^']*)'", raw)
    return m.group(1) if m else None


def _toml_strings(raw: str | None) -> list[str]:
    if raw is None:
        return []
    raw = re.sub(r"#[^\n]*", "", raw)
    return re.findall(r'"((?:[^"\\]|\\.)*)"', raw) + re.findall(r"'([^']*)'", raw)


def _yaml_list(text: str, key: str) -> list[str]:
    """Read a top-level ``key:`` block sequence from a simple YAML document."""
    items: list[str] = []
    active = False
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if re.match(r"^\S", line):
            active = re.match(r"^%s\s*:\s*$" % re.escape(key), line) is not None
            inline = re.match(r"^%s\s*:\s*\[(.*)\]\s*$" % re.escape(key), line)
            if inline:
                items.extend(_toml_strings(inline.group(1)) or [s.strip() for s in inline.group(1).split(",") if s.strip()])
            continue
        if active:
            m = re.match(r"^\s*-\s*(.+?)\s*$", line)
            if m:
                items.append(m.group(1).strip().strip('"').strip("'"))
    return items


# --------------------------------------------------------------------------
# units
# --------------------------------------------------------------------------

class Unit:
    __slots__ = ("id", "path", "kind", "name", "manifest", "description", "readme", "data", "hints")

    def __init__(self, path: str, kind: str, name: str, manifest: str | None,
                 description: str | None, readme: str | None, data=None):
        self.id = ""
        self.path = path
        self.kind = kind
        self.name = name
        self.manifest = manifest
        self.description = description
        self.readme = readme
        self.data = data
        self.hints = dict(EMPTY_HINTS)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "path": self.path, "kind": self.kind, "name": self.name,
            "manifest": self.manifest, "description": self.description, "readme": self.readme,
            "hints": dict(self.hints),
        }


def _expand_dir_globs(root: Path, patterns: list[str], manifest_name: str) -> list[str]:
    found: set[str] = set()
    for pattern in patterns:
        if not pattern or pattern.startswith("!"):
            continue
        pattern = pattern.rstrip("/")
        for hit in _glob.glob(str(root / pattern / manifest_name)):
            rel = os.path.relpath(os.path.dirname(hit), root).replace(os.sep, "/")
            if rel in (".", "") or _is_ignored(rel):
                continue
            found.add(rel)
    return sorted(found)


def _readme_for(root: Path, rel_dir: str) -> str | None:
    for name in ("README.md", "readme.md", "README.rst", "README"):
        if (root / rel_dir / name).is_file():
            return posixpath.join(rel_dir, name)
    return None


def _js_workspace_patterns(root: Path) -> list[str]:
    patterns: list[str] = []
    pnpm = _read_text(root / "pnpm-workspace.yaml")
    if pnpm:
        patterns.extend(_yaml_list(pnpm, "packages"))
    pkg = _load_json_lenient(root / "package.json") or {}
    ws = pkg.get("workspaces")
    if isinstance(ws, dict):
        ws = ws.get("packages")
    if isinstance(ws, list):
        patterns.extend(str(p) for p in ws if isinstance(p, str))
    return patterns


NX_START_TARGETS = {"serve", "start", "dev", "preview", "serve-static"}
START_SCRIPTS = {"start", "dev", "serve", "preview"}


def _detect_nx_units(root: Path, tracked: list[str]) -> list[Unit]:
    """Nx projects declare their own boundary in project.json, with or without a package.json beside it."""
    units: list[Unit] = []
    for rel_file in tracked:
        if posixpath.basename(rel_file) != "project.json" or rel_file == "project.json" or _is_ignored(rel_file):
            continue
        data = _load_json_lenient(root / rel_file)
        if not isinstance(data, dict) or not any(k in data for k in ("targets", "projectType", "sourceRoot")):
            continue
        rel = posixpath.dirname(rel_file)
        pkg = _load_json_lenient(root / rel / "package.json") or {}
        name = data.get("name") if isinstance(data.get("name"), str) else posixpath.basename(rel)
        desc = pkg.get("description") if isinstance(pkg.get("description"), str) else None
        kind = "app" if data.get("projectType") == "application" else "package"
        units.append(Unit(rel, kind, name, rel_file, desc, _readme_for(root, rel), dict(pkg, nx=data)))
    return units


def _detect_js_units(root: Path) -> list[Unit]:
    units: list[Unit] = []
    for rel in _expand_dir_globs(root, _js_workspace_patterns(root), "package.json"):
        data = _load_json_lenient(root / rel / "package.json") or {}
        scripts = data.get("scripts") if isinstance(data.get("scripts"), dict) else {}
        has_entry = any(data.get(k) for k in ("main", "exports", "types", "module"))
        is_app = rel.startswith("apps/") or (
            data.get("private") is True and not has_entry
            and (data.get("bin") or "dev" in scripts or "start" in scripts)
        )
        name = data.get("name") if isinstance(data.get("name"), str) else posixpath.basename(rel)
        desc = data.get("description") if isinstance(data.get("description"), str) else None
        units.append(Unit(rel, "app" if is_app else "package", name,
                          posixpath.join(rel, "package.json"), desc, _readme_for(root, rel), data))
    return units


def _detect_rust_units(root: Path) -> list[Unit]:
    text = _read_text(root / "Cargo.toml")
    if text is None:
        return []
    sections = _toml_sections(text)
    members = _toml_strings(sections.get("workspace", {}).get("members"))
    excluded = set(_toml_strings(sections.get("workspace", {}).get("exclude")))
    units: list[Unit] = []
    for rel in _expand_dir_globs(root, members, "Cargo.toml"):
        if rel in excluded:
            continue
        crate = _toml_sections(_read_text(root / rel / "Cargo.toml") or "")
        pkg = crate.get("package", {})
        name = _toml_string(pkg.get("name")) or posixpath.basename(rel)
        deps: set[str] = set()
        for sec_name, sec in crate.items():
            if sec_name in ("dependencies", "dev-dependencies", "build-dependencies"):
                deps.update(sec.keys())
            for prefix in ("dependencies.", "dev-dependencies.", "build-dependencies."):
                if sec_name.startswith(prefix):
                    deps.add(sec_name[len(prefix):])
            m = re.match(r"^target\.[^.]+\.(dependencies|dev-dependencies|build-dependencies)$", sec_name)
            if m:
                deps.update(sec.keys())
        units.append(Unit(rel, "crate", name, posixpath.join(rel, "Cargo.toml"),
                          _toml_string(pkg.get("description")), _readme_for(root, rel),
                          {"deps": deps, "sections": crate}))
    return units


def _detect_python_units(root: Path, tracked: list[str]) -> list[Unit]:
    units: list[Unit] = []
    seen: set[str] = set()
    for manifest in ("pyproject.toml", "setup.py", "setup.cfg"):
        for path in tracked:
            if posixpath.basename(path) != manifest or _is_ignored(path):
                continue
            rel = posixpath.dirname(path)
            if rel in ("", ".") or rel in seen:
                continue
            seen.add(rel)
            name = posixpath.basename(rel)
            desc = None
            data = None
            if manifest == "pyproject.toml":
                sections = _toml_sections(_read_text(root / path) or "")
                for sec in ("project", "tool.poetry"):
                    name = _toml_string(sections.get(sec, {}).get("name")) or name
                    desc = _toml_string(sections.get(sec, {}).get("description")) or desc
                data = {"sections": sections}
            units.append(Unit(rel, "python", name, path, desc, _readme_for(root, rel), data))
    return units


SPLIT_MIN_FILES = 40
SPLIT_MIN_SUBDIR_FILES = 8
SPLIT_MIN_SUBDIRS = 2


def _readme_first_line(root: Path, readme: str | None) -> str | None:
    text = _read_text(root / readme) if readme else None
    for line in (text or "").splitlines():
        line = line.strip().lstrip("#").strip()
        if line:
            return line[:200]
    return None


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _split_directory(root: Path, top: str, files: list[str]) -> list[Unit]:
    """Units for the large first-level subdirectories of a manifest-less top-level directory.

    A directory with at least SPLIT_MIN_FILES source files and at least SPLIT_MIN_SUBDIRS first-level
    subdirectories each holding SPLIT_MIN_SUBDIR_FILES or more becomes one unit per such subdirectory;
    files directly in the directory and smaller subdirectories stay with the parent unit. When a single
    hub subdirectory holds the bulk instead (``art/character/...``), the rule is applied inside the hub.
    """
    if not top or len(files) < SPLIT_MIN_FILES:
        return []
    per_sub: dict[str, int] = {}
    for path in files:
        rel = path[len(top) + 1:]
        if "/" in rel:
            sub = rel.split("/", 1)[0]
            per_sub[sub] = per_sub.get(sub, 0) + 1
    large = sorted(sub for sub, n in per_sub.items() if n >= SPLIT_MIN_SUBDIR_FILES)
    if len(large) < SPLIT_MIN_SUBDIRS:
        if len(large) == 1 and per_sub[large[0]] >= SPLIT_MIN_FILES:
            hub = f"{top}/{large[0]}"
            return _split_directory(root, hub, [f for f in files if f.startswith(hub + "/")])
        return []
    units = []
    for sub in large:
        rel = f"{top}/{sub}"
        readme = _readme_for(root, rel)
        unit = Unit(rel, "directory", rel, None, _readme_first_line(root, readme), readme)
        unit.id = _slug(rel)
        units.append(unit)
    return units


def _assign_ids(units: list[Unit]) -> None:
    """Ids are path basenames; a basename shared by two units gets its parent directory prefixed.

    Units created with a preset id (split directories) keep it and stay out of the collision count.
    """
    units.sort(key=lambda u: u.path)
    counts: dict[str, int] = {}
    for u in units:
        if u.id:
            continue
        base = posixpath.basename(u.path) or "root"
        counts[base] = counts.get(base, 0) + 1
    for u in units:
        if u.id:
            continue
        base = posixpath.basename(u.path) or "root"
        if counts[base] > 1 and u.path:
            parent = posixpath.basename(posixpath.dirname(u.path))
            u.id = "%s-%s" % (parent, base) if parent else base
        else:
            u.id = base


# --------------------------------------------------------------------------
# manifest hints
# --------------------------------------------------------------------------

EMPTY_HINTS = {
    "executable": False, "wasm": False, "server_libs": [], "client_libs": [], "desktop": False,
    "test_libs": [], "directory_kind": None, "test_file_share": 0.0, "declared_kind": None,
}
SERVER_LIBS = {
    "axum", "tokio", "hyper", "actix", "actix-web", "warp", "rocket", "tonic", "tower", "tokio-tungstenite",
    "sqlx", "diesel", "sea-orm", "express", "fastify", "koa", "hono", "ws", "socket.io", "pg", "prisma",
    "mongoose", "knex", "drizzle-orm", "django", "flask", "fastapi", "starlette", "uvicorn", "gunicorn",
    "sqlalchemy", "psycopg", "psycopg2", "asyncpg", "redis",
}
CLIENT_LIBS = {
    "three", "react", "react-dom", "vue", "svelte", "solid-js", "preact", "vite", "electron", "tauri",
    "web-sys", "js-sys", "happy-dom", "jsdom", "pixi.js",
}
DESKTOP_LIBS = {"electron", "electron-builder", "electron-updater", "tauri"}
TEST_LIBS = {
    "vitest", "jest", "mocha", "playwright", "cypress", "ava", "pytest", "pytest-asyncio", "hypothesis",
    "wasm-bindgen-test", "insta", "proptest", "criterion",
}
WASM_LIBS = {"wasm-bindgen", "wasm-pack", "vite-plugin-wasm", "@wasm-tool/wasm-pack-plugin"}
SCOPE_FAMILIES = {
    "@playwright/": TEST_LIBS, "@tauri-apps/": DESKTOP_LIBS, "@nestjs/": SERVER_LIBS, "@prisma/": SERVER_LIBS,
    "@babylonjs/": CLIENT_LIBS,
}
DIRECTORY_KINDS = {
    "tools": "tools", "tool": "tools", "scripts": "tools", "tests": "tests", "test": "tests", "e2e": "tests",
    "__tests__": "tests", "docs": "docs", "doc": "docs", "content": "content", "prototypes": "prototypes",
    "prototype": "prototypes", "spikes": "prototypes", "experiments": "prototypes", "art": "art",
    "assets": "art", "output": "output", "out": "output", "dist": "output", "build": "output",
}
ENTRY_BASENAMES = {
    "main.ts", "main.tsx", "main.mts", "main.js", "main.mjs", "main.cjs", "main.py", "__main__.py",
    "cli.ts", "cli.mts", "cli.js", "cli.mjs", "cli.cjs", "cli.py",
}


def _lib_key(name: str) -> str:
    return name.strip().lower().replace("_", "-")


def _family(name: str, family: set[str]) -> bool:
    key = _lib_key(name)
    if key in family:
        return True
    return any(key.startswith(prefix) and family is members for prefix, members in SCOPE_FAMILIES.items())


def _py_requirement_names(raw: str | None) -> list[str]:
    names = []
    for spec in _toml_strings(raw):
        m = re.match(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)", spec)
        if m:
            names.append(m.group(1))
    return names


def _manifest_deps(unit: Unit) -> tuple[list[str], list[str]]:
    """(dependencies that shape what the unit is, dependencies that only its tests or build use).

    JS devDependencies are the build stack (vite, electron-builder, vitest) and count as
    evidence of what the unit is; Cargo dev-dependencies and Python optional groups are
    harness-only and count only towards test frameworks.
    """
    data = unit.data or {}
    if unit.kind in ("package", "app"):
        names = []
        for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            block = data.get(key)
            if isinstance(block, dict):
                names.extend(str(k) for k in block)
        return names, []
    sections = data.get("sections") or {}
    if unit.kind == "crate":
        runtime, dev = [], []
        for sec_name, sec in sections.items():
            tail = sec_name.rsplit(".", 1)[-1]
            if sec_name == "dependencies" or (sec_name.startswith("target.") and tail == "dependencies"):
                runtime.extend(sec.keys())
            elif tail in ("dev-dependencies", "build-dependencies") and (
                    sec_name == tail or sec_name.startswith("target.")):
                dev.extend(sec.keys())
            elif sec_name.startswith("dependencies."):
                runtime.append(sec_name.split(".", 1)[1])
            elif sec_name.startswith("dev-dependencies.") or sec_name.startswith("build-dependencies."):
                dev.append(sec_name.split(".", 1)[1])
        return runtime, dev
    if unit.kind == "python":
        runtime = _py_requirement_names(sections.get("project", {}).get("dependencies"))
        runtime.extend(k for k in sections.get("tool.poetry.dependencies", {}) if k != "python")
        dev = []
        for sec_name, sec in sections.items():
            if sec_name in ("project.optional-dependencies", "dependency-groups"):
                for raw in sec.values():
                    dev.extend(_py_requirement_names(raw))
            elif sec_name == "tool.poetry.dev-dependencies" or re.match(r"^tool\.poetry\.group\.[^.]+\.dependencies$", sec_name):
                dev.extend(sec.keys())
        return runtime, dev
    return [], []


def _declared_kind(unit: Unit) -> str | None:
    """What the unit's own build configuration says it is: 'application', 'library', or None."""
    nx = (unit.data or {}).get("nx") or {}
    kind = nx.get("projectType")
    return kind if kind in ("application", "library") else None


def _is_executable(scanner: "Scanner", unit: Unit, files: list[str]) -> bool:
    data = unit.data or {}
    base = unit.path + "/" if unit.path else ""
    # start evidence any stack declares: a start/serve target, a start/dev script, or a container image
    targets = ((data.get("nx") or {}).get("targets") or {}) if isinstance(data.get("nx"), dict) else {}
    scripts = data.get("scripts") if isinstance(data.get("scripts"), dict) else {}
    # a package that exports a library entry uses start/dev scripts for watch builds, not to run anything
    exports_library = any(data.get(k) for k in ("main", "exports", "types", "module"))
    if _declared_kind(unit) != "library" and (NX_START_TARGETS & set(targets)
                                               or (START_SCRIPTS & set(scripts) and not exports_library)
                                               or (base + "Dockerfile") in scanner.tracked):
        return True
    if unit.kind == "crate":
        if scanner.is_source(base + "src/main.rs") or "bin" in (data.get("sections") or {}):
            return True
        return any(f.startswith(base + "src/bin/") for f in files)
    if unit.kind in ("package", "app") and data.get("bin"):
        return True
    if unit.kind == "python":
        sections = data.get("sections") or {}
        if "project.scripts" in sections or "project.gui-scripts" in sections or "tool.poetry.scripts" in sections:
            return True
    roots = {base.rstrip("/"), base + "src", base + "bin"}
    return any(posixpath.dirname(f) in roots and posixpath.basename(f) in ENTRY_BASENAMES for f in files)


def _is_wasm(unit: Unit, names: list[str]) -> bool:
    sections = (unit.data or {}).get("sections") or {} if unit.kind == "crate" else {}
    if "cdylib" in _toml_strings(sections.get("lib", {}).get("crate-type")):
        return True
    if any(name.startswith("package.metadata.wasm-pack") for name in sections):
        return True
    return any(_lib_key(n) in WASM_LIBS for n in names)


def unit_hints(scanner: "Scanner", unit: Unit, files: list[dict], externals: dict[str, list[str]]) -> dict:
    """Manifest and layout evidence for the runtime, nature, and role questions."""
    paths = [f["path"] for f in files]
    runtime_deps, dev_deps = _manifest_deps(unit)
    shaping = runtime_deps + externals.get("source", [])
    harness = dev_deps + externals.get("test", [])
    everything = shaping + harness

    def matched(candidates, family):
        return sorted({_lib_key(n) for n in candidates if _family(n, family)})

    top = unit.path.split("/", 1)[0] if unit.path else ""
    tests = sum(1 for f in files if f.get("role") == "test")
    return {
        "executable": _is_executable(scanner, unit, paths),
        "declared_kind": _declared_kind(unit),
        "wasm": _is_wasm(unit, everything),
        "server_libs": matched(shaping, SERVER_LIBS),
        "client_libs": matched(shaping, CLIENT_LIBS),
        "desktop": bool(matched(everything, DESKTOP_LIBS)),
        "test_libs": matched(everything, TEST_LIBS),
        "directory_kind": DIRECTORY_KINDS.get(top),
        "test_file_share": round(tests / len(files), 3) if files else 0.0,
    }


# --------------------------------------------------------------------------
# scanner state
# --------------------------------------------------------------------------

class Scanner:
    def __init__(self, root: Path, tracked: list[str]):
        self.root = root
        self.tracked = set(tracked)
        self.source: dict[str, str] = {}
        self.skipped: dict[str, int] = {}
        for p in tracked:
            if _is_ignored(p):
                continue
            ext = p.rsplit(".", 1)[-1].lower() if "." in posixpath.basename(p) else ""
            lang = LANG_BY_EXT.get(ext)
            if lang is None:
                self.skipped[ext or "(none)"] = self.skipped.get(ext or "(none)", 0) + 1
                continue
            try:
                if (root / p).stat().st_size > MAX_FILE_BYTES:
                    self.skipped["(oversize)"] = self.skipped.get("(oversize)", 0) + 1
                    continue
            except OSError:
                self.skipped["(unreadable)"] = self.skipped.get("(unreadable)", 0) + 1
                continue
            self.source[p] = lang
        self.units: list[Unit] = []
        self.unit_by_path: dict[str, Unit] = {}
        self.js_by_name: dict[str, Unit] = {}
        self.crate_by_name: dict[str, Unit] = {}
        self.edges: list[dict] = []
        self.unresolved: list[dict] = []
        self.externals: dict[str, dict] = {}
        self._tsconfig_cache: dict[str, dict | None] = {}
        self._py_roots_cache: dict[str, list[str]] = {}
        self._init_chain_roots: dict[str, str] = {}

    # --- units -----------------------------------------------------------
    def detect_units(self) -> None:
        units = _detect_js_units(self.root) + _detect_rust_units(self.root) \
            + _detect_python_units(self.root, sorted(self.tracked))
        # an Nx project.json adds its declaration to a unit already found at that path, or defines the unit itself
        known = {u.path: u for u in units}
        for nx in _detect_nx_units(self.root, sorted(self.tracked)):
            if nx.path in known:
                known[nx.path].data = dict(known[nx.path].data or {}, nx=nx.data["nx"])
                if nx.kind == "app":
                    known[nx.path].kind = "app"
            else:
                units.append(nx)
        # deepest manifest wins: dedupe identical paths (first detector wins)
        by_path: dict[str, Unit] = {}
        for u in units:
            by_path.setdefault(u.path, u)
        units = list(by_path.values())
        manifest_prefixes = sorted(by_path, key=len, reverse=True)
        unclaimed: dict[str, list[str]] = {}
        for path in sorted(self.source):
            if not any(path.startswith(pre + "/") for pre in manifest_prefixes):
                top = path.split("/", 1)[0] if "/" in path else ""
                unclaimed.setdefault(top, []).append(path)
        for top, paths in sorted(unclaimed.items()):
            units.append(Unit(top, "directory", top or "root", None, None,
                              _readme_for(self.root, top) if top else None))
            units.extend(_split_directory(self.root, top, paths))
        _assign_ids(units)
        self.units = units
        self.unit_by_path = {u.path: u for u in units}
        for u in units:
            if u.kind in ("package", "app") and u.name:
                self.js_by_name.setdefault(u.name, u)
            if u.kind == "crate":
                self.crate_by_name[u.name.replace("-", "_")] = u

    def unit_for(self, path: str) -> Unit | None:
        best: Unit | None = None
        for u in self.units:
            if u.path == "" or path.startswith(u.path + "/"):
                if best is None or len(u.path) > len(best.path):
                    best = u
        return best

    # --- edge bookkeeping ------------------------------------------------
    def add_edge(self, src: str, dst: str, spec: str, line: int) -> None:
        if dst == src:
            return
        self.edges.append({"from": src, "to": dst, "specifier": spec, "line": line})

    def add_unresolved(self, src: str, spec: str, line: int) -> None:
        self.unresolved.append({"from": src, "specifier": spec, "line": line})

    def add_external(self, name: str, src: str) -> None:
        entry = self.externals.setdefault(name, {"count": 0, "files": set()})
        entry["count"] += 1
        entry["files"].add(src)

    def is_source(self, path: str) -> bool:
        return path in self.source

    # --- TS / JS -----------------------------------------------------------
    def _probe_js(self, base: str) -> str | None:
        """Probe a normalized repo-relative path without leading ./ for a JS/TS module."""
        if self.is_source(base):
            return base
        for ext, swaps in JS_TO_TS.items():
            if base.endswith(ext):
                stem = base[: -len(ext)]
                for alt in swaps:
                    if self.is_source(stem + alt):
                        return stem + alt
        for ext in JS_EXTS:
            if self.is_source(base + ext):
                return base + ext
        for ext in JS_EXTS:
            if self.is_source(posixpath.join(base, "index" + ext)):
                return posixpath.join(base, "index" + ext)
        return None

    def _tsconfig_for(self, directory: str) -> dict | None:
        if directory in self._tsconfig_cache:
            return self._tsconfig_cache[directory]
        result = None
        candidate = posixpath.join(directory, "tsconfig.json") if directory else "tsconfig.json"
        if (self.root / candidate).is_file():
            result = self._load_tsconfig(candidate)
        elif directory:
            result = self._tsconfig_for(posixpath.dirname(directory))
        self._tsconfig_cache[directory] = result
        return result

    def _load_tsconfig(self, rel: str) -> dict | None:
        data = _load_json_lenient(self.root / rel)
        if data is None:
            return None
        cfg_dir = posixpath.dirname(rel)
        options = data.get("compilerOptions") if isinstance(data.get("compilerOptions"), dict) else {}
        base_url = options.get("baseUrl")
        paths = options.get("paths") if isinstance(options.get("paths"), dict) else None
        paths_dir = cfg_dir
        ext = data.get("extends")
        if isinstance(ext, str) and (ext.startswith(".") or ext.startswith("/")):
            parent_rel = posixpath.normpath(posixpath.join(cfg_dir, ext if ext.endswith(".json") else ext + ".json"))
            parent = _load_json_lenient(self.root / parent_rel) or {}
            popts = parent.get("compilerOptions") if isinstance(parent.get("compilerOptions"), dict) else {}
            if base_url is None and popts.get("baseUrl"):
                base_url = posixpath.normpath(posixpath.join(posixpath.dirname(parent_rel), popts["baseUrl"]))
                base_url = posixpath.relpath(base_url, cfg_dir) if cfg_dir else base_url
            if paths is None and isinstance(popts.get("paths"), dict):
                paths = popts["paths"]
                paths_dir = posixpath.dirname(parent_rel)
        base_dir = posixpath.normpath(posixpath.join(cfg_dir, base_url)) if base_url else None
        if base_dir == ".":
            base_dir = ""
        return {"paths": paths or {}, "baseUrl": base_dir, "pathsDir": base_dir if base_url else paths_dir}

    def _resolve_ts_paths(self, spec: str, cfg: dict) -> str | None:
        best_key, best_star = None, None
        for key in cfg["paths"]:
            if "*" in key:
                prefix, suffix = key.split("*", 1)
                if spec.startswith(prefix) and spec.endswith(suffix) and len(spec) >= len(prefix) + len(suffix):
                    star = spec[len(prefix): len(spec) - len(suffix)]
                    if best_key is None or len(prefix) > len(best_key.split("*", 1)[0]):
                        best_key, best_star = key, star
            elif key == spec:
                best_key, best_star = key, None
                break
        if best_key is None:
            return None
        targets = cfg["paths"][best_key]
        if not isinstance(targets, list):
            return None
        for target in targets:
            if not isinstance(target, str):
                continue
            candidate = target.replace("*", best_star or "")
            rel = posixpath.normpath(posixpath.join(cfg["pathsDir"], candidate))
            if rel.startswith("../"):
                continue
            hit = self._probe_js(rel if rel != "." else "")
            if hit:
                return hit
        return None

    def _package_entry(self, unit: Unit, subpath: str | None) -> str | None:
        data = unit.data or {}
        exports = data.get("exports")
        key = "." if subpath is None else "./" + subpath

        def pick(value):
            if isinstance(value, str):
                return value
            if isinstance(value, dict):
                for k in ("import", "default", "types", "require", "node", "browser", "source"):
                    if k in value:
                        got = pick(value[k])
                        if got:
                            return got
                for v in value.values():
                    got = pick(v)
                    if got:
                        return got
            return None

        candidates: list[str] = []
        if isinstance(exports, str) and subpath is None:
            candidates.append(exports)
        elif isinstance(exports, dict):
            if key in exports:
                got = pick(exports[key])
                if got:
                    candidates.append(got)
            elif subpath is None and not any(k.startswith(".") for k in exports):
                got = pick(exports)
                if got:
                    candidates.append(got)
            else:
                for ek, ev in exports.items():
                    if "*" in ek:
                        prefix, suffix = ek.split("*", 1)
                        if key.startswith(prefix) and key.endswith(suffix):
                            star = key[len(prefix): len(key) - len(suffix)]
                            got = pick(ev)
                            if got:
                                candidates.append(got.replace("*", star))
        if subpath is None:
            for k in ("module", "main", "types"):
                if isinstance(data.get(k), str):
                    candidates.append(data[k])
            candidates.extend(["src/index", "index", "src/main", "src/lib"])
        else:
            candidates.extend([posixpath.join("src", subpath), subpath])
        for cand in candidates:
            rel = posixpath.normpath(posixpath.join(unit.path, cand))
            hit = self._probe_js(rel)
            if hit:
                return hit
        return None

    def _workspace_package_for(self, spec: str) -> tuple[Unit, str | None] | None:
        if spec in self.js_by_name:
            return self.js_by_name[spec], None
        parts = spec.split("/")
        depth = 2 if spec.startswith("@") else 1
        if len(parts) > depth:
            name = "/".join(parts[:depth])
            if name in self.js_by_name:
                return self.js_by_name[name], "/".join(parts[depth:])
        return None

    def resolve_js(self, src: str, spec: str, line: int) -> None:
        raw = spec
        spec = spec.split("?", 1)[0]
        src_dir = posixpath.dirname(src)
        if spec.startswith("."):
            base = posixpath.normpath(posixpath.join(src_dir, spec))
            hit = self._probe_js(base)
            if hit:
                self.add_edge(src, hit, raw, line)
            elif base in self.tracked or _is_ignored(base):
                return  # a tracked asset (json, css, wasm) or an ignored tree: not a code edge
            else:
                self.add_unresolved(src, raw, line)
            return
        if spec.startswith("/") or spec.startswith("file:"):
            self.add_unresolved(src, raw, line)
            return
        cfg = self._tsconfig_for(src_dir)
        if cfg:
            hit = self._resolve_ts_paths(spec, cfg)
            if hit:
                self.add_edge(src, hit, raw, line)
                return
            if cfg["baseUrl"] is not None:
                rel = posixpath.normpath(posixpath.join(cfg["baseUrl"], spec))
                if not rel.startswith("../"):
                    hit = self._probe_js(rel)
                    if hit:
                        self.add_edge(src, hit, raw, line)
                        return
        ws = self._workspace_package_for(spec)
        if ws:
            unit, subpath = ws
            hit = self._package_entry(unit, subpath)
            if hit:
                self.add_edge(src, hit, raw, line)
            else:
                self.add_unresolved(src, raw, line)
            return
        if spec.startswith("node:"):
            return
        parts = spec.split("/")
        name = "/".join(parts[:2]) if spec.startswith("@") else parts[0]
        if name in NODE_BUILTINS:
            return
        self.add_external(name, src)

    # --- Rust ----------------------------------------------------------------
    def _crate_root_for(self, unit: Unit | None) -> tuple[str, str] | None:
        """Return (root_file, src_dir) for the crate root that `crate::` refers to."""
        if unit is None or unit.kind != "crate":
            return None
        src = posixpath.join(unit.path, "src")
        for name in ("lib.rs", "main.rs"):
            if self.is_source(posixpath.join(src, name)):
                return posixpath.join(src, name), src
        return None

    def _is_rust_root_file(self, unit: Unit | None, path: str) -> bool:
        rel = path[len(unit.path) + 1:] if unit and unit.path and path.startswith(unit.path + "/") else path
        parts = rel.split("/")
        if len(parts) == 2 and parts[0] == "src" and parts[1] in ("lib.rs", "main.rs"):
            return True
        if len(parts) == 3 and parts[0] == "src" and parts[1] == "bin":
            return True
        if len(parts) == 2 and parts[0] in ("tests", "examples", "benches"):
            return True
        if len(parts) == 3 and parts[0] in ("tests", "examples", "benches") and parts[2] == "main.rs":
            return True
        return False

    def _rust_module(self, unit: Unit | None, path: str) -> tuple[str, str]:
        """(file, dir) of the module a file defines: dir is where its child modules live."""
        directory = posixpath.dirname(path)
        if posixpath.basename(path) == "mod.rs" or self._is_rust_root_file(unit, path):
            return path, directory
        return path, posixpath.join(directory, posixpath.basename(path)[:-3])

    def _rust_parent(self, unit: Unit | None, module: tuple[str, str]) -> tuple[str, str] | None:
        file, directory = module
        if self._is_rust_root_file(unit, file):
            return None
        if posixpath.basename(file) == "mod.rs":
            parent_dir = posixpath.dirname(directory)
        else:
            parent_dir = posixpath.dirname(file)
        root = self._crate_root_for(unit)
        if root and parent_dir == root[1]:
            return root[0], parent_dir
        stem = posixpath.basename(parent_dir)
        for cand in (posixpath.join(posixpath.dirname(parent_dir), stem + ".rs"), posixpath.join(parent_dir, "mod.rs")):
            if self.is_source(cand):
                return cand, parent_dir
        if root:
            return root[0], root[1]
        return None

    def _rust_descend(self, module: tuple[str, str], segments: list[str]) -> str:
        file, directory = module
        for n in range(len(segments), 0, -1):
            sub = "/".join(segments[:n])
            for cand in (posixpath.join(directory, sub + ".rs"), posixpath.join(directory, sub, "mod.rs")):
                if self.is_source(cand):
                    return cand
        return file

    def resolve_rust(self, src: str, path: str, spec: str, line: int, unit: Unit | None,
                     local_mods: set[str], inline_depth: int) -> None:
        """Resolve one `use` path; `spec` is the raw statement body recorded on the edge."""
        segments = [s for s in path.split("::") if s]
        if not segments:
            return
        head = segments[0]
        module = self._rust_module(unit, src)
        if head == "crate":
            root = self._crate_root_for(unit)
            root_mod = module if root is None or self._is_rust_root_file(unit, src) else root
            target = self._rust_descend(root_mod, segments[1:])
            self.add_edge(src, target, spec, line)
            return
        if head in ("self", "super"):
            ups = 0
            rest = segments
            while rest and rest[0] in ("self", "super"):
                if rest[0] == "super":
                    ups += 1
                rest = rest[1:]
            ups -= inline_depth
            if ups < 0:
                ups = 0
            current: tuple[str, str] | None = module
            for _ in range(ups):
                current = self._rust_parent(unit, current)
                if current is None:
                    self.add_unresolved(src, spec, line)
                    return
            # `super::x` inside an inline `mod tests {}` names the file itself
            # (or one of its child modules, which the descend finds).
            target = self._rust_descend(current, rest)
            self.add_edge(src, target, spec, line)
            return
        if head in local_mods:
            target = self._rust_descend(module, segments)
            self.add_edge(src, target, spec, line)
            return
        deps = (unit.data or {}).get("deps", set()) if unit and unit.kind == "crate" else set()
        crate = self.crate_by_name.get(head)
        if crate is not None and (head.replace("_", "-") in deps or head in deps or not deps):
            root = self._crate_root_for(crate)
            if root:
                self.add_edge(src, root[0], spec, line)
            else:
                self.add_unresolved(src, spec, line)
            return
        # a sibling module file that was declared elsewhere (e.g. `mod common;` in another test)
        sibling = self._rust_descend(module, segments)
        if sibling != src:
            self.add_edge(src, sibling, spec, line)
            return
        if head in RUST_BUILTIN_CRATES:
            return
        if crate is not None:
            root = self._crate_root_for(crate)
            if root:
                self.add_edge(src, root[0], spec, line)
                return
        self.add_external(head, src)

    # --- Python --------------------------------------------------------------
    def _python_roots(self, src: str, unit: Unit | None) -> list[str]:
        src_dir = posixpath.dirname(src)
        if src_dir in self._py_roots_cache:
            return self._py_roots_cache[src_dir]
        roots: list[str] = [src_dir]
        chain = src_dir
        while chain and self.is_source(posixpath.join(chain, "__init__.py")):
            chain = posixpath.dirname(chain)
        if chain != src_dir:
            roots.append(chain)
        if unit and unit.kind == "python":
            for cand in (posixpath.join(unit.path, "src"), unit.path):
                if cand not in roots:
                    roots.append(cand)
        walk = posixpath.dirname(src_dir)
        while walk:
            if walk not in roots:
                roots.append(walk)
            walk = posixpath.dirname(walk)
        if "" not in roots:
            roots.append("")
        for other in self.units:
            if other.kind == "python":
                for cand in (posixpath.join(other.path, "src"), other.path):
                    if cand not in roots:
                        roots.append(cand)
        self._py_roots_cache[src_dir] = roots
        return roots

    def _probe_py(self, base_dir: str, dotted: str) -> str | None:
        parts = dotted.split(".") if dotted else []
        for n in range(len(parts), 0, -1):
            sub = "/".join(parts[:n])
            for cand in (posixpath.join(base_dir, sub + ".py"), posixpath.join(base_dir, sub, "__init__.py")):
                if self.is_source(cand):
                    return cand
        if not parts and self.is_source(posixpath.join(base_dir, "__init__.py")):
            return posixpath.join(base_dir, "__init__.py")
        return None

    def resolve_python(self, src: str, module: str, names: list[str], line: int, unit: Unit | None) -> None:
        raw = module if not names else "%s import %s" % (module, ", ".join(names))
        level = len(module) - len(module.lstrip("."))
        dotted = module[level:]
        if level:
            base = posixpath.dirname(src)
            for _ in range(level - 1):
                base = posixpath.dirname(base)
            hit = None
            for name in names:
                cand = self._probe_py(base, (dotted + "." + name) if dotted else name)
                if cand and (hit is None or len(cand) > len(hit)):
                    hit = cand
                    break
            hit = hit or self._probe_py(base, dotted)
            if hit:
                self.add_edge(src, hit, raw, line)
            else:
                self.add_unresolved(src, raw, line)
            return
        top = dotted.split(".", 1)[0]
        for root in self._python_roots(src, unit):
            hit = None
            for name in names:
                cand = self._probe_py(root, dotted + "." + name)
                if cand:
                    hit = cand
                    break
            hit = hit or self._probe_py(root, dotted)
            if hit:
                self.add_edge(src, hit, raw, line)
                return
        if top in PY_STDLIB:
            return
        self.add_external(top, src)


# --------------------------------------------------------------------------
# per-language line parsers
# --------------------------------------------------------------------------

JS_FROM = re.compile(r"""\bfrom\s*['"]([^'"\n]+)['"]""")
JS_STATIC_START = re.compile(r"""^\s*(?:import|export)\b""")
JS_SIDE_EFFECT = re.compile(r"""^\s*import\s*['"]([^'"\n]+)['"]""")
JS_DYNAMIC = re.compile(r"""\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)""")
JS_STATIC_INLINE = re.compile(r"""^\s*(?:import|export)\b[^'"\n;]*?\bfrom\s*['"]([^'"\n]+)['"]""")
JS_IMPORT_EQUALS = re.compile(r"""^\s*import\s+\w+\s*=\s*require\s*\(\s*['"]([^'"\n]+)['"]\s*\)""")


def parse_js(scanner: Scanner, src: str, lines: list[str]) -> None:
    pending_start: int | None = None
    pending_seen = 0
    for idx, line in enumerate(lines, start=1):
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
            continue
        for m in JS_DYNAMIC.finditer(line):
            scanner.resolve_js(src, m.group(1), idx)
        if pending_start is not None:
            pending_seen += 1
            m = JS_FROM.search(line)
            if m:
                scanner.resolve_js(src, m.group(1), pending_start)
                pending_start = None
            elif line.rstrip().endswith(";") or re.match(r"^\s*}\s*;?\s*$", line) or pending_seen > 40:
                pending_start = None
            continue
        m = JS_STATIC_INLINE.match(line) or JS_SIDE_EFFECT.match(line) or JS_IMPORT_EQUALS.match(line)
        if m:
            scanner.resolve_js(src, m.group(1), idx)
            continue
        if JS_STATIC_START.match(line) and not re.match(r"^\s*(?:import|export)\s*\(", line):
            head = line.strip()
            # `export default`, `export const`, `export function` etc. do not import anything.
            if re.match(r"^export\s+(?:default|const|let|var|function|async|class|enum|interface|type\s+\w|abstract|declare|namespace|module)\b", head):
                continue
            if re.match(r"^import\s+type\s*\{", head) or re.match(r"^import\s*\{", head) or re.match(r"^import\s+\*", head) \
                    or re.match(r"^import\s+\w+\s*,\s*\{?\s*$", head) or re.match(r"^export\s+(?:type\s+)?\{[^}]*$", head) \
                    or re.match(r"^export\s+\*", head) or re.match(r"^import\s+(?:type\s+)?\w+\s*$", head):
                pending_start = idx
                pending_seen = 0


RS_USE = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+(.+)$")
RS_MOD_DECL = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;")
RS_MOD_INLINE = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{")
RS_EXTERN = re.compile(r"^\s*(?:pub\s+)?extern\s+crate\s+([A-Za-z_][A-Za-z0-9_]*)")
RS_PATH_ATTR = re.compile(r"""#\[path\s*=\s*"([^"]+)"\]""")


def _rust_use_paths(body: str) -> list[str]:
    """Expand `a::{b, c::d}` into ['a::b', 'a::c::d']; strip `as x`, `*`, `self`."""
    body = body.strip().rstrip(";").strip()
    body = body.lstrip(":")

    def expand(text: str) -> list[str]:
        text = text.strip()
        if "{" not in text:
            text = re.sub(r"\s+as\s+\w+$", "", text).strip()
            return [text] if text else []
        prefix, rest = text.split("{", 1)
        depth, items, current = 0, [], ""
        for ch in rest:
            if ch == "{":
                depth += 1
            elif ch == "}":
                if depth == 0:
                    break
                depth -= 1
            if ch == "," and depth == 0:
                items.append(current)
                current = ""
            else:
                current += ch
        if current.strip():
            items.append(current)
        out = []
        for item in items:
            for sub in expand(item):
                out.append(prefix.strip() + sub)
        return out

    results = []
    for path in expand(body):
        segs = [s.strip() for s in path.split("::") if s.strip() not in ("", "*")]
        if segs and segs[-1] == "self" and len(segs) > 1:
            segs = segs[:-1]
        if segs:
            results.append("::".join(segs))
    return results


def parse_rust(scanner: Scanner, src: str, lines: list[str], unit: Unit | None) -> None:
    local_mods: set[str] = set()
    for line in lines:
        m = RS_MOD_DECL.match(line) or RS_MOD_INLINE.match(line)
        if m:
            local_mods.add(m.group(1))
    depth_stack: list[int] = []
    brace_depth = 0
    pending: str | None = None
    pending_line = 0
    path_attr: str | None = None
    for idx, line in enumerate(lines, start=1):
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        code = re.sub(r"//.*$", "", line)
        if pending is not None:
            pending += " " + code.strip()
            if ";" in code:
                raw = re.sub(r"\s+", " ", pending.split(";", 1)[0]).strip()
                for path in _rust_use_paths(raw):
                    scanner.resolve_rust(src, path, raw, pending_line, unit, local_mods, len(depth_stack))
                pending = None
            continue
        m = RS_PATH_ATTR.search(code)
        if m:
            path_attr = m.group(1)
        m = RS_MOD_DECL.match(code)
        if m:
            name = m.group(1)
            module = scanner._rust_module(unit, src)
            if path_attr:
                target = posixpath.normpath(posixpath.join(posixpath.dirname(src), path_attr))
                path_attr = None
                if scanner.is_source(target):
                    scanner.add_edge(src, target, "mod %s" % name, idx)
                    continue
            target = scanner._rust_descend(module, [name])
            if target != src:
                scanner.add_edge(src, target, "mod %s" % name, idx)
            else:
                scanner.add_unresolved(src, "mod %s" % name, idx)
            continue
        m = RS_MOD_INLINE.match(code)
        if m:
            depth_stack.append(brace_depth)
        m = RS_EXTERN.match(code)
        if m:
            scanner.resolve_rust(src, m.group(1), "extern crate " + m.group(1), idx, unit, local_mods, len(depth_stack))
        m = RS_USE.match(code)
        if m:
            body = m.group(1)
            if ";" in body:
                raw = body.split(";", 1)[0].strip()
                for path in _rust_use_paths(raw):
                    scanner.resolve_rust(src, path, raw, idx, unit, local_mods, len(depth_stack))
            else:
                pending, pending_line = body, idx
        brace_depth += code.count("{") - code.count("}")
        while depth_stack and brace_depth <= depth_stack[-1]:
            depth_stack.pop()


PY_IMPORT = re.compile(r"^\s*import\s+([A-Za-z_][\w.]*(?:\s+as\s+\w+)?(?:\s*,\s*[A-Za-z_][\w.]*(?:\s+as\s+\w+)?)*)")
PY_FROM = re.compile(r"^\s*from\s+(\.*[A-Za-z_][\w.]*|\.+)\s+import\s+(.*)$")


def parse_python(scanner: Scanner, src: str, lines: list[str], unit: Unit | None) -> None:
    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = PY_FROM.match(line)
        if m:
            module, tail = m.group(1), m.group(2)
            tail = tail.split("#", 1)[0].strip().lstrip("(").rstrip(")").rstrip(",\\")
            names = []
            for item in tail.split(","):
                name = re.split(r"\s+as\s+", item.strip())[0].strip()
                if re.match(r"^\w+$", name):
                    names.append(name)
            scanner.resolve_python(src, module, names, idx, unit)
            continue
        m = PY_IMPORT.match(line)
        if m:
            for item in m.group(1).split(","):
                module = re.split(r"\s+as\s+", item.strip())[0].strip()
                if module:
                    scanner.resolve_python(src, module, [], idx, unit)


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------


TEST_DIRS = {"tests", "test", "__tests__", "spec", "specs", "testing", "fixtures", "e2e", "benches", "benchmarks"}
TEST_BASENAME = re.compile(
    r"(?:^|[._-])(?:test|tests|spec)\.[cm]?[jt]sx?$|^test_.*\.py$|_tests?\.py$|^conftest\.py$|_tests?\.rs$|^tests?\.rs$"
)


def file_role(path: str) -> str:
    """'test' for files that exist to exercise other code, else 'source'."""
    parts = path.split("/")
    if any(part in TEST_DIRS for part in parts[:-1]):
        return "test"
    return "test" if TEST_BASENAME.search(parts[-1]) else "source"

def repository_inventory(tracked, parsed):
    """Filenames are reading leads, never classifications or import evidence."""
    documents, manifests, deployments = [], [], []
    for path in tracked:
        name = path.rsplit("/", 1)[-1].lower()
        if name.endswith((".md", ".rst", ".adoc")) or name.startswith(("readme", "architecture")):
            documents.append(path)
        if name in {"package.json", "cargo.toml", "pyproject.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "gemfile", "composer.json", "pubspec.yaml", "mix.exs", "cmakelists.txt", "package.swift", "project.godot"} or name.endswith((".csproj", ".fsproj", ".sln", ".uproject", ".uplugin")):
            manifests.append(path)
        if name.startswith(("dockerfile", "compose.", "docker-compose.", "serverless.")) or name in {"chart.yaml", "skaffold.yaml", "pulumi.yaml"} or name.endswith((".tf", ".tfvars", ".bicep")) or any(part.lower() in {"deploy", "deployment", "deployments", "k8s", "kubernetes", "terraform", "helm", "infra"} for part in path.split("/")[:-1]):
            deployments.append(path)
    covered = sorted(parsed)
    return {"tracked_paths": sorted(set(tracked)), "documents": documents, "manifests": manifests,
            "deployments": deployments, "import_coverage": {"languages": ["javascript", "typescript", "rust", "python"],
            "parsed_paths": covered, "unparsed_paths": sorted(set(tracked) - set(covered))}}


def scan(repo_root: Path, ref: str = "HEAD", now: str | None = None) -> dict:
    root = Path(repo_root).resolve()
    if not root.is_dir():
        raise ScanError("repo root is not a directory: %s" % root)
    tracked = _tracked_files(root)
    scanner = Scanner(root, tracked)
    scanner.detect_units()

    sha = _git(root, "rev-parse", "--verify", "%s^{commit}" % ref, check=False)
    if sha is None:
        if ref != "HEAD":
            raise ScanError("unknown ref: %s" % ref)
        sha_value = None
    else:
        sha_value = sha.strip()
    branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD", check=False)
    remote = _git(root, "remote", "get-url", "origin", check=False)

    activity, changes = _activity(root, sha_value)
    files: list[dict] = []
    for path in sorted(scanner.source):
        lang = scanner.source[path]
        unit = scanner.unit_for(path)
        try:
            text = (root / path).read_bytes().decode("utf-8", "replace")
        except OSError:
            continue
        lines = text.splitlines()
        files.append({"path": path, "lang": lang, "loc": len(lines), "role": file_role(path), "unit": unit.id if unit else None,
                      "changes": changes.get(path, 0)})
        if lang in ("ts", "js"):
            parse_js(scanner, path, lines)
        elif lang == "rust":
            parse_rust(scanner, path, lines, unit)
        elif lang == "python":
            parse_python(scanner, path, lines, unit)

    contracts = []
    for path in tracked:
        kind = contract_kind(path) if not _is_ignored(path) else None
        if kind:
            owner = scanner.unit_for(path)
            contracts.append({"path": path, "kind": kind, "unit": owner.id if owner else None})
    files_by_unit: dict[str, list[dict]] = {}
    for f in files:
        files_by_unit.setdefault(f["unit"], []).append(f)
    role_by_path = {f["path"]: f["role"] for f in files}
    unit_by_path = {f["path"]: f["unit"] for f in files}
    externals_by_unit: dict[str, dict[str, list[str]]] = {}
    for name, entry in scanner.externals.items():
        for path in entry["files"]:
            bucket = externals_by_unit.setdefault(unit_by_path.get(path), {"source": [], "test": []})
            bucket[role_by_path.get(path, "source")].append(name)
    for u in scanner.units:
        u.hints = unit_hints(scanner, u, files_by_unit.get(u.id, []), externals_by_unit.get(u.id, {}))

    seen_edges: set[tuple] = set()
    edges: list[dict] = []
    for e in sorted(scanner.edges, key=lambda e: (e["from"], e["line"], e["specifier"], e["to"])):
        key = (e["from"], e["to"], e["specifier"], e["line"])
        if key in seen_edges:
            continue
        seen_edges.add(key)
        edges.append(e)
    seen_unres: set[tuple] = set()
    unresolved: list[dict] = []
    for u in sorted(scanner.unresolved, key=lambda u: (u["from"], u["line"], u["specifier"])):
        key = (u["from"], u["specifier"], u["line"])
        if key in seen_unres:
            continue
        seen_unres.add(key)
        unresolved.append(u)
    externals = [
        {"name": name, "count": entry["count"], "files": sorted(entry["files"])[:20]}
        for name, entry in sorted(scanner.externals.items())
    ]
    if now is None:
        now = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "schema": SCHEMA,
        "repo": {
            "root": str(root),
            "remote": remote.strip() if remote else None,
            "ref": ref,
            "sha": sha_value,
            "branch": branch.strip() if branch else None,
            "worktree": worktree_state(root),
        },
        "scanned_at": now,
        "activity": activity,
        "contracts": contracts,
        "inventory": repository_inventory(tracked, [f["path"] for f in files]),
        "units": [u.to_dict() for u in sorted(scanner.units, key=lambda u: u.id)],
        "files": files,
        "edges": edges,
        "externals": externals,
        "unresolved": unresolved,
        "skipped": dict(sorted(scanner.skipped.items())),
    }


def dumps(doc: dict) -> str:
    return json.dumps(doc, sort_keys=True, indent=1, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="codemap scan: units, files, and import edges")
    parser.add_argument("--repo", required=True, help="repository root")
    parser.add_argument("--ref", default="HEAD", help="ref to record (default HEAD)")
    parser.add_argument("--output", help="write JSON here instead of stdout")
    parser.add_argument("--now", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        doc = scan(Path(args.repo), args.ref, now=args.now)
        text = dumps(doc)
        if args.output:
            Path(args.output).write_text(text, encoding="utf-8")
            summary = {
                "status": "ok", "output": args.output, "units": len(doc["units"]),
                "files": len(doc["files"]), "edges": len(doc["edges"]),
                "externals": len(doc["externals"]), "unresolved": len(doc["unresolved"]),
            }
            sys.stdout.write(json.dumps(summary, sort_keys=True) + "\n")
        else:
            sys.stdout.write(text)
        return 0
    except ScanError as exc:
        sys.stderr.write(json.dumps({"status": "error", "error": str(exc)}) + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
