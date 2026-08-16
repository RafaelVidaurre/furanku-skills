#!/usr/bin/env python3
"""Compile the routing brief and gate-check launch decisions.

The brief hands the spawning agent the information it lacks — candidate
research evidence, economics, live quota, configured exact routes, and the
user's routing preferences. The judgment about which candidate fits a task
belongs to the agent reading the brief; `check` enforces only hard gates.
"""

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
DIMENSIONS = ("reasoning", "implementation", "agentic", "ui", "spatial-3d")
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


def validate_compiled_candidates(candidates):
    if not isinstance(candidates, dict) or not candidates:
        raise Error("compiled candidates must be a non-empty object")
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
        pool = candidate.get("quota_pool")
        if pool is not None:
            if not isinstance(pool, dict) or not pool.get("provider"):
                raise Error(f"{label}.quota_pool requires the billed provider")
            if not isinstance(pool.get("detail", ""), str):
                raise Error(f"{label}.quota_pool detail must be a string")
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
                finite = not isinstance(value, bool) and isinstance(
                    value, (int, float)
                ) and math.isfinite(float(value))
            except OverflowError:
                finite = False
            if not finite:
                raise Error(f"{label}.economics.{metric}.value must be a finite number")
            if metric == "task_cost_usd" and value < 0:
                raise Error(f"{label}.economics.{metric}.value must be non-negative")
            if metric == "output_tokens_per_second" and value <= 0:
                raise Error(f"{label}.economics.{metric}.value must be positive")


def compile_brief(repo="."):
    catalog = read_json(CATALOG, "routing catalog")
    if catalog.get("version") != 2 or not {"routes", "methodology", "candidates"} <= set(catalog):
        raise Error("routing catalog must contain version 2 with routes, methodology, and candidates")
    candidates = deepcopy(catalog["candidates"])
    candidate_sources = {candidate_id: ["builtin"] for candidate_id in candidates}
    preferences = []
    accounts = {}
    paths = exact_config.locations(repo)
    exact = exact_config.resolve(paths)
    for scope in exact_config.SCOPES:
        path = paths[scope]
        if not path.exists():
            continue
        # Partial layers are valid overlays; only the resolved routes table
        # (already validated inside exact_config.resolve) needs the base rows.
        config = exact_config.load(path)
        for text in config.get("preferences", []):
            preferences.append({"scope": scope, "text": text.strip()})
        # Narrower scopes win: the machine states which account a provider
        # bills, and a project may override it.
        accounts.update(config.get("accounts", {}))
        for candidate_id, patch in config.get("candidates", {}).items():
            if patch is None:
                candidates.pop(candidate_id, None)
                candidate_sources.pop(candidate_id, None)
                continue
            candidates[candidate_id] = merge_patch(
                candidates.get(candidate_id, {}), patch
            )
            candidate_sources.setdefault(candidate_id, []).append(scope)
    validate_compiled_candidates(candidates)
    return {
        "candidates": candidates,
        "candidate_sources": candidate_sources,
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


def quota_axi_runtime(snapshot, candidates):
    if snapshot.get("schemaVersion") != 3 or not isinstance(snapshot.get("providers"), list):
        raise Error("quota-axi input must use normalized schemaVersion 3")
    generated = {
        "captured_at": snapshot.get("generatedAt"),
        "harnesses": {},
        "candidates": {},
        "notes": [],
    }
    for provider in snapshot["providers"]:
        provider_id = provider.get("provider")
        if provider_id == "kimi":
            detail = (
                "quota-axi cannot read Kimi Code OAuth quota; OpenCode and "
                "Claudex K3 spend the same account window, so quota stays unknown"
            )
            generated["notes"].append(f"quota-axi: {detail}")
            generated["harnesses"]["opencode"] = {
                "quota": {"status": "unknown", "detail": detail}
            }
            for candidate_id, candidate in candidates.items():
                launch = candidate["launch"]
                if launch["agent"] == "claude" and "kimi" in launch["model"]:
                    generated["candidates"][candidate_id] = {
                        "quota": {"status": "unknown", "detail": detail}
                    }
            continue
        harness = PROVIDER_TO_HARNESS.get(provider_id)
        if harness is None:
            continue
        identity = account_identity(provider, provider_id)
        state = provider.get("state", {})
        semantics = provider.get("quotaSemantics", {})
        harness_state = {}
        if state.get("status") == "auth_required":
            harness_state["status"] = "auth-required"
            harness_state["quota"] = {"status": "auth-required"}
        elif state.get("stale") or state.get("status") != "fresh":
            harness_state["quota"] = quota_from_unusable_state("stale", state, semantics)
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
        if provider_id == "grok":
            for candidate_id, candidate in candidates.items():
                launch = candidate["launch"]
                if launch["agent"] == "claude" and "grok" in launch["model"]:
                    generated["candidates"][candidate_id] = deepcopy(harness_state)
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
    command = ["npx", "-y", "quota-axi", "--json", "--full"]
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
):
    """Hard eligibility only. Judgment stays with the agent."""
    reasons, warnings = [], []
    if not candidate.get("enabled", True):
        reasons.append("disabled by configuration")
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
    expected = (expected_accounts or {}).get(provider)
    # A reading of the wrong account is not evidence about this launch, whether
    # it reports headroom or exhaustion. Refuse before the status is trusted.
    if expected and measured and expected != measured:
        reasons.append(
            f"quota measured for account {measured}, but {provider} is "
            f"configured to bill {expected}; this reading does not describe "
            "the launch account"
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
            f"checked against the configured {provider} account {expected}"
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
            parts.append(f"Refresh with `{remedy.strip()}`, then re-check.")
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
            "--use-quota-fallback \"<who waited and how long>\"."
        ),
    }


