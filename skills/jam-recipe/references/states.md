# Run, step and job states

Read this when `jam run status`, `jam run next` or `jam job list` shows a state you need to act on. `jam run status <id>` prints every step with its state and the reason; `jam run next <id>` prints the command that moves the run on.

## What a run needs next

| `jam run status` (no id) shows | Meaning | The one command |
| --- | --- | --- |
| `work <step>` | A step can be done or must be redone | `jam run next <id>`, then its record command |
| `review <step>` | A recorded step waits for its gate | `jam run review ...` or `jam run request-review <id> <step>` |
| `settle-jobs` | Every step is settled but a provider job is not | `jam job done\|failed\|cancelled <id> <job> ...` |
| `deliver` | Everything is settled | `jam run deliver <id>` |
| `done` | Delivered, or the recipe delivers nothing | None |

A delivered run no longer changes. More work on the same subject is a new attempt: `jam run start <recipe> <id> ...` again makes `<id>:2`, and `<id>:1` still names the first.

## Step states

| State | Meaning | Do |
| --- | --- | --- |
| `ready` | Nothing recorded; can be worked now | Do the step and record it |
| `waiting` | Nothing recorded; a step it needs is not accepted yet | Work the step named in the reason first |
| `review` | Recorded; waits for its gate | Decide the gate. "Accepted by an agent; a person must accept it" means the gate is human |
| `accepted` | Recorded and through its gate | Nothing |
| `skipped` | An optional step skipped with a reason, or a step whose condition does not hold here | Nothing. Later steps treat it as satisfied |
| `bypassed` | Not needed: the run entered at a later step from existing work | Nothing |
| `revise` | Sent back with a requested change | Make the change, record the step again |
| `rejected` | Rejected | Redo the step from its inputs, record again |
| `stale` | A file, the brief, the style revision or a step it was built on changed since it was recorded | The reason names which. Restore the file, or record the step again; for a changed brief or style revision, start a new attempt |
| `blocked` | Recorded, but a step it was built on is no longer accepted | Settle that step; this one then stands again or turns stale |
| `over-budget` | Measured values exceed the run's budget as it is now | Redo within the budget, or the person changes the budget |
| `check-failed` | A check that runs on every status read fails | Fix what the reason names, record again |

Recording a step again adds a new record; the newest one decides the state, and steps built on the old one turn `stale` until they are recorded again. What exactly makes a record stale: `tools/jam/docs/contracts.md#when-recorded-work-stops-counting`.

The gate column shows who must accept. `agent (recipe: human)` means the project's review mode has lowered a human gate; `human` on a step the recipe gates lower means this run was started or set with `--human`.

## Job states

| State | Meaning | Do |
| --- | --- | --- |
| `open` | Reserved before submitting; holds its estimate against the caps | Submit once, then `jam job submitted <id> <job> --provider-job <ref>`. Never sent after all: `jam job cancelled` with how you know |
| `submitted` | The provider accepted it | Poll the provider; then `jam job done`, `jam job failed` or `jam job cancelled`, each with `--actual <charge> --evidence <where it shows>` |
| `lost` | Sent, but the response did not arrive | Find it in the provider's own history. Found: `jam job submitted`. Confirmed absent: `jam job cancelled --evidence "<how>"`. Never resubmit to find out |
| `succeeded` | Finished and charged | Record the step with `--job <job>` |
| `failed`, `cancelled` | Settled with the real charge | Open a new job for another attempt |
| `not-submitted` | Cancelled before it was sent; cost nothing | The same |

`jam job list --open` shows every unsettled job in the project. A refusal from `jam job open` names what is in the way: paid work off for that provider, a cap that would be passed (stop and tell the person what was spent and what the job costs), or the same request still unsettled in some run.

## When a command is refused

Every refusal prints `error:` with the field and the expected form and, when there is one, `fix:` with the command to run. Nothing was written. The usual ones:

| Refusal | Cause |
| --- | --- |
| "needs `<step>` accepted first" | Work was done out of order; settle that step |
| "say how these files came to be" | Add `--tool`, `--job` or `--source` with `--source-evidence` |
| "did not pass its checks" | The message lists each problem and fix; the files are not what the step requires yet |
| "needs a person's acceptance" | A human gate: request review or relay their answer |
| "budget ... is not defined" | The step checks a budget the project has not decided |
| "is delivered and no longer changes" | Start a new attempt |
| A lock is held | Another process is writing the run. After a crash: `jam run unlock <id>` |
