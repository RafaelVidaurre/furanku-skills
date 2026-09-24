#!/usr/bin/env python3
"""Assess first work outcomes in a private historical census with Jev.

This is an exploratory estimator. Its quality choices are labeled observations,
not calibrated model capability scores. The output contains private task text.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
import stat
import time

import jev
import retrospect


RESULT_PATTERN = re.compile(
    r"(?i)(?:\b\d+(?:/\d+)?\s+(?:tests?\s+)?(?:passed|failed)\b|"
    r"\btests?\s*[: ]\s*\d+\s+passed\b|\btest result:\s*(?:ok|failed)\b|"
    r"\bbuild succeeded\b|\bbuild success\b|\ball tests passed\b|"
    r"\bXCTAssert\w* failed\b)"
)
TEST_COMMAND = re.compile(
    r"(?im)(?:^|&&|;|\|\||\n)\s*\(?\s*(?:env\s+\w+=\S+\s+)*"
    r"(?:(?:python(?:3(?:\.\d+)?)?\s+-m\s+)?(?:pytest|unittest)\b|"
    r"(?:npm|pnpm)\s+(?:run\s+)?test\b|cargo\s+test\b|swift\s+test\b|"
    r"(?:npx\s+)?(?:vitest|jest)\b|(?:npx\s+)?playwright\s+test\b|"
    r"node\s+--test\b|xcodebuild\b[^\n;]*\btest\b|"
    r"godot\b[^\n;]*\bgut\b|gradlew?\b[^\n;]*\btest\b)"
)
HEREDOC = re.compile(r"<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?")
QUALITY = {
    "unknown": "The request, response, and available evidence do not permit a useful estimate of the first deliverable's quality.",
    "unverified": "There is a substantive first deliverable, but the visible material does not establish whether it works or meets the main quality criteria.",
    "0": "The first deliverable visibly failed or was abandoned because of a model error.",
    "1": "Major errors, rejection, or repeated repair made the first deliverable largely unusable.",
    "2": "The first deliverable has a visible, meaningful defect or incompleteness but some useful work remains.",
    "3": "Substantive visible output or a directly relevant check suggests the first deliverable meets the main request, with no material defect shown. A summary-only completion claim is insufficient.",
    "4": "Exceptional first deliverable with direct evidence of unusually strong quality and no material correction; ordinary completion is 3 at most.",
}
EVIDENCE = {
    "direct_feedback": "A later requester explicitly accepts or rejects this first deliverable or confirms a defect/fix.",
    "independent_check": "A visible test, review, or external check directly evaluates this first deliverable.",
    "visible_output": "The response itself contains enough substantive output to inspect, but no later acceptance or independent check is visible.",
    "self_report": "Only the assistant's own summary or completion claim describes the output.",
    "insufficient": "The task contract or output is unavailable, ambiguous, or too truncated to evaluate.",
}
CAUSE = {
    "model_domain_defect": "A defect in the model's domain work caused failure or meaningful rework.",
    "instruction_violation": "The model violated scope or instructions; track as process reliability rather than domain ability.",
    "external_blocker": "A service, authentication, environment, dependency, or human action outside this model's work blocked the outcome.",
    "changed_requirement": "The requester added or changed a preference or requirement after the first deliverable.",
    "no_problem_visible": "No failure or meaningful rework is visible for the first deliverable.",
    "unclear": "A problem is visible, but its cause cannot be attributed from the available evidence.",
}
CHECK_RELATION = {
    "direct": "The shown check result verifies a main behavior or acceptance criterion in the first requested deliverable.",
    "partial": "The check covers only a nearby or narrow behavior; the main requested outcome still needs another check.",
    "unrelated": "The check exercises a different task, pre-existing behavior, or environment and says nothing about the first deliverable.",
    "unclear": "The command and result do not reveal what behavior was checked, or the task contract is unavailable.",
    "none": "No check result is supplied for the first deliverable.",
}
OUTPUT_FORM = {
    "complete_inline_deliverable": "The response itself contains the complete first deliverable, so its requested qualities can be inspected here.",
    "partial_or_metrics": "The response gives an excerpt, measurements, or a table about the deliverable, but the main artifact or behavior is elsewhere.",
    "summary_or_link": "The response mainly claims completion or points to a file, commit, image, or other artifact that is not shown.",
    "absent": "No substantive first deliverable is visible in the response.",
}
CONTROL_REQUEST = re.compile(r"(?is)^\s*(?:reply\s+(?:with\s+)?exactly\b|say\s+exactly\b|return\s+exactly\b|retry\s*$|continue\s*$|go on\s*$|\$\()")
RUBRIC = "first_outcome_estimate_v5"


def clip(value, limit):
    value = value.strip()
    return value if len(value) <= limit else value[:limit // 2] + "\n[omitted middle]\n" + value[-limit // 2:]


def strings(value):
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith(("{", "[")):
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                pass
            else:
                yield from strings(parsed)
                return
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
    elif isinstance(value, dict):
        for key in ("text", "content", "output", "stdout", "stderr"):
            if key in value:
                yield from strings(value[key])


def command_from_input(value):
    if isinstance(value, dict):
        return str(value.get("command") or value.get("cmd") or "")
    if not isinstance(value, str):
        return ""
    if value.lstrip().startswith("{"):
        try:
            return command_from_input(json.loads(value))
        except (json.JSONDecodeError, TypeError):
            pass
    matches = re.findall(
        r'\btools\.exec_command\s*\(\s*\{[^{}]{0,300}?(?:"cmd"|cmd)\s*:\s*("(?:\\.|[^"\\])*")',
        value,
    )
    commands = []
    for match in matches:
        try:
            commands.append(json.loads(match))
        except json.JSONDecodeError:
            pass
    # A functions.exec script may invoke several commands and aggregate their
    # output under one call ID. Their individual results cannot then be paired.
    return commands[0] if len(commands) == 1 else ""


def executable_test_command(command):
    """Recognize a shell test invocation, excluding quoted payloads and here-doc text."""
    if re.search(r"\borca\s+orchestration\s+send\b", command):
        return False
    kept = []
    delimiter = None
    for line in command.splitlines():
        if delimiter is not None:
            if line.strip() == delimiter:
                delimiter = None
            continue
        match = HEREDOC.search(line)
        if match:
            delimiter = match.group(1)
        kept.append(line)
    return bool(TEST_COMMAND.search("\n".join(kept)))


def result_lines(value):
    lines = []
    for piece in strings(value):
        text = piece.replace("\\n", "\n") if "\n" not in piece else piece
        for line in text.splitlines():
            if RESULT_PATTERN.search(line):
                lines.append(clip(retrospect.redact_sensitive(line), 300))
    return lines[-3:]


def exit_codes(value):
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith(("{", "[")):
            try:
                yield from exit_codes(json.loads(stripped))
                return
            except json.JSONDecodeError:
                pass
        for match in re.finditer(r"(?im)\bexit code\s*:?\s*(-?\d+)\b", value):
            yield int(match.group(1))
    elif isinstance(value, list):
        for item in value:
            yield from exit_codes(item)
    elif isinstance(value, dict):
        code = value.get("exit_code")
        if type(code) is int:
            yield code
        for key in ("text", "content", "output"):
            if key in value:
                yield from exit_codes(value[key])


def tool_check_evidence(path, provider, turn_index=0):
    log = path.parent / "chat_history.jsonl" if provider == "grok" and path.is_file() else path
    work_turn = -1
    calls = {}
    checks = []
    with log.open(encoding="utf-8") as stream:
        for line in stream:
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            role = item.get("type")
            payload = item.get("payload") or {}
            command = ""
            result = None
            result_is_error = None
            if provider == "codex":
                role = payload.get("role") if role == "response_item" and payload.get("type") == "message" else None
                kind = payload.get("type") if item.get("type") == "response_item" else None
                if kind in ("function_call", "custom_tool_call"):
                    calls[payload.get("call_id")] = command_from_input(payload.get("arguments") or payload.get("input"))
                elif kind in ("function_call_output", "custom_tool_call_output"):
                    command = calls.get(payload.get("call_id"), "")
                    result = payload.get("output")
                user_content = retrospect.text_content(payload.get("content")) if role == "user" else ""
            elif provider == "claude":
                message = item.get("message") or {}
                content = message.get("content")
                if isinstance(content, list):
                    for block in content:
                        if not isinstance(block, dict):
                            continue
                        if block.get("type") == "tool_use":
                            calls[block.get("id")] = command_from_input(block.get("input"))
                        elif block.get("type") == "tool_result":
                            candidate_command = calls.get(block.get("tool_use_id"), "")
                            if executable_test_command(candidate_command):
                                command = candidate_command
                                result = block.get("content")
                                result_is_error = block.get("is_error")
                user_content = (retrospect.text_content(content) if role == "user" and not item.get("sourceToolUseID") else "")
            else:
                user_content = retrospect.text_content(item.get("content")) if role == "user" and not item.get("synthetic_reason") else ""
            if user_content and retrospect.clean_user(user_content):
                work_turn += 1
                if turn_index is not None and work_turn > turn_index:
                    break
            if (turn_index is not None and work_turn != turn_index) or not command or result is None or not executable_test_command(command):
                continue
            summaries = result_lines(result)
            if summaries:
                codes = list(exit_codes(result))
                if not codes and provider == "claude" and type(result_is_error) is bool:
                    codes = [1 if result_is_error else 0]
                checks.append({"command": clip(retrospect.redact_sensitive(command), 180),
                               "summary": [retrospect.redact_sensitive(item) for item in summaries],
                               "test_invocation": True,
                               "exit_code": codes[-1] if len(codes) == 1 else None})
    return checks[-(10 if turn_index is None else 2):]


def packet(row):
    path = Path(row["path"])
    state = retrospect.session_state(path, row["provider"])
    selected = next((index for index, turn in enumerate(state["turns"])
                     if not CONTROL_REQUEST.search(turn["request"])), None)
    if selected is None:
        raise ValueError("no_substantive_work_turn")
    first = state["turns"][selected]
    followup = first.get("followup_request", "")
    return {
        "source_key": row["source_key"], "provider": row["provider"],
        "model": state["model"], "effort": state["effort"],
        "first_request": retrospect.redact_sensitive(clip(first["request"], 2200)),
        "task_family": retrospect.task_family_from_request(retrospect.redact_sensitive(first["request"])),
        "first_response": retrospect.redact_sensitive(clip(first["response"], 2600)),
        "first_followup": retrospect.redact_sensitive(clip(followup, 1100)),
        "selected_turn_index": first["raw_turn_index"],
        "tool_evidence": tool_check_evidence(path, row["provider"], first["raw_turn_index"]),
        "forced_domain": "localization" if re.match(r"(?i)^\s*translat(?:e|ion)\b", first["request"]) else None,
        "requester_provenance": (
            "agent_or_coordinator" if path.name.startswith("agent-") or
            re.search(r"(?i)(?:=== TASK ===|reports_to:|mechanism:\s*orca|you are a dispatched worker)",
                      first["request"]) else "unverified"),
        "delegated_work": retrospect.delegation_detected(path, row["provider"], first["raw_turn_index"]),
    }


def questions_for(index, domains):
    domain_choices = {entry["id"]: entry["description"] for entry in domains}
    domain_choices["unresolved"] = "The first request points to an unavailable task contract, or no distinct domain can be established."
    return {
        f"{index}_domain": {"type": "choice", "instructions": f"Case {index}: choose the ONE primary domain of the FIRST requested deliverable. Use the request, not the assistant's self-description. A task packet reference alone is unresolved.", "criteria": domain_choices},
        f"{index}_quality": {"type": "choice", "instructions": f"Case {index}: estimate quality of the FIRST deliverable in its PRIMARY requested domain, based only on the provided response, first follow-up, and related tool evidence. Choose unverified when there is substantive output but its correctness or acceptance cannot be judged. Score 2 requires a visible meaningful defect; missing verification alone is unverified. Judge the final state of any tests, not a failed interim run. Score 3 can rest on inspectable output, but never on a summary-only completion claim. Choose unknown if the task contract or substantive output is missing.", "criteria": QUALITY},
        f"{index}_evidence": {"type": "choice", "instructions": f"Case {index}: choose the strongest available evidence for the FIRST deliverable. A tool result is independent only if it directly checks the requested outcome. A coordinator's feedback counts as direct feedback but provenance remains distinct.", "criteria": EVIDENCE},
        f"{index}_check_relation": {"type": "choice", "instructions": f"Case {index}: compare the supplied test command AND result with the main acceptance criteria in the first request. A passing test for a different subsystem, an adjacent slice, or a broad suite without a visible link does not verify the requested outcome. Choose direct only when the link is visible in this packet.", "criteria": CHECK_RELATION},
        f"{index}_output_form": {"type": "choice", "instructions": f"Case {index}: describe what the response itself exposes for the first requested deliverable. A table of reported metrics, completion claim, or file/commit link is not the complete artifact or independently observed behavior.", "criteria": OUTPUT_FORM},
        f"{index}_cause": {"type": "choice", "instructions": f"Case {index}: attribute the FIRST deliverable's visible defect, rework, or failure. A failed interim test followed by a passing final test is not a failure. A new style preference is changed_requirement unless the original request specified that style. Choose no_problem_visible if no material problem is shown; choose unclear if a problem exists but the cause is not established.", "criteria": CAUSE},
    }


def evaluate_batch(batch, domains, require_zdr=True):
    state = [{"case": i, **{k: v for k, v in row.items() if k in
                          ("first_request", "first_response", "first_followup", "first_followup_relation", "tool_evidence")}}
             for i, row in enumerate(batch)]
    questions = {key: value for i in range(len(batch)) for key, value in questions_for(i, domains).items()}
    response = jev.evaluate_bounded(retrospect.private_jev_payload(state, questions, require_zdr))
    results = []
    for i, row in enumerate(batch):
        domain = response["answers"][f"{i}_domain"]
        quality = response["answers"][f"{i}_quality"]
        evidence = response["answers"][f"{i}_evidence"]
        check_relation = response["answers"][f"{i}_check_relation"]
        output_form = response["answers"][f"{i}_output_form"]
        cause = response["answers"][f"{i}_cause"]
        reasons = []
        if domain["choice"] == "unresolved":
            reasons.append("unresolved_domain")
        effective_domain = row.get("forced_domain") or domain["choice"]
        if row.get("forced_domain") and domain["choice"] != row["forced_domain"]:
            reasons.append("explicit_translation_domain")
        if evidence["choice"] in ("self_report", "insufficient") and quality["choice"] in ("0", "1", "2", "3", "4"):
            reasons.append("no_direct_quality_evidence")
        if evidence["choice"] == "independent_check" and check_relation["choice"] != "direct" and quality["choice"] in ("0", "1", "2", "3", "4"):
            reasons.append("check_not_tied_to_first_task")
        if evidence["choice"] == "visible_output" and output_form["choice"] != "complete_inline_deliverable" and quality["choice"] in ("3", "4"):
            reasons.append("deliverable_not_visible")
        if quality["choice"] in ("0", "1", "2") and cause["choice"] in (
                "instruction_violation", "external_blocker", "changed_requirement", "unclear"):
            reasons.append("non_domain_cause")
        if quality["choice"] in ("0", "1", "2") and cause["choice"] == "no_problem_visible":
            reasons.append("quality_cause_conflict")
        if quality["choice"] in ("3", "4") and cause["choice"] == "model_domain_defect":
            reasons.append("quality_cause_conflict")
        if row.get("first_followup_relation") == "negative" and quality["choice"] in ("3", "4"):
            reasons.append("quality_feedback_conflict")
        effective = quality["choice"]
        if any(reason != "explicit_translation_domain" for reason in reasons):
            effective = "unverified" if any(reason in reasons for reason in
                                             ("no_direct_quality_evidence", "check_not_tied_to_first_task",
                                              "deliverable_not_visible")) else "unknown"
        results.append({
            "source_key": row["source_key"], "provider": row["provider"],
            "model": row["model"], "effort": row["effort"],
            "requester_provenance": row["requester_provenance"],
            "delegated_work": row["delegated_work"],
            "privacy_mode": "zdr" if require_zdr else "no_training",
            "task_family": row["task_family"],
            "domain": domain,
            "effective_domain": effective_domain,
            "quality": quality,
            "evidence": evidence,
            "check_relation": check_relation,
            "output_form": output_form,
            "cause": cause,
            "tool_evidence": row["tool_evidence"],
            "effective_quality": effective,
            "evidence_rules": reasons,
            "first_followup_relation": row.get("first_followup_relation"),
            "rubric": RUBRIC,
        })
    return results, response.get("cost_usd") or 0


def evaluate_splitting(batch, domains, require_zdr=True):
    try:
        return evaluate_batch(batch, domains, require_zdr)
    except jev.Error as error:
        if str(error) != "Jev returned an inconsistent option distribution.":
            raise
        if len(batch) == 1:
            return [{"source_key": batch[0]["source_key"], "provider": batch[0]["provider"],
                     "model": batch[0]["model"], "effort": batch[0]["effort"],
                     "error": "jev_inconsistent_distribution",
                     "rubric": RUBRIC}], 0
        middle = len(batch) // 2
        left, left_cost = evaluate_splitting(batch[:middle], domains, require_zdr)
        right, right_cost = evaluate_splitting(batch[middle:], domains, require_zdr)
        return left + right, left_cost + right_cost


def evaluate_with_wait(batch, domains, require_zdr=True):
    for wait_count in range(100):
        try:
            return evaluate_splitting(batch, domains, require_zdr)
        except jev.RateLimitError as error:
            if wait_count == 99:
                raise
            remaining = error.retry_after_seconds if error.retry_after_seconds is not None else 3
            remaining = max(1, remaining) + 1
            print(json.dumps({"waiting_for_gateway_seconds": round(remaining, 1),
                              "cases": len(batch)}), flush=True)
            while remaining > 0:
                interval = min(remaining, 30)
                time.sleep(interval)
                remaining -= interval


def prioritize_rows(ordered, source_keys):
    by_key = {row["source_key"]: row for row in ordered}
    selected = []
    for key in source_keys:
        if key in by_key:
            selected.append(by_key.pop(key))
    return selected + list(by_key.values())


def completed_sources(rows, retry_errors=False):
    return {row["source_key"] for row in rows
            if ((not retry_errors) if row.get("error") else row.get("rubric") == RUBRIC)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--census", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--followups", type=Path)
    parser.add_argument("--selection-file", type=Path,
                        help="private JSONL with source_key rows to process before all other sessions")
    parser.add_argument("--retry-errors", action="store_true",
                        help="reassess previously recorded error rows")
    parser.add_argument("--allow-no-zdr", action="store_true",
                        help="send redacted excerpts with training opt-out when ZDR is unavailable")
    parser.add_argument("--batch-size", type=int, default=6)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if args.batch_size < 1 or args.batch_size > 8:
        parser.error("Batch size must be 1-8")
    if args.output.parent != retrospect.PRIVATE_ROOT or args.output.is_symlink():
        parser.error("Output must be a regular file directly in the private retrospective directory")
    args.output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    args.output.parent.chmod(0o700)
    taxonomy = json.loads(retrospect.DOMAINS.read_text(encoding="utf-8"))
    rows = [json.loads(line) for line in args.census.open()]
    rows = [row for row in rows if row["disposition"] == "projected"]
    followups = {}
    if args.followups:
        followups = {item["source_key"]: item["relation"]["choice"]
                     for line in args.followups.open() if (item := json.loads(line))}
    groups = {}
    for row in rows:
        first = row["matching_models"][0]
        groups.setdefault((first["model"], first["effort"]), []).append(row)
    ordered = []
    while any(groups.values()):
        for key in sorted(groups):
            if groups[key]:
                ordered.append(groups[key].pop(0))
    if args.selection_file:
        keys = [json.loads(line)["source_key"] for line in args.selection_file.open()]
        ordered = prioritize_rows(ordered, keys)
    seen = set()
    if args.output.exists():
        info = args.output.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            parser.error("Existing private output must be a user-owned mode-600 regular file")
        seen = completed_sources((json.loads(line) for line in args.output.open() if line.strip()),
                                 retry_errors=args.retry_errors)
    else:
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
    completed = 0
    cost = 0.0
    with args.output.open("a", encoding="utf-8") as output:
        batch = []
        for row in ordered:
            if args.limit is not None and completed >= args.limit:
                break
            if row["source_key"] in seen:
                continue
            try:
                prepared = packet(row)
                prepared["first_followup_relation"] = followups.get(row["source_key"])
                batch.append(prepared)
            except (OSError, ValueError, UnicodeError, json.JSONDecodeError) as error:
                first = row["matching_models"][0]
                output.write(json.dumps({"source_key": row["source_key"],
                                         "provider": row["provider"],
                                         "model": first["model"], "effort": first["effort"],
                                         "error": "packet_" + type(error).__name__,
                                         "rubric": RUBRIC}) + "\n")
                output.flush()
                seen.add(row["source_key"])
                completed += 1
                continue
            if len(batch) < args.batch_size and (args.limit is None or completed + len(batch) < args.limit):
                continue
            try:
                results, price = evaluate_with_wait(batch, taxonomy["domains"],
                                                    require_zdr=not args.allow_no_zdr)
            except jev.Error as error:
                print(json.dumps({"stopped": type(error).__name__, "completed": completed, "message": str(error)}), flush=True)
                return 2
            for result in results:
                output.write(json.dumps(result, ensure_ascii=False) + "\n")
                seen.add(result["source_key"])
            output.flush()
            completed += len(results)
            cost += price
            print(json.dumps({"completed_this_run": completed, "cost_usd_this_run": round(cost, 4)}), flush=True)
            batch = []
            if args.limit is not None and completed >= args.limit:
                break
            time.sleep(0.2)
        if batch:
            try:
                results, price = evaluate_with_wait(batch, taxonomy["domains"],
                                                    require_zdr=not args.allow_no_zdr)
            except jev.Error as error:
                print(json.dumps({"stopped": type(error).__name__, "completed": completed, "message": str(error)}), flush=True)
                return 2
            for result in results:
                output.write(json.dumps(result, ensure_ascii=False) + "\n")
                seen.add(result["source_key"])
            output.flush()
            completed += len(results)
            cost += price
    print(json.dumps({"complete": True, "completed_this_run": completed, "cost_usd_this_run": round(cost, 4)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
