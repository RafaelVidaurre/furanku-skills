# Model-routing configuration

Read only for configuration views, changes, or brief diagnosis.

## Layers and responsibilities

| Order | Scope | Location | Responsibility |
| --- | --- | --- | --- |
| 0 | `builtin` | `references/routing-catalog.json` | Research-backed candidates, evidence methodology, and default exact routes |
| 1 | `global` | `~/.furanku-skills/model-routing/config.json` | Machine-wide exact routes, preferences, and candidate overrides |
| 2 | `repo` | `<repo>/.furanku-skills/model-routing/config.json` | Shared, version-tracked project configuration |
| 3 | `machine-repo` | `~/.furanku-skills/model-routing/repos/<repo-key>.json` | Private configuration for one repository |

Repository key = canonical Git common directory (the resolved project path outside Git), so linked worktrees share machine-local routing.

Exact `routes` use whole-row replacement across layers, starting from the builtin defaults. `preferences` accumulate: the brief lists every layer's entries low scope to high, each tagged with its source, and states the binding conflict-precedence order in its header—that header is the single normative statement of the order. `candidates` use JSON merge-patch semantics per candidate ID: objects merge recursively, arrays and scalars replace, `null` inside an override removes a field, and a top-level `"<candidate-id>": null` tombstone removes the whole candidate.

## Schema

Every layer is a version 4 document. A persisted layer defines only the routes it overrides; the builtin catalog supplies `captain` and `worker` until then. `preferences` and `candidates` are optional. Route IDs are consumer-defined dotted tokens; every route beyond the builtin `captain` and `worker` adds a `work` field describing when it applies:

```json
{
  "version": 4,
  "routes": {
    "captain": { "agent": "codex", "model": "gpt-5.6-sol", "effort": "high" },
    "worker": {
      "agent": "grok",
      "model": "grok-4.6",
      "effort": "high",
      "on_quota_unusable": {
        "ask_seconds": 120,
        "fallback": { "agent": "codex", "model": "gpt-5.6-sol", "effort": "high" }
      }
    }
  },
  "preferences": [
    "Captains default to gpt-5.6-sol at high.",
    "Treat grok-4.6 at high as a peer of claude-fable-5[1m] and gpt-5.6-sol at high for intelligence, architecture, and most complex problems.",
    "For the most complex architecture or systems design, use claude-fable-5[1m], gpt-5.6-sol at max, or grok-4.6 at high."
  ],
  "candidates": {
    "opencode/kimi-for-coding/k3/max": { "enabled": false }
  },
  "accounts": {
    "codex": "codex-account@example.com"
  }
}
```

- `preferences` are plain-language routing statements addressed to the spawning agent. They may name models, candidates, tiers, budgets, or conditions—anything the user wants weighed. They are not machine-enforced; the brief presents them and the spawn guidance makes them binding on the agent's judgment.
- `on_quota_unusable` is optional on any route. Omit it or set `"ask"` to keep asking. An object requires a `fallback` launch tuple different from the route and may set `ask_seconds` (default 120): the agent asks once per quota blocker, then `check --use-quota-fallback` may take that fallback if the principal has not answered. Whole-row replacement still applies — a later layer that omits the field removes the fallback.
- `candidates` add new launchable candidates or patch builtin ones. A candidate carries one exact `agent/model/effort` launch tuple; capability assessments carry a score, conservative value, confidence, date, and public evidence; unavailable evidence remains unknown. `{"enabled": false}` removes a candidate from play; `check` refuses it.
- The `agent` token names the launcher capability that can serve the model, not a vendor. Two launchers reaching the same model hold different tokens — `codex/gpt-5.6-sol/high` and `claudex/gpt-5.6-sol/high` are the same model through different surfaces. Give a launcher its own token whenever it serves models no other launcher can reach, so that a consumer omitting it from `check --launchable-via` genuinely loses those models. Folding such a launcher under a broader token makes its exclusive models unrefusable: the gate compares tokens, so a model reachable only through a parked launcher stays selectable under the shared token. Keep the launcher out of the model name; the token carries it.
- `quota_pool` marks a candidate that does not bill the account its launch harness uses — the same model reached through a proxy that holds several credentials and picks one per request. It carries the billed `provider` and a `detail` explaining the arrangement. Such a candidate never inherits its harness's quota and never borrows a single credential's number. Its quota reports `pooled`, which passes with a warning: the surface has no one account to measure and rotates off exhausted credentials itself, so this is a settled state rather than a failed reading, and acceptance stays for quota that is normally readable and currently is not. The harness's authentication and health still gate it: the proxy supplies the account, not the ability to run.
- `quota_provider` marks a candidate billed by a provider other than its launch harness. It carries the billed `provider` and a `detail` explaining the arrangement. The candidate keeps the harness's authentication and health gates but never inherits the harness account's quota. Provider runtime is projected onto the candidate when an adapter supplies it; otherwise quota stays `unknown` and requires explicit acceptance. Use this for a single-provider route; use `quota_pool` only when the serving surface actually rotates credentials.
- `accounts` map a provider (`claude`, `codex`, `grok`) to the account its launches bill. Quota tools report whichever account the ambient environment selects — for Codex, whatever `$CODEX_HOME` points at — which is not necessarily the account that pays for the work. Where a provider is listed, `check` refuses any quota reading measured against a different account, in both directions: apparent headroom on the wrong account is refused exactly like exhaustion, because neither describes the launch. The check applies to the provider a reading was measured on, so a proxy-routed candidate is judged against its upstream provider rather than its launch harness.

  Set this only for a provider whose launches bill one fixed account. Leave it unset where several credentials for that provider sit behind a rotating proxy: the account that serves a request is chosen at request time, so no single OAuth reading — and no configured value — describes it, and pinning one would refuse work that would have succeeded. A pooled provider's single-account quota reading is likewise weak evidence: exhaustion on the measured credential does not mean the pool is out.
