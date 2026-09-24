#!/usr/bin/env python3
"""Prepare or run a six-case Jev routing trial. Recommendations never launch."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import jev
import router


CASES = Path(__file__).resolve().parent.parent / "references/jev-trial-cases.json"
PUBLIC_PREFERENCES = [
    {"scope": "trial", "text": "Use adequate low-cost capability for fully specified mechanical work."},
    {"scope": "trial", "text": "Prefer Grok high for known-pattern implementation, Astra high for novel architecture, and Astra or Fable high for visual design. Grok is excluded from aesthetic work."},
    {"scope": "trial", "text": "Use higher-than-high effort only for a material task-specific advantage."},
]
from jev_context import candidate_profile, prepare_case


def use_public_context(compiled):
    public_candidates = json.loads(router.CATALOG.read_text())["candidates"]
    # Preserve effective availability while replacing private profiles.
    compiled["candidates"] = {
        key: dict(value,
                  enabled=compiled["candidates"][key].get("enabled", True),
                  explicit=compiled["candidates"][key].get("explicit", False))
        for key, value in public_candidates.items() if key in compiled["candidates"]
    }
    compiled["preferences"] = PUBLIC_PREFERENCES



def score(case, result, mapping, compiled):
    answer = result["answers"]["route"]
    alias = answer["choice"]
    selected_id = mapping.get(alias)
    return {"case": case["id"], "candidate": selected_id, "abstained": alias == "abstain",
            "choice_probability": answer["probabilities"][alias], "confidence": answer["confidence"],
            "probabilities": {mapping.get(option, option): probability
                              for option, probability in answer["probabilities"].items()},
            "elapsed_seconds": result["elapsed_seconds"], "usage": result["usage"], "cost_usd": result["cost_usd"]}


def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # These snapshots can contain private routing preferences; never publish them wholesale.
    with path.open("w", encoding="utf-8") as stream:
        path.chmod(0o600)
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--launchable-via", required=True, help="trial launcher set; no agent will be launched")
    parser.add_argument("--quota-axi", action="store_true")
    parser.add_argument("--case", action="append", default=[], help="run only these case IDs")
    parser.add_argument("--live", action="store_true", help="make Gateway requests, rather than only prepare inputs")
    parser.add_argument("--public-context", action="store_true", help="use public catalog and synthetic policy instead of private preferences/overrides")
    parser.add_argument("--allow-abstain", action="store_true", help="offer Jev an abstain choice in each trial")
    parser.add_argument("--require-zdr", action="store_true", help="require Gateway Zero Data Retention (plan access required)")
    parser.add_argument("--output", type=Path, default=Path(".furanku-skills/model-routing/jev-trial"))
    args = parser.parse_args(argv)
    try:
        if args.live:
            jev.load_key()  # Fail before quota collection when setup is missing.
        compiled = router.compile_brief(args.repo)
        if args.public_context:
            use_public_context(compiled)
        runtime = router.load_runtime(argparse.Namespace(quota_axi=args.quota_axi, runtime_file=None), compiled["candidates"])
        cases = json.loads(CASES.read_text())["cases"]
        unknown = set(args.case) - {c["id"] for c in cases}
        if unknown:
            raise jev.Error("Unknown trial case ID.")
        launchers = router.parse_allowed_launchers([args.launchable_via])
        rows = []
        for case in cases:
            if args.case and case["id"] not in args.case:
                continue
            payload, mapping, excluded = prepare_case(
                compiled, runtime, case, launchers, allow_abstain=args.allow_abstain)
            if payload is None:
                raise jev.Error("Only one eligible candidate; add --allow-abstain to make a Jev Choice trial.")
            if args.require_zdr:
                payload["providerOptions"]["gateway"]["zeroDataRetention"] = True
            write_private(args.output / (case["id"] + ".request.json"), payload)
            write_private(args.output / (case["id"] + ".context.json"), {
                "case": case, "mapping": mapping, "excluded": excluded})
            if not args.live:
                print(json.dumps({"case": case["id"], "status": "prepared", "eligible_candidates": len(mapping)}), flush=True)
                continue
            result = jev.evaluate_bounded(payload)
            row = score(case, result, mapping, compiled)
            row["request_sha256"] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
            rows.append(row)
            write_private(args.output / "results.json", {
                "status": "trial", "launch_authorized": False,
                "context_mode": "public" if args.public_context else "configured",
                "require_zdr": args.require_zdr, "allow_abstain": args.allow_abstain,
                "cases": rows})
            print(json.dumps(row), flush=True)
        return 0
    except (jev.Error, router.Error, router.exact_config.Error) as exc:
        # Local router diagnostics may name private accounts/configuration; remain local.
        print(f"Jev trial: {exc}", file=sys.stderr)
        return 1
    except (OSError, ValueError):
        print("Jev trial: cannot read or write trial files.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
