#!/usr/bin/env python3
"""Compile the routing brief and gate-check launch decisions.

The brief hands the spawning agent the information it lacks — candidate
research evidence, economics, live quota, configured exact routes, and the
user's routing preferences. The configured selector (Jev or the spawning agent) judges task fit; `check`
enforces hard gates and the explicit justification required for maximum effort.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time

try:
    import config as exact_config
except ModuleNotFoundError:  # pragma: no cover - package import in tests
    from . import config as exact_config


CATALOG = Path(__file__).resolve().parent.parent / "references" / "routing-catalog.json"
RUNTIME_DEPENDENCIES = (
    Path(__file__).resolve().parent.parent
    / "references"
    / "runtime-dependencies.json"
)
DIMENSIONS = ("reasoning", "implementation", "agentic", "ui", "spatial-3d")
EFFORT_RANK = {
    "minimal": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
    "xhigh": 4,
    "max": 5,
}
MAX_EFFORT_POLICY = (
    "When the same agent and model have an enabled lower-effort candidate, max "
    "is exceptional: check requires --max-effort-basis to explicitly compare the "
    "strongest lower effort and name why it is materially insufficient. Missing "
    "cost evidence or a broad task does not erase the larger reasoning budget."
)
EXACT_ROUTE_SEMANTICS = (
    "Exact routes are dispatch shorthands. Use one only when the principal "
    "requests its route ID for the current task; route names, work descriptions, "
    "and configuration sources never activate one. Otherwise judge each outcome "
    "against Candidates."
)


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


def runtime_dependency(name):
    dependencies = read_json(RUNTIME_DEPENDENCIES, "runtime dependencies")
    dependency = dependencies.get(name)
    if not isinstance(dependency, dict):
        raise Error(f"runtime dependency {name!r} must be an object")
    package = dependency.get("package")
    version = dependency.get("version")
    schema_version = dependency.get("schema_version")
    if not isinstance(package, str) or not package.strip():
        raise Error(f"runtime dependency {name!r} requires package")
    if not isinstance(version, str) or not re.fullmatch(
        r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", version
    ):
        raise Error(f"runtime dependency {name!r} requires an exact version")
    if (
        isinstance(schema_version, bool)
        or not isinstance(schema_version, int)
        or schema_version < 1
    ):
        raise Error(f"runtime dependency {name!r} requires a schema_version")
    return {
        "package": package.strip(),
        "version": version,
        "schema_version": schema_version,
    }


def merge_patch(target, patch):
    """Apply JSON merge-patch semantics: objects merge, null removes."""
    if not isinstance(patch, dict):
        return deepcopy(patch)
    if not isinstance(target, dict):
        target = {}
    result = deepcopy(target)
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        elif isinstance(value, dict):
            result[key] = merge_patch(result.get(key, {}), value)
        else:
            result[key] = deepcopy(value)
    return result


def number(value, label, *, minimum=0.0, maximum=1.0):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise Error(f"{label} must be a number")
    value = float(value)
    if not minimum <= value <= maximum:
        raise Error(f"{label} must be between {minimum} and {maximum}")
    return value


def extract_launch(candidate):
    """Return agent/model/effort when those fields are present.

    Extra or missing launch keys still make the candidate malformed; this
    extracts a match key so an exact route targeting that entry can fail
    closed instead of gating the launch with no candidate evidence.
    """
    if not isinstance(candidate, dict):
        return None
    launch = candidate.get("launch")
    if not isinstance(launch, dict):
        return None
    extracted = {}
    for key in ("agent", "model", "effort"):
        value = launch.get(key)
        if not isinstance(value, str) or not value.strip():
            return None
        extracted[key] = value
    return extracted


def validate_compiled_candidate(candidate_id, candidate):
    label = f"candidate {candidate_id!r}"
    if not isinstance(candidate, dict):
        raise Error(f"{label} must be an object")
    launch = candidate.get("launch")
    if not isinstance(launch, dict) or set(launch) != {"agent", "model", "effort"}:
        raise Error(f"{label}.launch requires only agent, model, and effort")
    if any(
        not isinstance(value, str) or not value.strip() for value in launch.values()
    ):
        raise Error(f"{label}.launch values must be non-empty strings")
    if "enabled" in candidate and not isinstance(candidate["enabled"], bool):
        raise Error(f"{label}.enabled must be boolean")
    if "explicit" in candidate and not isinstance(candidate["explicit"], bool):
        raise Error(f"{label}.explicit must be boolean")
    pool = candidate.get("quota_pool")
    if pool is not None:
        if (
            not isinstance(pool, dict)
            or not isinstance(pool.get("provider"), str)
            or not pool["provider"].strip()
        ):
            raise Error(f"{label}.quota_pool requires the billed provider")
        if not isinstance(pool.get("detail", ""), str):
            raise Error(f"{label}.quota_pool detail must be a string")
    quota_provider = candidate.get("quota_provider")
    if quota_provider is not None:
        if (
            not isinstance(quota_provider, dict)
            or not isinstance(quota_provider.get("provider"), str)
            or not quota_provider["provider"].strip()
        ):
            raise Error(f"{label}.quota_provider requires the billed provider")
        if not isinstance(quota_provider.get("detail", ""), str):
            raise Error(f"{label}.quota_provider detail must be a string")
        if pool is not None:
            raise Error(f"{label} cannot define both quota_pool and quota_provider")
    quota_account = candidate.get("quota_account")
    if quota_account is not None and quota_account not in exact_config.PROVIDERS:
        raise Error(
            f"{label}.quota_account must name a configured provider: "
            + ", ".join(sorted(exact_config.PROVIDERS))
        )
    if pool is not None and quota_account is not None:
        raise Error(f"{label} cannot define both quota_pool and quota_account")
    features = candidate.get("features", [])
    if not isinstance(features, list) or any(
        not isinstance(x, str) for x in features
    ):
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
        if not isinstance(assessment, dict) or assessment.get("status") not in (
            "known",
            "unknown",
        ):
            raise Error(f"{cell} must declare status known or unknown")
        if assessment["status"] == "known":
            number(assessment.get("score"), f"{cell}.score")
            number(assessment.get("conservative"), f"{cell}.conservative")
            assessed_at = assessment.get("assessed_at")
            evidence = assessment.get("evidence")
            if (
                not isinstance(assessed_at, str)
                or not assessed_at.strip()
                or not isinstance(evidence, list)
                or not evidence
                or any(not isinstance(item, str) for item in evidence)
            ):
                raise Error(
                    f"{cell} requires an assessed_at string and string evidence"
                )
            confidence = assessment.get("confidence")
            if not isinstance(confidence, str) or not confidence.strip():
                raise Error(f"{cell}.confidence must be a non-empty string")
            scale = assessment.get("scale")
            if scale is not None and (not isinstance(scale, str) or not scale.strip()):
                raise Error(f"{cell}.scale must be a non-empty string")
        elif not assessment.get("reason") or not assessment.get("researched_at"):
            raise Error(f"{cell} unknown requires reason and researched_at")
    economics = candidate.get("economics", {})
    if not isinstance(economics, dict):
        raise Error(f"{label}.economics must be an object")
    for metric, data in economics.items():
        if not isinstance(data, dict):
            raise Error(f"{label}.economics.{metric} must be an object")
        value = data.get("value")
        if value is None:
            continue
        try:
            finite = (
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
            )
        except OverflowError:
            finite = False
        if not finite:
            raise Error(f"{label}.economics.{metric}.value must be a finite number")
        if metric == "task_cost_usd":
            if value < 0:
                raise Error(
                    f"{label}.economics.{metric}.value must be non-negative"
                )
            basis = data.get("basis", "")
            if isinstance(basis, str) and re.search(
                r"\b(?:minimal|low|medium|high|xhigh|max)\s+proxy\b",
                basis.lower(),
            ):
                raise Error(
                    f"{label}.economics.{metric} requires exact effort evidence; "
                    "effort-level proxy costs must remain unknown"
                )
        if metric == "output_tokens_per_second" and value <= 0:
            raise Error(f"{label}.economics.{metric}.value must be positive")


def validate_compiled_candidates(candidates):
    if not isinstance(candidates, dict) or not candidates:
        raise Error("compiled candidates must be a non-empty object")
    for candidate_id, candidate in candidates.items():
        validate_compiled_candidate(candidate_id, candidate)


def isolate_compiled_candidates(candidates, candidate_sources, accounts, known_launches):
    """Split merged candidates into launchable rows and excluded malformations.

    A malformed entry is omitted from play rather than aborting compile. The
    merged row is not repaired from a lower layer, so a broken overlay cannot
    restore a builtin or drop a restriction by being ignored.
    """
    if not isinstance(candidates, dict) or not candidates:
        raise Error("compiled candidates must be a non-empty object")
    valid = {}
    valid_sources = {}
    malformed = {}
    for candidate_id, candidate in candidates.items():
        try:
            validate_compiled_candidate(candidate_id, candidate)
            provider = candidate.get("quota_account")
            if provider and provider not in accounts:
                raise Error(
                    f"candidate {candidate_id!r}.quota_account names {provider!r}, "
                    f"but configuration has no accounts[{provider!r}]"
                )
        except Error as exc:
            malformed[candidate_id] = {
                "error": str(exc),
                "launch": extract_launch(candidate),
                "known_launches": known_launches.get(candidate_id, []),
                "sources": list(candidate_sources.get(candidate_id, [])),
            }
            continue
        valid[candidate_id] = candidate
        valid_sources[candidate_id] = list(candidate_sources.get(candidate_id, []))
    return valid, valid_sources, malformed


def compile_brief(repo=".", layer_overrides=None):
    catalog = read_json(CATALOG, "routing catalog")
    if catalog.get("version") != 2 or not {
        "routes",
        "methodology",
        "candidates",
    } <= set(catalog):
        raise Error(
            "routing catalog must contain version 2 with routes, methodology, and candidates"
        )
    candidates = deepcopy(catalog["candidates"])
    candidate_sources = {candidate_id: ["builtin"] for candidate_id in candidates}
    # Diagnostic identities survive malformed overlays, without restoring any
    # candidate metadata or making the excluded candidate launchable.
    known_launches = {}

    def remember_launch(candidate_id):
        launch = extract_launch(candidates[candidate_id])
        if launch is not None:
            identities = known_launches.setdefault(candidate_id, [])
            if launch not in identities:
                identities.append(launch)

    for candidate_id in candidates:
        remember_launch(candidate_id)
    preferences = [
        {"scope": "builtin", "text": text.strip()}
        for text in catalog.get("preferences", [])
    ]
    accounts = {}
    paths = exact_config.locations(repo)
    exact = exact_config.resolve(paths)
    for scope in exact_config.SCOPES:
        path = paths[scope]
        if not path.exists() and (layer_overrides is None or scope not in layer_overrides):
            continue
        # Partial layers are valid overlays; only the resolved routes table
        # (already validated inside exact_config.resolve) needs the base rows.
        config = (layer_overrides[scope] if layer_overrides is not None and scope in layer_overrides
                  else exact_config.load(path))
        for text in config.get("preferences", []):
            preferences.append({"scope": scope, "text": text.strip()})
        # Narrower scopes win in the private account registry. A candidate
        # must opt into one of these identities through quota_account.
        accounts.update(config.get("accounts", {}))
        for candidate_id, patch in config.get("candidates", {}).items():
            if patch is None:
                candidates.pop(candidate_id, None)
                candidate_sources.pop(candidate_id, None)
                known_launches.pop(candidate_id, None)
                continue
            candidates[candidate_id] = merge_patch(
                candidates.get(candidate_id, {}), patch
            )
            remember_launch(candidate_id)
            candidate_sources.setdefault(candidate_id, []).append(scope)
    candidates, candidate_sources, malformed = isolate_compiled_candidates(
        candidates, candidate_sources, accounts, known_launches
    )
    return {
        "candidates": candidates,
        "candidate_sources": candidate_sources,
        "malformed_candidates": malformed,
        "preferences": preferences,
        "accounts": accounts,
        "methodology": catalog["methodology"],
        "exact": exact,
        "layers": exact["layers_low_to_high"],
    }


HARD_QUOTA_STATUSES = {"exhausted", "unavailable", "auth-required"}
HARD_RUNTIME_STATUSES = {"unavailable", "auth-required", "unsupported"}
HARD_HEALTH_STATUSES = {"unhealthy", "offline"}
PROVIDER_TO_HARNESS = {"claude": "claude", "codex": "codex", "grok": "grok"}
HARNESS_TO_PROVIDER = {
    harness: provider for provider, harness in PROVIDER_TO_HARNESS.items()
}
QUOTA_DIAGNOSTIC_KEYS = ("detail", "cause", "remedy", "auth_status", "refreshed_at")
POOLED_QUOTA_DETAIL = (
    "served by a rotating credential proxy that selects an account per request, "
    "so no single-account reading describes this candidate"
)


def runtime_for(runtime, candidate_id, candidate):
    """Compose harness and candidate runtime state.

    Candidate-scoped data refines the harness picture, but an account-wide
    hard state (auth, health, exhausted quota) always dominates model-scoped
    data — a per-model quota reading is meaningless once the account is out.
    """
    runtime = runtime or {}
    agent = candidate["launch"]["agent"]
    harnesses = runtime.get("harnesses", {})
    if not isinstance(harnesses, dict):
        raise Error("runtime harnesses must be an object")
    candidate_states = runtime.get("candidates", {})
    if not isinstance(candidate_states, dict):
        raise Error("runtime candidates must be an object")
    harness = harnesses.get(agent, {})
    if not isinstance(harness, dict):
        raise Error(f"runtime harness state for {agent} must be an object")
    harness_quota = harness.get("quota")
    if harness_quota is not None and not isinstance(harness_quota, dict):
        raise Error(f"runtime quota for harness {agent} must be an object")
    pool = candidate.get("quota_pool")
    if isinstance(pool, dict):
        # A pooled candidate does not bill its launch harness: a rotating
        # credential proxy chooses the serving account per request and moves
        # off exhausted ones. The harness's own availability still gates the
        # launch, but no single-account reading describes this candidate's
        # quota, so it stays unknown and takes the acceptance path instead of
        # borrowing a number that describes a different account.
        pooled = deepcopy(harness)
        pooled["quota"] = {
            "status": "pooled",
            "detail": pool.get("detail") or POOLED_QUOTA_DETAIL,
            "account": {"pooled": True, "provider": pool.get("provider")},
        }
        return pooled
    specific = candidate_states.get(candidate_id)
    quota_provider = candidate.get("quota_provider")
    if isinstance(quota_provider, dict):
        # The launch harness and billing provider are different. Keep harness
        # authentication and health, but never inherit a quota reading for an
        # account that this candidate does not bill. A candidate-scoped runtime
        # reading may supply provider quota later; until then it is unknown and
        # follows the explicit acceptance path.
        external = deepcopy(harness)
        external.pop("quota", None)
        if specific is not None:
            if not isinstance(specific, dict):
                raise Error(f"runtime state for {candidate_id} must be an object")
            for key, value in specific.items():
                if key == "status" and external.get(key) in HARD_RUNTIME_STATUSES:
                    continue
                if key == "health" and external.get(key) in HARD_HEALTH_STATUSES:
                    continue
                external[key] = deepcopy(value)
        quota = external.get("quota")
        if not isinstance(quota, dict) or not quota:
            external["quota"] = {
                "status": "unknown",
                "detail": quota_provider.get("detail")
                or (f"live quota is unavailable for {quota_provider['provider']}"),
                "account": {"provider": quota_provider["provider"]},
            }
        else:
            account = quota.setdefault("account", {})
            if isinstance(account, dict):
                account.setdefault("provider", quota_provider["provider"])
        return external
    if specific is None:
        return harness
    if not isinstance(specific, dict):
        raise Error(f"runtime state for {candidate_id} must be an object")
    merged = deepcopy(harness)
    for key, value in specific.items():
        if key == "quota":
            if (
                isinstance(harness_quota, dict)
                and harness_quota.get("status") in HARD_QUOTA_STATUSES
            ):
                continue
        elif key == "status" and merged.get(key) in HARD_RUNTIME_STATUSES:
            continue
        elif key == "health" and merged.get(key) in HARD_HEALTH_STATUSES:
            continue
        merged[key] = deepcopy(value)
    return merged


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


def copy_quota_diagnostics(quota, state, semantics):
    if not isinstance(state, dict):
        state = {}
    if not isinstance(semantics, dict):
        semantics = {}
    error = state.get("error")
    description = semantics.get("description")
    if isinstance(error, str) and error.strip():
        quota["detail"] = error.strip()
    elif isinstance(description, str) and description.strip():
        quota["detail"] = description.strip()
    mapping = (
        ("reason", "cause"),
        ("remedyCommand", "remedy"),
        ("authStatus", "auth_status"),
        ("refreshedAt", "refreshed_at"),
    )
    for source_key, dest_key in mapping:
        value = state.get(source_key)
        if isinstance(value, str) and value.strip():
            quota[dest_key] = value.strip()
    return quota


def quota_from_unusable_state(status, state, semantics=None):
    return copy_quota_diagnostics({"status": status}, state, semantics)


def account_identity(provider, provider_id=None):
    """Identity of the account a provider's quota was measured for.

    Tools that read OAuth quota report whichever account the ambient
    environment selects (for Codex, whatever $CODEX_HOME points at). That
    account is not necessarily the one a spawned agent bills, so the identity
    travels with the reading instead of being dropped.
    """
    account = provider.get("account")
    if not isinstance(account, dict):
        return None
    identity = {}
    for source_key, dest_key in (("email", "email"), ("accountId", "account_id")):
        value = account.get(source_key)
        if isinstance(value, str) and value.strip():
            identity[dest_key] = value.strip()
    if not identity:
        return None
    # Quota is projected across harnesses (a proxy-routed candidate bills the
    # upstream provider's account, not its launch harness), so the reading
    # carries the provider it was measured on rather than letting the consumer
    # infer one from the launch tuple.
    if provider_id:
        identity["provider"] = provider_id
    return identity


def attach_account(state, identity):
    """Stamp the measured account onto a runtime state's quota reading."""
    if not identity or not isinstance(state, dict):
        return state
    quota = state.get("quota")
    if isinstance(quota, dict):
        quota["account"] = deepcopy(identity)
    return state


