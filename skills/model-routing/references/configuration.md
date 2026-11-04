# Model-routing configuration

Read only for configuration views, changes, or brief diagnosis.

## Layers and responsibilities

| Order | Scope | Location | Responsibility |
| --- | --- | --- | --- |
| 0 | `builtin` | `references/routing-catalog.json` | Research-backed candidates and evidence methodology; no model favorites |
| 1 | `consumer` | Optional file supplied with `--defaults` | Consumer-owned default exact routes |
| 2 | `global` | `~/.furanku-skills/model-routing/config.json` | Machine-wide exact routes, preferences, and candidate overrides |
| 3 | `repo` | `<repo>/.furanku-skills/model-routing/config.json` | Shared, version-tracked project configuration |
| 4 | `machine-repo` | `~/.furanku-skills/model-routing/repos/<repo-key>.json` | Private configuration for one repository |

Repository key = canonical Git common directory (the resolved project path outside Git), so linked worktrees share machine-local routing.

Exact `routes` use whole-row replacement in the layer order above. `preferences` accumulate: the brief lists every layer's entries low scope to high, each tagged with its source, and states the binding conflict-precedence order in its header—that header is the single normative statement of the order. `candidates` use JSON merge-patch semantics per candidate ID: objects merge recursively, arrays and scalars replace, `null` inside an override removes a field, and a top-level `"<candidate-id>": null` tombstone removes the whole candidate.

The catalog ships no exact routes. A consumer may supply a version 4 file containing only `version` and `routes` to `router.py brief|check|route` or `config.py resolve|report` with `--defaults <file>`. Use the same file throughout one decision, including retries. Consumer defaults are read-only inputs; missing or invalid files fail closed. Persisted overrides remain authoritative, and routes still activate only on a principal request. Without consumer defaults or persisted routes, the effective routes table is empty and ordinary candidate selection still works.

## Schema

Persisted layers and consumer defaults are version 4 documents. A persisted layer defines only the routes it overrides. `preferences`, `candidates`, `account_routing`, `recovery`, and `role_recovery` are optional in persisted layers. [Accounts](accounts.md) defines discovery, reporting, private profile configuration, and launch binding; the highest defining layer replaces that entire account policy. Route IDs are consumer-defined dotted tokens with no required role names; every route requires `agent`, `model`, and `effort`, and may carry a non-empty `work` description or partial `recovery` policy. Existing version 4 rows with or without these optional fields remain valid:

```json
{
  "version": 4,
  "routes": {
    "design": { "agent": "codex", "model": "gpt-6-astra", "effort": "high" },
    "implementation": {
      "agent": "grok",
      "model": "grok-4.7",
      "effort": "high",
      "on_quota_unusable": {
        "ask_seconds": 600,
        "fallback": { "agent": "codex", "model": "gpt-6-astra", "effort": "high" }
      }
    }
  },
  "preferences": [
    "For architecture, prioritize reasoning quality over response speed.",
    "Use lower effort for routine changes when it is sufficient for the task."
  ],
  "candidates": {
    "opencode/kimi-for-coding/k3/max": { "enabled": false },
    "codex-fixed/gpt-6-astra/high": {
      "launch": {
        "agent": "codex-fixed",
        "model": "gpt-6-astra",
        "effort": "high"
      },
      "quota_provider": {
        "provider": "codex",
        "detail": "This fixed launcher bills the registered Codex account."
      },
      "quota_account": "codex"
    }
  },
  "accounts": {
    "codex": "codex-account@example.com"
  }
}
```

