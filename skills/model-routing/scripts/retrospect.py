#!/usr/bin/env python3
"""Pilot: ask Jev for domain involvement and evidenced quality in an agent session.

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

import jev


DOMAINS = Path(__file__).resolve().parents[1] / "references/retrospective-domains.json"
PRIVATE_ROOT = Path.home() / ".furanku-skills/model-routing/retrospectives"
QUALITY_RUBRIC_VERSION = 2
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
    for turn in turns:
        if not turn["assistant"]:
            continue
        request = turn["user"]
        if len(request) > 1800:
            request = request[:700] + "\n[Earlier request text omitted]\n" + request[-1100:]
        rendered.append({"request": request, "response": turn["assistant"][-1][:2200]})
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


def classify(path, provider="codex"):
    taxonomy = json.loads(DOMAINS.read_text(encoding="utf-8"))
    state = session_state(path, provider)
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
    involvement = jev.evaluate_bounded({"model": jev.MODEL, "state": state,
                                        "questions": domain_questions})
    active = [domain for domain in taxonomy["domains"]
              if involvement["answers"][domain["id"]]["choice"] != "absent"]
    quality_questions = {
        domain["id"]: {
            "type": "choice",
            "instructions": (
                f"Assess actual performance in {domain['id']} ({domain['description']}) "
                "across the requested deliverables in this session. Use the visible user "
                "feedback and response content. Do not infer acceptance from silence, "
                "and do not treat the assistant's own completion claims as verification. "
                "If different tasks in the session have materially different outcomes "
                "that a single score would conceal, choose unknown."
            ),
            "criteria": QUALITY,
        }
        for domain in active
    }
    quality = (jev.evaluate_bounded({"model": jev.MODEL, "state": state,
                                    "questions": quality_questions})
               if quality_questions else {"answers": {}, "usage": {}, "cost_usd": 0})
    session_name = path.parent.name if provider == "grok" and path.is_file() else path.name
    return {"session": session_name, "source_key": source_key(path, provider),
            "provider": provider,
            "model": state["model"], "effort": state["effort"],
            "turns": len(state["turns"]), "omitted_turns": state["omitted_turns"],
            "taxonomy_version": taxonomy["version"],
            "quality_rubric_version": QUALITY_RUBRIC_VERSION,
            "involvement": involvement["answers"],
            "quality": quality["answers"],
            "usage": {"involvement": involvement.get("usage"), "quality": quality.get("usage")},
            "cost_usd": (involvement.get("cost_usd") or 0) + (quality.get("cost_usd") or 0)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sessions", nargs="+", type=Path)
    parser.add_argument("--provider", choices=("codex", "claude", "grok"), default="codex")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
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
    previous = set()
    old_codex_names = set()
    for line in args.output.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if row.get("source_key"):
            previous.add(row["source_key"])
        elif row.get("provider", "codex") == "codex":
            old_codex_names.add(row["session"])
    with args.output.open("a", encoding="utf-8") as stream:
        for path in args.sessions:
            if source_key(path, args.provider) in previous or (args.provider == "codex" and path.name in old_codex_names):
                continue
            try:
                result = classify(path, args.provider)
            except (jev.Error, ValueError, OSError, json.JSONDecodeError) as exc:
                print(json.dumps({"session": path.name, "error": str(exc)}), flush=True)
                continue
            stream.write(json.dumps(result) + "\n")
            stream.flush()
            print(json.dumps({"session": path.name, "model": result["model"],
                              "effort": result["effort"], "turns": result["turns"],
                              "active_domains": len(result["quality"])}), flush=True)


if __name__ == "__main__":
    main()