def project_provider_runtime(generated, candidates, provider_id, state, identity):
    """Attach provider runtime to proxy candidates that declare who bills them."""
    for candidate_id, candidate in candidates.items():
        quota_provider = candidate.get("quota_provider")
        if not isinstance(quota_provider, dict):
            continue
        if quota_provider.get("provider") != provider_id:
            continue
        generated["candidates"][candidate_id] = attach_account(
            deepcopy(state), identity
        )


def quota_axi_runtime(snapshot, candidates):
    dependency = runtime_dependency("quota-axi")
    if snapshot.get("schemaVersion") != dependency["schema_version"] or not isinstance(
        snapshot.get("providers"), list
    ):
        raise Error(
            "quota-axi input must use normalized schemaVersion "
            f"{dependency['schema_version']}"
        )
    generated = {
        "captured_at": snapshot.get("generatedAt"),
        "harnesses": {},
        "candidates": {},
        "notes": [],
    }
    for provider in snapshot["providers"]:
        provider_id = provider.get("provider")
        identity = account_identity(provider, provider_id)
        if provider_id == "kimi":
            detail = "quota-axi cannot read Kimi Code OAuth quota"
            generated["notes"].append(f"quota-axi: {detail}")
            harness_state = {"quota": {"status": "unknown", "detail": detail}}
            generated["harnesses"]["opencode"] = attach_account(
                deepcopy(harness_state), identity
            )
            project_provider_runtime(
                generated, candidates, provider_id, harness_state, identity
            )
            continue
        harness = PROVIDER_TO_HARNESS.get(provider_id)
        if harness is None:
            continue
        state = provider.get("state", {})
        semantics = provider.get("quotaSemantics", {})
        harness_state = {}
        if state.get("status") == "auth_required":
            harness_state["status"] = "auth-required"
            harness_state["quota"] = {"status": "auth-required"}
        elif state.get("stale") or state.get("status") != "fresh":
            harness_state["quota"] = quota_from_unusable_state(
                "stale", state, semantics
            )
        elif semantics.get("status") != "known":
            harness_state["quota"] = quota_from_unusable_state(
                "unknown", state, semantics
            )
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
                for candidate_id, candidate in candidates.items():
                    launch = candidate["launch"]
                    if launch["agent"] == "claude" and "fable" in launch["model"]:
                        remaining = scope.get("effectivePercentRemaining")
                        generated["candidates"][candidate_id] = attach_account(
                            {
                                "quota": {
                                    "status": (
                                        "exhausted" if remaining == 0 else "known"
                                    ),
                                    "pressure": quota_pressure(scope),
                                    "effective_percent_remaining": remaining,
                                    "bounded_by": scope.get("boundedBy", []),
                                    "pace": scope.get("pace", {}),
                                }
                            },
                            identity,
                        )
        generated["harnesses"][harness] = attach_account(harness_state, identity)
        project_provider_runtime(
            generated, candidates, provider_id, harness_state, identity
        )
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


