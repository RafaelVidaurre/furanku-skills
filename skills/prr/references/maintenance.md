# Decisions and setup

Read only the branch selected by the main skill: Conflicts, Digest, or Bootstrap. Apply the main skill's authority and usefulness rules; read [record format](record-format.md) before writes.

## Conflicts

When a new candidate — or a PRD's content — contradicts an existing entry, check whether later user evidence already resolves it. For an unresolved choice needed by current work, surface it before relying on either state. Pause only choices that depend on the unresolved conflict; independent authorized work continues. Check existing user authorization before asking again.

1. Present to the user: the existing claim with its verbatim source, the new candidate with its verbatim evidence, and a plain explanation of why the two cannot both hold. Done when: the user has both evidence sets and the reason in front of them.
2. Route their decision: **keep** the current state and reject or correct the conflicting candidate; **replace** the current requirement or vision; **amend** it in place; or **narrow** the candidate until both can hold. Done when: the user has chosen one outcome for the conflict.
3. Complete confirmation before writing: send replacement or amended wording through the main skill's Capture step 4; route a narrowed candidate through the main skill's Capture steps 1–4 again; treat `keep` as rejection of the candidate after the existing wording shown in step 1 is explicitly retained. Done when: every resulting current or new state has confirmed final wording and any applicable status, and every rejected candidate has an explicit rejection.
4. Apply each confirmed current-state change through [Replacing current state](record-format.md#replacing-current-state) and each confirmed new requirement through the main skill's Capture step 5. For `keep`, append the resolution exchange to `sources.md`, leave the current source set unchanged, and identify any PRD or code that must be brought back into alignment. Done when: the current view contains only the surviving states, every displaced state is in the annex, and no candidate or dependent document remains in an undefined outcome.

## Digest

Deciding what to do with the undecided. Run when the user asks to digest or review the PRR; offer it when more than five entries are tentative/open or one of them is blocking work.

1. Apply the main skill's freshness classification before reopening decisions; a later confirmed answer resolves an open entry. Orient: give the user a short readout of the accepted picture, one breath per area. Done when: the current picture has been presented.
2. Walk tentative and open entries oldest first (by the date in `review`, falling back to `confirmed`). For each, present the claim, its verbatim source, its age, and anything touching it — a linked PRD, an accepted entry it interacts with, code already leaning on it. Done when: every tentative/open entry has been presented.
3. Every walked entry leaves with an explicit outcome: promote to `accepted`, drop (tombstone with why), reword and re-confirm, convert between `tentative` and `open`, or keep. Keeping is a first-class answer: the goal is that nothing stays tentative by neglect, not that everything gets resolved. Done when: no walked entry is missing an outcome.
4. Apply every changed or dropped outcome through [Replacing current state](record-format.md#replacing-current-state). For an unchanged `keep`, append the digest exchange to `sources.md`, replace `review` with `<today's date> via <that S-ID>`, and leave the entry's `sources` set unchanged. Done when: current files show one latest state per entry, displaced states are annexed, and each kept entry points only to its latest review evidence.

## Bootstrap

When the user asks to start tracking product requirements in a repo without `prr/`:

1. Use the product vision the user supplied, or ask for it when missing. Apply the main skill's Authority rules to its durable wording and verbatim evidence. Done when: the user has approved the vision wording.
2. Create `sources.md` with the complete vision evidence-and-confirmation exchange, then create `prr/PRR.md` with the vision, its confirmation date, its minimal complete evidence, and empty area/open-question sections. Done when: both files exist and the vision has `confirmed` and `sources` metadata satisfying the main skill's Authority rules 1–2.
