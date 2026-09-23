#!/usr/bin/env python3
"""Derive the mechanical map skeleton (``codemap.skeleton/1``) from a scan.

Components are the scan's units, carrying the scan's manifest ``hints`` (an
absent or partial hints block is filled with neutral defaults). Modules are the
first-level directories under
a unit's source root (``<path>/src`` when that directory holds most of the
unit's files, else the unit path); files directly under the root form
``<unit>/root``,
deeper directories collapse into their first-level ancestor. A component with
more than 16 modules merges its smallest module into the one it shares the most
production imports with until 16 remain (the entry module only as a last resort);
the survivor keeps its name with "+ N more" and lists the absorbed names in
``merged``. A flat source root (6 or more files directly under it holding
at least 40% of the unit's lines, as in a Rust crate of ``step.rs``,
``world.rs``, ...) splits instead: each root file becomes a module named after
its stem, joining the directory of the same name when one exists, while entry
files (``lib``, ``main``, ``mod``, ``index``, ``__init__``) stay in root. A
module whose files are at least 80% tests carries ``test: true``; the root module
and modules split from root files carry ``root_file: true``. Metrics carry
``changes``: the scan's per-file commit counts summed over the node. Every
ordering is deterministic.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path, PurePosixPath
import sys

MODULE_CAP = 16
EXAMPLE_LIMIT = 3
EMPTY_HINTS = {
    "executable": False, "wasm": False, "server_libs": [], "client_libs": [], "desktop": False,
    "test_libs": [], "directory_kind": None, "test_file_share": 0.0,
}
EXTERNAL_LIMIT = 10
SRC_ROOT_SHARE = 0.5
FLAT_ROOT_FILES = 6
FLAT_ROOT_SHARE = 0.4
ENTRY_STEMS = {"lib", "main", "mod", "index", "__init__"}
TEST_MODULE_SHARE = 0.8



def display_name(unit: dict) -> str:
    """The manifest name without a package scope: `@ue-mmo/world-renderer` reads as `world-renderer`."""
    name = unit.get("name") or unit.get("id") or ""
    if name.startswith("@") and "/" in name:
        return name.split("/", 1)[1]
    return name or unit.get("id", "")


def _relative(path: str, base: str) -> str | None:
    if not base or base == ".":
        return path
    prefix = base.rstrip("/") + "/"
    if path.startswith(prefix):
        return path[len(prefix):]
    return None


def _source_root(unit_path: str, files: list[dict]) -> str:
    src = f"{unit_path}/src" if unit_path and unit_path != "." else "src"
    inside = sum(1 for f in files if _relative(f["path"], src) is not None)
    if files and inside > len(files) * SRC_ROOT_SHARE:
        return src
    return unit_path


def _module_dirname(path: str, unit_path: str, source_root: str) -> tuple[str | None, str]:
    """Return (first-level directory or None for root, base the file was classified against)."""
    for base in (source_root, unit_path):
        rel = _relative(path, base)
        if rel is None:
            continue
        parts = PurePosixPath(rel).parts
        if len(parts) == 1:
            return None, base
        return parts[0], base
    return None, unit_path


def _tarjan(nodes: list[str], adjacency: dict[str, set[str]]) -> list[list[str]]:
    index = {}
    lowlink = {}
    stack = []
    on_stack = set()
    result = []
    counter = [0]
    sys.setrecursionlimit(max(sys.getrecursionlimit(), len(nodes) * 2 + 100))

    def strong(v):
        index[v] = lowlink[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on_stack.add(v)
        for w in sorted(adjacency.get(v, ())):
            if w not in index:
                strong(w)
                lowlink[v] = min(lowlink[v], lowlink[w])
            elif w in on_stack:
                lowlink[v] = min(lowlink[v], index[w])
        if lowlink[v] == index[v]:
            component = []
            while True:
                w = stack.pop()
                on_stack.discard(w)
                component.append(w)
                if w == v:
                    break
            if len(component) > 1:
                result.append(sorted(component))

    for node in sorted(nodes):
        if node not in index:
            strong(node)
    return sorted(result)


def _merge_to_cap(groups: dict, edges: list) -> None:
    """Merge the smallest module into the one it shares the most imports with until MODULE_CAP remain.

    Files that import each other belong together whatever the language, so nothing lands in a catch-all
    bucket. The entry module (root) is the last resort: every file hangs off it, so its links say nothing.
    Deterministic: smallest by lines, then by key; ties between neighbours go to the larger, then by key.
    """
    loc = lambda k: sum(f["loc"] for f in groups[k]["files"])
    while len(groups) > MODULE_CAP:
        owner = {f["path"]: k for k, g in groups.items() for f in g["files"]}
        small = min((k for k in groups if k != "root"), key=lambda k: (loc(k), k))
        links = {}
        for a, b in edges:
            ka, kb = owner.get(a), owner.get(b)
            if ka and kb and ka != kb and small in (ka, kb):
                other = kb if ka == small else ka
                links[other] = links.get(other, 0) + 1
        ranked = sorted((k for k in links if k != "root"), key=lambda k: (-links[k], -loc(k), k))
        target = ranked[0] if ranked else ("root" if "root" in groups else min((k for k in groups if k != small), key=lambda k: (-loc(k), k)))
        absorbed = groups.pop(small)
        dest = groups[target]
        dest["files"].extend(absorbed["files"])
        dest["merged"] = sorted(set(dest.get("merged", [])) | {small} | set(absorbed.get("merged", [])))
        dest["root_file"] = bool(dest.get("root_file") or absorbed.get("root_file"))


def _metrics(node_ids, files_of, loc_of, edges, changes_of):
    out = {n: set() for n in node_ids}
    inc = {n: set() for n in node_ids}
    for edge in edges:
        out[edge["from"]].add(edge["to"])
        inc[edge["to"]].add(edge["from"])
    cycles = _tarjan(list(node_ids), out)
    cyclic = {n for cycle in cycles for n in cycle}
    metrics = {}
    for n in node_ids:
        fan_in, fan_out = len(inc[n]), len(out[n])
        total = fan_in + fan_out
        metrics[n] = {
            "files": files_of[n],
            "loc": loc_of[n],
            "fan_in": fan_in,
            "fan_out": fan_out,
            "instability": round(fan_out / total, 3) if total else None,
            "in_cycle": n in cyclic,
            "changes": changes_of[n],
        }
    return metrics, cycles


def _aggregate(file_edges, owner: dict, role_of: dict) -> list[dict]:
    buckets = {}
    for edge in file_edges:
        src, dst = owner.get(edge["from"]), owner.get(edge["to"])
        if src is None or dst is None or src == dst:
            continue
        bucket = buckets.setdefault((src, dst), {"count": 0, "test_count": 0, "examples": [], "test_examples": []})
        example = f"{edge['from']}:{edge.get('line', 0)} → {edge['to']}"
        if role_of.get(edge["from"]) == "test":
            bucket["test_count"] += 1
            bucket["test_examples"].append(example)
        else:
            bucket["count"] += 1
            bucket["examples"].append(example)
    result = []
    for (src, dst), b in sorted(buckets.items()):
        examples = sorted(b["examples"])[:EXAMPLE_LIMIT] or sorted(b["test_examples"])[:EXAMPLE_LIMIT]
        result.append({"from": src, "to": dst, "count": b["count"], "test_count": b["test_count"],
                       "test_only": b["count"] == 0, "examples": examples})
    return result


def skeleton(scan: dict) -> dict:
    units = {u["id"]: u for u in scan.get("units", [])}
    files = sorted(scan.get("files", []), key=lambda f: f["path"])
    known = {f["path"] for f in files}
    by_unit = {}
    for f in files:
        unit = f.get("unit") or PurePosixPath(f["path"]).parts[0]
        if unit not in units:
            units[unit] = {"id": unit, "name": unit, "path": PurePosixPath(f["path"]).parts[0], "kind": "directory"}
        by_unit.setdefault(unit, []).append(f)

    # production imports between files of the same unit, for grouping modules by what they use
    unit_of_path = {f["path"]: (f.get("unit") or PurePosixPath(f["path"]).parts[0]) for f in files}
    test_path = {f["path"] for f in files if f.get("role") == "test"}
    unit_edges = {}
    for e in scan.get("edges", []):
        u = unit_of_path.get(e["from"])
        if u and u == unit_of_path.get(e["to"]) and e["from"] != e["to"] and e["from"] not in test_path:
            unit_edges.setdefault(u, []).append((e["from"], e["to"]))
    modules = []
    module_of = {}
    components = []
    for unit_id in sorted(units):
        unit = units[unit_id]
        unit_files = by_unit.get(unit_id, [])
        unit_path = unit.get("path", "") or ""
        root = _source_root(unit_path, unit_files)
        groups = {}
        for f in unit_files:
            dirname, base = _module_dirname(f["path"], unit_path, root)
            key = "root" if dirname is None else dirname
            group = groups.setdefault(key, {"files": [], "path": root if key == "root" else f"{base}/{dirname}".lstrip("/")})
            group["files"].append(f)
        # A flat root splits into one module per file stem; a stem that names a directory joins it.
        flat = groups.get("root", {"files": []})["files"]
        unit_loc = sum(f["loc"] for f in unit_files) or 1
        if len(flat) >= FLAT_ROOT_FILES and sum(f["loc"] for f in flat) >= unit_loc * FLAT_ROOT_SHARE:
            keep = []
            for f in flat:
                stem = PurePosixPath(f["path"]).name.split(".", 1)[0]
                if stem in ENTRY_STEMS or not stem:
                    keep.append(f)
                    continue
                group = groups.setdefault(stem, {"files": [], "path": f"{groups['root']['path']}/{stem}".lstrip("/")})
                group["files"].append(f)
                group["root_file"] = True
            groups["root"]["files"] = keep
            if not keep:
                groups.pop("root")
        _merge_to_cap(groups, unit_edges.get(unit_id, []))
        module_ids = []
        for key in sorted(groups):
            group = groups[key]
            module_id = f"{unit_id}/{key}"
            module_ids.append(module_id)
            records = sorted(group["files"], key=lambda f: f["path"])
            for f in records:
                module_of[f["path"]] = module_id
            tests = sum(1 for f in records if f.get("role") == "test")
            modules.append({
                "id": module_id,
                "component": unit_id,
                "name": (display_name(unit) if key == "root" else key) + (f" + {len(group['merged'])} more" if group.get("merged") else ""),
                "merged": sorted(group.get("merged", [])),
                "path": group["path"] or unit_path,
                "test": bool(records) and tests >= len(records) * TEST_MODULE_SHARE,
                "root_file": key == "root" or bool(group.get("root_file")),
                "files": [{"path": f["path"], "loc": int(f.get("loc", 0)), "exports": []} for f in records],
            })
        components.append({
            "contracts": [{"path": c["path"], "kind": c["kind"]} for c in scan.get("contracts", []) if c.get("unit") == unit_id],
            "id": unit_id,
            "name": display_name(unit),
            "path": unit_path,
            "kind": unit.get("kind", "directory"),
            "description": unit.get("description") or "",
            "readme": unit.get("readme") or None,
            "hints": {**EMPTY_HINTS, **(unit.get("hints") or {})},
            "modules": module_ids,
        })

    modules.sort(key=lambda m: m["id"])
    component_of = {path: module_of[path].split("/", 1)[0] for path in module_of}
    file_edges = [e for e in scan.get("edges", []) if e["from"] in known and e["to"] in known]
    file_edges.sort(key=lambda e: (e["from"], e.get("line", 0), e["to"]))
    role_of = {f["path"]: f.get("role", "source") for f in files}
    changes_of = {f["path"]: int(f.get("changes", 0)) for f in files}
    module_edges = _aggregate(file_edges, module_of, role_of)
    component_edges = _aggregate(file_edges, component_of, role_of)
    # Metrics and cycles describe production structure; test-only edges are kept but do not count.
    production_module_edges = [e for e in module_edges if not e["test_only"]]
    production_component_edges = [e for e in component_edges if not e["test_only"]]

    module_ids = [m["id"] for m in modules]
    module_metrics, module_cycles = _metrics(
        module_ids,
        {m["id"]: len(m["files"]) for m in modules},
        {m["id"]: sum(f["loc"] for f in m["files"]) for m in modules},
        production_module_edges,
        {m["id"]: sum(changes_of.get(f["path"], 0) for f in m["files"]) for m in modules},
    )
    component_ids = [c["id"] for c in components]
    component_metrics, component_cycles = _metrics(
        component_ids,
        {c["id"]: sum(len(m["files"]) for m in modules if m["component"] == c["id"]) for c in components},
        {c["id"]: sum(f["loc"] for m in modules if m["component"] == c["id"] for f in m["files"]) for c in components},
        production_component_edges,
        {c["id"]: sum(changes_of.get(f["path"], 0) for m in modules if m["component"] == c["id"] for f in m["files"]) for c in components},
    )
    for m in modules:
        m["metrics"] = module_metrics[m["id"]]
    for c in components:
        c["metrics"] = component_metrics[c["id"]]

    externals = {}
    for ext in scan.get("externals", []):
        per_component = {}
        for path in ext.get("files", []):
            owner = component_of.get(path)
            if owner:
                per_component[owner] = per_component.get(owner, 0) + 1
        for owner, count in per_component.items():
            externals.setdefault(owner, []).append({"name": ext["name"], "count": count})
    externals = {
        owner: sorted(items, key=lambda i: (-i["count"], i["name"]))[:EXTERNAL_LIMIT]
        for owner, items in sorted(externals.items())
    }

    return {
        "schema": "codemap.skeleton/1",
        "meta": {"repo": scan.get("repo", {}), "scanned_at": scan.get("scanned_at", ""), "activity": scan.get("activity"),
                 "unowned_contracts": [{"path": c["path"], "kind": c["kind"]} for c in scan.get("contracts", []) if not c.get("unit") or c["unit"] not in units]},
        "components": components,
        "modules": modules,
        "edges": {"components": component_edges, "modules": module_edges},
        "externals": externals,
        "cycles": {"components": component_cycles, "modules": module_cycles},
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Derive codemap.skeleton/1 from a scan.json.")
    parser.add_argument("--scan", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    with open(args.scan, encoding="utf-8") as handle:
        scan = json.load(handle)
    result = skeleton(scan)
    Path(args.output).write_text(json.dumps(result, sort_keys=True, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": "ok", "components": len(result["components"]), "modules": len(result["modules"])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