def check(compiled, args, runtime):
    if bool(args.candidate) == bool(args.exact_route):
        raise Error("check requires exactly one of --candidate or --exact-route")
    allowed_launchers = None
    if args.launchable_via:
        allowed_launchers = {
            launcher.strip()
            for value in args.launchable_via
            for launcher in value.split(",")
            if launcher.strip()
        }
        if not allowed_launchers:
            raise Error("--launchable-via requires catalog agent tokens")
    if args.accept_quota_unknown is not None and not args.accept_quota_unknown.strip():
        raise Error(
            "--accept-quota-unknown requires the acceptance basis as its value"
        )
    if args.route_basis is not None and not args.exact_route:
        raise Error("--route-basis requires --exact-route")
    if args.exact_route and (
        args.route_basis is None or not args.route_basis.strip()
    ):
        raise Error(
            "check --exact-route requires --route-basis with the principal's "
            "request for this task"
        )
    if args.exact_route and args.reason is not None:
        raise Error(
            "--reason applies to --candidate; exact routes record --route-basis"
        )
    if args.use_quota_fallback is not None:
        if not args.exact_route:
            raise Error("--use-quota-fallback requires --exact-route")
        if not args.use_quota_fallback.strip():
            raise Error(
                "--use-quota-fallback requires the wait basis as its value"
            )
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
        known = ", ".join(sorted(compiled["candidates"]))
        raise Error(f"unknown candidate: {args.candidate}; launchable candidates: {known}")
    if not args.reason or not args.reason.strip():
        raise Error("check --candidate requires --reason with the task judgment")
    reasons, warnings, quota = gate_check(
        args.candidate,
        candidate,
        runtime,
        required_features=args.require_feature,
        minimum_context=args.minimum_context,
        allowed_launchers=allowed_launchers,
        expected_accounts=compiled.get("accounts", {}),
    )
    if reasons:
        return {
            "status": "refused",
            "candidate": args.candidate,
            "reasons": reasons,
            "warnings": warnings,
        }
    pending, acceptance = acceptance_terms(quota, args.accept_quota_unknown)
    if pending:
        return {
            "status": "needs-acceptance",
            "candidate": args.candidate,
            "selected": {"id": args.candidate, **candidate["launch"]},
            "pending": [pending],
            "warnings": warnings,
            "quota": quota,
        }
    decision = {
        "status": "selected",
        "selected": {"id": args.candidate, **candidate["launch"]},
        "reason": args.reason.strip(),
        "warnings": warnings,
        "quota": quota,
        "sources": compiled["candidate_sources"].get(args.candidate, []),
    }
    if acceptance:
        decision["quota_acceptance"] = acceptance
    return decision


markdown_cell = exact_config.markdown_cell


