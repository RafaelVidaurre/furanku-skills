# Setup and configuration

Read this file when a project has no Commander configuration, when the user asks to reconfigure it, or when the selected mechanism is unavailable.

## Contents

- [Configuration locations](#configuration-locations)
- [Configuration and reuse](#configuration-and-reuse)
- [Agent-driven setup](#agent-driven-setup)
- [Optional deep diagnostics](#optional-deep-diagnostics)
- [Changing a configured mechanism](#changing-a-configured-mechanism)

## Configuration locations

Use XDG paths when their environment variables are set; the defaults below show their expanded locations.

| Purpose | Default location |
| --- | --- |
| Machine-global reusable defaults | `~/.config/furanku-skills/commander/config.yaml` |
| Machine-local project settings | `~/.config/furanku-skills/commander/projects/<project-key>.yaml` |
| Repository project settings | `<project-root>/.furanku-skills/commander/config.yaml` |
| Private runtime state | `~/.local/state/furanku-skills/commander/projects/<project-key>/` |

When a namespaced path is absent, read the corresponding legacy `~/.config/commander/`, `~/.local/state/commander/`, or `<project-root>/.commander/config.yaml` path as a compatibility source. Propose migration before writing: preserve active-job ledger locations, write future configuration and new-job state under `furanku-skills/commander/`, and offer to remove obsolete legacy files only after the namespaced copy is verified.

Apply the precedence defined in `SKILL.md`. Merge maps recursively. A higher layer replaces a worker role's candidate list or the entire project `mechanism` block when it defines one; it does not append fragments. Current-run overrides remain ephemeral unless the user asks to save them.

For compatibility, normalize each layer before merging: read `roles.sargeant` as `roles.sergeant` when that layer lacks the canonical key. On an authorized save, write the resolved list under `roles.sergeant` and remove the legacy key.

The agent on which the user invokes this skill is Commander. Candidate discovery, readiness checks, and selection cover only Captain and Sergeant workers. Treat a legacy `roles.commander` entry as obsolete: ignore it during resolution and remove it on an authorized save.

A project-specific file in either project location selects the mechanism by name. The repository file is suitable for shared policy; the machine-local project file is suitable for private paths, project identifiers, and preference differences. Store credentials in the harness's credential store or environment.

Derive `<project-key>` from the canonical Git common directory when one exists, otherwise from the canonical project root. Use a stable short hash so sibling Git worktrees share machine-local preferences while unrelated roots do not collide. Keep the human-readable `project.id` inside configuration.

## Configuration and reuse

Machine-global configuration holds reusable mechanism recipes, worker rosters, and defaults. A named mechanism profile describes how to launch, observe, follow up, complete, and recover work; it does not select that mechanism for every project.

```yaml
version: 1

mechanisms:
  <mechanism-name>:
    instructions: >-
      Use its live entrypoint. Launch jobs in the background, retain stable job
      and worker IDs, observe questions and completion, and recover through the
      same interface.

roles:
  captain:
    - harness: <harness-command>
      model: <last-known-good-model>
      effort: <configured-effort>
      use_for: Deep design and coordination across dependent workers.
  sergeant:
    - harness: <harness-command>
      model: <last-known-good-model>
      effort: <configured-effort>
      use_for: Concrete delivery with the required tools and domain strength.

coordination:
  max_parallel_agents: 12
```

A project layer selects one profile and may override portable instructions or worker settings:

```yaml
version: 1
project:
  id: example-project

mechanism:
  name: <mechanism-name>
```

`max_parallel_agents` is the maximum number of simultaneously active Captains and Sergeants. A positive integer sets the ceiling; `null` means Commander imposes no ceiling. When no layer defines the field, propose `12`; write a project override only when the project should differ from the machine default. No Commander ceiling still respects provider, mechanism, workspace, and ownership constraints.

Mechanism instructions and worker entries are last-known-good recipes, not availability guarantees. Reuse them across projects and sessions without expiring them based only on age. A project-specific mechanism recipe from another local project may seed a reusable machine profile after removing project paths and identifiers. A project override wins when its environment genuinely differs.

`use_for` is short suitability prose, not a controlled vocabulary. `model` and `effort` may be omitted to use the harness default. Preserve user-defined fields.

## Agent-driven setup

Ask decisions one at a time and give a recommendation grounded in discovered evidence. Inspect facts directly, reuse confirmed machine-level settings, and ask only for unresolved choices.

### 1. Establish the project and reusable settings

Find the project root, local agent instructions, existing Commander files, adopted work tracker, workspace isolation facilities, and active uncommitted state. Resolve a prior project ID before proposing a new one. Read the machine-global worker roster and named mechanism profiles before inspecting other harnesses or project configs.

When a reusable profile is missing, inspect existing local Commander project files for a matching mechanism recipe. Reuse only portable instructions; derive this project's paths and IDs from its own live state.

**Complete when:** the root and project identity are unambiguous, every applicable configuration layer has been read, and reusable machine settings have been separated from project-specific values.

### 2. Propose and confirm the setup

Present the resolved values and ask the user to decide:

1. the single mechanism this project will use;
2. whether shared fields belong in the repository file and private substitutions in the machine-local project file;
3. any Captain or Sergeant overrides and their short `use_for` prose;
4. whether to cap simultaneous Captains and Sergeants, recommending `12`, or set `max_parallel_agents: null` for no Commander-imposed maximum.

Always obtain the concurrency choice before saving unless the user already supplied it in the current run. Do not silently convert a recommendation into configuration.

**Complete when:** the user has confirmed one project mechanism, storage destinations, worker overrides, and either a positive concurrency maximum or no Commander maximum.

### 3. Run cheap readiness checks

Readiness checks are side-effect-free and limited to the selected configuration:

- confirm the selected mechanism command exists and its status or help interface responds;
- confirm the current project, workspace, or Commander session can be identified when the mechanism requires it;
- confirm each selected harness command exists, using a local version or authentication-status command only when it does not invoke a model;
- keep runtime queries scoped and bounded so unrelated global tasks, terminals, or worktrees do not enter context.

Do not launch agents, create orchestration tasks, send model prompts, write nonce files, or test every fallback during setup. Model access, quota, permissions, and lifecycle behavior are established by real dispatches and handled through the normal recovery path if they fail.

**Complete when:** the mechanism entrypoint responds, the current project/session is addressable, and every primary worker command is present or has a configured fallback.

### 4. Save and use the setup

Show the intended writes, preserve unrelated configuration, and save after confirmation. Create private runtime state outside the project. Do not run a synthetic end-to-end dispatch after saving; the first real job supplies useful work and live evidence at the same time.

**Complete when:** a project layer selects exactly one reachable mechanism, the confirmed worker roster and concurrency choice resolve unambiguously, and no setup worker or disposable artifact was created.

## Optional deep diagnostics

Run a synthetic Captain-to-Sergeant lifecycle test only when the user explicitly requests deep mechanism diagnostics. Ordinary startup, model, quota, permission, messaging, and completion failures use the recovery rules in `SKILL.md`; they do not trigger periodic or per-project requalification.

## Changing a configured mechanism

Mechanism selection is per project. If it becomes unavailable, preserve active-job evidence and continue unaffected conversation work. Explain the failure and obtain the user's approval before replacing the project `mechanism` block. Apply the cheap readiness checks to the approved replacement, then create a traceable continuation for each affected job with new backend identity linked to the prior worker and evidence.
