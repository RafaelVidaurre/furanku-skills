#!/usr/bin/env python3
"""Pilot: ask Jev for domain involvement and evidenced quality in a Codex session.

Results contain private session metadata. Write them outside the public repository.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
import stat

import jev


DOMAINS = Path(__file__).resolve().parents[1] / "references/retrospective-domains.json"
PRIVATE_ROOT = Path.home() / ".furanku-skills/model-routing/retrospectives"
QUALITY = {
    "unknown": "The visible transcript does not establish output quality in this domain. Missing artifacts and unverified assistant claims count as unknown.",
    "0": "Visible evidence shows the domain work failed or was abandoned because of model error.",
    "1": "Visible evidence shows major domain mistakes or repeated repair was needed.",
    "2": "Visible evidence shows a usable but incomplete domain result with meaningful corrections.",
    "3": "Visible evidence shows a good domain result accepted with at most minor corrections.",
    "4": "Visible evidence shows an excellent domain result, explicitly accepted and requiring no meaningful correction."
}


def clean_user(value):
    value = value.strip()
    if value.startswith("You are working inside Orca") and "=== TASK ===" in value:
        value = value.split("=== TASK ===", 1)[1].strip()
    if value.startswith("# AGENTS.md instructions") and "</INSTRUCTIONS>" in value:
        value = value.split("</INSTRUCTIONS>", 1)[1].strip()
    for tag in ("recommended_plugins", "environment_context", "in-app-browser-context", "skill"):
        if value.startswith(f"<{tag}") and f"</{tag}>" in value:
            value = value.split(f"</{tag}>", 1)[1].strip()
    if value.startswith(("<recommended_plugins>", "<environment_context>",
                         "<in-app-browser-context", "<subagent_notification>",
                         "<skill>", "<hook_prompt")):
        return ""
    if value.startswith("<send_user_message_question_reply>"):
        return "User answered a clarification question. " + value[:700]
    return value


def session_state(path):
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
            content = "\n".join(part.get("text", "") for part in payload.get("content", [])
                                if part.get("type") in ("input_text", "output_text"))
            if role == "user":
                content = clean_user(content)
                if content:
                    current = {"user": content, "assistant": []}
                    turns.append(current)
            elif role == "assistant" and current is not None and content:
                current["assistant"].append(content)
    if not models or not turns:
        raise ValueError("Session has no model/effort or work turns")
    model, count = Counter(models).most_common(1)[0]
    if count < len(models):
        raise ValueError("Session changed model/effort; split it by turn before assessment")
    rendered = []
    for turn in turns:
        if not turn["assistant"]:
            continue
        request = turn["user"]
        if len(request) > 1800:
            request = request[:700] + "\n[Earlier request text omitted]\n" + request[-1100:]
        rendered.append({"request": request, "response": turn["assistant"][-1][:2200]})
    if not rendered:
        raise ValueError("Session has no assistant responses")
    return {"model": model[0], "effort": model[1], "turns": rendered[:20],
            "omitted_turns": max(0, len(rendered) - 20)}


def classify(path):
    taxonomy = json.loads(DOMAINS.read_text(encoding="utf-8"))
    state = session_state(path)
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
    return {"session": path.name, "model": state["model"], "effort": state["effort"],
            "turns": len(state["turns"]), "omitted_turns": state["omitted_turns"],
            "taxonomy_version": taxonomy["version"], "involvement": involvement["answers"],
            "quality": quality["answers"],
            "usage": {"involvement": involvement.get("usage"), "quality": quality.get("usage")},
            "cost_usd": (involvement.get("cost_usd") or 0) + (quality.get("cost_usd") or 0)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sessions", nargs="+", type=Path)
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
    for line in args.output.read_text(encoding="utf-8").splitlines():
        previous.add(json.loads(line)["session"])
    with args.output.open("a", encoding="utf-8") as stream:
        for path in args.sessions:
            if path.name in previous:
                continue
            try:
                result = classify(path)
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
