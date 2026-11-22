# Orca

Read when a session takes a Crew role in Orca or Orca launches, connects, or retires an owner. Orca's version-matched guide owns Orca mechanics: launching workers, waking the coordinator, mail, steering, recovery, remote placement, and cleanup. This file adds only Crew's role, routing, account, and resource rules on top of it.

Before the first Orca command in a session, resolve the executable as the `orca-cli`/`orchestration` skills direct (`ORCA_CLI_COMMAND`, then `orca-dev` in an Orca dev checkout, `orca-ide` on Linux outside Orca, otherwise `orca`), then load the guide:

```sh
orca skills get orchestration
```

Load a guide reference when its situation applies, such as `references/recovery-and-cleanup.md` for a failed start. When this file and the guide disagree about an Orca command or flag, the guide for the installed binary wins; Crew's role, routing, and account gates still apply. The examples here use `orca`; preserve the resolved executable throughout.

**Complete when:** the guide for the resolved executable has been loaded in this session.

## Name the session

On direct role adoption, name your own tab `<Role> - <work summary>`, for example `Commander - payments rollout`. On launch or handoff, the launching owner applies the packet's `orca_launch.session_title` to the actual tab as soon as the surface is known. Use its exact handle or chat session ID from the launch, even when several owners share one worktree.

- **Chat.** Run `orca chat rename --session <sessionId> --name "<session title>" --json`. Inside your own chat, omit `--session`.
- **Terminal.** Set the title with `terminal create --title` at creation or `orca terminal rename --terminal <handle> --title "<session title>" --json` on an existing tab. Inside your own terminal, use `ORCA_TERMINAL_HANDLE` when set.

`--task-title` labels the orchestration Task. For a remote worker, delegate the tab rename to the owner on the executing host.

## Place the owner

Apply **Choose execution and placement** in `SKILL.md`. The packet defaults to `current`. Use `packet --orca-worktree <placement>` for another workspace.

- With `worker-start --agent` (including readiness-only preparation), use `new-child` when the caller's workspace is the intended parent, or `new-top-level` for an independent workspace. On creation, pass `--base-branch <ref>` when the chosen Git base differs from the repository default.
- For a different parent, create the child first with `orca worktree create --name <name> --parent-worktree <chosen parent selector> --base-branch <ref> --json`, then pass its returned selector in the packet. Use the same creation step when `agent launch` or `terminal create` needs a new workspace, substituting `--no-parent` for `--parent-worktree <selector>` for top-level work. Record the created resources and use the exact selector for launch, attachment, and recovery.
- For a new worktree or a remote host, follow the guide's placement reference. For reuse on another host, pass an exact remote selector. If the host reports a lineage warning, record the placement it returned.

## Launch a supervised owner

Build the packet with `--spec-out <private file>`, then start the owner with the packet's routed tuple:

```sh
orca orchestration worker-start --spec-file <spec file> --task-title "<orca_launch.session_title>" \
  --worktree <orca_launch.worktree> --agent <routing.agent> --model <routing.model> --effort <routing.effort> \
  [--run <runId>] --json
```

The routed model and effort are the user's configured choice, so pass them even though the guide omits `--model` when the user names none. A `--spec` start without `--run` binds a new Run only when this coordinator has none, and otherwise joins the newest bound Run; record the Run each receipt names as the front's Run. Pass that recorded `--run <runId>` on every later start, preparation, and attachment for the front. When a front needs its own Run while another is bound, create it with `run-create` first. Create a Run and dependent Tasks explicitly only for a task DAG, using the guide's coordinator-loop reference. A packet with `account_binding` or a launch note that names a custom command follows the sections below instead.

Record the receipt's Run, Task, and Dispatch IDs, the effective launch tuple, and every workspace or terminal the start created, as the assignment's resource pointers. On failure, do not rerun the start; follow the guide's recovery reference and **Spawn an owner** in `SKILL.md`.

**Complete when:** the receipt is ready with exact Task and Dispatch IDs, its effective agent, model, and effort match the packet, and created resources are recorded.

## Account-bound launches

Crew's built-in Claude and Codex policies check all configured accounts before changing a model. An active Orca-discovered account uses native preparation; an inactive discovered account or configured-only profile uses a profile-bound command in an Orca terminal. Both paths preserve the selected model and effort and verify the exact account before delivering work. For discovered accounts, packet construction checks fresh `account list --json` metadata and the command registry. Configured-only profiles need no Orca account registration: the command path verifies capability and actual process/native identity before delivery. Neither path changes Orca's global active account.