def capability_cell(candidate, dimension):
    cell = candidate.get("capabilities", {}).get(dimension)
    if not cell or cell.get("status") != "known":
        return "?"
    confidence = (cell.get("confidence") or "?")[:1]
    return f"{cell['conservative']:.2f} ({confidence})"


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


def brief_markdown(compiled, runtime, repo_root):
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
        "",
        "## User preferences",
        "",
    ]
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
        "benchmark cost of one resolved task. Quota is provider-local: "
        "remaining share of that provider's own window plus its pace "
        "deficit — never compare raw percentages across providers; "
        "quota-lighter means less pace pressure and more runway within "
        "the candidate's own provider.",
        "",
        "| Candidate | Reasoning | Impl | Agentic | UI | 3D | $/task | tok/s | Context | Quota |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for candidate_id, candidate in sorted(compiled["candidates"].items()):
        if not candidate.get("enabled", True):
            continue
        cost, speed = economics_cells(candidate)
        context = candidate.get("context")
        state = runtime_for(runtime, candidate_id, candidate)
        lines.append(
            f"| {markdown_cell(candidate_id)} "
            f"| {capability_cell(candidate, 'reasoning')} "
            f"| {capability_cell(candidate, 'implementation')} "
            f"| {capability_cell(candidate, 'agentic')} "
            f"| {capability_cell(candidate, 'ui')} "
            f"| {capability_cell(candidate, 'spatial-3d')} "
            f"| {cost} | {speed} "
            f"| {f'{context:,}' if context else '?'} "
            f"| {markdown_cell(quota_cell(state) if runtime else 'not loaded')} |"
        )
    disabled = sorted(
        candidate_id
        for candidate_id, candidate in compiled["candidates"].items()
        if not candidate.get("enabled", True)
    )
    if disabled:
        lines += ["", "Disabled by configuration: " + ", ".join(disabled)]
    if runtime and runtime.get("notes"):
        lines += [""] + [f"Note: {note}" for note in runtime["notes"]]
    lines += [
        "",
        "## Evidence",
        "",
    ]
    for candidate_id, candidate in sorted(compiled["candidates"].items()):
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
                lines.append(
                    f"- {dimension}: score {cell['score']}, conservative "
                    f"{cell['conservative']}, {cell.get('confidence', '?')} confidence, "
                    f"assessed {cell['assessed_at']} — "
                    + ", ".join(cell.get("evidence", []))
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


def brief_json(compiled, runtime, repo_root):
    return {
        "repo": str(repo_root),
        "preferences": compiled["preferences"],
        "routes": {
            "semantics": EXACT_ROUTE_SEMANTICS,
            "effective": compiled["exact"]["config"]["routes"],
            "sources": compiled["exact"]["route_sources"],
        },
        "candidates": compiled["candidates"],
        "candidate_sources": compiled["candidate_sources"],
        "methodology": compiled["methodology"],
        "layers": compiled["layers"],
        "runtime": runtime or None,
    }


def emit(value, compact=False):
    json.dump(value, sys.stdout, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 2)
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
                "notes": [f"quota-axi failed: {exc}; quota is unknown for every candidate"],
            }
    if args.runtime_file:
        runtime = merge_runtime(
            runtime,
            read_json(Path(args.runtime_file).expanduser(), "runtime"),
        )
    return runtime


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("brief", "check"))
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
        "--reason", help="the task judgment behind the candidate pick; recorded verbatim"
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
        help="read live provider quota with npx -y quota-axi --json",
    )
    parser.add_argument("--format", choices=("markdown", "json"), default=None)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args(argv)
    try:
        compiled = compile_brief(args.repo)
        repo_root, _common = exact_config.repo_info(args.repo)
        runtime = load_runtime(args, compiled["candidates"])
        if args.command == "brief":
            if args.format == "json":
                emit(brief_json(compiled, runtime, repo_root), args.compact)
            else:
                sys.stdout.write(brief_markdown(compiled, runtime, repo_root))
            return 0
        decision = check(compiled, args, runtime)
        emit(decision, args.compact)
        if decision["status"] == "refused":
            return 1
        if decision["status"] == "needs-acceptance":
            return 2
        return 0
    except (Error, exact_config.Error, OSError, json.JSONDecodeError) as exc:
        print(f"model-routing: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
