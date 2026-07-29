# Commander configuration

Read only for setup, config changes, resolver diagnosis, or version 1 migration.

## Locations and precedence

| Scope | Location | Purpose |
| --- | --- | --- |
| `global` | `~/.furanku-skills/commander/config.json` | Required machine baseline |
| `repo` | `<repo>/.furanku-skills/commander/config.json` | Shared, Git-tracked routes |
| `machine-repo` | `~/.furanku-skills/commander/repos/<repo-key>.json` | Private routes for one repository |

Repository key = canonical Git common directory (linked worktrees share machine-local routing). Layers merge in table order; higher replaces a full route row or adds one. Current-invocation overrides are ephemeral unless the user asks to edit config.

## Schema (version 2)

Files contain only `version` and `routes`. Global must define `captain` and `worker`. Specialists are `captain.*` / `worker.*` with a concrete `work` string. Segments: lowercase letters, digits, single hyphens.

```json
{
  "version": 2,
  "routes": {
    "captain": { "agent": "<exact-agent>", "model": "<exact-model>", "effort": "<exact-effort>" },
    "worker": { "agent": "<exact-agent>", "model": "<exact-model>", "effort": "<exact-effort>" },
    "worker.testing": {
      "work": "Front explicitly requests test design or focused verification.",
      "agent": "<exact-agent>",
      "model": "<exact-model>",
      "effort": "<exact-effort>"
    }
  }
}
```

`agent` / `model` / `effort` are exact route intent; Orca/agent guides apply them at launch. Specialists only when `work` needs a meaningfully different row; phrase `work` as text expected in a front outcome.

Setup is complete when the user approves both base rows, the helper writes the scope, and resolve shows the effective table. If Orca is up, confirm both rows can launch; else mark launch validation pending for first dispatch.

## Helper

```sh
CONFIG=<commander-skill-dir>/scripts/config.py
python3 "$CONFIG" template
python3 "$CONFIG" read all --repo <repository-root>
python3 "$CONFIG" report --repo <repository-root> [--route <id> ...]
python3 "$CONFIG" resolve --repo <repository-root> --compact --route worker --route worker.testing
python3 "$CONFIG" write <global|repo|machine-repo> --repo <repository-root> --file <json-file>
python3 "$CONFIG" delete <global|repo|machine-repo> --repo <repository-root> --yes
```

For routing diagnosis, run `report` and show its stdout as-is. It reports persisted layers only; current-invocation overrides are not included. `--format json` serves tools/tests. `resolve --compact --route …` stays the dispatch path. Run `--help` for other flags.

## Version 1 migration

Resolution refuses v1 and prints the migration command. Preview without `--yes`, review the plan, re-run with `--yes`. Migration aborts if any `commander.*` specialist exists — disposition those first. The script's preview/errors are the source of truth for backup and validation details.