Follow the emitted `launch_method`. For `command`, use the packet's exact `launch_command` through **Custom model arguments** below, including process verification before attachment. The command uses that profile's existing vendor configuration; it does not reproduce extra flags or environment injected by Orca's native launcher. If the principal requires the native launcher or a chat surface, use an explicit `orca-native` account policy and preserve that constraint as a readiness refusal when the selected account cannot be bound.

For an explicit `orca-native` policy, only the current host selection is eligible because the public native launcher has no Claude/Codex account selector. This is either the exact registered account ID or an explicit `discovery.selection: system-default` binding whose default home, email and organization match public discovery with no managed host account selected. The configured row name for a system-default binding is not a managed account ID. An inactive duplicate cannot supply the active account's quota evidence, even when the email or organization matches. Native preparation proceeds as follows:

1. Build the packet immediately before preparation. Crew reads the binding's exact Orca executable's `agent-context --json` registry and emits `prepare_surface`; missing discovery or tuple/attachment capabilities refuse before launch. Use that same executable and inspect its launcher help if the host rejects a valid discovered invocation. Reuse a prepared, assignment-owned process only after confirming it is live and matches the decision.
2. Run `prepare_command` with `--worktree` from **Place the owner**, `--json`, and, for `readiness-worker`, `--run <runId>` when this front already has a Run. For `agent-launch`, this is native preparation without a prompt; Crew adds `--surface terminal` when the launcher advertises it. For `readiness-worker`, the command contains a fixed readiness-only `--spec` that performs no project work and reports `worker_done`, plus `--keep-open` when advertised so Orca's automatic release does not close the prepared terminal; keep that spec unchanged. The actual assignment remains undispatched. Record its Task, Dispatch, terminal, workspace, and resource effects as preparation owned by this assignment, not a second work contract. A ready start receipt alone does not settle the readiness Task: wait for its `worker_done` wake, and resolve an escalation or missing report through the guide's recovery reference.
3. Read the receipt's actual surface. For a terminal, wait for `tui-idle`, then verify the live process's profile environment equals `account_binding.env`, every name in `unset_env` is absent, and the native account status and actual model/effort match the decision. For a `native_default_profile` binding, verify the process home resolves to that native default directory with `CLAUDE_CONFIG_DIR` absent; an empty override map alone is insufficient. Inspect only the needed nonsecret routing paths and presence booleans, never credential values. Recheck `account list --json` against the exact selected registered account ID and native identity. For `system-default`, require the host selection to remain null and recheck the bound default home, email and organization instead; duplicate registered accounts are not interchangeable. Recheck quota if the binding expired and compare the new binding with this same process. A workspace trust or sign-in prompt is a readiness gap: preserve it and report it without approving trust, copying credentials, or changing permission flags.
4. After the readiness Task succeeds (when present) and binding proof passes, attach the unchanged packet spec with `worker-start --spec-file <spec file> --terminal <same-handle> --worktree <same selector>`, adding `--run <runId>` when the front already has a recorded Run, and record the Run its receipt names. Omit `--agent`, `--model`, and `--effort` on attachment. Record the terminal ownership transfer from preparation to the real assignment; do not release it between these steps. If the receipt returned a chat, continue only through a documented attachment surface with equivalent identity proof. Missing proof or attachment leaves the real assignment blocked: settle or recover preparation and release its resources, or explicitly retain a pending readiness gap with its owner and next action. Never launch another process to evade that refusal.

A tuple alone does not pin an account. Native `worker-start --agent --model --effort` therefore receives only the readiness spec until binding is verified. Preparation, readiness completion, process proof, task delivery, and acknowledgement are separate gates. An idle terminal that returned to a shell is no longer a prepared agent.

On an `agent_readiness` failure, keep the original preparation Task and terminal and follow the guide's recovery reference. An optional vendor update offer can be dismissed with its documented skip/cancel action to continue the installed version; accepting an upgrade, sign-in, trust, permission, or account change needs the principal's authorization. No prompt dismissal proves identity or readiness: repeat the process and binding checks afterward. Preserve a pending human-only prompt as an explicit retained resource rather than retrying or abandoning its Task.

When the guide reports confirmed quota exhaustion, preserve work and settle the attempt through that same guide. Follow [model-routing recovery](../../model-routing/references/recovery.md) with the saved routing decision and the correlated Orca evidence. Apply its next action through Orca's existing wait, question, and replacement procedures. Model-routing does not launch, monitor, or maintain a second Dispatch lifecycle. Verify the replacement's account/model/effort and carry forward existing workers when replacing a Captain.

### Custom model arguments

Use this path for a `command` launch method, or when a launch note says `worker-start` cannot set the routed tuple for that agent. Confirm the installed guide supports terminal creation, readiness wait, and attachment, and resolve any `launch_warning` first. Create one terminal in the selected workspace with the packet's exact `launch_command` and wait for readiness:

