# Crew's Orca boundaries

Read when Orca launches, supervises, or retires Crew assignments. Resolve the executable through `orca-cli`; load its current `orchestration` guide with `skills get orchestration`. That guide owns command syntax, lifecycle authority, and recovery. The rules below scope Crew's use of those operations.

## Launch and placement

Keep the assignment's principal and supervision mode. A supervised owner needs a correlated result channel; a direct-to-user handoff is an explicit ownership transfer. An unsupported reporting relationship is a capability gap to report, not permission to transfer supervision to the user.

Apply **Choose execution and placement** in `SKILL.md`. `worker-start --worktree current` and a fresh terminal in the selected existing checkout are valid placements. Custom model/effort arguments do not require a new worktree. Prefer `worker-start` when its launch preferences can express the routed tuple.

If Orca's wrapper rejects a model/effort combination that the selected agent supports, read the current guide's custom-argv procedure. Reuse the gate-checked decision and selected workspace, launch the exact tuple through the supported terminal path, and attach with `worker-start --terminal` when supported. A wrapper's model catalogue is not proof of a model limitation; neither is a printed command proof that the tuple was honored. Inspect the failure receipt and existing assignment before retrying, so a partial launch cannot create a duplicate owner.

**Complete when:** the launch receipt identifies the owner and reporting channel, the routed tuple is honored, and created/reused resources and lifecycle ownership are recorded. If a supported low-level launch leaves its process unsupervised, record who must reclaim that process; a Dispatch alone does not grant process ownership.

## Startup-only screen exception

Orca's Codex TUI readiness detection has timed out at an already settled initial prompt. `--no-alt-screen` is a compatibility workaround, not a readiness guarantee. For an affected installation, use it on the custom Codex command while preserving the routed model and effort.

Use the structured readiness receipt first. If it fails at `agent_readiness` or `tui-idle` with the known startup symptom, a bounded `terminal read --screen` of that newly launched terminal may diagnose whether the initial prompt and requested model/effort are visible. This exception ends before the first task prompt is submitted. It does not authorize reading an active agent's work, inspecting the coordinator before sending a message, or post-dispatch `sleep`/screen checks described as "verify startup".

A screen observation does not turn a failed Dispatch into a successful one. Follow the receipt and the current guide's recovery procedure, preserving request IDs and ownership. If no supported recovery establishes readiness and dispatch, report the launch failure.

Retest the workaround only when the Orca/Codex version pair changes: once in a temporary terminal before task injection, using the structured readiness check and the same bounded diagnostic if needed. Record the version pair and result privately for reuse across assignments, close the probe terminal, and retire the workaround only after the unflagged supported launch succeeds. Do not perform a probe for every Worker on the same version pair.

**Complete when:** startup is proven through the supported launch procedure or explicitly failed, and no screen polling continues after task submission.

## Supervision and recovery

Use Dispatch mail, work records, and structured lifecycle state under **Communicate and wait** in `SKILL.md`. Inspect the current Run's expected Dispatches through `worker-list` when recovery is needed. A progress question to an owner is a message; an acknowledgement is a correlated reply, not text inferred from its screen. Use the documented wake or blocking wait with one collector per inbox. Process each delivered message before acknowledging the batch; do not parse for a few keywords and discard the rest. Protocol-required heartbeats remain liveness data and need no unchanged-progress summary.

`worker-read` remains available as a bounded recovery diagnostic for a specific Dispatch: for example, a receipt directs inspection, or structured state cannot reconcile an apparently ended turn with a missing completion. Read only enough to resolve that discrepancy. A paused, quiet, or unreachable agent is not proved dead. Stop, abandon, retry, or release only on the evidence and authority the current mechanism guide requires. Repeated routine transcript sampling is not recovery.

**Complete when:** expected Dispatches have explicit outcomes or an owned recovery action, delivered batches are acknowledged, and pending work retains a result collector. Apply **Retire an owner** in `SKILL.md` after settlement, including worktree and branch disposition beyond terminal release.
