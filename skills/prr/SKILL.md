---
name: prr
description: "Maintain a Product Requirements Record — prr/ files keeping a confirmed, verbatim-sourced picture of what the user wants the product to be. Capture proactively: in any repo containing prr/, fire whenever conversation surfaces product intent — statements like 'users should be able to…', 'it must never…', 'that's out of scope', 'the point of this feature is…', 'actually the product should…' — even as an aside during coding or debugging. Fire on request when the user asks to start tracking product requirements or set up a PRR; when the user asks to digest, review, or decide on tentative requirements or open questions; or when the user asks to audit or clean up the PRR."
---

# Product Requirements Record

The PRR (`prr/` at the repo root) is the durable picture of what the user wants the product to be. Its goal is not full coverage of the product — it is that no requirement the user manifests, explicitly or implicitly, gets lost. The user and other agents must be able to trust it, so every entry passed through user confirmation and cites verbatim evidence.

## What belongs

A candidate requirement is any statement of product intent: what the product should do, who it is for, how it should behave or feel, and what it must never do — scope exclusions are first-class requirements. Technical decisions stay out unless the technology is itself part of the product; route technical rationale to the repo's ADRs or decision log instead.

## Layout

```
prr/
├── PRR.md          # current view: vision + area index + open questions
├── sources.md      # history annex: append-only verbatim evidence (S-…)
├── superseded.md   # history annex: append-only replaced states
└── <area>.md       # current view: requirements for one product area (R-…)
```

### Current view and history annex

`PRR.md` and the area files are the compact current view. They contain only the latest confirmed vision and requirement states plus generated summaries and pointers — no correction notes, former wording, superseded values, or chronological source trail.

`sources.md` and `superseded.md` are the history annex. `sources.md` preserves verbatim evidence; `superseded.md` preserves confirmed states that were later replaced or dropped. An active requirement's `sources` field contains the minimal complete set of S-IDs that directly supports its current claim and status. Replace that set when the state changes instead of mechanically appending every later exchange; historical-only sources remain available through the annex.

Area files are the single source of truth for current requirements. `PRR.md` holds the current vision, one line per area summarizing what is accepted there, and a list of `open` entries (ID + question + area file). The vision has `confirmed` and `sources` metadata with the same meanings defined under Requirement entry, but no ID or status. Generated summaries and pointers need no separate sources. When index and area files disagree, the area files win and the index is stale.

An entry lives in exactly one area file — the area of its primary subject. When it also constrains another area, add a one-line pointer there (`- see R-undo-window in settings.md`); pointers carry no status or sources and are regenerated freely.

Create files lazily — `sources.md`, `superseded.md`, and each area file exist only once they have content. Start with one area file; add areas as distinct product areas emerge.

Done when: a reader can learn the latest product requirements from `PRR.md` and the area files without reading their history, while the annex can reconstruct every prior confirmed state.

### IDs

IDs are kebab-case slugs, assigned at creation and never changed afterwards — an ID is an identifier, not a title, so it survives rewording. Requirements take a slug of the claim (`R-pause-subscription`); sources take the date plus a descriptive topic (`S-2026-08-05-pause-vs-cancel`). Before assigning one, search `prr/` for the exact ID. If it already names the same claim or evidence, attach to or merge with that entry; if it is unrelated, extend the new slug with distinguishing words. IDs need no counters.

### Requirement entry (in `prr/<area>.md`)

```markdown
## R-pause-subscription — Users can pause a subscription
status: accepted
confirmed: 2026-08-05
sources: [S-2026-08-05-pause-vs-cancel]
detail: docs/prds/subscription-pause.md
```

- `status`: `accepted` (the user commits to this as the product) | `tentative` (the user leans this way; revisit before building on it) | `open` (the decision is unresolved; the claim is the question itself). Propose the status supported by the evidence rather than defaulting to `accepted`.
- `confirmed`: date the user admitted the entry or most recently changed its claim or status.
- `review` (optional): latest digest where the user explicitly kept a tentative/open entry unchanged, formatted `<date> via <S-ID>`. Replace it on the next keep.
- `sources`: the current-evidence set defined above. An entry with no source is invalid.
- `detail` (optional): path to a PRD or spec elaborating this claim.

The claim (after the ID in the heading) is your synthesis of the user's intent, worded with the canonical terms from the repo-root `CONTEXT.md` glossary when one exists.

### Durable claim wording

Write the enduring product state, not the transition that prompted it. The claim must remain clear after the implementation and its former behavior have changed:

- Name the product-visible subject, actor, and scope precisely. Use implementation labels only when the user intends them to define the boundary.
- For quantitative behavior, state the metric and any start/end boundaries that affect its meaning. Use an absolute target when the intent permits; a relative target names a fixed baseline or comparison that remains stable.
- Keep former values, migration language, change history, and rationale in the verbatim source or the appropriate decision record unless they constrain the enduring product.
- Split commitments that could change independently into separate entries.

