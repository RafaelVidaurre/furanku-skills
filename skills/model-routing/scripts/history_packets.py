#!/usr/bin/env python3
"""Create bounded previews while retaining native evidence and omission manifests."""
import argparse
import hashlib
import json
from pathlib import Path
import re

from session_extract import prepare
from task_retrospect import write_private


def encoded_reference(value):
    return {"artifact_reference": "sha256:" + hashlib.sha256(value.encode()).hexdigest(),
            "encoded_characters": len(value), "body_supplied": False,
            "reason": "Encoded artifact retained in native source; visual quality needs inspection"}


def compact_binary(value):
    """Remove encoded media, including JSON serialized inside tool output strings."""
    if isinstance(value, dict):
        if value.get("type") == "base64" and isinstance(value.get("data"), str):
            return {**value, "data": encoded_reference(value["data"])}
        if value.get("type") in ("image", "audio") and isinstance(value.get("data"), str):
            return {**value, "data": encoded_reference(value["data"])}
        return {k: compact_binary(v) for k, v in value.items()}
    if isinstance(value, list):
        return [compact_binary(v) for v in value]
    if isinstance(value, str):
        if value.lstrip().startswith(("{", "[")):
            try:
                parsed = json.loads(value)
            except ValueError:
                pass
            else:
                return json.dumps(compact_binary(parsed), ensure_ascii=False)
        return re.sub(r"data:(?:image|audio|video)/[\w.+-]+;base64,[A-Za-z0-9+/=\r\n]+",
                      lambda m: json.dumps(encoded_reference(m[0])), value)
    return value


def excerpt(text, limit):
    if len(text) <= limit:
        return {"text": text, "complete": True}
    # Both ends are explicitly excerpts, never presented as a complete contract.
    head = limit * 3 // 4
    return {"text": text[:head] + "\n[OMITTED]\n" + text[-(limit-head):],
            "complete": False, "original_characters": len(text)}


