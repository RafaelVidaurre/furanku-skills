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

    rows = read_routes(args.routes_json)
    expected_prefix = f"{args.role}."
    if args.route != args.role and not args.route.startswith(expected_prefix):
        raise Error(f"route {args.route!r} does not match role {args.role!r}")
    selected = rows.get(args.route)
    if not isinstance(selected, dict):
        raise Error(f"route {args.route!r} is absent from --routes-json")
    required = ("agent", "model", "effort")
    if any(not selected.get(field) for field in required):
        raise Error(f"route {args.route!r} lacks agent, model, or effort")

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
        f"route: {args.route}",
        f"agent: {selected['agent']}",
        f"model: {selected['model']}",
        f"effort: {selected['effort']}",
        f"Role contract: {contract}",
    ]
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
    parser.add_argument("--route", required=True)
    work = parser.add_mutually_exclusive_group(required=True)
    work.add_argument("--bead")
    work.add_argument("--request")
    parser.add_argument("--routes-json", required=True)
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
