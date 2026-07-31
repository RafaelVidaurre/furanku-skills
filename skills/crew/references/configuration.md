# Crew routing configuration

Read only for configuration views, changes, selector diagnosis, or version 1 migration.

While acting as Commander, inspect configuration only. A user-directed configuration session or direct Worker performs requested writes.

## Layers and responsibilities

| Order | Scope | Location | Responsibility |
| --- | --- | --- | --- |
| 0 | `builtin` | `references/routing-catalog.json` | Research-backed candidates and semantic specializations |
| 1 | `global` | `~/.furanku-skills/commander/config.json` | Required machine exact-route baseline; optional routing patch |
| 2 | `repo` | `<repo>/.furanku-skills/commander/config.json` | Shared, Git-tracked exact routes and routing patch |
| 3 | `machine-repo` | `~/.furanku-skills/commander/repos/<repo-key>.json` | Private configuration for one repository |

Repository key = canonical Git common directory, so linked worktrees share machine-local routing.

Exact `routes` use whole-row replacement across persisted layers. Task-fit `routing` uses JSON merge-patch semantics: objects merge recursively, arrays and scalars replace, and `null` removes a value. Every winning leaf retains its source chain.

## Versions and schema

Version 2 remains a valid exact-route-only configuration. Global configuration must define `captain` and `worker`; specialists add `work`:

```json
{
  "version": 2,
  "routes": {
    "captain": { "agent": "codex", "model": "gpt-5.6-sol", "effort": "max" },
    "worker": { "agent": "grok", "model": "grok-4.5", "effort": "high" }
  }
}
```

Version 3 preserves that table and adds a composable routing patch:

```json
{
  "version": 3,
  "routes": {
    "captain": { "agent": "codex", "model": "gpt-5.6-sol", "effort": "max" },
    "worker": { "agent": "grok", "model": "grok-4.5", "effort": "high" }
  },
  "routing": {
    "candidates": {
      "opencode/kimi-for-coding/k3/max": { "enabled": false }
    },
    "specializations": {
      "implementation": {
        "needs": {
          "implementation": { "minimum": 0.7, "weight": 4 }
        }
      }
    },
    "policy": {
      "unknown_quota": "ineligible"
    }
  }
}
```

The allowed routing sections are `candidates`, `specializations`, and `policy`.

- Candidate IDs identify one exact `agent/model/effort` launch tuple. Capability assessments carry a score, conservative value, confidence, date, and public evidence; unavailable evidence remains unknown.
- Specializations contain semantic capability requirements, hard features, and operational priority. They cannot name an agent, model, effort, or candidate.
- Policy controls maximum positive-only shortfall, unknown-quota admission, and whether a configured exact route may be used as an explicitly enabled degraded fallback.
- Runtime authentication, health, inventory, and quota remain ephemeral inputs; never persist them as capability evidence.

## View configuration

Run both views because exact dispatch and task-fit policy are separate modes:

```sh
CONFIG=<crew-skill-dir>/scripts/config.py
ROUTER=<crew-skill-dir>/scripts/router.py
python3 "$CONFIG" report --repo <root> [--route <id> ...]
python3 "$ROUTER" report --repo <root>
```

The first report shows persisted layers, exact rows, and whole-row winners. The second shows the compiled research catalog, routing patches, and leaf provenance. A raw file alone does not establish effective configuration.

## Modify configuration

1. Run both reports against the target repository.
2. Select the requested scope: `global` for machine-wide behavior, `repo` for shared project behavior, or `machine-repo` for private project behavior. Ask when the intended scope is materially ambiguous.
3. Read the target layer, preserve untouched routes and patches, and construct its complete version 2 or version 3 document.
4. Write it through the helper:

   ```sh
   python3 "$CONFIG" write <global|repo|machine-repo> --repo <root> --file <json>
   ```

5. Rerun both reports. Exercise the requested outcome with a representative routing request and live quota:

   ```sh
   python3 "$ROUTER" choose --repo <root> \
     --request-file <request.json> --quota-axi
   ```

Use `config.py delete <scope> --repo <root> --yes` only after explicit confirmation to remove that entire layer.

## Task-fit request

The Captain supplies judgment; the router does not classify raw prose automatically:

```json
{
  "role": "worker",
  "summary": "Implement recovery ordering",
  "specialization": "implementation",
  "needs": {
    "reasoning": { "minimum": 0.54, "weight": 2 }
  },
  "requires": { "features": ["tools"], "minimum_context": 200000 },
  "selection_mode": "best-quality",
  "switching": "avoid",
  "current": "codex/gpt-5.6-sol/xhigh"
}
```

Built-in specializations are `architecture`, `planning`, `implementation`, `debugging`, `review`, `ui-product`, `spatial-3d`, and `trivial`. Projects may augment or add semantic specializations.

`selection_mode` expresses the user's operating point:

- `best-quality` ranks sufficient candidates by the weighted conservative capability score for this task, ahead of quota pressure, continuity, latency, and cost. Hard eligibility gates still apply.
- `cheapest-sufficient` requires the same research-backed sufficiency, then ranks by benchmark task cost ahead of quota pressure, continuity, latency, and quality.
- `specialization-default`, or omission, retains the specialization's configured priority.

Use `priority` instead for an advanced custom objective order. A request uses either `selection_mode` or `priority`, never both.

Use `{"role":"worker","exact_route":"worker"}` for deterministic configured behavior. Use `pin` with `candidate` and `reason` for an explicit candidate override; eligibility gates still apply.

Quota-axi contributes provider-local effective availability and pace pressure. Exhausted or unauthenticated providers are ineligible. Raw percentages from different providers are never treated as equivalent capacity. Kimi quota is not mapped to OpenCode K3 because those observed credentials may represent different accounts.

## Other helper operations

```sh
python3 "$CONFIG" template
python3 "$CONFIG" read all --repo <root>
python3 "$CONFIG" resolve --repo <root> --compact [--route <id> ...]
python3 "$CONFIG" migrate <scope> --repo <root> [--yes]
```

Resolution refuses version 1 and prints its migration preview command. Applying migration preserves a backup and refuses unresolved `commander.*` specialists.
