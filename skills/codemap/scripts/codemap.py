#!/usr/bin/env python3
"""codemap CLI: scan -> skeleton -> (enrich) -> decide -> build, all inside the map store.

Every command prints one JSON summary on stdout. Failures print
``{"status": "error", "error": "..."}`` on stderr and exit 1.
"""

from __future__ import annotations

import argparse
import inspect
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build as build_mod  # noqa: E402
import skeleton as skeleton_mod  # noqa: E402
import store  # noqa: E402

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL_DIR / "assets" / "viewer.html"
ARTIFACTS = ("scan", "skeleton", "draft", "decisions", "map", "html")


class Failure(Exception):
    """A user-facing error; the message is the whole diagnostic."""


def _import(name: str):
    try:
        return __import__(name)
    except ImportError as exc:
        raise Failure(f"{name}.py is not available beside codemap.py: {exc}") from None


def repo_root(value: str) -> Path:
    root = Path(value).expanduser().resolve()
    if not root.is_dir():
        raise Failure(f"repository root {root} is not a directory")
    return root


def read(repo: Path, name: str):
    path = store.paths(repo)[name]
    if not path.exists():
        raise Failure(f"{name}.json is missing from {path.parent}; run `codemap.py {'scan' if name == 'scan' else name} --repo {repo}` first")
    return store.read_json(path)


def head_sha(repo: Path):
    try:
        result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(repo), capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# --- draft -----------------------------------------------------------------

FLOW_LABEL_MAX = 32

SHAPES = {
    "actor": {"id": "", "name": "", "role": "", "uses": ["<runnable component id or area id, at most two>"]},
    "external": {"id": "", "name": "", "role": "", "kind": "datastore|service|runtime|devtool", "used_by": ["<component id>"]},
    "flow": {"from": "<runnable, actor, or external id>", "to": "<runnable, actor, or external id>",
             "label": "<mechanism in at most 32 characters, e.g. WebSocket>",
             "detail": "<what travels, e.g. intents up, filtered world deltas down>", "kind": "network|file|process"},
    "area": {"id": "", "name": "", "definition": "", "components": ["<product component ids expected here>"]},
}


MODULE_SUMMARY_SHARE = 0.1


def summarized_modules(skeleton: dict) -> list[dict]:
    """Modules big enough to need a one-line summary: a tenth or more of a multi-module component's lines."""
    modules = skeleton.get("modules", [])
    by_component = {}
    for m in modules:
        by_component.setdefault(m["component"], []).append(m)
    out = []
    for mods in by_component.values():
        total = sum((m.get("metrics") or {}).get("loc", 0) for m in mods)
        if len(mods) > 1:
            out += [m for m in mods if (m.get("metrics") or {}).get("loc", 0) >= total * MODULE_SUMMARY_SHARE]
    return sorted(out, key=lambda m: m["id"])


def draft_template(skeleton: dict) -> dict:
    return {
        "schema": "codemap.draft/1",
        "system": {"name": "", "summary": "", "purpose": "", "actors": [], "externals": [], "flows": []},
        "areas": [],
        "components": {
            c["id"]: {"summary": "", "responsibility": "", "runs": "", "why": "", "entry_points": [], "evidence": [],
                      "mixed_jobs": []}
            for c in skeleton.get("components", [])
        },
        "edge_reasons": {
            build_mod.edge_key(e["from"], e["to"]): "" for e in skeleton.get("edges", {}).get("components", [])
        },
        "module_names": {},
        "module_summaries": {m["id"]: "" for m in summarized_modules(skeleton)},
    }


