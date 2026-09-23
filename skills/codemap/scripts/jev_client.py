#!/usr/bin/env python3
"""Codemap's Jev client: Choice, Score, and Boolean questions through Vercel AI Gateway.

Transport rules mirror the model-routing skill's jev.py: TypeSafe-only routing,
no redirects or retries, bounded request and response, one deadline per call,
and errors that never echo provider bodies or credentials.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import stat
import sys
import time
import urllib.error
import urllib.request


MODEL = "typesafe-ai/jev"
ENDPOINT = "https://ai-gateway.vercel.sh/v1/evaluate"
MAX_BYTES = 1_000_000
QUESTION_TYPES = ("choice", "score", "boolean")
SETUP_HINT = ("set AI_GATEWAY_API_KEY or run the model-routing skill's jev.py setup "
              "(python3 <model-routing skill dir>/scripts/jev.py setup)")


class Error(Exception):
    """An actionable diagnostic that contains no credential or response body."""


def credential_path():
    """The key saved by the model-routing skill; shared by every skill on this machine."""
    return Path.home() / ".furanku-skills/model-routing/secrets/gateway.json"


def valid_key(value):
    if not isinstance(value, str) or not value or len(value) > 8192:
        raise Error("The AI Gateway API key is empty or malformed; " + SETUP_HINT + ".")
    if any(ord(c) < 33 or ord(c) > 126 for c in value):
        raise Error("The AI Gateway API key must be a single token without whitespace; " + SETUP_HINT + ".")
    return value


def saved_key():
    path = credential_path()
    if path.is_symlink() or path.parent.is_symlink():
        raise Error("Gateway credential storage must be a regular file and directory; " + SETUP_HINT + ".")
    try:
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > 16384:
            raise Error("Invalid Gateway credential file; " + SETUP_HINT + ".")
        if os.name == "posix" and (info.st_mode & 0o077 or info.st_uid != os.getuid()):
            raise Error("Gateway credential must be owned by you with mode 600; " + SETUP_HINT + ".")
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise Error("Gateway key is missing; " + SETUP_HINT + ".") from None
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise Error("Cannot read the Gateway credential; " + SETUP_HINT + ".") from None
    if not isinstance(data, dict):
        raise Error("Invalid Gateway credential file; " + SETUP_HINT + ".")
    return valid_key(data.get("AI_GATEWAY_API_KEY"))


def key_source():
    return "environment" if "AI_GATEWAY_API_KEY" in os.environ else "machine"


def load_key():
    """Return the Gateway key: the process environment first, then the machine credential."""
    if "AI_GATEWAY_API_KEY" in os.environ:
        return valid_key(os.environ["AI_GATEWAY_API_KEY"])
    return saved_key()


def _nonempty_text(value):
    return isinstance(value, str) and bool(value.strip())


def validate_question(name, question):
    if not isinstance(name, str) or not name:
        raise Error("Every question needs a nonempty string ID.")
    if not isinstance(question, dict) or question.get("type") not in QUESTION_TYPES:
        raise Error(f"Question {name!r} must be one of {', '.join(QUESTION_TYPES)}.")
    if not _nonempty_text(question.get("instructions")):
        raise Error(f"Question {name!r} needs instructions.")
    kind = question["type"]
    criteria = question.get("criteria")
    if kind == "choice":
        if not isinstance(criteria, dict) or not 2 <= len(criteria) <= 255:
            raise Error(f"Choice {name!r} needs 2–255 options, including abstain when appropriate.")
        if any(not isinstance(k, str) or not k for k in criteria) or any(not _nonempty_text(v) for v in criteria.values()):
            raise Error(f"Choice {name!r}: every option needs a nonempty key and description.")
    elif kind == "score":
        if not isinstance(criteria, list) or not 2 <= len(criteria) <= 10:
            raise Error(f"Score {name!r} needs an ordered list of 2–10 rung descriptions.")
        if any(not _nonempty_text(v) for v in criteria):
            raise Error(f"Score {name!r}: every rung needs a nonempty description.")
    else:
        if not isinstance(criteria, dict) or set(criteria) != {"true", "false"}:
            raise Error(f"Boolean {name!r} needs criteria with exactly the keys true and false.")
        if any(not _nonempty_text(v) for v in criteria.values()):
            raise Error(f"Boolean {name!r}: both outcomes need a nonempty description.")
    return {"type": kind, "instructions": question["instructions"], "criteria": criteria}


def validate_request(payload):
    if not isinstance(payload, dict) or payload.get("model") != MODEL:
        raise Error(f"The request must use model {MODEL}.")
    if not isinstance(payload.get("state"), (str, dict, list)):
        raise Error("The request needs text or structured state.")
    questions = payload.get("questions")
    if not isinstance(questions, dict) or not questions:
        raise Error("The request needs at least one named question.")
    clean = {name: validate_question(name, question) for name, question in questions.items()}
    # No model/provider fallbacks or alternate destinations.
    gateway = {"only": ["typesafe-ai"]}
    options = payload.get("providerOptions")
    if isinstance(options, dict) and isinstance(options.get("gateway"), dict) and options["gateway"].get("zeroDataRetention") is True:
        gateway["zeroDataRetention"] = True
    return {"model": MODEL, "state": payload["state"], "questions": clean,
            "providerOptions": {"gateway": gateway}}


def probability(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1


def _distribution(distribution, keys, label):
    if not isinstance(distribution, dict) or set(distribution) != set(keys):
        raise Error(f"Jev did not return a complete distribution for {label}.")
    if not all(probability(v) for v in distribution.values()):
        raise Error(f"Jev returned invalid probabilities for {label}.")
    # Conservative tolerance; reject rather than renormalize a mismatch.
    if abs(sum(distribution.values()) - 1) > 0.02:
        raise Error(f"Jev returned a distribution that does not sum to one for {label}.")
    return {k: distribution[k] for k in keys}


def validate_answer(name, question, answer):
    kind = question["type"]
    if not isinstance(answer, dict) or answer.get("type") != kind:
        raise Error(f"Jev answered {name!r} with the wrong answer type.")
    if kind == "choice":
        choice = answer.get("choice")
        if not isinstance(choice, str) or choice not in question["criteria"]:
            raise Error(f"Jev selected an option outside the offered set for {name!r}.")
        distribution = _distribution(answer.get("probabilities"), list(question["criteria"]), repr(name))
        # Allow rounding slack between the selected option and the reported maximum.
        if distribution[choice] < max(distribution.values()) - 0.05:
            raise Error(f"Jev returned an inconsistent option distribution for {name!r}.")
        return {"type": kind, "choice": choice, "probabilities": distribution}
    if kind == "score":
        rungs = [str(i) for i in range(len(question["criteria"]))]
        score = answer.get("score")
        if not isinstance(score, (int, float)) or isinstance(score, bool) or not math.isfinite(score):
            raise Error(f"Jev returned an invalid score for {name!r}.")
        if not 0 <= score <= len(rungs) - 1:
            raise Error(f"Jev returned a score outside the rung range for {name!r}.")
        distribution = _distribution(answer.get("probabilities"), rungs, repr(name))
        clean = {"type": kind, "score": score, "probabilities": distribution}
        legend = answer.get("legend")
        if isinstance(legend, list) and all(isinstance(v, str) for v in legend):
            clean["legend"] = legend
        return clean
    value = answer.get("probability")
    if not probability(value):
        raise Error(f"Jev returned an invalid probability for {name!r}.")
    return {"type": kind, "probability": value}


def validate_result(result, questions):
    if not isinstance(result, dict) or result.get("model") != MODEL:
        raise Error("Gateway returned an unexpected evaluation model.")
    answers = result.get("answers")
    if not isinstance(answers, dict) or set(answers) != set(questions):
        raise Error("Gateway answer IDs do not match the request.")
    metadata = result.get("providerMetadata") or {}
    if not isinstance(metadata, dict):
        raise Error("Invalid Gateway metadata.")
    typesafe = metadata.get("typesafe") or {}
    confidence = typesafe.get("confidence", {}) if isinstance(typesafe, dict) else {}
    if not isinstance(confidence, dict):
        raise Error("Invalid Jev confidence metadata.")
    clean = {}
    for name, question in questions.items():
        clean[name] = validate_answer(name, question, answers[name])
        certainty = confidence.get(name)
        if certainty is not None:
            if not probability(certainty):
                raise Error(f"Jev returned invalid confidence for {name!r}.")
            clean[name]["confidence"] = certainty
    usage = result.get("usage") or {}
    clean_usage = {k: v for k, v in usage.items() if k in {"inputTokens", "outputTokens"} and type(v) is int and v >= 0} if isinstance(usage, dict) else {}
    gateway = metadata.get("gateway") or {}
    cost = gateway.get("cost") if isinstance(gateway, dict) else None
    if cost is not None:
        try:
            cost = float(cost)
            if not math.isfinite(cost) or cost < 0:
                raise ValueError
        except (ValueError, TypeError, OverflowError):
            raise Error("Gateway returned invalid cost metadata.") from None
    return {"model": MODEL, "answers": clean, "usage": clean_usage, "cost_usd": cost}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP_HINTS = {
    400: "the request was rejected as invalid; report this as a codemap bug with the dry-run request",
    401: "the Gateway key was refused; " + SETUP_HINT,
    402: "the Gateway team is out of credits or over budget; top up, then rerun decide",
    403: "the key lacks Gateway access; check the team's Gateway settings",
    422: "the request was rejected as invalid; report this as a codemap bug with the dry-run request",
    429: "rate limited; rerun decide in a minute (cached decisions are reused). If it persists, `decide --dry-run` names the largest request: an oversized one is a codemap bug to report",
    529: "Jev is overloaded; rerun decide in a few minutes (cached decisions are reused)",
}


def evaluate(payload, *, timeout=20):
    """Send one validated request and return the validated, cleaned result."""
    payload = validate_request(payload)
    body = json.dumps(payload, allow_nan=False).encode()
    if len(body) > MAX_BYTES:
        raise Error("Jev request exceeds the 1 MB transport limit.")
    key = load_key()
    request = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json"})
    started = time.monotonic()
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise Error("Gateway response exceeded the 1 MB size limit.")
        result = validate_result(json.loads(raw), payload["questions"])
    except urllib.error.HTTPError as exc:
        # Recognize a known actionable error type without echoing provider text,
        # which can contain credentials or private account information.
        try:
            failure = json.loads(exc.read(16384))
            error = failure.get("error", {}) if isinstance(failure, dict) else {}
            verification = isinstance(error, dict) and error.get("type") == "customer_verification_required"
        except (OSError, ValueError, UnicodeError):
            verification = False
        if verification:
            raise Error(
                f"Gateway HTTP {exc.code} (customer_verification_required): Vercel requires a valid "
                "payment card on the team associated with this key before serving requests, including "
                "free credits. Complete the team's billing verification, then rerun decide."
            ) from None
        raise Error(f"Gateway HTTP {exc.code}: {HTTP_HINTS.get(exc.code, 'evaluation failed')}; no fallback was used.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise Error("Gateway connection failed or timed out; no fallback was used.") from None
    except (UnicodeError, json.JSONDecodeError):
        raise Error("Gateway returned invalid JSON.") from None
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status", help="report credential readiness without making a request")
    probe = commands.add_parser("evaluate", help="send one prepared request from a file or stdin (-)")
    probe.add_argument("--request", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "status":
            load_key()
            result = {"status": "configured", "source": key_source(), "authentication": "not-tested"}
        else:
            raw = sys.stdin.read(MAX_BYTES + 1) if str(args.request) == "-" else args.request.read_text(encoding="utf-8")
            result = evaluate(json.loads(raw))
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except Error as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr)
        return 1
    except (OSError, ValueError, UnicodeError):
        print('{"status":"error","error":"Cannot read or parse the requested file."}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('{"status":"cancelled"}', file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
