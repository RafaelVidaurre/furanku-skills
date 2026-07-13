# Orca mechanism guide

Read this file when setup is evaluating Orca or the project's selected mechanism instructions name Orca.

Orca is one configured mechanism example. Use its orchestration task and dispatch state for supervised Commander jobs; terminal or worktree prompt handoffs alone transfer ownership and therefore do not satisfy this skill's completion tracking.

## Contents

- [Readiness](#readiness)
- [Reconcile state](#reconcile-state)
- [Create and dispatch work](#create-and-dispatch-work)
- [Worker and Captain lifecycle](#worker-and-captain-lifecycle)
- [Completion](#completion)
- [Liveness and recovery](#liveness-and-recovery)

## Readiness

Reuse the machine-level Orca recipe and confirm only the current runtime surface:

```sh
command -v orca
orca status --json
orca orchestration --help
orca worktree current --json
orca terminal show --json
```

On Linux the executable may be `orca-ide`; store the resolved command in reusable machine instructions. Readiness passes when the runtime responds, orchestration commands are available, and the current Commander terminal can be identified. Do not create a task, terminal, worktree, or worker during readiness checks.

## Reconcile state

At the start and end of each Commander interaction, check only lifecycle events addressed to Commander:

```sh
orca orchestration check --terminal <commander-handle> --unread --types worker_done,escalation,decision_gate --json
```

When inheriting or recovering a job, verify its concrete dispatch:

```sh
orca orchestration dispatch-show --task <task-id> --json
```

Orca task state is authoritative for dispatch ownership; Commander's private ledger holds the user outcome, acceptance criteria, and links to task and dispatch IDs. Inspect known jobs with `dispatch-show`. Use a filtered task listing only to recover missing ledger links, and keep the filter narrow enough that unrelated runtime-global state does not enter context. A Captain running as a separate background agent may use bounded rolling waits while supervising its children.

## Create and dispatch work

Create one task for each delivery boundary and use dependencies or a parent ID for the ownership tree:

```sh
packet_file=<absolute-command-packet-path>
orca orchestration task-create --spec "$(cat "$packet_file")" --json

child_packet_file=<absolute-child-command-packet-path>
orca orchestration task-create --spec "$(cat "$child_packet_file")" --parent <captain-task-id> --deps '<json-array>' --json
```

Choose the workspace independently from the role:

- Use a fresh terminal in the current worktree when the job needs current uncommitted state or must remain in that checkout.
- Use an isolated worktree for independent modifying work.
- Use the project or mechanism's equivalent non-Git workspace for other work types.

Current-worktree worker:

```sh
orca terminal create --worktree active --title <job-name> --command '<configured-agent-command>' --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca orchestration dispatch --task <task-id> --to <handle> --inject --json
```

Isolated worker with the harness's default agent command:

```sh
orca worktree create --name <job-name> --agent <agent-id> --json
orca terminal list --worktree id:<worktree-id> --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca orchestration dispatch --task <task-id> --to <handle> --inject --json
```

When a model or effort needs a custom launch command, create the worktree without `--agent`, then create a terminal in it using the configured command. Orca lineage and Git base are separate choices: use child lineage for stacked/dependent work and `--no-parent` for independent work; choose the base branch from project intent rather than lineage.

`dispatch --inject` is preferred for recognized agent CLIs because it supplies live task, dispatch, assignee, coordinator, messaging, and completion instructions. For a bare shell or unrecognized CLI, use the project-configured manual preamble and prompt delivery through `orca terminal send`.

The dispatch is recorded when the dispatch command succeeds and this targeted read confirms its identity:

```sh
orca orchestration dispatch-show --task <task-id> --json
```

## Worker and Captain lifecycle

An injected worker uses the concrete coordinator handle and IDs from its current preamble. It sends questions with `orca orchestration ask`, liveness only when requested, and exactly one `worker_done` for the dispatch. Lifecycle messages target the concrete coordinator, not a group.

A Captain creates child tasks with its own task as `--parent`, dispatches ready Sergeants, and waits in its background terminal for `worker_done`, `escalation`, or decision events. It sends Commander one consolidated `worker_done` only after every required child is accounted for. Task IDs and dispatch IDs remain in the Captain completion report.

When a worker asks a material question, Commander reads the `decision_gate` message, obtains the user decision if needed, and replies to that same message:

```sh
orca orchestration reply --id <message-id> --body <answer> --json
```

## Completion

Accept `worker_done` only when its payload matches the live task, dispatch, and assignee. Read the completion report and evidence, then set the Orca task result with the task ID:

```sh
orca orchestration task-update --id <task-id> --status completed --result '<json-result>' --json
```

Use `failed` or `blocked` only when the corresponding outcome is established. A review-only worker retains read-only authority and reports findings. Commander closes the top-level private job only after its acceptance criteria and all Orca child tasks are reconciled.

## Liveness and recovery

An empty non-blocking check establishes only that no event arrived. Keep ownership unchanged and inspect task state and terminal evidence:

```sh
orca terminal show --terminal <handle> --json
orca terminal read --terminal <handle> --limit 200 --json
orca orchestration dispatch-show --task <task-id> --json
```

Structured escalation, terminal exit, authentication output, model errors, or quota/usage messages determine the failure class. A live terminal with ongoing activity retains ownership.

If a worker is proven lost, preserve its worktree, mark the failed dispatch, create a continuation task or redispatch according to the live Orca interface, and give the replacement the prior task IDs and workspace state. Inventory a lost Captain's child dispatches before replacement so live Sergeants retain ownership.

Stop or close a worker only through its concrete terminal identity:

```sh
orca terminal close --terminal <handle> --json
```

Use `orca orchestration reset` only when the user explicitly abandons all affected runtime-global orchestration state.