def draft_gaps(draft: dict, skeleton: dict) -> list[str]:
    gaps = []
    system = draft.get("system") or {}
    for field in ("name", "summary", "purpose"):
        if not system.get(field):
            gaps.append(f"system.{field}")
    for i, actor in enumerate(system.get("actors") or []):
        if isinstance(actor, dict) and not actor.get("uses"):
            gaps.append(f"system.actors[{actor.get('id') or i}].uses")
    for i, external in enumerate(system.get("externals") or []):
        if isinstance(external, dict) and not external.get("kind"):
            gaps.append(f"system.externals[{external.get('id') or i}].kind")
    if not system.get("flows"):
        gaps.append("system.flows")
    for flow in system.get("flows") or []:
        # the label is drawn on the arrow in full; what travels belongs in detail
        if isinstance(flow, dict) and len(str(flow.get("label", ""))) > FLOW_LABEL_MAX:
            gaps.append(f"system.flows[{flow.get('from')}->{flow.get('to')}].label longer than {FLOW_LABEL_MAX} characters: "
                        "keep the mechanism, move the rest to detail")
    if not draft.get("areas"):
        gaps.append("areas")
    components = draft.get("components") or {}
    for comp in skeleton.get("components", []):
        card = components.get(comp["id"]) or {}
        for field in ("summary", "responsibility", "runs", "why"):
            if not card.get(field):
                gaps.append(f"components.{comp['id']}.{field}")
        gaps.extend(build_mod.mixed_jobs_errors(skeleton, comp["id"], card.get("mixed_jobs")))
    summaries = draft.get("module_summaries") or {}
    for module in summarized_modules(skeleton):
        if not summaries.get(module["id"]):
            gaps.append(f"module_summaries.{module['id']}")
    reasons = draft.get("edge_reasons") or {}
    for edge in skeleton.get("edges", {}).get("components", []):
        key = build_mod.edge_key(edge["from"], edge["to"])
        if not reasons.get(key):
            gaps.append(f"edge_reasons.{key}")
    return gaps


def merge_draft(draft: dict, skeleton: dict) -> dict:
    """Add template entries for new components and edges, drop entries for vanished ones, keep every written field."""
    if "domain_partitions" in draft:
        raise Failure("draft.json uses the retired domain_partitions block; rewrite it as areas: "
                      "[{id, name, definition, components}] (3-7 areas, each holding at least one runnable) and rerun")
    template = draft_template(skeleton)
    draft.setdefault("schema", template["schema"])
    system = draft.setdefault("system", template["system"])
    for key, empty in template["system"].items():
        system.setdefault(key, empty)
    draft.setdefault("areas", [])
    draft.setdefault("module_names", {})
    module_summaries = draft.setdefault("module_summaries", {})
    for mid in template["module_summaries"]:
        module_summaries.setdefault(mid, "")
    for mid in [m for m in module_summaries if m not in {x["id"] for x in skeleton.get("modules", [])}]:
        del module_summaries[mid]  # the module vanished
    components = draft.setdefault("components", {})
    added = sorted(cid for cid in template["components"] if cid not in components)
    removed = sorted(cid for cid in components if cid not in template["components"])
    for cid in added:
        components[cid] = template["components"][cid]
    for cid, card in components.items():
        for key, empty in template["components"].get(cid, {}).items():
            card.setdefault(key, empty)  # fields added to the card shape since the draft was written
    for cid in removed:
        del components[cid]
    reasons = draft.setdefault("edge_reasons", {})
    added_edges = sorted(key for key in template["edge_reasons"] if key not in reasons)
    removed_edges = sorted(key for key in reasons if key not in template["edge_reasons"])
    for key in added_edges:
        reasons[key] = ""
    for key in removed_edges:
        del reasons[key]
    return {"components_added": added, "components_removed": removed,
            "edges_added": added_edges, "edges_removed": removed_edges}


def unit_edges(scan: dict) -> set:
    owner = {f["path"]: f.get("unit") for f in scan.get("files", [])}
    return {(owner.get(e["from"]), owner.get(e["to"])) for e in scan.get("edges", [])
            if owner.get(e["from"]) and owner.get(e["to"]) and owner.get(e["from"]) != owner.get(e["to"])}


