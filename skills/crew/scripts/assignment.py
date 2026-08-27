#!/usr/bin/env python3
"""Crew seam resolution and assignment packets.

`seams` resolves which orchestration mechanism and work-record adapter this
machine and project configured, with provenance. `packet` gate-checks a routing
pick against its mechanism manifest, or accepts a saved model-routing decision,
then builds the assignment packet a spawning owner delivers.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


class Error(Exception):
    pass


TOKEN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
EXTRA_KEY = re.compile(r"^[a-z][a-z0-9_]*$")
WORK_REF = re.compile(r"^([a-z0-9]+(?:-[a-z0-9]+)*):(.+)$")
ROLES = ("captain", "worker")
MANIFEST_KEYS = {
    "mechanism",
    "launchable_agents",
    "isolation",
    "communication",
    "retire",
    "extras",
}
SEAM_KEYS = {"version", "work_record", "mechanism", "mechanisms"}
KNOWN_MANIFESTS = {
    "orca": {
        "mechanism": "orca",
        "launchable_agents": ["claude", "codex", "opencode", "grok"],
        "isolation": True,
        "communication": (
            "Orca dispatch carries questions, escalation, status, and "
            "completion; dependency order is represented once in Orca."
        ),
        "retire": (
            "Use current orchestration guidance to finish assignment state and "
            "current orca-cli guidance to retire the assignment's dedicated "
            "terminals and worktree."
        ),
        "extras": {"front_key": "^[^/]+/[^/]+$"},
    },
}
RESERVED_SPEC_KEYS = {
    "outcome",
    "role",
    "reports_to",
    "mechanism",
    "isolation",
    "coordination",
    "agent",
    "model",
    "effort",
    "route",
    "candidate",
    "work_ref",
    "bootstrap_request",
    "routing_status",
    "routing_reason",
    "routing_warnings",
    "routing_quota",
    "routing_quota_acceptance",
    "route_source",
    "launch_constraint",
}


def token(value, label):
    if not isinstance(value, str) or not TOKEN.fullmatch(value):
        raise Error(f"{label} must be a lowercase token, got {value!r}")
    return value


def read_json_arg(value, label):
    """Accept '-' for stdin, an inline JSON object, or a file path."""
    if value == "-":
        raw = sys.stdin.read()
    elif value.lstrip().startswith("{"):
        raw = value
    else:
        try:
            raw = Path(value).expanduser().read_text(encoding="utf-8")
        except OSError as exc:
            raise Error(f"cannot read {label} {value}: {exc}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise Error(f"invalid {label}: {exc}") from exc
    if not isinstance(data, dict):
        raise Error(f"{label} must be a JSON object")
    return data


# --- seams -----------------------------------------------------------------

NAMESPACE = "crew"
SCOPES = ("global", "repo", "machine-repo")


def git(cwd, *args):
    result = subprocess.run(
        ["git", "-C", str(cwd), *args], capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise Error(result.stderr.strip() or "git failed")
    return result.stdout.strip()


def repo_info(repo):
    # Mirrors model-routing's keying so both skills agree on repo identity;
    # skills install independently, so the logic cannot be imported.
    target = Path(repo).expanduser().resolve()
    try:
        root = Path(git(target, "rev-parse", "--show-toplevel"))
        raw = Path(git(root, "rev-parse", "--git-common-dir"))
        common = (root / raw).resolve() if not raw.is_absolute() else raw.resolve()
        return root.resolve(), common
    except (Error, FileNotFoundError):
        if not target.is_dir():
            raise Error(f"--repo must be an existing directory: {target}")
        return target, target


def seam_locations(repo):
    home = Path.home()
    base = home / ".furanku-skills" / NAMESPACE
    root, common = repo_info(repo)
    digest = hashlib.sha256(str(common).encode()).hexdigest()
    label_from = common.parent.name if common.name == ".git" else common.name
    label = re.sub(r"[^a-z0-9]+", "-", label_from.lower()).strip("-") or "repo"
    return root, {
        "global": base / "config.json",
        "repo": root / ".furanku-skills" / NAMESPACE / "config.json",
        "machine-repo": base / "repos" / f"{label}-{digest[:16]}.json",
    }


def validate_manifest(manifest, label="manifest"):
    if not isinstance(manifest, dict):
        raise Error(f"{label} must be an object")
    unknown = set(manifest) - MANIFEST_KEYS
    if unknown:
        raise Error(f"{label} has unknown keys: {', '.join(sorted(unknown))}")
    token(manifest.get("mechanism"), f"{label}.mechanism")
    agents = manifest.get("launchable_agents")
    if not isinstance(agents, list) or not agents:
        raise Error(f"{label}.launchable_agents must be a non-empty array")
    for agent in agents:
        token(agent, f"{label}.launchable_agents entry")
    for key in ("communication", "retire"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            raise Error(f"{label}.{key} must describe the mechanism's procedure")
    if not isinstance(manifest.get("isolation", False), bool):
        raise Error(f"{label}.isolation must be boolean")
    extras = manifest.get("extras", {})
    if not isinstance(extras, dict):
        raise Error(f"{label}.extras must be an object")
    for key, pattern in extras.items():
        if not isinstance(key, str) or not EXTRA_KEY.fullmatch(key):
            raise Error(
                f"{label}.extras key must be a lowercase identifier, got {key!r}"
            )
        if key in RESERVED_SPEC_KEYS:
            raise Error(f"{label}.extras key {key!r} collides with a packet field")
        if not isinstance(pattern, str):
            raise Error(f"{label}.extras.{key} must be a regex string ('' = any)")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise Error(f"{label}.extras.{key} is not a valid regex: {exc}") from exc
    return manifest


def load_seam_layer(path, scope):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Error(f"cannot read {scope} crew config {path}: {exc}") from exc
    if not isinstance(data, dict) or data.get("version") != 1:
        raise Error(f"{scope} crew config {path} must be an object with version 1")
    unknown = set(data) - SEAM_KEYS
    if unknown:
        raise Error(
            f"{scope} crew config {path} has unknown keys: {', '.join(sorted(unknown))}"
        )
    record = data.get("work_record")
    if record is not None:
        if not isinstance(record, dict) or set(record) != {"adapter"}:
            raise Error(f"{scope} crew config work_record requires only: adapter")
        if record["adapter"] != "none":
            token(record["adapter"], f"{scope} work_record.adapter")
    mechanism = data.get("mechanism")
    if mechanism is not None:
        if not isinstance(mechanism, dict) or not set(mechanism) <= {"id", "manifest"}:
            raise Error(f"{scope} crew config mechanism allows only: id, manifest")
        token(mechanism.get("id"), f"{scope} mechanism.id")
        if "manifest" in mechanism:
            validate_manifest(mechanism["manifest"], f"{scope} mechanism.manifest")
            if mechanism["manifest"]["mechanism"] != mechanism["id"]:
                raise Error(f"{scope} mechanism.manifest names a different mechanism")
    registry = data.get("mechanisms")
    if registry is not None:
        if not isinstance(registry, dict):
            raise Error(
                f"{scope} crew config mechanisms must map mechanism id to entry"
            )
        for mech_id, entry in registry.items():
            token(mech_id, f"{scope} mechanisms id")
            if not isinstance(entry, dict) or not set(entry) <= {
                "disabled",
                "manifest",
            }:
                raise Error(
                    f"{scope} crew config mechanisms.{mech_id} allows only: "
                    "disabled, manifest"
                )
            if not isinstance(entry.get("disabled", False), bool):
                raise Error(f"{scope} mechanisms.{mech_id}.disabled must be boolean")
            if "manifest" in entry:
                validate_manifest(
                    entry["manifest"], f"{scope} mechanisms.{mech_id}.manifest"
                )
                if entry["manifest"]["mechanism"] != mech_id:
                    raise Error(
                        f"{scope} mechanisms.{mech_id}.manifest names a "
                        "different mechanism"
                    )
    return data


def resolve_seams(repo):
    root, paths = seam_locations(repo)
    result = {
        "repo": str(root),
        "work_record": {"adapter": None, "source": "unset"},
        "mechanism": {"id": "harness-native", "source": "default"},
        "mechanisms": {},
        "layers": [],
    }
    for scope in SCOPES:
        path = paths[scope]
        present = path.exists()
        result["layers"].append({"scope": scope, "path": str(path), "present": present})
        if not present:
            continue
        data = load_seam_layer(path, scope)
        if data.get("work_record") is not None:
            result["work_record"] = {**data["work_record"], "source": scope}
        if data.get("mechanism") is not None:
            result["mechanism"] = {**data["mechanism"], "source": scope}
        for mech_id, entry in (data.get("mechanisms") or {}).items():
            result["mechanisms"][mech_id] = {**entry, "source": scope}
    active = result["mechanism"]
    entry = result["mechanisms"].get(active["id"])
    if entry and entry.get("disabled"):
        raise Error(
            f"mechanism {active['id']!r} is disabled ({entry['source']} scope); "
            "select another mechanism or remove its disabled flag"
        )
    if "manifest" not in active:
        if entry and entry.get("manifest"):
            active["manifest"] = entry["manifest"]
        elif active["id"] in KNOWN_MANIFESTS:
            active["manifest"] = KNOWN_MANIFESTS[active["id"]]
    return result


def resolve_manifest_id(mech_id, repo):
    seams = resolve_seams(repo)
    entry = seams["mechanisms"].get(mech_id)
    if entry and entry.get("disabled"):
        raise Error(
            f"mechanism {mech_id!r} is disabled ({entry['source']} scope); "
            "enable it or select another mechanism"
        )
    if entry and entry.get("manifest"):
        return entry["manifest"]
    active = seams["mechanism"]
    if active["id"] == mech_id and active.get("manifest"):
        return active["manifest"]
    if mech_id in KNOWN_MANIFESTS:
        return KNOWN_MANIFESTS[mech_id]
    resolvable = sorted({*KNOWN_MANIFESTS, *seams["mechanisms"]})
    raise Error(
        f"no manifest for mechanism id {mech_id!r}; resolvable ids here: "
        + (", ".join(resolvable) or "none")
        + f". Pass the manifest as JSON or a file path, or register it under "
        f"mechanisms.{mech_id}.manifest in crew config"
    )


def load_manifest(value, repo, seams=None):
    """Use the configured manifest, or parse an explicit id/JSON/file/stdin value."""
    if value is None:
        resolved = seams or resolve_seams(repo)
        active = resolved["mechanism"]
        manifest = active.get("manifest")
        if manifest is None:
            raise Error(
                f"active mechanism {active['id']!r} has no configured manifest; "
                "pass --manifest with the current harness profile"
            )
        return validate_manifest(manifest)
    if value != "-" and not value.lstrip().startswith("{"):
        if not Path(value).expanduser().exists() and TOKEN.fullmatch(value):
            return resolve_manifest_id(value, repo)
    return validate_manifest(read_json_arg(value, "--manifest"))


# --- packet ----------------------------------------------------------------


def validate_decision(decision):
    status = decision.get("status")
    exact_route = decision.get("exact_route")
    if isinstance(exact_route, str) and exact_route.strip():
        route_basis = decision.get("route_basis")
        if not isinstance(route_basis, str) or not route_basis.strip():
            raise Error("exact route decision requires a recorded route basis")
    if status == "needs-acceptance":
        quota = decision.get("quota")
        remedy = quota.get("remedy") if isinstance(quota, dict) else None
        route = decision.get("exact_route")
        retry_target = (
            "exact route" if isinstance(route, str) and route.strip() else "candidate"
        )
        if isinstance(remedy, str) and remedy.strip():
            detail = quota.get("detail")
            problem = (
                detail.strip()
                if isinstance(detail, str) and detail.strip()
                else f"quota is {quota.get('status', 'unavailable')}"
            )
            raise Error(
                "routing decision needs a runtime refresh before dispatch: "
                f"{problem}. Run `{remedy.strip()}` with no prompt, wait until "
                f"the session loads, exit it, and re-check the same {retry_target}."
            )
        pending = "; ".join(decision.get("pending", [])) or "quota acceptance pending"
        extra = ""
        fallback = decision.get("quota_fallback")
        if isinstance(fallback, dict) and isinstance(fallback.get("launch"), dict):
            launch = fallback["launch"]
            seconds = fallback.get("ask_seconds", 120)
            extra = (
                f" A quota fallback is configured ({seconds}s → "
                f"{launch.get('agent')}/{launch.get('model')}/{launch.get('effort')}). "
                "Surface pending to the principal; if they do not answer in time, "
                "re-check with --use-quota-fallback."
            )
        raise Error(
            "routing decision needs acceptance before dispatch: "
            f"{pending}. Obtain the principal's acceptance and re-run the "
            f"same {retry_target} with --accept-quota-unknown." + extra
        )
    if status == "refused":
        reasons = decision.get("reasons")
        if isinstance(reasons, list):
            detail = "; ".join(
                reason.strip()
                for reason in reasons
                if isinstance(reason, str) and reason.strip()
            )
        else:
            detail = ""
        detail = detail or "an unspecified hard gate failed"
        route = decision.get("exact_route")
        if isinstance(route, str) and route.strip():
            raise Error(
                f"exact route {route!r} was refused: {detail}. Preserve the route "
                "and unchanged launch constraints; use a permitted launch surface "
                "or surface the conflict to the principal."
            )
        candidate = decision.get("candidate")
        label = (
            f"candidate {candidate!r}" if isinstance(candidate, str) else "candidate"
        )
        raise Error(
            f"routing {label} was refused: {detail}. Re-judge within unchanged "
            "principal constraints or surface the conflict."
        )
    if status not in {"selected", "exact"}:
        raise Error("routing decision is not launchable")
    selected = decision.get("selected")
    if not isinstance(selected, dict) or any(
        not isinstance(selected.get(field), str) or not selected[field].strip()
        for field in ("agent", "model", "effort")
    ):
        raise Error("routing decision lacks a launchable selection")
    if status == "selected":
        if not isinstance(selected.get("id"), str) or not selected["id"].strip():
            raise Error("selected decision requires a candidate id")
        reason = decision.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise Error("selected decision requires a recorded rationale")
    else:
        route = decision.get("exact_route")
        if not isinstance(route, str) or not route.strip():
            raise Error("exact decision requires exact_route")
        provenance = decision.get("provenance")
        winner = provenance.get("winner") if isinstance(provenance, dict) else None
        if not isinstance(winner, dict) or any(
            not isinstance(winner.get(field), str) or not winner[field].strip()
            for field in ("scope", "path")
        ):
            raise Error(
                "exact decision requires route provenance with winner scope and path"
            )
    return decision


def read_decision(value):
    return validate_decision(read_json_arg(value, "--decision-json"))


def default_router_path():
    return (
        Path(__file__).resolve().parent.parent.parent
        / "model-routing"
        / "scripts"
        / "router.py"
    )


def router_path(value):
    router = Path(value).expanduser() if value else default_router_path()
    if not router.is_file():
        raise Error(
            f"model-routing is unavailable at {router}; install it beside Crew "
            "or pass --router <path>"
        )
    return router


def routing_brief(args):
    manifest = load_manifest(args.manifest, args.repo)
    command = [
        sys.executable,
        str(router_path(args.router)),
        "brief",
        "--repo",
        args.repo,
        "--launchable-via",
        ",".join(manifest["launchable_agents"]),
        "--quota-axi",
    ]
    if args.runtime_file:
        command += ["--runtime-file", args.runtime_file]
    if args.format:
        command += ["--format", args.format]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise Error(
            "model-routing brief failed: "
            + (result.stderr.strip() or result.stdout.strip() or "no output")
        )
    return result.stdout


def route_decision(args, manifest):
    if args.decision_json is not None:
        modifiers = (
            args.reason,
            args.route_basis,
            args.max_effort_basis,
            args.require_feature,
            args.minimum_context,
            args.accept_quota_unknown,
            args.use_quota_fallback,
            args.runtime_file,
        )
        if any(value is not None and value != [] for value in modifiers):
            raise Error(
                "saved --decision-json cannot be combined with routing check options"
            )
        return read_decision(args.decision_json)

    if args.candidate:
        if not args.reason or not args.reason.strip():
            raise Error("--candidate requires --reason with the task judgment")
        if args.route_basis is not None or args.use_quota_fallback is not None:
            raise Error(
                "--route-basis and --use-quota-fallback apply only to --exact-route"
            )
    else:
        if not args.route_basis or not args.route_basis.strip():
            raise Error(
                "--exact-route requires --route-basis with the principal's request"
            )
        if args.reason is not None or args.max_effort_basis is not None:
            raise Error("--reason and --max-effort-basis apply only to --candidate")

    command = [
        sys.executable,
        str(router_path(args.router)),
        "check",
        "--repo",
        args.repo,
        "--launchable-via",
        ",".join(manifest["launchable_agents"]),
        "--quota-axi",
    ]
    if args.candidate:
        command += ["--candidate", args.candidate, "--reason", args.reason]
    else:
        command += [
            "--exact-route",
            args.exact_route,
            "--route-basis",
            args.route_basis,
        ]
    scalar_options = (
        ("--max-effort-basis", args.max_effort_basis),
        ("--minimum-context", args.minimum_context),
        ("--accept-quota-unknown", args.accept_quota_unknown),
        ("--use-quota-fallback", args.use_quota_fallback),
        ("--runtime-file", args.runtime_file),
    )
    for flag, value in scalar_options:
        if value is not None:
            command += [flag, str(value)]
    for feature in args.require_feature:
        command += ["--require-feature", feature]

    result = subprocess.run(command, capture_output=True, text=True, check=False)
    try:
        decision = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        detail = result.stderr.strip() or result.stdout.strip() or "no output"
        raise Error(f"model-routing check failed: {detail}") from exc
    if not isinstance(decision, dict):
        raise Error("model-routing check did not return a JSON object")
    status = decision.get("status")
    expected_exit = {
        "selected": 0,
        "exact": 0,
        "refused": 1,
        "needs-acceptance": 2,
    }.get(status)
    if expected_exit is None or result.returncode != expected_exit:
        raise Error(
            "model-routing check returned an inconsistent result: "
            f"status {status!r} requires exit {expected_exit}, got {result.returncode}"
        )
    if args.candidate:
        returned_candidate = decision.get("candidate")
        selected = decision.get("selected")
        if isinstance(selected, dict):
            returned_candidate = selected.get("id", returned_candidate)
        if returned_candidate != args.candidate:
            raise Error(
                "model-routing check returned a different candidate than requested"
            )
        if (
            status in {"selected", "needs-acceptance"}
            and decision.get("reason") != args.reason.strip()
        ):
            raise Error(
                "model-routing check returned a different candidate rationale than requested"
            )
    elif (
        decision.get("exact_route") != args.exact_route
        or decision.get("route_basis") != args.route_basis.strip()
    ):
        raise Error(
            "model-routing check returned a different exact route or route basis than requested"
        )
    return validate_decision(decision)


def parse_extras(pairs, manifest):
    extras = {}
    for pair in pairs:
        key, sep, value = pair.partition("=")
        if not sep or not key or not value:
            raise Error(f"--extra requires key=value, got {pair!r}")
        extras[key] = value
    declared = manifest.get("extras", {})
    undeclared = set(extras) - set(declared)
    if undeclared:
        raise Error(
            f"mechanism {manifest['mechanism']!r} does not declare extras: "
            + ", ".join(sorted(undeclared))
        )
    for key, pattern in declared.items():
        if key not in extras:
            raise Error(
                f"mechanism {manifest['mechanism']!r} requires --extra "
                f"{key}=<value matching {pattern or 'any'}>"
            )
        if pattern and not re.fullmatch(pattern, extras[key]):
            raise Error(f"--extra {key}={extras[key]!r} must match {pattern}")
    return extras


def parse_launch_constraints(values):
    constraints = []
    for value in values:
        if not value.strip():
            raise Error("--launch-constraint must be non-empty")
        if value not in constraints:
            constraints.append(value)
    return constraints


def parse_work(args, configured_adapter=None):
    if bool(args.work_ref) == bool(args.request):
        raise Error("provide exactly one of --work-ref or --request")
    if args.work_ref:
        match = WORK_REF.fullmatch(args.work_ref)
        if not match:
            raise Error("--work-ref must be <adapter>:<ref>, e.g. beads:abc123")
        adapter, ref = match.groups()
        if adapter == "none":
            raise Error("--work-ref cannot use adapter 'none'; use --request")
        if args.work_record and args.work_record != adapter:
            raise Error(
                f"--work-record {args.work_record!r} contradicts --work-ref "
                f"adapter {adapter!r}"
            )
        return {"type": "ref", "adapter": adapter, "ref": ref}
    if not args.request.strip():
        raise Error("--request must carry the verbatim request")
    work_record = args.work_record or configured_adapter
    if not work_record:
        raise Error(
            "--request requires --work-record <adapter|none> from the seams resolution"
        )
    if work_record == "none":
        return {"type": "direct", "adapter": None, "request": args.request}
    token(work_record, "--work-record")
    return {"type": "bootstrap", "adapter": work_record, "request": args.request}


def routing_summary(decision):
    selected = decision["selected"]
    summary = {
        "status": decision["status"],
        "agent": selected["agent"],
        "model": selected["model"],
        "effort": selected["effort"],
        "warnings": decision.get("warnings", []),
        "quota": decision.get("quota"),
    }
    if decision["status"] == "selected":
        summary["candidate"] = selected["id"]
        summary["reason"] = decision["reason"]
    else:
        summary["route"] = decision["exact_route"]
        summary["route_basis"] = decision["route_basis"]
        summary["source"] = decision["provenance"]["winner"]
        if selected.get("id"):
            summary["candidate"] = selected["id"]
    if decision.get("quota_acceptance"):
        summary["quota_acceptance"] = decision["quota_acceptance"]
    if decision.get("quota_fallback"):
        summary["quota_fallback"] = decision["quota_fallback"]
    return summary


def build_packet(args):
    title = args.title.strip()
    if not title:
        raise Error("--title must be a non-empty human outcome")
    if args.role == "captain" and args.reports_to == "captain":
        raise Error("a Captain cannot assign another Captain")
    if args.manifest == "-" and args.decision_json == "-":
        raise Error("only one of --decision-json and --manifest may read stdin")
    needs_seams = args.manifest is None or (args.request and not args.work_record)
    seams = resolve_seams(args.repo) if needs_seams else None
    manifest = load_manifest(args.manifest, args.repo, seams)
    decision = route_decision(args, manifest)
    if args.decision_out:
        destination = Path(args.decision_out).expanduser()
        try:
            destination.write_text(
                json.dumps(decision, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        except OSError as exc:
            raise Error(f"cannot write --decision-out {destination}: {exc}") from exc
    if decision["status"] == "exact":
        route_id = decision["exact_route"]
        if route_id != args.role and not route_id.startswith(f"{args.role}."):
            raise Error(f"exact route {route_id!r} does not match role {args.role!r}")
    agent = decision["selected"]["agent"]
    if agent not in manifest["launchable_agents"]:
        message = (
            f"mechanism {manifest['mechanism']!r} cannot launch agent {agent!r}; "
            "its launchable agents are: "
            + ", ".join(manifest["launchable_agents"])
            + ". The saved decision was checked for a different launch surface"
        )
        if decision["status"] == "exact":
            message += (
                f"; preserve exact route {decision['exact_route']!r} and unchanged "
                "launch constraints, then use a permitted launch surface or surface "
                "the conflict to the principal."
            )
        else:
            message += (
                "; create a new packet from the same task constraints and re-judge."
            )
        raise Error(message)
    extras = parse_extras(args.extra, manifest)
    launch_constraints = parse_launch_constraints(args.launch_constraint)
    configured_adapter = seams["work_record"]["adapter"] if seams else None
    work = parse_work(args, configured_adapter)
    routing = routing_summary(decision)
    skill = Path(__file__).resolve().parent.parent / "SKILL.md"
    contract = skill.parent / "references" / f"{args.role}.md"
    lines = [
        "outcome: " + json.dumps(title, ensure_ascii=False),
        f"role: {args.role}",
        f"reports_to: {args.reports_to}",
        f"mechanism: {manifest['mechanism']}",
        "isolation: " + json.dumps(manifest.get("isolation", False)),
        "coordination: " + json.dumps(manifest["communication"], ensure_ascii=False),
    ]
    lines += [f"{key}: {extras[key]}" for key in sorted(extras)]
    lines += [
        f"launch_constraint: {json.dumps(value, ensure_ascii=False)}"
        for value in launch_constraints
    ]
    lines += [
        f"agent: {routing['agent']}",
        f"model: {routing['model']}",
        f"effort: {routing['effort']}",
        f"Crew contract: {skill}",
        f"Role contract: {contract}",
        f"routing_status: {routing['status']}",
    ]
    if routing.get("candidate"):
        lines.append(f"candidate: {routing['candidate']}")
    if routing["status"] == "exact":
        lines.append(f"route: {routing['route']}")
        lines.append(
            "route_basis: " + json.dumps(routing["route_basis"], ensure_ascii=False)
        )
        lines.append(
            f"route_source: {routing['source']['scope']} — {routing['source']['path']}"
        )
    if routing.get("reason"):
        lines.append(
            f"routing_reason: {json.dumps(routing['reason'], ensure_ascii=False)}"
        )
    if routing["warnings"]:
        lines.append(
            "routing_warnings: " + json.dumps(routing["warnings"], ensure_ascii=False)
        )
    if routing.get("quota"):
        lines.append(
            "routing_quota: "
            + json.dumps(routing["quota"], ensure_ascii=False, sort_keys=True)
        )
    if routing.get("quota_acceptance"):
        lines.append(
            "routing_quota_acceptance: "
            + json.dumps(routing["quota_acceptance"], ensure_ascii=False)
        )
    if routing.get("quota_fallback"):
        lines.append(
            "routing_quota_fallback: "
            + json.dumps(routing["quota_fallback"], ensure_ascii=False, sort_keys=True)
        )
    if work["type"] == "ref":
        lines += [
            f"work_ref: {work['adapter']}:{work['ref']}",
            f"Read work record {work['adapter']}:{work['ref']}: it is the work contract.",
        ]
    elif work["type"] == "bootstrap":
        lines += [
            f"bootstrap_request: {json.dumps(work['request'], ensure_ascii=False)}",
            f"Create the first {work['adapter']} work record from that verbatim "
            "request before decomposing or implementing.",
        ]
    else:
        lines += [
            f"bootstrap_request: {json.dumps(work['request'], ensure_ascii=False)}",
            "No work-record adapter is configured: that verbatim request is the "
            "whole contract; return results and remaining work to your principal.",
        ]
    return {
        "title": title,
        "role": args.role,
        "reports_to": args.reports_to,
        "contract": str(contract),
        "work": work,
        "launch_constraints": launch_constraints,
        "routing": routing,
        "mechanism": {"id": manifest["mechanism"], "extras": extras},
        "spec": "\n".join(lines) + "\n",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    seams = commands.add_parser("seams", help="resolve mechanism and work record")
    seams.add_argument("--repo", default=".")
    seams.add_argument("--compact", action="store_true")

    brief = commands.add_parser(
        "brief", help="show routing choices the active mechanism can launch"
    )
    brief.add_argument(
        "--manifest",
        help=(
            "mechanism manifest JSON, file, '-', or id; defaults to the configured "
            "active manifest"
        ),
    )
    brief.add_argument("--repo", default=".")
    brief.add_argument(
        "--router",
        help="model-routing router.py path when it is not installed beside Crew",
    )
    brief.add_argument(
        "--runtime-file", help="additional ephemeral routing runtime JSON"
    )
    brief.add_argument("--format", choices=("markdown", "json"), default=None)

    packet = commands.add_parser("packet", help="build an assignment packet")
    packet.add_argument("--title", required=True)
    packet.add_argument("--role", required=True, choices=ROLES)
    packet.add_argument(
        "--reports-to", required=True, choices=("user", "commander", "captain")
    )
    routing = packet.add_mutually_exclusive_group(required=True)
    routing.add_argument(
        "--decision-json", help="saved model-routing check output; '-' = stdin"
    )
    routing.add_argument(
        "--candidate", help="candidate ID chosen from the routing brief"
    )
    routing.add_argument(
        "--exact-route", help="configured route requested by the principal"
    )
    packet.add_argument(
        "--reason", help="concise task judgment behind a --candidate pick"
    )
    packet.add_argument(
        "--route-basis",
        help="verbatim principal request authorizing an --exact-route",
    )
    packet.add_argument(
        "--max-effort-basis",
        help="why the strongest enabled lower effort is materially insufficient",
    )
    packet.add_argument(
        "--require-feature",
        action="append",
        default=[],
        help="hard model feature requirement, repeatable",
    )
    packet.add_argument("--minimum-context", type=int)
    packet.add_argument(
        "--accept-quota-unknown",
        help="who accepted launching without live quota, and why",
    )
    packet.add_argument(
        "--use-quota-fallback",
        help="basis for using an exact route's configured quota fallback",
    )
    packet.add_argument(
        "--runtime-file", help="additional ephemeral routing runtime JSON"
    )
    packet.add_argument(
        "--router",
        help="model-routing router.py path when it is not installed beside Crew",
    )
    packet.add_argument(
        "--decision-out",
        help="write the raw gate-checked decision for later packet rebuilds",
    )
    packet.add_argument(
        "--manifest",
        help=(
            "mechanism manifest JSON, file, '-', or id; defaults to the configured "
            "active manifest"
        ),
    )
    packet.add_argument(
        "--repo", default=".", help="repo root for resolving --manifest by id"
    )
    packet.add_argument(
        "--extra",
        action="append",
        default=[],
        help="mechanism extra as key=value, repeatable",
    )
    packet.add_argument(
        "--launch-constraint",
        action="append",
        default=[],
        help="verbatim principal or inherited launch constraint, repeatable",
    )
    work = packet.add_mutually_exclusive_group(required=True)
    work.add_argument("--work-ref", help="<adapter>:<ref>, e.g. beads:abc123")
    work.add_argument("--request", help="verbatim request when no record exists yet")
    packet.add_argument(
        "--work-record", help="adapter for --request bootstrap, or 'none'"
    )
    packet.add_argument("--format", choices=("json", "spec"), default="json")

    args = parser.parse_args(argv)
    try:
        if args.command == "seams":
            result = resolve_seams(args.repo)
            json.dump(
                result,
                sys.stdout,
                ensure_ascii=False,
                indent=None if args.compact else 2,
            )
            sys.stdout.write("\n")
            return 0
        if args.command == "brief":
            sys.stdout.write(routing_brief(args))
            return 0
        result = build_packet(args)
    except Error as exc:
        print(f"crew-assignment: {exc}", file=sys.stderr)
        return 1
    if args.format == "spec":
        sys.stdout.write(result["spec"])
    else:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
