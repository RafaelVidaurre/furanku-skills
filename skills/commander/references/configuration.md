# Commander configuration

Read this file only for setup, config changes, resolver diagnosis, or version 1 migration.

## Locations and precedence

| Scope | Location | Purpose |
| --- | --- | --- |
| `global` | `~/.furanku-skills/commander/config.json` | Required machine baseline |
| `repo` | `<repo>/.furanku-skills/commander/config.json` | Shared, Git-tracked routes |
| `machine-repo` | `~/.furanku-skills/commander/repos/<repo-key>.json` | Private routes for one repository |

The repository key comes from the canonical Git common directory, so linked worktrees share machine-local routing. Persisted layers merge in the order shown; a higher layer replaces a complete route row or adds a route. The user's current invocation has highest precedence but remains ephemeral unless the user separately requests a config edit.

## Strict version 2 schema

Every file contains only `version` and `routes`:

```json
{
  "version": 2,
  "routes": {
    "captain": {
      "agent": "<exact-agent>",
      "model": "<exact-model>",
      "effort": "<exact-effort>"
    },
    "worker": {
      "agent": "<exact-agent>",
      "model": "<exact-model>",
      "effort": "<exact-effort>"
    },
    "worker.testing": {
      "work": "Front explicitly requests test design or focused verification.",
      "agent": "<exact-agent>",
      "model": "<exact-model>",
      "effort": "<exact-effort>"
    }
  }
}
```

The global file must define `captain` and `worker`. Optional layers may contain only complete rows they add or replace. Specialists begin with `captain.` or `worker.` and require a concrete `work` description. Each dot-separated name segment contains lowercase letters, digits, and single hyphens.

Treat `agent`, `model`, and `effort` as exact route intent. The current Orca and agent guides own how those values become a launched session; Commander stores no provider catalog or launch syntax. A route is usable only when those surfaces can apply its complete row.

Use only these setup recommendations:

- Captain routes favor fronts that need decomposition or integration.
- Worker routes favor one bounded outcome.

Specialists earn a row only when their `work` selects a meaningfully different agent, model, or effort from the base route. Write `work` as concrete phrases expected in a front's stated outcome, so routing can match explicit text rather than inferred implementation.

Configuration is complete when the user approves exact values for both base rows, the helper writes the intended scope, and full resolution reports the approved effective table. When the Orca runtime is available, validate that its current agent surfaces can launch both rows; otherwise report launch validation as pending for the first dispatch.

## Helper

Resolve `<commander-skill-dir>` to the directory containing `SKILL.md`:

```sh
CONFIG=<commander-skill-dir>/scripts/config.py

python3 "$CONFIG" template
python3 "$CONFIG" read all --repo <repository-root>
python3 "$CONFIG" resolve --repo <repository-root>
python3 "$CONFIG" resolve --repo <repository-root> --compact \
  --route worker --route worker.testing
python3 "$CONFIG" write <global|repo|machine-repo> \
  --repo <repository-root> --file <json-file>
python3 "$CONFIG" delete <global|repo|machine-repo> \
  --repo <repository-root> --yes
```

`write` accepts `--file -` for standard input, validates before atomically replacing the target, and writes private scopes with mode `0600` and repository scope with `0644`. `delete` requires `--yes` after conversational confirmation.

Full `resolve` retains layer and row provenance for setup and diagnosis. `resolve --compact` returns only effective route rows as compact JSON. Repeatable `--route` filters either form to the dispatch subset and fails if a requested route is absent. Routine dispatch resolution is complete when compact output contains every required route and nothing else.

## Version 1 migration

Routine resolution refuses version 1 and prints an actionable migration command. Preview before changing a scope:

```sh
python3 "$CONFIG" migrate <global|repo|machine-repo> \
  --repo <repository-root>
```

The preview shows the exact target, sibling backup, removed row, preserved routes, and resulting version 2 document without writing. Apply it only after review:

```sh
python3 "$CONFIG" migrate <global|repo|machine-repo> \
  --repo <repository-root> --yes
```

Migration validates the version 1 source, creates the one-time sibling `config.v1.json` backup, removes only the exact `commander` row, preserves all Captain/Worker routes, validates version 2, and atomically replaces the source. A byte-identical backup is reused after an interrupted attempt; a conflicting backup aborts migration.

Automatic migration aborts when any `commander.<name>` specialist exists and lists every conflicting row. The user must explicitly remove it or map its intent to a spawned-agent route before retrying. Migration is complete when full resolution succeeds at version 2 and the backup preserves the original document.