def scan_changes(previous: dict, current: dict) -> dict:
    """Per-component change summary between two scans: the state Jev sees for the `holds` question."""
    before = {f["path"]: f for f in previous.get("files", [])}
    after = {f["path"]: f for f in current.get("files", [])}
    units_before = {u["id"] for u in previous.get("units", [])} | {f.get("unit") for f in before.values()}
    units_after = {u["id"] for u in current.get("units", [])} | {f.get("unit") for f in after.values()}
    per = {}

    def bucket(unit):
        return per.setdefault(unit, {"files_added": [], "files_removed": [], "files_changed": [],
                                     "dependencies_added": [], "dependencies_removed": []})

    for path in sorted(set(before) | set(after)):
        old, new = before.get(path), after.get(path)
        if old and not new:
            bucket(old.get("unit")).setdefault("files_removed", []).append(path)
        elif new and not old:
            bucket(new.get("unit")).setdefault("files_added", []).append(path)
        elif old.get("unit") != new.get("unit"):
            bucket(old.get("unit"))["files_removed"].append(path)
            bucket(new.get("unit"))["files_added"].append(path)
        elif old.get("loc") != new.get("loc"):
            bucket(new.get("unit"))["files_changed"].append(path)
    edges_before, edges_after = unit_edges(previous), unit_edges(current)
    for src, dst in sorted(edges_after - edges_before):
        bucket(src)["dependencies_added"].append(dst)
    for src, dst in sorted(edges_before - edges_after):
        if src in units_after:
            bucket(src)["dependencies_removed"].append(dst)
    per.pop(None, None)
    components = {unit: summary for unit, summary in sorted(per.items())
                  if unit in units_after and unit in units_before and any(summary.values())}
    return {
        "schema": "codemap.changes/1",
        "previous_sha": (previous.get("repo") or {}).get("sha"),
        "current_sha": (current.get("repo") or {}).get("sha"),
        "components": components,
        "new_components": sorted(units_after - units_before - {None}),
        "removed_components": sorted(units_before - units_after - {None}),
    }


# --- commands --------------------------------------------------------------

def cmd_path(args) -> dict:
    repo = repo_root(args.repo)
    return {"status": "ok", "repo": str(repo), "store": str(store.store_dir(repo))}


def cmd_status(args) -> dict:
    repo = repo_root(args.repo)
    paths = store.paths(repo)
    artifacts = {}
    for name in ARTIFACTS:
        path = paths[name]
        if path.exists():
            info = path.stat()
            artifacts[name] = {"path": str(path), "exists": True, "modified": iso(info.st_mtime), "bytes": info.st_size}
        else:
            artifacts[name] = {"path": str(path), "exists": False}
    scan_sha = map_sha = None
    if artifacts["scan"]["exists"]:
        scan_sha = (store.read_json(paths["scan"]).get("repo") or {}).get("sha")
    if artifacts["map"]["exists"]:
        map_sha = ((store.read_json(paths["map"]).get("meta") or {}).get("repo") or {}).get("sha")
    head = head_sha(repo)
    snapshots = sorted(p.name for p in paths["snapshots"].iterdir() if p.is_dir()) if paths["snapshots"].exists() else []
    try:
        jev_client = __import__("jev_client")
        jev_client.load_key()
        jev = {"ready": True, "source": jev_client.key_source() if hasattr(jev_client, "key_source") else None}
    except ImportError:
        jev = {"ready": False, "error": "jev_client.py is not available beside codemap.py"}
    except Exception as exc:  # the client's own diagnostics carry no secrets
        jev = {"ready": False, "error": str(exc)}
    return {
        "status": "ok",
        "repo": str(repo),
        "store": str(store.store_dir(repo)),
        "artifacts": artifacts,
        "head": head,
        "scan_sha": scan_sha,
        "map_sha": map_sha,
        "stale": bool(map_sha and head and map_sha != head),
        "snapshots": snapshots,
        "jev": jev,
    }


def cmd_scan(args) -> dict:
    repo = repo_root(args.repo)
    scan_mod = _import("scan")
    ref = getattr(args, "ref", None) or "HEAD"
    try:
        result = scan_mod.scan(str(repo), ref)
    except Exception as exc:
        store.log(repo, "scan", "error", ref=ref, error=str(exc))
        raise Failure(f"scan failed: {exc}") from None
    path = store.write_json(store.paths(repo)["scan"], result)
    sha = (result.get("repo") or {}).get("sha")
    summary = {
        "status": "ok",
        "scan": str(path),
        "ref": ref,
        "sha": sha,
        "units": len(result.get("units", [])),
        "files": len(result.get("files", [])),
        "edges": len(result.get("edges", [])),
        "externals": len(result.get("externals", [])),
        "unresolved": len(result.get("unresolved", [])),
    }
    store.log(repo, "scan", "ok", ref=ref, sha=sha, files=summary["files"])
    return summary


