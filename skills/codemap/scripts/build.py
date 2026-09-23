#!/usr/bin/env python3
"""Merge skeleton, draft, and decisions into ``codemap.map/1``; validate; render.

Inputs
------
skeleton   ``codemap.skeleton/1`` from skeleton.py.
draft      the agent's ``draft.json``: ``system`` {name, purpose, actors
           [{id, name, role, uses}], externals [{id, name, role, kind, used_by}],
           flows [{from, to, label, kind}]}, ``areas`` [{id, name, definition,
           components: [ids]}], ``components`` {id: {responsibility, why,
           entry_points, evidence}}, ``edge_reasons`` {"from->to": reason},
           optional ``module_names`` {id: name} and ``module_summaries`` (legacy ``module_responsibilities``)
           {id: text}.
decisions  ``decisions.json`` from decide.py: per-component
           ``resolution`` {id: {area, runtime, nature, role}} entries of the
           form {value, status: accepted|uncertain|unresolved, confidence, reason},
           ``edges`` {key: {from, to, check, accepted, flag, probability}},
           ``model``, ``instructions_version``. A bare list of raw ``records``
           (question, node or from/to, answer, confidence) is accepted as a
           fallback and resolved with the same thresholds.

Thresholds follow the spec: confidence >= 0.6 accepted, 0.4-0.6 accepted and
flagged ``uncertain``, below 0.4 / ``abstain`` / ``new_area`` / missing leaves
the node unresolved. An area answer of ``build_verify`` lands the component in
the implicit ``build-verify`` area; an unresolved area lands it in ``unsorted``.
A component is ``runnable`` when it is product code with an executable hint or
a ``surface`` role in a ``client``, ``server``, or ``cli`` runtime. A resolved answer the scan evidence argues against (support
code imported by product code; a client/server runtime backed only by the other
family's libraries) keeps its value and is flagged ``contradicts-evidence``.
An unresolved runtime renders as ``none``, an unresolved
nature as ``product``, and an unresolved role of a product component as
``core``, each flagged; non-product components carry role ``none``. Health
checks run over production edges whose endpoints have a
resolved value for the attribute the check compares. ``built_at`` defaults to
the scan time so two builds of the same inputs are byte-identical.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

import project_types
import decide as decisions_mod

SKILL_VERSION = "1.0.0"
DEFAULT_MODEL = "typesafe-ai/jev"
RUNTIMES = ("client", "shared", "server", "cli", "build", "none")
NATURES = ("product", "tooling", "test", "content", "docs", "experiment")
ROLES = ("surface", "adapter", "core", "kernel")
SUPPORT_NATURES = ("tooling", "test", "experiment")
FALLBACKS = {"runtime": "none", "nature": "product", "role": "core"}
ATTRIBUTES = ("area", "runtime", "nature", "role")
CHECKS = ("cycle", "core-uses-adapter", "crosses-the-wire", "product-uses-support",
          "mixed-responsibility", "upward-dependency", "stability-inversion", "hub-coupling")
ROLE_DEPTH = {"kernel": 0, "core": 1, "adapter": 2, "surface": 3}
HUB_MIN_NEIGHBORS = 3
MEANINGS = {
    "cycle": "These components import each other, directly or through others, so neither can change alone.",
    "core-uses-adapter": "A core component imports an adapter, so its rules are tied to one storage, transport, or engine.",
    "crosses-the-wire": "Client code imports server code (or the reverse) directly instead of a shared contract.",
    "product-uses-support": "Product code imports tooling, test, or experiment code, which can ship or break the build.",
    "mixed-responsibility": "This component owns two jobs that may need to change independently.",
    "upward-dependency": "A lower layer imports a higher layer, tying shared or inner code to a caller or delivery surface.",
    "stability-inversion": "A structurally stable component imports one that is less stable, increasing the impact of a change.",
    "hub-coupling": "This component both serves and imports many others, making it a broad change boundary.",
}
MODULE_CYCLE_MEANING = "These modules import each other, so neither can change alone."
HEADLINES = {
    "cycle": "Parts depend on each other",
    "core-uses-adapter": "Core rules import an I/O detail",
    "crosses-the-wire": "Client and server are directly coupled",
    "product-uses-support": "Product code imports support code",
    "mixed-responsibility": "One component owns two jobs",
    "upward-dependency": "A lower layer imports a higher layer",
    "stability-inversion": "A stable part imports a less stable part",
    "hub-coupling": "One part connects too many others",
}
SUGGESTIONS = {
    "cycle": "Move the shared contract into one lower component or reverse one import.",
    "core-uses-adapter": "Put a port near the core rules and make the adapter depend on it.",
    "crosses-the-wire": "Move the shared interface into a contract component used by both sides.",
    "product-uses-support": "Move the imported behavior into product code or keep it in the build path.",
    "mixed-responsibility": None,  # filled from the two named jobs
    "upward-dependency": "Move the shared contract inward or reverse the dependency at this boundary.",
    "stability-inversion": None,  # the right change depends on the intended boundary
    "hub-coupling": "Split unrelated responsibilities behind smaller interfaces.",
}
CHECK_QUESTIONS = {"core_uses_adapter": "core-uses-adapter", "crosses_the_wire": "crosses-the-wire"}
EVIDENCE_LIMIT = 3
UNSORTED = "unsorted"
BUILD_VERIFY = "build-verify"
BUILD_VERIFY_ANSWER = "build_verify"
BUILD_VERIFY_DEFINITION = "Supporting code that serves the repository itself rather than one area: build, gates, dev stack, repo-wide tests, docs."
UNSORTED_DEFINITION = "Parts the map could not place in an area yet; each card says what was left open."
IMPLICIT_AREAS = (BUILD_VERIFY, UNSORTED)
HUE_START = 210
ACCEPT = 0.6
UNCERTAIN = 0.4
NON_ANSWERS = {None, "", "abstain", "new_area"}
EXTERNAL_KINDS = ("datastore", "service", "runtime", "devtool")
FLOW_KINDS = ("network", "file", "process")
RUNNABLE_RUNTIMES = ("client", "server", "cli")
BOUNDS = {"actors": 6, "externals": 8, "uses": 2, "areas": (1, 7), "components_per_area": 12, "modules_per_component": 16}
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "references" / "map-schema.json"
PLACEHOLDER = "/*__CODEMAP_JSON__*/"


class BuildError(Exception):
    """The inputs cannot be assembled into a map."""


def edge_key(src: str, dst: str) -> str:
    return f"{src}->{dst}"


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-") or "item"


def upward_candidate(source_role: str | None, target_role: str | None) -> bool:
    return (source_role in ROLE_DEPTH and target_role in ROLE_DEPTH
            and ROLE_DEPTH[source_role] < ROLE_DEPTH[target_role]
            and (source_role, target_role) != ("core", "adapter"))


def stability_candidate(source_metrics: dict, target_metrics: dict) -> bool:
    source_i, target_i = source_metrics.get("instability"), target_metrics.get("instability")
    return (isinstance(source_i, (int, float)) and not isinstance(source_i, bool)
            and isinstance(target_i, (int, float)) and not isinstance(target_i, bool)
            and source_i < target_i)


def hub_candidate(metrics: dict) -> bool:
    fan_in, fan_out = metrics.get("fan_in"), metrics.get("fan_out")
    return (isinstance(fan_in, int) and not isinstance(fan_in, bool) and fan_in >= HUB_MIN_NEIGHBORS
            and isinstance(fan_out, int) and not isinstance(fan_out, bool) and fan_out >= HUB_MIN_NEIGHBORS)


def mixed_jobs_errors(skeleton: dict, component_id: str, jobs) -> list[str]:
    """Validate optional, path-backed draft notes before a mixed-responsibility decision."""
    if jobs is None or jobs == []:
        return []
    prefix = f"components.{component_id}.mixed_jobs"
    if not isinstance(jobs, list) or len(jobs) != 2:
        return [f"{prefix}: expected exactly two jobs"]
    module_ids = next((set(c.get("modules") or []) for c in skeleton.get("components", []) if c.get("id") == component_id), set())
    allowed = {p for m in skeleton.get("modules", []) if m.get("id") in module_ids
               for p in [m.get("path"), *(f.get("path") for f in m.get("files", []) if isinstance(f, dict))] if isinstance(p, str)}
    errors, names, path_sets = [], [], []
    for i, job in enumerate(jobs):
        if not isinstance(job, dict) or not isinstance(job.get("name"), str) or not job["name"].strip():
            errors.append(f"{prefix}[{i}].name: expected a name")
            continue
        names.append(job["name"].strip().casefold())
        paths = job.get("paths")
        if not isinstance(paths, list) or not paths or not all(isinstance(p, str) and p.strip() for p in paths):
            errors.append(f"{prefix}[{i}].paths: expected source or module paths")
        elif any(p.rstrip("/") not in allowed for p in paths):
            errors.append(f"{prefix}[{i}].paths: path is not in component {component_id}")
        else:
            path_sets.append({p.rstrip("/") for p in paths})
    if len(names) == 2 and names[0] == names[1]:
        errors.append(f"{prefix}: the two jobs need different names")
    if len(path_sets) == 2 and path_sets[0] == path_sets[1]:
        errors.append(f"{prefix}: the two jobs need different paths")
    return errors


def health_entry(check: str, level: str, nodes: list[str], evidence: list[str], accepted: bool,
                 confidence: float | None, *, jobs: list[dict] | None = None) -> dict:
    meaning = MODULE_CYCLE_MEANING if check == "cycle" and level == "modules" else MEANINGS[check]
    result = {"check": check, "level": level, "nodes": nodes, "headline": HEADLINES[check],
              "meaning": meaning, "evidence": list(dict.fromkeys(evidence))[:EVIDENCE_LIMIT],
              "suggestion": SUGGESTIONS[check] if not accepted else None,
              "accepted": accepted, "confidence": confidence}
    if jobs is not None:
        result["jobs"] = [{"name": j["name"].strip(), "paths": list(dict.fromkeys(j["paths"]))} for j in jobs]
        result["suggestion"] = f"Separate {result['jobs'][0]['name']} from {result['jobs'][1]['name']} along the cited paths."
    return result


# --- decisions -------------------------------------------------------------

def _confidence(value):
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _entry(value, status, confidence, reason) -> dict:
    return {"value": value, "status": status, "confidence": confidence, "reason": reason}


def _from_choice_record(record) -> dict:
    """Apply the spec thresholds to a raw record (answer + confidence)."""
    if record is None:
        return _entry(None, "unresolved", None, "missing")
    answer, confidence = record.get("answer"), _confidence(record.get("confidence"))
    if answer in NON_ANSWERS:
        return _entry(None, "unresolved", confidence, str(answer or "missing"))
    if confidence is None or confidence < UNCERTAIN:
        return _entry(None, "unresolved", confidence, "low confidence")
    if confidence < ACCEPT:
        return _entry(answer, "uncertain", confidence, None)
    return _entry(answer, "accepted", confidence, None)


def _from_boolean_record(record) -> dict:
    answer = record.get("answer")
    p = 1.0 if answer is True else 0.0 if answer is False else _confidence(answer)
    if p is None:
        return {"accepted": False, "flag": "uncertain", "probability": None}
    if p >= ACCEPT:
        return {"accepted": True, "flag": None, "probability": p}
    if p <= UNCERTAIN:
        return {"accepted": False, "flag": None, "probability": p}
    return {"accepted": False, "flag": "uncertain", "probability": p}


def _clean_entry(raw) -> dict:
    status = raw.get("status") or ("accepted" if raw.get("value") is not None else "unresolved")
    if status not in ("accepted", "uncertain", "unresolved"):
        status = "unresolved"
    value = raw.get("value") if status != "unresolved" else None
    reason = raw.get("reason") if status == "unresolved" else None
    return _entry(value, status, _confidence(raw.get("confidence")), reason or ("missing" if status == "unresolved" else None))


def _records(decisions) -> list[dict]:
    if isinstance(decisions, list):
        items = decisions
    elif isinstance(decisions, dict):
        items = decisions.get("records") or decisions.get("decisions") or []
    else:
        items = []
    return [r for r in items if isinstance(r, dict)]


def index_decisions(decisions) -> dict:
    """Normalise decide.py output (or a bare record list) into one lookup structure.

    Returns {"area": {cid: entry}, "runtime": {...}, "nature": {...}, "role": {...},
    "checks": {(src, dst, check): verdict}, "quality": {(check, nodes): verdict}}
    where entry = {value, status, confidence, reason}
    and verdict = {accepted, flag, probability}.
    """
    index = {"checks": {}, "quality": {}, **{kind: {} for kind in ATTRIBUTES}}
    structured = isinstance(decisions, dict) and isinstance(decisions.get("resolution"), dict)
    if structured:
        for cid, entry in decisions["resolution"].items():
            for kind in ATTRIBUTES:
                if isinstance(entry, dict) and isinstance(entry.get(kind), dict):
                    index[kind][cid] = _clean_entry(entry[kind])
        for key, verdict in (decisions.get("edges") or {}).items():
            if not isinstance(verdict, dict):
                continue
            src, dst = verdict.get("from"), verdict.get("to")
            if not (src and dst) and "->" in str(key):
                src, dst = str(key).split("|", 1)[0].split("->", 1)
            check = verdict.get("check") or "core-uses-adapter"
            if src and dst and check in CHECKS:
                index["checks"][(src, dst, check)] = {"accepted": verdict.get("accepted") is True, "flag": verdict.get("flag"), "probability": _confidence(verdict.get("probability"))}
        for verdict in (decisions.get("quality") or {}).values():
            if not isinstance(verdict, dict):
                continue
            check, nodes = verdict.get("check"), verdict.get("nodes")
            if check in CHECKS and isinstance(nodes, list) and all(isinstance(n, str) for n in nodes):
                index["quality"][(check, tuple(nodes))] = {
                    "accepted": verdict.get("accepted") is True, "flag": verdict.get("flag"),
                    "probability": _confidence(verdict.get("probability"))}
        return index
    for record in _records(decisions):
        question = str(record.get("question") or record.get("question_id") or "")
        node = record.get("node") or record.get("component") or ""
        if question in ATTRIBUTES and node:
            index[question][node] = _from_choice_record(record)
        elif question in CHECK_QUESTIONS:
            src, dst = record.get("from"), record.get("to")
            if not (src and dst) and isinstance(node, str) and "->" in node:
                src, dst = node.split("->", 1)
            if src and dst:
                index["checks"][(src, dst, CHECK_QUESTIONS[question])] = _from_boolean_record(record)
    return index


def _flag(entry: dict):
    return None if entry["status"] == "accepted" else entry["status"]


def _resolve(entry: dict | None):
    """Return (value or None, confidence, flag, reason) for a normalised entry."""
    entry = entry or _entry(None, "unresolved", None, "missing")
    return entry["value"], entry["confidence"], _flag(entry), entry["reason"]


# --- assembly --------------------------------------------------------------

CONTRADICTION = "contradicts-evidence"


def flag_contradictions(components, component_edges) -> None:
    """Mark resolved answers the scan evidence argues against; the agent sharpens those cards and re-runs decide.

    A tooling, test, or experiment component that a product component imports in production code, or a
    runtime answer that only the opposite family of libraries supports, gets ``decision[kind].flag`` set to
    ``contradicts-evidence``. Unresolved answers keep their flag.
    """
    by_id = {c["id"]: c for c in components}
    imported_by_product = {}
    for edge in component_edges:
        src, dst = by_id.get(edge["from"]), edge["to"]
        if src and src["nature"] == "product" and src["decision"]["nature"]["flag"] != "unresolved" and int(edge.get("count", 0)) > 0:
            imported_by_product.setdefault(dst, []).append(src["id"])
    for comp in components:
        nature, runtime = comp["decision"]["nature"], comp["decision"]["runtime"]
        if comp["nature"] in SUPPORT_NATURES and nature["flag"] != "unresolved" and comp["id"] in imported_by_product:
            nature["flag"] = CONTRADICTION
        hints = comp.get("hints") or {}
        server, client = bool(hints.get("server_libs")), bool(hints.get("client_libs"))
        if runtime["flag"] != "unresolved" and ((comp["runtime"] == "client" and server and not client)
                                                 or (comp["runtime"] == "server" and client and not server)):
            runtime["flag"] = CONTRADICTION


def contradictions(map_obj: dict) -> list[dict]:
    """Every contradicts-evidence flag as {component, question, evidence} for the build summary."""
    by_id = {c["id"]: c for c in map_obj["components"]}
    importers = {}
    for edge in map_obj["edges"]["components"]:
        if edge["count"] > 0 and by_id[edge["from"]]["nature"] == "product":
            importers.setdefault(edge["to"], []).append(edge["from"])
    out = []
    for comp in map_obj["components"]:
        for kind in ("runtime", "nature"):
            if comp["decision"][kind]["flag"] != CONTRADICTION:
                continue
            if kind == "nature":
                evidence = f"{comp['nature']} code imported by product components: " + ", ".join(sorted(importers.get(comp["id"], [])))
            else:
                libs = comp["hints"].get("server_libs") if comp["runtime"] == "client" else comp["hints"].get("client_libs")
                evidence = f"runtime {comp['runtime']} but the only runtime libraries are " + ", ".join(libs or [])
            out.append({"component": comp["id"], "question": kind, "value": comp[kind], "evidence": evidence})
    return out

def _draft_areas(draft: dict) -> list[dict]:
    if "domain_partitions" in draft:
        raise BuildError("draft.json still has domain_partitions; rewrite it as areas: [{id, name, definition, components}]")
    return [a for a in draft.get("areas") or [] if isinstance(a, dict)]


def _hues(count: int) -> list[int]:
    return [int(round((HUE_START + i * 360 / count) % 360)) for i in range(count)] if count else []


def _strings(value) -> list[str]:
    return [str(v) for v in value] if isinstance(value, list) else []


def _people(items, kind: str) -> list[dict]:
    """Actors (with ``uses``) or externals (with ``kind`` and ``used_by``) from the draft, sorted by id."""
    result = []
    for item in items or []:
        if isinstance(item, str):
            item = {"name": item}
        record = {
            "id": str(item.get("id") or slug(item.get("name", ""))),
            "name": str(item.get("name", "")),
            "role": str(item.get("role", "")),
        }
        if kind == "actors":
            record["uses"] = _strings(item.get("uses"))
        else:
            record["kind"] = str(item.get("kind", ""))
            record["used_by"] = sorted(_strings(item.get("used_by")))
        result.append(record)
    return sorted(result, key=lambda r: r["id"])


def _flows(system: dict) -> list[dict]:
    flows = []
    for item in system.get("flows") or []:
        if isinstance(item, dict):
            flow = {"from": str(item.get("from", "")), "to": str(item.get("to", "")),
                    "label": str(item.get("label", "")), "kind": str(item.get("kind", ""))}
            if item.get("detail"):
                flow["detail"] = str(item["detail"])
            flows.append(flow)
    return flows


def is_runnable(component: dict) -> bool:
    """Product code that starts as its own process or page."""
    if component["nature"] != "product":
        return False
    hints = component.get("hints") or {}
    if component["role"] != "surface":
        return False  # a library with a helper binary (a migration tool) is not what the system runs
    if hints.get("declared_kind") == "library":
        return False  # its own build configuration says it is a library, whatever it renders
    # start evidence: an executable entry, a start/serve target or script, or a container image (see scan hints)
    return bool(hints.get("executable")) and component["runtime"] in RUNNABLE_RUNTIMES + ("shared",)


def build(skeleton: dict, draft: dict, decisions, *, built_at: str | None = None) -> dict:
    if isinstance(decisions, dict) and decisions.get("partial"):
        raise BuildError("decisions cache is partial; rerun decide before build")
    errors = project_types.validate(draft, {c["id"] for c in skeleton.get("components", [])}, project_types.inventory_paths(skeleton))
    if errors:
        raise BuildError("Invalid repository proposals: " + "; ".join(errors))
    index = index_decisions(decisions)
    meta_in = dict(decisions.get("meta") or {}) if isinstance(decisions, dict) else {}
    if isinstance(decisions, dict):
        meta_in.setdefault("model", decisions.get("model"))
        meta_in.setdefault("instructions_version", decisions.get("instructions_version"))
    areas_in = _draft_areas(draft)
    area_ids = [str(a.get("id") or slug(a.get("name", ""))) for a in areas_in]
    hues = _hues(len(area_ids))
    draft_components = draft.get("components") or {}
    if isinstance(draft_components, list):
        draft_components = {c.get("id"): c for c in draft_components if isinstance(c, dict)}
    for comp in skeleton.get("components", []):
        errors = mixed_jobs_errors(skeleton, comp["id"], (draft_components.get(comp["id"]) or {}).get("mixed_jobs"))
        if errors:
            raise BuildError("; ".join(errors))
    edge_reasons = draft.get("edge_reasons") or {}
    if isinstance(edge_reasons, list):
        edge_reasons = {edge_key(e["from"], e["to"]): e.get("reason", "") for e in edge_reasons if isinstance(e, dict)}
    module_names = draft.get("module_names") or {}
    module_texts = {**(draft.get("module_responsibilities") or {}), **{k: v for k, v in (draft.get("module_summaries") or {}).items() if v}}

    components = []
    unresolved = []
    members = {a: [] for a in area_ids}
    members[BUILD_VERIFY] = []
    members[UNSORTED] = []
    attribute_of = {kind: {} for kind in ("runtime", "nature", "role")}  # resolved values only; checks skip the rest
    known_ids = {c["id"] for c in skeleton.get("components", [])}
    for comp in skeleton.get("components", []):
        cid = comp["id"]
        card = draft_components.get(cid) or {}
        answer, confidence, flag, reason = _resolve(index["area"].get(cid))
        if answer in (BUILD_VERIFY_ANSWER, BUILD_VERIFY):
            answer = BUILD_VERIFY
        elif answer is not None and str(answer) not in area_ids:
            answer, flag, reason = None, "unresolved", "unknown_area"
        area = str(answer) if answer is not None else UNSORTED
        if flag == "unresolved":
            unresolved.append({"component": cid, "question": "area", "reason": reason})
        members[area].append(cid)
        decision = {"area": {"confidence": confidence, "flag": flag}}
        values = {}
        for kind, allowed in (("runtime", RUNTIMES), ("nature", NATURES)):
            value, conf, kind_flag, kind_reason = _resolve(index[kind].get(cid))
            if value is not None and str(value) not in allowed:
                value, kind_flag, kind_reason = None, "unresolved", f"unknown_{kind}"
            if kind_flag == "unresolved":
                unresolved.append({"component": cid, "question": kind, "reason": kind_reason})
            else:
                attribute_of[kind][cid] = str(value)
            values[kind] = str(value) if value is not None else FALLBACKS[kind]
            decision[kind] = {"confidence": conf, "flag": kind_flag}
        if values["nature"] == "product":
            value, conf, role_flag, role_reason = _resolve(index["role"].get(cid))
            if value is not None and str(value) not in ROLES:
                value, role_flag, role_reason = None, "unresolved", "unknown_role"
            if role_flag == "unresolved":
                unresolved.append({"component": cid, "question": "role", "reason": role_reason})
            else:
                attribute_of["role"][cid] = str(value)
            values["role"] = str(value) if value is not None else FALLBACKS["role"]
            decision["role"] = {"confidence": conf, "flag": role_flag}
        else:
            values["role"] = "none"
            decision["role"] = {"confidence": None, "flag": None}
        components.append({
            "id": cid,
            "name": str(card.get("name") or comp.get("name") or cid),
            "path": comp.get("path", ""),
            "kind": comp.get("kind", "directory"),
            "description": comp.get("description", ""),
            "readme": comp.get("readme"),
            "area": area,
            "runnable": False,
            "runtime": values["runtime"],
            "nature": values["nature"],
            "role": values["role"],
            "summary": str(card.get("summary", "")),
            "contracts": [dict(c) for c in comp.get("contracts", [])],
            # components that load this one by something other than an import: Wasm, FFI, generated code, plugins
            "loaded_by": sorted({str(x) for x in card.get("loaded_by", []) if str(x) in known_ids and str(x) != cid}),
            "responsibility": str(card.get("responsibility", "")),
            "runs": str(card.get("runs", "")),
            "why": str(card.get("why", "")),
            "entry_points": [str(e) for e in card.get("entry_points", [])],
            "evidence": [str(e) for e in card.get("evidence", [])],
            "modules": list(comp.get("modules", [])),
            "externals": list(skeleton.get("externals", {}).get(cid, [])),
            "hints": dict(comp.get("hints", {})),
            "metrics": dict(comp.get("metrics", {})),
            "decision": decision,
        })
    unresolved.sort(key=lambda u: (u["component"], u["question"]))
    flag_contradictions(components, skeleton.get("edges", {}).get("components", []))
    for comp in components:
        comp["runnable"] = is_runnable(comp)

    by_id = {c["id"]: c for c in components}

    def area_entry(aid, name, definition, hue):
        ids = sorted(members[aid])
        product = [by_id[c] for c in ids if by_id[c]["nature"] == "product"]
        return {
            "id": aid, "name": name, "definition": definition, "hue": hue, "components": ids,
            "runnables": [c for c in ids if by_id[c]["runnable"]],
            "counts": {"product": len(product), "supporting": len(ids) - len(product),
                       "runtimes": {r: sum(1 for c in product if c["runtime"] == r) for r in RUNTIMES}},
        }

    areas = [area_entry(aid, str(spec.get("name") or aid), str(spec.get("definition", "")), hue)
             for aid, spec, hue in zip(area_ids, areas_in, hues)]
    areas.append(area_entry(BUILD_VERIFY, "Build & verify", BUILD_VERIFY_DEFINITION, None))
    if members[UNSORTED]:
        areas.append(area_entry(UNSORTED, "Not placed yet", UNSORTED_DEFINITION, None))
    area_of = {c["id"]: c["area"] for c in components}
    name_of = {c["id"]: c["name"] for c in components}

    modules = []
    for mod in skeleton.get("modules", []):
        mid = mod["id"]
        text = module_texts.get(mid)
        name = str(module_names.get(mid) or mod.get("name") or mid)
        modules.append({
            "id": mid,
            "component": mod["component"],
            "name": name,
            "path": mod.get("path", ""),
            "test": bool(mod.get("test", False)),
            "merged": list(mod.get("merged", [])),
            "responsibility": str(text) if text else f"Holds the {name} files of {name_of.get(mod['component'], mod['component'])}.",
            "responsibility_source": "draft" if text else "generated",
            "files": [dict(f, test=bool(f.get("test", False))) for f in mod.get("files", [])],
            "metrics": dict(mod.get("metrics", {})),
        })

    health = []
    component_edges = []
    area_buckets = {}
    role_of, runtime_of, nature_of = attribute_of["role"], attribute_of["runtime"], attribute_of["nature"]
    def edge_evidence(edge, src, dst):
        return edge["examples"] or [f"{by_id[src]['path']} → {by_id[dst]['path']}"]

    for edge in skeleton.get("edges", {}).get("components", []):
        src, dst = edge["from"], edge["to"]
        reason = edge_reasons.get(edge_key(src, dst), "")
        record = {
            "from": src,
            "to": dst,
            "reason": reason or f"{name_of.get(src, src)} depends on {name_of.get(dst, dst)}.",
            "reason_source": "draft" if reason else "generated",
            "count": int(edge.get("count", 0)),
            "test_count": int(edge.get("test_count", 0)),
            "test_only": bool(edge.get("test_only", False)),
            "examples": list(edge.get("examples", [])),
            "finding": None,
            "accepted": None,
        }
        verdicts = []
        both_product = nature_of.get(src) == "product" and nature_of.get(dst) == "product"
        if not record["test_only"] and both_product:
            if role_of.get(src) == "core" and role_of.get(dst) == "adapter":
                verdicts.append(("core-uses-adapter", index["checks"].get((src, dst, "core-uses-adapter")) or {"accepted": False, "flag": None, "probability": None}))
            if {runtime_of.get(src), runtime_of.get(dst)} == {"client", "server"}:
                verdicts.append(("crosses-the-wire", index["checks"].get((src, dst, "crosses-the-wire")) or {"accepted": False, "flag": None, "probability": None}))
        if not record["test_only"] and nature_of.get(src) == "product" and nature_of.get(dst) in SUPPORT_NATURES:
            verdicts.append(("product-uses-support", {"accepted": False, "flag": None, "probability": None}))
        if not record["test_only"] and both_product:
            for check in ("upward-dependency", "stability-inversion"):
                verdict = index["quality"].get((check, (src, dst)))
                candidate = (upward_candidate(role_of.get(src), role_of.get(dst)) if check == "upward-dependency"
                             else stability_candidate(by_id[src].get("metrics") or {}, by_id[dst].get("metrics") or {}))
                if verdict is not None and candidate:
                    verdicts.append((check, verdict))
        for check, verdict in verdicts:
            health.append(health_entry(check, "components", [src, dst], edge_evidence(record, src, dst),
                                       verdict["accepted"], verdict["probability"]))
            if record["finding"] is None and not verdict["accepted"]:
                record["finding"], record["accepted"] = check, False
        if verdicts and record["finding"] is None:
            record["accepted"] = True
        component_edges.append(record)
        sd, dd = area_of.get(src), area_of.get(dst)
        if sd and dd and sd != dd:
            bucket = area_buckets.setdefault((sd, dd), {"count": 0, "best": None})
            bucket["count"] += record["count"]
            if bucket["best"] is None or (record["count"], record["reason_source"] == "draft") > (bucket["best"]["count"], bucket["best"]["reason_source"] == "draft"):
                bucket["best"] = record
    area_edges = []
    area_name = {a["id"]: a["name"] for a in areas}
    for (sd, dd), bucket in sorted(area_buckets.items()):
        best = bucket["best"]
        drafted = best["reason_source"] == "draft"
        area_edges.append({
            "from": sd,
            "to": dd,
            "reason": best["reason"] if drafted else f"{area_name.get(sd, sd)} depends on {area_name.get(dd, dd)}.",
            "reason_source": "draft" if drafted else "generated",
            "count": bucket["count"],
        })
    root_modules = {m["id"] for m in skeleton.get("modules", []) if m.get("root_file", m["id"].endswith("/root"))}
    for level in ("components", "modules"):
        level_edges = component_edges if level == "components" else skeleton.get("edges", {}).get("modules", [])
        for cycle in skeleton.get("cycles", {}).get(level, []):
            inside = set(cycle)
            # A module cycle through the component's source root (lib.rs / index.ts re-exporting submodules that
            # import shared items back, or sibling files of a flat crate) is the ordinary hub pattern, not a finding.
            if level == "modules" and inside & root_modules:
                continue
            evidence = [ex for e in level_edges if e["from"] in inside and e["to"] in inside and not e.get("test_only")
                        for ex in e.get("examples", [])[:1]]
            if not evidence:
                lookup = by_id if level == "components" else {m["id"]: m for m in modules}
                evidence = [lookup[n]["path"] for n in cycle]
            health.append(health_entry("cycle", level, list(cycle), evidence, False, None))
    for comp in components:
        cid = comp["id"]
        jobs = (draft_components.get(cid) or {}).get("mixed_jobs") or []
        mixed = index["quality"].get(("mixed-responsibility", (cid,)))
        if jobs and mixed and mixed["accepted"] is False and mixed["flag"] is None \
                and mixed["probability"] is not None and mixed["probability"] <= 0.4:
            evidence = [p for job in jobs for p in job["paths"]]
            health.append(health_entry("mixed-responsibility", "components", [cid], evidence,
                                       False, mixed["probability"], jobs=jobs))
        hub = index["quality"].get(("hub-coupling", (cid,)))
        if comp["nature"] == "product" and hub is not None and hub_candidate(comp.get("metrics") or {}):
            evidence = [ex for edge in component_edges if not edge["test_only"] and cid in (edge["from"], edge["to"])
                        for ex in edge["examples"][:1]] or [comp["path"]]
            health.append(health_entry("hub-coupling", "components", [cid], evidence,
                                       hub["accepted"], hub["probability"]))
    health.sort(key=lambda h: (h["level"] != "components", CHECKS.index(h["check"]), h["nodes"]))
    product_components = [c for c in components if c["nature"] == "product"]

    system = draft.get("system") or {}
    scanned_at = skeleton.get("meta", {}).get("scanned_at", "")
    return {
        "schema": "codemap.map/1",
        **repository_map(skeleton, draft, decisions),
        "meta": {
            "repo": dict(skeleton.get("meta", {}).get("repo", {})),
            "built_at": built_at or scanned_at,
            "scanned_at": scanned_at,
            "activity": skeleton.get("meta", {}).get("activity"),
            "unowned_contracts": list(skeleton.get("meta", {}).get("unowned_contracts") or []),
            "import_coverage": {"languages": skeleton.get("inventory", {}).get("import_coverage", {}).get("languages", []),
                                "parsed_files": len(skeleton.get("inventory", {}).get("import_coverage", {}).get("parsed_paths", [])),
                                "unparsed_files": len(skeleton.get("inventory", {}).get("import_coverage", {}).get("unparsed_paths", [])),
                                "inventory_available": "inventory" in skeleton},
            "skill_version": SKILL_VERSION,
            "jev_model": str(meta_in.get("model") or DEFAULT_MODEL),
            "instructions_version": int(meta_in.get("instructions_version") or 1),
        },
        "system": {
            "id": "system",
            "name": str(system.get("name", "")),
            "purpose": str(system.get("purpose", "")),
            "summary": str(system.get("summary", "")),
            "actors": _people(system.get("actors"), "actors"),
            "externals": _people(system.get("externals"), "externals"),
            "runtime_counts": {r: sum(1 for c in product_components if c["runtime"] == r) for r in RUNTIMES},
        },
        "areas": areas,
        "flows": _flows(system),
        "components": components,
        "modules": modules,
        "edges": {
            "areas": area_edges,
            "components": component_edges,
            "modules": [dict(e) for e in skeleton.get("edges", {}).get("modules", [])],
        },
        "health": health,
        "unresolved": unresolved,
    }


def repository_map(skeleton, draft, decisions):
    """Mechanically publish only judgments for the exact current proposals."""
    if not any(draft.get(key) for key in ("projects", "views", "project_relations")):
        return {}
    records = {(r.get("node"), r.get("question")): r for r in _records(decisions)}
    resolved = {}
    for node, kind, state, criteria in project_types.questions(skeleton, draft):
        record = records.get((node, kind), {})
        current = (record.get("fingerprint") == decisions_mod.fingerprint(kind, state, criteria)
                   and record.get("instructions_version") == decisions_mod.INSTRUCTIONS_VERSION)
        entry = decisions_mod.resolve_repository_answer(kind, decisions_mod.record_answer(record) if current else None)
        if not current:
            entry["reason"] = "This proposal has not been assessed against the current evidence."
        resolved[node] = entry
    shape = resolved["repository"]
    projects = []
    for proposed in draft.get("projects", []):
        pid = proposed["id"]
        decision = resolved[f"project:{pid}"]
        memberships = [{"component": cid, "decision": resolved[f"membership:{len(pid)}:{pid}:{cid}"]}
                       for cid in proposed["components"]]
        projects.append(dict(proposed, components=[m["component"] for m in memberships
                                                   if m["decision"]["status"] == "accepted" and m["decision"]["value"] is True],
                             kind=decision["value"] if decision["status"] == "accepted" else "other",
                             decision=decision, membership_decisions=memberships))
    enabled = shape["status"] == "accepted" and shape["value"] == "landscape" and len(projects) > 1
    by_project = {p["id"]: p for p in projects}
    views, diagnostics = [], []
    for proposed in draft.get("views", []):
        decision = dict(resolved[f"view:{proposed['id']}"])
        accepted = decision["status"] == "accepted" and decision["value"] is True
        members = set(by_project[proposed["project"]]["components"])
        if accepted and any(n.get("component") not in members for n in proposed["nodes"] if "component" in n):
            decision = {"value": None, "status": "unresolved", "confidence": None,
                        "reason": "view references a component without accepted membership in this project"}
            accepted = False
        diagnostics.append({"id": proposed["id"], "project": proposed["project"], "kind": proposed["kind"], "decision": decision})
        # like a component, a view Jev was unsure of (40-60%) is shown with an unsure mark; below that it stays hidden
        if accepted or (decision["status"] == "uncertain" and not any(n.get("component") not in members for n in proposed["nodes"] if "component" in n)):
            views.append(dict(proposed, decision=decision))
    return {"landscape": {"enabled": enabled, "decision": shape}, "projects": projects,
            "project_relations": draft.get("project_relations", []) if enabled else [],
            "views": views, "view_decisions": diagnostics}


def validate_project_bounds(map_obj):
    """Readability bounds use the same membership/uses/flow scope as the viewer."""
    errors = []
    product = {c["id"] for c in map_obj["components"] if c["nature"] == "product"}
    for project in map_obj.get("projects", []):
        members = set(project["components"])
        areas = [a for a in map_obj["areas"] if members.intersection(a["components"])]
        area_ids = {a["id"] for a in areas}
        touching = {f["to"] for f in map_obj["flows"] if f["from"] in members} | {f["from"] for f in map_obj["flows"] if f["to"] in members}
        actors = [a for a in map_obj["system"]["actors"] if set(a["uses"]) & (members | area_ids) or a["id"] in touching]
        externals = [e for e in map_obj["system"]["externals"] if e["kind"] != "devtool" and (set(e["used_by"]) & members or e["id"] in touching)]
        where = f"project {project['id']}"
        if len(actors) > BOUNDS["actors"]:
            errors.append(f"{where}: {len(actors)} actors exceeds {BOUNDS['actors']}")
        if len(externals) > BOUNDS["externals"]:
            errors.append(f"{where}: {len(externals)} non-devtool externals exceeds {BOUNDS['externals']}")
        for actor in actors:
            if len(set(actor["uses"]) & (members | area_ids)) > BOUNDS["uses"]:
                errors.append(f"{where}: actor {actor['id']} uses more than {BOUNDS['uses']} targets")
        for area in areas:
            count = len(set(area["components"]) & members & product)
            if count > BOUNDS["components_per_area"]:
                errors.append(f"{where}: area {area['id']} has {count} product components, exceeds {BOUNDS['components_per_area']}")
    return errors


def validate_repository_map(map_obj):
    errors = project_types.validate(map_obj, {c["id"] for c in map_obj["components"]})
    projects = {p["id"]: p for p in map_obj.get("projects", [])}
    landscape = map_obj.get("landscape")
    if landscape:
        decision = landscape["decision"]
        expected = decision["status"] == "accepted" and decision["value"] == "landscape" and len(projects) > 1
        if landscape["enabled"] != expected:
            errors.append("landscape: enabled disagrees with decision or project count")
    if map_obj.get("project_relations") and not (landscape and landscape["enabled"]):
        errors.append("project relations require an accepted landscape decision")
    for pid, project in projects.items():
        memberships = project["membership_decisions"]
        ids = [m["component"] for m in memberships]
        if len(set(ids)) != len(ids) or any(cid not in {c["id"] for c in map_obj["components"]} for cid in ids):
            errors.append(f"project {pid}: invalid membership diagnostics")
        accepted = [m["component"] for m in memberships if m["decision"]["status"] == "accepted" and m["decision"]["value"] is True]
        if accepted != project["components"]:
            errors.append(f"project {pid}: components disagree with accepted memberships")
        decision = project["decision"]
        if project["kind"] != (decision["value"] if decision["status"] == "accepted" else "other"):
            errors.append(f"project {pid}: kind disagrees with decision")
    diagnostics = {v["id"]: v for v in map_obj.get("view_decisions", [])}
    if len(diagnostics) != len(map_obj.get("view_decisions", [])):
        errors.append("view_decisions: duplicate ids")
    for diag in diagnostics.values():
        if diag["project"] not in projects:
            errors.append("view_decisions: dangling project")
    for view in map_obj.get("views", []):
        decision = view["decision"]
        if not ((decision["status"] == "accepted" and decision["value"] is True) or decision["status"] == "uncertain"):
            errors.append(f"view {view['id']}: lacks an accepted or unsure Jev decision")
        diag = diagnostics.get(view["id"], {})
        if any(diag.get(k) != view[k] for k in ("decision", "project", "kind")):
            errors.append(f"view {view['id']}: diagnostic disagrees")
        members = projects.get(view["project"], {}).get("components", [])
        if any(n["component"] not in members for n in view["nodes"] if "component" in n):
            errors.append(f"view {view['id']}: node outside project membership")
    shown_ids = {v["id"] for v in diagnostics.values()
                 if (v["decision"]["status"] == "accepted" and v["decision"]["value"] is True) or v["decision"]["status"] == "uncertain"}
    if shown_ids != {v["id"] for v in map_obj.get("views", [])}:
        errors.append("view_decisions: shown views disagree with published views")
    return errors


# --- validation ------------------------------------------------------------

TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def check_schema(value, schema: dict, root: dict | None = None, path: str = "$") -> list[str]:
    """Tiny JSON Schema subset: type, required, enum, items, properties, additionalProperties, local $ref."""
    root = root if root is not None else schema
    if "$ref" in schema:
        target = root
        for part in schema["$ref"].lstrip("#/").split("/"):
            target = target[part]
        return check_schema(value, target, root, path)
    errors = []
    expected = schema.get("type")
    if expected is not None:
        options = expected if isinstance(expected, list) else [expected]
        if not any(TYPES[t](value) for t in options):
            return [f"{path}: expected {'|'.join(options)}"]
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not in {schema['enum']!r}")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{path}: missing required {key!r}")
        properties = schema.get("properties", {})
        for key, sub in sorted(value.items()):
            if key in properties:
                errors.extend(check_schema(sub, properties[key], root, f"{path}.{key}"))
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}: unexpected property {key!r}")
    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            errors.extend(check_schema(item, schema["items"], root, f"{path}[{i}]"))
    return errors


def validate(map_obj: dict) -> list[str]:
    errors = check_schema(map_obj, load_schema())
    if errors:
        return errors
    errors.extend(validate_repository_map(map_obj))
    landscape = map_obj.get("landscape", {}).get("enabled", False)
    if landscape:
        errors.extend(validate_project_bounds(map_obj))
    system = map_obj["system"]
    areas = map_obj["areas"]
    components = map_obj["components"]
    modules = map_obj["modules"]
    area_ids = {a["id"] for a in areas}
    component_by_id = {c["id"]: c for c in components}
    component_nature = {c["id"]: c["nature"] for c in components}
    runnables = {c["id"] for c in components if c["runnable"]}
    module_by_id = {m["id"]: m for m in modules}
    unresolved_area = {u["component"] for u in map_obj["unresolved"] if u["question"] == "area"}
    unresolved_pairs = {(u["component"], u["question"]) for u in map_obj["unresolved"]}

    if not system["name"]:
        errors.append("system: missing name")
    if not system["purpose"]:
        errors.append("system: missing purpose")
    if not landscape and len(system["actors"]) > BOUNDS["actors"]:
        errors.append(f"system: {len(system['actors'])} actors exceeds {BOUNDS['actors']}")
    actor_ids = {a["id"] for a in system["actors"]}
    external_ids = {e["id"] for e in system["externals"]}
    if len(actor_ids) != len(system["actors"]):
        errors.append("system: duplicate actor ids")
    if len(external_ids) != len(system["externals"]):
        errors.append("system: duplicate external ids")
    explicit_areas = [a["id"] for a in areas if a["id"] not in IMPLICIT_AREAS]
    for actor in system["actors"]:
        if not landscape and len(actor["uses"]) > BOUNDS["uses"]:
            errors.append(f"system.actors[{actor['id']}]: uses {len(actor['uses'])} targets, at most {BOUNDS['uses']}")
        for target in actor["uses"]:
            if target not in runnables and target not in explicit_areas and target != "build-verify":
                errors.append(f"system.actors[{actor['id']}]: uses {target!r}, which is neither a runnable component nor an area")
    drawn = [e for e in system["externals"] if e["kind"] != "devtool"]
    if not landscape and len(drawn) > BOUNDS["externals"]:
        errors.append(f"system: {len(drawn)} non-devtool externals exceeds {BOUNDS['externals']}")
    for external in system["externals"]:
        for cid in external["used_by"]:
            if cid not in component_by_id:
                errors.append(f"system.externals[{external['id']}]: used_by unknown component {cid!r}")
    endpoints = runnables | actor_ids | external_ids
    for flow in map_obj["flows"]:
        label = f"flow {flow['from']}->{flow['to']}"
        for end in (flow["from"], flow["to"]):
            if end not in endpoints:
                errors.append(f"{label}: endpoint {end!r} is not a runnable component, an actor, or an external")
        if flow["from"] == flow["to"]:
            errors.append(f"{label}: self flow")
        if not flow["label"]:
            errors.append(f"{label}: missing label")

    low, high = BOUNDS["areas"]
    if not components:
        low = 0
    landscape = map_obj.get("landscape", {}).get("enabled", False)
    if landscape:
        for project in map_obj.get("projects", []):
            members = set(project["components"])
            count = sum(bool(members.intersection(a["components"])) for a in areas if a["id"] not in IMPLICIT_AREAS)
            if count > high:
                errors.append(f"project {project['id']}: {count} areas, expected at most {high}")
    if not landscape and not low <= len(explicit_areas) <= high:
        errors.append(f"areas: {len(explicit_areas)} areas, expected {low}-{high}")
    if len(area_ids) != len(areas):
        errors.append("areas: duplicate ids")
    if BUILD_VERIFY not in area_ids:
        errors.append("areas: missing the implicit build-verify area")
    listed = {}
    for area in areas:
        aid = area["id"]
        if not area["definition"]:
            errors.append(f"area {aid}: missing definition")
        if aid in IMPLICIT_AREAS:
            if area["hue"] is not None:
                errors.append(f"area {aid}: hue must be null")
            if aid == UNSORTED and not area["components"]:
                errors.append("area unsorted: emitted while empty")
        else:
            if area["hue"] is None or not 0 <= area["hue"] < 360:
                errors.append(f"area {aid}: hue must be 0-359")
            if not area["components"]:
                errors.append(f"area {aid}: holds no components")
        if area["runnables"] != [cid for cid in area["components"] if cid in runnables]:
            errors.append(f"area {aid}: runnables disagree with its components")
        product_members = [cid for cid in area["components"] if component_nature.get(cid) == "product"]
        if not landscape and len(product_members) > BOUNDS["components_per_area"]:
            errors.append(f"area {aid}: {len(product_members)} product components exceeds {BOUNDS['components_per_area']}")
        if area["counts"]["product"] != len(product_members) or area["counts"]["supporting"] != len(area["components"]) - len(product_members):
            errors.append(f"area {aid}: counts disagree with its components")
        for cid in area["components"]:
            if cid not in component_by_id:
                errors.append(f"area {aid}: unknown component {cid!r}")
            if cid in listed:
                errors.append(f"component {cid}: listed in areas {listed[cid]} and {aid}")
            listed[cid] = aid

    if len(component_by_id) != len(components):
        errors.append("components: duplicate ids")
    module_owner = {}
    for comp in components:
        cid = comp["id"]
        if not comp["responsibility"]:
            errors.append(f"component {cid}: missing responsibility")
        if not comp["why"]:
            errors.append(f"component {cid}: missing why")
        if comp["area"] == UNSORTED:
            if cid not in unresolved_area:
                errors.append(f"component {cid}: unsorted without an unresolved entry")
        elif comp["area"] not in area_ids:
            errors.append(f"component {cid}: unknown area {comp['area']!r}")
        if listed.get(cid) != comp["area"]:
            errors.append(f"component {cid}: area {comp['area']!r} does not list it")
        if comp["runnable"] != is_runnable(comp):
            errors.append(f"component {cid}: runnable flag disagrees with its nature, role, runtime, and hints")
        for kind in ("runtime", "nature", "role"):
            flagged = comp["decision"][kind]["flag"] == "unresolved"
            if flagged != ((cid, kind) in unresolved_pairs):
                errors.append(f"component {cid}: {kind} flag disagrees with the unresolved list")
        if (comp["nature"] == "product") != (comp["role"] != "none"):
            errors.append(f"component {cid}: nature {comp['nature']!r} with role {comp['role']!r}")
        if len(comp["modules"]) > BOUNDS["modules_per_component"]:
            errors.append(f"component {cid}: {len(comp['modules'])} modules exceeds {BOUNDS['modules_per_component']}")
        for mid in comp["modules"]:
            if mid not in module_by_id:
                errors.append(f"component {cid}: unknown module {mid!r}")
            elif module_by_id[mid]["component"] != cid:
                errors.append(f"module {mid}: claimed by {cid} but belongs to {module_by_id[mid]['component']}")
            module_owner[mid] = cid

    if len(module_by_id) != len(modules):
        errors.append("modules: duplicate ids")
    component_path = {c["id"]: c["path"] for c in components}
    seen_files = {}
    for mod in modules:
        mid = mod["id"]
        if mod["component"] not in component_by_id:
            errors.append(f"module {mid}: outside any component ({mod['component']!r})")
        elif module_owner.get(mid) != mod["component"]:
            errors.append(f"module {mid}: component {mod['component']} does not list it")
        if not mod["responsibility"]:
            errors.append(f"module {mid}: missing responsibility")
        base = component_path.get(mod["component"], "")
        for f in mod["files"]:
            path = f["path"]
            if not path:
                errors.append(f"module {mid}: file without path")
                continue
            if base and base != "." and not path.startswith(base.rstrip("/") + "/"):
                errors.append(f"file {path}: outside module {mid} (component path {base})")
            if path in seen_files:
                errors.append(f"file {path}: in modules {seen_files[path]} and {mid}")
            seen_files[path] = mid

    for level, ids in (("areas", area_ids), ("components", set(component_by_id)), ("modules", set(module_by_id))):
        for edge in map_obj["edges"][level]:
            label = f"edge {level} {edge['from']}->{edge['to']}"
            if edge["from"] not in ids or edge["to"] not in ids:
                errors.append(f"{label}: dangling")
            if edge["from"] == edge["to"]:
                errors.append(f"{label}: self edge")
            if level != "modules" and not edge["reason"]:
                errors.append(f"{label}: missing reason")
    for finding in map_obj["health"]:
        ids = set(component_by_id) if finding["level"] == "components" else set(module_by_id)
        for node in finding["nodes"]:
            if node not in ids:
                errors.append(f"health {finding['check']}: unknown node {node!r}")
        expected_meaning = MODULE_CYCLE_MEANING if finding["check"] == "cycle" and finding["level"] == "modules" else MEANINGS[finding["check"]]
        if finding["meaning"] != expected_meaning:
            errors.append(f"health {finding['check']}: meaning differs from the check's sentence")
        if not finding["headline"].strip():
            errors.append(f"health {finding['check']}: missing headline")
        if not finding["evidence"]:
            errors.append(f"health {finding['check']}: missing path or import evidence")
        if finding["accepted"] is None:
            errors.append(f"health {finding['check']}: missing acceptability verdict")
        if isinstance(finding["suggestion"], str) and not finding["suggestion"].strip():
            errors.append(f"health {finding['check']}: empty suggestion")
        jobs = finding.get("jobs")
        if finding["check"] == "mixed-responsibility":
            if finding["level"] != "components" or len(finding["nodes"]) != 1 or finding["accepted"]:
                errors.append("health mixed-responsibility: requires one component and a confirmed finding")
            elif finding["nodes"][0] in component_by_id:
                errors.extend(mixed_jobs_errors(map_obj, finding["nodes"][0], jobs))
            if not jobs:
                errors.append("health mixed-responsibility: missing two jobs")
        elif jobs is not None:
            errors.append(f"health {finding['check']}: jobs belong only to mixed responsibility")
    if system["runtime_counts"] != {r: sum(1 for c in components if c["nature"] == "product" and c["runtime"] == r) for r in RUNTIMES}:
        errors.append("system: runtime_counts disagree with the product components")
    for entry in map_obj["unresolved"]:
        if entry["component"] not in component_by_id:
            errors.append(f"unresolved: unknown component {entry['component']!r}")
    return errors


# --- summaries -------------------------------------------------------------

def count_by(items, key) -> dict:
    return {value: sum(1 for i in items if i[key] == value) for value in sorted({i[key] for i in items})}


def health_summary(map_obj: dict) -> dict:
    """Findings (unaccepted health entries) per check, plus the number of checks that ran."""
    findings = [h for h in map_obj["health"] if not h["accepted"]]
    return {"checks": len(CHECKS), "findings": len(findings), "by_check": count_by(findings, "check")}


# --- rendering -------------------------------------------------------------

def render(map_obj: dict, template_text: str) -> str:
    if PLACEHOLDER not in template_text:
        raise BuildError(f"viewer template lacks the {PLACEHOLDER} placeholder")
    payload = json.dumps(map_obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</script", "<\\/script").replace("<!--", "<\\u0021--")
    payload = payload.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return template_text.replace(PLACEHOLDER, payload, 1)


def dumps(obj) -> str:
    return json.dumps(obj, sort_keys=True, indent=1, ensure_ascii=False) + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build and validate codemap.map/1.")
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--draft", required=True)
    parser.add_argument("--decisions", required=True)
    parser.add_argument("--template")
    parser.add_argument("--output-map", required=True)
    parser.add_argument("--output-html")
    args = parser.parse_args(argv)
    load = lambda p: json.loads(Path(p).read_text(encoding="utf-8"))
    try:
        map_obj = build(load(args.skeleton), load(args.draft), load(args.decisions))
        errors = validate(map_obj)
        Path(args.output_map).write_text(dumps(map_obj), encoding="utf-8")
        if errors:
            raise BuildError("validation failed: " + "; ".join(errors))
        if args.output_html:
            if not args.template:
                raise BuildError("--output-html needs --template")
            Path(args.output_html).write_text(render(map_obj, Path(args.template).read_text(encoding="utf-8")), encoding="utf-8")
    except (BuildError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps({
        "status": "ok",
        "map": args.output_map,
        "html": args.output_html,
        "areas": len([a for a in map_obj["areas"] if a["id"] not in IMPLICIT_AREAS]),
        "runnables": [c["id"] for c in map_obj["components"] if c["runnable"]],
        "flows": len(map_obj["flows"]),
        "components": len(map_obj["components"]),
        "modules": len(map_obj["modules"]),
        "health": health_summary(map_obj),
        "contradictions": contradictions(map_obj),
        "unresolved": len(map_obj["unresolved"]),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