- Runtime authentication, health, inventory, and quota remain ephemeral inputs; never persist them as capability evidence.

## View configuration

Run both views because exact dispatch and the routing brief are separate surfaces:

```sh
CONFIG=<skill-dir>/scripts/config.py
ROUTER=<skill-dir>/scripts/router.py
python3 "$CONFIG" report --repo <root> [--route <id> ...]
python3 "$ROUTER" brief --repo <root> [--quota-axi] \
  [--launchable-via <agent,...>]
```

The first shows persisted layers, exact rows, and whole-row winners. The second shows what a spawning agent sees: preferences with scope tags, effective routes, and the merged candidate table with evidence. A raw file alone does not establish effective configuration.

## Modify configuration

1. Run both views against the target repository.
2. Select the requested scope: `global` for machine-wide behavior, `repo` for shared project behavior, or `machine-repo` for private project behavior. Ask when the intended scope is materially ambiguous.
3. Read the target layer, preserve untouched routes, preferences, and candidate overrides, and construct its complete version 4 document. Write preferences as the user's own routing intent in plain language—short, testable statements, one concern per line.
4. Write it through the helper:

   ```sh
   python3 "$CONFIG" write <global|repo|machine-repo> --repo <root> --file <json>
   ```

5. Rerun both views and confirm the change is visible: the route row wins from the intended scope, the preference line appears with the intended scope tag, or the candidate change shows in the table. For a preference change, also confirm the wording answers the routing question it was written for—an agent reading only the brief should reach the pick the user intended.

Use `config.py delete <scope> --repo <root> --yes` only after explicit confirmation to remove that entire layer.

## Other helper operations

```sh
python3 "$CONFIG" template
python3 "$CONFIG" read all --repo <root>
python3 "$CONFIG" resolve --repo <root> --compact [--route <id> ...]
python3 "$ROUTER" brief --repo <root> --format json
python3 "$ROUTER" check --repo <root> --candidate <id> --reason "<judgment>" \
  [--max-effort-basis "<why xhigh or the strongest lower effort is insufficient>"] \
  [--launchable-via <agent,...>] [--accept-quota-unknown "<basis>"] [--quota-axi]
python3 "$ROUTER" check --repo <root> --exact-route <id> \
  --route-basis "<verbatim principal request>" \
  [--use-quota-fallback "<who waited and how long>"] --quota-axi
```

`check` hard-gates what its runtime inputs actually establish: `--quota-axi` supplies provider authentication and quota, so those gates are live in the documented flow; runtime health and inventory gate only when a `--runtime-file` supplies that state. It also refuses a judged `max` candidate that has enabled lower-effort siblings for the same agent and model until `--max-effort-basis` explicitly names the strongest lower effort and records why it is materially insufficient; exact routes use the principal's route basis instead. When quota stays unknown or stale after the runtime inputs, `check` exits 2 with status `needs-acceptance` until `--accept-quota-unknown` records who accepted launching without live quota. `--use-quota-fallback` is valid only with `--exact-route`: preserve the same `--route-basis`, re-check the primary route first, and use the configured fallback only while quota is still unknown or stale.
