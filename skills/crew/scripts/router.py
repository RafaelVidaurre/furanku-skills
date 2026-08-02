#!/usr/bin/env python3
"""Choose a Crew harness/model/effort from research-backed task requirements."""

from __future__ import annotations

import argparse
from copy import deepcopy
import json
import math
from pathlib import Path
import subprocess
import sys

try:
    import config as exact_config
except ModuleNotFoundError:  # pragma: no cover - package import in tests
    from . import config as exact_config


CATALOG = Path(__file__).resolve().parent.parent / "references" / "routing-catalog.json"
ROLES = ("captain", "worker")
OBJECTIVES = ("quality", "cost", "latency", "quota", "continuity")
SELECTION_MODES = {
    "specialization-default": None,
    "best-quality": ["quality", "quota", "continuity", "latency", "cost"],
    "cheapest-sufficient": ["cost", "quota", "continuity", "latency", "quality"],
}
DEFAULT_ON_NO_SUFFICIENT = "error"


class Error(Exception):
    pass


def read_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Error(f"cannot read {label} {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise Error(f"{label} {path} must contain a JSON object")
    return value


def pointer(parts: tuple[str, ...]) -> str:
    if not parts:
        return "/"
    return "/" + "/".join(
        part.replace("~", "~0").replace("/", "~1") for part in parts
    )


def merge_patch(target, patch, source, provenance, parts=()):
    """Apply JSON merge-patch semantics and retain every leaf's source chain."""
    if not isinstance(patch, dict):
        provenance.setdefault(pointer(parts), []).append(source)
        return deepcopy(patch)
    if not isinstance(target, dict):
        target = {}
    result = deepcopy(target)
    for key, value in patch.items():
        child = parts + (str(key),)
        if value is None:
            result.pop(key, None)
            provenance.setdefault(pointer(child), []).append(source)
        elif isinstance(value, dict):
            result[key] = merge_patch(
                result.get(key, {}), value, source, provenance, child
            )
        else:
            result[key] = deepcopy(value)
            provenance.setdefault(pointer(child), []).append(source)
    return result


def number(value, label, *, minimum=0.0, maximum=1.0):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise Error(f"{label} must be a number")
    value = float(value)
    if not minimum <= value <= maximum:
        raise Error(f"{label} must be between {minimum} and {maximum}")
    return value


def validate_need(need, label):
    if not isinstance(need, dict):
        raise Error(f"{label} must be an object")
    allowed = {"minimum", "weight", "critical", "accept_unknown"}
    if not set(need) <= allowed or "minimum" not in need:
        raise Error(f"{label} requires minimum and supports weight, critical, accept_unknown")
    number(need["minimum"], f"{label}.minimum")
    number(need.get("weight", 1.0), f"{label}.weight", maximum=1000.0)
    for key in ("critical", "accept_unknown"):
        if key in need and not isinstance(need[key], bool):
            raise Error(f"{label}.{key} must be boolean")


def validate_routing(routing):
    if not isinstance(routing, dict):
        raise Error("compiled routing policy must be an object")
    allowed = {"candidates", "specializations", "policy"}
    unknown = sorted(set(routing) - allowed)
    if unknown:
        raise Error(f"unknown routing sections: {', '.join(unknown)}")
    candidates = routing.get("candidates")
    if not isinstance(candidates, dict) or not candidates:
        raise Error("routing candidates must be a non-empty object")
    for candidate_id, candidate in candidates.items():
        label = f"candidate {candidate_id!r}"
        if not isinstance(candidate, dict):
            raise Error(f"{label} must be an object")
        launch = candidate.get("launch")
        if not isinstance(launch, dict) or set(launch) != {"agent", "model", "effort"}:
            raise Error(f"{label}.launch requires only agent, model, and effort")
        if any(not isinstance(value, str) or not value.strip() for value in launch.values()):
            raise Error(f"{label}.launch values must be non-empty strings")
        if "enabled" in candidate and not isinstance(candidate["enabled"], bool):
            raise Error(f"{label}.enabled must be boolean")
        features = candidate.get("features", [])
        if not isinstance(features, list) or any(not isinstance(x, str) for x in features):
            raise Error(f"{label}.features must be a string array")
        context = candidate.get("context")
        if context is not None and (
            isinstance(context, bool) or not isinstance(context, int) or context <= 0
        ):
            raise Error(f"{label}.context must be a positive integer")
        capabilities = candidate.get("capabilities", {})
        if not isinstance(capabilities, dict):
            raise Error(f"{label}.capabilities must be an object")
        for dimension, assessment in capabilities.items():
            cell = f"{label}.capabilities.{dimension}"
            if not isinstance(assessment, dict) or assessment.get("status") not in {"known", "unknown"}:
                raise Error(f"{cell} must declare status known or unknown")
            if assessment["status"] == "known":
                number(assessment.get("score"), f"{cell}.score")
                number(assessment.get("conservative"), f"{cell}.conservative")
                if not assessment.get("assessed_at") or not assessment.get("evidence"):
                    raise Error(f"{cell} requires assessed_at and evidence")
            elif not assessment.get("reason") or not assessment.get("researched_at"):
                raise Error(f"{cell} unknown requires reason and researched_at")
    specializations = routing.get("specializations", {})
    if not isinstance(specializations, dict):
        raise Error("routing specializations must be an object")
    for name, specialization in specializations.items():
        label = f"specialization {name!r}"
        if not isinstance(specialization, dict):
            raise Error(f"{label} must be an object")
        forbidden = {"agent", "harness", "model", "effort", "candidate"} & set(specialization)
        if forbidden:
            raise Error(f"{label} cannot name a candidate: {', '.join(sorted(forbidden))}")
        needs = specialization.get("needs")
        if not isinstance(needs, dict) or not needs:
            raise Error(f"{label}.needs must be a non-empty object")
        for dimension, need in needs.items():
            validate_need(need, f"{label}.needs.{dimension}")
        priority = specialization.get("priority", ["cost", "latency", "quota"])
        if not isinstance(priority, list) or not priority or any(x not in OBJECTIVES for x in priority):
            raise Error(f"{label}.priority contains an unknown objective")
    policy = routing.get("policy", {})
    if not isinstance(policy, dict):
        raise Error("routing policy must be an object")
    number(policy.get("maximum_shortfall", 0.05), "policy.maximum_shortfall")
    if policy.get("on_no_sufficient", DEFAULT_ON_NO_SUFFICIENT) not in {"fallback", "error"}:
        raise Error("policy.on_no_sufficient must be fallback or error")
    if policy.get("unknown_quota", "allow-with-warning") not in {"allow-with-warning", "ineligible"}:
        raise Error("policy.unknown_quota must be allow-with-warning or ineligible")


def compile_policy(repo="."):
    catalog = read_json(CATALOG, "routing catalog")
    if not {"version", "routing"} <= set(catalog) or catalog["version"] != 1:
        raise Error("routing catalog must contain version 1 and routing")
    provenance = {}
    routing = merge_patch({}, catalog["routing"], {"scope": "builtin", "path": str(CATALOG)}, provenance)
    paths = exact_config.locations(repo)
    exact = exact_config.resolve(paths, repo)
    layers = [{"scope": "builtin", "path": str(CATALOG), "version": 1}]
    for scope in exact_config.SCOPES:
        path = paths[scope]
        if not path.exists():
            layers.append({"scope": scope, "path": str(path), "exists": False})
            continue
        config = exact_config.load(path, scope == "global", scope, repo)
        layer = {"scope": scope, "path": str(path), "exists": True, "version": config["version"]}
        layers.append(layer)
        if config["version"] == exact_config.ROUTING_VERSION:
            routing = merge_patch(routing, config["routing"], layer, provenance)
    validate_routing(routing)
    return {"routing": routing, "exact": exact, "layers": layers, "provenance": provenance}


def task_judgment(routing, request):
    if not isinstance(request, dict):
        raise Error("routing request must be an object")
    role = request.get("role")
    if role not in ROLES:
        raise Error("routing request role must be captain or worker")
    specialization = request.get("specialization")
    needs, priority, required_features = {}, ["cost", "latency", "quota"], []
    if specialization is not None:
        spec = routing.get("specializations", {}).get(specialization)
        if spec is None:
            configured = ", ".join(sorted(routing.get("specializations", {})))
            raise Error(
                f"unknown specialization: {specialization}; "
                f"configured specializations: {configured}; "
                "use a configured specialization or omit specialization and "
                "supply explicit needs"
            )
        needs = deepcopy(spec["needs"])
        priority = list(spec.get("priority", priority))
        required_features = list(spec.get("requires", []))
    overrides = request.get("needs", {})
    if not isinstance(overrides, dict):
        raise Error("routing request needs must be an object")
    for dimension, need in overrides.items():
        combined = {**needs.get(dimension, {}), **need} if isinstance(need, dict) else need
        validate_need(combined, f"request.needs.{dimension}")
        needs[dimension] = combined
    requires = request.get("requires", {})
    if not isinstance(requires, dict):
        raise Error("routing request requires must be an object")
    features = requires.get("features", [])
    if not isinstance(features, list) or any(not isinstance(x, str) for x in features):
        raise Error("routing request requires.features must be a string array")
    required_features = sorted(set(required_features) | set(features))
    minimum_context = requires.get("minimum_context")
    if minimum_context is not None and (
        isinstance(minimum_context, bool)
        or not isinstance(minimum_context, int)
        or minimum_context <= 0
    ):
        raise Error("routing request requires.minimum_context must be a positive integer")
    selection_mode = request.get("selection_mode", "specialization-default")
    if selection_mode not in SELECTION_MODES:
        raise Error(
            "routing request selection_mode must be specialization-default, "
            "best-quality, or cheapest-sufficient"
        )
    if selection_mode != "specialization-default" and "priority" in request:
        raise Error("selection_mode cannot be combined with priority")
    if SELECTION_MODES[selection_mode] is not None:
        priority = list(SELECTION_MODES[selection_mode])
    elif "priority" in request:
        priority = request["priority"]
        if not isinstance(priority, list) or not priority or any(x not in OBJECTIVES for x in priority):
            raise Error("routing request priority contains an unknown objective")
    allow = request.get("allow")
    if allow is not None and (not isinstance(allow, list) or any(not isinstance(x, str) for x in allow)):
        raise Error("routing request allow must be a candidate-id array")
    return {
        "role": role,
        "summary": request.get("summary", ""),
        "specialization": specialization,
        "needs": needs,
        "required_features": required_features,
        "minimum_context": minimum_context,
        "selection_mode": selection_mode,
        "priority": priority,
        "allow": set(allow) if allow is not None else None,
        "current": request.get("current"),
        "switching": request.get("switching", "free"),
    }


def runtime_for(runtime, candidate_id, candidate):
    runtime = runtime or {}
    candidate_state = runtime.get("candidates", {}).get(candidate_id)
    if candidate_state is not None:
        return candidate_state
    return runtime.get("harnesses", {}).get(candidate["launch"]["agent"], {})


def quota_pressure(scope):
    pace = scope.get("pace", {})
    reserve = pace.get("worstReservePercentPoints")
    if not isinstance(reserve, (int, float)):
        return None
    if reserve >= 0:
        return 0.0
    # Provider-local pace deficit: 0 means on/behind pace, 1 means a full
    # window's remaining-time deficit. Raw provider percentages are retained
    # for provenance and are never compared as equivalent capacity.
    return min(1.0, abs(float(reserve)) / 100.0)


def quota_axi_runtime(snapshot, routing):
    if snapshot.get("schemaVersion") != 3 or not isinstance(snapshot.get("providers"), list):
        raise Error("quota-axi input must use normalized schemaVersion 3")
    generated = {
        "captured_at": snapshot.get("generatedAt"),
        "harnesses": {},
        "candidates": {},
        "notes": [],
    }
    provider_to_harness = {"claude": "claude", "codex": "codex", "grok": "grok"}
    for provider in snapshot["providers"]:
        provider_id = provider.get("provider")
        if provider_id == "kimi":
            generated["notes"].append(
                "quota-axi Kimi auth is not assumed to represent the OpenCode K3 account"
            )
            continue
        harness = provider_to_harness.get(provider_id)
        if harness is None:
            continue
        state = provider.get("state", {})
        semantics = provider.get("quotaSemantics", {})
        harness_state = {}
        if state.get("status") == "auth_required":
            harness_state["status"] = "auth-required"
            harness_state["quota"] = {"status": "auth-required"}
        elif state.get("stale") or state.get("status") != "fresh":
            harness_state["quota"] = {"status": "stale"}
        elif semantics.get("status") != "known":
            harness_state["quota"] = {"status": "unknown"}
        else:
            scopes = semantics.get("effectiveAvailability", [])
            base_scope = next(
                (
                    scope
                    for scope in scopes
                    if scope.get("scope") in {"all_models", "all_products"}
                ),
                None,
            )
            if base_scope:
                remaining = base_scope.get("effectivePercentRemaining")
                harness_state["quota"] = {
                    "status": "exhausted" if remaining == 0 else "known",
                    "pressure": quota_pressure(base_scope),
                    "effective_percent_remaining": remaining,
                    "bounded_by": base_scope.get("boundedBy", []),
                    "pace": base_scope.get("pace", {}),
                }
            else:
                harness_state["quota"] = {"status": "unknown"}
            for scope in scopes:
                if scope.get("scope") != "model:fable":
                    continue
                for candidate_id, candidate in routing["candidates"].items():
                    launch = candidate["launch"]
                    if launch["agent"] == "claude" and "fable" in launch["model"]:
                        remaining = scope.get("effectivePercentRemaining")
                        generated["candidates"][candidate_id] = {
                            "quota": {
                                "status": "exhausted" if remaining == 0 else "known",
                                "pressure": quota_pressure(scope),
                                "effective_percent_remaining": remaining,
                                "bounded_by": scope.get("boundedBy", []),
                                "pace": scope.get("pace", {}),
                            }
                        }
        generated["harnesses"][harness] = harness_state
    return generated


def merge_runtime(base, overlay):
    if not isinstance(base, dict) or not isinstance(overlay, dict):
        raise Error("runtime inputs must be objects")
    result = deepcopy(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge_runtime(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def run_quota_axi():
    result = subprocess.run(
        ["npx", "-y", "quota-axi", "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode not in {0, 1} or not result.stdout.strip():
        raise Error(result.stderr.strip() or "quota-axi returned no data")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise Error(f"quota-axi returned invalid JSON: {exc}") from exc


def gate(candidate_id, candidate, judgment, runtime, policy):
    reasons, warnings = [], []
    if not candidate.get("enabled", True):
        reasons.append("disabled by configuration")
    if judgment["allow"] is not None and candidate_id not in judgment["allow"]:
        reasons.append("outside request allowlist")
    missing = sorted(set(judgment["required_features"]) - set(candidate.get("features", [])))
    if missing:
        reasons.append("missing features: " + ", ".join(missing))
    if judgment["minimum_context"] is not None:
        available_context = candidate.get("context")
        if available_context is None:
            reasons.append("context capacity unknown")
        elif available_context < judgment["minimum_context"]:
            reasons.append(
                f"context {available_context} below required "
                f"{judgment['minimum_context']}"
            )
    state = runtime_for(runtime, candidate_id, candidate)
    if not isinstance(state, dict):
        raise Error(f"runtime state for {candidate_id} must be an object")
    if state.get("status") in {"unavailable", "auth-required", "unsupported"}:
        reasons.append(f"runtime status {state['status']}")
    if state.get("health") in {"unhealthy", "offline"}:
        reasons.append(f"runtime health {state['health']}")
    quota = state.get("quota", {})
    if not isinstance(quota, dict):
        raise Error(f"runtime quota for {candidate_id} must be an object")
    quota_status = quota.get("status", "unknown")
    if quota_status in {"exhausted", "unavailable", "auth-required"}:
        reasons.append(f"quota {quota_status}")
    elif quota_status in {"unknown", "stale"}:
        if policy.get("unknown_quota", "allow-with-warning") == "ineligible":
            reasons.append(f"quota {quota_status}")
        else:
            warnings.append(f"quota {quota_status}")
    pressure = quota.get("pressure")
    if pressure is not None:
        pressure = number(pressure, f"runtime quota pressure for {candidate_id}")
    return reasons, warnings, pressure


def assess(candidate, needs, maximum_shortfall):
    dimensions, weighted_gap, weighted_score, weight_sum = {}, 0.0, 0.0, 0.0
    blocking_unknown = False
    critical_gap = False
    complete_score = True
    for dimension, need in needs.items():
        weight = float(need.get("weight", 1.0))
        minimum = float(need["minimum"])
        cell = candidate.get("capabilities", {}).get(dimension)
        if not cell or cell.get("status") == "unknown":
            accepted = bool(need.get("accept_unknown", False))
            gap = 0.0 if accepted else minimum
            blocking_unknown = blocking_unknown or not accepted
            complete_score = False
            dimensions[dimension] = {"status": "unknown", "required": minimum, "accepted": accepted, "shortfall": gap}
        else:
            effective = float(cell["conservative"])
            gap = max(0.0, minimum - effective)
            weighted_score += weight * effective
            dimensions[dimension] = {
                "status": "known",
                "required": minimum,
                "effective": effective,
                "shortfall": gap,
                "assessed_at": cell["assessed_at"],
                "evidence": cell["evidence"],
            }
        weighted_gap += weight * gap
        weight_sum += weight
        if need.get("critical") and gap > 0:
            critical_gap = True
    shortfall = weighted_gap / weight_sum if weight_sum else math.inf
    score = weighted_score / weight_sum if weight_sum and complete_score else None
    sufficient = bool(needs) and not blocking_unknown and not critical_gap and shortfall <= maximum_shortfall
    return {
        "sufficient": sufficient,
        "shortfall": shortfall,
        "score": score,
        "dimensions": dimensions,
    }


def operational(candidate, quality, pressure, current, candidate_id):
    economics = candidate.get("economics", {})
    cost = economics.get("task_cost_usd", {}).get("value")
    speed = economics.get("output_tokens_per_second", {}).get("value")
    return {
        "quality": quality.get("score"),
        "cost": float(cost) if isinstance(cost, (int, float)) else None,
        "latency": 1.0 / float(speed) if isinstance(speed, (int, float)) and speed > 0 else None,
        "quota": pressure,
        "continuity": 0.0 if current == candidate_id else 1.0,
    }


def objective_value(values, name):
    value = values.get(name)
    if value is None:
        return None
    return -value if name == "quality" else value


def dominates(left, right, priority):
    comparable = [
        name
        for name in priority
        if objective_value(left, name) is not None
        and objective_value(right, name) is not None
    ]
    return bool(comparable) and all(
        objective_value(left, name) <= objective_value(right, name)
        for name in comparable
    ) and any(
        objective_value(left, name) < objective_value(right, name)
        for name in comparable
    )


def exact_selection(compiled, route_id):
    rows = compiled["exact"]["config"]["routes"]
    row = rows.get(route_id)
    if row is None:
        raise Error(f"configured route not found: {route_id}")
    return {
        "status": "exact",
        "sufficient": None,
        "selected": {"id": None, **row},
        "exact_route": route_id,
        "provenance": compiled["exact"]["route_provenance"][route_id],
    }


def fallback_selection(compiled, role, reason, candidates):
    row = compiled["exact"]["config"]["routes"][role]
    candidate_id = next(
        (cid for cid, candidate in candidates.items() if candidate["launch"] == row),
        None,
    )
    return {
        "status": "fallback",
        "sufficient": False,
        "selected": {"id": candidate_id, **row},
        "reason": reason,
        "provenance": compiled["exact"]["route_provenance"][role],
    }


def choose(compiled, request, runtime=None):
    routing = compiled["routing"]
    judgment = task_judgment(routing, request)
    if "exact_route" in request:
        route_id = request["exact_route"]
        if not isinstance(route_id, str):
            raise Error("routing request exact_route must be a string")
        if route_id != judgment["role"] and not route_id.startswith(
            f"{judgment['role']}."
        ):
            raise Error(
                f"exact route {route_id!r} does not match role "
                f"{judgment['role']!r}"
            )
        return exact_selection(compiled, route_id)
    candidates = routing["candidates"]
    pin = request.get("pin")
    if pin is not None:
        if not isinstance(pin, dict) or not pin.get("candidate") or not pin.get("reason"):
            raise Error("routing request pin requires candidate and reason")
        candidate = candidates.get(pin["candidate"])
        if candidate is None:
            raise Error(f"unknown pinned candidate: {pin['candidate']}")
        reasons, warnings, _pressure = gate(pin["candidate"], candidate, judgment, runtime, routing.get("policy", {}))
        if reasons:
            return {"status": "no-route", "reason": "pinned candidate is ineligible", "rejected": {pin["candidate"]: reasons}}
        return {
            "status": "pinned",
            "sufficient": None,
            "selected": {"id": pin["candidate"], **candidate["launch"]},
            "reason": pin["reason"],
            "warnings": warnings,
        }
    if not judgment["needs"]:
        return {
            "status": "no-route",
            "reason": "no task requirements were supplied",
        }
    policy = routing.get("policy", {})
    maximum_shortfall = float(policy.get("maximum_shortfall", 0.05))
    admitted, rejected = {}, {}
    for candidate_id, candidate in candidates.items():
        reasons, warnings, pressure = gate(candidate_id, candidate, judgment, runtime, policy)
        if reasons:
            rejected[candidate_id] = reasons
            continue
        quality = assess(candidate, judgment["needs"], maximum_shortfall)
        admitted[candidate_id] = {
            "candidate": candidate,
            "quality": quality,
            "operational": operational(
                candidate,
                quality,
                pressure,
                judgment["current"],
                candidate_id,
            ),
            "warnings": warnings,
        }
    sufficient = {cid: row for cid, row in admitted.items() if row["quality"]["sufficient"]}
    if not sufficient:
        nearest = sorted(admitted, key=lambda cid: (admitted[cid]["quality"]["shortfall"], cid))
        if policy.get("on_no_sufficient", DEFAULT_ON_NO_SUFFICIENT) == "fallback":
            decision = fallback_selection(compiled, judgment["role"], "no research-proven sufficient candidate", candidates)
            decision["nearest"] = nearest[:3]
            decision["rejected"] = rejected
            decision["evaluated"] = {cid: row["quality"] for cid, row in admitted.items()}
            return decision
        return {"status": "no-route", "reason": "no research-proven sufficient candidate", "nearest": nearest[:3], "rejected": rejected, "evaluated": {cid: row["quality"] for cid, row in admitted.items()}}
    priority = judgment["priority"]
    frontier = [
        cid for cid, row in sufficient.items()
        if not any(other != cid and dominates(sufficient[other]["operational"], row["operational"], priority) for other in sufficient)
    ]
    if judgment["switching"] == "avoid" and judgment["current"] in frontier:
        selected_id = judgment["current"]
        selected_by = ["continuity"]
    else:
        selected_id = min(
            frontier,
            key=lambda cid: tuple(
                objective_value(sufficient[cid]["operational"], name)
                if objective_value(sufficient[cid]["operational"], name) is not None
                else math.inf
                for name in priority
            ) + (cid,),
        )
        selected_by = priority
    selected = sufficient[selected_id]
    used_paths = {
        pointer(("candidates", selected_id, "launch", field))
        for field in ("agent", "model", "effort")
    }
    used_paths.update(
        pointer(("candidates", selected_id, "capabilities", dimension, "conservative"))
        for dimension in judgment["needs"]
    )
    used_paths.update(
        pointer(("candidates", selected_id, "economics", metric, "value"))
        for metric in ("task_cost_usd", "output_tokens_per_second")
    )
    return {
        "status": "selected",
        "sufficient": True,
        "selected": {"id": selected_id, **selected["candidate"]["launch"]},
        "judgment": {**judgment, "allow": sorted(judgment["allow"]) if judgment["allow"] is not None else None},
        "quality": selected["quality"],
        "operational": selected["operational"],
        "pareto_frontier": sorted(frontier),
        "selected_by": selected_by,
        "warnings": selected["warnings"],
        "rejected": rejected,
        "provenance": {
            "layers": compiled["layers"],
            "selected_candidate_sources": {
                path: chain for path, chain in compiled["provenance"].items()
                if path in used_paths
            },
        },
    }


def emit(value, compact=False):
    json.dump(value, sys.stdout, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 2)
    sys.stdout.write("\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("report", "choose"))
    parser.add_argument("--repo", default=".")
    parser.add_argument("--request-file", help="JSON file, or - for stdin")
    parser.add_argument("--runtime-file", help="ephemeral runtime JSON")
    parser.add_argument(
        "--quota-axi",
        action="store_true",
        help="read live provider quota with npx -y quota-axi --json",
    )
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args(argv)
    try:
        compiled = compile_policy(args.repo)
        if args.command == "report":
            emit({"routing": compiled["routing"], "layers": compiled["layers"], "provenance": compiled["provenance"]}, args.compact)
            return 0
        if not args.request_file:
            raise Error("choose requires --request-file")
        if args.request_file == "-":
            request = json.load(sys.stdin)
        else:
            request = read_json(Path(args.request_file).expanduser(), "request")
        runtime = {}
        if args.quota_axi:
            runtime = quota_axi_runtime(run_quota_axi(), compiled["routing"])
        if args.runtime_file:
            runtime = merge_runtime(
                runtime,
                read_json(Path(args.runtime_file).expanduser(), "runtime"),
            )
        emit(choose(compiled, request, runtime), args.compact)
        return 0
    except (Error, exact_config.Error, OSError, json.JSONDecodeError) as exc:
        print(f"crew-router: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