- `preferences` are plain-language routing statements addressed to the spawning agent. They may name models, candidates, tiers, budgets, or conditions—anything the user wants weighed. They are not machine-enforced; the brief presents them and the spawn guidance makes them binding on the agent's judgment.
- `on_quota_unusable` is optional on any route. Omit it or set `"ask"` to keep asking. An object requires a `fallback` launch tuple different from the route and may set `ask_seconds` (default 600): the agent asks once per quota blocker, then `check --use-quota-fallback` may take that fallback if the principal has not answered. Whole-row replacement still applies — a later layer that omits the field removes the fallback.
- `candidates` add new launchable candidates or patch builtin ones. A candidate carries one exact `agent/model/effort` launch tuple; capability assessments carry a score, conservative value, confidence, date, public evidence, and a `scale` naming the benchmark and version; unavailable evidence remains unknown. `{"enabled": false}` makes it unavailable. `{"enabled": true, "explicit": true}` requires a principal request for that model and effort, recorded with `check --explicit-basis`. The default is enabled; `explicit: false` restores ordinary selection. A candidate whose launcher always bills one fixed account sets `quota_account` to that account's provider key in `accounts`.
- The `agent` token names the launcher capability that can serve the model, not a vendor. Two launchers reaching the same model hold different tokens — `codex/gpt-6-astra/high` and `claudex/gpt-6-astra/high` are the same model through different surfaces. Give a launcher its own token whenever it serves models no other launcher can reach, so that a consumer omitting it from `check --launchable-via` genuinely loses those models. Folding such a launcher under a broader token makes its exclusive models unrefusable: the gate compares tokens, so a model reachable only through a parked launcher stays selectable under the shared token. Keep the launcher out of the model name; the token carries it.
- `quota_pool` marks a candidate that does not bill the account its launch harness uses — the same model reached through a proxy that holds several credentials and picks one per request. It carries the billed `provider` and a `detail` explaining the arrangement. Such a candidate never inherits its harness's quota and never borrows a single credential's number. Its quota reports `pooled`, which passes with a warning: the surface has no one account to measure and rotates off exhausted credentials itself, so this is a settled state rather than a failed reading, and acceptance stays for quota that is normally readable and currently is not. The harness's authentication and health still gate it: the proxy supplies the account, not the ability to run.
- `quota_provider` marks a candidate billed by a provider other than its launch harness. It carries the billed `provider` and a `detail` explaining the arrangement. The candidate keeps the harness's authentication and health gates but never inherits the harness account's quota. Provider runtime is projected onto the candidate when an adapter supplies it; otherwise quota stays `unknown` and requires explicit acceptance. Use this for a single-provider route; use `quota_pool` only when the serving surface actually rotates credentials.
- `accounts` is a private registry of provider account identities (`claude`, `codex`, `grok`). It does not apply an account to every candidate from that provider. `check` compares a quota reading with a registered account only when that candidate opts in through `quota_account`; a mismatch is refused in both directions because neither apparent headroom nor exhaustion describes that fixed-account launch.

  Use `quota_account` only when the candidate's launch surface always bills that one account. Account-scoped launchers such as Orca Codex sessions use the active session's measured account and omit `quota_account`; different sessions may select different accounts. Rotating proxies use `quota_pool`, because no single registered identity describes them.
- Runtime authentication, health, inventory, and quota remain ephemeral inputs; never persist them as capability evidence.

After layers merge, each compiled candidate is validated independently. A malformed entry is omitted from the launchable table and listed as excluded in `router.py brief` and `config.py report`. `check --candidate` of that id, or `check --exact-route` whose launch matches only that entry, fails closed with that entry's diagnostic. A valid sibling remains checkable; the malformed row is not repaired from a lower layer. Invalid layer JSON, document schema, or route rows remain hard errors for the whole document.

## Recovery policy

Use [agent-guided setup](setup.md) to inspect unanswered preferences and review a complete document before saving. Recovery is structured behavior and bounds; ordinary model preferences remain in `preferences` and candidate settings.

| Field | Values | Builtin default |
| --- | --- | --- |
| `on_limit` | `equivalent`, `ask`, `wait` | `equivalent` |
| `on_no_reply` | `stop`, `continue` | `stop` |
| `response_seconds` | Positive integer | `600` |
| `max_wait_seconds` | Positive integer | `1800` |
| `max_replacements` | Non-negative integer | `2` |

`equivalent` permits an eligible replacement that preserves the task's capability and constraints. `ask` requests a decision; `wait` bounds the pause by `max_wait_seconds`. `response_seconds` bounds the wait for an answer; `on_no_reply` governs its expiry. `continue` authorizes only recovery within the other policy limits. A zero replacement limit prevents replacement launches. Unknown fields, booleans in integer fields, and unknown roles are rejected.

```json
{
  "version": 4,
  "routes": {},
  "recovery": { "on_limit": "equivalent", "on_no_reply": "stop" },
  "role_recovery": {
    "commander": { "on_limit": "ask" },
    "worker": { "max_replacements": 1 }
  }
}
```

Policy merges field by field through builtin → global → repo → machine-repo. Within each layer, apply general `recovery`, then the selected role's `role_recovery`, then the selected named route's `recovery`; command or assignment overrides apply last. Role names are `commander`, `captain`, and `worker`. A later general policy can override an earlier role or route policy. A launch-row replacement does not erase lower-scope recovery fields: recovery has its own fieldwise resolution. Consumer default files supply exact launch routes; persisted recovery policy and explicit overrides govern recovery.

The resolver returns the effective `policy`, a source for every field, and `configured_fields` that distinguishes explicit settings from builtin defaults. Setup asks unanswered behavior preferences even though safe defaults let routing proceed; an explicit `stop` is already an answer. When the user chooses `continue`, setup offers duration customization and includes the accepted duration in the approval preview. Missing preferences never imply permission to continue after silence.

Existing `on_quota_unusable` fallback authorization and its `ask_seconds` remain compatible until `on_no_reply` is explicitly configured. Then `stop` suppresses unattended legacy fallback, while `continue` uses the resolved `response_seconds` for its window. An explicit acceptance of unknown quota is a separate user decision.

## View configuration

For the concise effective model and effort list, including all launch surfaces and each row's source:

```sh
python3 <skill-dir>/scripts/config.py models --repo <root>
```

`list` is an alias for `models`; `--format json` is available for consumers. The markers mean 🟢 enabled (ordinary selection), 🟡 explicit (principal request only), and 🔴 disabled (unavailable). These are configuration states, not live quota or authentication status.

