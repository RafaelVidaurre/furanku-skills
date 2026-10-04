---
name: usage-drain
description: Report which model and effort levels are draining Codex, Claude, and Grok usage from local session logs. Use when the user asks what is draining usage, and when they ask for a usage breakdown since the last reset or over a stated time range.
license: MIT
compatibility: Requires Python 3. Reads local Codex, Claude, and Grok session logs. Does not call the network.
metadata:
  author: rafaelvidaurre
---

# Usage drain

The script is the counter. Codex credit rates live in `scripts/rates.json`. Claude API rates live in `scripts/claude_rates.json`. Grok dollars are the cost already stored on each turn. Keep account emails and ids in the conversation, out of the repository.

## 1. Choose the harness and the range

Run `python3 <skill-dir>/scripts/usage_drain.py --help` and build one command.

Pass `--harness codex`, `--harness claude`, or `--harness grok` when the user names one harness. Omit `--harness` to report all three.

Omit `--since` and `--until` unless the user names a start, an end, or both. A named start with no end runs through the present. Pass ISO-8601 timestamps.

For Codex, the omitted start is the latest primary quota window. For Claude and Grok, local logs do not store that reset, so the omitted start is the trailing 7 days and `since_is_latest_reset` is false.

Codex uses the Codex home account unless the user names an email or an account id (`--account`).

**Complete when:** the command names only a harness the user named, and `--since` / `--until` are present only for a range the user stated.

## 2. Run it

Run the command. It prints one JSON report on stdout. Each requested harness is a key of `harnesses`.

**Complete when:** the process exits 0 and every requested harness is present.

When the process exits without a report and stderr names `--since`, ask the user for a start time. When a harness entry has no `rows` and its message names `--since`, ask for a start time for that harness.

## 3. Present each harness

Render one table per harness, rows in JSON order. Show money and quota points to two decimal places.

Codex columns: model, effort, calls, fresh input, cached input, output, credits, quota points. Add speed when any row's speed is not `standard`. Quota points are that window's meter rise, split across calls by credit weight. Call the meter weekly when `window_minutes` is 10080. State the account email, each window's start, reset, plan type, and gauge high, the points that rose, credits after the last meter tick, other-account and unattributed file counts, long-context calls, each warning, `points_outside_range`, `points_unattributed`, and whether `purchased_credits.drawn` is true.

Claude columns: model, effort, calls, input, cache write, cache read, output, usd. Add speed when any row's speed is not `standard`. Add reasoning when any row's reasoning is non-zero. State the window start and end, and that these dollars are the published API card. State each warning.

Grok columns: model, effort, calls, input, cached read, output, usd. Add cache write and reasoning when any row's value is non-zero. State the window start and end, that dollars are the cost recorded on each turn, and that effort is the session's recorded reasoning effort. State each warning.

When `unpriced_models` is non-empty, open that harness's rates `source` and add a slug only when that page prints its rate. Re-run the same command. When the page has no rate for the slug, name it as unpriced. A Grok model is unpriced when the turn recorded no cost.

When the user asks how a figure was priced, answer from the rates file that harness names, or from the turn's recorded cost for Grok.

**Complete when:** every harness in the JSON has its table or its missing-start question, and every unpriced slug is either priced from the published card and re-reported, or named as absent from that card.
