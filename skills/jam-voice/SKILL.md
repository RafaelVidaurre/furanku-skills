---
name: jam-voice
description: Voice dialogue lines for a game with the jam toolkit, from authored text to a levelled, transcript-checked WAV per line that a person has heard. Use when the user asks to voice or re-voice lines, to give a character a voice or change it, to direct how a line is delivered, to see which lines are missing, stale or mismatched, to add a recording an actor made, or to bring voiced lines up to a changed loudness target.
---

# Voiced dialogue lines

A **line** is `{id, speaker, text}` in one of the project's lines files, named `<file name>/<line id>`. A **speaker** has one assigned **voice**. A line's **take** is an **original**, kept exactly as it arrived, and a processed WAV at the voice loudness target with the time of each word. A take is **current** while the line's text is what it was when the take was made; edit the text and the line is **stale**. `jam audio voice` generates, processes and checks; your work is choosing lines, getting voices chosen, and directing the performance.

You cannot hear. Report what was measured (length, level, what the transcriber heard); only a person says how a line sounds.

`jam` is `node tools/jam/jam.mjs`. The work runs inside a run of the `voice-line` recipe: the `jam-recipe` skill covers setup, runs and gates, and `jam run next <id>` always names the step. Flags are in `jam audio voice <command> --help`. The file formats and the rules shared with sound effects (review by ear, spending, refusals and lost answers, the transcript check) are in `tools/jam/docs/audio.md`.

## 1. Pick the lines

`jam audio voice status` lists every line with its state (`missing`, `stale`, `voiced`), whether a person marked its words reviewed, its voice, and what it still needs. `--script <file name>` and `--speaker <id>` narrow it.

Voice the lines marked reviewed. The words of an unreviewed line may still change, and a text edit turns a paid take stale: name those lines to the person before spending on one.

When no line shows, the project's lines are not where `audio.lines` points: `jam audio settings` prints the patterns, and `tools/jam/docs/audio.md#dialogue-files` gives the file's shape.

Done when you have the list of lines to voice, as `<file name>/<line id>`.

## 2. Give every speaker a voice

The person chooses each voice. For every speaker that `status` shows without one:

1. `jam audio settings` names the voice provider and its guide. Read the guide's section on voices.
2. Ask whether they will use an existing voice or make a new one. For an existing one, show them the candidates from `jam audio voice voices --search <text>`: name, description and the link to listen. For a new one, offer a description of the character's voice written the way the guide recommends, and the guide's link for creating it; once they have made it, find it by name with `voices --search`.
3. `jam audio voice assign <speaker> --voice <voice id>`, with `--setting <name>=<value>` for the voice settings the guide describes.

Done when `jam audio voice status` shows a voice for every speaker of the chosen lines.

## 3. Direct the performance

A line that needs a particular delivery gets a `performance` for its speaker's provider: the line's exact text with that provider's delivery markup, written as the guide describes. Read the line's `direction` and what the scene is doing. Markup is for the voice only; gestures and movement stay in `direction`. To change the words, edit `text`. A plain line needs no performance.

Done when each chosen line has the performance you intend, or none on purpose.

## 4. Voice the lines

1. Start the run: `jam run start voice-line <batch name> --brief-text "<which lines, for what>"`. For a single line, name the run with the line's id.
2. Price it: `jam audio voice speak --run <id> [<line> ...] --reviewed --dry-run`. Without lines it takes every missing and stale line. It prints the text each line would send and a `cost:` line, and sends nothing. Settle the approval as `tools/jam/docs/audio.md#spending` says.
3. Speak: the same command without `--dry-run`. It opens and settles the provider jobs, keeps each original, processes each take and records the run's `voice` step. `--takes <n>` asks for several takes of each line when the read matters; a take cannot be reproduced.

A recording an actor made costs nothing: copy the file into the project, then `jam audio voice process <line> --file <path> --creator "<who>" --license "<rights>"`.

Read every line it prints; refusals and lost answers are handled as `tools/jam/docs/audio.md#waiting-refusals-and-lost-answers` says.

Done when `jam audio voice status` shows every chosen line `voiced` and `jam job list --open` lists no job of this run.

## 5. Check each take says its text

`jam audio voice status` shows a `transcript` for every voiced line.

| It shows | Do |
| --- | --- |
| `match` | Nothing. |
| `mismatch` | The take does not say the text: usually markup was read aloud or words were dropped. Revise that line's performance and speak it again. |
| `unchecked` | Run `jam audio voice process <line>`. When it reports the transcript check unavailable, give the person the install command it prints and ask whether to install it or to listen themselves. |

A person who listened settles a line directly, including one the transcriber misheard: `jam audio voice process <line> --by-ear "<where they answered>: <their words>"`. A spelling the transcriber keeps writing for a word the script spells otherwise (a name, a letter) goes in the project's same-sound list, as `tools/jam/docs/audio.md#the-transcript-check` describes.

Done when no chosen line shows `mismatch` or `unchecked`.

## 6. A person listens

1. `jam audio voice process --run <id>` records the processed lines on the run. It refuses while a line is off the loudness target, stale, mismatched or unchecked, and says which.
2. Ask for the verdict as `tools/jam/docs/audio.md#listening-and-review` says, with each line's text beside its file.
3. Act on what they say: another performance or voice setting and a new take (steps 3 and 4), or `jam audio voice process <line> --take <n>` to make another take stand for the line. Record and ask again.

Done when `jam run status <id>` shows the process step accepted by a person, or the report names the verdict it is waiting for with its link.

## 7. Finish the run

Follow `jam run next <id>` to the end: it imports into the engine when the project's engine adapter can, and otherwise the run ends at the processed files. Each line's word timings are in its `unit.json` for subtitles and lip movement.

Done when `jam run next <id>` says the run is delivered or has nothing left, and your report gives: the lines voiced with their files, who accepted them, what was spent with which provider, and anything still open with its next command.

## When the voice target or the audio format changes

`jam audio voice process --all` rebuilds every take from its original with the settings now in force; word timings and transcript results stay with takes whose cut did not move. Afterwards the run steps recorded with those files are stale; record them again.

## What has been proven

[references/validation.md](references/validation.md) lists what was exercised with synthetic audio, a stand-in provider and a stand-in aligner, what was proven only in the game jam these tools come from, and what has never been run. Read it before promising a result the list does not cover.
