# Sol medium native-session extraction pilot

## Outcome

Sol medium correctly grouped the observable work and preserved the important
uncertainty in three new native histories. All **11 request/message records** and
**165 event records** were accounted for. Two readable tasks were extracted;
one child session remained unresolved because its actual assignment was encrypted.
No domain-quality scores were produced in this extraction experiment.

| History | Expected distinction | Observed result |
| --- | --- | --- |
| Codex child with inherited parent history | Parent work is not the child's work; encrypted dispatch is not a readable contract | Zero invented tasks; three inherited requests marked context; three encrypted messages unresolved; 64 events explicitly excluded |
| Claude production acceptance attempt | Approval relay and later user unavailability continue the same task; permission denial remains an external blocker | One task, three linked requests, eight requirements, all 40 events retained |
| Codex report correction and integration | Preserve both report correction and later main-only integration, without claiming recovered raw evidence | One continuing task, two linked requests, 21 requirements, all 61 events retained |

The extraction criteria and input hashes were frozen before three independent
Sol medium agents saw their respective packets. They received the complete
normalized text history, native source IDs, and ownership flags; no expected
answers, worker attribution map, original source access, or earlier assessment
results. Each agent could use code for ID bookkeeping and structure checks.
The root reviewed boundaries, requested concepts, exclusions and source linkage.
This was not an Astra review: the current Astra gate refused an ordinary selection
because that candidate is explicit-only; it was not launched for this work.

The frozen reference named the encrypted opening dispatch as a required unresolved
item. Sol also preserved two encrypted follow-up messages that the reference did
not enumerate. Both were present in the frozen input. No reference answer was
changed to hide an evaluator failure.

## Reader bugs found before evaluation

The initial adapter silently missed useful older Codex `event_msg` records and
typed native `agent_message` records. The sampled child file contained parent
history before its actual assignment. Treating those requests as current work
would duplicate parent outcomes and attribute them to the wrong worker.

The new adapter:

- Retains native progress, patch and tool observations without treating internal
  reasoning as outcome evidence. The sampled Codex child regained 26 native events.
- Reads typed native dispatch/peer messages and flags encrypted payloads without
  exposing ciphertext or inventing their content.
- Uses the child session's recorded agent path and matching dispatch to mark the
  inherited prefix; missing boundaries keep ownership unknown.
- Preserves source IDs and copies original bodies when materializing extracted tasks.

Two preparation attempts were marked failed in the ledger before any evaluator
was called, then repaired. These were reader failures, not model failures.
The existing JEV reader and previous experiment artifacts were not rewritten.

## Repeat protection and tests

Extraction now has its own stage in the machine-global completion ledger. The
three actual outputs were completed, then claimed again: **3 skips, 0 new calls**.
An extraction marked complete does not complete assessment of that session.
Unknown or encrypted requests keep an explicit disposition, avoiding repeated
calls over unchanged unavailable evidence. A changed source or intentional
reassessment can reopen the work.

Five extraction tests and nine existing ledger tests passed. They cover inherited
ownership, missing dispatch boundaries, encrypted content, native event retention,
message mirrors, omitted/invented source rejection, correction retention, exact
evidence copying, stage isolation and repeated-result reuse. Tests use synthetic
histories and temporary databases.

## Remaining scoring boundary

Extraction recovered workflow constraints as well as actual deliverable requirements.
For example, conditional engine-testing rules accompanied a documentation-only
task. Counting those as successful work would inflate quality. The materialized
output therefore explicitly remains unready for assessment until requirements,
applicability, artifact evidence and actor contribution scope are reviewed.

This validates a small extraction pilot, not the full native reader across all
formats, automatic preparation for scoring, Grok coverage, long-session paging,
or calibrated domain rankings. Eligibility still includes informative sessions
for all configured providers, independently of JEV or Beads involvement. The two
readable cases happened to contain tracker context; it was already in their native
logs, and no tracker was queried by the extractors.

Private transcripts, attribution, raw results and references remain machine-local.
No global skill installation, routing selector, or production score table changed.