def cmd_skeleton(args) -> dict:
    repo = repo_root(args.repo)
    scan = read(repo, "scan")
    result = skeleton_mod.skeleton(scan)
    path = store.write_json(store.paths(repo)["skeleton"], result)
    sha = (scan.get("repo") or {}).get("sha")
    summary = {
        "status": "ok",
        "skeleton": str(path),
        "sha": sha,
        "components": len(result["components"]),
        "modules": len(result["modules"]),
        "component_edges": len(result["edges"]["components"]),
        "module_edges": len(result["edges"]["modules"]),
        "cycles": {level: len(items) for level, items in result["cycles"].items()},
    }
    store.log(repo, "skeleton", "ok", sha=sha, components=summary["components"], modules=summary["modules"])
    return summary


def cmd_draft_template(args) -> dict:
    repo = repo_root(args.repo)
    skeleton = read(repo, "skeleton")
    path = store.paths(repo)["draft"]
    if path.exists():
        draft = store.read_json(path)
        merged = merge_draft(draft, skeleton)
        if any(merged.values()):
            store.write_json(path, draft)
            store.log(repo, "draft-template", "merged", **{k: len(v) for k, v in merged.items()})
        gaps = draft_gaps(draft, skeleton)
        return {"status": "ok", "draft": str(path), "created": False, "complete": not gaps, "gaps": gaps, "merged": merged, "shapes": SHAPES}
    template = draft_template(skeleton)
    store.write_json(path, template)
    store.log(repo, "draft-template", "ok", components=len(template["components"]))
    return {"status": "ok", "draft": str(path), "created": True, "complete": False, "gaps": draft_gaps(template, skeleton), "shapes": SHAPES}


def cmd_decide(args) -> dict:
    repo = repo_root(args.repo)
    decide_mod = _import("decide")
    skeleton = read(repo, "skeleton")
    draft = read(repo, "draft")
    paths = store.paths(repo)
    cache = store.read_json(paths["decisions"]) if paths["decisions"].exists() else {}
    kwargs = {}
    pending = store.read_json(paths["changes"]) if paths["changes"].exists() else None
    if pending and pending.get("current_sha") == (skeleton.get("meta", {}).get("repo") or {}).get("sha") and pending.get("components"):
        kwargs["changes"] = pending["components"]
    if getattr(args, "require_zdr", False):
        try:
            accepts = "require_zdr" in inspect.signature(decide_mod.decide).parameters
        except (TypeError, ValueError):
            accepts = False
        if not accepts:
            raise Failure("this decide.py does not support --require-zdr")
        kwargs["require_zdr"] = True
    try:
        decisions = decide_mod.decide(skeleton, draft, cache, **kwargs)
    except Exception as exc:
        store.log(repo, "decide", "error", error=str(exc))
        interrupted = getattr(decide_mod, "Interrupted", None)
        if interrupted is not None and isinstance(exc, interrupted):
            store.write_json(paths["decisions"], decide_mod.partial_cache(exc))
            raise Failure(f"decide failed: {exc} Progress was saved; rerun decide to continue from the cache.") from None
        raise Failure(f"decide failed: {exc}") from None
    path = store.write_json(paths["decisions"], decisions)
    if "changes" in kwargs:
        paths["changes"].unlink(missing_ok=True)
    index = build_mod.index_decisions(decisions)
    resolution = decisions.get("resolution") if isinstance(decisions, dict) else None
    role_applies = lambda node: not isinstance(resolution, dict) or (resolution.get(node) or {}).get("role_applies", True)
    unresolved = sorted({
        node for question in build_mod.ATTRIBUTES for node, entry in index[question].items()
        if entry["status"] == "unresolved" and (question != "role" or role_applies(node))
    })
    values = lambda kind: sorted(e["value"] or "unresolved" for e in index[kind].values())
    findings = {}
    for (_src, _dst, check), verdict in sorted(index["checks"].items()):
        if not verdict["accepted"]:
            findings[check] = findings.get(check, 0) + 1
    for (check, _nodes), verdict in sorted(index["quality"].items()):
        if not verdict["accepted"]:
            findings[check] = findings.get(check, 0) + 1
    summary = {
        "status": "ok",
        "decisions": str(path),
        "count": len(build_mod._records(decisions)),
        "areas": {v: values("area").count(v) for v in sorted(set(values("area")))},
        "runtimes": {v: values("runtime").count(v) for v in sorted(set(values("runtime")))},
        "natures": {v: values("nature").count(v) for v in sorted(set(values("nature")))},
        "findings": findings,
        "unresolved": unresolved,
    }
    # what Jev still doubts, each with the two options the next evidence pass must separate
    inner = decisions.get("summary") if isinstance(decisions, dict) else None
    for key in ("calls_made", "calls_cached", "unresolved_nodes", "uncertain_nodes", "provider_failures"):
        if isinstance(inner, dict) and key in inner:
            summary[key] = inner[key]
    store.log(repo, "decide", "ok", count=summary["count"], unresolved=len(unresolved))
    return summary


