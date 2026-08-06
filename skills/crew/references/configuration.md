# Crew routing configuration

Read only for configuration views, changes, brief diagnosis, or migration from versions 1 and 3.

While acting as Commander, inspect configuration only. A user-directed configuration session or direct Worker performs requested writes.

## Layers and responsibilities

| Order | Scope | Location | Responsibility |
| --- | --- | --- | --- |
| 0 | `builtin` | `references/routing-catalog.json` | Research-backed candidates, evidence methodology, and default exact routes |
| 1 | `global` | `~/.furanku-skills/commander/config.json` | Machine-wide exact routes, preferences, and candidate overrides |
| 2 | `repo` | `<repo>/.furanku-skills/commander/config.json` | Shared, Git-tracked project configuration |
| 3 | `machine-repo` | `~/.furanku-skills/commander/repos/<repo-key>.json` | Private configuration for one repository |

Repository key = canonical Git common directory, so linked worktrees share machine-local routing.

Exact `routes` use whole-row replacement across layers, starting from the builtin defaults. `preferences` accumulate: the brief lists every layer's entries low scope to high, each tagged with its source, and states the binding conflict-precedence order in its header—that header is the single normative statement of the order. `candidates` use JSON merge-patch semantics per candidate ID: objects merge recursively, arrays and scalars replace, `null` inside an override removes a field, and a top-level `"<candidate-id>": null` tombstone removes the whole candidate.

## Versions and schema

Version 2 remains a valid exact-route-only configuration. A persisted layer defines only the routes it overrides; the builtin catalog supplies `captain` and `worker` until then. Specialist routes add `work`:

```json
{
  "version": 2,
  "routes": {
    "captain": { "agent": "codex", "model": "gpt-5.6-sol", "effort": "xhigh" },
    "worker": { "agent": "grok", "model": "grok-4.5", "effort": "high" }
  }
}
```

Version 4 preserves that table and adds routing preferences and candidate overrides:

```json
{
  "version": 4,
  "routes": {
    "captain": { "agent": "codex", "model": "gpt-5.6-sol", "effort": "xhigh" }
  },
  "preferences": [
    "Captains default to gpt-5.6-sol at xhigh.",
    "For the most complex architecture or systems design, use claude-fable-5[1m] or gpt-5.6-sol at max."
  ],
  "candidates": {
    "opencode/kimi-for-coding/k3/max": { "enabled": false }
  }
}
```

- `preferences` are plain-language routing statements addressed to the spawning agent. They may name models, candidates, tiers, budgets, or conditions—anything the user wants weighed. They are not machine-enforced; the brief presents them and the spawn guidance makes them binding on the agent's judgment.
- `candidates` add new launchable candidates or patch builtin ones. A candidate carries one exact `agent/model/effort` launch tuple; capability assessments carry a score, conservative value, confidence, date, and public evidence; unavailable evidence remains unknown. `{"enabled": false}` removes a candidate from play; `check` refuses it.
- Runtime authentication, health, inventory, and quota remain ephemeral inputs; never persist them as capability evidence.
- Version 1 and version 3 files are refused with a migration preview command. Version 3's numeric specialization needs, weights, and selection policy have no version 4 equivalent: migration keeps routes and candidate overrides and turns each specialization description into a preference line for the user to rephrase or delete.

## View configuration

Run both views because exact dispatch and the routing brief are separate surfaces:

```sh
CONFIG=<crew-skill-dir>/scripts/config.py
ROUTER=<crew-skill-dir>/scripts/router.py
python3 "$CONFIG" report --repo <root> [--route <id> ...]
python3 "$ROUTER" brief --repo <root> [--quota-axi]
```

The first shows persisted layers, exact rows, and whole-row winners. The second shows what a spawning agent sees: preferences with scope tags, effective routes, and the merged candidate table with evidence. A raw file alone does not establish effective configuration.

## Modify configuration

1. Run both views against the target repository.
2. Select the requested scope: `global` for machine-wide behavior, `repo` for shared project behavior, or `machine-repo` for private project behavior. Ask when the intended scope is materially ambiguous.
3. Read the target layer, preserve untouched routes, preferences, and candidate overrides, and construct its complete version 2 or version 4 document. Write preferences as the user's own routing intent in plain language—short, testable statements, one concern per line.
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
python3 "$CONFIG" migrate <scope> --repo <root> [--yes]
python3 "$ROUTER" brief --repo <root> --format json
python3 "$ROUTER" check --repo <root> --candidate <id> --reason "<judgment>" [--quota-axi]
```

Resolution refuses versions 1 and 3 and prints their migration preview commands. Applying a migration preserves a backup; version 1 refuses unresolved `commander.*` specialists, and version 3 emits generated preference lines that the user should review and rephrase.

`check` hard-gates what its runtime inputs actually establish: `--quota-axi` supplies provider authentication and quota, so those gates are live in the documented flow; runtime health and inventory gate only when a `--runtime-file` supplies that state.
