#!/usr/bin/env python3
"""Ask Jev the typed questions of a codemap and cache every answer by state fingerprint.

Reads skeleton.json and draft.json, reuses decisions.json records whose fingerprint
is unchanged, sends only the missing questions, and writes a new decisions.json
atomically. Any transport or key failure aborts the run and leaves the previous
file untouched; there is no agent fallback for decisions.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jev_client  # noqa: E402
from jev_client import Error  # noqa: E402


class Interrupted(Error):
    """A provider failure mid-run; `records` holds every answer obtained so far plus untouched cache entries."""

    def __init__(self, message, records):
        super().__init__(message)
        self.records = records


RETRY_DELAYS = (2, 4, 8, 16, 32)
MIN_INTERVAL = 0.3
_sleep = time.sleep


def transient(error):
    text = str(error)
    return any(f"HTTP {code}" in text for code in (429, 502, 503, 529)) or "timed out" in text


def evaluate_with_backoff(evaluate, payload):
    """Retry rate-limit, overload, unavailable, and timeout failures with exponential backoff; everything else fails at once."""
    for delay in RETRY_DELAYS + (None,):
        try:
            return evaluate(payload)
        except jev_client.Error as exc:
            if delay is None or not transient(exc):
                raise
            _sleep(delay)


SCHEMA = "codemap.decisions/1"
INSTRUCTIONS_VERSION = 8
MAX_STATE_CHARS = 6000
LIST_LIMIT = 8
RUNTIMES = ("server", "client", "shared", "cli", "build", "none")
NATURES = ("product", "tooling", "test", "content", "docs", "experiment")
ROLES = ("surface", "adapter", "core", "kernel")
SUPPORT_NATURES = ("tooling", "test", "experiment")
RUNTIME_DEFINITIONS = {
    "server": "a long-lived service process",
    "client": "a page or desktop app a person uses",
    "shared": "a library compiled into more than one runtime",
    "cli": "a command that is part of the product, run by its users or operators",
    "build": "runs only while building, testing, developing, or producing assets, however it is started",
    "none": "not executable: content, docs",
}
NATURE_DEFINITIONS = {
    "product": "runs as part of what users use, including the authoring tools designers operate",
    "tooling": "build, dev stack, quality gates, asset pipelines and the art or data sources they build from",
    "test": "harnesses, acceptance lanes, test support",
    "content": "data and scripts the product itself loads at run time",
    "docs": "documentation and review evidence",
    "experiment": "prototypes and spikes",
}
ROLE_DEFINITIONS = {
    "surface": "what a person or another system touches: UI, API handlers, CLI entry points, editor hosts",
    "adapter": "I/O and engines: persistence, transport, rendering, filesystem, and wrappers of OS or browser APIs",
    "core": "the system's own behavior: rules, models, sessions, workflows, and compilers of authored rule content",
    "kernel": "the shared vocabulary: types, schemas and their validators, contracts, and plain utilities every role uses",
}
ABSTAIN = "Abstain: the state lacks the evidence to decide; do not guess."
NEW_AREA = "None of the offered areas fits this product component; the draft needs a new area for it."
BUILD_VERIFY = "build_verify"
BUILD_VERIFY_DEFINITION = ("Supporting code that serves the repository itself rather than one area: build, gates, "
                           "dev stack, repo-wide tests, docs")
RESERVED_AREA_IDS = ("abstain", "new_area", BUILD_VERIFY, "build-verify", "unsorted")
ACCEPT_AT = 0.6
UNCERTAIN_AT = 0.4

AREA_INSTRUCTIONS = (
    "An area is a group of parts one kind of person uses for one purpose. Place this component with the "
    "people who use it, judging by its responsibility rather than by who imports it. A library every area "
    "uses belongs to the area that owns its vocabulary, and a library several areas use with no owner "
    "goes with its heaviest product consumer; that is an ordinary placement, not a reason for new_area. Supporting code (tooling, tests, content, docs, "
    "experiments) belongs to the one area it serves, or to build_verify when it serves the repository itself or more "
    "than one area: build, gates, dev stack, repo-wide tests, docs, tools that measure several parts of the system. "
    "Choose new_area when this is product code and no "
    "offered area fits; choose abstain when the card lacks the evidence to decide."
)
RUNTIME_INSTRUCTIONS = (
    "Decide where this component runs. Read the card's runs line first: who starts it, when, and what uses its "
    "output. Code that only developers, artists, testers, or CI run (tooling, pipelines, dev stacks, gates, "
    "harnesses, sandboxes) is build even when started from a terminal; cli is reserved for commands that are part "
    "of the product. Then weigh the manifest hints: executable targets, wasm targets, "
    "server libraries, browser libraries, desktop wrappers, and the directory it lives in; then its "
    "dependents, which show which runtimes compile it in. A library with no executable entry is shared when "
    "its dependents run in more than one runtime, and takes its dependents' runtime when they all run in one; "
    "content and docs that nothing executes are none; scripts the product loads and executes at runtime take "
    "the runtime that executes them. Choose abstain when the card lacks the evidence to decide."
)
NATURE_INSTRUCTIONS = (
    "Decide what kind of code this component is: part of what users use (product, including the authoring "
    "tools designers operate) or something that supports building, testing, describing, or exploring the "
    "product. Read the card's runs line first: product code is run by the product's users (players, designers, "
    "operators, or the agents that drive the product's tools) or loaded by what they run. Then weigh the directory "
    "kind, test frameworks, share of test files, and the responsibility. A library "
    "that product components import is product code however unglamorous (schemas, contracts, generated types); "
    "tooling and test code never compile into what users run. Choose abstain when the card lacks the evidence to decide."
)
ROLE_INSTRUCTIONS = (
    "Place this component at its hexagonal position so that healthy dependencies point down: surface uses "
    "adapters and core, adapters implement for core, core rests on the kernel. Surface is what a person or "
    "another system touches first (an executable's entry, an API, a UI host); an executable service is surface, "
    "not adapter. A library whose job is to call a storage, network, engine, or OS or browser API is adapter; one "
    "that decides what happens in the system (its rules and workflows) is core; types, schemas, validators, and "
    "contracts that describe the data every role exchanges are kernel, however detailed their checks. Judge by "
    "what the component owns and who touches it, not by its size. If the component is not "
    "product code, choose the closest fit anyway; the answer is recorded but unused. Choose abstain when the card "
    "lacks the evidence to decide."
)
CORE_USES_ADAPTER_INSTRUCTIONS = (
    "A core component imports an adapter, so its rules are tied to one storage, transport, or engine. "
    "Answer true when this dependency is acceptable by design (a plugin registry, an inversion-of-control "
    "seam, a deliberate framework hook, or a documented exception in the evidence) and false when it is "
    "a finding a maintainer would want to remove."
)
CROSSES_THE_WIRE_INSTRUCTIONS = (
    "Client code imports server code (or the reverse) directly instead of a shared contract. Answer true "
    "when this dependency is acceptable by design (the imported part is a contract that happens to live "
    "there, a build-time only use, or a documented exception in the evidence) and false when it is a "
    "finding a maintainer would want to remove."
)
HOLDS_INSTRUCTIONS = (
    "This component was previously assigned the area, runtime, nature, and role shown. Given the summary "
    "of what changed since that decision, answer true when the assignment still holds and false when the "
    "change is large enough that these should be decided again."
)
QUESTIONS = {
    "area": AREA_INSTRUCTIONS, "runtime": RUNTIME_INSTRUCTIONS,
    "nature": NATURE_INSTRUCTIONS, "role": ROLE_INSTRUCTIONS, "core_uses_adapter": CORE_USES_ADAPTER_INSTRUCTIONS,
    "crosses_the_wire": CROSSES_THE_WIRE_INSTRUCTIONS, "holds": HOLDS_INSTRUCTIONS,
}
COMPONENT_QUESTIONS = ("area", "runtime", "nature", "role")
SECOND_PASS_QUESTIONS = ("runtime", "nature", "role")
STATUS_RANK = {"accepted": 2, "uncertain": 1, "unresolved": 0}
CHECKS = {"core_uses_adapter": "core-uses-adapter", "crosses_the_wire": "crosses-the-wire"}
BOOLEAN_QUESTIONS = tuple(CHECKS) + ("holds",)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def fingerprint(question, state, criteria):
    return hashlib.sha256(canonical([question, INSTRUCTIONS_VERSION, state, criteria]).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clip(text, limit=600):
    if not isinstance(text, str):
        return None
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def clip_state(state):
    """Shrink list fields deterministically until the state fits the character budget."""
    for limit in (LIST_LIMIT, 4, 2, 1):
        for key, value in list(state.items()):
            if isinstance(value, list):
                state[key] = value[:limit]
        if len(canonical(state)) <= MAX_STATE_CHARS:
            return state
    for key, value in list(state.items()):
        if isinstance(value, str):
            state[key] = clip(value, 200)
    return state


# --- inputs -------------------------------------------------------------------

def load_inputs(skeleton, draft):
    components = skeleton.get("components")
    if not isinstance(components, list) or not components or not all(isinstance(c, dict) and c.get("id") for c in components):
        raise Error("skeleton.json has no components; run skeleton first.")
    if not isinstance(draft, dict) or not isinstance(draft.get("components"), dict):
        raise Error("draft.json has no components block; run enrich first.")
    if "domain_partitions" in draft:
        raise Error("draft.json still has domain_partitions; rewrite it as areas: [{id, name, definition, components}].")
    areas = draft.get("areas")
    if not isinstance(areas, list) or not areas:
        raise Error("draft.json has no areas; enrich must propose 3-7 areas, each with an id, name, definition, and components.")
    seen = set()
    for area in areas:
        if not isinstance(area, dict) or not isinstance(area.get("id"), str) or not area["id"]:
            raise Error("Every area needs an id.")
        if area["id"] in RESERVED_AREA_IDS:
            raise Error(f"Area id {area['id']!r} is reserved.")
        if area["id"] in seen:
            raise Error(f"Area id {area['id']!r} is listed twice.")
        seen.add(area["id"])
        if not isinstance(area.get("components", []), list):
            raise Error(f"Area {area['id']!r} needs a list of expected components.")


def component_index(skeleton):
    return {c["id"]: c for c in skeleton["components"]}


def component_edges(skeleton):
    edges = (skeleton.get("edges") or {}).get("components") or []
    known = component_index(skeleton)
    return sorted((e for e in edges if isinstance(e, dict) and e.get("from") in known and e.get("to") in known and e["from"] != e["to"]),
                  key=lambda e: (e["from"], e["to"]))


def evidence_paths(evidence):
    paths = []
    for item in evidence or []:
        if isinstance(item, str):
            paths.append(item)
        elif isinstance(item, dict) and isinstance(item.get("path"), str):
            paths.append(item["path"])
    return paths


def sample_files(skeleton, component):
    modules = {m["id"]: m for m in skeleton.get("modules") or [] if isinstance(m, dict) and m.get("id")}
    paths = []
    for module_id in component.get("modules") or []:
        module = modules.get(module_id) or {}
        for entry in module.get("files") or []:
            path = entry.get("path") if isinstance(entry, dict) else entry
            if isinstance(path, str):
                paths.append(path)
        if not module.get("files") and isinstance(module.get("path"), str):
            paths.append(module["path"] + "/")
    return sorted(set(paths))


def externals_for(skeleton, component):
    prefix = (component.get("path") or "").rstrip("/") + "/"
    rows = []
    for external in skeleton.get("externals") or []:
        if not isinstance(external, dict) or not external.get("name"):
            continue
        used_by = external.get("used_by")
        if isinstance(used_by, list):
            hits = component["id"] in used_by
            count = external.get("count") or 0
        else:
            files = [f for f in external.get("files") or [] if isinstance(f, str) and f.startswith(prefix)]
            hits, count = bool(files), len(files)
        if hits:
            rows.append((-(count or 0), external["name"]))
    return [name for _count, name in sorted(rows)]


def neighbor(component_id, drafts, count):
    card = drafts.get(component_id) or {}
    return {"id": component_id, "imports": count, "responsibility": clip(card.get("responsibility"), 200)}


def _names(pairs):
    return ", ".join(k for k, _v in sorted(pairs.items(), key=lambda kv: (-kv[1], kv[0]))[:LIST_LIMIT])


def derived_facts(component, incoming, outgoing, natures=None):
    """Plain sentences computed from the skeleton so Jev reads evidence instead of inferring it."""
    hints = component.get("hints") or {}
    facts = []
    facts.append(f"Imported by {len(incoming)} components: {_names(incoming)}" if incoming else "Imported by no components")
    if natures is not None:
        product = {k: v for k, v in incoming.items() if natures.get(k) == "product"}
        facts.append(f"Imported by {len(product)} product components: {_names(product)}" if product else "Imported by no product components")
    facts.append(f"Imports {len(outgoing)} components: {_names(outgoing)}" if outgoing else "Imports no components")
    if hints.get("server_libs"):
        facts.append("Imports server libraries: " + ", ".join(hints["server_libs"]))
    if hints.get("client_libs"):
        facts.append("Imports client libraries: " + ", ".join(hints["client_libs"]))
    if not hints.get("server_libs") and not hints.get("client_libs"):
        facts.append("Imports no runtime libraries")
    facts.append("Has an executable entry" if hints.get("executable") else "No executable entry")
    if hints.get("wasm"):
        facts.append("Compiles to wasm")
    if hints.get("desktop"):
        facts.append("Ships in a desktop wrapper (electron or tauri)")
    if hints.get("test_libs"):
        facts.append("Uses test frameworks: " + ", ".join(hints["test_libs"]))
    if hints.get("directory_kind"):
        top = (component.get("path") or "").split("/", 1)[0]
        facts.append(f"Lives under {top}/ (directory kind: {hints['directory_kind']})")
    share = hints.get("test_file_share") or 0.0
    facts.append(f"{int(round(share * 100))}% of its files are tests")
    return facts


def component_neighbors(skeleton, component):
    """(dependents, dependencies) as {id: production import count}, aggregated over component edges."""
    outgoing, incoming = {}, {}
    for edge in component_edges(skeleton):
        if edge["from"] == component["id"]:
            outgoing[edge["to"]] = outgoing.get(edge["to"], 0) + (edge.get("count") or 1)
        if edge["to"] == component["id"]:
            incoming[edge["from"]] = incoming.get(edge["from"], 0) + (edge.get("count") or 1)
    return incoming, outgoing


def component_card(skeleton, draft, component):
    """The state Jev sees for one component: the card plus its neighborhood, capped and deterministic."""
    drafts = draft["components"]
    card = drafts.get(component["id"]) or {}
    incoming, outgoing = component_neighbors(skeleton, component)
    by_weight = lambda pairs: [neighbor(k, drafts, v) for k, v in sorted(pairs.items(), key=lambda kv: (-kv[1], kv[0]))]
    metrics = component.get("metrics") or {}
    state = {
        "id": component["id"], "name": component.get("name") or component["id"],
        "path": component.get("path"), "kind": component.get("kind"),
        "hints": dict(sorted((component.get("hints") or {}).items())),
        "derived": derived_facts(component, incoming, outgoing),
        "responsibility": clip(card.get("responsibility")), "runs": clip(card.get("runs")), "why": clip(card.get("why")),
        "entry_points": [clip(e, 200) for e in card.get("entry_points") or [] if isinstance(e, str)],
        "evidence": evidence_paths(card.get("evidence")),
        "loc": metrics.get("loc"), "files": metrics.get("files"),
        "dependencies": by_weight(outgoing), "dependents": by_weight(incoming),
        "externals": externals_for(skeleton, component), "sample_files": sample_files(skeleton, component),
    }
    return clip_state(state)


def second_pass_card(skeleton, component, card, resolution):
    """The first-round card plus what the first round decided about every neighbour."""
    incoming, outgoing = component_neighbors(skeleton, component)
    natures = {cid: entry["nature"]["value"] for cid, entry in resolution.items()}
    fact = lambda cid: {"id": cid, "runtime": resolution.get(cid, {}).get("runtime", {}).get("value") or "unresolved",
                        "nature": natures.get(cid) or "unresolved"}
    ordered = lambda pairs: [fact(k) for k, _v in sorted(pairs.items(), key=lambda kv: (-kv[1], kv[0]))]
    state = dict(card, derived=derived_facts(component, incoming, outgoing, natures),
                 neighbor_facts={"dependents": ordered(incoming), "dependencies": ordered(outgoing)})
    return clip_state(state)


# --- questions ----------------------------------------------------------------

def area_criteria(areas):
    """One option per proposed area (name, definition, expected members), then build_verify, new_area, abstain."""
    criteria = {}
    for area in areas:
        members = ", ".join(sorted(c for c in area.get("components") or [] if isinstance(c, str)))
        text = f"{area.get('name') or area['id']}: {area.get('definition') or ''}"
        criteria[area["id"]] = clip(f"{text} Expected members: {members}." if members else text, 400)
    criteria[BUILD_VERIFY] = BUILD_VERIFY_DEFINITION
    criteria["new_area"] = NEW_AREA
    criteria["abstain"] = ABSTAIN
    return criteria


def fixed_criteria(definitions):
    criteria = dict(definitions)
    criteria["abstain"] = ABSTAIN
    return criteria


def component_questions(areas):
    """The {kind: criteria} every component is asked, in one request."""
    questions = {"area": area_criteria(areas)}
    questions["runtime"] = fixed_criteria(RUNTIME_DEFINITIONS)
    questions["nature"] = fixed_criteria(NATURE_DEFINITIONS)
    questions["role"] = fixed_criteria(ROLE_DEFINITIONS)
    return questions


CORE_USES_ADAPTER_CRITERIA = {"true": "Acceptable by design: the core reaches the adapter through a deliberate seam the evidence supports.",
                              "false": "Finding: the core is tied to this adapter by accident and a maintainer would want to remove the dependency."}
CROSSES_THE_WIRE_CRITERIA = {"true": "Acceptable by design: the import is a contract or build-time use the evidence supports.",
                             "false": "Finding: client and server code are coupled directly and a maintainer would want a shared contract instead."}
CHECK_CRITERIA = {"core_uses_adapter": CORE_USES_ADAPTER_CRITERIA, "crosses_the_wire": CROSSES_THE_WIRE_CRITERIA}
HOLDS_CRITERIA = {"true": "The previous area, runtime, nature, and role assignment still holds after these changes.",
                  "false": "The changes are material enough that area, runtime, nature, and role must be decided again."}


def edge_state(cards, values, edge, draft, attribute):
    """Both cards, the attribute the check compares (roles or runtimes), the reason, and example imports."""
    reasons = draft.get("edge_reasons") or {}
    lite = lambda cid: {k: cards[cid].get(k) for k in ("id", "name", "responsibility", "why", "kind")}
    state = {
        "check": attribute,
        "from": dict(lite(edge["from"]), **{attribute: values[edge["from"]]}),
        "to": dict(lite(edge["to"]), **{attribute: values[edge["to"]]}),
        "reason": clip(reasons.get(f"{edge['from']}->{edge['to']}"), 300),
        "count": edge.get("count"), "examples": [clip(e, 200) for e in edge.get("examples") or [] if isinstance(e, str)][:3],
    }
    return clip_state(state)


DERIVED_RUNTIME = {"tooling": "build", "test": "build", "experiment": "build", "docs": "none"}


def derived_runtime(entry):
    """The runtime a decided nature implies, or None when the nature leaves it open (product, content)."""
    nature = entry["nature"]
    value = DERIVED_RUNTIME.get(nature["value"]) if nature["status"] != "unresolved" else None
    if value is None:
        return None
    return {"value": value, "status": "accepted", "confidence": None, "reason": None,
            "derived": f"{nature['value']} code: runtime follows from the nature"}


def question(kind, criteria):
    return {"type": "boolean" if kind in BOOLEAN_QUESTIONS else "choice", "instructions": QUESTIONS[kind], "criteria": criteria}


# --- thresholds ---------------------------------------------------------------

def resolve_choice(answer):
    """Map a cleaned Choice answer to {value, status, confidence, reason}."""
    confidence = answer.get("confidence")
    choice = answer["choice"]
    if choice in ("abstain", "new_area"):
        return {"value": None, "status": "unresolved", "confidence": confidence, "reason": choice}
    if confidence is None:
        return {"value": None, "status": "unresolved", "confidence": None, "reason": "no confidence returned"}
    if confidence >= ACCEPT_AT:
        return {"value": choice, "status": "accepted", "confidence": confidence, "reason": None}
    if confidence >= UNCERTAIN_AT:
        return {"value": choice, "status": "uncertain", "confidence": confidence, "reason": None}
    return {"value": None, "status": "unresolved", "confidence": confidence, "reason": f"low confidence ({confidence:.2f})"}


def resolve_boolean(answer):
    p = answer["probability"]
    if p >= ACCEPT_AT:
        return {"accepted": True, "flag": None, "probability": p}
    if p <= UNCERTAIN_AT:
        return {"accepted": False, "flag": None, "probability": p}
    return {"accepted": False, "flag": "uncertain", "probability": p}


def answer_value(answer):
    return answer.get("choice", answer.get("score", answer.get("probability")))


# --- the run ------------------------------------------------------------------

class Session:
    """One decide run: cache lookups, batched requests, and the records they produce."""

    def __init__(self, cache, evaluate, *, zdr=False, dry_run=False, changes=None):
        self.previous = {}
        for record in (cache or {}).get("records") or []:
            if isinstance(record, dict) and record.get("node") and record.get("question"):
                self.previous[(record["node"], record["question"], record.get("pass", 1))] = record
        self.evaluate, self.zdr, self.dry_run, self.changes = evaluate, zdr, dry_run, changes or {}
        self.records, self.requests = [], []
        self.failed, self.streak = [], 0  # nodes the provider could not evaluate; consecutive failed calls
        self.calls = self.cached = 0
        self.last_call = float("-inf")
        self.cost = 0.0
        self.elapsed = 0.0

    def partial_records(self):
        """Answers obtained so far plus untouched cache entries, for a resumable cache after a failure."""
        seen = {(r["node"], r["question"], r.get("pass", 1)) for r in self.records}
        return self.records + [r for key, r in sorted(self.previous.items()) if key not in seen]

    def cached_record(self, node, kind, print_, pass_=1):
        record = self.previous.get((node, kind, pass_))
        if record and record.get("fingerprint") == print_ and record.get("instructions_version") == INSTRUCTIONS_VERSION:
            return record
        return None

    def ask(self, node, state, questions, pass_=1):
        """Answer the given {kind: criteria} for one node, reusing cache per question; one request for the rest."""
        answers, pending = {}, {}
        for kind, criteria in questions.items():
            print_ = fingerprint(kind, state, criteria)
            record = self.cached_record(node, kind, print_, pass_)
            if record:
                self.cached += 1
                self.records.append(record)
                answers[kind] = record_answer(record)
            else:
                pending[kind] = (criteria, print_)
        if not pending:
            return answers
        payload = {"model": jev_client.MODEL, "state": state,
                   "questions": {kind: question(kind, criteria) for kind, (criteria, _) in pending.items()}}
        if self.zdr:
            payload["providerOptions"] = {"gateway": {"zeroDataRetention": True}}
        jev_client.validate_request(payload)
        if self.dry_run:
            self.requests.append({"node": node, "request": payload})
            return answers
        wait = MIN_INTERVAL - (time.monotonic() - self.last_call)
        if wait > 0:
            _sleep(wait)
        try:
            result = evaluate_with_backoff(self.evaluate, payload)
        except jev_client.Error as exc:
            # One card the provider keeps failing on (502/503 after the backoff) is skipped and re-asked on the
            # next run; a second failure in a row looks like an outage and stops the run.
            if self.streak or not any(f"HTTP {code}" in str(exc) for code in (502, 503)):
                raise
            self.streak += 1
            self.last_call = time.monotonic()
            self.failed.append({"node": node, "error": str(exc)})
            return answers
        self.streak = 0
        self.last_call = time.monotonic()
        self.calls += 1
        cost = result.get("cost_usd")
        elapsed = result.get("elapsed_seconds") or 0.0
        self.cost += cost or 0.0
        self.elapsed += elapsed
        share = round(cost / len(pending), 8) if cost is not None else None
        decided_at = now()
        for kind, (_criteria, print_) in pending.items():
            answer = result["answers"][kind]
            record = {
                "node": node, "question": kind, "fingerprint": print_, "answer": answer_value(answer),
                "probabilities": answer.get("probabilities"), "confidence": answer.get("confidence"),
                "model": result.get("model", jev_client.MODEL), "elapsed_seconds": elapsed, "cost_usd": share,
                "instructions_version": INSTRUCTIONS_VERSION, "decided_at": decided_at,
            }
            if pass_ != 1:
                record["pass"] = pass_
            self.records.append(record)
            answers[kind] = answer
        return answers

    def torn_between(self, node, kind):
        """The two most likely options of the latest answer to one question: what the evidence must separate."""
        latest = [r for r in self.records if r["node"] == node and r["question"] == kind]
        probabilities = (latest[-1].get("probabilities") if latest else None) or {}
        ranked = sorted(((v, k) for k, v in probabilities.items() if k != "abstain" and isinstance(v, (int, float))), reverse=True)
        return [k for _v, k in ranked[:2]]

    def carry(self, node, kind, state, criteria, previous):
        """Re-record a held decision under the current fingerprint."""
        record = dict(previous, fingerprint=fingerprint(kind, state, criteria), held_from=previous.get("fingerprint"))
        self.records.append(record)
        self.cached += 1
        return record_answer(record)


def record_answer(record):
    value = record.get("answer")
    answer = {"confidence": record.get("confidence"), "probabilities": record.get("probabilities")}
    if isinstance(value, str):
        answer.update(type="choice", choice=value)
    elif isinstance(value, bool):
        raise Error(f"Corrupt decisions cache for {record.get('node')!r}; delete decisions.json and rerun.")
    elif record.get("question") in BOOLEAN_QUESTIONS:
        answer.update(type="boolean", probability=value)
    else:
        answer.update(type="score", score=value)
    return answer


def decide(skeleton, draft, cache, *, evaluate=None, changes=None, require_zdr=False, dry_run=False):
    """Run every question against the cache and Jev; `evaluate` defaults to jev_client.evaluate at call time."""
    load_inputs(skeleton, draft)
    session = Session(cache, evaluate or jev_client.evaluate, zdr=require_zdr, dry_run=dry_run, changes=changes)
    try:
        return _decide(session, skeleton, draft, dry_run)
    except Interrupted:
        raise
    except jev_client.Error as exc:
        raise Interrupted(str(exc), session.partial_records()) from None


def partial_cache(interrupted):
    """A resumable decisions cache: records only, marked partial so build refuses it."""
    return {"schema": SCHEMA, "instructions_version": INSTRUCTIONS_VERSION, "model": jev_client.MODEL,
            "partial": True, "error": str(interrupted), "decided_at": now(), "records": interrupted.records}


def _decide(session, skeleton, draft, dry_run):
    components = component_index(skeleton)
    areas = draft["areas"]
    unresolved, uncertain = [], []

    # 1. Area, runtime, nature, and role per component, one request each.
    cards = {cid: component_card(skeleton, draft, c) for cid, c in sorted(components.items())}
    resolution = {}
    for cid, card in cards.items():
        questions = component_questions(areas)
        prints = {k: fingerprint(k, card, v) for k, v in questions.items()}
        missing = [k for k in questions if not session.cached_record(cid, k, prints[k])]
        held = None
        if missing and cid in session.changes and all(session.previous.get((cid, k, 1)) for k in questions):
            held = session.ask(cid, holds_state(card, cid, session), {"holds": HOLDS_CRITERIA}).get("holds")
        answers = {}
        if held is not None and held["probability"] >= ACCEPT_AT:
            for kind, crit in questions.items():
                answers[kind] = session.carry(cid, kind, card, crit, session.previous[(cid, kind, 1)])
        else:
            answers = session.ask(cid, card, questions)
        entry = {}
        for kind in COMPONENT_QUESTIONS:
            if kind in answers:
                entry[kind] = resolve_choice(answers[kind])
            else:
                failed = any(f["node"] == cid for f in session.failed)
                entry[kind] = {"value": None, "status": "unresolved", "confidence": None, "reason": "provider_error" if failed else "dry-run"}
        resolution[cid] = entry

    # 1b. Second pass: components with a shaky runtime, nature, or role are re-asked with what the first
    # round decided about their neighbours. A second answer replaces the first unless it is worse.
    second_pass = []
    for cid, entry in resolution.items() if not dry_run else []:
        if any(f["node"] == cid for f in session.failed):
            continue
        applies = entry["nature"]["value"] in (None, "product")
        shaky = [k for k in SECOND_PASS_QUESTIONS if entry[k]["status"] != "accepted"
                 and (k != "role" or applies or entry["nature"]["status"] != "accepted")
                 and (k != "runtime" or derived_runtime(entry) is None)]
        if not shaky:
            continue
        state = second_pass_card(skeleton, components[cid], cards[cid], resolution)
        questions = {k: v for k, v in component_questions(areas).items() if k in shaky}
        answers = session.ask(cid, state, questions, pass_=2)
        for kind in shaky:
            if kind not in answers:
                continue
            second = dict(resolve_choice(answers[kind]), **{"pass": 2})
            if STATUS_RANK[second["status"]] >= STATUS_RANK[entry[kind]["status"]]:
                entry[kind] = second
        second_pass.append(cid)

    for cid, entry in resolution.items():
        # Supporting code runs at build time and docs never run: the runtime follows from the nature.
        derived = derived_runtime(entry)
        if derived:
            entry["runtime"] = derived
        # Role matters only for product code (build treats an unresolved nature as product).
        entry["role_applies"] = entry["nature"]["value"] in (None, "product")
        for kind in COMPONENT_QUESTIONS:
            if dry_run or entry[kind]["status"] == "accepted" or (kind == "role" and not entry["role_applies"]):
                continue
            doubt = {"node": cid, "question": kind, "torn_between": session.torn_between(cid, kind)}
            if entry[kind]["status"] == "unresolved":
                unresolved.append(dict(doubt, reason=entry[kind]["reason"]))
            else:
                uncertain.append(dict(doubt, value=entry[kind]["value"], confidence=entry[kind]["confidence"]))

    # 2. Health checks that need judgment, on production edges between product components.
    value_of = lambda cid, kind: resolution[cid][kind]["value"]
    product = {cid for cid in resolution if value_of(cid, "nature") == "product"}
    edges = {}
    for edge in component_edges(skeleton):
        src, dst = edge["from"], edge["to"]
        if edge.get("test_only") or src not in product or dst not in product:
            continue
        roles = {cid: value_of(cid, "role") for cid in (src, dst)}
        runtimes = {cid: value_of(cid, "runtime") for cid in (src, dst)}
        applicable = []
        if roles[src] == "core" and roles[dst] == "adapter":
            applicable.append(("core_uses_adapter", "role", roles))
        if {runtimes[src], runtimes[dst]} == {"client", "server"}:
            applicable.append(("crosses_the_wire", "runtime", runtimes))
        for kind, attribute, values in applicable:
            node = f"{src}->{dst}"
            answers = session.ask(node, edge_state(cards, values, edge, draft, attribute), {kind: CHECK_CRITERIA[kind]})
            if kind in answers:
                key = node if node not in edges else f"{node}|{CHECKS[kind]}"
                edges[key] = dict(resolve_boolean(answers[kind]), **{"from": src, "to": dst, "check": CHECKS[kind]})

    statuses = [e[k]["status"] for e in resolution.values() for k in COMPONENT_QUESTIONS if k != "role" or e["role_applies"]]
    count_values = lambda kind: dict(sorted(
        {v: sum(1 for e in resolution.values() if (e[kind]["value"] or "unresolved") == v) for v in
         {e[kind]["value"] or "unresolved" for e in resolution.values()}}.items()))
    findings = {check: sum(1 for e in edges.values() if e["check"] == check and not e["accepted"]) for check in sorted(CHECKS.values())}
    result = {
        "schema": SCHEMA, "instructions_version": INSTRUCTIONS_VERSION, "model": jev_client.MODEL, "decided_at": now(),
        "resolution": resolution, "edges": edges, "records": session.records,
        "summary": {
            "components": len(components), "areas": len(areas),
            "questions": len(session.records), "calls_made": session.calls, "calls_cached": session.cached,
            "accepted": statuses.count("accepted"), "uncertain": statuses.count("uncertain"),
            "unresolved": statuses.count("unresolved"), "checked_edges": len(edges), "second_pass": second_pass,
            "areas_assigned": count_values("area"), "runtimes": count_values("runtime"), "natures": count_values("nature"),
            "findings": findings,
            "total_cost_usd": round(session.cost, 8), "total_elapsed_seconds": round(session.elapsed, 3),
            "unresolved_nodes": unresolved, "uncertain_nodes": uncertain, "provider_failures": session.failed,
        },
    }
    if dry_run:
        result["requests"] = session.requests
    return result


def holds_state(card, cid, session):
    previous = {k: session.previous[(cid, k, 1)].get("answer") for k in COMPONENT_QUESTIONS if (cid, k, 1) in session.previous}
    change = session.changes.get(cid)
    state = {"component": card, "previous": previous, "changes": change if isinstance(change, (str, dict, list)) else str(change)}
    return clip_state(state)


# --- CLI ----------------------------------------------------------------------

def read_json(path, *, optional=False):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        if optional:
            return None
        raise Error(f"Missing input file: {path}") from None
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise Error(f"Cannot read JSON from {path}") from None


def write_atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(data, stream, indent=2, sort_keys=True, allow_nan=False)
            stream.write("\n")
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skeleton", required=True, type=Path)
    parser.add_argument("--draft", required=True, type=Path)
    parser.add_argument("--decisions", required=True, type=Path, help="cache to read and file to write")
    parser.add_argument("--changes", type=Path, help="update flow: {components: {id: change summary}}")
    parser.add_argument("--require-zdr", action="store_true", help="request zero data retention from Gateway")
    parser.add_argument("--dry-run", action="store_true", help="print prepared requests, one JSON per line; no network")
    args = parser.parse_args(argv)
    try:
        skeleton, draft = read_json(args.skeleton), read_json(args.draft)
        cache = read_json(args.decisions, optional=True)
        changes = read_json(args.changes) if args.changes else None
        if changes is not None:
            changes = changes.get("components") if isinstance(changes, dict) and isinstance(changes.get("components"), dict) else None
            if changes is None:
                raise Error("The changes file must contain a components object keyed by component id.")
        if args.dry_run:
            result = decide(skeleton, draft, cache, changes=changes, require_zdr=args.require_zdr, dry_run=True)
            for prepared in result["requests"]:
                print(json.dumps(prepared, allow_nan=False))
            print(json.dumps({"status": "dry-run", "requests": len(result["requests"]),
                              "calls_cached": result["summary"]["calls_cached"]}, allow_nan=False), file=sys.stderr)
            return 0
        try:
            result = decide(skeleton, draft, cache, changes=changes, require_zdr=args.require_zdr)
        except Interrupted as exc:
            write_atomic(args.decisions, partial_cache(exc))
            raise Error(f"{exc} Progress was saved; rerun decide to continue from the cache.") from None
        write_atomic(args.decisions, result)
        print(json.dumps(dict(result["summary"], status="decided", path=str(args.decisions)), indent=2, allow_nan=False))
        return 0
    except Error as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('{"status":"cancelled"}', file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
