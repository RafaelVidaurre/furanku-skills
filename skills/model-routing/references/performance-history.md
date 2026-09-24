# Historical model performance

Use this branch when studying how configured model and effort combinations performed, including disabled and explicit routes. A session does not need a Jev selection or routing-journal link. Exact links are for the separate [routing-policy audit](logging.md#audit-retrospective-coverage).

## Census the local corpus

Create a private inventory with `history_inventory.py` as documented in [Private routing journal](logging.md#audit-retrospective-coverage), then run:

```sh
python3 <skill-dir>/scripts/performance_census.py --repo <root> \
  --inventory <private-inventory.jsonl> \
  --output "$HOME/.furanku-skills/model-routing/retrospectives/performance-census-$(date +%Y%m%d-%H%M%S).jsonl"
```

The census includes every configured state, records model/effort matches once per native session, and reports `projected`, `mixed_unattributed`, `no_exchange`, `unprojectable`, or `inventory_error`. It counts unanswered final user messages separately from answered work turns. The private output is new and user-only. Claude base-model logs do not prove a configured context variant such as `[1m]`; Grok's current-model summary may not prove every earlier turn used it.

**Complete when:** every matching inventory row has one disposition, and every `inventory_error`, `unprojectable`, or `mixed_unattributed` row is listed as missing evidence or queued for repair rather than counted as a quality observation.

## Decide what can be scored

Split projected conversations by requested work outcome; attribute model and effort at the work-turn level before scoring mixed sessions. Resolve a task packet, issue, or external work reference before classifying its domain. Keep injected skill instructions, notifications, and transport events out of the request. Tie tests and artifacts to the requested outcome; an assistant completion claim, a passing-test marker, or silence alone does not establish acceptance. Treat images and 3D outputs as requiring visual evidence; the text-only Jev projection cannot judge their craft directly.

Classify requested work domains separately from outcome cause. A scope or instruction violation is process reliability; a changed preference is rework without proof that the original request was violated; a transport or service failure is external. Score only the domain that the available evidence actually evaluates, and retain `unknown` for the rest. Multiple turns or workers on one original task are correlated observations, not independent trials. Include unscored counts beside numeric observations.

**Complete when:** every proposed numeric score names one work outcome, its verified model and effort, a domain-specific evidence source, and an outcome cause; every excluded or unknown observation has a recorded reason.
