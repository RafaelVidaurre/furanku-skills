---
name: token-speed
description: Open a chart of output tokens per second by model and effort for Codex, Claude, and Grok. Use when the user asks how fast a model is generating, or for tokens per second over a time range.
license: MIT
compatibility: Requires Python 3. Reads local Codex, Claude, and Grok session logs. Does not call the network.
metadata:
  author: rafaelvidaurre
---

# Token speed

The script measures each harness clock and writes the chart. The page states the clock for the harnesses on screen, and it is where the time step, the range inside the scan, and the models are changed.

## 1. Choose the range

Run `python3 <skill-dir>/scripts/token_speed.py --help`.

Omit `--since` and `--until` unless the user names a start, an end, or both. The omitted window is the trailing 7 days. A named start with no end runs through the present.

Pass `--harness` when the user names one harness. Omit it to include Codex, Claude, and Grok.

**Complete when:** `--since` and `--until` are present only for a range the user stated, and `--harness` names only a harness the user named.

## 2. Open the chart

Run the command. A week of Codex logs can take a few minutes. The command writes one HTML file, opens it, and prints a JSON summary.

**Complete when:** the process exits 0, the summary's `output` path exists, and `opened` is true.

When the process exits without a summary, tell the user the stderr line.

## 3. Tell the user what opened

Give the file path and the scanned window. For Codex, state `account_email`. State each warning. When the user asks for a number, read `pooled`, `median`, and `p90` from the summary row and name that harness's clock from `clocks`.

**Complete when:** the path, the window, and any warning have been stated.