def run_quota_axi(providers=None):
    # --full is required: plain --json omits the per-provider account block, and
    # a quota reading that cannot name its account cannot be checked against the
    # account the launch will actually bill.
    dependency = runtime_dependency("quota-axi")
    package_spec = f"{dependency['package']}@{dependency['version']}"
    command = ["npx", "-y", package_spec, "--json", "--full"]
    if providers:
        command.extend(["--provider", ",".join(providers)])
    result = subprocess.run(
        command,
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


def stale_providers(runtime):
    found = []
    harnesses = runtime.get("harnesses") if isinstance(runtime, dict) else None
    if not isinstance(harnesses, dict):
        return found
    for harness, state in harnesses.items():
        quota = state.get("quota") if isinstance(state, dict) else None
        if not isinstance(quota, dict) or quota.get("status") != "stale":
            continue
        provider = HARNESS_TO_PROVIDER.get(harness)
        if provider and provider not in found:
            found.append(provider)
    return found


def load_quota_axi(candidates):
    runtime = quota_axi_runtime(run_quota_axi(), candidates)
    stale = stale_providers(runtime)
    if not stale:
        return runtime
    try:
        retry = quota_axi_runtime(run_quota_axi(stale), candidates)
    except Error as exc:
        runtime.setdefault("notes", []).append(
            f"quota-axi retry for {', '.join(stale)} failed: {exc}"
        )
        return runtime
    merged = merge_runtime(runtime, retry)
    merged.setdefault("notes", []).append(
        "quota-axi retried stale provider(s): " + ", ".join(stale)
    )
    return merged


def quota_summary(state):
    quota = state.get("quota") if isinstance(state, dict) else None
    if not isinstance(quota, dict) or not quota:
        return {"status": "unknown"}
    summary = {"status": quota.get("status", "unknown")}
    for key in ("effective_percent_remaining", "pressure", "bounded_by", "account"):
        if quota.get(key):
            summary[key] = quota[key]
    for key in QUOTA_DIAGNOSTIC_KEYS:
        if quota.get(key):
            summary[key] = quota[key]
    return summary


def quota_account_email(quota):
    account = quota.get("account") if isinstance(quota, dict) else None
    if not isinstance(account, dict):
        return None
    email = account.get("email")
    return email if isinstance(email, str) and email.strip() else None


def account_phrase(account):
    """How a verdict names the account it describes."""
    if isinstance(account, dict) and account.get("pooled"):
        provider = account.get("provider")
        return f"pooled {provider} accounts" if provider else "pooled accounts"
    email = quota_account_email({"account": account})
    return f"account {email}" if email else "account unattributed"


def gate(
    candidate_id,
    candidate,
    runtime,
    required_features=(),
    minimum_context=None,
    allowed_launchers=None,
    expected_accounts=None,
    explicit_basis=None,
    model_names=None,
):
    """Hard eligibility only. Judgment stays with the agent."""
    reasons, warnings = [], []
    if not candidate.get("enabled", True):
        reasons.append("disabled by configuration")
    elif candidate.get("explicit", False):
        if not explicit_basis:
            reasons.append("explicit-only candidate: do not retry unless the principal requested this model and effort; record that request with --explicit-basis")
        elif problem := explicit_request_problem(explicit_basis, candidate["launch"], model_names):
            reasons.append(problem)
    if allowed_launchers is not None:
        agent = candidate["launch"]["agent"]
        if agent not in allowed_launchers:
            reasons.append(
                f"agent {agent!r} is outside the consumer's launchable "
                "agents: " + ", ".join(sorted(allowed_launchers))
            )
    missing = sorted(set(required_features) - set(candidate.get("features", [])))
    if missing:
        reasons.append("missing features: " + ", ".join(missing))
    if minimum_context is not None:
        available_context = candidate.get("context")
        if available_context is None:
            reasons.append("context capacity unknown")
        elif available_context < minimum_context:
            reasons.append(
                f"context {available_context} below required {minimum_context}"
            )
    state = runtime_for(runtime, candidate_id, candidate)
    if not isinstance(state, dict):
        raise Error(f"runtime state for {candidate_id} must be an object")
    if state.get("status") in HARD_RUNTIME_STATUSES:
        reasons.append(f"runtime status {state['status']}")
    if state.get("health") in HARD_HEALTH_STATUSES:
        reasons.append(f"runtime health {state['health']}")
    quota = state.get("quota", {})
    if not isinstance(quota, dict):
        raise Error(f"runtime quota for {candidate_id} must be an object")
    quota_status = quota.get("status", "unknown")
    measured = quota_account_email(quota)
    # Compare against the provider the reading was measured on. Falling back to
    # the launch harness would check a proxy-routed candidate against the wrong
    # provider's configured account.
    account = quota.get("account") if isinstance(quota, dict) else None
    provider = (account or {}).get("provider") or HARNESS_TO_PROVIDER.get(
        candidate["launch"]["agent"]
    )
    fixed_provider = candidate.get("quota_account")
    expected = (
        (expected_accounts or {}).get(fixed_provider) if fixed_provider else None
    )
    if fixed_provider and provider and fixed_provider != provider:
        reasons.append(
            f"candidate pins quota to {fixed_provider}, but its runtime reading "
            f"comes from {provider}"
        )
    # A reading of the wrong account is not evidence about this launch, whether
    # it reports headroom or exhaustion. Refuse before the status is trusted.
    if expected and measured and expected != measured:
        reasons.append(
            f"quota measured for account {measured}, but this candidate is "
            f"configured to bill {expected}; this reading does not describe "
            "the candidate's fixed launch account"
        )
    elif quota_status in HARD_QUOTA_STATUSES:
        reasons.append(f"quota {quota_status} ({account_phrase(account)})")
    elif quota_status in {"unknown", "stale", "pooled"}:
        # `pooled` is a settled state, not a failed reading: the surface has no
        # single account to measure and rotates off exhausted credentials by
        # itself, so it warns rather than demanding an acceptance for every
        # launch. Acceptance stays for quota that is normally readable and
        # currently is not.
        detail = quota.get("detail")
        base = f"quota {quota_status} ({account_phrase(account)})"
        warnings.append(f"{base}: {detail}" if detail else base)
    # A pooled reading names no account by design, so only an unattributed one
    # is worth flagging against a configured account.
    if expected and not measured and not (account or {}).get("pooled"):
        warnings.append(
            f"quota could not name the account it measured, so it cannot be "
            f"checked against the candidate's fixed {fixed_provider} account "
            f"{expected}"
        )
    return reasons, warnings


def gate_check(
    candidate_id,
    candidate,
    runtime,
    required_features=(),
    minimum_context=None,
    allowed_launchers=None,
    expected_accounts=None,
    explicit_basis=None,
    model_names=None,
):
    """Single gate-and-runtime resolution shared by every decision path."""
    reasons, warnings = gate(
        candidate_id,
        candidate,
        runtime,
        required_features=required_features,
        minimum_context=minimum_context,
        allowed_launchers=allowed_launchers,
        expected_accounts=expected_accounts,
        explicit_basis=explicit_basis,
        model_names=model_names,
    )
    state = runtime_for(runtime, candidate_id, candidate)
    return reasons, warnings, quota_summary(state)


def last_fresh_stamp(value):
    if not isinstance(value, str) or "T" not in value:
        return value
    return value.split("T", 1)[1][:5]


def acceptance_terms(quota, accept_note):
    """Unknown quota never passes silently: it either blocks the decision as
    needs-acceptance or records who accepted launching without live quota."""
    status = quota.get("status", "unknown")
    if status not in {"unknown", "stale"}:
        return None, None
    if accept_note:
        return None, accept_note.strip()
    detail = quota.get("detail")
    if isinstance(detail, str) and detail.strip():
        clause = detail.strip()
        refreshed = quota.get("refreshed_at")
        if isinstance(refreshed, str) and refreshed.strip():
            clause += f" (last fresh {last_fresh_stamp(refreshed)})"
        parts = [clause if clause.endswith((".", "!", "?")) else clause + "."]
        remedy = quota.get("remedy")
        if isinstance(remedy, str) and remedy.strip():
            parts.append(
                f"Run `{remedy.strip()}` with no prompt, wait until the "
                "session has loaded, then exit it and re-check."
            )
        parts.append(
            "Or accept launching without live quota: --accept-quota-unknown "
            '"<who accepted and why>"'
        )
        return " ".join(parts), None
    return (
        f"quota {status}: rerun with --accept-quota-unknown "
        '"<who accepted and why>" after the principal accepts launching '
        "without live quota",
        None,
    )


def match_candidate(compiled, launch):
    return next(
        (
            candidate_id
            for candidate_id, candidate in compiled["candidates"].items()
            if candidate["launch"] == launch
        ),
        None,
    )


def match_malformed_launch(compiled, launch):
    for candidate_id, info in compiled.get("malformed_candidates", {}).items():
        if info.get("launch") == launch or launch in info.get("known_launches", []):
            return candidate_id, info
    return None, None


def refuse_malformed_candidate(compiled, candidate_id):
    info = (compiled.get("malformed_candidates") or {}).get(candidate_id)
    if info is not None:
        raise Error(info["error"])


def refuse_malformed_route_target(compiled, route_id, launch):
    candidate_id, info = match_malformed_launch(compiled, launch)
    if candidate_id is None:
        return
    raise Error(
        f"route {route_id!r} target candidate {candidate_id!r} is malformed: "
        f"{info['error']}"
    )


def candidate_sort_key(item):
    candidate_id, candidate = item
    launch = candidate["launch"]
    effort = launch["effort"]
    return (
        launch["agent"],
        launch["model"],
        EFFORT_RANK.get(effort, len(EFFORT_RANK)),
        effort,
        candidate_id,
    )


def lower_effort_siblings(compiled, candidate_id):
    candidate = compiled["candidates"][candidate_id]
    launch = candidate["launch"]
    if launch["effort"] != "max":
        return []
    siblings = [
        item
        for item in compiled["candidates"].items()
        if item[0] != candidate_id
        and item[1].get("enabled", True)
        and not item[1].get("explicit", False)
        and item[1]["launch"]["agent"] == launch["agent"]
        and item[1]["launch"]["model"] == launch["model"]
        and EFFORT_RANK.get(item[1]["launch"]["effort"], len(EFFORT_RANK))
        < EFFORT_RANK["max"]
    ]
    return [
        sibling_id
        for sibling_id, _candidate in sorted(siblings, key=candidate_sort_key)
    ]


def effort_named(text, effort):
    return (
        re.search(
            rf"(?<![a-z0-9-]){re.escape(effort.lower())}(?![a-z0-9-])",
            text.lower(),
        )
        is not None
    )


def normalized_phrase(value):
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def model_alias(model):
    stem = re.sub(r"\[[^]]*\]$", "", model)
    return re.sub(r"^(?:gpt-\d+(?:\.\d+)?|claude)-", "", stem)


def explicit_request_problem(basis, launch, model_names=None):
    model = launch["model"]
    effort = launch["effort"]
    normalized = normalized_phrase(basis)
    full = normalized_phrase(model)
    alias = normalized_phrase(model_alias(model))
    names = set(model_names or [model])
    alias_unique = sum(normalized_phrase(model_alias(name)) == alias for name in names) == 1
    named_together = any(
        re.search(
            rf"(?<![a-z0-9]){re.escape(name)} (?:at |on |with |using )?{re.escape(effort)}(?: effort)?(?![a-z0-9])",
            normalized,
        )
        for name in ([full, alias] if alias_unique else [full])
    )
    if not named_together or not effort_named(basis, effort):
        return f"explicit basis must name {model} (or its unique alias) and effort {effort}"
    return None


def gate_launch(
    compiled,
    launch,
    candidate_id,
    runtime,
    args,
    allowed_launchers,
    unmatched_label,
):
    expected_accounts = compiled.get("accounts", {})
    if candidate_id is not None:
        return gate_check(
            candidate_id,
            compiled["candidates"][candidate_id],
            runtime,
            required_features=args.require_feature,
            minimum_context=args.minimum_context,
            allowed_launchers=allowed_launchers,
            expected_accounts=expected_accounts,
            explicit_basis=getattr(args, "explicit_basis", None),
            model_names={candidate["launch"]["model"] for candidate in compiled["candidates"].values()},
        )
    if args.require_feature or args.minimum_context is not None:
        raise Error(
            "feature and context gates need candidate evidence; "
            f"{unmatched_label} matches no configured candidate"
        )
    return gate_check(
        unmatched_label,
        {"launch": launch},
        runtime,
        allowed_launchers=allowed_launchers,
        expected_accounts=expected_accounts,
        explicit_basis=getattr(args, "explicit_basis", None),
        model_names={candidate["launch"]["model"] for candidate in compiled["candidates"].values()},
    )


def planned_quota_fallback(row):
    policy = exact_config.quota_unusable_policy(row)
    if not policy:
        return None
    return {
        "ask_seconds": policy["ask_seconds"],
        "launch": policy["launch"],
        "next": (
            f"Ask the principal. If they do not answer within "
            f"{policy['ask_seconds']}s, re-check this exact route with "
            '--use-quota-fallback "<who waited and how long>".'
        ),
    }


def parse_allowed_launchers(values):
    if not values:
        return None
    allowed = {
        launcher.strip()
        for value in values
        for launcher in value.split(",")
        if launcher.strip()
    }
    if not allowed:
        raise Error("--launchable-via requires catalog agent tokens")
    return allowed


def _check(compiled, args, runtime):
    if bool(args.candidate) == bool(args.exact_route):
        raise Error("check requires exactly one of --candidate or --exact-route")
    allowed_launchers = parse_allowed_launchers(args.launchable_via)
    if args.accept_quota_unknown is not None and not args.accept_quota_unknown.strip():
        raise Error("--accept-quota-unknown requires the acceptance basis as its value")
    if args.max_effort_basis is not None and not args.max_effort_basis.strip():
        raise Error("--max-effort-basis requires the comparison basis as its value")
    if args.exact_route and args.max_effort_basis is not None:
        raise Error(
            "--max-effort-basis applies to --candidate; exact routes record "
            "--route-basis"
        )
    if args.route_basis is not None and not args.exact_route:
        raise Error("--route-basis requires --exact-route")
    if args.exact_route and (args.route_basis is None or not args.route_basis.strip()):
        raise Error(
            "check --exact-route requires --route-basis with the principal's "
            "request for this task"
        )
    explicit_basis = getattr(args, "explicit_basis", None)
    if explicit_basis is not None and not explicit_basis.strip():
        raise Error("--explicit-basis requires the principal's request as its value")
    if args.exact_route and args.reason is not None:
        raise Error(
            "--reason applies to --candidate; exact routes record --route-basis"
        )
    if args.use_quota_fallback is not None:
        if not args.exact_route:
            raise Error("--use-quota-fallback requires --exact-route")
        if not args.use_quota_fallback.strip():
            raise Error("--use-quota-fallback requires the wait basis as its value")
    if args.exact_route:
        route_context = {
            "exact_route": args.exact_route,
            "route_basis": args.route_basis.strip(),
        }
        rows = compiled["exact"]["config"]["routes"]
        row = rows.get(args.exact_route)
        if row is None:
            raise Error(f"configured route not found: {args.exact_route}")
        launch = exact_config.launch_of(row)
        candidate_id = match_candidate(compiled, launch)
        fallback_policy = exact_config.quota_unusable_policy(row)
        fallback_id = match_candidate(compiled, fallback_policy["launch"]) if fallback_policy else None
        if explicit_basis and not any(
            compiled["candidates"][item].get("explicit", False)
            for item in (candidate_id, fallback_id) if item is not None
        ):
            raise Error("--explicit-basis applies only to an explicit candidate or quota fallback")
        if candidate_id is None:
            refuse_malformed_route_target(compiled, args.exact_route, launch)
        reasons, warnings, quota = gate_launch(
            compiled,
            launch,
            candidate_id,
            runtime,
            args,
            allowed_launchers,
            f"route {args.exact_route!r}",
        )
        if reasons:
            refusal = {
                "status": "refused",
                **route_context,
                "reasons": reasons,
                "warnings": warnings,
                "route_provenance": compiled["exact"]["route_provenance"][
                    args.exact_route
                ],
            }
            if candidate_id is not None:
                refusal["candidate"] = candidate_id
                refusal["candidate_sources"] = compiled["candidate_sources"].get(
                    candidate_id, []
                )
            return refusal
        pending, acceptance = acceptance_terms(quota, args.accept_quota_unknown)
        if pending and args.use_quota_fallback:
            policy = exact_config.quota_unusable_policy(row)
            if not policy:
                raise Error(
                    f"route {args.exact_route!r} has no on_quota_unusable fallback"
                )
            fallback_launch = policy["launch"]
            fallback_id = match_candidate(compiled, fallback_launch)
            if fallback_id is None:
                refuse_malformed_route_target(
                    compiled, args.exact_route, fallback_launch
                )
            fb_reasons, fb_warnings, fb_quota = gate_launch(
                compiled,
                fallback_launch,
                fallback_id,
                runtime,
                args,
                allowed_launchers,
                f"route {args.exact_route!r} quota fallback",
            )
            if fb_reasons:
                refusal = {
                    "status": "refused",
                    **route_context,
                    "reasons": [
                        f"quota fallback refused: {reason}" for reason in fb_reasons
                    ],
                    "warnings": warnings + fb_warnings,
                    "route_provenance": compiled["exact"]["route_provenance"][
                        args.exact_route
                    ],
                    "quota_fallback": {
                        "used": False,
                        "from": launch,
                        "to": fallback_launch,
                        "ask_seconds": policy["ask_seconds"],
                        "basis": args.use_quota_fallback.strip(),
                    },
                }
                if fallback_id is not None:
                    refusal["candidate"] = fallback_id
                    refusal["candidate_sources"] = compiled["candidate_sources"].get(
                        fallback_id, []
                    )
                return refusal
            fb_pending, _fb_acceptance = acceptance_terms(fb_quota, None)
            if fb_pending:
                decision = {
                    "status": "needs-acceptance",
                    "selected": {"id": candidate_id, **launch},
                    **route_context,
                    "pending": [
                        pending,
                        "configured fallback also has unknown or stale quota",
                    ],
                    "warnings": warnings + fb_warnings,
                    "quota": quota,
                    "quota_fallback": planned_quota_fallback(row),
                }
                return decision
            used = {
                "used": True,
                "from": launch,
                "to": fallback_launch,
                "ask_seconds": policy["ask_seconds"],
                "basis": args.use_quota_fallback.strip(),
            }
            decision = {
                "status": "exact",
                "selected": {"id": fallback_id, **fallback_launch},
                **route_context,
                "provenance": compiled["exact"]["route_provenance"][args.exact_route],
                "warnings": warnings
                + fb_warnings
                + [
                    "used quota fallback after wait: "
                    f"{launch['agent']}/{launch['model']}/{launch['effort']} → "
                    f"{fallback_launch['agent']}/{fallback_launch['model']}/"
                    f"{fallback_launch['effort']}"
                ],
                "quota": fb_quota,
                "quota_fallback": used,
            }
            return decision
        if pending:
            decision = {
                "status": "needs-acceptance",
                "selected": {"id": candidate_id, **launch},
                **route_context,
                "pending": [pending],
                "warnings": warnings,
                "quota": quota,
            }
            planned = planned_quota_fallback(row)
            if planned:
                decision["quota_fallback"] = planned
            return decision
        decision = {
            "status": "exact",
            "selected": {"id": candidate_id, **launch},
            **route_context,
            "provenance": compiled["exact"]["route_provenance"][args.exact_route],
            "warnings": warnings,
            "quota": quota,
        }
        if acceptance:
            decision["quota_acceptance"] = acceptance
        return decision
    candidate = compiled["candidates"].get(args.candidate)
    if candidate is None:
        refuse_malformed_candidate(compiled, args.candidate)
        known = ", ".join(sorted(compiled["candidates"]))
        raise Error(
            f"unknown candidate: {args.candidate}; launchable candidates: {known}"
        )
    if not args.reason or not args.reason.strip():
        raise Error("check --candidate requires --reason with the task judgment")
    if explicit_basis and not candidate.get("explicit", False):
        raise Error("--explicit-basis applies only to an explicit candidate")
    lower_effort = lower_effort_siblings(compiled, args.candidate)
    reasons, warnings, quota = gate_check(
        args.candidate,
        candidate,
        runtime,
        required_features=args.require_feature,
        minimum_context=args.minimum_context,
        allowed_launchers=allowed_launchers,
        expected_accounts=compiled.get("accounts", {}),
        explicit_basis=explicit_basis,
        model_names={row["launch"]["model"] for row in compiled["candidates"].values()},
    )
    if lower_effort and not candidate.get("explicit", False):
        strongest_lower = lower_effort[-1]
        strongest_effort = compiled["candidates"][strongest_lower]["launch"]["effort"]
        if args.max_effort_basis is None:
            reasons.insert(
                0,
                "maximum effort needs an explicit comparison against enabled "
                "lower-effort candidates: "
                + ", ".join(lower_effort)
                + '; rerun with --max-effort-basis "<why the strongest lower '
                'effort is materially insufficient>"',
            )
        elif not effort_named(args.max_effort_basis, strongest_effort):
            reasons.insert(
                0,
                "maximum effort basis must explicitly compare the strongest "
                f"lower effort ({strongest_effort}: {strongest_lower})",
            )
    if reasons:
        decision = {
            "status": "refused",
            "candidate": args.candidate,
            "reasons": reasons,
            "warnings": warnings,
        }
        if lower_effort and not candidate.get("explicit", False):
            decision["lower_effort_candidates"] = lower_effort
        return decision
    pending, acceptance = acceptance_terms(quota, args.accept_quota_unknown)
    if pending:
        decision = {
            "status": "needs-acceptance",
            "candidate": args.candidate,
            "selected": {"id": args.candidate, **candidate["launch"]},
            "reason": args.reason.strip(),
            "pending": [pending],
            "warnings": warnings,
            "quota": quota,
        }
        if lower_effort and not candidate.get("explicit", False):
            decision["lower_effort_candidates"] = lower_effort
            decision["max_effort_basis"] = args.max_effort_basis.strip()
        return decision
    decision = {
        "status": "selected",
        "selected": {"id": args.candidate, **candidate["launch"]},
        "reason": args.reason.strip(),
        "warnings": warnings,
        "quota": quota,
        "sources": compiled["candidate_sources"].get(args.candidate, []),
    }
    if lower_effort and not candidate.get("explicit", False):
        decision["lower_effort_candidates"] = lower_effort
        decision["max_effort_basis"] = args.max_effort_basis.strip()
    if acceptance:
        decision["quota_acceptance"] = acceptance
    return decision


def check(compiled, args, runtime):
    decision = _check(compiled, args, runtime)
    basis = getattr(args, "explicit_basis", None)
    if basis and basis.strip():
        decision["explicit_basis"] = basis.strip()
    return decision


markdown_cell = exact_config.markdown_cell


def capability_cell(candidate, dimension, scale_keys=None):
    cell = candidate.get("capabilities", {}).get(dimension)
    if not cell or cell.get("status") != "known":
        return "?"
    confidence = (cell.get("confidence") or "?")[:1]
    key = (scale_keys or {}).get(cell_scale(cell))
    marker = f", {key}" if key else ""
    return f"{cell['conservative']:.2f} ({confidence}{marker})"


def cell_scale(cell):
    scale = cell.get("scale")
    return scale.strip() if isinstance(scale, str) and scale.strip() else "unlabelled"


def mixed_scales(candidates):
    """Letter each scale in a dimension whose known cells use more than one."""
    mixed = {}
    for dimension in DIMENSIONS:
        scales = sorted({
            cell_scale(cell)
            for candidate in candidates
            if candidate.get("enabled", True)
            for cell in [candidate.get("capabilities", {}).get(dimension)]
            if cell and cell.get("status") == "known"
        })
        if len(scales) > 1:
            mixed[dimension] = {
                scale: chr(ord("A") + index) for index, scale in enumerate(scales)
            }
    return mixed


def economics_cells(candidate):
    economics = candidate.get("economics", {})
    cost = economics.get("task_cost_usd", {}).get("value")
    speed = economics.get("output_tokens_per_second", {}).get("value")
    return (
        f"${cost:.2f}" if isinstance(cost, (int, float)) else "?",
        f"{speed:.0f}" if isinstance(speed, (int, float)) else "?",
    )


def quota_unusable_cell(row):
    policy = exact_config.quota_unusable_policy(row)
    if not policy:
        return "ask"
    fallback = policy["launch"]
    return (
        f"ask {policy['ask_seconds']}s → "
        f"{fallback['agent']}/{fallback['model']}/{fallback['effort']}"
    )


def quota_cell(state):
    summary = quota_summary(state)
    status = summary["status"]
    remaining = summary.get("effective_percent_remaining")
    if status == "known" and remaining is not None:
        window = "/".join(summary.get("bounded_by", [])) or "window"
        pressure = summary.get("pressure")
        suffix = (
            f", pace -{pressure * 100:.0f}pp"
            if isinstance(pressure, (int, float)) and pressure > 0
            else ""
        )
        return f"{remaining:.0f}% of {window}{suffix}"
    return status


def brief_candidates(compiled, allowed_launchers):
    return {
        candidate_id: candidate
        for candidate_id, candidate in compiled["candidates"].items()
        if allowed_launchers is None
        or candidate["launch"]["agent"] in allowed_launchers
    }


def brief_layers(compiled, candidates):
    candidate_ids = set(candidates)
    layers = deepcopy(compiled["layers"])
    for layer in layers:
        layer["candidates_defined"] = [
            candidate_id
            for candidate_id in layer.get("candidates_defined", [])
            if candidate_id in candidate_ids
        ]
    return layers


def brief_runtime(runtime, candidates):
    if not runtime:
        return runtime
    visible = deepcopy(runtime)
    candidate_ids = set(candidates)
    agents = {candidate["launch"]["agent"] for candidate in candidates.values()}
    if isinstance(visible.get("candidates"), dict):
        visible["candidates"] = {
            candidate_id: state
            for candidate_id, state in visible["candidates"].items()
            if candidate_id in candidate_ids
        }
    if isinstance(visible.get("harnesses"), dict):
        visible["harnesses"] = {
            agent: state
            for agent, state in visible["harnesses"].items()
            if agent in agents
        }
    return visible


def brief_markdown(compiled, runtime, repo_root, allowed_launchers=None):
    if not runtime:
        live_quota = "not loaded"
    elif runtime.get("captured_at"):
        live_quota = f"yes, captured {runtime['captured_at']}"
    else:
        live_quota = "requested but unavailable — see notes"
    lines = [
        "# Routing brief",
        "",
        f"**Repo:** {repo_root}",
        f"**Live quota:** {live_quota}",
    ]
    if allowed_launchers is not None:
        lines.append("**Launchable agents:** " + ", ".join(sorted(allowed_launchers)))
    lines += ["", "## Routing preferences", ""]
    if compiled["preferences"]:
        lines.append(
            "Listed low scope to high. On conflict: the principal's current "
            "request wins; then the higher scope; then, within a scope, the "
            "narrower applicable condition; then the later line. Ask when "
            "applicability stays ambiguous."
        )
        lines.append("")
        for entry in compiled["preferences"]:
            lines.append(f"- ({entry['scope']}) {entry['text']}")
    else:
        lines.append("None configured.")
    lines += [
        "",
        "## Exact routes",
        "",
        EXACT_ROUTE_SEMANTICS,
        "",
        "| Route | Intended work | Agent | Model | Effort | Source | If quota unusable |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for route, row in compiled["exact"]["config"]["routes"].items():
        source = compiled["exact"]["route_sources"][route]["scope"]
        lines.append(
            f"| {markdown_cell(route)} | {markdown_cell(row.get('work', '—'))} "
            f"| {markdown_cell(row['agent'])} | {markdown_cell(row['model'])} "
            f"| {markdown_cell(row['effort'])} | {markdown_cell(source)} "
            f"| {markdown_cell(quota_unusable_cell(row))} |"
        )
    lines += [
        "",
        "## Candidates",
        "",
        "Capability cells show the conservative research estimate with "
        "confidence (h/m/l); `?` means no public evidence. Cost is the "
        "benchmark cost of one task only when the source names the exact model "
        "and effort; effort proxies stay `?`. Quota is provider-local: "
        "remaining share of that provider's own window plus its pace "
        "deficit — never compare raw percentages across providers; "
        "quota-lighter means less pace pressure and more runway within "
        "the candidate's own provider. Candidates sharing an agent and model "
        "are ordered from lower to higher effort.",
        "",
        MAX_EFFORT_POLICY,
        "",
    ]
    candidates = brief_candidates(compiled, allowed_launchers)
    ordinary = {candidate_id: candidate for candidate_id, candidate in candidates.items()
                if candidate.get("enabled", True) and not candidate.get("explicit", False)}
    mixed = mixed_scales(ordinary.values())
    if mixed:
        lines += [
            "Scores in one column are comparable only on the same scale. "
            "Where a column mixes scales, each cell names its scale by letter; "
            "never rank cells with different letters against each other.",
            "",
        ]
        for dimension, keys in mixed.items():
            lines.append(
                f"- {dimension}: "
                + "; ".join(f"{key} = {scale}" for scale, key in keys.items())
            )
        lines.append("")
    lines += [
        "| Candidate | State | Reasoning | Impl | Agentic | UI | 3D | $/task | tok/s | Context | Quota |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for candidate_id, candidate in sorted(ordinary.items(), key=candidate_sort_key):
        cost, speed = economics_cells(candidate)
        context = candidate.get("context")
        state = runtime_for(runtime, candidate_id, candidate)
        lines.append(
            f"| {markdown_cell(candidate_id)} "
            "| enabled "
            f"| {capability_cell(candidate, 'reasoning', mixed.get('reasoning'))} "
            f"| {capability_cell(candidate, 'implementation', mixed.get('implementation'))} "
            f"| {capability_cell(candidate, 'agentic', mixed.get('agentic'))} "
            f"| {capability_cell(candidate, 'ui', mixed.get('ui'))} "
            f"| {capability_cell(candidate, 'spatial-3d', mixed.get('spatial-3d'))} "
            f"| {cost} | {speed} "
            f"| {f'{context:,}' if context else '?'} "
            f"| {markdown_cell(quota_cell(state) if runtime else 'not loaded')} |"
        )
    explicit = sorted(
        candidate_id for candidate_id, candidate in candidates.items()
        if candidate.get("enabled", True) and candidate.get("explicit", False)
    )
    if explicit:
        lines += ["", "Explicit only — select these only when the principal requested both the model and effort:"]
        lines += [f"- {candidate_id}" for candidate_id in explicit]
    disabled = sorted(
        candidate_id
        for candidate_id, candidate in candidates.items()
        if not candidate.get("enabled", True)
    )
    if disabled:
        lines += ["", "Disabled by configuration: " + ", ".join(disabled)]
    malformed = compiled.get("malformed_candidates") or {}
    if malformed:
        lines += ["", "Excluded malformed candidates:"]
        for candidate_id, info in sorted(malformed.items()):
            lines.append(f"- {candidate_id}: {info['error']}")
    if runtime and runtime.get("notes"):
        lines += [""] + [f"Note: {note}" for note in runtime["notes"]]
    lines += [
        "",
        "## Evidence",
        "",
    ]
    for candidate_id, candidate in sorted(candidates.items(), key=candidate_sort_key):
        lines.append(f"### {candidate_id}")
        lines.append("")
        sources = compiled["candidate_sources"].get(candidate_id, [])
        if sources != ["builtin"]:
            lines.append(f"- configured by: {', '.join(sources)}")
        features = candidate.get("features", [])
        if features:
            lines.append(f"- features: {', '.join(features)}")
        for dimension in DIMENSIONS:
            cell = candidate.get("capabilities", {}).get(dimension)
            if not cell:
                continue
            if cell.get("status") == "known":
                note = cell.get("note")
                suffix = (
                    f". {note.strip()}"
                    if isinstance(note, str) and note.strip()
                    else ""
                )
                lines.append(
                    f"- {dimension}: score {cell['score']}, conservative "
                    f"{cell['conservative']}, {cell.get('confidence', '?')} confidence, "
                    f"assessed {cell['assessed_at']}, scale {cell_scale(cell)} — "
                    + ", ".join(cell.get("evidence", []))
                    + suffix
                )
            else:
                lines.append(
                    f"- {dimension}: unknown — {cell.get('reason', 'no evidence')}"
                )
        economics = candidate.get("economics", {})
        for metric, unit in (
            ("task_cost_usd", "USD/task"),
            ("output_tokens_per_second", "tok/s"),
        ):
            data = economics.get(metric)
            if isinstance(data, dict) and data.get("value") is not None:
                lines.append(
                    f"- {metric}: {data['value']} {unit} "
                    f"({data.get('basis', '?')}, {data.get('assessed_at', '?')})"
                )
        lines.append("")
    lines += ["## Evidence methodology", ""]
    for key, text in compiled["methodology"].items():
        lines.append(f"- {key}: {text}")
    return "\n".join(lines) + "\n"


def brief_json(compiled, runtime, repo_root, allowed_launchers=None):
    candidates = brief_candidates(compiled, allowed_launchers)
    return {
        "repo": str(repo_root),
        "launchable_agents": (
            sorted(allowed_launchers) if allowed_launchers is not None else None
        ),
        "preferences": compiled["preferences"],
        "routes": {
            "semantics": EXACT_ROUTE_SEMANTICS,
            "effective": compiled["exact"]["config"]["routes"],
            "sources": compiled["exact"]["route_sources"],
        },
        "candidates": candidates,
        "candidate_sources": {
            candidate_id: compiled["candidate_sources"].get(candidate_id, [])
            for candidate_id in candidates
        },
        "malformed_candidates": compiled.get("malformed_candidates") or {},
        "candidate_policy": {
            "maximum_effort": MAX_EFFORT_POLICY,
            "explicit": "An explicit-only candidate may be checked only with --explicit-basis recording the principal's request for its model and effort. Ordinary selectors exclude it.",
        },
        "methodology": compiled["methodology"],
        "layers": brief_layers(compiled, candidates),
        "runtime": brief_runtime(runtime, candidates) or None,
    }


def emit(value, compact=False):
    json.dump(
        value,
        sys.stdout,
        ensure_ascii=False,
        separators=(",", ":") if compact else None,
        indent=None if compact else 2,
    )
    sys.stdout.write("\n")


def load_runtime(args, candidates):
    runtime = {}
    if args.quota_axi:
        try:
            runtime = load_quota_axi(candidates)
        except Error as exc:
            # Degrade, never fabricate: quota stays unknown everywhere, the
            # failure is on record, and check() forces the acceptance flow.
            runtime = {
                "captured_at": None,
                "harnesses": {},
                "candidates": {},
                "notes": [
                    f"quota-axi failed: {exc}; quota is unknown for every candidate"
                ],
            }
    if args.runtime_file:
        runtime = merge_runtime(
            runtime,
            read_json(Path(args.runtime_file).expanduser(), "runtime"),
        )
    return runtime


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("brief", "check", "route", "setup", "status"))
    parser.add_argument("--selector", choices=("agent", "jev"), help="machine-wide choice for setup")
    parser.add_argument("--task-file", help="Jev task context JSON")
    parser.add_argument("--allow-model", action="append", default=[], help="principal-required model, repeatable")
    parser.add_argument("--allow-effort", action="append", default=[], help="principal-required effort, repeatable")
    parser.add_argument("--allow-abstain", action="store_true", help="let Jev decline when no candidate can start or carry out the scope")
    parser.add_argument("--require-zdr", action="store_true", help="require Gateway zero data retention")
    parser.add_argument("--repo", default=".")
    parser.add_argument("--candidate", help="candidate ID chosen from the brief")
    parser.add_argument(
        "--exact-route", help="principal-requested route ID for deterministic dispatch"
    )
    parser.add_argument(
        "--route-basis",
        help="verbatim principal request authorizing the exact route for this task",
    )
    parser.add_argument(
        "--reason",
        help="the task judgment behind the candidate pick; recorded verbatim",
    )
    parser.add_argument(
        "--explicit-basis",
        help="verbatim principal request naming this explicit-only model and effort",
    )
    parser.add_argument(
        "--max-effort-basis",
        help=(
            "why the strongest enabled lower effort for the same agent and model "
            "is materially insufficient; name that effort explicitly"
        ),
    )
    parser.add_argument(
        "--require-feature",
        action="append",
        default=[],
        help="hard feature requirement, repeatable",
    )
    parser.add_argument("--minimum-context", type=int)
    parser.add_argument(
        "--launchable-via",
        action="append",
        default=[],
        help="catalog agent tokens the consumer's mechanism can launch (CSV, repeatable)",
    )
    parser.add_argument(
        "--accept-quota-unknown",
        help="who accepted launching without live quota, and why",
    )
    parser.add_argument(
        "--use-quota-fallback",
        help="after the configured ask wait, use the exact route's quota fallback",
    )
    parser.add_argument("--runtime-file", help="ephemeral runtime JSON")
    parser.add_argument(
        "--quota-axi",
        action="store_true",
        help="read live provider quota with the pinned quota-axi dependency",
    )
    parser.add_argument("--format", choices=("markdown", "json"), default=None)
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--session-ref", help="opaque ID of the spawning session for the private routing journal")
    args = parser.parse_args(argv)
    # Extensions import router; keep CLI and imported exception types identical.
    sys.modules.setdefault("router", sys.modules[__name__])
    import selector
    import jev
    import routing_log
    started = time.monotonic()
    try:
        if args.allow_abstain and args.command != "route":
            raise jev.Error("--allow-abstain applies only to route.")
        if args.command in ("setup", "status"):
            result = selector.setup(args.selector) if args.command == "setup" else selector.status()
            emit(result, args.compact)
            return 0 if result["status"] == "ready" else 2
        compiled = compile_brief(args.repo)
        repo_root, _common = exact_config.repo_info(args.repo)
        if args.command == "brief":
            allowed_launchers = parse_allowed_launchers(args.launchable_via)
            visible_candidates = brief_candidates(compiled, allowed_launchers)
            runtime = load_runtime(args, visible_candidates)
            if args.format == "json":
                emit(
                    brief_json(compiled, runtime, repo_root, allowed_launchers),
                    args.compact,
                )
            else:
                sys.stdout.write(
                    brief_markdown(compiled, runtime, repo_root, allowed_launchers)
                )
            return 0
        runtime = load_runtime(args, compiled["candidates"])
        decision = selector.route(compiled, args, runtime) if args.command == "route" else check(compiled, args, runtime)
        config_hash = hashlib.sha256(json.dumps({
            "candidates": compiled["candidates"],
            "preferences": compiled["preferences"],
            "exact": compiled["exact"]["config"],
        }, sort_keys=True, default=str).encode()).hexdigest()[:24]
        decision["decision_id"] = routing_log.decision(
            decision, command=args.command, repo=repo_root,
            elapsed_ms=round((time.monotonic() - started) * 1000),
            session_ref=args.session_ref, config_hash=config_hash,
            allow_abstain=args.allow_abstain, constraints={
                "routing.candidate_count": len(compiled["candidates"]),
                "routing.launchable_via": ",".join(sorted(parse_allowed_launchers(args.launchable_via) or ())),
                "routing.required_features": ",".join(sorted(args.require_feature)),
                "routing.minimum_context": args.minimum_context,
                "routing.allowed_models": ",".join(sorted(args.allow_model)),
                "routing.allowed_efforts": ",".join(sorted(args.allow_effort)),
            })
        emit(decision, args.compact)
        if decision["status"] == "refused":
            return 1
        if decision["status"] == "needs-acceptance":
            return 2
        return 0
    except (Error, exact_config.Error, jev.Error, OSError, json.JSONDecodeError) as exc:
        if args.command in ("check", "route"):
            try:
                routing_log.failure(
                    command=args.command, repo=args.repo, error=exc,
                    elapsed_ms=round((time.monotonic() - started) * 1000),
                    session_ref=args.session_ref)
            except (routing_log.Error, OSError) as log_exc:
                print(f"model-routing: routing journal failed: {log_exc}", file=sys.stderr)
        print(f"model-routing: {exc}", file=sys.stderr)
        return 1
    except routing_log.Error as exc:
        print(f"model-routing: routing journal failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
