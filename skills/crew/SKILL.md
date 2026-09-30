---
name: crew
description: Establish Commander, Captain, and Worker ownership over delegated work on any orchestration mechanism and any issue tracker. Use when the user asks an agent to act as or become Commander, Captain, or Worker; asks to spawn or delegate a Captain or Worker; asks Commander to take command of a Captain; asks to retire a finished owner or clean up the resources its assignment created; or asks to view or change which orchestration mechanism or work-record tracker Crew uses for a machine or project.
---

# Crew

Crew adds roles over two configurable seams: an orchestration mechanism launches and connects owners, and a work record holds durable contracts. Model picks come from the `model-routing` skill; if it is not installed, report that and stop—never pick models unaided.

## Ownership

- A Crew has at most one Commander. Without one, Captains and direct Workers report to the user; independent Commanders lead separate Crews.
- The user or Commander may assign Captains and direct Workers.
- Every assignment names one `reports_to`: `user`, `commander`, or `captain`.
- Role responsibilities and boundaries live in the role contracts below, nowhere else.
- The session's mechanism owns coordination state and any isolation it provides.
- Ownership begins through Direct role, Commander's Take command, or a packet-backed launch. Other messages carry information between existing owners; they do not create an owner, confer a role, transfer an assignment, or substitute for the principal's authorization.

Read the role contract for the role being performed:

- [Commander](references/commander.md)
- [Captain](references/captain.md)
- [Worker](references/worker.md)

## Resolve the seams

Before the session's first assignment—and for any request to view or change Crew's mechanism or tracker—read [Seams](references/seams.md) and resolve both seams:

```sh
python3 <crew-skill-dir>/scripts/assignment.py seams --repo <root>
```

Apply the precedence order in Seams to the output, then hold the session's mechanism manifest (attached to the `seams` output, or defined by the harness profile in Seams) and work-record adapter. A seam change is written at the user-selected scope and confirmed by rerunning `seams`; to park a mechanism without deleting its configuration, set `disabled: true` on its `mechanisms` entry.

**Complete when:** the session holds one mechanism manifest and one work-record adapter with a stated source, or the work-record question has been put to the principal.

## Direct role

When the user gives the current session a role, adopt it immediately with `reports_to: user`. The current request is its initial contract. Do not create a work record, run a routing check, or create coordination state solely to establish the role.

**Complete when:** the current session has acknowledged its role, principal, and immediate outcome, and carries any session naming the mechanism's Seams entry requires.

## Choose execution and placement

Use the smallest ownership structure that can deliver the outcome under the role contracts. Delegate when parallel work, specialized capability, independent review, or savings on substantial execution outweigh the launch, context transfer, supervision, and integration cost. Decomposing work does not require spawning an agent for every step. Reuse a suitable live owner only after confirming its assignment and availability through coordination state.

Before a launch, record its outcome, why delegation helps, and placement in the existing contract or coordination state. A Captain with one Worker is useful when the Captain contributes design, decisions, verification, or other work that justifies the extra owner; forwarding messages alone does not.

Choose placement independently of role, model, and custom launch arguments:

- Use an existing checkout for read-only work and sequential edits with one active writer.
- Use separate worktrees for concurrent changes that need independent Git state, conflicting writes, or an independent delivery branch. Account for generated files and shared build state, not just source-file overlap.
- Share a checkout among concurrent writers only with explicit disjoint write ownership and one owner of index, branch, and integration operations. A worktree does not isolate ports, devices, databases, or other external resources; coordinate those separately.

Record created versus reused resources under **Retire an owner** below.

**Complete when:** direct execution or delegation has a concrete benefit, every outcome has one owner, and each launch has a placement and resource owner without duplicating the work contract.

## Spawn an owner

Use model-routing's classification of launch constraints and routing instructions. Record each principal or inherited launch constraint verbatim in the assignment packet with repeatable `--launch-constraint`; satisfy it at dispatch and propagate it unchanged into every descendant packet. A combined instruction carries its launch and routing parts through their respective fields.

A principal's `gpt-6.1-sol` at `high` constraint applies to each new Codex descendant. Gate-check `codex/gpt-6.1-sol/high` with updated model-routing support before building its packet; carry the same tuple into the launcher's actual model and effort arguments. Existing owners retain their sessions.

Load the `model-routing` skill and complete its one-time setup and follow its configured selector. Use Crew's adapter to show only candidates the mechanism can launch; it derives launchability from the manifest and loads live quota:

```sh
python3 <crew-skill-dir>/scripts/assignment.py brief --repo <root> \
  [--manifest <mechanism-id-or-manifest>]
```

When Jev is enabled, use model-routing's `route` command with task facts and the manifest's launchable agents. Save its successful decision privately and supply it to `packet --decision-json <file>` in place of candidate/reason arguments. For agent selection, judge the pick from the brief. Build one gate-checked packet per owner:

```sh
python3 <crew-skill-dir>/scripts/assignment.py packet --repo <root> \
  [--manifest <mechanism-id-or-manifest>] \
  --candidate <id> --reason "<concise task judgment>" --title "<outcome>" \
  --role captain|worker --reports-to user|commander|captain \
  --work-ref <adapter>:<ref> [--extra <key>=<value>] \
  [--launch-constraint "<verbatim constraint>" ...]
```

