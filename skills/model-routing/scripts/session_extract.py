#!/usr/bin/env python3
"""Prepare complete native text history for an agent to extract work tasks.

No model calls or semantic grouping happen here. Historical commands stay inert.
"""
import argparse
import json
import os
from pathlib import Path

from task_retrospect import read_turns, redact, write_private
from retrospect import text_content


def restore_agent_messages(path, turns):
    """Retain typed native dispatch/peer messages and delimit inherited history."""
    records = [json.loads(line) if line.strip() else {} for line in Path(path).read_text().splitlines()]
    metadata = next((r.get("payload", {}) for r in records if r.get("type") == "session_meta"), {})
    source = metadata.get("source", {})
    spawn = source.get("subagent", {}).get("thread_spawn", {}) if isinstance(source, dict) else {}
    agent_path = spawn.get("agent_path")
    cutoff = None
    original = list(turns)
    events = [e for t in turns for e in t["events"]]
    for line_no, row in enumerate(records, 1):
        payload = row.get("payload", {})
        if row.get("type") != "response_item" or payload.get("type") != "agent_message":
            continue
        message = text_content(payload.get("content"))
        if not message:
            continue
        previous = [t for t in original if int(t["request_id"][1:]) < line_no]
        context = previous[-1]["instruction_context"] if previous else []
        incomplete = any(isinstance(c, dict) and c.get("type") == "encrypted_content" for c in payload.get("content", []))
        turns.append({"turn": 0, "request_id": f"L{line_no}", "request": redact(message),
                      "task_request": redact(message), "origin": {"kind": "native_agent_message", "contains_unreadable_encrypted_content": incomplete},
                      "events": [], "instruction_context": [c for c in context if int(c["id"][1:]) <= line_no]})
        if (agent_path and "Message Type: NEW_TASK" in message.splitlines()
            and f"Task name: {agent_path}" in message.splitlines() and cutoff is None):
            cutoff = line_no
    turns.sort(key=lambda t: int(t["request_id"][1:]))
    for index, turn in enumerate(turns):
        start = int(turn["request_id"][1:])
        end = int(turns[index + 1]["request_id"][1:]) if index + 1 < len(turns) else float("inf")
        turn["turn"] = index
        turn["events"] = [e for e in events if start <= int(e["id"].split(".")[0][1:]) < end]
    return {"is_child": bool(agent_path), "dispatch_line": cutoff,
            "ownership": "dispatch_delimited" if cutoff else ("unresolved_child" if agent_path else "native_session")}


