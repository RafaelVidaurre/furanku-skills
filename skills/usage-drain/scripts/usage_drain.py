#!/usr/bin/env python3
"""Report what is draining Codex, Claude, and Grok usage.

Prints one JSON object. Each requested harness is a key of "harnesses".
Codex starts at its latest primary quota reset unless --since is set.
Claude and Grok local logs have no allowance reset, so their omitted start
is the trailing 7 days.

  python3 usage_drain.py [--harness all|codex|claude|grok]
      [--since ISO] [--until ISO]
      [--codex-home DIR] [--sessions DIR ...] [--auth FILE] [--account EMAIL|ID]
      [--projects DIR ...] [--grok-home DIR]
"""

import argparse
import io
import json
import sys
from pathlib import Path

import claude_usage
import codex_usage
import grok_usage

HARNESSES = ("codex", "claude", "grok")


def run_captured(main, argv):
    stdout = io.StringIO()
    stderr = io.StringIO()
    code = main(argv, stdout, stderr)
    text = stdout.getvalue().strip()
    report = json.loads(text) if text else None
    return code, report, stderr.getvalue()


def main(argv=None, stdout=None, stderr=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    parser = argparse.ArgumentParser(prog="usage_drain.py", description=__doc__)
    parser.add_argument("--harness", choices=(*HARNESSES, "all"), default="all")
    parser.add_argument("--since", help="Range start, ISO-8601. Default depends on the harness.")
    parser.add_argument("--until", help="Range end, ISO-8601, inclusive. Default: the present")
    parser.add_argument("--codex-home", type=Path)
    parser.add_argument("--sessions", action="append", type=Path, default=[])
    parser.add_argument("--auth", type=Path)
    parser.add_argument("--account")
    parser.add_argument("--projects", action="append", type=Path, default=[])
    parser.add_argument("--grok-home", type=Path)
    args = parser.parse_args(argv)
    requested = HARNESSES if args.harness == "all" else (args.harness,)
    shared = []
    if args.since:
        shared.extend(["--since", args.since])
    if args.until:
        shared.extend(["--until", args.until])

    results = {}
    if "codex" in requested:
        codex_argv = list(shared)
        if args.codex_home is not None:
            codex_argv.extend(["--codex-home", str(args.codex_home)])
        for sessions in args.sessions:
            codex_argv.extend(["--sessions", str(sessions)])
        if args.auth is not None:
            codex_argv.extend(["--auth", str(args.auth)])
        if args.account:
            codex_argv.extend(["--account", args.account])
        results["codex"] = run_captured(codex_usage.main, codex_argv)
    if "claude" in requested:
        claude_argv = list(shared)
        for projects in args.projects:
            claude_argv.extend(["--projects", str(projects)])
        results["claude"] = run_captured(claude_usage.main, claude_argv)
    if "grok" in requested:
        grok_argv = list(shared)
        if args.grok_home is not None:
            grok_argv.extend(["--grok-home", str(args.grok_home)])
        results["grok"] = run_captured(grok_usage.main, grok_argv)

    if len(requested) == 1:
        code, report, err = next(iter(results.values()))
        if code != 0:
            stderr.write(err)
            return code
        json.dump({"harnesses": {requested[0]: report}}, stdout, indent=2)
        stdout.write("\n")
        return 0

    body = {}
    codes = []
    for name, (code, report, err) in results.items():
        codes.append(code)
        if code == 0 and report is not None:
            body[name] = report
        else:
            message = err.strip() or f"exit {code}"
            body[name] = {"error": message, "exit": code}
    json.dump({"harnesses": body}, stdout, indent=2)
    stdout.write("\n")
    if any(code == 0 for code in codes):
        return 0
    return 3 if 3 in codes else (codes[0] if codes else 1)


if __name__ == "__main__":
    sys.exit(main())