When the brief's activation rule applies, replace `--candidate` and `--reason` with `--exact-route <route-id> --route-basis "<verbatim principal request>"`. Crew validates that an activated route ID equals the assignment role or starts with `<role>.`; the role name alone never activates a route. Preserve the basis on quota-acceptance or fallback retries. Pass hard requirements directly as `--require-feature` or `--minimum-context`; `max` candidates may also need `--max-effort-basis` as model-routing specifies. An explicit-only candidate needs `--explicit-basis "<verbatim principal request for this model and effort>"` on either packet path.

Omit `--manifest` when the active configured mechanism supplies one; pass a manifest for a session-specific or dynamically discovered harness profile. Pass an existing contract as `--work-ref` unchanged. Otherwise use `--request "<verbatim user request>"`; `packet` infers a configured work-record adapter, while `--work-record <adapter|none>` records a session override. When a later packet rebuild is likely, add `--decision-out <file>` to save the raw gate-check result; rebuild with `--decision-json <file>` instead of candidate or route arguments so the unchanged check is not rerun.

When the launcher needs a prompt file, add `--spec-out <private path>` to write the exact emitted spec without reconstructing it. If model-routing supplies a `decision_id`, preserve it through launch and use that version's documented journal interface to link the actual returned session or dispatch ID.

`packet` refuses missing mechanism extras and unlaunchable or unaccepted decisions. Re-judge a refused candidate within unchanged principal constraints. Preserve a refused exact route and satisfy it through a permitted launch surface or surface the conflict. Follow model-routing's `needs-acceptance` remedy, acceptance, and fallback rules without substituting another candidate.

Translate the packet through the selected mechanism's field mapping in Seams, apply any selected `launch_note`, and deliver its `spec` unchanged as part of that launch; packet field names do not imply same-named launch API parameters. A communication send or receipt is not dispatch evidence, and an unrelated existing session is not a launch target. If dispatch fails, distinguish an invalid invocation from a capability refusal: correct malformed or mis-mapped parameters and retry the same mechanism with the same gate-checked decision and unchanged constraints. Apply the refusal rules above only after a valid invocation demonstrates that the selected surface cannot honor the decision.

**Complete when:** the owner is launched with the intended role, principal, work pointer, and packet built from a gate-checked decision carrying its task judgment or principal route basis; launch evidence identifies the mechanism-created owner and coordination pointer, satisfies any principal-named mechanism, harness, or executable, and shows the selected agent capability, model, and effort were honored; any malformed dispatch is followed by a corrected retry on the same mechanism before a capability refusal or mechanism change; communication to the principal is live per the manifest; and the resources the assignment created are tracked by exact pointer.

## Communicate and wait

Use the assignment's reporting channel for questions, blockers, decisions, completion, and requested status. Keep routine progress in the existing work record or session state; send changes with evidence pointers rather than repeating the contract or reporting unchanged heartbeats. Ask the owner for missing evidence and inspect submitted artifacts at the responsible acceptance boundary. Routine progress and acknowledgement come from messages and structured state, never another agent's terminal screen or transcript. For Orca launch failures and recovery, read [Orca](references/orca.md).

The result collector handles and acknowledges every delivered batch before waiting. When the mechanism provides a verified wake on delivery, end the turn with pending assignments recorded and that wake armed. Otherwise hold one blocking wait using the mechanism's prescribed timeout within the active harness's limits. Observe the same pending operation across tool yields; another notice is not a reason to start a competing collector or a loop of short waits. Under a script-owned workflow, return at the profile's boundary. A timeout or silence does not prove an agent exited.

An input receipt proves delivery only to the stage it names. For a decision or resource handoff that requires acknowledgement, wait for an explicit correlated reply. Preserve the original message or request ID on recovery; never resend just because a screen is quiet.

**Complete when:** all delivered messages were handled and acknowledged, each pending assignment has a live collector or verified wake, and any cancellation or failure follows the mechanism's recovery procedure.

## Retire an owner

The session that creates an assignment owns its resource lifecycle until retirement or an acknowledged transfer of that responsibility. Keep exact pointers to created terminals, worktrees, branches, and assignment-specific build resources in existing coordination state. Reconcile those pointers on resuming a front, after a failed launch, and when an assignment settles.

Follow the mechanism's settlement and release procedure before retiring its resources. After repository policy declares the result integrated or explicitly abandoned, verify the intended integration target and follow the manifest's `retire` procedure. For squash or cherry-pick integration, use repository-approved content or patch evidence when ancestry cannot prove integration; a closed issue alone is insufficient.

Limit removal to assignment-created resources. Preserve shared resources, dirty or unintegrated work, and resources backing active or queued assignments. Age, a quiet terminal, or a missing process observation does not authorize removal. If the cleanup command refuses, retain its reason and recovery pointer instead of hiding the error or forcing removal.

**Complete when:** structured inventories confirm each retired terminal and worktree is gone and each dedicated branch is removed or explicitly retained. Every retained resource has an exact pointer, reason, cleanup owner, and next action reported to the principal; releasing a terminal alone does not close worktree or branch cleanup.