For example, after the exchange establishes that "the splash" means the in-app animation from its first app-drawn frame until the main interface appears and that the fixed baseline is two seconds, "halve the splash" can become `The in-app splash animation lasts one second, measured from its first app-drawn frame until the main interface appears`; the former duration remains source context.

Done when: the claim can be interpreted without reconstructing which version was "current," "previous," or "prior" when it was written.

### Source entry (in `prr/sources.md`)

```markdown
## S-2026-08-05-pause-vs-cancel (2026-08-05)
Context: discussing the billing rework
> **User:** honestly people should be able to pause instead of cancel,
> we lose them forever otherwise
> **Agent:** pause keeps the sub alive but unbilled?
> **User:** exactly
```

Quotes are verbatim — the user's exact words, never paraphrased or tidied. The quote is the insurance against your synthesis being wrong: a claim can be re-derived from its source later, but lost wording is gone forever. A back-and-forth exchange is one source when the meaning lives in the exchange. A source may also quote a document the user authored or explicitly endorsed: cite the file path and quote the relevant passage verbatim in place of the exchange.

### Prior-state entry (in `prr/superseded.md`)

```markdown
- R-email-only-login [accepted, confirmed 2026-06-10, detail docs/prds/email-login.md] "Email-only login" (was: [S-2026-06-10-login-simplicity]) → superseded by R-sso-login (enterprise pivot), decided 2026-08-01: [S-2026-08-01-enterprise-pivot]
- R-pause-subscription [tentative, confirmed 2026-07-20, review 2026-07-28 via S-2026-07-28-pause-review] "Users may pause a subscription" (was: [S-2026-07-20-pause-idea]) → amended in place to [accepted] "Users can pause a subscription" (direction confirmed), decided 2026-08-05: [S-2026-08-05-pause-confirmed]
```

Write one line for each confirmed requirement or vision state that ceases to be current — retired, dropped, amended in place, status-changed, merged, or replaced. Include the subject; prior status and `confirmed` date where applicable; prior `review` and `detail:` path when present; quoted prior wording; prior source set; replacement or disposition; reason; decision date; and decision sources. Unconfirmed drafts never enter the annex.

### Replacing current state

When a confirmed claim, status, or vision changes:

1. Append the confirmation exchange to `sources.md`. Done when: the decision has a verbatim S-ID.
2. Before editing the current view, append its prior authoritative state to `superseded.md` using the format above. Done when: the prior wording, status, dates, review evidence, source set, and linked detail path are recoverable from the annex.
3. Replace the current state rather than annotating it: keep the R-ID for an in-place amendment or status change; use a new R-ID and delete the old active body when a different requirement replaces it; delete the active body without replacement when the requirement is dropped; replace the vision text in place. For every surviving or replacement state, set `confirmed` to the decision date and set `sources` to its minimal complete evidence, retaining an older S-ID only when it still directly supports part of that state. Remove `review` whenever a requirement's claim or status changes. Done when: the current file contains only the surviving authoritative state, if any, with no correction narrative or review metadata from a displaced state.
4. Update the index and pointers, then verify any linked `detail:` document against the current claim. Retain it when aligned; when it is stale or its requirement was retired, tell the user what no longer matches or which replacement claim it must elaborate, and route contradictions through Conflicts. Done when: navigation reflects the current state and linked elaboration is aligned or surfaced for decision.

## Hard rules

1. Nothing enters the PRR, and no claim, status, or vision changes, without user confirmation. Candidates the user never confirmed are discarded when the session ends — never written "to be safe."
2. Every requirement and the product vision cite at least one verbatim source.
3. Rewording a confirmed claim or vision — including merges and cleanups — requires the user to re-confirm the new wording.
4. The PRR owns each claim and its sources; a linked PRD owns elaboration (UX detail, edge cases, acceptance criteria). A PRD that contradicts a PRR claim is a conflict — handle it exactly like a conflicting user statement.
5. Vocabulary lives in `CONTEXT.md` at the repo root, never duplicated in the PRR. When a claim hinges on a fuzzy or overloaded term, resolve it with the user before confirmation and write the agreed definition to `CONTEXT.md`, creating the file if absent.

## Capture

Armed in any repo containing `prr/`. In other repos, stay dormant until the user asks to track product requirements (see Bootstrap).

