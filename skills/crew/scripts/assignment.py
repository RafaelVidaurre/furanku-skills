#!/usr/bin/env python3
"""Emit a compact role assignment with route provenance and a work pointer."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


class Error(Exception):
    pass


def parse_front_key(front_key: str) -> str:
    parts = front_key.split("/")
    if len(parts) != 2 or any(not part for part in parts):
        raise Error("--front-key must be <run-key>/<front>")
    return parts[0]


def read_routes(value: str | None) -> dict[str, dict]:
    if value is None:
        return {}
    raw = sys.stdin.read() if value == "-" else value
    if not raw.strip():
        raise Error("--routes-json requires JSON")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise Error(f"invalid --routes-json: {exc}") from exc
    rows = data.get("routes", data) if isinstance(data, dict) else None
    if not isinstance(rows, dict):
        raise Error('--routes-json must be a route object or {"routes": {...}}')
    return rows


def read_decision(value: str | None) -> dict:
    if value is None:
        return {}
    raw = sys.stdin.read() if value == "-" else value
    if not raw.strip():
        raise Error("--decision-json requires JSON")
    try:
        decision = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise Error(f"invalid --decision-json: {exc}") from exc
    if not isinstance(decision, dict):
        raise Error("--decision-json must be an object")
    status = decision.get("status")
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


def worker_route_lines(rows: dict[str, dict]) -> list[str]:
    lines = []
    worker_routes = (
        route
        for route in rows
        if route == "worker" or route.startswith("worker.")
    )
    for route_id in sorted(worker_routes):
        row = rows[route_id]
        if not isinstance(row, dict):
            raise Error(f"route {route_id!r} is not an object")
        required = ("agent", "model", "effort")
        if any(not row.get(field) for field in required):
            raise Error(f"route {route_id!r} lacks agent, model, or effort")
        line = (
            f"{route_id}: agent={row['agent']} model={row['model']} "
            f"effort={row['effort']}"
        )
        if row.get("work"):
            line += f" work={row['work']}"
        lines.append(line)
    return lines


def build_spec(args: argparse.Namespace) -> tuple[str, str]:
    title = args.title.strip()
    if not title:
        raise Error("--title must be a non-empty human outcome")
    run_key = parse_front_key(args.front_key)

    if args.role == "captain" and args.reports_to == "captain":
        raise Error("a Captain cannot assign another Captain")
    if bool(args.bead) == bool(args.request):
        raise Error("provide exactly one of --bead or --request")

    decision = read_decision(args.decision_json)
    if decision:
        selected = decision["selected"]
        if decision["status"] == "exact":
            route_id = decision["exact_route"]
            if route_id != args.role and not route_id.startswith(f"{args.role}."):
                raise Error(
                    f"exact route {route_id!r} does not match role {args.role!r}"
                )
        else:
            route_id = "judged"
        route_lines = []
    else:
        rows = read_routes(args.routes_json)
        expected_prefix = f"{args.role}."
        if args.route is None:
            raise Error("--route is required with --routes-json")
        if args.route != args.role and not args.route.startswith(expected_prefix):
            raise Error(f"route {args.route!r} does not match role {args.role!r}")
        selected = rows.get(args.route)
        if not isinstance(selected, dict):
            raise Error(f"route {args.route!r} is absent from --routes-json")
        required = ("agent", "model", "effort")
        if any(not selected.get(field) for field in required):
            raise Error(f"route {args.route!r} lacks agent, model, or effort")
        route_id = args.route
        route_lines = worker_route_lines(rows) if args.role == "captain" else []
        if args.role == "captain" and not route_lines:
            raise Error("Captain assignments require Worker routes")

    contract = (
        Path(__file__).resolve().parent.parent
        / "references"
        / f"{args.role}.md"
    )
    lines = [
        f"role: {args.role}",
        f"reports_to: {args.reports_to}",
        f"front_key: {args.front_key}",
        f"route: {route_id}",
        f"agent: {selected['agent']}",
        f"model: {selected['model']}",
        f"effort: {selected['effort']}",
        f"Role contract: {contract}",
    ]
    if decision:
        lines.append(f"routing_status: {decision['status']}")
        if selected.get("id"):
            lines.append(f"candidate: {selected['id']}")
        winner = decision.get("provenance", {}).get("winner")
        if winner:
            lines.append(
                f"route_source: {winner.get('scope')} — {winner.get('path')}"
            )
        if decision.get("reason"):
            lines.append(
                f"routing_reason: {json.dumps(decision['reason'], ensure_ascii=False)}"
            )
        if decision.get("warnings"):
            lines.append(
                "routing_warnings: "
                + json.dumps(decision["warnings"], ensure_ascii=False)
            )
        if decision.get("quota"):
            lines.append(
                "routing_quota: "
                + json.dumps(decision["quota"], ensure_ascii=False, sort_keys=True)
            )
    if args.bead:
        lines += [f"bead: {args.bead}", f"Read Bead {args.bead}: it is the work contract."]
    else:
        lines += [
            f"bootstrap_request: {json.dumps(args.request, ensure_ascii=False)}",
            "Create the first Bead from that verbatim request before decomposing or implementing.",
        ]
    if route_lines:
        lines.append("Worker routes:")
        lines.extend(f"  - {line}" for line in route_lines)
    return run_key, "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--title", required=True)
    parser.add_argument("--front-key", required=True, help="<run-key>/<front>")
    parser.add_argument("--role", required=True, choices=("captain", "worker"))
    parser.add_argument(
        "--reports-to",
        required=True,
        choices=("user", "commander", "captain"),
    )
    parser.add_argument("--route")
    work = parser.add_mutually_exclusive_group(required=True)
    work.add_argument("--bead")
    work.add_argument("--request")
    routing = parser.add_mutually_exclusive_group(required=True)
    routing.add_argument("--routes-json")
    routing.add_argument("--decision-json")
    parser.add_argument(
        "--format",
        choices=("json", "spec", "text"),
        default="json",
    )
    args = parser.parse_args(argv)
    try:
        run_key, spec = build_spec(args)
    except Error as exc:
        print(f"assignment: {exc}", file=sys.stderr)
        return 1
    if args.format == "spec":
        sys.stdout.write(spec)
    elif args.format == "text":
        sys.stdout.write(f"TITLE: {args.title.strip()}\n\n{spec}")
    else:
        print(
            json.dumps(
                {
                    "title": args.title.strip(),
                    "spec": spec,
                    "run_key": run_key,
                    "bead": args.bead,
                },
                ensure_ascii=False,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
