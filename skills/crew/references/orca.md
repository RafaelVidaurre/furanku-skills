# Orca

Crew's complete Orca procedure. Read when Orca launches, connects, or retires an assignment. Crew owns role, placement, and routing policy; the commands here implement it without loading another orchestration skill. Substitute placeholders with exact returned values. JSON results are under `result`. Consult the affected command's `--help` when its arguments or receipt differ from this procedure.

Resolve the executable once: use `ORCA_CLI_COMMAND` when supplied; otherwise `orca-dev` in an Orca dev environment exposing `ORCA_DEV_REPO_ROOT`, `orca-ide` on Linux outside Orca, or `orca` elsewhere. The examples use `orca`; preserve the resolved executable throughout, including worker instructions and recovery.

## Choose the launch

Apply **Choose execution and placement** in `SKILL.md`. A Captain may execute directly with zero Workers. A supervised assignment retains its `reports_to`; a full handoff transfers ownership to the named principal. Do not turn a supervised Captain into a user handoff because of a launcher's convenience recipe.

A **Run** holds tasks and the coordinator inbox; it is not a scheduler. A **Task** holds the work; a **Dispatch** is one authoritative attempt. Create a Run only when coordinating delegated work, and reuse it for that front. Copy the live injected preamble's authority exactly; old dispatch/session handles grant no authority to a new attempt.

Use `--worktree current` for the enclosing checkout or an exact selector for another existing checkout. Copy the entire `worktree.id` (`<repo-id>::<path>`) into `id:<worktree.id>`. Custom model arguments do not require a worktree. When isolation is justified, use `new-child` for stacked work or `new-top-level` for independent work. Specify the intended base for stacked changes; independent work uses the repository default unless the principal specifies otherwise. Creation flags such as `--name` and `--base-branch` belong only on new-worktree calls.

**Complete when:** mode, principal, workspace, and resource cleanup owner are recorded in the existing work record.

## Start a supervised assignment

Create the Run once, then launch each owner with its gate-checked tuple and unchanged packet spec:

```sh
orca orchestration run-create --objective "<front outcome>" --json
orca orchestration worker-start --run <runId> --spec "<packet spec>" --task-title "<summary>" --worktree current --agent <agent> --model <model> --effort <effort> --json
```

For dependent work, create the task with `task-create --run <runId> --spec "<packet spec>" --task-title "<summary>" --deps '["<taskId>"]' --json`. After prerequisites complete, start it with `--task <taskId>` instead of `--spec`. Keep dependency order in the Run rather than a second scheduler.

Read each launch receipt before another launch: success requires `state: ready`, exact task/dispatch IDs, and the intended `launch.effective`. Record created/reused resources from `effects`; name Crew terminals `<Role> - <summary>`. On failure, inspect `failedStage`, `residualResources`, and `recovery`. Reconcile an unknown mutation result before another start.

### Custom model arguments

`worker-start --model … --effort …` is the normal tuple interface. `worktree create --agent` has no equivalent per-call flags. For an agent the wrapper cannot parameterize, use the packet's expanded `launch_argv` / `launch_command` after resolving any `launch_warning`. Create one terminal in the selected workspace, wait for readiness, then attach it:

```sh
orca terminal create --worktree <selector> --title "<Role> - <summary>" --command '<exact routed command>' --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca orchestration worker-start --run <runId> --spec "<packet spec>" --task-title "<summary>" --worktree <selector> --terminal <handle> --json
```

Proceed only on `wait.satisfied: true`. `--terminal` cannot combine with `--model`/`--effort`; retain the actual command and tuple acceptance as evidence. The creator owns this external terminal even when the attached dispatch has managed lifecycle state.

**Complete when:** the task has an authoritative Dispatch, delivery has a receipt, and the intended model/effort and resource ownership are established. Input acceptance alone is not an acknowledgement or completion.

## Full handoff

A full handoff transfers the assignment and its resource ownership; it creates no coordinator Run or Task. Create the terminal and wait for `wait.satisfied: true` using **Custom model arguments** above, then send the packet instead of attaching a Dispatch:

```sh
orca terminal send --terminal <handle> --text "<packet spec>" --enter --wait-submit 10 --json
```

Report the exact workspace/terminal and receipt, transfer cleanup responsibility, and stop supervising. `accepted: true` proves input acceptance; `turn_started` is stronger submission evidence. A handoff does not require a fresh checkout. When one is justified, `worktree create --repo <selector> --name <slug> --no-parent --json` creates independent work; use `--parent-worktree current` and the intended base for stacked work.

**Complete when:** the receipt proves acceptance and the new owner, principal, and resource responsibility are recorded.

## Collect and answer mail

Use one collector per inbox. Inside Orca, use turn-end waiting when delivery wake is established: drain and acknowledge mail, record pending Dispatches, then end the turn. Orca's inbox notice wakes the next turn. An unacknowledged batch blocks subsequent notices; a duplicate notice with an empty inbox requires no further action.

Without a verified wake, hold one blocking call and resume that same command across harness yields:

```sh
orca orchestration check --run <runId> --wait --types worker_done,escalation,question --timeout-ms 900000 --json
```

Use a shorter timeout only when the active harness requires it. No parallel collectors or short polling loop. Handle the whole FIFO delivery: `--types` controls waking, not the contents returned. `--peek` and `--all` do not consume the inbox.

