# Crew seams

Crew is agnostic on two seams: the **orchestration mechanism** that launches, connects, and retires owners, and the **work record** that holds durable contracts. Read this when resolving either seam, configuring it, or authoring a mechanism manifest.

## Configuration layers

`assignment.py seams --repo <root>` resolves both seams with provenance. Layers, low to high—the highest layer that sets a seam wins that seam:

| Scope | Location |
| --- | --- |
| `global` | `~/.furanku-skills/crew/config.json` |
| `repo` | `<repo>/.furanku-skills/crew/config.json` |
| `machine-repo` | `~/.furanku-skills/crew/repos/<repo-key>.json` |

The repo key matches model-routing's: canonical Git common directory, or the resolved project path outside Git; `seams` prints each layer's exact path. Schema—both seams optional, a layer sets only what it decides:

```json
{
  "version": 1,
  "work_record": { "adapter": "beads" },
  "mechanism": { "id": "orca" }
}
```

To change a seam: write the complete version 1 document at the user-selected scope, rerun `seams`, and confirm the seam reports the intended value and source scope. A custom mechanism embeds its full manifest as `mechanism.manifest`; `seams` validates and returns it.

## Selection precedence

For each seam independently: an explicit instruction from the principal for this session > the resolved configuration > the convention already in use (the tracker the repository visibly uses; the mechanism already coordinating this crew session) > the default. The mechanism default is `harness-native`. The work record has no default: when nothing resolves and no convention is visible, ask the principal—and record `{"adapter": "none"}` only after the principal accepts that results flow to them alone.

## Mechanism manifests

A manifest is the checkable statement of what a mechanism can honor; `packet` refuses any assignment outside it. Shape:

```json
{
  "mechanism": "<id>",
  "launchable_agents": ["<agent>", "..."],
  "isolation": false,
  "communication": "<how questions, escalation, status, and completion reach the principal>",
  "retire": "<how to enumerate and clean up the resources an assignment created>",
  "extras": { "<key>": "<anchored regex the --extra value must match, '' = any>" }
}
```

`launchable_agents` lists the routing catalog's `agent` tokens this mechanism can start—the catalog's vocabulary, not the mechanism's own name—and `check --launchable-via` takes exactly this list. `extras` declares the mechanism-specific fields every packet must carry.

### harness-native (default)

Always available: the subagent, background-agent, or workflow facility of whatever harness is running. Set `launchable_agents` to the catalog agent tokens the running harness can actually start—a stock harness launches only its own vendor's models, which is why routing must see `--launchable-via`:

```json
{
  "mechanism": "harness-native",
  "launchable_agents": ["claude"],
  "isolation": false,
  "communication": "The harness's task notifications and agent messaging carry questions, status, and completion to the spawning session.",
  "retire": "Stop or dismiss the agent through the harness; no durable terminals or worktrees are created.",
  "extras": {}
}
```

Launch by starting the harness agent with the packet's `spec` as its prompt. Cross-vendor candidates are unreachable here; when the routing brief favors one, either accept the refusal's re-judged in-vendor pick or switch to a mechanism whose launchable agents include it.

### orca

Available when the `orchestration` and `orca-cli` skills are installed. Full capability: cross-vendor CLI launch, dispatch DAGs, dedicated terminals and worktrees:

```json
{
  "mechanism": "orca",
  "launchable_agents": ["claude", "codex", "opencode", "grok"],
  "isolation": true,
  "communication": "Orca dispatch carries questions, escalation, status, and completion; dependency order is represented once in Orca.",
  "retire": "Use current orchestration guidance to finish assignment state and current orca-cli guidance to retire the assignment's dedicated terminals and worktree.",
  "extras": { "front_key": "^[^/]+/[^/]+$" }
}
```

Pass `--extra front_key=<run-key>/<front>`. Name each Crew Orca tab `<Role> - <work summary>` (for example `Captain - payments integration`) so the role is visible at a glance.

### Custom mechanisms

Anything satisfying the manifest—tmux sessions, cloud sessions, another orchestrator. Store the manifest in configuration as `mechanism.manifest`; the mechanism's `communication` and `retire` strings must name procedures a cold agent can execute, not aspirations.

## Work-record adapters

The adapter names the tracker; `--work-ref <adapter>:<ref>` points a packet at an existing contract, `--request` plus `--work-record <adapter>` bootstraps the first one.

| Adapter | Record | Example ref |
| --- | --- | --- |
| `beads` | Beads issue via `bd` | `beads:abc123` |
| `github` | GitHub issue via `gh` | `github:#42` |
| `file` | In-repo document | `file:docs/tasks/shell-palette.md` |
| `none` | The verbatim request is the whole contract | — |

Any other tracker the project uses (an MCP tracker, another CLI) is a valid adapter token; the project's own docs define how to read and write it. Whatever the adapter, the role contracts' rule is constant: durable contracts, results, and remaining work live in the work record when one exists; with `none`, they flow to the principal.
