# Commander configuration

Read this file only when global setup is required or the user asks to create, edit, or delete a Commander config.

## Locations and merge

The bundled script resolves these scopes:

| Scope | Location | Purpose |
| --- | --- | --- |
| `global` | `~/.furanku-skills/commander/config.json` | Required machine baseline |
| `repo` | `<repo>/.furanku-skills/commander/config.json` | Shared, Git-tracked routes |
| `machine-repo` | `~/.furanku-skills/commander/repos/<repo-key>.json` | Private routes for one repository |

The script derives `<repo-key>` from the canonical Git common directory, so linked worktrees share machine-local routing. It merges complete route rows in `global`, `repo`, then `machine-repo` order. A higher row with the same ID replaces the lower row; a new ID extends the table.

`read all` and `resolve` list relevant legacy YAML files under `ignored_legacy`. They are never merged into the new routing table. During setup, use their model choices only as clearly labeled migration input and ask the user what to retain; remove a legacy file only on explicit request.

## Schema

Every file is strict JSON:

```json
{
  "version": 1,
  "routes": {
    "commander": {
      "agent": "<orca-agent>",
      "model": "<exact-model>",
      "effort": "<exact-effort>"
    },
    "captain": {
      "agent": "<orca-agent>",
      "model": "<exact-model>",
      "effort": "<exact-effort>"
    },
    "worker": {
      "agent": "<orca-agent>",
      "model": "<exact-model>",
      "effort": "<exact-effort>"
    },
    "worker.testing": {
      "work": "Test design, implementation, and focused verification.",
      "agent": "<orca-agent>",
      "model": "<exact-model>",
      "effort": "<exact-effort>"
    }
  }
}
```

The global file must define all three base routes. Optional layers may contain only the rows they replace or add. Specialist IDs start with a base role and require a concrete `work` description. Each row is atomic: repeat the complete combination when overriding it.

## Script

Resolve `<commander-skill-dir>` to the directory containing `SKILL.md`, then run the helper with Python 3.8 or newer. Use `python3` on POSIX or the equivalent Python 3 launcher on the host:

```sh
CONFIG=<commander-skill-dir>/scripts/config.py

python3 "$CONFIG" template
python3 "$CONFIG" read all --repo <repository-root>
python3 "$CONFIG" resolve --repo <repository-root>
python3 "$CONFIG" write <global|repo|machine-repo> --repo <repository-root> --file <json-file>
python3 "$CONFIG" delete <global|repo|machine-repo> --repo <repository-root> --yes
```

`write` also accepts JSON on stdin when `--file -` is used. `read` and `resolve` report exact source paths. `write` validates before replacing a file atomically. `delete` removes only the named scope and requires `--yes` after conversational confirmation.

`template` prints `null` placeholders. Replace every placeholder with an exact string before calling `write`; validation rejects incomplete rows.

## Validate identifiers

Keep validation with the system that owns each identifier:

- Discover agent CLIs from `PATH` first: run `command -v` for candidates such as `claude`, `codex`, and `grok`. Use the executable name as `agent`; preserve a different exact ID only when an existing custom launcher defines it.
- Query every discovered CLI through its own one-shot catalog command. Use `codex debug models` for Codex, `grok models` for Grok, and `claude -p "/model" --output-format json --no-session-persistence` for Claude; use each CLI's `--help` output to confirm its model and effort option syntax. For another CLI, inspect its help and use its equivalent non-interactive catalog command.
- Keep discovery non-interactive and limit it to help and catalog commands that perform no model turn. If a discovered CLI has no non-interactive catalog command, ask the user to attest its exact model and effort strings.
- Treat the helper as structural validation only. An invalid launch blocks the dispatch and never triggers an inferred fallback.

Discovery and setup must not invoke a model or enter provider usage, account, or billing controls.

## Guided setup

Use one short recommendation-and-confirmation cycle:

1. **Inspect.** Run `read all`, then apply **Validate identifiers** above. Distinguish runtime-verified combinations from user-attested ones. **Complete when:** existing layers, exact proposed identifiers, and the evidence status of each combination are known.
2. **Recommend.** Present one three-row table with exact `agent`, `model`, and `effort`, plus a one-line rationale per row. Use these standards:
   - `commander`: the most reliable approved orchestration and acceptance model, normally high effort;
   - `captain`: the strongest approved architecture and integration model, normally high or maximum effort;
   - `worker`: an economical approved implementation model, normally medium effort.
   Add a specialist only for a recurring work type that genuinely needs a different combination. Model names and effort labels do not establish capability or cost. When trustworthy metadata is absent, show the available combinations as unassigned and ask the user to map them to the three roles; do not turn the normal effort guidance into a guessed model assignment. **Complete when:** all three required rows have exact, evidence-backed or user-supplied values.
3. **Confirm.** Show the scope, exact path, and complete table; ask for one approval or corrections. A recommendation is not authorization to write or spend model usage. **Complete when:** the user explicitly approves the file contents.
4. **Write.** Write through the script, run `resolve`, and show the effective rows and their sources. For a `repo` config, also show Git status so the user can see the tracked artifact. **Complete when:** resolution succeeds and matches the approved table.

## Edit or delete

For an edit, show both the selected scope and the resolved table, propose a complete-row diff, obtain confirmation, write, then resolve again.

For a delete, show the exact file, the routes it contributes, and the table that would remain; obtain confirmation, then delete and resolve again. Deleting `global` disables Commander until global setup is completed again.
