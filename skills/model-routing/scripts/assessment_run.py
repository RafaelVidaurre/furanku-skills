#!/usr/bin/env python3
"""Run one bounded, tool-free Codex assessment and retain reported token usage.

Admission budgets stop new calls. The CLI does not expose a hard generation cap;
one in-flight call may exceed its output reservation. Missing usage blocks resume.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

from task_retrospect import write_private


def usage_from_events(events):
    totals = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0}
    completed = 0
    if any(e.get("type") in {"turn.failed", "error"} for e in events):
        raise ValueError("Failed turn may have unreported usage; reconcile before continuing")
    for event in events:
        if event.get("type") == "turn.completed":
            usage = event.get("usage", {})
            if any(type(usage.get(k)) is not int or usage[k] < 0 for k in totals):
                raise ValueError("Missing or invalid Codex usage; budget remains unresolved")
            for key in totals:
                totals[key] += usage[key]
            completed += 1
    started = sum(e.get("type") == "turn.started" for e in events)
    if not completed or (started and started != completed):
        raise ValueError("No completed-turn usage; budget remains unresolved")
    return totals


def admit(records, input_reservation, output_reservation, input_limit, output_limit):
    if any(r.get("status") == "usage_unknown" for r in records):
        raise ValueError("An earlier call has unresolved usage; reconcile before continuing")
    used_input = sum(r["input_reservation"] if r["status"] == "running" else r["usage"]["input_tokens"] for r in records)
    used_output = sum(r["output_reservation"] if r["status"] == "running" else r["usage"]["output_tokens"] for r in records)
    if used_input + input_reservation > input_limit or used_output + output_reservation > output_limit:
        raise ValueError("Measured usage plus next-call reservation exceeds admission budget")


def run(prompt, decision, output, input_limit=3000000, output_limit=500000, output_reservation=32000, images=()):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if (decision.get("status") not in {"selected", "exact"}
        or decision.get("selected", {}).get("agent") != "codex"):
        raise ValueError("A successful Codex routing decision is required")
    launch = decision["selected"]
    # A byte bound plus a conservative allowance for the harness, not a tokenizer estimate.
    image_hashes = [hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in images]
    reservation = len(prompt.encode()) + 40000 + len(images) * 25000
    identity = [prompt, launch, image_hashes] if images else [prompt, launch]
    signature = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    journal = output / (signature + ".json")
    lock = output / ".lock"
    lock.touch(mode=0o600, exist_ok=True)
    with lock.open("r+") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        if journal.exists():
            previous = json.loads(journal.read_text())
            if previous.get("status") == "complete":
                return {**previous, "reused": True}
            raise ValueError("Call already attempted; inspect its status before an explicit retry")
        records = [json.loads(p.read_text()) for p in output.glob("*.json")]
        admit(records, reservation, output_reservation, input_limit, output_limit)
        record = {"status": "running", "signature": signature, "launch": launch,
                  "decision_id": decision.get("decision_id"), "started": time.time(),
                  "input_reservation": reservation, "output_reservation": output_reservation,
                  "image_sha256": image_hashes,
                  "limits": {"input": input_limit, "output": output_limit},
                  "limit_kind": "between-call admission; no hard in-flight generation cap"}
        write_private(journal, json.dumps(record, indent=2))
    prompt_path = output / (signature + ".prompt.txt")
    write_private(prompt_path, prompt)
    result_path = output / (signature + ".result.txt")
    command = ["codex", "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check",
               "--sandbox", "read-only", "--json", "--color", "never", "--model", launch["model"],
               "-c", 'model_reasoning_effort="' + launch["effort"] + '"',
               "-c", "project_doc_max_bytes=0", "-c", 'web_search="disabled"',
               "--disable", "shell_tool", "--disable", "unified_exec", "--disable", "multi_agent",
               "--disable", "apps", "--disable", "browser_use", "-o", str(result_path)]
    for path in images:
        command.extend(["--image", str(path)])
    command.append("-")
    events_path = output / (signature + ".events.jsonl")
    errors_path = output / (signature + ".stderr.txt")
    code = None
    try:
        with events_path.open("x") as stdout, errors_path.open("x") as stderr:
            events_path.chmod(0o600)
            errors_path.chmod(0o600)
            process = subprocess.run(command, input=prompt, text=True, stdout=stdout,
                                     stderr=stderr, cwd=output, timeout=900)
            code = process.returncode
        events = [json.loads(line) for line in events_path.read_text().splitlines() if line.strip()]
        record["usage"] = usage_from_events(events)
        record["reservation_exceeded"] = (record["usage"]["input_tokens"] > reservation
                                           or record["usage"]["output_tokens"] > output_reservation)
        record["status"] = "complete" if code == 0 and result_path.exists() else "failed"
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        record.update(status="usage_unknown", error=str(error))
    record.update(finished=time.time(), exit_code=code, result_path=str(result_path))
    if result_path.exists():
        result_path.chmod(0o600)
    temporary = journal.with_suffix(".tmp")
    write_private(temporary, json.dumps(record, indent=2))
    temporary.replace(journal)
    return record


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", type=Path, required=True)
    parser.add_argument("--decision", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = run(args.prompt.read_text(), json.loads(args.decision.read_text()), args.output)
    print(json.dumps(result))
    raise SystemExit(0 if result["status"] == "complete" else 1)
