# Delegation and completion protocol

Read this file before preparing the first worker brief in a Commander run and when recovering or accepting delegated work.

## Contents

- [Ownership tree](#ownership-tree)
- [Private job ledger](#private-job-ledger)
- [Command packet](#command-packet)
- [Worker questions](#worker-questions)
- [Completion report](#completion-report)
- [Acceptance and review](#acceptance-and-review)
- [Cancellation](#cancellation)

## Ownership tree

Every job has one accountable coordinator:

```text
User
└── Commander
    ├── direct Sergeant
    └── Captain
        └── Sergeant
```

Commander owns the user's outcome and final acceptance. A Captain owns its child plan and accepts child reports before sending one consolidated report upward. A Sergeant owns delivery inside its assigned boundary. Keep communication on these edges so decisions, completion authority, and recovery ownership stay unambiguous.

## Private job ledger

Use the selected mechanism as the source of truth for live process or task state. Mirror only enough data in Commander's private state directory to resume coordination after a new turn or session:

```yaml
id: auth-refresh
parent: null
state: running
objective: Replace the expired-token flow without changing login behavior.
acceptance: Tests cover refresh success, rejection, and concurrent callers.
coordinator: commander
owner: sergeant-auth-1
mechanism_ids:
  task: example-task-id
workspace: /path/to/isolated/workspace
scope: src/auth and its tests
evidence_expected: Focused and full-suite test results
last_observed: <UTC timestamp>
next_action: Reconcile completion at the next interaction boundary.
```

Useful states are `queued`, `running`, `waiting`, `blocked`, `recovering`, `completed`, `failed`, and `cancelled`. The ledger stores coordination and links an adopted issue or task as the source of project requirements.

## Command packet

Give every worker a self-contained packet containing ownership, acceptance, authority, and reporting. Include the other headings when they apply.

```markdown
# Command

Job: <stable name and ID>
Role: <Captain or Sergeant>
Reports to: <concrete coordinator identity>

## Outcome
<What must be true when this job is done.>

## Acceptance
- <Observable criterion>
- <Required validation or evidence>

## Context
<Only the project facts, decisions, links, and prior outputs needed for this job.>

## Scope and authority
<Owned files, systems, worktree/workspace, allowed side effects, explicit exclusions,
and actions that require escalation. Preserve unrelated user state.>

## Dependencies
<Inputs already available and jobs that must finish first.>

## Mechanism
<How this worker reports, asks a question, emits liveness, and completes. Include IDs.>

## Completion report
Use the report contract below. Contact your coordinator exclusively.
```

For a Captain, add the available Sergeant candidates, its concurrency allowance under the resolved policy (including the Captain itself), and permission to create child jobs within that allowance. Require the Captain to give each child a distinct scope and to preserve all child identifiers in its report. Let the Captain design the child plan.

For a Sergeant, name one delivery boundary, the exact workspace, and the validation it owns. Give access only to tools and side effects needed for that boundary.

For a recovery dispatch, add the previous owner, why it stopped, every partial artifact or modified workspace found, completed acceptance criteria, and the single authoritative continuation location. Name an inherited dispatch a continuation.

## Worker questions

A worker first resolves implementation details from the brief and project evidence. It asks its coordinator when the answer affects acceptance, scope, authority, priority, or a user-visible tradeoff.

Mechanisms with bidirectional messaging keep the worker alive or blocked under its existing identity. A one-shot raw worker reports `BLOCKED`, states one concrete question and the safe default, then exits; Commander launches or resumes a continuation after answering. The question and answer enter the ledger before work continues.

## Completion report

Every worker reports exactly once for each dispatch identity:

```markdown
STATUS: DONE | BLOCKED | FAILED
SUMMARY: <what changed or what was established>
DELIVERABLES: <paths, links, commits, artifacts, or external results>
EVIDENCE: <commands/checks and outcomes; state which checks ran and which remain unrun>
DECISIONS: <material choices and rationale>
OPEN: <remaining work, risks, or NONE>
CHILDREN: <child job IDs and final states, for Captains; otherwise NONE>
```

`DONE` means the worker believes its assigned acceptance criteria pass. `BLOCKED` means a named decision or unavailable dependency prevents progress. `FAILED` means the attempt ended without satisfying acceptance. Diagnostic output belongs in a file or mechanism log when it is too large for the report.

A Captain sends `DONE` only after every required child job is terminal and accounted for. A failed optional exploration may be accounted for without failing the parent; a required failed child keeps the parent open.

## Acceptance and review

Commander checks the report against the original criteria and inspects the cited evidence. Evidence must identify what actually ran, its result, and any surface left untested. For non-file work, require an equivalent observable artifact: a sent-object identifier, generated asset, research source set, exported model, or verified system state.

Use an independent Sergeant reviewer when failure would be expensive or hard to reverse, when security/privacy/data integrity is involved, when work crosses several ownership boundaries, or when the delivery report is uncertain. A reviewer receives read-only authority unless the user assigned it fixes too. Route review findings back to the delivery owner or a new fixing Sergeant.

Only Commander closes the top-level job. Closing requires:

- every acceptance criterion mapped to evidence;
- every dispatch, child, and replacement worker reconciled to a terminal state through the selected mechanism;
- partial or abandoned workspaces accounted for;
- remaining risk stated to the user;
- the private ledger and any adopted tracker updated consistently.

## Cancellation

On a user cancellation, stop new dispatches, ask live workers to reach a safe boundary, then stop them through the selected mechanism. Record their last observed state and preserve partial work until the user decides whether to discard it.

Cancellation is complete when every worker is stopped or explicitly identified as unreachable, all partial work is accounted for, and the user has received the final state.