def supplement_codex_events(path, turns):
    """Older native histories may retain event records without response items."""
    starts = {int(t["request_id"][1:]): t for t in turns}
    current, actor = None, (None, None)
    supplemented = []
    for line_no, line in enumerate(Path(path).read_text().splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if line_no in starts:
            current = starts[line_no]
        payload = row.get("payload") or {}
        if row.get("type") == "turn_context":
            actor = (payload.get("model"), payload.get("effort"))
        kind = payload.get("type")
        if current is None or row.get("type") != "event_msg":
            continue
        if kind == "agent_message":
            message = payload.get("message")
            if not message or any(e.get("kind") == "response" and e.get("text") == message for e in current["events"]):
                continue
            event = {"kind": "response", "text": message, "native_event_type": kind}
        elif kind in {"exec_command_begin", "exec_command_end", "patch_apply_begin", "patch_apply_end",
                      "mcp_tool_call_begin", "mcp_tool_call_end", "web_search_begin", "web_search_end"}:
            event = {"kind": "native_observation", "native_event_type": kind, "payload": payload}
        else:
            continue
        event.update(id=f"L{line_no}.native", model=actor[0], effort=actor[1], attribution="turn_metadata" if all(actor) else "unknown")
        current["events"].append(redact(event))
        supplemented.append(event["id"])
    for turn in turns:
        turn["events"].sort(key=lambda e: int(e["id"].split(".")[0][1:]))
    return supplemented


def prepare(path, provider):
    path = Path(path)
    turns = read_turns(path, provider)
    ownership = restore_agent_messages(path, turns) if provider == "codex" else {"ownership": "native_session"}
    supplements = supplement_codex_events(path, turns) if provider == "codex" else []
    sources, contexts, actors, actor_ids, manifest = [], {}, {}, {}, []
    for turn in turns:
        sources.append({"id": turn["request_id"], "kind": "request", "body": {
            "request": turn["request"], "task_request": turn["task_request"],
            "origin": turn["origin"]}})
        context_ids = []
        for context in turn["instruction_context"]:
            identifier = context["id"] + ":context:" + context["kind"]
            contexts[identifier] = {"id": identifier, "kind": "historical_instruction", "body": context["content"]}
            context_ids.append(identifier)
        event_ids = []
        for event in turn["events"]:
            actor = (event.get("model"), event.get("effort"), event.get("attribution", "linked_tool_call"))
            if actor not in actor_ids:
                actor_ids[actor] = "actor" + str(len(actor_ids) + 1)
                actors[actor_ids[actor]] = dict(zip(("model", "effort", "provenance"), actor))
            body = {k: v for k, v in event.items() if k not in {"id", "model", "effort", "attribution"}}
            sources.append({"id": event["id"], "kind": event["kind"], "actor_id": actor_ids[actor], "body": body})
            event_ids.append(event["id"])
        manifest.append({"request_id": turn["request_id"], "event_ids": event_ids, "context_ids": context_ids})
    sources.extend(contexts.values())
    call_sources = {s["body"].get("call_id"): s["id"] for s in sources
                    if s["kind"] == "tool_call" and s["body"].get("call_id")}
    for source in sources:
        if source["kind"] == "tool_result":
            linked = call_sources.get(source["body"].get("call_id"))
            if linked:
                source["linked_call_source_id"] = linked
    if not manifest:
        raise ValueError("No readable work turns; source remains unassessed")
    for source in sources:
        line = int(source["id"].split(":")[0].split(".")[0][1:])
        cutoff = ownership.get("dispatch_line")
        source["ownership"] = ("inherited_context" if cutoff and line < cutoff else
                               "unknown" if ownership["ownership"] == "unresolved_child" else "current_session")
    return {"version": 1, "sources": sources, "turns": manifest,
            "reader": {"supplemented_native_events": supplements, "internal_reasoning": "excluded",
                       **ownership}}, actors


def unique_ids(items, label):
    if not isinstance(items, list) or any(not isinstance(x, dict) or not isinstance(x.get("id"), str) or not x["id"] for x in items):
        raise ValueError(label + " must contain identified records")
    ids = [x["id"] for x in items]
    if len(set(ids)) != len(ids):
        raise ValueError(label + " contains duplicate IDs")
    return set(ids)


def refs(value, allowed, label, nonempty=False):
    if (not isinstance(value, list) or any(not isinstance(x, str) for x in value)
        or len(set(value)) != len(value) or not set(value) <= allowed or (nonempty and not value)):
        raise ValueError(label + " needs valid unique source IDs")
    return set(value)


def validate_result(packet, result):
    if not isinstance(result, dict) or result.get("version") != 1:
        raise ValueError("Expected version 1 extraction result")
    sources = {s["id"]: s for s in packet["sources"]}
    requests = {t["request_id"] for t in packet["turns"]}
    events = {e for t in packet["turns"] for e in t["event_ids"]}
    contexts = {e for t in packet["turns"] for e in t["context_ids"]}
    tasks = result.get("tasks")
    task_ids = unique_ids(tasks, "tasks")
    links = result.get("request_links")
    if unique_ids(links, "request_links") != requests:
        raise ValueError("Every request must be linked or explicitly unresolved exactly once")
    linked = {task: set() for task in task_ids}
    for link in links:
        role = link.get("role")
        if role not in {"request", "correction", "feedback", "approval", "cancellation", "context", "unresolved"}:
            raise ValueError("Unknown request link role")
        owners = refs(link.get("task_ids"), task_ids, "request task links", role not in {"context", "unresolved"})
        if not isinstance(link.get("rationale"), str) or not link["rationale"].strip():
            raise ValueError("Request links need rationale")
        for task in owners:
            linked[task].add(link["id"])
    assigned = set()
    for task in tasks:
        if not isinstance(task.get("title"), str) or not task["title"].strip():
            raise ValueError("Each task needs a title")
        request_ids = refs(task.get("request_ids"), requests, "task requests", True)
        if request_ids != linked[task["id"]]:
            raise ValueError("Task requests must agree with request links")
        assigned |= refs(task.get("event_ids"), events, "task events")
        refs(task.get("context_ids"), contexts, "task context")
        requirements = task.get("requirements")
        if not unique_ids(requirements, "requirements"):
            raise ValueError("Each task needs at least one requirement")
        for requirement in requirements:
            if not isinstance(requirement.get("text"), str) or not requirement["text"].strip():
                raise ValueError("Each requirement needs text")
            refs(requirement.get("source_ids"), set(sources), "requirement provenance", True)
    excluded = result.get("unassigned_events")
    excluded_ids = unique_ids(excluded, "unassigned_events")
    if assigned & excluded_ids or assigned | excluded_ids != events:
        raise ValueError("Every event must be assigned or explicitly excluded")
    if any(not isinstance(x.get("reason"), str) or not x["reason"].strip() for x in excluded):
        raise ValueError("Excluded events need reasons")


def materialize(packet, result):
    """Copy evidence by source ID; the extractor cannot rewrite its contents."""
    validate_result(packet, result)
    sources = {s["id"]: s for s in packet["sources"]}
    cases = []
    for task in result["tasks"]:
        selected = set(task["request_ids"] + task["event_ids"] + task["context_ids"])
        selected.update(s for r in task["requirements"] for s in r["source_ids"])
        cases.append({"id": task["id"], "state": {
            "requested_deliverable": task["title"], "requirements": task["requirements"],
            "sources": [sources[s["id"]] for s in packet["sources"] if s["id"] in selected],
            "request_links": [r for r in result["request_links"] if task["id"] in r["task_ids"]],
        }})
    return {"version": 1, "cases": cases, "coverage": {
        "requests": len(result["request_links"]), "tasks": len(cases),
        "unresolved_requests": [r["id"] for r in result["request_links"] if r["role"] == "unresolved"],
        "unassigned_events": result["unassigned_events"],
        "semantic_status": "unreviewed",
        "assessment_ready": False,
        "pending": ["requirement_kind_and_applicability_review", "artifact_source_identification", "actor_contribution_scope"],
    }}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "materialize"])
    parser.add_argument("--source")
    parser.add_argument("--provider", choices=["codex", "claude", "grok"])
    parser.add_argument("--packet")
    parser.add_argument("--result")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.command == "prepare":
        if not args.source or not args.provider:
            parser.error("prepare requires --source and --provider")
        packet, attribution = prepare(args.source, args.provider)
        write_private(output, json.dumps(packet, indent=2) + "\n")
        write_private(output.with_suffix(".attribution.json"), json.dumps(attribution, indent=2) + "\n")
        print(json.dumps({"turns": len(packet["turns"]), "sources": len(packet["sources"])}))
    else:
        if not args.packet or not args.result:
            parser.error("materialize requires --packet and --result")
        result = materialize(json.loads(Path(args.packet).read_text()), json.loads(Path(args.result).read_text()))
        write_private(output, json.dumps(result, indent=2) + "\n")
        print(json.dumps(result["coverage"]))


if __name__ == "__main__":
    main()