1. The moment conversation surfaces a candidate requirement — including asides during coding, debugging, or grilling sessions — record the claim and the verbatim exchange in a scratch file outside the repository (a temp directory), never inside the repo or `prr/`: unconfirmed candidates must not survive as repo content. Quote at capture time — a quote reconstructed later from memory or a context summary is not verbatim and must never be presented as one. Done when: the exact quote is preserved outside the repo and the conversation continued uninterrupted.
2. Check each candidate against the current vision and every existing entry. A contradiction goes through Conflicts immediately. Any candidate that changes, answers, or refines an existing claim, status, or the vision attaches to that current state and, if confirmed, uses Replacing current state instead of creating a duplicate. The rest accumulate as new. Done when: every pending candidate is classified as conflicting, attached to the current state it affects, or new.
3. At a natural pause — task complete, topic shift, session wrap-up, or five accumulated candidates, whichever comes first — present the batch. Show verbatim evidence and wording that satisfies Durable claim wording. A requirement candidate also gets a proposed status from the Requirement entry definitions; a vision change has no status. Resolve any question blocking those checks before asking for confirmation. Use the applicable compact form:

   ```markdown
   Evidence:
   > [verbatim exchange]

   Proposed requirement (`<status>`):
   > [durable claim]

   # or

   Proposed vision:
   > [durable vision]

   Confirm the wording and any shown status, edit, reject, or defer?
   ```

   Silence on a candidate is not confirmation — unaddressed or deferred candidates stay pending and return at the next pause, then are discarded at session end like any unconfirmed candidate. A blanket "yes" confirms every candidate in the presented batch. Done when: every presented requirement is confirmed with a status, every presented vision is confirmed, or the candidate is edited, rejected, or explicitly deferred.
4. Write the confirmed outcomes in one pass. For a new requirement, append a source containing the complete evidence-and-confirmation exchange — including any edit to the proposed wording or status — and add the entry with the minimal complete evidence for its final state. For an attached change, apply Replacing current state. Then add cross-area pointers, write resolved terms to `CONTEXT.md`, and update the `PRR.md` index. Remove confirmed and rejected candidates from scratch; only pending candidates remain there. Done when: every new or changed entry has one current state with an ID, status, `confirmed` date, and evidence that directly supports that final state; `PRR.md` reflects every area and open entry; and scratch contains no resolved candidate.

## Conflicts

When a new candidate — or a PRD's content — contradicts an existing entry, surface it immediately rather than batching: conflicts carry implicit information and force a decision. This is the one case where interrupting the current task is correct.

1. Present to the user: the existing claim with its verbatim source, the new candidate with its verbatim evidence, and a plain explanation of why the two cannot both hold. Done when: the user has both evidence sets and the reason in front of them.
2. Route their decision: **keep** the current state and reject or correct the conflicting candidate; **replace** the current requirement or vision; **amend** it in place; or **narrow** the candidate until both can hold. Done when: the user has chosen one outcome for the conflict.
3. Complete confirmation before writing: send replacement or amended wording through Capture step 3; reclassify a narrowed candidate through Capture step 2 and confirm it if it still expresses product intent; treat `keep` as rejection of the candidate after the existing wording shown in step 1 is explicitly retained. Done when: every resulting current or new state has confirmed final wording and any applicable status, and every rejected candidate has an explicit rejection.
4. Apply each confirmed current-state change through Replacing current state and each confirmed new requirement through Capture step 4. For `keep`, append the resolution exchange to `sources.md`, leave the current source set unchanged, and identify any PRD or code that must be brought back into alignment. Done when: the current view contains only the surviving states, every displaced state is in the annex, and no candidate or dependent document remains in an undefined outcome.

## Digest

Deciding what to do with the undecided. Run when the user asks to digest or review the PRR; offer it when more than five entries are tentative/open or one of them is blocking work.

1. Orient: give the user a short readout of the accepted picture, one breath per area. Done when: the current picture has been presented.
2. Walk tentative and open entries oldest first (by the date in `review`, falling back to `confirmed`). For each, present the claim, its verbatim source, its age, and anything touching it — a linked PRD, an accepted entry it interacts with, code already leaning on it. Done when: every tentative/open entry has been presented.
3. Every walked entry leaves with an explicit outcome: promote to `accepted`, drop (tombstone with why), reword and re-confirm, convert between `tentative` and `open`, or keep. Keeping is a first-class answer: the goal is that nothing stays tentative by neglect, not that everything gets resolved. Done when: no walked entry is missing an outcome.
4. Apply every changed or dropped outcome through Replacing current state. For an unchanged `keep`, append the digest exchange to `sources.md`, replace `review` with `<today's date> via <that S-ID>`, and leave the entry's `sources` set unchanged. Done when: current files show one latest state per entry, displaced states are annexed, and each kept entry points only to its latest review evidence.

## Audit

Run when the user asks to audit or clean up the PRR; offer it when you notice drift while reading it. At that point, read and follow [references/audit.md](references/audit.md), which checks the record against the canonical rules above without redefining them here.

Done when: the reference's procedure is complete.

## Bootstrap

When the user asks to start tracking product requirements in a repo without `prr/`:

1. Ask for the product vision in a sentence or two, then present its durable wording with the verbatim exchange and ask for confirmation. Done when: the user has approved the vision wording.
2. Create `sources.md` with the complete vision evidence-and-confirmation exchange, then create `prr/PRR.md` with the vision, its confirmation date, its minimal complete evidence, and empty area/open-question sections. Done when: both files exist and the vision has `confirmed` and `sources` metadata satisfying Hard rules 1–2.
