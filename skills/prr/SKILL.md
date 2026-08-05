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
├── PRR.md          # the picture: vision + area index + open questions
├── sources.md      # append-only ledger of verbatim evidence (S-…)
├── superseded.md   # append-only tombstone log
└── <area>.md       # requirement entries for one product area (R-…)
```

Area files are the single source of truth for requirements. `PRR.md` is an index: a short vision statement, one line per area summarizing what is accepted there, and a list of `open` entries (ID + question + area file). When index and area files disagree, the area files win and the index is stale.

An entry lives in exactly one area file — the area of its primary subject. When it also constrains another area, add a one-line pointer there (`- see R-undo-window in settings.md`); pointers carry no status or sources and are regenerated freely.

Create files lazily — `sources.md`, `superseded.md`, and each area file exist only once they have content. Start with one area file; add areas as distinct product areas emerge.

### IDs

IDs are kebab-case slugs, assigned at creation and never changed afterwards — an ID is an identifier, not a title, so it survives rewording. Requirements take a slug of the claim (`R-pause-subscription`); sources take the date plus a topic word or two (`S-2026-08-05-pause-vs-cancel`). Before assigning one, grep `prr/` for the slug: a hit almost always means the requirement already exists — treat it as a near-duplicate (attach or merge, below), not as an ID problem. Slugs need no counter, so parallel branches only collide when they captured the same requirement — exactly the collision worth surfacing.

### Requirement entry (in `prr/<area>.md`)

```markdown
## R-pause-subscription — Users can pause a subscription
status: accepted
confirmed: 2026-08-05
sources: [S-2026-08-05-pause-vs-cancel]
detail: docs/prds/subscription-pause.md
```

- `status`: `accepted` (this is the product) | `tentative` (the user leans this way; revisit before building on it) | `open` (undecided — the claim is the question itself).
- `confirmed`: date of the user confirmation that admitted or last reworded the entry.
- `reviewed` (optional): date the user last explicitly kept a tentative/open entry during a digest.
- `sources`: one or more S-IDs. An entry with no source is invalid.
- `detail` (optional): path to a PRD or spec elaborating this claim.

The claim (after the ID in the heading) is your synthesis of the user's intent, worded with the canonical terms from the repo-root `CONTEXT.md` glossary when one exists.

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

### Tombstone (in `prr/superseded.md`)

```markdown
- R-email-only-login "Email-only login" (was: [S-2026-06-10-login-simplicity]) → superseded by R-sso-login (SSO required by the enterprise pivot), decided 2026-08-01: [S-2026-08-01-enterprise-pivot]
```

One line per retired requirement: ID, quoted claim, the entry's original sources, what replaced it (or "dropped"), why, date, and the sources of the decision. The full body is deleted from the area file — the active picture stays clean while direction changes stay quotable. When the retired entry had a `detail:` PRD, tell the user: that document now elaborates a claim that no longer exists.

## Hard rules

1. Nothing enters the PRR, and no entry changes meaning, without user confirmation. Candidates the user never confirmed are discarded when the session ends — never written "to be safe."
2. Every requirement cites at least one verbatim source.
3. Rewording a confirmed claim — including merges and cleanups — requires the user to re-confirm the new wording.
4. The PRR owns each claim and its sources; a linked PRD owns elaboration (UX detail, edge cases, acceptance criteria). A PRD that contradicts a PRR claim is a conflict — handle it exactly like a conflicting user statement.
5. Vocabulary lives in `CONTEXT.md` at the repo root, never duplicated in the PRR. When a claim hinges on a fuzzy or overloaded term, resolve the term with the user and write the definition to `CONTEXT.md`, creating the file if absent.

## Capture

Armed in any repo containing `prr/`. In other repos, stay dormant until the user asks to track product requirements (see Bootstrap).

1. The moment conversation surfaces a candidate requirement — including asides during coding, debugging, or grilling sessions — record the claim and the verbatim exchange in a scratch file outside the repository (a temp directory), never inside the repo or `prr/`: unconfirmed candidates must not survive as repo content. Quote at capture time — a quote reconstructed later from memory or a context summary is not verbatim and must never be presented as one. Done when: the exact quote is preserved outside the repo and the conversation continued uninterrupted.
2. Check each candidate against existing entries. A contradicting candidate goes through Conflicts immediately. A candidate that answers an `open` entry or refines a `tentative` one is attached to that entry — at confirmation, propose resolving the existing entry (promote, reword, or convert) instead of adding a duplicate. The rest accumulate as new. Done when: every pending candidate is classified as conflicting, attached, or new.
3. At a natural pause — task complete, topic shift, session wrap-up, or five accumulated candidates, whichever comes first — present the batch: for each candidate, the proposed claim, proposed status (`accepted`, `tentative`, or `open`), and its quote. Resolve any fuzzy terms as part of this exchange. Silence on a candidate is not confirmation — unaddressed or deferred candidates stay pending and return at the next pause (and die at session end like any unconfirmed candidate); a blanket "yes" confirms every candidate in the presented batch. Done when: every presented candidate is accepted, edited, rejected, or explicitly deferred.
4. Write the confirmed candidates in one pass: append sources to `sources.md`, add entries to their area files (creating an area file when the area is new), add cross-area pointers, write resolved terms to `CONTEXT.md`, and update the `PRR.md` index. Done when: every new entry has an ID, status, `confirmed` date, and sources, and `PRR.md` reflects every area and open entry.

## Conflicts

When a new candidate — or a PRD's content — contradicts an existing entry, surface it immediately rather than batching: conflicts carry implicit information and force a decision. This is the one case where interrupting the current task is correct.

1. Present to the user: the existing claim with its verbatim source, the new statement, and a plain explanation of why the two cannot both hold. Done when: the user has both quotes and the reason in front of them.
2. Route their decision: **supersede** (tombstone the old entry, admit the new one), **amend** (rewrite the old claim, re-confirmed by the user), or **narrow** (adjust the new candidate until it no longer conflicts). Done when: no two active entries contradict each other.
3. Append the resolution exchange to `sources.md` and cite it from every entry the decision touched. Done when: the surviving entries' sources include the resolution.

## Digest

Deciding what to do with the undecided. Run when the user asks to digest or review the PRR; offer it when more than five entries are tentative/open or one of them is blocking work.

1. Orient: give the user a short readout of the accepted picture, one breath per area. Done when: the current picture has been presented.
2. Walk tentative and open entries oldest first (by `reviewed` date, falling back to `confirmed`). For each, present the claim, its verbatim source, its age, and anything touching it — a linked PRD, an accepted entry it interacts with, code already leaning on it. Done when: every tentative/open entry has been presented.
3. Every walked entry leaves with an explicit outcome: promote to `accepted`, drop (tombstone with why), reword and re-confirm, convert between `tentative` and `open`, or keep — which stamps today's date in `reviewed`. Keeping is a first-class answer: the goal is that nothing stays tentative by neglect, not that everything gets resolved. Done when: no walked entry is missing an outcome.
4. Apply the outcomes and record the session's exchanges as sources, as in Capture step 4. Done when: files reflect every outcome and each changed entry cites the digest exchange.

## Audit

Hygiene of the record itself. Run when the user asks to audit or clean up the PRR; offer it when you notice drift while reading it.

Check for: `detail:` links pointing at files that no longer exist; `detail:` PRDs whose content contradicts their claim or another accepted entry (route through Conflicts); near-duplicate claims and duplicate IDs from parallel branches (merging requires re-confirmation of the merged wording); stale cross-area pointers; `tentative` entries that code or PRDs already build on (send to Digest as promote-or-challenge); `open` entries that later accepted entries actually answer; area files spanning multiple distinct topics (propose a split); an index out of sync with area files (regenerate it from them).

Done when: every finding is either fixed or presented to the user as a decision with your recommendation, and a summary of what was fixed and what awaits decision has been reported.

## Bootstrap

When the user asks to start tracking product requirements in a repo without `prr/`:

1. Ask for the product vision in a sentence or two, and confirm your synthesis of it. Done when: the user has approved the vision wording.
2. Create `prr/PRR.md` with the confirmed vision and empty area/open-question sections. Done when: `prr/PRR.md` exists with the confirmed vision.
