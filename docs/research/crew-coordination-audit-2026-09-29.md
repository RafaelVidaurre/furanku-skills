# Crew coordination audit — 2026-09-29

Scope: guidance changes informed by relevant launch, coordination, routing, and cleanup exchanges in five recent local sessions across two projects, plus the repository and installed Crew/model-routing instructions and the running Orca guides. This was a targeted failure investigation, not a representative model-performance study. Private session pointers and excerpts remain outside this public repository.

## Observed failures and changes

| Observed behavior | Guidance correction |
| --- | --- |
| A coordinator repeatedly read established agents' terminal screens while collecting progress. Workers read the coordinator before sending updates and read it again to infer acknowledgement. | Routine state comes from messages, work records, and structured lifecycle data. Required acknowledgement is an explicit correlated reply. |
| A Captain used fixed sleeps and terminal tails after dispatch under the description of startup verification. | The screen exception is bounded to diagnosing the known Orca readiness bug before task submission. The startup exception ends at the first task prompt. |
| A routing gate accepted Luna max, but the Orca launch wrapper rejected max; attaching a manually launched terminal then failed readiness. | Distinguish wrapper expressiveness from model capability. Reuse the routed decision and placement during supported custom-argv recovery; preserve failed receipts and resource ownership. |
| A Captain repeatedly returned unchanged heartbeat summaries and built short polling loops, while an existing background collector remained relevant. | One collector per inbox, mechanism wake when verified, otherwise one supported blocking wait. Handle every delivery before acknowledgement; summarize meaningful changes. |
| Cleanup commands suppressed lifecycle errors, followed release with manual terminal closure, and used forced worktree removal. Another session correctly checked patch equivalence before retiring a cherry-picked branch. | Respect mechanism settlement and release authority, preserve refusal evidence, verify integration including patch-based integration, and check branch/worktree disposition separately. |
| Both repository and installed Captain contracts assigned all concrete execution to Workers. Workflow completion criteria also required Worker calls. | Captain can implement, test, and complete with zero Workers. Delegation needs a benefit that outweighs launch and supervision costs. |
| Installed launch recipes tied handoffs and custom Codex launches to fresh worktrees, although current-checkout placement exists. | Choose workspace from write conflicts and delivery lifecycle, independently of role/model/argv. Label packet isolation as capability. |
| Luna appeared in explicitly requested routine research, while accumulated preferences discouraged max generally; the configured Worker route did not activate ordinary selection. | Add a positive routine-task preference to the catalog and compare effort within a model. Preserve explicit/disabled gates and higher-scope preferences; document repair of contradictory preferences at their owning scope. |

`worker-read` remains an allowed recovery diagnostic. The change prevents routine surveillance from being described as recovery; it does not remove the mechanism's bounded evidence-gathering path for a failed or inconsistent Dispatch.

## Scenario review

These are manual contract walkthroughs, not measured post-change agent runs:

- A Captain receives one coherent implementation task: it may finish directly, run verification, and return the result without a Worker.
- A Captain delegates one specialist task: it retains meaningful design/acceptance work and services messages at natural checkpoints while implementing its own portion.
- A read-only Worker or sequential writer uses the existing checkout. Concurrent Git mutations or conflicting build state require isolation or explicit ownership.
- A custom Codex launch needs different argv: placement stays unchanged, and startup diagnostics end before task submission.
- A live Worker is quiet: keep the result collector active; silence does not authorize retries, terminal closure, or routine screen sampling.
- A completion is missing and structured state indicates a recovery discrepancy: bounded `worker-read` is available, with subsequent actions governed by the mechanism's evidence rules.
- An assignment is cherry-picked: establish integration to the intended target, then retire only created resources and verify branch disposition. Unknown or dirty resources are retained with an owner and next action.
- A routine outcome has an eligible Luna max candidate: the selector sees the positive task preference without a role-triggered exact route. Architecture and critical decision work retain stronger capability where needed.

## Scope and rollout

The repository checkout and installed copies contain divergent work from other branches, including a separate Orca recipe and private routing-history tooling. This branch updates the repository guidance without importing or replacing that unrelated work. Before installation, reconcile the installed role/Orca instructions with these boundaries instead of retaining both contradictory procedures. Inspect effective private preferences through model-routing's configuration helper: a higher-scope blanket max restriction can still override a new builtin preference, and must be repaired at that scope under the user's intended policy.

The packet manifest keeps its existing `isolation` boolean; the emitted prompt now calls it `isolation_available`. Consumers parsing that prompt field must use the new name. The structured packet's other fields and launch gates are unchanged.

## Validation

- Crew assignment and routing router/config/Jev suites: 157 tests and 45 subtests passed. The packet regression exercises both isolation capability values and refuses an extra that would shadow the capability field.
- Skill validators and the repository frontmatter checks passed; local reference targets resolve and the package dry run includes the Orca reference.
- No live agents were launched for validation. The session findings establish the pre-change failures; future behavior still needs observation after installing the reconciled guidance.
