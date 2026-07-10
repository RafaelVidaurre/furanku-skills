---
name: council
description: Convene a council of AI models (Claude, Codex, Grok, Gemini, ...) that independently take positions, challenge each other, and vote their way to consensus. Use when the user says "council", wants several models to debate or weigh in on a decision, asks for multiple model perspectives, or wants the best ideas from a multi-model brainstorm.
license: MIT
metadata:
  author: rafaelvidaurre
---

# Council

You are the **moderator** of a council. Each **seat** is a separate AI agent, spawned headlessly via its CLI, possibly a different model than you. Seats deliberate in structured rounds; you keep the process honest and synthesize the **verdict**. You hold no seat, cast no vote, and reveal no leaning of your own until the verdict.

Two branches share the same bench and rounds:

- **Decide** — the user wants one answer to a question or decision. This file's default path.
- **Ideate** — the user wants ideas, not a ruling. Same steps, with the deltas in [Ideation variant](#ideation-variant).

## 1 · Assemble the bench

Resolve each setting from the first source that provides it:

1. **The user's prompt** — "5 seats", "all fable", "grok on low" override everything, for this run only.
2. **Project config** — `.council.json` at the project root.
3. **Machine config** — `~/.config/council/config.json`.
4. Neither file exists → run [Setup](#setup-first-run), then continue.

Config shape (both levels, project wins field-by-field):

```json
{
  "defaultSeats": 3,
  "roster": [
    { "cli": "claude", "model": "claude-fable-5", "effort": "high" },
    { "cli": "codex",  "model": "gpt-5.6-sol",    "effort": "high" },
    { "cli": "grok",   "model": "grok-4.5" }
  ]
}
```

A run seats the first `defaultSeats` roster entries, cycling the roster if the count exceeds it. Bench rules:

- **Seat count is odd.** No ties. If the user asks for an even count, propose the next odd number and let them pick.
- **More than 5 seats**: confirm with the user before spawning — cost and wall-time grow linearly.
- **Seats may share a model.** When they do, assign each duplicate a distinct lens so diversity survives: *risk-first* (what breaks), *opportunity-first* (what this unlocks), *simplicity-first* (the least clever thing that works). Name the lens in the seat's prompt.

### Setup (first run)

1. Detect installed agent CLIs and verify each actually answers — detection commands and a one-line liveness probe per CLI are in [references/models.md](references/models.md).
2. Propose a roster from what's installed, preferring provider diversity. When available, prefer: Claude on `claude-fable-5` effort high, Codex on GPT‑5.6 Sol reasoning high, Grok 4.5. Fill remaining seats with other live CLIs at their default models.
3. Show the proposed roster and ask the user to confirm or edit models, efforts, and `defaultSeats`.
4. Save the confirmed config to `~/.config/council/config.json` (create the directory). Offer to also write `.council.json` if this project should pin its own bench. Setup is done when a saved config lists only seats that passed the liveness probe.

## 2 · Frame the brief

Write `brief.md` in a fresh temp directory for this council (all round files live beside it). It contains, in order: the question exactly as posed, background a stranger needs, hard constraints, the options already on the table (if any), and what a good answer must account for. The brief is **neutral** — no hint of your leaning, no option listed first because you favor it. Every seat receives the identical brief.

## 3 · Round 1 — blind positions

Spawn all seats **in parallel, in the background** (invocation recipes per CLI: [references/models.md](references/models.md)); each writes to its own file, e.g. `r1-seatA.md`. **Blind**: no seat sees another's answer — this is what prevents anchoring. Seat prompt:

```
You are Seat {X} of {N} on a council convened to settle the question in the brief below.
Council rules: agreement is not the goal; being right is. State your actual view plainly.
You may read the project's files to ground your claims, but change nothing.
{lens line, if assigned}

{brief}

Reply in exactly this format:
POSITION: <one sentence>
REASONS: <top 3, strongest first>
ASSUMPTIONS: <what you are taking on faith; mark any you could not verify>
CONFIDENCE: <1-5>
WOULD CHANGE MY MIND: <the specific evidence or argument that would>
```

The round is complete when every seat has produced a well-formed reply (re-prompt a seat once on malformed output; a seat that fails twice is dropped and the bench re-checked for oddness — drop or add a seat to restore it, telling the user).

## 4 · Moderate

Read all Round-1 replies and write `moderator-notes.md`:

- **Fallacies** — name any you find (appeal to authority, false dichotomy, sunk cost, circular reasoning...) and which seat's argument carries it.
- **Assumptions posing as facts** — mark each `needs evidence`. Where a claim is cheaply checkable (a file's contents, a command's output, a documented API), check it yourself and attach the finding.
- **Miscommunication** — two seats using one term for different things: define the term once in your notes.

Then route by agreement:

- **Split** → Round 2.
- **Unanimous** — suspicious, not conclusive. Construct the strongest counterargument you can and send it to all seats as a devil's-advocate probe (same reply format). Positions that survive it go straight to the verdict; a flip reopens the debate at Round 2.

## 5 · Round 2 — challenge

Each seat receives every Round-1 reply and your moderator notes, with authorship shown only as Seat A/B/C — never model names, so no seat defers to a brand. Seat prompt core:

```
Round 2. All Round-1 positions and the moderator's notes are below.
1. STEELMAN: restate the strongest position you disagree with — better than its author put it.
2. ATTACK: where does that position actually fail?
3. REVISED POSITION / CONFIDENCE / WOULD CHANGE MY MIND: your stance now. Holding your
   position and changing it are equally respectable; flipping without naming the argument
   that moved you is not.
```

Moderate again (same duties). A seat that flipped without citing what moved it gets one follow-up to justify the flip. Consensus now → verdict.

## 6 · Round 3 — converge (only if still split)

Name the **crux**: the single disagreement that, resolved, settles the matter (there almost always is one — often an unverifiable assumption or a differing weight on the same risk). Send only the crux and the live positions; ask each seat for `FINAL POSITION / CONFIDENCE / <one-sentence justification>`. After Round 3 the debate ends regardless — remaining disagreement becomes a vote, never a fourth round.

## 7 · Verdict

Majority rules; unanimity is just a 3–0 vote. Deliver in chat:

```markdown
## Council verdict — {topic}
**Decision:** <one sentence>
**Vote:** 2–1 (Seat C dissenting)
**Bench:** Seat A = claude-fable-5 (high) · Seat B = gpt-5.6-sol (high) · Seat C = grok-4.5
**Rationale:** <the arguments that survived challenge, not a summary of everything said>
**Dissent:** <the losing view at its strongest — omit only if unanimous>
**Assumptions to validate:** <anything still marked needs-evidence that the decision rests on>
**Confidence:** <low/medium/high, from the vote margin and seats' stated confidence>
```

The verdict is honest only if the dissent is written well enough that the dissenting seat would endorse it. Mention the temp directory path — the full transcript lives there. If the project keeps decision records (ADRs, `docs/decisions/`) or the user asks, save the verdict there too.

## Ideation variant

When the user wants ideas rather than a ruling:

- **Round 1**: each seat proposes 3–5 ideas — for each: one-line pitch, why it could work, its biggest weakness (self-stated).
- **Round 2**: each seat sees all ideas (anonymized), kills the weakest with a stated reason, strengthens or combines the promising ones, and names its top 3 across the whole pool.
- **Verdict**: ranked shortlist by count of top-3 mentions (moderator breaks ranking ties, never adds own entries). Report each surviving idea with its strongest pitch, its known weakness, and which seats backed it. Dead ideas get one line each — a graveyard with reasons beats silent omission.