```sh
orca terminal create --worktree <selector> --title "<orca_launch.session_title>" --command '<exact launch_command>' --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
```

Proceed only on `wait.satisfied: true`. For an account-bound packet, verify the process profile/home, absence of credential overrides, model/effort and freshness as in step 3 above; the selected account need not be Orca's active account. Match its native authentication identity to `account_binding.quota_identity` (refresh routing if that identity is missing). Recheck Orca account metadata only when `account_binding.discovery.source` is `orca`; a configured-only profile has no Orca registration to prove. Resolve trust or sign-in prompts as readiness gaps. Then attach the unchanged assignment:

```sh
orca orchestration worker-start --spec-file <spec file> --task-title "<orca_launch.session_title>" --worktree <selector> --terminal <handle> [--run <runId>] --json
```

`--terminal` cannot combine with `--model`/`--effort`; retain the actual command and tuple acceptance as evidence. The assignment's creator owns this terminal.

**Complete when:** the task has an authoritative Dispatch, the intended model/effort is evidenced, and resource ownership is recorded. Input acceptance alone is not an acknowledgement or completion.

An available profile excluded by a native-only policy is a launch-surface mismatch, not quota exhaustion. Keep the checked model and account while resolving that constraint; use the command path only when permitted. Report a remaining blocker with its specific cause and next action. Routine automatic surface selection needs no user question or repeated quota reports.

## Full handoff

A full handoff transfers the assignment and its resource ownership to the named principal; it creates no Run or Task. For a packet without `account_binding`, use `orca agent launch --agent <agent> --worktree <selector> --model <model> --effort <effort> --prompt "<packet spec>" --json` for the default current workspace or another existing one. Only for a planned new workspace, use `worktree create` with the parent or top-level flag from **Place the owner** and the same agent, tuple, and prompt. An account-bound packet never sends its spec with the launch: prepare and verify the process first (steps 1–3 above for `orca-native`, settling any readiness Task; **Custom model arguments** for `command`), then deliver the spec to that same verified terminal with `orca terminal send --terminal <handle> --text "<packet spec>" --enter --json`. Without that proof, the handoff stays blocked.

Apply **Name the session** and transfer the exact workspace, agent session, and cleanup responsibility to the principal. A supervised assignment keeps its `reports_to`; do not turn it into a handoff for a launcher's convenience.

**Complete when:** the receipt shows the agent started with the packet's tuple and prompt, and the new owner, principal, and resource responsibility are recorded.

## Wait, answer, and steer

Follow the guide: after starting every ready assignment, end the turn; Orca wakes the coordinator when mail arrives, and its `check` marks the returned batch handled. Do not poll, run watch scripts, or read worker terminals for progress. Crew adds:

- Resolve a `question` or `escalation` from the assignment contract, or escalate it to this owner's principal; reply by exact message ID.
- Verify a `worker_done` against the contract before accepting it, and record the outcome and its evidence pointers in the work record.
- A Captain dispatched by a Commander is both a worker and a coordinator: it reports upstream through its own preamble's `ask`/`worker_done` and supervises its Workers through its own Run. Handle both kinds of wake before ending the turn.
- Steer a running or settled owner with the guide's `send --to dispatch:<dispatchId>`; a decision or resource transfer that needs acknowledgement waits for a correlated reply.

**Complete when:** every returned batch is handled, every pending assignment has a running Dispatch that can wake this coordinator, and any recovery follows the guide's recovery reference.

## Retire resources

After accepting an outcome, follow the guide's cleanup rules: finished workers in an existing workspace close on their own, while workers started in a new worktree, with `--keep-open`, or on an attached terminal stay open until `worker-release --dispatch <dispatchId> --json`. If release reports `retained` or `no_owned_resource` for a terminal Crew created outside `worker-start`—native `agent launch` preparation or **Custom model arguments**—close that exact terminal with `orca terminal close --terminal <handle> --json` and confirm it is gone from `orca terminal list --worktree <selector> --json`. Never close a pre-existing or user-kept-open terminal, and preserve `release_pending`/`release_unknown` with their recovery pointers.

Retire the checkout separately under **Retire an owner** in `SKILL.md`: after integration or authorized abandonment, remove only an assignment-created worktree with `orca worktree rm --worktree id:<worktree.id> --json`, and report dirty or unmerged refusals with an exact pointer.

**Complete when:** every Dispatch the assignment created is settled and released or retained with a reason, every Crew-created terminal is closed or retained with an owner, and each created worktree and branch is removed or has a reported cleanup owner and next action.
