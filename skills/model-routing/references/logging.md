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

After a successful launch, associate the returned `decision_id` with the worker session or job ID supplied by the launch mechanism:

```sh
python3 <skill-dir>/scripts/routing_log.py link \
  --decision-id <decision_id> --session-ref <worker-session-or-job-id>
```

Use the actual returned identifier. If the mechanism exposes it only after launch, link then. The link is a second event with the same decision ID, not an inference from model name or timestamps. A route that was never launched has no worker link. Later retrospective analysis reads available sessions from their original stores using these links; it does not need saved Jev prompts or transcript copies in the journal.

**Complete when:** each attempted check or route has a decision/failure event while logging is on; each launched decision has a worker link once its identifier is known; and a bounded `tail` retrieves both events by `decision_id`.