def open_in_browser(path: Path) -> bool:
    for opener in ("open", "xdg-open"):
        executable = shutil.which(opener)
        if executable:
            subprocess.Popen([executable, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
    return False


def cmd_build(args) -> dict:
    repo = repo_root(args.repo)
    paths = store.paths(repo)
    skeleton = read(repo, "skeleton")
    draft = read(repo, "draft")
    decisions = read(repo, "decisions")
    if decisions.get("partial"):
        raise Failure("decisions.json is a partial cache from an interrupted decide run; rerun decide before build")
    template_path = Path(getattr(args, "template", None) or TEMPLATE)
    if not template_path.exists():
        raise Failure(f"viewer template is missing: {template_path}")
    try:
        map_obj = build_mod.build(skeleton, draft, decisions)
    except build_mod.BuildError as exc:
        store.log(repo, "build", "error", error=str(exc))
        raise Failure(str(exc)) from None
    errors = build_mod.validate(map_obj)
    sha = (map_obj["meta"].get("repo") or {}).get("sha")
    if errors:
        store.log(repo, "build", "invalid", sha=sha, errors=len(errors))
        raise Failure({"message": "map validation failed", "errors": errors})
    html = build_mod.render(map_obj, template_path.read_text(encoding="utf-8"))
    store.write_json(paths["map"], map_obj)
    store.write_text(paths["html"], html)
    snap = store.snapshot(repo, sha, map_obj) if sha else {"status": "skipped", "path": None}
    summary = {
        "status": "ok",
        "map": str(paths["map"]),
        "html": str(paths["html"]),
        "snapshot": snap,
        "sha": sha,
        "areas": len([a for a in map_obj["areas"] if a["id"] not in build_mod.IMPLICIT_AREAS]),
        "runnables": [c["id"] for c in map_obj["components"] if c["runnable"]],
        "flows": len(map_obj["flows"]),
        "components": len(map_obj["components"]),
        "modules": len(map_obj["modules"]),
        "runtimes": build_mod.count_by([c for c in map_obj["components"] if c["nature"] == "product"], "runtime"),
        "natures": build_mod.count_by(map_obj["components"], "nature"),
        "health": build_mod.health_summary(map_obj),
        "contradictions": build_mod.contradictions(map_obj),
        "unresolved": [u["component"] for u in map_obj["unresolved"]],
        "opened": False,
    }
    if getattr(args, "open", False):
        summary["opened"] = open_in_browser(paths["html"])
    store.log(repo, "build", "ok", sha=sha, snapshot=snap["status"], findings=summary["health"]["findings"], unresolved=len(map_obj["unresolved"]))
    return summary


def cmd_all(args) -> dict:
    repo = repo_root(args.repo)
    paths = store.paths(repo)
    if not paths["draft"].exists():
        raise Failure("draft.json is missing: run `codemap.py scan`, `skeleton`, then `draft-template`, fill it in, and run `all` again")
    steps = [{"command": "scan", **cmd_scan(args)}, {"command": "skeleton", **cmd_skeleton(args)}]
    gaps = draft_gaps(store.read_json(paths["draft"]), store.read_json(paths["skeleton"]))
    if gaps:
        raise Failure({"message": "draft.json has empty required fields; fill them and run `all` again", "gaps": gaps})
    steps.append({"command": "decide", **cmd_decide(args)})
    built = cmd_build(args)
    steps.append({"command": "build", **built})
    return {"status": "ok", "steps": steps, "map": built["map"], "html": built["html"]}


def cmd_update(args) -> dict:
    """Re-scan an existing map: record what changed per component, merge the draft, and decide when nothing is missing."""
    repo = repo_root(args.repo)
    paths = store.paths(repo)
    for name in ("scan", "draft", "decisions", "map"):
        if not paths[name].exists():
            raise Failure(f"{name}.json is missing: build the first map with scan, skeleton, draft-template, decide, and build")
    previous = store.read_json(paths["scan"])
    steps = [{"command": "scan", **cmd_scan(args)}, {"command": "skeleton", **cmd_skeleton(args)}]
    current = store.read_json(paths["scan"])
    changes = scan_changes(previous, current)
    store.write_json(paths["changes"], changes)
    skeleton = store.read_json(paths["skeleton"])
    draft = store.read_json(paths["draft"])
    merged = merge_draft(draft, skeleton)
    store.write_json(paths["draft"], draft)
    gaps = draft_gaps(draft, skeleton)
    summary = {
        "status": "ok",
        "steps": steps,
        "previous_sha": changes["previous_sha"],
        "current_sha": changes["current_sha"],
        "changed_components": sorted(changes["components"]),
        "new_components": changes["new_components"],
        "removed_components": changes["removed_components"],
        "draft": merged,
        "gaps": gaps,
        "changes": str(paths["changes"]),
    }
    store.log(repo, "update", "ok", changed=len(changes["components"]), new=len(changes["new_components"]),
              removed=len(changes["removed_components"]), gaps=len(gaps))
    if gaps:
        summary["next"] = "fill the listed draft fields, then run decide and build"
        return summary
    summary["steps"].append({"command": "decide", **cmd_decide(args)})
    summary["next"] = "run build"
    return summary


COMMANDS = {
    "path": cmd_path,
    "status": cmd_status,
    "scan": cmd_scan,
    "skeleton": cmd_skeleton,
    "draft-template": cmd_draft_template,
    "decide": cmd_decide,
    "build": cmd_build,
    "all": cmd_all,
    "update": cmd_update,
}


def parser() -> argparse.ArgumentParser:
    top = argparse.ArgumentParser(prog="codemap.py", description=__doc__.splitlines()[0])
    subparsers = top.add_subparsers(dest="command", required=True)
    for name in COMMANDS:
        sub = subparsers.add_parser(name)
        sub.add_argument("--repo", default=".", help="repository root (default: current directory)")
        if name in ("scan", "all", "update"):
            sub.add_argument("--ref", default="HEAD")
        if name in ("decide", "all", "update"):
            sub.add_argument("--require-zdr", action="store_true", dest="require_zdr")
        if name in ("build", "all"):
            sub.add_argument("--open", action="store_true")
            sub.add_argument("--template", help=argparse.SUPPRESS)
    return top


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        summary = COMMANDS[args.command](args)
    except Failure as exc:
        detail = exc.args[0] if exc.args else "unknown error"
        payload = {"status": "error", "error": detail["message"], **{k: v for k, v in detail.items() if k != "message"}} if isinstance(detail, dict) else {"status": "error", "error": str(detail)}
        print(json.dumps(payload, sort_keys=True), file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError) as exc:
        print(json.dumps({"status": "error", "error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        return 1
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
