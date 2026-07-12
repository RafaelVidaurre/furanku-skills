# Setup and configuration

Read this file when a project has no Commander configuration, when the user asks to reconfigure it, or when the selected mechanism is unavailable.

## Contents

- [Configuration locations](#configuration-locations)
- [Project configuration](#project-configuration)
- [Agent-driven setup](#agent-driven-setup)
- [Changing a configured mechanism](#changing-a-configured-mechanism)

## Configuration locations

Use XDG paths when their environment variables are set; the defaults below show their expanded locations.

| Purpose | Default location |
| --- | --- |
| Machine-global defaults | `~/.config/commander/config.yaml` |
| Machine-local project settings | `~/.config/commander/projects/<project-key>.yaml` |
| Repository project settings | `<project-root>/.commander/config.yaml` |
| Private runtime state | `~/.local/state/commander/projects/<project-key>/` |

Apply the precedence defined in `SKILL.md`. Merge maps recursively. A higher layer replaces a role's candidate list or the entire `mechanism` block when it defines one; it does not append fragments. Current-run overrides remain ephemeral unless the user asks to save them.

For compatibility, normalize each layer before merging: read `roles.sargeant` as `roles.sergeant` when that layer lacks the canonical key. On an authorized save, write the resolved list under `roles.sergeant` and remove the legacy key.

A project-specific file in either project location is required, and its resolved `mechanism` block must originate at a project layer rather than only from global defaults. The repository file is suitable for shared policy; the machine-local project file is suitable for private harness, model, path, and preference differences. Store credentials in the harness's credential store or environment.

Derive `<project-key>` from the canonical Git common directory when one exists, otherwise from the canonical project root. Use a stable short hash so sibling Git worktrees share machine-local preferences while unrelated roots do not collide. Keep the human-readable `project.id` inside configuration.

## Project configuration

YAML keeps suitability and mechanism guidance easy to edit. Preserve user-defined fields. The `mechanism` block belongs in a project layer; machine-global configuration supplies reusable role defaults.

```yaml
version: 1
project:
  id: example-project

mechanism:
  name: <qualified-mechanism>
  instructions: >-
    Use its verified live entrypoint. Launch jobs in the background, retain stable
    job and worker IDs, observe questions and completion, and recover through the
    same interface.

roles:
  commander:
    - harness: <verified-harness>
      model: <verified-model>
      effort: <verified-effort>
      use_for: Consequential orchestration decisions and final acceptance.
  captain:
    - harness: <verified-harness>
      model: <verified-model>
      effort: <verified-effort>
      use_for: Deep design and coordination across dependent workers.
  sergeant:
    - harness: <verified-harness>
      model: <verified-model>
      effort: <verified-effort>
      use_for: Concrete delivery with the required tools and domain strength.

coordination:
  max_parallel_agents: 3
```

Mechanism instructions name the live entrypoint, non-blocking launch, stable identity and status source, question and follow-up flow, completion signal, and stop or recovery operation. `use_for` is short suitability prose, not a controlled vocabulary. A candidate always names its harness; `model` and `effort` may be omitted to use a verified harness default. Populate role candidates only from live authentication, model, effort, and tool probes; users may configure any qualified harness.

Choose a stable, human-readable project ID, preferring an ID already present in repository configuration. The private project key handles machine path matching; the project ID names the project in reports and shared configuration.

The current agent already occupies the Commander role. If its known identity differs from the confirmed roster, explain the difference and ask whether to continue this session or relaunch with a roster candidate.

## Agent-driven setup

Ask decisions one at a time and give a recommendation grounded in discovered evidence. Inspect facts directly. When the machine-global file is absent, setup also proposes reusable role candidates from this machine's live harnesses. Global setup establishes defaults; every project still selects and qualifies its mechanism.

### 1. Establish the project

Find the project root, local agent instructions, existing Commander files, adopted work tracker, workspace isolation facilities, and active uncommitted state. Resolve a prior project ID before proposing a new one.

**Complete when:** the root and project identity are unambiguous and every existing configuration layer has been read.

### 2. Discover mechanisms and role candidates

Inspect the available tool and skill catalog, commands on `PATH`, relevant project tooling, and locally installed documentation. Consider raw headless harness commands, orchestration systems, built-in agent controls, terminal managers, APIs, and mechanisms not named by this skill. Run each candidate's help or inspection command before forming invocation syntax.

For each role harness, discover valid model IDs, effort controls, authentication state, permissions, and required tools from its live interface. A binary on `PATH` is a lead; a live probe establishes usability.

**Complete when:** every proposed mechanism and role candidate names its live interface, supported invocation, and exact probe to run.

### 3. Qualify mechanisms

A mechanism qualifies only when a disposable probe demonstrates all of these capabilities:

- launch a role-specific worker with a complete brief and the intended authority;
- return control to Commander after startup;
- provide stable worker and job identity;
- distinguish running, completed, failed, and stopped work;
- capture a completion report and diagnostic output;
- deliver a follow-up or resume a blocked job without losing its prior context;
- stop or recover a worker without creating an untracked duplicate;
- support a Captain coordinating child Sergeants, directly or through the same persistent task system.

Launch a Captain that dispatches one Sergeant; have the Sergeant create a nonce file in a disposable workspace and return an exact report, then have the Captain consolidate it. Observe the job independently and remove the worker, file, workspace, and transient task state. Test every proposed role candidate with the cheapest credible prompt. Treat a timeout as inconclusive until mechanism liveness has been inspected.

**Complete when:** every mechanism offered to the user has passed the end-to-end probe, every role candidate has passed a liveness probe, and all disposable state is removed.

### 4. Propose, then ask

Present the evidence-backed recommendation and ask the user to decide:

1. the reusable machine-global role roster, when it is not already confirmed;
2. the single mechanism this project will use;
3. whether shared fields belong in the repository file and private substitutions in the machine-local project file;
4. any project role overrides and their short `use_for` prose;
5. the maximum number of simultaneously active Captains and Sergeants.

Derive the concurrency recommendation from mechanism capacity, quotas, project isolation, and likely work; use a conservative value when those are unknown. Reuse machine-global answers and discovered project facts.

**Complete when:** the user has confirmed applicable global defaults, one project mechanism, storage destinations, role candidates, and a concurrency limit.

### 5. Save and prove the setup

Show the intended writes, preserve unrelated configuration, and save after confirmation. Create private runtime state outside the project. Then run one end-to-end, read-only dispatch through the selected mechanism and reconcile its completion into the private ledger.

**Complete when:** a project layer defines exactly one mechanism, every configured role has a live candidate, the read-only dispatch passes, and no disposable worker or artifact remains active.

## Changing a configured mechanism

Mechanism selection is per project. If it becomes unavailable, preserve active-job evidence and continue unaffected conversation work. Explain the failure and obtain the user's approval before replacing the `mechanism` block. Qualify the approved replacement, then create a traceable continuation for each affected job with new backend identity linked to the prior worker and evidence.