- `question` or `escalation`: resolve from the contract or escalate to the principal. Answer by exact message ID: `orca orchestration reply --id <messageId> --body "<answer>" --json`.
- `worker_done`: require the expected task/dispatch IDs and outcome, then verify the result against the contract. Orca settles the task; do not separately mark it completed.
- Status/heartbeat: act on meaningful changes; unchanged liveness needs no progress narrative.

Acknowledge each fully handled batch; this can return the next batch, which must also be handled:

```sh
orca orchestration check --run <runId> --ack <deliveryId> --json
```

Steer an existing owner with `orca orchestration send --to dispatch:<dispatchId> --subject "<summary>" --body "<guidance>" --json`. Enqueued mail does not prove the owner read it. Decisions and resource transfers requiring acknowledgement need an explicit correlated reply.

**Complete when:** the final acknowledgement returns `count: 0`, and every pending assignment still has a collector or verified wake.

## Worker lifecycle

Use the live preamble's executable and exact `--from`, task, dispatch, and capability arguments; copy its lifecycle commands rather than reconstructing authority from environment or older messages.

- Read steering at natural work checkpoints and before completion with the preamble's `check`; handle and acknowledge whole batches. A coordinator that also implements keeps servicing its own inbox at those checkpoints.
- Ask with `orca orchestration ask --question "<question>" --timeout-ms 600000 <preamble authority> --json`. On timeout, the question stays pending: continue with `--resume <messageId>` instead of creating another question. Follow the principal's actual reply.
- Send exactly one terminal report using the preamble's `send --type worker_done --outcome succeeded|failed`, including actual evidence, remaining work, and only files/report paths that exist. Then stop until a fresh assignment arrives. Send heartbeats only when the live protocol requires them; a blocked ask already supplies its own liveness.

**Complete when:** the outcome is accepted by Orca for the active Dispatch. `consumer_fenced` means authority ended; stop lifecycle writes rather than retrying stale credentials.

## Recover a discrepancy

Use the current Run's `worker-list --run <runId> --json` and the exact attempt's `worker-show --dispatch <dispatchId> --json`; follow `projection.nextAction`. A running shell is not proof of a running agent, and `unverifiable`, silence, or host loss is not proof of exit.

`worker-read --dispatch <dispatchId> --source auto --limit 50 --json` is available for bounded recovery, such as an ended turn without completion or a receipt directing inspection. Inspect its source/fallback reason and continue its cursor only as needed to resolve that discrepancy. Routine progress sampling is not recovery.

On positive proof that an agent ended without completion, use `worker-stop --dispatch <dispatchId> --json`, then retry a supervised attempt with `worker-start --task <taskId> --retry-of <dispatchId>` and the original placement/agent flags. For a manually created process, fencing the Dispatch does not stop it: the recorded creator must close its exact terminal before replacement. Preserve unknown outcomes and circuit-break refusals.

After an ambiguous mutation, use `orca orchestration request-show --request <requestId> --json`. A completed receipt is authoritative; replay a pending operation only with its original arguments and `--retry-request`. An absent receipt alone does not prove nothing happened. For uncertain prompt delivery, observing/replaying the original request must not submit a second prompt.

**Complete when:** the discrepancy is resolved or explicitly retained with its owner and next action, and no duplicate attempt or unmanaged process is left behind.

## Retire resources

After accepting the outcome, reuse a proven live terminal only for an immediate new assignment with an explicit ownership transfer; otherwise release or retain it deliberately:

```sh
orca orchestration worker-release --dispatch <dispatchId> --json
orca orchestration worker-list --run <runId> --terminal-state reclaimable --json
```

Managed release archives output and closes its owned agent terminal. Preserve `release_pending`/`release_unknown` and their recovery pointers; do not manually close to bypass them. For debugging, use `worker-retain` and record who will reclaim it.

A custom terminal may be retained as external or return `no_owned_resource`; low-level dispatches do not grant Orca process ownership. Once that Dispatch settles, its recorded creator closes the exact assignment-created terminal with `terminal close --terminal <handle> --json`. Verify `ptyKilled: true` and absence from `terminal list --worktree <selector> --json`. Preserve pre-existing/user-owned terminals.

Apply **Retire an owner** in `SKILL.md` to the checkout separately. After integration or authorized abandonment, remove only the assignment-created worktree with `worktree rm --worktree id:<worktree.id> --json`. Verify worktree and branch disposition independently, including patch evidence for squash/cherry-pick integration. Report dirty/unmerged refusals with an exact pointer; do not hide errors or force removal.

**Complete when:** no reclaimable managed terminals remain, every manually owned process is closed or explicitly retained, and each created worktree/branch is removed or has a reported cleanup owner and next action.

## Remote execution and lost authority

Discover an exact workspace/repository on the execution host. `worker-start --on <environment>` selects only that worker server; the Run remains on its home server. Remote `current` and `new-child` are invalid. Use an existing remote selector or `new-top-level` with the exact remote repository. After launch, address the Dispatch through lifecycle APIs rather than remote terminal guesses. Include `--include-remote` in fleet recovery and follow pagination when present. Contact loss leaves process state unknown; execution-host evidence owns cleanup.

If the CLI reports legacy or fenced coordinator authority, preserve its receipt and consult the indicated command's help. Take over a Run only when the original coordinator is unavailable and ownership has actually transferred. Do not create a competing coordinator or reset live state to evade a refusal.

**Complete when:** one coordinator has authority and the execution host's resources are accounted for, or an explicit unresolved ownership gap is reported.
