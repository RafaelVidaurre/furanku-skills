#!/usr/bin/env python3
"""Emit a compact Commander task title + spec (provenance + Bead pointer only)."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any


class Error(Exception):
    pass


def parse_front_key(front_key: str) -> tuple[str, str, str]:
    """Return (run_key, bead_id, front_name) from <run-key>/<bead-id>/<front-name>."""
    parts = [p for p in front_key.split("/") if p]
    if len(parts) < 3:
        raise Error(
            "--front-key must be <run-key>/<bead-id>/<front-name> (at least three segments)"
        )
    return parts[0], "/".join(parts[1:-1]), parts[-1]


def read_routes_json(value: str | None) -> str | None:
    if value is None:
        return None
    if value == "-":
        raw = sys.stdin.read()
        if not raw.strip():
            raise Error("--routes-json - requires JSON on stdin")
        return raw
    return value


def compact_routes(routes_json: str | None) -> list[str]:
    if not routes_json:
        return []
    try:
        data = json.loads(routes_json)
    except json.JSONDecodeError as exc:
        raise Error(f"invalid --routes-json: {exc}") from exc

    if isinstance(data, dict) and "routes" in data and isinstance(data["routes"], dict):
        rows = data["routes"]
    elif isinstance(data, dict):
        rows = data
    else:
        raise Error('--routes-json must be a route object or {"routes": {...}}')

    lines: list[str] = []
    for route_id in sorted(rows):
        row = rows[route_id]
        if not isinstance(row, dict):
            raise Error(f"route {route_id!r} is not an object")
        parts = [
            f"{route_id}: agent={row.get('agent')} model={row.get('model')} "
            f"effort={row.get('effort')}"
        ]
        work = row.get("work")
        if work:
            parts.append(f"work={work}")
        lines.append(" ".join(parts))
    return lines


def build_spec(args: argparse.Namespace) -> str:
    title = args.title.strip()
    if not title:
        raise Error("--title must be a non-empty human outcome")
    if title.upper().startswith("COMMANDER RUN PROVENANCE"):
        raise Error("title must be a human outcome, not a provenance banner")

    run_key, bead, _front_name = parse_front_key(args.front_key)
    if args.bead and args.bead != bead:
        raise Error(f"--bead {args.bead!r} does not match front-key bead {bead!r}")
    if args.run_key and args.run_key != run_key:
        raise Error(
            f"--run-key {args.run_key!r} does not match front-key run key {run_key!r}"
        )

    lines = [
        f"front_key: {args.front_key}",
        f"bead: {bead}",
        f"route: {args.route}",
        f"agent: {args.agent}",
        f"model: {args.model}",
        f"effort: {args.effort}",
        f"checkout: {args.checkout}",
        f"autonomy: {args.autonomy}",
        f"Read Bead {bead}: it is the full work contract.",
    ]

    routes_raw = read_routes_json(args.routes_json)
    if args.captain_contract:
        lines.append(f"Captain contract: {args.captain_contract}")
        route_lines = compact_routes(routes_raw)
        if route_lines:
            lines.append("Child routes:")
            lines.extend(f"  - {line}" for line in route_lines)
        elif routes_raw is not None:
            raise Error("--routes-json produced no routes")
    elif routes_raw is not None:
        raise Error("--routes-json is only valid with --captain-contract")

    body = "\n".join(lines) + "\n"
    if args.format == "spec":
        return body
    if args.format == "text":
        return f"TITLE: {title}\n\n{body}"
    return json.dumps({"title": title, "spec": body, "run_key": run_key, "bead": bead}) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build a compact Commander dispatch (provenance + Bead pointer)."
    )
    parser.add_argument("--title", required=True, help="Short human outcome (task title)")
    parser.add_argument(
        "--front-key",
        required=True,
        help="<run-key>/<bead-id>/<front-name>",
    )
    parser.add_argument("--route", required=True)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--effort", required=True)
    parser.add_argument("--checkout", required=True, help="Mode and/or path")
    parser.add_argument(
        "--autonomy",
        required=True,
        choices=("supervised", "autonomous"),
    )
    parser.add_argument(
        "--run-key",
        help="Optional check only; must match front-key prefix",
    )
    parser.add_argument(
        "--bead",
        help="Optional check only; must match front-key bead segment",
    )
    parser.add_argument(
        "--captain-contract",
        help="Absolute path to captain.md (Captain fronts only)",
    )
    parser.add_argument(
        "--routes-json",
        help="Compact resolve JSON, or '-' to read stdin (with --captain-contract)",
    )
    parser.add_argument(
        "--format",
        choices=("json", "spec", "text"),
        default="json",
        help="json {title,spec} default; spec body only; text debug view",
    )
    args = parser.parse_args(argv)
    try:
        sys.stdout.write(build_spec(args))
    except Error as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
