# Crew routing configuration

Read only for setup, config changes, resolver diagnosis, or version 1 migration.

While acting as Commander, inspect configuration only. A user-directed configuration session or direct Worker performs requested writes.

## Locations and precedence

Version 2 keeps its established storage paths for compatibility:

| Scope | Location | Purpose |
| --- | --- | --- |
| `global` | `~/.furanku-skills/commander/config.json` | Required machine baseline |
| `repo` | `<repo>/.furanku-skills/commander/config.json` | Shared, Git-tracked routes |
| `machine-repo` | `~/.furanku-skills/commander/repos/<repo-key>.json` | Private routes for one repository |

Repository key = canonical Git common directory, so linked worktrees share machine-local routing. Layers merge in table order; the higher layer replaces a complete route row.

## Schema

Global configuration must define `captain` and `worker`. Specialists use `captain.*` or `worker.*` and add a concrete `work` description:

```json
{
  "version": 2,
  "routes": {
    "captain": { "agent": "codex", "model": "<model>", "effort": "<effort>" },
    "worker": { "agent": "codex", "model": "<model>", "effort": "<effort>" },
    "worker.rust": {
      "work": "The outcome explicitly requires Rust work.",
      "agent": "codex",
      "model": "<model>",
      "effort": "<effort>"
    }
  }
}
```

Values are exact launch intent. Add a specialist only when the work needs a meaningfully different route.

## Helper

```sh
CONFIG=<crew-skill-dir>/scripts/config.py
python3 "$CONFIG" template
python3 "$CONFIG" read all --repo <root>
python3 "$CONFIG" report --repo <root> [--route <id> ...]
python3 "$CONFIG" resolve --repo <root> --compact [--route <id> ...]
python3 "$CONFIG" write <global|repo|machine-repo> --repo <root> --file <json>
python3 "$CONFIG" delete <global|repo|machine-repo> --repo <root> --yes
```

Use `report` for effective-routing or provenance questions. Setup is complete when the user approves the base rows, the helper writes them, and `resolve` returns both.

## Version 1 migration

Resolution refuses version 1 and prints the preview command. Review the preview, then apply with `--yes`. The helper preserves a backup and refuses unresolved `commander.*` specialists.
