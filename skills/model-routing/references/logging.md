# Private routing journal

`router.py check` and `router.py route` append one decision event to the machine-wide journal, including refusals and failed attempts. The default is enabled. Records contain an opaque decision ID, a hash of the repository and effective routing configuration, selected agent/model/effort, selector and gate status, quota status, limited Jev choice metadata, elapsed time, and the spawning session ID when known. They exclude task text, full Jev requests and replies, account identity, reasons, credentials, and transcripts. The journal is local to this OS user at `~/.furanku-skills/model-routing/logs/YYYY-MM-DD.jsonl`, with mode `600` files, mode `700` directories, and 180-day age retention on writes. Session transcripts remain in their original harness storage.

```sh
python3 <skill-dir>/scripts/routing_log.py status
python3 <skill-dir>/scripts/routing_log.py tail --limit 50
python3 <skill-dir>/scripts/routing_log.py tail --decision-id <decision_id> --limit 20
python3 <skill-dir>/scripts/routing_log.py off
python3 <skill-dir>/scripts/routing_log.py on
```

`off` is the machine-wide opt-out for future routing and worker-link events. It preserves earlier private events until their retention period expires. `on` resumes logging. These controls never contact Jev. Every read is bounded to at most 200 returned events and 10,000 scanned events; the CLI prints JSON for filtering. The journal records the parent session automatically from `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, or `CLAUDE_SESSION_ID`; pass `router.py --session-ref <opaque-id>` when a harness uses a different identifier.

After a successful launch, associate the returned `decision_id` with the worker reference supplied by the launch mechanism:

```sh
python3 <skill-dir>/scripts/routing_log.py link \
  --decision-id <decision_id> --session-ref <worker-session-or-job-id>
```

Use the actual returned identifier. If the mechanism exposes it only after launch, link then. The link is a second event with the same decision ID, not an inference from model name or timestamps. A route that was never launched has no worker link. A terminal or dispatch ID records launch but does not identify an agent transcript. When the actual agent session ID becomes available, link that same decision again; the coverage check below uses the one reference that exactly matches a local agent session record. Multiple matching references remain ambiguous. Later retrospective analysis reads available sessions from their original stores using these links; it does not need saved Jev prompts or transcript copies in the journal.

**Complete when:** each attempted check or route has a decision/failure event while logging is on; each launched decision has a worker link once its identifier is known; and a bounded `tail` retrieves both events by `decision_id`.

## Audit retrospective coverage

Run a local-file census, then check exact agent session IDs against selected decisions:

```sh
routing_inventory_file="$HOME/.furanku-skills/model-routing/retrospectives/history-inventory-$(date +%Y%m%d-%H%M%S).jsonl"
python3 <skill-dir>/scripts/history_inventory.py --output "$routing_inventory_file"
python3 <skill-dir>/scripts/linked_coverage.py --inventory "$routing_inventory_file" \
  --output "$HOME/.furanku-skills/model-routing/retrospectives/linked-coverage-$(date +%Y%m%d-%H%M%S).json"
```

The inventory reads local Codex, Claude Code, and Grok stores. The coverage check scans the retained journal up to its explicit 100,000-event bound, prints aggregate dispositions, and writes private per-decision evidence. It includes selected and exact-route verdicts. `unlinked` means no worker link was recorded; it does not prove a launch occurred. `transcript_found` establishes an exact ID, matching agent/model/effort, a raw exchange, and a session with activity after the routing decision; it does not grade the task. `unresolved_reference` includes terminal and dispatch IDs as well as session IDs absent from the local inventory. `context_variant_unverified` means Claude's logged base model cannot prove its configured `[1m]` context variant. Review each proposed outcome against its original task, artifacts, tests, and user follow-ups before assigning quality.

**Complete when:** every selected or exact-route verdict in the retained journal has a disposition, and only `transcript_found` decisions are considered for linked-outcome assessment.