Run both views because exact dispatch and the routing brief are separate surfaces:

```sh
CONFIG=<skill-dir>/scripts/config.py
ROUTER=<skill-dir>/scripts/router.py
python3 "$CONFIG" report --repo <root> [--route <id> ...]
python3 "$ROUTER" brief --repo <root> [--codexbar] \
  [--launchable-via <agent,...>]
```

The first shows persisted layers, exact rows, whole-row winners, and any excluded malformed candidates. The second shows what a spawning agent sees: preferences with scope tags, effective routes, the merged candidate table with evidence, and the same excluded malformed candidates. Pass the consumer's `--defaults` file to both views when one applies. A raw file alone does not establish effective configuration.

## Modify configuration

Set a model and effort in the machine-wide layer by default. When several launch surfaces match, choose one with `--agent` or deliberately change all with `--all-agents`. Use `--scope repo` for tracked project behavior or `--scope machine-repo` for private project behavior. Creating a combination absent from the catalog requires `--create --agent <launcher>`; the new candidate has unknown capability evidence until separately researched.

```sh
python3 <skill-dir>/scripts/config.py set explicit gpt-6-astra high --agent codex --repo <root>
python3 <skill-dir>/scripts/config.py set enabled gpt-6-sol xhigh --agent codex --create --repo <root>
```

The command preserves other configuration fields, refuses a lower-scope state shadowed by a higher scope, and prints the effective changed rows. Re-run `models` to inspect the result. A candidate made explicit can pass `router.py check` only with `--explicit-basis` carrying the principal's request for its model and effort. Naming an exact route without naming the model and effort does not authorize an explicit candidate or a quota fallback to one.

1. Run both views against the target repository.
2. Select the requested scope: `global` for machine-wide behavior, `repo` for shared project behavior, or `machine-repo` for private project behavior. Ask when the intended scope is materially ambiguous.
3. Read the target layer, preserve untouched routes, preferences, and candidate overrides, and construct its complete version 4 document. Write preferences as the user's own routing intent in plain language—short, testable statements, one concern per line.
4. Write it through the helper:

   ```sh
   python3 "$CONFIG" write <global|repo|machine-repo> --repo <root> --file <json>
   ```

5. Rerun both views and confirm the change is visible: the route row wins from the intended scope, the preference line appears with the intended scope tag, or the candidate change shows in the table. For a preference change, also confirm the wording answers the routing question it was written for—an agent reading only the brief should reach the pick the user intended.

When repairing ordinary task selection, inspect accumulated preferences as well as candidate states. An enabled candidate can still be discouraged by a higher-scope preference. Replace superseded guidance at its owning scope rather than stacking another contradictory line: for example, a blanket "reserve max for exceptional work" can suppress a smaller model whose only configured effort is max. Preserve restrictions on critical decisions while expressing effort comparisons within the same model. Exact routes are opt-in dispatch shorthands, so changing those rows alone does not repair ordinary selection. Keep private preferences out of published catalog changes.

When retiring a model, inspect all persisted layers and active worktree configurations in the requested scope: a candidate override can reintroduce a removed builtin, and exact routes or quota fallbacks can still name it. Update those references through the helper, synchronize installed skill copies, and regenerate each affected repository's report and brief. Complete when the retired model is absent from effective routes, fallbacks, and candidates in every affected checkout and installed copy. Preserve dated research as historical evidence.

Use `config.py delete <scope> --repo <root> --yes` only after explicit confirmation to remove that entire layer.

## Other helper operations

```sh
python3 "$CONFIG" template
python3 "$CONFIG" read all --repo <root>
python3 "$CONFIG" resolve --repo <root> --compact [--route <id> ...]
python3 "$ROUTER" brief --repo <root> --format json
python3 "$ROUTER" check --repo <root> --candidate <id> --reason "<judgment>" \
  [--max-effort-basis "<why xhigh or the strongest lower effort is insufficient>"] \
  [--launchable-via <agent,...>] [--accept-quota-unknown "<basis>"] [--codexbar]
python3 "$ROUTER" check --repo <root> --exact-route <id> \
  --route-basis "<verbatim principal request>" \
  [--use-quota-fallback "<who waited and how long>"] --codexbar
```

`check` hard-gates what its runtime inputs actually establish: `--codexbar` supplies provider authentication and quota, so those gates are live in the documented flow; runtime health and inventory gate only when a `--runtime-file` supplies that state. It also refuses a judged `max` candidate that has enabled lower-effort siblings for the same agent and model until `--max-effort-basis` explicitly names the strongest lower effort and records why it is materially insufficient; exact routes use the principal's route basis instead. When quota stays unknown or stale after the runtime inputs, `check` exits 2 with status `needs-acceptance` until `--accept-quota-unknown` records who accepted launching without live quota. `--use-quota-fallback` is valid only with `--exact-route`: preserve the same `--route-basis`, re-check the primary route first, and use the configured fallback only while quota is still unknown or stale.
