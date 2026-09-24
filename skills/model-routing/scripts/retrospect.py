#!/usr/bin/env python3
"""Assess domain involvement and visible outcome quality across agent sessions.

Results contain private session metadata. Write them outside the public repository.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time

import jev


DOMAINS = Path(__file__).resolve().parents[1] / "references/retrospective-domains.json"
PRIVATE_ROOT = Path.home() / ".furanku-skills/model-routing/retrospectives"
QUALITY_RUBRIC_VERSION = 6
QUALITY = {
    "unknown": "The visible transcript does not establish output quality in this domain. Missing artifacts and unverified assistant claims count as unknown.",
    "0": "Visible evidence shows the domain work failed or was abandoned because of model error.",
    "1": "Visible evidence shows major domain mistakes or repeated repair was needed.",
    "2": "Visible evidence shows a usable but incomplete domain result with meaningful corrections.",
    "3": "Visible evidence shows the main request was met, with independent checks or explicit acceptance and at most minor corrections.",
    "4": "Visible evidence shows exceptional quality beyond ordinary acceptance, independently checked and explicitly praised, with no meaningful correction. Acceptance or passing tests alone are not enough."
}
AMBIENT_TAGS = {"recommended_plugins", "environment_context", "in-app-browser-context",
                "system-reminder", "user_info", "rules", "task-notification",
                "fork-boilerplate", "skill", "subagent_notification", "hook_prompt"}
CONTENT_TAGS = {"user_query", "pasted_content"}
OPEN_TAG = re.compile(r"^<([a-z][a-z0-9_-]*)(?:\s+[^>]*)?>")
SECRET_BLOCK = re.compile(r"-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----.*?-----END [^-]*(?:PRIVATE KEY|CERTIFICATE)-----", re.DOTALL)
SECRET_TOKEN = re.compile(
    r"(?i)\b(?:Bearer\s+\S+|(?:sk-|sk_live_|ghp_|github_pat_|glpat-|hf_|npm_|xox[baprs]-)[A-Za-z0-9_-]{10,}|"
    r"AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,})\b"
)
SECRET_ASSIGNMENT = re.compile(r"(?i)\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|credential|private[_-]?key)\s*[:=]\s*)[^\s,;]+")
SECRET_ENV = re.compile(r"\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)[A-Z0-9_]*\s*=\s*)[^\s,;]+")
SECRET_JSON = re.compile(r'''(?i)(["'](?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|credential|private[_-]?key)["']\s*:\s*["'])[^"']+''')
DELEGATION_COMMAND = re.compile(
    r"(?i)\borca\s+orchestration\s+(?:worker-start\b|send\b[^;]*--dispatch)|"
    r"\b(?:codex\s+exec|claude\s+(?:-p|--print)|grok\s+--model)\b"
)
SESSION_EVAL_ERRORS = {
    "Jev returned an inconsistent option distribution.": "jev_inconsistent_distribution",
    "Jev did not return a complete option distribution.": "jev_incomplete_distribution",
    "Gateway answer IDs do not match the request.": "jev_answer_ids",
    "Jev request exceeds the 1 MB transport limit.": "jev_request_oversize",
}


def redact_sensitive(value):
    value = SECRET_BLOCK.sub("[REDACTED BLOCK]", value)
    value = SECRET_TOKEN.sub("[REDACTED TOKEN]", value)
    value = SECRET_JSON.sub(r"\1[REDACTED]", value)
    value = SECRET_ASSIGNMENT.sub(r"\1[REDACTED]", value)
    return SECRET_ENV.sub(r"\1[REDACTED]", value)


def private_jev_payload(state, questions, require_zdr=True):
    privacy = ({"zeroDataRetention": True} if require_zdr else
               {"disallowPromptTraining": True})
    return {"model": jev.MODEL, "state": state, "questions": questions,
            "providerOptions": {"gateway": privacy}}


def clean_user(value):
    value = value.strip()
    if value.startswith("This session is being continued from a previous conversation that ran out of context."):
        return ""
    if value.startswith("Base directory for this skill:"):
        return value.rsplit("ARGUMENTS:", 1)[1].strip() if "ARGUMENTS:" in value else ""
    if value.startswith(("[SYSTEM NOTIFICATION - NOT USER INPUT]",
                         "# Claude in Chrome browser automation",
                         "You can continue now. Continue the task you were working on when the usage limit was reached")):
        return ""
    while value:
        opened = OPEN_TAG.match(value)
        if not opened or opened.group(1) not in AMBIENT_TAGS | CONTENT_TAGS:
            break
        tag = opened.group(1)
        closed = re.search(rf"</{re.escape(tag)}(?:\s+[^>]*)?>", value[opened.end():])
        if not closed:
            return "" if tag in AMBIENT_TAGS else value[opened.end():].strip()
        end = opened.end() + closed.end()
        if tag in AMBIENT_TAGS:
            value = value[end:].strip()
        else:
            inner = value[opened.end():opened.end() + closed.start()].strip()
            rest = value[end:].strip()
            value = "\n".join(part for part in (inner, rest) if part)
    for tag in AMBIENT_TAGS:
        matches = list(re.finditer(rf"\s*<{re.escape(tag)}(?:\s+[^>]*)?>.*?</{re.escape(tag)}(?:\s+[^>]*)?>\s*$",
                                   value, flags=re.DOTALL))
        if matches:
            value = value[:matches[-1].start()].strip()
    if value.startswith("You are working inside Orca"):
        if "=== TASK ===" not in value:
            return ""
        value = value.split("=== TASK ===", 1)[1].strip()
    if value.startswith("# AGENTS.md instructions") and "</INSTRUCTIONS>" in value:
        value = value.split("</INSTRUCTIONS>", 1)[1].strip()
    if value.startswith("<send_user_message_question_reply>"):
        return "User answered a clarification question. " + value[:700]
    return value


def text_content(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content
                         if isinstance(part, dict) and part.get("type") in
                         ("text", "input_text", "output_text"))
    return ""


def render_state(turns, models):
    if not models or not turns or any(not model or not effort for model, effort in models):
        raise ValueError("Session has no model/effort or work turns")
    model, count = Counter(models).most_common(1)[0]
    if count < len(models):
        raise ValueError("Session changed model/effort; split it by turn before assessment")
    rendered = []
    trailing_user_messages = []
    for turn in reversed(turns):
        if turn["assistant"]:
            break
        trailing_user_messages.append(turn["user"])
    trailing_user_messages.reverse()
    for turn_index, turn in enumerate(turns):
        if not turn["assistant"]:
            continue
        request = redact_sensitive(turn["user"])
        if len(request) > 1800:
            request = request[:700] + "\n[Earlier request text omitted]\n" + request[-1100:]
        response = redact_sensitive(turn["assistant"][-1])
        if len(response) > 2200:
            response = response[:1000] + "\n[Middle response text omitted]\n" + response[-1200:]
        followup = redact_sensitive(turns[turn_index + 1]["user"]) if turn_index + 1 < len(turns) else ""
        if len(followup) > 1100:
            followup = followup[:500] + "\n[Middle follow-up text omitted]\n" + followup[-600:]
        rendered.append({"request": request, "response": response,
                         "raw_turn_index": turn_index, "followup_request": followup})
    if not rendered:
        raise ValueError("Session has no assistant responses")
    if len(rendered) > 20:
        selected = rendered[:10] + rendered[-10:]
    else:
        selected = rendered
    return {"model": model[0], "effort": model[1], "turns": selected,
            "omitted_turns": len(rendered) - len(selected),
            "trailing_user_messages": trailing_user_messages}


def codex_session_state(path):
    turns = []
    models = []
    current = None
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            item = json.loads(line)
            payload = item.get("payload", {})
            if item.get("type") == "turn_context":
                models.append((payload.get("model"), payload.get("effort")))
            if item.get("type") != "response_item" or payload.get("type") != "message":
                continue
            role = payload.get("role")
            content = text_content(payload.get("content"))
            if role == "user":
                content = clean_user(content)
                if content:
                    current = {"user": content, "assistant": []}
                    turns.append(current)
            elif role == "assistant" and current is not None and content:
                current["assistant"].append(content)
    return render_state(turns, models)


def claude_session_state(path):
    turns = []
    models = []
    current = None
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            item = json.loads(line)
            role = item.get("type")
            message = item.get("message") or {}
            if role == "user":
                if item.get("sourceToolUseID"):
                    continue
                content = clean_user(text_content(message.get("content")))
                if content:
                    current = {"user": content, "assistant": []}
                    turns.append(current)
            elif role == "assistant" and current is not None:
                model = message.get("model")
                effort = item.get("effort")
                if isinstance(model, str) and model != "<synthetic>" and effort:
                    models.append((model, effort))
                content = text_content(message.get("content"))
                if content:
                    current["assistant"].append(content)
    return render_state(turns, models)


def grok_session_state(path):
    directory = path if path.is_dir() else path.parent
    summary = json.loads((directory / "summary.json").read_text(encoding="utf-8"))
    model = summary.get("current_model_id")
    effort = summary.get("reasoning_effort")
    turns = []
    current = None
    with (directory / "chat_history.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            item = json.loads(line)
            role = item.get("type")
            if role == "user" and not item.get("synthetic_reason"):
                content = clean_user(text_content(item.get("content")))
                if content:
                    current = {"user": content, "assistant": []}
                    turns.append(current)
            elif role == "assistant" and current is not None:
                content = text_content(item.get("content"))
                if content:
                    current["assistant"].append(content)
    return render_state(turns, [(model, effort)])


def session_state(path, provider="codex"):
    if provider == "codex":
        return codex_session_state(path)
    if provider == "claude":
        return claude_session_state(path)
    if provider == "grok":
        return grok_session_state(path)
    raise ValueError(f"Unknown session provider: {provider}")


def source_key(path, provider):
    source = path.parent if provider == "grok" and path.is_file() else path
    return hashlib.sha256(f"{provider}\0{source.resolve()}".encode()).hexdigest()


def delegation_detected(path, provider, turn_index=None):
    log = path.parent / "chat_history.jsonl" if provider == "grok" and path.is_file() else path
    if log.is_dir():
        log = log / "chat_history.jsonl"
    work_turn = -1
    with log.open(encoding="utf-8") as stream:
        for line in stream:
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            user_text = ""
            if provider == "codex" and item.get("type") == "response_item":
                payload = item.get("payload") or {}
                if payload.get("type") == "message" and payload.get("role") == "user":
                    user_text = text_content(payload.get("content"))
            elif provider == "claude" and item.get("type") == "user" and not item.get("sourceToolUseID"):
                user_text = text_content((item.get("message") or {}).get("content"))
            elif provider == "grok" and item.get("type") == "user" and not item.get("synthetic_reason"):
                user_text = text_content(item.get("content"))
            if user_text and clean_user(user_text):
                work_turn += 1
                if turn_index is not None and work_turn > turn_index:
                    break
            if turn_index is not None and work_turn != turn_index:
                continue
            if provider == "codex" and item.get("type") == "response_item":
                payload = item.get("payload") or {}
                if payload.get("type") in ("function_call", "custom_tool_call"):
                    name = str(payload.get("name") or "")
                    raw = str(payload.get("input") or payload.get("arguments") or "")
                    if name in ("spawn_agent", "followup_task") or re.search(
                            r"\b(?:collaboration\.)?(?:spawn_agent|followup_task)\s*\(", raw
                    ) or DELEGATION_COMMAND.search(raw):
                        return True
            if provider == "claude" and item.get("type") == "assistant":
                for block in (item.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        if block.get("name") in ("Agent", "Task", "Workflow"):
                            return True
                        tool_input = block.get("input")
                        command = tool_input.get("command") if isinstance(tool_input, dict) else tool_input
                        if block.get("name") == "Bash" and DELEGATION_COMMAND.search(str(command or "")):
                            return True
            if provider == "grok" and item.get("type") == "assistant":
                if DELEGATION_COMMAND.search(json.dumps(item)):
                    return True
    return False


def task_family_from_request(request):
    if "=== TASK ===" in request:
        request = request.split("=== TASK ===", 1)[1]
    elif match := re.search(r"(?im)^(?:outcome|mission|task):\s*", request):
        request = request[match.start():]
    normalized = " ".join(request.lower().split())[:600]
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def evaluate_with_wait(payload, wait):
    if not wait:
        return jev.evaluate_bounded(payload)
    for attempt in range(100):
        try:
            return jev.evaluate_bounded(payload)
        except jev.RateLimitError as error:
            if attempt == 99:
                raise
            remaining = max(1, error.retry_after_seconds or 3) + 1
            print(json.dumps({"waiting_for_gateway_seconds": round(remaining, 1)}), flush=True)
            while remaining > 0:
                interval = min(remaining, 30)
                time.sleep(interval)
                remaining -= interval


def classify(path, provider="codex", wait=False, require_zdr=True):
    taxonomy = json.loads(DOMAINS.read_text(encoding="utf-8"))
    state = session_state(path, provider)
    state["turns"] = [{"request": redact_sensitive(turn["request"]),
                       "response": redact_sensitive(turn["response"]),
                       "raw_turn_index": turn["raw_turn_index"]} for turn in state["turns"]]
    state["trailing_user_messages"] = [redact_sensitive(message)
                                       for message in state["trailing_user_messages"]]
    from performance_assess import tool_check_evidence
    tool_checks = tool_check_evidence(path, provider, turn_index=None)
    delegated_work = delegation_detected(path, provider)
    scale = taxonomy["scale"]
    domain_questions = {
        domain["id"]: {
            "type": "choice",
            "instructions": (
                f"For the requested deliverables across this session, how involved is "
                f"{domain['id']}? Definition: {domain['description']} "
                "Judge requested work, not incidental mentions, ordinary revisions, "
                "or the assistant's self-description. Select absent unless this domain "
                "requires distinct work in the requested deliverable. "
                "A domain can be central even if another domain is also central."
            ),
            "criteria": scale,
        }
        for domain in taxonomy["domains"]
    }
    involvement = evaluate_with_wait(private_jev_payload(state, domain_questions, require_zdr), wait)
    active = [domain for domain in taxonomy["domains"]
              if involvement["answers"][domain["id"]]["choice"] != "absent"]
    quality_questions = {
        domain["id"]: {
            "type": "choice",
            "instructions": (
                f"Assess actual performance in {domain['id']} ({domain['description']}) "
                "across the requested deliverables in this session. Use the visible user "
                "feedback, response content, and tool checks that directly test the requested outcome. "
                "A check from another task, an unfinished command, or a failed intermediate check "
                "later corrected does not establish the final outcome. Do not infer acceptance from silence, "
                "and do not treat the assistant's own completion claims as verification. "
                "If different tasks in the session have materially different outcomes "
                "that a single score would conceal, choose unknown."
            ),
            "criteria": QUALITY,
        }
        for domain in active
    }
    quality = (evaluate_with_wait(private_jev_payload({**state, "tool_checks": tool_checks},
                                                      quality_questions, require_zdr), wait)
               if quality_questions else {"answers": {}, "usage": {}, "cost_usd": 0})
    session_name = path.parent.name if provider == "grok" and path.is_file() else path.name
    return {"session": session_name, "source_key": source_key(path, provider),
            "provider": provider,
            "model": state["model"], "effort": state["effort"],
            "task_family": task_family_from_request(state["turns"][0]["request"]),
            "delegated_work": delegated_work,
            "requester_provenance": ("agent_or_coordinator" if path.name.startswith("agent-") or
                                     re.search(r"(?i)(?:reports_to:|mechanism:\s*orca|you are a dispatched worker)",
                                               state["turns"][0]["request"]) else "unverified"),
            "attribution": "summary_only" if provider == "grok" else "turn_verified",
            "privacy_mode": "zdr" if require_zdr else "no_training",
            "tool_checks": tool_checks,
            "turns": len(state["turns"]), "omitted_turns": state["omitted_turns"],
            "taxonomy_version": taxonomy["version"],
            "quality_rubric_version": QUALITY_RUBRIC_VERSION,
            "involvement": involvement["answers"],
            "quality": quality["answers"],
            "usage": {"involvement": involvement.get("usage"), "quality": quality.get("usage")},
            "cost_usd": (involvement.get("cost_usd") or 0) + (quality.get("cost_usd") or 0)}


def census_jobs(rows):
    groups = {}
    for row in rows:
        if row.get("disposition") != "projected":
            continue
        route = row["matching_models"][0]
        groups.setdefault((route["model"], route["effort"]), []).append(row)
    def evidence_priority(row):
        turns = row.get("answered_turns", 0)
        if 2 <= turns <= 6:
            return (0, abs(turns - 3), row["source_key"])
        if turns > 6:
            return (1, turns, row["source_key"])
        return (2, 0, row["source_key"])

    for group in groups.values():
        group.sort(key=evidence_priority)
    jobs = []
    while any(groups.values()):
        for route in sorted(groups):
            if groups[route]:
                jobs.append(groups[route].pop(0))
    return jobs


def completed_sources(rows, retry_errors=False):
    previous = set()
    old_codex_names = set()
    for row in rows:
        if row.get("source_key"):
            if row.get("error") and not retry_errors:
                previous.add(row["source_key"])
            elif row.get("quality_rubric_version") == QUALITY_RUBRIC_VERSION:
                previous.add(row["source_key"])
        elif row.get("provider", "codex") == "codex" and row.get("quality_rubric_version") == QUALITY_RUBRIC_VERSION:
            old_codex_names.add(row["session"])
    return previous, old_codex_names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sessions", nargs="*", type=Path)
    parser.add_argument("--provider", choices=("codex", "claude", "grok"), default="codex")
    parser.add_argument("--census", type=Path,
                        help="private history census; process every projectable session, starting with multi-turn work")
    parser.add_argument("--selection-file", type=Path,
                        help="private JSONL source keys to prioritize without dropping other census sessions")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--retry-errors", action="store_true")
    parser.add_argument("--allow-no-zdr", action="store_true",
                        help="send redacted excerpts with training opt-out when ZDR is unavailable")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if bool(args.sessions) == bool(args.census):
        parser.error("Provide session paths or --census, but not both")
    if args.output.parent != PRIVATE_ROOT:
        parser.error(f"Retrospective output must be directly inside {PRIVATE_ROOT}")
    if args.output.is_symlink() or PRIVATE_ROOT.is_symlink():
        parser.error("Private retrospective output must not use a symlink")
    PRIVATE_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    PRIVATE_ROOT.chmod(0o700)
    args.output.touch(mode=0o600, exist_ok=True)
    info = args.output.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        parser.error("Private retrospective output must be a regular file owned by this user")
    args.output.chmod(0o600)
    previous, old_codex_names = completed_sources(
        (json.loads(line) for line in args.output.read_text(encoding="utf-8").splitlines()),
        retry_errors=args.retry_errors)
    if args.census:
        ordered = census_jobs(json.loads(line) for line in args.census.open())
        if args.selection_file:
            selected = {json.loads(line)["source_key"] for line in args.selection_file.open()}
            ordered.sort(key=lambda row: row["source_key"] not in selected)
        jobs = [(Path(row["path"]), row["provider"], row["source_key"])
                for row in ordered]
    else:
        jobs = [(path, args.provider, source_key(path, args.provider)) for path in args.sessions]
    processed = 0
    with args.output.open("a", encoding="utf-8") as stream:
        for path, provider, key in jobs:
            if args.limit is not None and processed >= args.limit:
                break
            if key in previous or (provider == "codex" and path.name in old_codex_names):
                continue
            try:
                result = classify(path, provider, wait=bool(args.census),
                                  require_zdr=not args.allow_no_zdr)
            except jev.Error as exc:
                code = SESSION_EVAL_ERRORS.get(str(exc))
                if not code:
                    print(json.dumps({"stopped": type(exc).__name__, "completed_this_run": processed,
                                      "message": str(exc)}), flush=True)
                    return 2
                result = {"session": path.name, "source_key": key, "provider": provider,
                          "error": code}
            except (ValueError, OSError, json.JSONDecodeError, UnicodeError) as exc:
                result = {"session": path.name, "source_key": key, "provider": provider,
                          "error": "projection_" + type(exc).__name__}
                print(json.dumps({"session": path.name, "error": type(exc).__name__}), flush=True)
            stream.write(json.dumps(result) + "\n")
            stream.flush()
            previous.add(key)
            processed += 1
            if "error" in result:
                continue
            print(json.dumps({"session": path.name, "model": result["model"],
                              "effort": result["effort"], "turns": result["turns"],
                              "active_domains": len(result["quality"])}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