def preview(packet, identifier, limit=4000):
    requests = [s for s in packet["sources"] if s["kind"] == "request"
                and s["ownership"] == "current_session"]
    chosen = sorted({0, len(requests)//3, 2*len(requests)//3, len(requests)-1}) if requests else []
    cards = [{"id": requests[i]["id"], **excerpt(requests[i]["body"]["task_request"],
              max(100, (limit-800)//max(1, len(chosen))))} for i in chosen]
    events = [s for s in packet["sources"] if s["ownership"] == "current_session"
              and s["kind"] not in {"request", "historical_instruction"}]
    responses = [s for s in events if s["kind"] == "response"]
    return {"id": identifier, "requests": cards, "request_count": len(requests),
            "requests_sampled": len(cards), "event_count": len(events),
            "ownership": packet["reader"]["ownership"],
            "last_response": ({"id": responses[-1]["id"],
                **excerpt(responses[-1]["body"].get("text", ""), 600)} if responses else None),
            "evidence_characters": len(json.dumps(packet)),
            "purpose": "Provisional domain and evidence classification only; no quality score"}


def delivered_messages(value, depth=0):
    """Recover structured inbox receipts, never infer requests from prose."""
    if depth > 12:
        return []
    if isinstance(value, str):
        # Native exec output may prefix each independent JSON result with its index.
        candidate = re.sub(r"^\d+:\s*", "", value.strip())
        try:
            return delivered_messages(json.loads(candidate), depth + 1)
        except (ValueError, TypeError):
            return []
    if isinstance(value, list):
        return [m for item in value for m in delivered_messages(item, depth + 1)]
    if not isinstance(value, dict):
        return []
    result = value.get("result")
    if (value.get("ok") is True and isinstance(result, dict)
            and isinstance(result.get("messages"), list)):
        return [{k: m[k] for k in ("id", "from_handle", "to_handle", "body", "type")}
                for m in result["messages"] if isinstance(m, dict)
                and all(isinstance(m.get(k), str) for k in
                        ("id", "from_handle", "to_handle", "body", "type"))]
    return [m for item in value.values() for m in delivered_messages(item, depth + 1)]


def retain_inbox_contracts(sources):
    """Keep messages from actual Orca inbox reads alongside their native source ID.

    Receipt identity is transport evidence, not a verdict on message authority.
    Outbound sends and unrelated JSON do not become task instructions.
    """
    calls = {s["body"].get("call_id"): s for s in sources
             if s["kind"] == "tool_call" and isinstance(s.get("body"), dict)}
    output = []
    for source in sources:
        body = source.get("body")
        call = calls.get(body.get("call_id")) if isinstance(body, dict) else None
        if (source["kind"] == "tool_result" and call
                and re.search(r"\borca\s+orchestration\s+check\b", json.dumps(call["body"]))):
            messages = delivered_messages(body)
            if messages:
                source = {**source, "delivered_contract_messages": messages,
                          "contract_receipt_call_source_id": call["id"]}
        output.append(source)
    return output


def bounded_packet(packet, max_characters=100000):
    """Keep every native ID and request; shorten large bodies with explicit markers.

    This is a retrieval aid. Truncated bodies cannot support full-artifact claims.
    Original bodies are recoverable from the private prepared packet by source ID.
    """
    sources = retain_inbox_contracts(packet["sources"])
    reserve = len(json.dumps({**packet, "sources": []})) + 1000
    preserved = {"request", "response", "tool_call"}
    fixed = sum(len(json.dumps(s)) for s in sources if s["kind"] in preserved)
    if fixed + reserve + len(sources) * 300 > max_characters:
        preserved = {"request"}
        fixed = sum(len(json.dumps(s)) for s in sources if s["kind"] in preserved)
    available = max_characters - reserve - fixed - len(sources) * 240
    if available < 1000:
        raise ValueError("Requests and source identifiers exceed the packet budget; needs task pagination")
    weights = {"response": 3, "tool_call": 2, "tool_result": 3, "historical_instruction": 1}
    weight = sum(weights.get(s["kind"], 1) for s in sources if s["kind"] not in preserved)
    # JSON quoting, Unicode escaping and omission metadata can exceed the initial
    # allowance. Measure the actual wire representation before requiring pagination.
    while True:
        result, omitted = [], []
        for source in sources:
            body = json.dumps(source["body"], ensure_ascii=False)
            limit = max(100, available * weights.get(source["kind"], 1) // max(weight, 1))
            if source["kind"] in preserved or len(body) <= limit:
                result.append(source)
            else:
                item = {**source, "body": excerpt(body, limit), "body_complete": False}
                result.append(item)
                omitted.append(source["id"])
        output = {**packet, "sources": result, "evidence_limits": {
            "truncated_source_ids": omitted, "requests_complete": True,
            "rule": "Truncated bodies are retrieval leads. Recover source bodies before judging their full contents."}}
        size = len(json.dumps(output))
        if size <= max_characters:
            return output
        if available == 0:
            raise ValueError("Bounded packet exceeds limit; needs task pagination")
        available = int(available * 0.8)


def validate_previews(cards, previews, taxonomy):
    """Return per-card citation/schema gaps; never silently repair model citations."""
    inputs = {p["id"]: p for p in previews}
    if len(cards) != len(inputs) or {c.get("id") for c in cards} != set(inputs):
        raise ValueError("Preview output must cover each supplied card exactly once")
    domain_ids = {d["id"] for d in taxonomy["domains"]}
    errors = []
    for card in cards:
        request_ids = {r["id"] for r in inputs[card["id"]]["requests"]}
        seen = set()
        for domain in card.get("domains", []):
            identifier = domain.get("id")
            if (identifier not in domain_ids or identifier in seen
                or domain.get("role") not in {"central", "supporting", "unknown"}
                or not isinstance(domain.get("source_ids"), list)
                or not set(domain["source_ids"]) <= request_ids
                or (domain["role"] != "unknown" and not domain["source_ids"])):
                errors.append({"id": card["id"], "domain": identifier, "reason": "Invalid domain or request citation"})
            seen.add(identifier)
    return errors


def prepare_plan(plan, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest, cards = [], []
    for index, row in enumerate(plan["preview_candidates"], 1):
        identifier = f"S{index:03}"
        path = Path(row["path"])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        entry = {**row, "id": identifier, "source_sha256": digest}
        target = output / (identifier + ".json")
        if target.exists():
            saved = json.loads(target.read_text())
            if saved["source_sha256"] != digest or saved["session_ref"] != row["session_ref"]:
                raise ValueError("Source changed: create a new run, preserving the old selection")
            packet = saved["packet"]
        else:
            try:
                packet, actors = prepare(path, row["provider"])
                if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise ValueError("Source changed during preparation; retry after it stops changing")
                packet = compact_binary(packet)
                saved = {**entry, "packet": packet, "attribution": actors}
                write_private(target, json.dumps(saved, ensure_ascii=False) + "\n")
            except (ValueError, OSError) as error:
                entry["preparation_error"] = str(error)
                manifest.append(entry)
                continue
        cards.append(preview(packet, identifier))
        manifest.append(entry)
    write_private(output / "manifest.json", json.dumps(manifest, indent=2) + "\n")
    write_private(output / "previews.json", json.dumps(cards, ensure_ascii=False) + "\n")
    return {"candidates": len(manifest), "previews": len(cards),
            "preview_characters": sum(len(json.dumps(c)) for c in cards)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare_plan(json.loads(args.plan.read_text()), args.output)))
