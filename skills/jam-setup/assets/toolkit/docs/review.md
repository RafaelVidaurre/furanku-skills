# Review an asset candidate

Read [contracts](contracts.md). Run `node tools/jam/jam.mjs status --run <run.json>` and inspect the selected record’s files and evidence. Read the brief/style/profile and compare against the intended result; do not infer visual success from file existence or metrics.

Prepare a compact review packet: what changed, images or a usable viewer, source comparison where relevant, intended game camera, measured constraints, remaining defects and a concrete accept/revise/reject decision. Label DCC views, engine views and enlarged crops honestly. Show all relevant surfaces; do not use a flattering angle to conceal known defects.

Honor the project’s stage policy and stricter run preferences. Agent-only review can proceed without a human unless the human requests involvement. Required human review pauses dependent work; ask through the active environment’s supported question surface (including enabled notifications). No particular harness or companion app is required. Approval, revision and rejection must name the exact candidate. Silence never approves.

For requests to enable or disable human checkpoints, follow [project settings](settings.md#human-checkpoints).

Record a decision JSON with the current record ID, actor, name, decision, reason and traceable conversation/review source. For human decisions, transcribe the actual answer; do not forge a human actor. Submit it with `node tools/jam/jam.mjs review`. These local records are an audit trail, not authentication.

## Carry an image approval into the first profiled run

Adding the first geometry profile after a style-bound concept/turnaround run is a bookkeeping transition, not a reason to ask the human to approve identical images again. Carry the existing decision only when all of these hold:

- The source is a non-exploration run with no profile. Its latest relevant concept/turnaround records are currently accepted, with no replaced, rejected or stale dependency. Preserve the source run and its evidence.
- The destination uses the same brief and style revision. Image outputs, original inputs and review evidence have matching hashes, and turnaround views/crop evidence are unchanged; any copied paths have an explicit source-to-destination mapping. Added custody notes document the transfer without changing the approved design.
- The new profile does not alter the intended design or contradict the prior approval's scope. The original decision satisfies the destination's reviewer policy; an agent decision cannot become human approval. An explicit request for a new review still takes precedence.

Register the reused concept, then turnaround against the new concept record. Preserve true origin, including existing paid-job evidence when importing downloaded outputs. For each new record, submit a review using its new record ID and the original decision's actor/approver; `source` cites the original run path, record ID, review timestamp and actual conversation source. `reason` says this carries that unchanged decision into the first profiled run, not that a new human answer occurred. Verify status before mesh work. A matched carry-over requires no additional human prompt or generation.

If any condition fails, use the ordinary review procedure for the affected work. This narrow transition does not carry exploratory preferences into production or reuse approvals after a style/brief/design change. Hash comparison and decision-scope inspection are the agent's responsibility; the CLI checks current record IDs/freshness and reviewer policy, not the truth of a historical source citation.

**Done:** an attributable decision is bound to current artifacts, or a specific human response is pending. Revisions create a new stage record; never replace files under an old acceptance. Re-run status before downstream work because changed files, dependencies or style/profile make prior acceptance stale.
