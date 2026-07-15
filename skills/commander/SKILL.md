---
name: commander
description: Coordinate Beads work through Orca with distinct Commander, Captain, and Worker roles and configured model-effort routing. Use only when the user explicitly invokes Commander to deliver, supervise, resume, configure, or report on multi-agent project work.
---

# Commander

Commander is a thin policy layer over **Beads** and **Orca**. Use the installed `bd` CLI directly for Beads, and use the installed `orca-cli` and `orchestration` skills for Orca coordination workflows. The required dependencies are the `bd` executable, an Orca CLI executable supported by `orca-cli`, and those two Orca skills. Report an actual missing dependency instead of replacing it.

## Resolve routing first

Before selecting or dispatching work, use Python 3.8 or newer (`python3` below, or the host equivalent) to run:

```sh
python3 <commander-skill-dir>/scripts/config.py resolve --repo <repository-root>
```

A valid machine-global config is required. If it is absent or invalid, read [Configuration](references/configuration.md) and complete the guided global setup with the user. Use the same guide when the user asks to create, edit, or delete a config. Dispatch begins only after resolution succeeds.

Routing priority is:

1. the user's current invocation;
2. machine-local for this repository;
3. repository-local and Git-tracked;
4. machine-global.

The current invocation is ephemeral: it may replace routes or add constraints for this run; persist it only when the user separately asks to edit a config. The script merges persisted layers in reverse order. A higher layer replaces a whole route with the same ID and extends the table with new IDs. It never mixes fields from two model-effort combinations.

## Responsibilities

| Role | Work |
| --- | --- |
| Commander | Orchestrates work, remains accountable for acceptance, mutates Beads, and is the sole interactor with the user. |
| Captain | Owns architecture, systems design, requirement synthesis, decomposition, final delivery and integration, and high-complexity or high-risk reviews. |
| Worker | Owns bounded grunt work, implementation, coding, testing, and regular reviews. |

For each Bead, Commander chooses a direct Worker or one Captain. Commander supervises direct Workers and Captains, never a Captain's children. A Captain creates and supervises its own Worker tasks, integrates their results, and reports one delivery to Commander. Workers do not delegate. Only Commander mutates Beads or accepts the user outcome.

## Route work

The required base route IDs are `commander`, `captain`, and `worker`. Optional specialist IDs extend one base role, such as `captain.security-review` or `worker.testing`.

1. Choose the role from the responsibility boundary, then the most specific configured specialist whose `work` description fits. Use the base route when no specialist fits.
2. Apply the user's current-run replacements and constraints.
3. Use the route's exact `agent`, `model`, and `effort`; infer no capability or cost from model names and invent no fallback.
4. Record the route ID and actual combination in the Orca task before dispatch. Captains apply the resolved Worker table to child tasks.

If multiple specialist routes fit and select different combinations, ask the user to choose for this run. If a selected combination is unavailable, report it and wait for a user-approved current-run replacement or config change.

The active Commander never switches its own model silently. If its actual combination differs from the resolved `commander` route and the user has not already overridden it for this run, surface the mismatch before dispatching paid model work.

A resolved route authorizes ordinary model calls only for the user's scoped work. It never authorizes provider usage, reset, credit, account, or billing controls.

## System boundaries

| Layer | Owns |
| --- | --- |
| Beads | Durable outcomes, acceptance criteria, dependencies, claims, blockers, and completion state |
| Orca | Worktrees, terminals, tasks, dispatches, messages, gates, liveness, retry context, and `worker_done` provenance |
| Commander | Outcome selection, role and configured-route selection, concurrency, review depth, acceptance judgment, and the user report |

Choose implementation and validation tools from the work's authoritative surface. Local page interaction, visual QA, and screenshots use the available browser-control skill or tool. Orca's embedded browser applies when the user explicitly requests it or Orca browser-tab state is itself under test.

A run owns an explicit set of Bead IDs. Put the Bead ID in each related Orca task and inspect only those task and dispatch IDs because Orca orchestration state is runtime-global. Treat `bd ready` as dependency-unblocked, then apply repository guidance, acceptance criteria, ownership, and human gates before dispatch.

Use Orca handoff, then stop supervising, when the user transfers full ownership. Commander remains accountable for every outcome it continues to supervise.

## Human-only usage boundary

Only the human operator may interact with usage, quota, reset, credit, login, account, subscription, plan, or billing controls. Agents report ordinary capacity or authentication errors and stop the affected work. A new combination requires an already-configured route or an explicit current-run choice from the user.

Include this line in every Orca task; Captains propagate it unchanged:

> OPERATOR-ONLY: Do not interact with usage, reset, credit, login, account, plan, subscription, or billing controls. If capacity is unavailable, report it and stop.

## Delivery loop

1. **Select.** Choose and claim the explicit Bead set. **Complete when:** every selected Bead is claimed or blocked on a named human decision.
2. **Route.** Resolve configuration, choose direct Worker or Captain, select exact route IDs, set exclusive boundaries, and choose the smallest useful concurrency. **Complete when:** every boundary has one owner and one recorded configured combination.
3. **Run.** Use Orca for dispatch, questions, waits, gates, recovery, and completion signals. Give each task its Bead ID, outcome, criteria, scope, evidence, constraints, route, and operator-only line. **Complete when:** every boundary is accepted, actively owned by one dispatch, or blocked on a named gate.
4. **Accept.** Compare delivered evidence with Bead criteria, return gaps through the same reporting line, then reconcile Beads and Orca. **Complete when:** both systems reflect accepted or blocked truth, no owned task is orphaned, and the user has one concise report.
