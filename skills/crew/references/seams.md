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
  "communication": "<how the assignment is launched and delivered, and how questions, escalation, status, and completion reach the principal>",
  "retire": "<how to enumerate and clean up the resources an assignment created>",
  "extras": { "<key>": "<anchored regex the --extra value must match, '' = any>" }
}
```

`launchable_agents` lists all and only the routing catalog's `agent` tokens the selected orchestration surface can start in the current session—the catalog's vocabulary, not the mechanism, harness, or executable name—and `check --launchable-via` takes exactly this list. The selected `agent` is a capability identity for routing and gating, not a generic launch API parameter; each mechanism profile defines how the packet maps to its API. Resolve the list from the selected surface's current capabilities rather than wrapper-wide capability. `extras` declares the mechanism-specific fields every packet must carry.

### harness-native (default)

Always available: the native coordination facilities of whatever harness is running. Resolve the native profile from capabilities visible in the current session, not from the launcher executable's name. Prefer a native orchestration surface that represents dependencies, shared progress, and correlated completion; use individual subagents or background agents when the harness has no such surface. Set `launchable_agents` to the catalog agent tokens that surface can actually start—a stock harness launches only its own vendor's models, which is why routing must see `--launchable-via`.

#### Claude Code workflow profile

When the current harness exposes Claude Code's Workflow tool, use Workflow as Crew's orchestration surface. The manifest below describes stock Claude Code. A renamed or extended harness qualifies when the session exposes Workflow, but its own configured manifest is authoritative about which agents that Workflow can launch.

- Start one workflow run for each delegation batch owned by the spawning session.
- Map each Crew assignment to one workflow agent and pass that assignment's packet `spec` unchanged as its prompt.
- Pass the packet's selected `model` and `effort` as the workflow agent's `model` and `effort` options; the `spec` records them but does not enact them:

  ```js
  agent(packet.spec, {
    model: packet.routing.model,
    effort: packet.routing.effort,
  })
  ```

- Keep four namespaces distinct: the Crew `role` (`captain` or `worker`) defines ownership in the prompt; routing `agent` identifies a provider/launcher capability; `model` selects the model; Workflow `agentType` optionally selects a registered subagent definition. Omit `agentType` unless a specific type from the current Workflow registry is intentionally required. Never derive it from the packet's `agent`, `model`, or Crew `role`.
- If Workflow reports `agent({agentType}): agent type '<token>' not found` after a routing `agent` was copied into `agentType`, classify it as malformed field mapping rather than capability evidence; apply the mapping above and the failure recovery owned by **Spawn an owner**.
- Encode dependency order once in the workflow script: await prerequisites before dependent agent calls, and run only independent assignments in parallel.
- Retain the workflow run and agent identities as the assignment's coordination pointers. Use the workflow progress view and per-agent results for status, blockers, and completion.
- End the run at any decision that needs principal input. Return the question or blocker in the agent result, obtain the answer in the spawning session, then start a follow-up run with that answer in its packet; workflows do not accept mid-run user input.
- Stop an unfinished run through the harness workflow controls when its assignments are abandoned. A completed run needs no cleanup; preserve reusable workflow definitions unless the assignment created one solely for itself.

Use this manifest for the profile:

```json
{
  "mechanism": "harness-native",
  "launchable_agents": ["claude"],
  "isolation": false,
  "communication": "Launch a Claude Workflow with one agent per Crew assignment, delivering each packet spec unchanged and applying its selected model and effort; Workflow progress and per-agent results carry status, blockers, questions, and completion to the spawning session, and principal input starts a follow-up run.",
  "retire": "Stop an unfinished run through the harness workflow controls; completed runs require no cleanup, and reusable workflow definitions remain in place.",
  "extras": {}
}
```

**Complete when:** every assignment has its own packet-backed workflow agent running its selected model and effort; the workflow script either omits `agentType` or identifies an intentionally selected type from the current registry without deriving it from packet fields; dependency order exists once in the script; the run and agent identities are retained; and any principal decision is a boundary between runs.

For another native harness, define a profile that names its strongest matching coordination facility and maps packet fields to that facility's API. Deliver the packet's `spec` unchanged and retain the facility's coordination pointers.

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

Anything satisfying the manifest—a renamed or extended harness, tmux sessions, cloud sessions, another orchestrator. Store the manifest in configuration as `mechanism.manifest`; the mechanism's `communication` string must name its launch, delivery, and reporting procedures, while `retire` names cleanup. Write both so a cold agent can execute them. This is also how to pin a custom harness to a preferred native facility when capability discovery would be ambiguous:

```json
{
  "version": 1,
  "mechanism": {
    "id": "my-workflow-harness",
    "manifest": {
      "mechanism": "my-workflow-harness",
      "launchable_agents": ["claude", "codex", "grok"],
      "isolation": false,
      "communication": "Launch the harness Workflow facility with one agent per Crew assignment, delivering each packet spec unchanged and applying its selected model and effort; its workflow view and per-agent results carry status, blockers, questions, and completion to the spawning session, and principal input starts follow-up work.",
      "retire": "Stop unfinished workflow runs through the harness; completed runs require no cleanup.",
      "extras": {}
    }
  }
}
```

Custom Workflow profiles apply the Workflow field mapping above. Their `launchable_agents` values use the capability vocabulary defined under Mechanism manifests; provider/model reachability affects routing and gating, not `agentType`.

## Work-record adapters

The adapter names the tracker; `--work-ref <adapter>:<ref>` points a packet at an existing contract, `--request` plus `--work-record <adapter>` bootstraps the first one.

| Adapter | Record | Example ref |
| --- | --- | --- |
| `beads` | Beads issue via `bd` | `beads:abc123` |
| `github` | GitHub issue via `gh` | `github:#42` |
| `file` | In-repo document | `file:docs/tasks/shell-palette.md` |
| `none` | The verbatim request is the whole contract | — |

Any other tracker the project uses (an MCP tracker, another CLI) is a valid adapter token; the project's own docs define how to read and write it. Whatever the adapter, the role contracts' rule is constant: durable contracts, results, and remaining work live in the work record when one exists; with `none`, they flow to the principal.
