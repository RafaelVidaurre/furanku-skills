---
name: prr
description: "Use and maintain a Product Requirements Record in repos containing prr/. Read it before planning, implementing, reviewing, or evaluating product behavior; capture new durable product intent from conversation. Use on request to start tracking requirements, resolve tentative requirements or open questions, or audit the record. Preserve confirmed intent, its decision-relevant context, and verbatim evidence across sessions."
---

# Product Requirements Record

The PRR (`prr/` at the repo root) preserves product decisions so a later agent can make the same product judgment without replaying the conversation. It earns its maintenance cost when it prevents lost constraints, repeated decisions, or implementation and evaluation against the wrong target. It records intended behavior and unresolved product choices; the work tracker records delivery, and tests provide evidence of implementation.

## Choose the workflow

- Product work in a repo with `prr/`: **Read and use** below.
- New or changed intent in conversation: **What belongs**, then **Capture** below.
- Conflicting decisions: [Conflicts](references/maintenance.md#conflicts).
- User asks to decide tentative/open entries: [Digest](references/maintenance.md#digest).
- User asks to audit freshness, usefulness, or integrity: [Audit](references/audit.md).
- User asks to start a PRR: [Bootstrap](references/maintenance.md#bootstrap). Otherwise remain dormant in repos without `prr/`.

Read [record format and state changes](references/record-format.md) before writing scratch evidence or PRR files. Ordinary consumers need not load storage or maintenance instructions. Done when: the relevant branch and only its needed references are loaded.

## Read and use

In a repo containing `prr/`, before planning, implementing, reviewing, or evaluating product behavior:

1. Read `prr/PRR.md`, then the relevant area entries in full, their cross-area pointers, and linked detail needed for this task. Read glossary definitions used by those entries. Consult sources when scope, authority, or meaning is uncertain; consult superseded states only for historical questions. Done when: the applicable requirements and unresolved decisions are identified, or the task has no relevant recorded constraint.
2. Check freshness where this task depends on it: compare the applicable entries, linked detail, and later recorded decisions touching the same subject. Classify discrepancies as **stale decision** (later confirmed intent supersedes it), **implementation drift** (code differs without a changed decision), **stale description** (a completed milestone or current-state claim presented as ongoing intent), or **unknown** (insufficient evidence). Age, implementation, and a renamed ID do not establish supersession. Reconcile proven changes through the maintenance workflow; surface only the unresolved choice, and continue independent work. Done when: no disputed entry silently supplies authority for this task.
3. Apply accepted requirements to the design choices, task scope, and acceptance checks. Carry the relevant IDs and meaning into task briefs and reviews; an ID alone is not enough. Treat tentative/open entries as undecided, and an absent entry as unrecorded, not forbidden. A current user instruction can change the target; reconcile it through Capture and Conflicts rather than treating the old record as a veto. Done when: consequential choices and evaluation criteria can be traced to the applicable intent, with unresolved dependencies surfaced before relying on them.
4. At handoff, state which requirements materially constrained the outcome and distinguish intended behavior from demonstrated implementation. Done when: the next reader can see what was checked and what remains unproven without mistaking `accepted` for shipped or tested.

This reading path needs a discoverable repo pointer. During Bootstrap or Audit, ensure the canonical agent-instruction file points to it with: `Before planning, changing, reviewing, or evaluating product behavior, use the prr skill to read prr/PRR.md and the relevant area entries. Use it also when durable product intent emerges or changes.` Update an existing equivalent pointer in place; preserve the repo's canonical instruction file and symlink equivalents. Done when: the pointer covers both consumption and capture without duplicating the workflow.

## What belongs

A useful entry preserves a supported product decision that changes a future design, scope, or acceptance judgment. Ask: **what plausible product choice would be wrong if a future agent missed this entry?** State that consequence privately while screening; it need not become another metadata field. The entry must also add something not already entailed by the record. An open entry names an unresolved product choice and the consequence of leaving it undecided, not every unknown encountered during work.

Classify the statement before drafting:

| Content | Home |
| --- | --- |
| User capability, behavior, experience, audience, compatibility promise, data ownership, scope exclusion, or product tradeoff | PRR, when supported and decision-relevant. |
| Precise UI behavior, price, limit, protocol, or named technology that the user intends as a product boundary | PRR. Detail and technical vocabulary alone do not disqualify it. |
| Defect, repair plan, temporary workaround, migration sequence, delivery priority, milestone, or implementation status | Work tracker, plan, or release record. Preserve any separate enduring product boundary in PRR. |
| Library/runtime selection, internal schema, algorithm, class ownership, build/release mechanism, or development-environment design | ADR or engineering design, unless explicitly part of the product contract. User approval makes it authoritative, not automatically a product requirement. |
| Instructions to agents developing the product: research tools, get reviews, run checks, coordinate workers | Canonical agent guidance or engineering workflow. Behavior of agents that are themselves product users can be a product requirement. |
| Empirical question, experiment, benchmark, or current provider fact | Research/evaluation record. PRR may own the product outcome or tradeoff the evidence will decide. |
| Example, current data inventory, one-time demo, or historical success | Explanatory context or evidence, not a standalone requirement. |
| Restatement of an existing commitment or a generic virtue with no additional decision boundary | Attach useful context to its owner or omit; create no duplicate entry. |

For mixed statements, preserve the enduring commitment and route the rest to its own home without weakening the user's authority. Useful distinctions matter more than entry count: independently changeable commitments may split; a rule, its necessary exception, and a clarifying example can stay together. For uncertain cases or skill maintenance, read [usefulness and freshness scenarios](references/usefulness-and-freshness-scenarios.md). Done when: each candidate has a product consequence, supported scope, and a distinct owner, or has been routed elsewhere before any confirmation prompt.

### Durable claim wording

Write the enduring product state so a reader who never saw the conversation reaches the intended product judgment. Preserve meaning before shortening:

1. Extract the commitments, scope, conditions, exceptions, and distinctions from the evidence. Separate user decisions from agent suggestions, illustrative examples, and unresolved questions. Done when: each proposed obligation has support and each uncertainty remains explicit.
2. Write the complete requirement in the current area entry. Keep rationale when it determines a tradeoff, and keep a short contrasting example when the rule would otherwise admit the wrong interpretation. Label examples as illustrative: their instrument, platform, actor, or other incidental feature does not become a restriction. Linked detail may elaborate the requirement; it must not be the only home of a constraint needed to interpret it. Done when: the body preserves all decision-relevant meaning, not just the heading's summary.
3. Check scope and precision. Name the product-visible subject, actor, and conditions. For quantities, state the metric and relevant start/end boundaries; relative targets need a fixed baseline. Keep transient migration history in the annex, while retaining enduring constraints. Done when: no wording silently narrows or widens the evidence, or depends on what was “current” in the original conversation.
4. Perform a cold-reader check: identify a plausible implementation that satisfies the draft's literal wording but violates the explained intent. Revise to exclude it using supported distinctions; if the evidence cannot settle it, ask about that specific ambiguity. Compare the draft back to the evidence for missing commitments and invented obligations. Done when: the draft distinguishes the intended behavior from the known wrong alternatives without inventing policy.

When maintaining this skill or checking a difficult candidate, use [meaning-preservation scenarios](references/meaning-preservation-scenarios.md). These are manual behavioral checks, not proof that an agent will follow the skill.

## Authority

1. Every admission or semantic change needs user confirmation within its authorized scope. An explicit instruction to record exact wording, an already-confirmed proposal, or applicable standing authorization satisfies that requirement; do not ask again for the same decision. Otherwise confirm the complete synthesized entry and status through Capture. Unconfirmed candidates are discarded when the session ends.
2. Every requirement and the product vision cite at least one verbatim source.
3. Rewording a confirmed claim or vision — including merges and cleanups — uses the same confirmation boundary as admission. Approval of a narrow edit authorizes that edit; preserve unaffected commitments.
4. The PRR owns each complete product commitment and its sources; a linked PRD owns elaboration (design, detailed scenarios, and test procedures). A PRD that contradicts a PRR claim is a conflict — handle it exactly like a conflicting user statement.
5. Reuse the repo's canonical vocabulary. Define shared domain terms in its existing glossary (`CONTEXT.md` when that is the convention); explain entry-specific conditions in the entry. Ask only when the evidence leaves a consequential ambiguity, rather than creating a glossary and a confirmation round for every ordinary term.

## Capture

1. Apply **What belongs**. A defect report or a request to fix behavior already entailed by accepted intent goes directly to corrective work, without a PRR candidate or confirmation prompt. Separately classify any new enduring commitment in the same exchange. When ambiguous, read [capture-routing scenarios](references/capture-routing-scenarios.md). Done when: only a supported new product commitment or an actual change to existing intent proceeds.
2. The moment a statement passes the gate — including durable intent surfaced as an aside during coding, debugging, or grilling — record the claim and verbatim exchange in a scratch file outside the repository (a temp directory), never inside the repo or `prr/`: unconfirmed candidates must not survive as repo content. Give it the stable topic context required by record format's Source entry. Quote at capture time — a quote reconstructed later from memory or a context summary is not verbatim and must never be presented as one. Done when: the exact quote and stable topic context are preserved outside the repo and the conversation continued uninterrupted.
3. Check each candidate against the current vision and relevant entries; search the index and cross-area subjects for overlapping claims. A contradiction uses the Conflicts branch; if the user has already resolved it, apply that decision without another approval loop. Any candidate that changes, answers, refines, or withdraws an existing claim, status, or the vision attaches to that current state and, if confirmed, uses record format's Replacing current state instead of creating a duplicate. Withdrawing a requirement drops or replaces its current state; it does not create an inverse requirement unless the user separately confirms that inverse as enduring product intent. The rest accumulate as new. Done when: every pending candidate is classified as conflicting, attached to the current state it affects, or new.
4. At a natural pause — task complete, topic shift, session wrap-up, or five accumulated candidates, whichever comes first — present the batch. Show the relevant verbatim evidence and the complete proposed entry that satisfies Durable claim wording, including meaning-bearing context and labeled examples. For amendments, show what changes and what remains; confirmation of a short summary does not authorize unshown deletions or scope changes. Apply Authority rule 1 first to avoid repeating a confirmation already supplied. A requirement candidate also gets a proposed status from the [Requirement entry definitions](references/record-format.md); a vision change has no status. Resolve any question blocking those checks before asking for confirmation. Use the applicable compact form:

   ```markdown
   Evidence:
   > [verbatim exchange]

   Proposed requirement (`<status>`):
   > [complete requirement, including its necessary context]

   # or

   Proposed vision:
   > [durable vision]

   Confirm the wording and any shown status, edit, reject, or defer?
   ```

   Silence on a candidate is not confirmation. Leave deferred or unanswered candidates pending without repeatedly interrupting unrelated work; return when the user resumes that decision or it blocks a dependent choice. PRR admission does not block implementation the user has already authorized. A blanket "yes" confirms every candidate in the presented batch. Done when: every presented requirement is confirmed with a status, every presented vision is confirmed, or the candidate is edited, rejected, or explicitly deferred.
5. Write the confirmed outcomes in one pass. For a new requirement, append a source containing the complete evidence-and-confirmation exchange — including any edit to the proposed wording or status — and add the entry with the minimal complete evidence for its final state. For an attached change, apply record format's Replacing current state. Then check affected entries and open questions for conclusions changed by this decision; reconcile supported changes and surface only unresolved ones. Add cross-area pointers, update shared vocabulary where needed, and refresh the `PRR.md` index. Remove confirmed and rejected candidates from scratch; only pending candidates remain there. Done when: every new or changed entry has one current state with an ID, status, `confirmed` date, and evidence that directly supports that final state; `PRR.md` reflects every area and open entry; and scratch contains no resolved candidate.
