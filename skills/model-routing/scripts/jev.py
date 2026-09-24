#!/usr/bin/env python3
"""Store a user-provided Gateway key and evaluate Jev without launching agents."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import getpass
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import warnings


MODEL = "typesafe-ai/jev"
ENDPOINT = "https://ai-gateway.vercel.sh/v1/evaluate"
MAX_BYTES = 1_000_000


class Error(Exception):
    """An actionable diagnostic that contains no credential or response body."""


class RateLimitError(Error):
    """A bounded Jev call could not clear a Gateway 429."""

    def __init__(self, attempts, retry_after_seconds=None):
        self.attempts = attempts
        self.retry_after_seconds = retry_after_seconds
        timing = (f"retry after {retry_after_seconds:g} seconds"
                  if retry_after_seconds is not None else "retry later")
        super().__init__(f"Gateway HTTP 429: rate limited after {attempts} attempt(s); {timing}.")


def credential_path():
    return Path.home() / ".furanku-skills/model-routing/secrets/gateway.json"


def valid_key(value):
    if not isinstance(value, str) or not value or len(value) > 8192:
        raise Error("Provide a nonempty AI Gateway API key.")
    if any(ord(c) < 33 or ord(c) > 126 for c in value):
        raise Error("The key must be a single token without whitespace.")
    return value


def saved_key():
    path = credential_path()
    if path.is_symlink() or path.parent.is_symlink():
        raise Error("Credential storage must be a regular file and directory.")
    try:
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > 16384:
            raise Error("Invalid Gateway credential file; run jev.py setup again.")
        if os.name == "posix" and (
            info.st_mode & 0o077 or info.st_uid != os.getuid()
        ):
            raise Error("Gateway credential must be owned by you with mode 600; run setup again.")
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise Error("Gateway key is missing. Run python3 <skill-dir>/scripts/jev.py setup.") from None
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise Error("Cannot read Gateway credential; run jev.py setup again.") from None
    if not isinstance(data, dict):
        raise Error("Invalid Gateway credential file; run jev.py setup again.")
    return valid_key(data.get("AI_GATEWAY_API_KEY"))


def load_key():
    if "AI_GATEWAY_API_KEY" in os.environ:
        return valid_key(os.environ["AI_GATEWAY_API_KEY"]), "environment"
    return saved_key(), "machine"


def store_key(key):
    key = valid_key(key)
    path = credential_path()
    if path.is_symlink() or path.parent.is_symlink():
        raise Error("Credential storage must be a regular file and directory.")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            os.fchmod(stream.fileno(), 0o600)
            json.dump({"AI_GATEWAY_API_KEY": key}, stream)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path


def setup(from_stdin=False):
    if from_stdin:
        key = sys.stdin.read(8194).rstrip("\r\n")
    else:
        if not sys.stdin.isatty():
            raise Error("Run setup in your terminal to paste the key at a hidden prompt; secret managers can use setup --stdin.")
        print(f"Save your Vercel AI Gateway key machine-wide at {credential_path()}", file=sys.stderr)
        print("Paste your existing key below. Input is hidden; Enter saves it.", file=sys.stderr)
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            try:
                key = getpass.getpass("AI Gateway API key: ")
            except (getpass.GetPassWarning, EOFError):
                raise Error("Hidden key entry is unavailable; use an interactive terminal or setup --stdin.") from None
    path = store_key(key)
    return {"status": "saved", "path": str(path), "authentication": "not-tested"}


def validate_request(payload):
    if not isinstance(payload, dict) or payload.get("model") != MODEL:
        raise Error(f"The request must use model {MODEL}.")
    if not isinstance(payload.get("state"), (str, dict, list)):
        raise Error("The request needs text or structured state.")
    questions = payload.get("questions")
    if not isinstance(questions, dict) or not questions:
        raise Error("The request needs named Choice questions.")
    for question in questions.values():
        if not isinstance(question, dict) or question.get("type") != "choice":
            raise Error("This client supports Choice questions only.")
        criteria = question.get("criteria")
        if not isinstance(criteria, dict) or not 2 <= len(criteria) <= 255:
            raise Error("Each Choice needs 2–255 options.")
        if any(not isinstance(v, str) or not v for v in criteria.values()):
            raise Error("Every option needs a nonempty description.")
        if not isinstance(question.get("instructions"), str) or not question["instructions"]:
            raise Error("Every question needs instructions.")
    # No model/provider fallbacks or alternate destinations.
    gateway = {"only": ["typesafe-ai"]}
    if payload.get("providerOptions", {}).get("gateway", {}).get("zeroDataRetention") is True:
        gateway["zeroDataRetention"] = True
    if payload.get("providerOptions", {}).get("gateway", {}).get("disallowPromptTraining") is True:
        gateway["disallowPromptTraining"] = True
    return {"model": MODEL, "state": payload["state"], "questions": questions,
            "providerOptions": {"gateway": gateway}}


def probability(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1


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
        answer = answers[name]
        if not isinstance(answer, dict) or answer.get("type") != "choice":
            raise Error("Gateway returned a non-Choice answer.")
        choice = answer.get("choice")
        if not isinstance(choice, str) or choice not in question["criteria"]:
            raise Error("Jev selected an option outside the offered set.")
        distribution = answer.get("probabilities")
        if not isinstance(distribution, dict) or set(distribution) != set(question["criteria"]):
            raise Error("Jev did not return a complete option distribution.")
        if not all(probability(v) for v in distribution.values()):
            raise Error("Jev returned invalid probabilities.")
        # Conservative trial tolerance; reject rather than renormalize a mismatch.
        if abs(sum(distribution.values()) - 1) > 0.02 or distribution[choice] < max(distribution.values()):
            raise Error("Jev returned an inconsistent option distribution.")
        certainty = confidence.get(name)
        if certainty is not None and not probability(certainty):
            raise Error("Jev returned invalid confidence.")
        clean[name] = {"choice": choice, "probabilities": distribution, "confidence": certainty}
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
    return {"status": "recommendation", "model": MODEL, "answers": clean,
            "usage": clean_usage, "cost_usd": cost}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def retry_after_seconds(headers):
    """Parse RFC 9110 Retry-After; ignore invalid or negative values."""
    raw = headers.get("Retry-After") if headers else None
    if raw is None:
        return None
    raw = raw.strip()
    if raw.isascii() and raw.isdecimal():
        return float(raw)
    try:
        when = parsedate_to_datetime(raw)
        if when.tzinfo is None:
            return None
        return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())
    except (TypeError, ValueError, OverflowError):
        return None


def evaluate(payload, *, timeout=15):
    payload = validate_request(payload)
    body = json.dumps(payload, allow_nan=False).encode()
    if len(body) > MAX_BYTES:
        raise Error("Jev request exceeds the 1 MB transport limit.")
    key, _source = load_key()
    request = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json"})
    started = time.monotonic()
    deadline = started + min(timeout + 3, 18)
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(1, 4):
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise Error("Gateway evaluation exceeded its 18-second retry budget.")
            with opener.open(request, timeout=min(timeout, remaining)) as response:
                raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise Error("Gateway response exceeded the 1 MB size limit.")
            result = validate_result(json.loads(raw), payload["questions"])
            result["elapsed_seconds"] = round(time.monotonic() - started, 3)
            result["attempts"] = attempt
            return result
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                server_delay = retry_after_seconds(exc.headers)
                exc.close()
                delay = server_delay if server_delay is not None else (0.25, 1.0, 2.0)[attempt - 1]
                remaining = deadline - time.monotonic()
                if attempt == 3 or delay + 0.5 >= remaining:
                    raise RateLimitError(attempt, server_delay) from None
                time.sleep(delay)
                continue
            # Do not echo provider bodies: they can contain credentials or account data.
            try:
                failure = json.loads(exc.read(16384))
                error = failure.get("error", {}) if isinstance(failure, dict) else {}
                error_type = error.get("type") if isinstance(error, dict) else None
                if not isinstance(error_type, str) or not re.fullmatch(r"[a-z0-9_-]{1,64}", error_type):
                    error_type = None
                verification = error_type == "customer_verification_required"
            except (OSError, ValueError, UnicodeError):
                verification = False
                error_type = None
            finally:
                exc.close()
            if verification:
                raise Error(
                    f"Gateway HTTP {exc.code} (customer_verification_required): "
                    "Vercel requires a valid payment card on the team associated with "
                    "this key before serving requests, including free credits. "
                    "Complete the team's billing verification, then rerun the trial."
                ) from None
            hints = {401: "check the saved Gateway key", 403: "check Gateway access",
                     402: "check Gateway credits or budget"}
            detail = f" ({error_type})" if error_type else ""
            raise Error(f"Gateway HTTP {exc.code}{detail}: {hints.get(exc.code, 'evaluation failed')}; no fallback was used.") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise Error("Gateway connection failed or timed out; no fallback was used.") from None
        except (UnicodeError, json.JSONDecodeError):
            raise Error("Gateway returned invalid JSON.") from None


def evaluate_bounded(payload):
    """Bound the entire transport, including DNS and trickling error bodies."""
    payload = validate_request(payload)
    try:
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "evaluate", "--request", "-"],
            input=json.dumps(payload, allow_nan=False), text=True, capture_output=True,
            timeout=20, check=False,
        )
    except subprocess.TimeoutExpired:
        raise Error("Gateway evaluation exceeded 20 seconds; no fallback was used.") from None
    if completed.returncode:
        try:
            failure = json.loads(completed.stderr)
            message = failure["error"]
        except (ValueError, KeyError, TypeError):
            message = "Gateway evaluation failed; no fallback was used."
            failure = {}
        if failure.get("code") == "rate_limited":
            raise RateLimitError(failure["attempts"], failure.get("retry_after_seconds"))
        raise Error(message)
    try:
        return json.loads(completed.stdout)
    except ValueError:
        raise Error("Gateway evaluation returned invalid output.") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    setup_parser = commands.add_parser("setup", help="save a user-provided key machine-wide")
    setup_parser.add_argument("--stdin", action="store_true", help="read a key from a secret-manager pipe")
    commands.add_parser("status", help="report credential readiness without making a request")
    probe = commands.add_parser("evaluate", help="send a prepared Choice request; never launches")
    probe.add_argument("--request", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "setup":
            result = setup(args.stdin)
        elif args.command == "status":
            _key, source = load_key()
            result = {"status": "configured", "source": source, "authentication": "not-tested"}
        else:
            raw = sys.stdin.read(MAX_BYTES + 1) if str(args.request) == "-" else args.request.read_text(encoding="utf-8")
            result = evaluate(json.loads(raw))
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except Error as exc:
        failure = {"status": "error", "error": str(exc)}
        if isinstance(exc, RateLimitError):
            failure.update(code="rate_limited", attempts=exc.attempts,
                           retry_after_seconds=exc.retry_after_seconds)
        print(json.dumps(failure), file=sys.stderr)
        return 1
    except (OSError, ValueError, UnicodeError):
        print('{"status":"error","error":"Cannot read or write the requested file."}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('{"status":"cancelled"}', file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
