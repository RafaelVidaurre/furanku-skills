#!/usr/bin/env python3
"""Census historical sessions matching configured model/effort routes.

The private report inventories evidence availability; it does not assign quality.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re

import config
import retrospect


def base_model(model):
    return re.sub(r"\[[^]]+\]$", "", model)


def route_index(rows):
    index = {}
    for row in rows:
        key = (base_model(row["model"]), row["effort"])
        index.setdefault(key, []).append({
            "candidate": row["candidate"], "agent": row["agent"],
            "state": row["state"],
            "context_variant_unverified": base_model(row["model"]) != row["model"],
        })
    return index


def inspect(row, routes, session_reader=retrospect.session_state):
    matches = [m for m in row["models"] if (m["model"], m["effort"]) in routes]
    if not matches:
        return None
    result = {
        "provider": row["provider"], "path": row["path"],
        "source_key": retrospect.source_key(Path(row["path"]), row["provider"]),
        "matching_models": matches,
        "configured_routes": [candidate for m in matches
                              for candidate in routes[(m["model"], m["effort"])]],
        **{key: row[key] for key in ("summary_model", "summary_fallback_used") if key in row},
    }
    if row.get("error"):
        result["disposition"] = "inventory_error"
    elif not row["user_messages"] or not row["assistant_messages"]:
        result["disposition"] = "no_exchange"
    elif row["mixed"]:
        result["disposition"] = "mixed_unattributed"
    else:
        try:
            state = session_reader(Path(row["path"]), row["provider"])
        except (ValueError, OSError, UnicodeError, json.JSONDecodeError) as error:
            result["disposition"] = "unprojectable"
            result["error_type"] = type(error).__name__
        else:
            if (state["model"], state["effort"]) not in {
                (model["model"], model["effort"]) for model in matches
            }:
                result["disposition"] = "unprojectable"
                result["error_type"] = "model_attribution_mismatch"
                return result
            result["disposition"] = "projected"
            result["answered_turns"] = len(state["turns"]) + state["omitted_turns"]
            result["projected_turns"] = len(state["turns"])
            result["omitted_turns"] = state["omitted_turns"]
            result["unanswered_final_user_messages"] = len(state.get("trailing_user_messages", []))
    return result


def census(inventory, routes, session_reader=retrospect.session_state):
    for line in inventory:
        if line.strip():
            result = inspect(json.loads(line), routes, session_reader)
            if result is not None:
                yield result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    private = retrospect.PRIVATE_ROOT
    if args.output.parent != private or args.output.is_symlink() or private.is_symlink():
        parser.error(f"Output must be a new regular file directly inside {private}")
    private.mkdir(mode=0o700, parents=True, exist_ok=True)
    private.chmod(0o700)
    routes = route_index(config.model_rows(args.repo))
    try:
        source = args.inventory.open(encoding="utf-8")
    except OSError as error:
        parser.error(f"Cannot read inventory: {error.strerror or type(error).__name__}")
    try:
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        source.close()
        parser.error("Output already exists; choose a new private census filename")
    counts = Counter()
    with source, os.fdopen(fd, "w", encoding="utf-8") as output:
        for result in census(source, routes):
            output.write(json.dumps(result, ensure_ascii=False) + "\n")
            counts[result["disposition"]] += 1
            counts["matched"] += 1
            if result["disposition"] == "projected":
                counts["one_turn"] += result["answered_turns"] == 1
                counts["multiple_turns"] += result["answered_turns"] > 1
                counts["with_unanswered_final_user"] += result["unanswered_final_user_messages"] > 0
    print(json.dumps(dict(counts), sort_keys=True))


if __name__ == "__main__":
    main()
