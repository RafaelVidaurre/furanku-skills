#!/usr/bin/env python3
"""Crew seam resolution and assignment packets.

`seams` resolves which orchestration mechanism and work-record adapter this
machine and project configured, with provenance. `packet` turns a launchable
model-routing decision plus a mechanism manifest into the assignment packet a
spawning owner delivers, refusing combinations the mechanism cannot honor.
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
SEAM_KEYS = {"version", "work_record", "mechanism"}
RESERVED_SPEC_KEYS = {
    "role", "reports_to", "mechanism", "agent", "model", "effort", "route",
    "candidate", "work_ref", "bootstrap_request", "routing_status",
    "routing_reason", "routing_warnings", "routing_quota",
    "routing_quota_acceptance", "route_source", "launch_constraint",
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
            raise Error(f"{label}.extras key must be a lowercase identifier, got {key!r}")
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
    return data


def resolve_seams(repo):
    root, paths = seam_locations(repo)
    result = {
        "repo": str(root),
        "work_record": {"adapter": None, "source": "unset"},
        "mechanism": {"id": "harness-native", "source": "default"},
        "layers": [],
    }
    for scope in SCOPES:
        path = paths[scope]
        present = path.exists()
        result["layers"].append(
            {"scope": scope, "path": str(path), "present": present}
        )
        if not present:
            continue
        data = load_seam_layer(path, scope)
        if data.get("work_record") is not None:
            result["work_record"] = {**data["work_record"], "source": scope}
        if data.get("mechanism") is not None:
            result["mechanism"] = {**data["mechanism"], "source": scope}
    return result


# --- packet ----------------------------------------------------------------


def read_decision(value):
    decision = read_json_arg(value, "--decision-json")
    status = decision.get("status")
    if status == "needs-acceptance":
        pending = "; ".join(decision.get("pending", [])) or "quota acceptance pending"
        raise Error(
            "routing decision needs acceptance before dispatch: "
            f"{pending}. Obtain the principal's acceptance and re-run the "
            "routing check with --accept-quota-unknown."
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


def parse_work(args):
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
    if not args.work_record:
        raise Error(
            "--request requires --work-record <adapter|none> from the seams "
            "resolution"
        )
    if args.work_record == "none":
        return {"type": "direct", "adapter": None, "request": args.request}
    token(args.work_record, "--work-record")
    return {"type": "bootstrap", "adapter": args.work_record, "request": args.request}


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
        summary["source"] = decision["provenance"]["winner"]
        if selected.get("id"):
            summary["candidate"] = selected["id"]
    if decision.get("quota_acceptance"):
        summary["quota_acceptance"] = decision["quota_acceptance"]
    return summary


def build_packet(args):
    title = args.title.strip()
    if not title:
        raise Error("--title must be a non-empty human outcome")
    if args.role == "captain" and args.reports_to == "captain":
        raise Error("a Captain cannot assign another Captain")
    if args.manifest == "-" and args.decision_json == "-":
        raise Error("only one of --decision-json and --manifest may read stdin")
    manifest = validate_manifest(read_json_arg(args.manifest, "--manifest"))
    decision = read_decision(args.decision_json)
    if decision["status"] == "exact":
        route_id = decision["exact_route"]
        if route_id != args.role and not route_id.startswith(f"{args.role}."):
            raise Error(
                f"exact route {route_id!r} does not match role {args.role!r}"
            )
    agent = decision["selected"]["agent"]
    if agent not in manifest["launchable_agents"]:
        message = (
            f"mechanism {manifest['mechanism']!r} cannot launch agent {agent!r}; "
            "its launchable agents are: "
            + ", ".join(manifest["launchable_agents"])
            + ". Re-run the routing check with --launchable-via "
            + ",".join(manifest["launchable_agents"])
        )
        if decision["status"] == "exact":
            message += (
                f"; preserve exact route {decision['exact_route']!r} and unchanged "
                "launch constraints, then use a permitted launch surface or surface "
                "the conflict to the principal."
            )
        else:
            message += " and re-judge within unchanged principal constraints."
        raise Error(message)
    extras = parse_extras(args.extra, manifest)
    launch_constraints = parse_launch_constraints(args.launch_constraint)
    work = parse_work(args)
    routing = routing_summary(decision)
    contract = (
        Path(__file__).resolve().parent.parent / "references" / f"{args.role}.md"
    )
    lines = [
        f"role: {args.role}",
        f"reports_to: {args.reports_to}",
        f"mechanism: {manifest['mechanism']}",
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
        f"Role contract: {contract}",
        f"routing_status: {routing['status']}",
    ]
    if routing.get("candidate"):
        lines.append(f"candidate: {routing['candidate']}")
    if routing["status"] == "exact":
        lines.append(f"route: {routing['route']}")
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

    packet = commands.add_parser("packet", help="build an assignment packet")
    packet.add_argument("--title", required=True)
    packet.add_argument("--role", required=True, choices=ROLES)
    packet.add_argument(
        "--reports-to", required=True, choices=("user", "commander", "captain")
    )
    packet.add_argument(
        "--decision-json", required=True, help="model-routing check output; '-' = stdin"
    )
    packet.add_argument(
        "--manifest", required=True, help="mechanism manifest JSON, file, or '-'"
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
