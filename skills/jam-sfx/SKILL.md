---
name: jam-sfx
description: Make sound effects for a game with the jam toolkit, from a generated or supplied recording to a levelled WAV a person has accepted by ear. Use when the user asks to make or replace a sound effect, to add a sound they recorded or bought, to split a recording into variants or make variants of a sound, to fix a sound after someone listened (a noise at the end, too much room), or to bring existing sounds up to a changed loudness target.
---

# Sound effects

A **sound** is a named unit such as `vase-break`. It has **takes**: each take is an **original**, kept exactly as it arrived, and a processed WAV at the project's loudness target. It may have **variants**: level-matched cuts the game picks from at random. `jam audio sfx` generates, cuts and levels; your work is deciding what the sound is, wording the request, and acting on what a person hears.

You cannot hear. Report what was measured (length, level, how many events); only a person says how it sounds.

`jam` is `node tools/jam/jam.mjs`. The work runs inside a run of the `sfx` recipe: the `jam-recipe` skill covers setup, runs and gates, and `jam run next <id>` always names the step. Flags are in `jam audio sfx <command> --help`. The rules shared with voiced lines (review by ear, spending, refusals and lost answers, the record's shape) are in `tools/jam/docs/audio.md`.

## 1. Know the sound

1. Name the moment it is for and what physically makes it: one thing touching another, in what way.
2. Decide its kind. A **one-shot** is one event. **Variants** are several versions of one event, so repeats do not sound identical. A **loop** is a bed or continuous sound that repeats seamlessly.
3. Look for one that already fits: `jam audio sfx show`.
4. `jam audio settings` names the sound provider and its guide. Read the guide's prompt and settings sections; wording and settings are the provider's own.

Done when you can state the sound's name (lowercase words joined by hyphens), its event in one sentence, and its kind.

## 2. Start the run

`jam run start sfx <name> --brief-text "<what the sound is for, and what makes it>"`. Sounds reviewed together share one run: start it once under a batch name and add `--run <batch>` to each generate.

A sound the person recorded, bought or made elsewhere costs nothing and needs no provider: copy the file into the project, then `jam audio sfx add <name> --file <path> --creator "<who>" --license "<rights>"`, and start its run at the processed result with `--from process`.

Done when `jam run next <id>` prints a step.

## 3. Get takes

1. Price it: `jam audio sfx generate <name> --prompt "<prompt>" --dry-run`, with the flags below. It prints a `cost:` line and sends nothing. Settle the approval as `tools/jam/docs/audio.md#spending` says.
2. Generate: the same command without `--dry-run`. It opens and settles the provider jobs, keeps each original, processes each take and records the run's `generate` step.

| Flag | When |
| --- | --- |
| `--takes <n>` | 2 or 3 when the sound matters, since a take cannot be reproduced. For variants, ask for one event per take: a requested series comes back with fewer or merged events. |
| `--duration <s>` | A one-shot whose length you know; short for impacts. |
| `--loop` | A loop or bed. It is never trimmed. |
| `--stereo` | A sound the game does not place at a position (a bed, a stinger). Positional sounds stay mono. |
| `--tighten` | Contact sounds (steps, bumps, impacts): the room ring is faded once the sound has decayed. Leave it off when the tail is the event (shards after a break, a pour). |

Read every line it prints. A `warning:` about a near-silent result means that request was charged and produced no take. "refused by the provider" and a lost answer are handled as `tools/jam/docs/audio.md#waiting-refusals-and-lost-answers` says.

Done when `jam audio sfx show <name>` lists at least one take and `jam job list --open` lists no job of this run.

## 4. Shape it

| Situation | Command |
| --- | --- |
| The sound should vary, and several takes each hold one good event | `jam audio sfx variants <name> --takes 1,2,4` |
| One take holds several separate events (a run of steps, a few knocks) | `jam audio sfx split <name> --take <n> --dry-run --preview <file.png>`, then the same without `--dry-run` |
| Something unwanted at the start or end | `jam audio sfx trim <name> --take <n> --start <s> --end <s>` |
| The room rings after the event | `jam audio sfx tighten <name> --take <n>` |

Before splitting, open the preview image: each shaded span must be one complete event with its tail, and close transients of one action (a heel, then a toe) must share a span. Raise or lower `--min-gap <ms>` until they do; for a continuous sound whose parts never fall silent, lower `--rise <dB>`. A take whose parts make one event (a shatter and its tinkle) stays whole.

Trim and tighten work from the original every time, so they can be repeated and widened.

Done when `jam audio sfx show <name>` lists exactly the files that will be the sound: one take, or variants that each hold one event.

## 5. A person listens

1. Record the processed result with the command `jam run next <id>` prints, one `--file` per take or variant that is the sound. The loudness check measures each file and refuses the record when one is off target.
2. Ask for the verdict as `tools/jam/docs/audio.md#listening-and-review` says. When there are several takes, ask which one.
3. Act on what they say: a revised prompt (step 3), a trim or a tighter tail (step 4). Record and ask again.

Done when `jam run status <id>` shows the process step accepted by a person, or the report names the verdict it is waiting for with its link.

## 6. Finish the run

Follow `jam run next <id>` to the end: it imports into the engine when the project's engine adapter can, and otherwise the run ends at the processed files.

Done when `jam run next <id>` says the run is delivered or has nothing left, and your report gives: the sound's files, who accepted them, what was spent with which provider, and anything still open with its next command.

## When a loudness target or the audio format changes

`jam audio sfx reprocess --all` rebuilds every take and variant from its original with the settings now in force, keeping trims, tightening and cuts. A take whose original is missing is left as it is and listed: restore the original from version control and run it again for that sound. Afterwards the run steps recorded with those files are stale; record them again.

## What has been proven

[references/validation.md](references/validation.md) lists what was exercised with synthetic audio and a stand-in provider, what was proven only in the game jam these tools come from, and what has never been run. Read it before promising a result the list does not cover.
