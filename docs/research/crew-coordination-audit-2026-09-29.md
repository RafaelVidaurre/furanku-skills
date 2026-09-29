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
- Initial guidance validation used contract walkthroughs. The follow-up below adds a live launch and coordination test; it does not measure broad post-installation agent behavior.

## Live Orca follow-up

Tested on 2026-09-29 with Orca 1.4.215 and Codex 0.158.0, in the existing checkout:

| Probe | Observed result |
| --- | --- |
| Native `worker-start`, Luna max | Rejected before task creation: model does not support effort max. |
| Native `worker-start`, Luna xhigh | Requested/effective tuple accepted; failed at `agent_readiness` with timeout despite the input prompt being visible. Failed-start terminal released. |
| Custom Codex xhigh with `--no-alt-screen` | Initial 60-second readiness wait and a 15-second follow-up both timed out. Prompt/tuple visible; no task injected; terminal closed. |
| Custom Codex max plus fresh `dispatch --inject` | Input accepted; Worker asked a question; coordinator replied by message ID with a nonce absent from the task spec; Worker returned the nonce in successful `worker_done`. Task and Dispatch both completed. |
| Effective tuple | Completed Codex session's `turn_context` recorded `model: gpt-6-luna`, `effort: max`; this was not inferred from the worker's self-report. |
| Cleanup | `worker-release` returned `retained/no_owned_resource` for the low-level Dispatch. Creator closed its exact terminal with `ptyKilled: true`. Terminal inventory contained none of the three test handles; reclaimable managed-worker inventory was empty. No worktrees or branches were created by the probes. |

Codex's local model metadata advertises Luna max. Orca's [catalog implementation](https://github.com/stablyai/orca/blob/433986fa3be37911a0f13f7ffd454b831b87a64c/src/shared/agent-session-option-catalog-claude-codex.ts) uses an xhigh ceiling for unknown models, explaining a wrapper-level limit rather than a different spelling for the effort flag. Direct command launch honored max, so the user's conditional migration to xhigh was unnecessary: the repository catalog and machine routing configuration retain max.

The readiness failure matches the [Codex 0.158 report](https://github.com/stablyai/orca/issues/22825#issuecomment-5867322618): the header labels expected by Orca disappeared, so changing alternate-screen behavior is insufficient. [PR #23765](https://github.com/stablyai/orca/pull/23765) merged on September 29, but the latest published release at this check, [1.4.216](https://github.com/stablyai/orca/releases/tag/v1.4.216), excludes it. The workaround remains bounded to startup; normal coordination used only mail and lifecycle state.

Crew's Orca reference now owns the commands, including manual process ownership for this tested fallback. Removed external orchestration-guide loading from that reference, the seam pointer, and emitted launch/retirement notes. Installed Crew remains divergent and was not overwritten by these branch edits. One successful local read-only round trip does not establish reliability for remote execution, nested Captains, or concurrent editing.

Follow-up validation: 49 assignment tests and 22 subtests, 10 frontmatter tests, Crew skill validation, and whitespace checks passed.

## Installed-copy provenance and rescue

The current branch's policies take precedence. The installed directory was a mixture of prior development and subsequent direct edits, not a release that should replace this branch wholesale.

| Origin | Finding and disposition |
| --- | --- |
| `37d77c7` on `crew-orca-guidance`, also carried as `bdc45f7` on `crew-orca-trial` (September 23) | Introduced Crew-owned Orca guidance, command templates, supported principals, embedded protocol, and prompt-file export. Rescue the packet capabilities, retaining this branch's role and placement policies. |
| `01c9d02`, `e007891`, `6fef2ea` and their trial counterparts | Tightened launch receipts, inbox acknowledgement/wake, and long-command handling. Those useful rules are already covered by this branch's commands and collection procedure. Do not restore the old universal heartbeat/checkpoint suppression or mandatory Commander handoffs. |
| `373d265` on `model-routing-states` (September 24) | Added routing journals and Crew decision-ID passthrough. Preserve the optional ID in Crew packets and link through the supplying router's documented interface. The separate journal/calibration implementation is not imported by this Crew reconciliation. |
| Local installation history, September 24 | A prior session copied selected Crew files from the routing worktree while installing model-routing. This explains part of the mixed baseline; it was not one coherent Crew release install. Private evidence pointers remain outside this repository. |
| Direct installed-file edits, September 27 | Session evidence shows the Codex `--no-alt-screen` template/test patch and version-based workaround-retirement guidance. Keep the tested argv and current retirement requirement, superseding the claim that the flag alone fixes readiness and the per-assignment version probe. |

The installed Commander and Captain files exactly match the September 23 feature commits. The installed main skill exactly matches `373d265`. Several other installed files do not match any reachable Git blob; the session records establish specific later edits, not the complete provenance of every line. Both other local worktrees were clean when checked and were left intact.

Rescued implementation:

- Explicit argv templates produce expanded argv and a POSIX-quoted command. A missing model or effort placeholder produces a launch warning. Template fields reject attribute/index access, conversions, format specifications, and malformed braces. No private Orca-settings reader was restored.
- `--spec-out` exports the exact spec and returns a diagnostic on write failure.
- Supported-principal validation rejects unsupported relationships before routing; built-in Orca continues to allow Commander reporting.
- Supervised packets carry a short pointer to Crew's authoritative Orca procedure, without a hard-coded Captain recipient or overrides of live lifecycle authority.
- Optional routing decision IDs survive packet generation for linking with compatible model-routing versions.

Excluded policies: mandatory Workers for Captain execution, routine new worktrees, Commander-to-user reporting substitution, preamble-wide liveness suppression, stale timeout rules, and project-specific shared-resource scheduling rules in the general Orca guide. The current generic acknowledgement and resource-ownership rules cover the reusable parts of that scheduling guidance.

Verification: 57 Crew assignment tests and 40 subtests passed. Tests exercise real packet CLI and filesystem boundaries, shell argument preservation through a harmless local argv probe, protocol/principal mapping, refusal before routing, and template diagnostics. No live agents were needed for this packet compatibility work; prior live startup evidence remains applicable.
