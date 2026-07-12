# Setup and configuration

Read this file when a project has no Commander configuration, when the user asks to reconfigure it, or when the selected mechanism no longer qualifies.

## Configuration locations

Use XDG paths when their environment variables are set; the defaults below show their expanded locations.

1. Machine global: `~/.config/commander/config.yaml`
2. Machine-local project: `~/.config/commander/projects/<project-key>.yaml`
3. Repository project: `<project-root>/.commander/config.yaml`
4. Runtime state: `~/.local/state/commander/projects/<project-key>/`

Current user instructions override machine-local project fields, which override repository project fields, which override machine-global fields. Merge maps recursively. A higher layer replaces a role's candidate list or the entire `mechanism` block when it defines one; it does not append fragments to them. Current-run overrides remain ephemeral unless the user asks to save them.

A project-specific file at location 2 or 3 is required, and its resolved `mechanism` block must originate at one of those project layers rather than only from global defaults. The repository file is suitable for shared policy; the machine-local project file is suitable for private harness, model, path, and preference differences. Store credentials in the harness's credential store or environment, not Commander configuration.

Derive `<project-key>` from the canonical Git common directory when one exists, otherwise from the canonical project root. Use a stable short hash so sibling Git worktrees share machine-local preferences while unrelated roots do not collide. Keep the human-readable `project.id` inside configuration.

## Minimal project shape

YAML keeps free-form suitability and mechanism guidance easy to edit. Preserve user-defined fields. The `mechanism` block belongs in a project layer; omit it from machine-global defaults.

```yaml
version: 1
project:
  id: example-project

mechanism:
  name: Example orchestrator
  instructions: >-
    Use the installed Example CLI. Launch jobs detached, keep its task ID,
    read completion events, and stop a job through the same CLI.

roles:
  commander:
    - harness: codex
      model: gpt-5.6-sol
      effort: high
      use_for: Strongest default for consequential orchestration decisions.
  captain:
    - harness: claude
      model: claude-fable-5
      effort: high
      use_for: Deep product and technical design with several dependent workers.
  sargeant:
    - harness: codex
      model: gpt-5.6-sol
      effort: high
      use_for: Feature development and demanding implementation work.

coordination:
  max_parallel_agents: 3
```

`use_for` is short prose, not a controlled vocabulary. Users may add any harness, model, effort value, or suitability explanation that reflects their work. Mechanism instructions are also short prose: name the live entrypoint, how to launch without blocking, where identity and status come from, how questions and follow-ups flow, how completion is observed, and how a worker is stopped or recovered.

Choose a stable, human-readable project ID during setup. Prefer an ID already present in repository configuration. The private project key handles machine path matching; the project ID names the project in reports and shared configuration.

## Seed recommendations

Treat these as proposal seeds. Recommend only combinations that pass the installed harness's real model and liveness checks.

```yaml
roles:
  commander:
    - harness: codex
      model: gpt-5.6-sol
      effort: high
      use_for: Default when orchestration quality and judgment matter most.
    - harness: grok
      model: grok-4.5
      effort: high
      use_for: Faster orchestration loops when Commander latency is the bottleneck.
    - harness: claude
      model: claude-fable-5
      effort: high
      use_for: Fallback when the preferred Commander candidates are unavailable.
  captain:
    - harness: claude
      model: claude-fable-5
      effort: high
      use_for: Deep product and technical design where latency is secondary.
    - harness: codex
      model: gpt-5.6-sol
      effort: max
      use_for: Maximum-effort technical decomposition and coordination.
  sargeant:
    - harness: codex
      model: gpt-5.6-sol
      effort: high
      use_for: Feature development and strong coding throughput.
    - harness: grok
      model: grok-4.5
      effort: high
      use_for: Bug fixes and simple, quick delivery work.
```

Add candidates for research, image generation, model generation, operations, or other project work when live tools make them credible. The current agent already occupies the Commander role; if its identity is known and differs from the confirmed roster, explain the difference and let the user decide whether to continue this session or relaunch. Never attempt a silent mid-conversation Commander replacement.

## Agent-driven setup

Ask decisions one at a time and give a recommendation grounded in what was discovered. Inspect facts instead of asking the user to recite them.

When the machine-global file is absent, setup also proposes reusable role candidates from this machine's live harnesses. Global setup establishes defaults; every project still selects and qualifies its own mechanism.

### 1. Establish the project

Find the project root, local agent instructions, existing Commander files, adopted work tracker, workspace isolation facilities, and any active uncommitted state. Resolve a prior project ID before proposing a new one.

Complete this step when the root and project identity are unambiguous and every existing configuration layer has been read.

### 2. Discover mechanisms and role candidates

Inspect the available tool and skill catalog, commands on `PATH`, relevant project tooling, and locally installed documentation. Consider raw headless harness commands, Orca, built-in agent controls, terminal managers, APIs, and mechanisms not named by this skill. Run each candidate's help or inspection command before forming invocation syntax.

For each role harness, discover valid model IDs and effort controls from the live CLI or provider. A binary on `PATH` is only a lead; authentication and model access still require a probe.

Complete this step when every proposed mechanism and role candidate names the live interface from which its recommendation came.

### 3. Qualify mechanisms

A mechanism qualifies only if the agent can demonstrate or directly verify all of these capabilities:

- launch a role-specific worker with a complete brief and the intended authority;
- return control to Commander after startup;
- provide stable worker and job identity;
- distinguish running, completed, failed, and stopped work;
- capture a completion report and diagnostic output;
- deliver a follow-up or resume a blocked job without losing its prior context;
- stop or recover a worker without creating an untracked duplicate;
- support a Captain coordinating child Sargeants, directly or through the same persistent task system.

Use a disposable end-to-end test. Launch a Captain that dispatches one Sargeant; have the Sargeant create a nonce file in a disposable workspace and return an exact report, then have the Captain consolidate it. Observe the job independently and remove the worker, file, workspace, and transient task state. This proves nested coordination, writable-worker authority, completion, and cleanup without touching the project. Test the remaining proposed model and effort combinations with the cheapest credible prompt. A timeout alone is inconclusive; inspect mechanism liveness before failing the probe.

Complete this step when every mechanism offered to the user has passed the live test and every failed candidate has a concrete reason.

### 4. Propose, then ask

Present the evidence-backed recommendation and ask the user to decide:

1. the reusable machine-global role roster, when it is not already confirmed;
2. the single mechanism this project will use;
3. whether shared fields belong in the repository file and private substitutions in the machine-local project file;
4. any project role overrides and their short `use_for` prose;
5. the maximum number of simultaneously active Captains and Sargeants.

Derive the parallelism recommendation from mechanism capacity, available quotas, project isolation, and the likely work; use a conservative value when those are unknown. Reuse machine-global answers and project facts rather than asking them again.

Complete this step when the user has confirmed applicable global defaults, one project mechanism, storage destinations, role candidates, and a concurrency limit.

### 5. Save and prove the setup

Show the intended writes, preserve unrelated configuration, and save only after confirmation. Create private runtime state outside the project. Then run one end-to-end, read-only dispatch through the selected mechanism and reconcile its completion into the private ledger.

The project is set up when a project layer defines exactly one mechanism, every configured role has at least one live candidate, the end-to-end dispatch passes, and no disposable worker remains active.

## Changing a configured mechanism

Mechanism selection is per project. If it becomes unavailable, keep active job evidence and continue unaffected conversation work. Explain the failure and ask the user before replacing the `mechanism` block. After approval, qualify the replacement and create a traceable continuation for each affected job; never describe a new backend's worker as the original worker.
