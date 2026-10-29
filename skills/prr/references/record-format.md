# Record format and state changes

Read before writing PRR files or scratch evidence, or inspecting record integrity. The main skill owns admission, meaning, and authority; this file owns storage and replacement mechanics.

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

Pausing keeps the subscription available to resume and suspends billing for the pause.
```

- `status`: `accepted` (the user commits to this as the product) | `tentative` (the user leans this way; revisit before building on it) | `open` (the decision is unresolved; the claim is the question itself). Status describes the user's commitment, independently of whether the feature is scheduled, built, or tested. Future work can be accepted; “try this” can remain tentative after implementation.
- `confirmed`: date the user admitted the entry or most recently changed its claim or status.
- `review` (optional): latest digest where the user explicitly kept a tentative/open entry unchanged, formatted `<date> via <S-ID>`. Replace it on the next keep.
- `sources`: the current-evidence set defined above. An entry with no source is invalid.
- `detail` (optional): path to a PRD or spec elaborating this claim.

The heading names the requirement. Its body carries the complete product commitment: scope, conditions, distinctions, and boundaries needed to interpret it. A one-sentence entry is sufficient only when it preserves that meaning. Use canonical terms from the repo-root `CONTEXT.md` glossary when one exists.

### Source entry (in `prr/sources.md`)

```markdown
## S-2026-08-05-pause-vs-cancel (2026-08-05)
Context: discussing the billing rework
> **User:** honestly people should be able to pause instead of cancel,
> we lose them forever otherwise
> **Agent:** pause keeps the sub alive but unbilled?
> **User:** exactly
```

Quotes are verbatim — the user's exact words, never paraphrased or tidied. Preserve the original speaker: an agent proposal, delegated brief, or historical summary remains attributed to its author even when forwarded. Record the user's endorsement separately; when original evidence is unavailable, identify the gap rather than reconstructing a User quote. The stored quote is the evidence: a claim can be re-derived from it later, but lost wording is gone forever. Make each source self-contained with enough stable topic context to understand the exchange. Session labels, session IDs, transcript paths, and transcript links are ephemeral locators, not evidence; omit them from scratch and durable sources. A back-and-forth exchange is one source when the meaning lives in the exchange. A source may also quote a document the user authored or explicitly endorsed: cite its repository path and quote the relevant passage verbatim in place of the exchange.

### Prior-state entry (in `prr/superseded.md`)

```markdown
- R-email-only-login [accepted, confirmed 2026-06-10, detail docs/prds/email-login.md] "Email-only login" (was: [S-2026-06-10-login-simplicity]) → superseded by R-sso-login (enterprise pivot), decided 2026-08-01: [S-2026-08-01-enterprise-pivot]
- R-pause-subscription [tentative, confirmed 2026-07-20, review 2026-07-28 via S-2026-07-28-pause-review] "Users may pause a subscription" (was: [S-2026-07-20-pause-idea]) → amended in place to [accepted] "Users can pause a subscription" (direction confirmed), decided 2026-08-05: [S-2026-08-05-pause-confirmed]
```

Write an annex record for each confirmed requirement or vision state that ceases to be current — retired, dropped, amended in place, status-changed, merged, or replaced. Include the subject; prior status and `confirmed` date where applicable; prior `review` and `detail:` path when present; the complete prior heading and body (including meaning-bearing context and examples); prior source set; replacement or disposition; reason; decision date; and decision sources. Use a multiline record when needed to preserve the full entry. Unconfirmed drafts never enter the annex.

### Replacing current state

When a confirmed claim, status, or vision changes:

1. Compare the proposed full entry with its current state, clause by clause: retained, changed, added, or removed. Retain unaffected commitments; every semantic change needs supporting user authority. For example, changing a next-step action does not retire an existing recovery route. Append the confirmation evidence to `sources.md`. Done when: every changed or removed commitment is authorized and the decision has a verbatim S-ID.
2. Before editing the current view, append its prior authoritative state to `superseded.md` using the format above. Done when: the prior wording, status, dates, review evidence, source set, and linked detail path are recoverable from the annex.
3. Replace the current state rather than annotating it: keep the R-ID for an in-place amendment or status change; use a new R-ID and delete the old active body when a different requirement replaces it; delete the active body without replacement when the requirement is dropped; replace the vision text in place. For every surviving or replacement state, set `confirmed` to the decision date and set `sources` to its minimal complete evidence, retaining an older S-ID only when it still directly supports part of that state. Remove `review` whenever a requirement's claim or status changes. Done when: the current file contains only the surviving authoritative state, if any, with no correction narrative or review metadata from a displaced state.
4. Update the index and pointers, then verify any linked `detail:` document against the current claim. Retain it when aligned; when it is stale or its requirement was retired, tell the user what no longer matches or which replacement claim it must elaborate, and route contradictions through Conflicts. Done when: navigation reflects the current state and linked elaboration is aligned or surfaced for decision.
