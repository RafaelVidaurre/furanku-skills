# GPT-6 Sol and GPT-6 Luna capability evidence

> Maintained-catalog assessment as of 2026-09-22 (Europe/Lisbon). This file
> assesses `codex/gpt-6-luna/max`, the proposed replacement for the builtin
> `worker` route `codex/gpt-5.6-luna/max`, and a possible
> `codex/gpt-6-sol/<effort>` candidate. GPT-5.6 Luna and Sol numbers quoted
> here are predecessor data. Do not relabel them as GPT-6.

Research date: 2026-09-22 (Europe/Lisbon)

## Question and boundary

1. Which capability cells does GPT-6 Luna at **max** effort earn under the
   catalog's current one-scale-per-dimension methodology
   ([normalization report](model-routing-score-normalization-2026-09-22.md))?
2. Which GPT-6 Sol effort is best evidenced, and what cells does it earn?
3. Is max still the right Luna effort for a worker?

It does **not** change selector weights, routes, or the catalog file. It
does **not** copy GPT-5.6 Luna's cells onto GPT-6 Luna.

Public research only. No local model evaluation contributes scores. The
local Codex model cache is identity evidence only (S4). Vendor tables are
S3 and fill no cell. Independent operator measurements are S1/S2. Exact
means the published number names the model **and** the effort.

Peers are cited from the live catalog in this worktree and from the
normalization report, not re-measured, except where noted:

- `codex/gpt-5.6-luna/max` (current worker cells; GPT-5.6 Luna evidence)
- `codex/gpt-6-astra/high` —
  [Astra evidence](gpt-6-astra-capability-evidence-2026-09-04.md)
- `grok/grok-4.7/high` — [Grok 4.7 evidence](grok-4.7-capability-evidence-2026-09-22.md)
- GPT-5.6 Sol — no longer a catalog candidate. Its values below were read
  from AA, DeepSWE, and CursorBench on 2026-09-22 for comparison only.

## What GPT-6 Sol and Luna are

OpenAI released both on 22 September 2026
([launch post](https://openai.com/index/introducing-gpt-6-sol-and-luna/),
S3). Positioning: Sol is "built for complex coding and agentic workflows".
Luna is "our most efficient model for focused, high-volume tasks". Both are
trained "with similar methods as GPT-6 Astra". The headline change is price:
API prices are 50% below GPT-5.6's promotional prices.

Official identifiers and interface (S3 / high), from the
[Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna)
and the [Sol model page](https://developers.openai.com/api/docs/models/gpt-6-sol):

| Spec | GPT-6 Sol | GPT-6 Luna |
| --- | --- | --- |
| Model id | `gpt-6-sol` | `gpt-6-luna` |
| API `reasoning.effort` | `none`, `low`, `medium` (default), `high`, `xhigh`, `max` | same |
| API context | 1,050,000; max input 922,000; max output 128,000 | same |
| Knowledge cutoff | 20 April 2026 | 18 May 2026 |
| Modalities | text + image in; text out | same |
| Price per 1M (input / cached / cache write / output) | $2 / $0.20 / $2.50 / $10 | $0.10 / $0.01 / $0.125 / $0.50 |
| Long prompts | >272K input tokens: 2× input and cache, 1.5× output, whole request | same |
| Batch / Flex / Fast | 50% / 50% / 2× | same |
| Predecessor price (launch post) | GPT-5.6 Sol $4 / $20 | GPT-5.6 Luna $0.20 / $1.20 |

Codex identity (S4 / high). The local Codex model cache
(`~/.codex/models_cache.json`, read 2026-09-22) lists:

- `gpt-6-sol`: efforts `low`, `medium`, `high`, `xhigh`, `max`, `ultra`
  ("Maximum reasoning with automatic task delegation"); default `medium`
- `gpt-6-luna`: efforts `low` through `max`; default `medium`
- both: `context_window` 272,000; `max_context_window` 872,000

Artificial Analysis measures Sol only up to **max**. No public source
measures Sol `ultra`.

## Comparable quantitative evidence

### Artificial Analysis Intelligence Index v4.3.2 and AA-Briefcase v1.1 (S1)

Values are the unrounded fields from each card's embedded model record
(`intelligenceIndexIsEstimated: false` for every row). Every card names
"Artificial Analysis Intelligence Index v4.3.2" and "AA-Briefcase v1.1".
Every GPT-6 Sol and Luna card displays **Speed N/A**. AA has no
output-speed measurement for either model yet.

| AA model | v4.3.2 index | AA-Briefcase v1.1 Elo [95% CI] | GDPval-AA v2.1 | Index cost / task | Card |
| --- | ---: | --- | ---: | ---: | --- |
| GPT-6 Luna (max) | **37.26** | **1299.23** [1290.31–1308.15] | 1367.09 | $0.07 | [gpt-6-luna](https://artificialanalysis.ai/models/gpt-6-luna) |
| GPT-6 Luna (xhigh) | 33.88 | 1216.68 [1207.15–1226.21] | 1296.78 | $0.04 | [gpt-6-luna-xhigh](https://artificialanalysis.ai/models/gpt-6-luna-xhigh) |
| GPT-6 Luna (high) | 32.15 | 1176.49 [1167.60–1185.37] | 1290.37 | $0.03 | [gpt-6-luna-high](https://artificialanalysis.ai/models/gpt-6-luna-high) |
| GPT-6 Luna (medium) | 29.46 | 1063.32 [1053.69–1072.95] | 1218.31 | $0.02 | [gpt-6-luna-medium](https://artificialanalysis.ai/models/gpt-6-luna-medium) |
| GPT-6 Sol (max) | **47.53** | **1482.78** [1472.91–1492.66] | 1486.93 | $1.06 | [gpt-6-sol](https://artificialanalysis.ai/models/gpt-6-sol) |
| GPT-6 Sol (xhigh) | 44.10 | 1363.66 [1353.47–1373.84] | 1436.68 | $0.53 | [gpt-6-sol-xhigh](https://artificialanalysis.ai/models/gpt-6-sol-xhigh) |
| GPT-6 Sol (high) | 42.82 | 1289.24 [1279.41–1299.07] | 1376.05 | $0.37 | [gpt-6-sol-high](https://artificialanalysis.ai/models/gpt-6-sol-high) |
| GPT-6 Sol (medium) | 39.78 | 1142.18 [1132.36–1152.00] | 1320.11 | $0.25 | [gpt-6-sol-medium](https://artificialanalysis.ai/models/gpt-6-sol-medium) |
| GPT-5.6 Luna (max), predecessor | 37.32 | 1345.38 [1336.57–1354.76] | — | — | [gpt-5-6-luna](https://artificialanalysis.ai/models/gpt-5-6-luna) |
| GPT-5.6 Sol (max), predecessor | 46.97 | 1487.42 [1479.13–1496.83] | — | — | [gpt-5-6-sol](https://artificialanalysis.ai/models/gpt-5-6-sol) |
| GPT-5.6 Sol (xhigh), predecessor | 44.01 | 1442.84 [1432.74–1453.53] | — | — | same card |
| GPT-5.6 Sol (high), predecessor | 42.35 | 1369.70 [1359.60–1378.95] | — | — | same card |

AA's release pages display the rounded ladder: Luna max 37, xhigh 34,
high 32, medium 29, low 21
([Luna release](https://artificialanalysis.ai/models/releases/gpt-6-luna));
Sol max 48 on the [Sol release](https://artificialanalysis.ai/models/releases/gpt-6-sol).
The Luna max card displays 150M Intelligence Index output tokens and a
$0.07 index-task cost. That is not a DeepSWE task cost.

AA's launch article
([GPT-6 Sol and Luna push the cost efficiency frontier](https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier),
22 September 2026) says Intelligence Index and Coding Agent Index scores
"remain level with GPT-5.6". Index-task cost halves: Sol max $1.06 vs
$1.99, Luna max $0.07 vs $0.18. Luna max "drops ~45 Elo points in
AA-Briefcase v1.1, while Sol is level" (the records: 1345.38 → 1299.23).
GDPval-AA falls ~100 Elo for Sol and ~75 for Luna. AA attributes the
regressions to "reduced presentation quality and deliverables that omit
rubric elements". AA-Omniscience hallucination falls from 92% to 60% (Sol
max) and from 93% to 77% (Luna max).

The records also show a regression the article does not discuss. Sol
**high** and **xhigh** Briefcase fall about 80 Elo from their GPT-5.6
counterparts (1369.70 → 1289.24; 1442.84 → 1363.66). Only Sol max is
level.

### Implementation boards

| Source | GPT-6 Sol | GPT-6 Luna | Predecessor rows on the same board | Strength |
| --- | --- | --- | --- | --- |
| [CursorBench 4.0](https://cursor.com/evals) | **no row** at any effort | **no row** at any effort | GPT-5.6 Luna Max 35.9%, $1.03; Sol Max 41.7%, $8.23; Sol Extra High 37.7%; Sol High 35.7% | S1 for absence |
| [DeepSWE v1.1](https://deepswe.datacurve.ai/), mini-swe-agent | **no row** | **no row** | Luna max 67.19% [63.20–71.18], $3.03; Sol max 72.67% [69.84–75.50], $8.39; Sol xhigh 70.73%; Sol high 69.40% | S1 for absence |
| [AA Coding Agent Index](https://artificialanalysis.ai/agents/coding-agents), **Codex** harness v0.154.0 | **max only**: DeepSWE v1.1 **69.03%** (337 attempts), SWE-Atlas-QnA 57.53%, Terminal-Bench 4.0 43.43%; index 56.7; $2.99 per task | **max only**: DeepSWE v1.1 **63.72%** (338 attempts), SWE-Atlas-QnA 44.35%, Terminal-Bench 4.0 15.15%; index 41.1; $0.18 per task | GPT-5.6 Luna max DeepSWE 66.37%, index 43.2; GPT-5.6 Sol max DeepSWE 72.27%, index 54.6 | S1, exact effort, launch harness, no interval |

DeepSWE's live JSON (`/artifacts/v1.1/leaderboard-live.json`) was
generated **2026-09-22T06:27:15Z** with 70 configurations. Its only GPT-6
model is `gpt-6-astra`. The [changelog](https://deepswe.datacurve.ai/changelog)
ends at the 3 September Astra entry. CursorBench's table lists 52 rows,
none GPT-6, and its changelog ends at the 10 September CursorBench 4.0
entry.

AA's Codex DeepSWE runs agree with Datacurve's independent mini-swe-agent
rows for the predecessors: GPT-5.6 Luna max 66.37% vs 67.19%, Sol max
72.27% vs 72.67%. The harness change moves these two rows by under one
point. That agreement is why this report accepts AA's exact-effort
Codex DeepSWE component as the implementation cell (see mapping). The
Coding Agent **Index** is still not used. It mixes three benchmarks.

### Arenas (S2)

| Board | Stamp | GPT-6 Sol | GPT-6 Luna | Nearest rows (not used) |
| --- | --- | --- | --- | --- |
| [Agent Arena](https://arena.ai/leaderboard/agent) | 15 September 2026, 1,850,083 sessions, 46 models | none | none | GPT 5.6 Sol (xHigh) rank 7 (spread 5–13), 7.10% ±1.28%; GPT 5.6 Luna (xHigh) rank 27 (spread 25–32), 0.44% ±0.84% |
| [Arena WebDev](https://arena.ai/leaderboard/code/webdev) | 22 September 2026, 735,398 votes, 130 models | none | none | `gpt-5.6-sol-xhigh (codex-harness)` rank 15, 1617; `gpt-5.6-luna-xhigh (codex-harness)` rank 37, 1520 |
| [Design Arena 3D](https://www.designarena.ai/leaderboard/3d-design) | `lastUpdateTime` 2026-09-22T18:06:11Z, 281,342 votes, 153 models | none | none | `gpt-5.6-sol-xhigh` rank 5, Elo 1409; `gpt-5.6-sol` rank 14; `gpt-5.6-luna` rank 84, Elo 1151 |

The Design Arena [changelog](https://www.designarena.ai/changelog) runs
through 20 September 2026 (last addition `gpt-6-astra-max`) and has no
GPT-6 Sol or Luna entry. The site's `/api/registry` lists only
`gpt-6-astra` and `gpt-6-astra-max` among GPT-6 models.

### Vendor claims (S3; fill no cell)

From the [launch post](https://openai.com/index/introducing-gpt-6-sol-and-luna/),
research environment or API harness, no intervals:

| Benchmark | Claim |
| --- | --- |
| DeepSWE v1.1 | Sol max **68.8%**; Luna max **66.6%**, "comparable to Claude Opus 5 and Fable 5 at medium effort" |
| AutomationBench 1.0.6 | Sol xhigh 33.2% at $0.27/task; Luna high +5.4 points over its predecessor at 58% lower cost per task |
| Agents' Last Exam | Sol max 56.4% |
| OSWorld 2.0 offline (partial reward) | Sol xhigh 60.5%; Luna max exceeds GPT-5.6 Sol medium at one tenth the cost |
| FrontierCode | Sol "match[es] Claude Fable 5.1 xhigh at much lower cost" (no number printed) |

The vendor DeepSWE numbers sit close to AA's Codex runs (68.8 vs 69.03;
66.6 vs 63.72) and below both predecessors' independent rows.

## Mapping onto catalog methodology

Methodology (from `routing-catalog.json`): reasoning = AA Intelligence
Index v4.3.2 / 100 at the exact effort, conservative −0.02. Implementation
= CursorBench 4.0 at the exact effort, else a labeled DeepSWE v1.1 rate.
Agentic = AA-Briefcase v1.1 Elo mapped `(Elo − 500) / 2000`, conservative
= mapped lower 95% bound − 0.02. UI and spatial-3d = rank percentiles at
the exact effort.

| Dimension | Luna max | Sol max | Evidence |
| --- | --- | --- | --- |
| reasoning | 37.26 → **0.37 / 0.35**, high | 47.53 → **0.48 / 0.46**, high | AA cards |
| implementation | DeepSWE v1.1 Codex 63.72% → **0.637 / 0.597**, medium | DeepSWE v1.1 Codex 69.03% → **0.69 / 0.662**, medium | AA Coding Agent Index record |
| agentic | 1299.23 [lower 1290.31] → **0.4 / 0.375**, medium | 1482.78 [lower 1472.91] → **0.491 / 0.466**, medium | AA cards, AA-Briefcase board, AA methodology |
| ui | **unknown** | **unknown** | WebDev, 22 Sep stamp |
| spatial-3d | **unknown** | **unknown** | Design Arena, 22 Sep 18:06Z |
| task cost | **unknown** | **unknown** | no DeepSWE board row; AA's Codex cost covers three benchmarks |
| speed | **unknown** | **unknown** | AA cards display Speed N/A |

Conservative rules applied here:

- **Reasoning and agentic** follow the normalization report exactly.
- **Implementation.** AA publishes no interval for its Codex DeepSWE run.
  The reserve is the predecessor's published Datacurve run-to-run
  half-width at the same effort on the same benchmark: **0.040** for Luna
  max (GPT-5.6 Luna max, ±3.99 points) and **0.028** for Sol max (GPT-5.6
  Sol max, ±2.83 points). No extra harness haircut: Codex is the launch
  harness. Confidence is medium because there is no interval and about
  three attempts per task (338 and 337 attempts over 113 tasks).
- **Scale label.** These implementation cells use the new label
  `DeepSWE v1.1 (Codex harness, Artificial Analysis)`. They must not be
  compared numerically with CursorBench 4.0 cells (GPT-5.6 Luna max
  0.359, Grok 4.7 high 0.439). The router letters the scales apart.
  DeepSWE runs about 30 points above CursorBench 4.0 for the same model.
  Comparison with Astra's `DeepSWE v1.1 (mini-swe-agent)` cell is close
  but not identical. The predecessor cross-check above shows under one
  point of harness difference.
- **Alternative.** If a Datacurve or CursorBench row is required for any
  implementation cell, both implementation cells become unknown with the
  reason "DeepSWE's 2026-09-22 board and CursorBench 4.0 have no GPT-6
  Sol or Luna row". Nothing else in this report changes.

Other Sol efforts, same rules (implementation unknown: AA ran max only):

| Effort | reasoning | agentic | Why not the proposed candidate |
| --- | ---: | ---: | --- |
| Sol xhigh | 0.44 / 0.42 | 0.432 / 0.407 | no implementation evidence at any board |
| Sol high | 0.43 / 0.41 | 0.395 / 0.370 | no implementation evidence; Briefcase below Luna max |

**Best-evidenced Sol effort: max.** It is the only Sol effort with an
exact coding measurement (AA Codex), and it leads the Sol ladder on both
the index and Briefcase.

## Side-by-side

Conservative values the router uses. Scales named where a column mixes
them: **C** = CursorBench 4.0, **D** = DeepSWE v1.1 (mini-swe-agent),
**X** = DeepSWE v1.1 (Codex harness, AA).

| Candidate | reasoning | implementation | agentic | ui | spatial-3d | task cost | tok/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **`codex/gpt-6-luna/max` (this report)** | **0.35** | **0.597 X** | **0.375** | unknown | unknown | unknown | unknown |
| **`codex/gpt-6-sol/max` (this report)** | **0.46** | **0.662 X** | **0.466** | unknown | unknown | unknown | unknown |
| `codex/gpt-5.6-luna/max` (catalog) | 0.35 | 0.329 C | 0.398 | unknown | unknown | $3.03 | 147.5 |
| GPT-5.6 Sol max (not in catalog; mapped here) | 0.45 | 0.387 C | 0.470 | not max | not max | $8.39 (D) | 82.0 |
| `codex/gpt-6-astra/high` (catalog) | 0.49 | 0.698 D | 0.479 | unknown | unknown | $3.9237 | 52.2 |
| `grok/grok-4.7/high` (catalog) | 0.44 | 0.409 C | 0.547 | unknown | unknown | unknown | 49.8 |

The GPT-5.6 Sol max row is computed from its AA card (46.97; Briefcase
1487.42, lower 1479.13), CursorBench 4.0 Max 41.7% minus the 0.03
reserve, DeepSWE's $8.39 mean, and AA's 82.0 tok/s median. It is
reference only, not a proposed cell.

Reading:

- **GPT-6 Luna max vs GPT-5.6 Luna max.** Reasoning is flat (37.26 vs
  37.32). Agentic falls 0.023 (Briefcase −46 Elo, outside both
  intervals). Coding falls in the same Codex harness (DeepSWE 63.7% vs
  66.4%; Coding Agent Index 41 vs 43). What improves is cost (about 60%
  lower per AA index task and per AA coding task) and hallucination rate.
  This is a cost upgrade at equal or slightly lower capability, not a
  capability upgrade. The implementation cells are on different scales
  (X vs C). Do not read 0.597 vs 0.329 as a gain.
- **GPT-6 Sol max.** Above Luna max on every measured dimension. Its
  reasoning (0.46) is above Grok 4.7 high (0.44) and below Astra high
  (0.49). Its agentic cell (0.466) is just below Astra high (0.479) and
  below Grok 4.7 high (0.547). On the AA Codex run it costs $2.99 per
  coding task versus Luna max's $0.18, about 17×.
- **Sol vs Astra for Captain work.** Astra high keeps a higher reasoning
  cell and an independent DeepSWE row with an interval. Sol max does not
  displace it.

## Is max still the right Luna effort for a worker?

Yes, on the public evidence.

- The Luna ladder is steep. Index: max 37.26, xhigh 33.88, high 32.15.
  Briefcase: max 1299, xhigh 1217, high 1176. Max leads xhigh by more than
  both intervals.
- Coding evidence exists only at max (AA Codex). The predecessor's
  independent DeepSWE ladder shows how fast coding falls below max: 67.2%
  at max, 56.9% at xhigh, 44.2% at high, 11.3% at medium. CursorBench
  4.0 shows the same shape for GPT-5.6 Luna (Max 35.9%, Medium 22.2%,
  Low 16.0%). No GPT-6 Luna row below max has been published, so this is
  predecessor evidence, not a GPT-6 measurement.
- Max is still cheap. AA's index-task cost is $0.07 at max versus $0.04
  at xhigh, and AA's Codex coding task costs $0.18.
- The cost of max is latency, not price. GPT-5.6 Luna max had a 122 s
  median time to first token on AA (xhigh 40 s, high 15 s). GPT-6 Luna
  has no AA speed or latency measurement yet. Expect the same shape until
  one is published.
- Alternative worth recording: **Sol high** has higher reasoning (0.41 vs
  0.35) and similar Briefcase (1289 vs 1299) at about 5× Luna max's
  index-task cost ($0.37 vs $0.07). It has no coding measurement. It is
  not a worker replacement on current evidence.

## Catalog cells

Proposed ids: `codex/gpt-6-luna/max` (worker replacement) and
`codex/gpt-6-sol/max` (optional Sol candidate). Context follows the Astra
precedent: the API window of 1,050,000 with the long-context feature.
Codex's own cache lists a 272,000 window (max 872,000). If the catalog
should describe the Codex window instead, drop `long-context` and use
272000. `economics` is empty: DeepSWE has no exact row, and AA shows
Speed N/A.

```json
{
  "codex/gpt-6-luna/max": {
    "launch": {
      "agent": "codex",
      "model": "gpt-6-luna",
      "effort": "max"
    },
    "features": ["tools", "vision", "long-context"],
    "context": 1050000,
    "context_evidence": "https://developers.openai.com/api/docs/models/gpt-6-luna",
    "capabilities": {
      "reasoning": {
        "status": "known",
        "score": 0.37,
        "conservative": 0.35,
        "confidence": "high",
        "assessed_at": "2026-09-22",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-luna"
        ],
        "scale": "AA Intelligence Index v4.3.2",
        "note": "GPT-6 Luna (max) 37.26 on v4.3.2; score = index/100, conservative = score - 0.02."
      },
      "implementation": {
        "status": "known",
        "score": 0.637,
        "conservative": 0.597,
        "confidence": "medium",
        "assessed_at": "2026-09-22",
        "evidence": [
          "https://artificialanalysis.ai/agents/coding-agents",
          "https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier"
        ],
        "scale": "DeepSWE v1.1 (Codex harness, Artificial Analysis)",
        "note": "Exact max row 63.72% (338 attempts) in Codex v0.154.0; no published interval, so conservative = score - 0.040, GPT-5.6 Luna max's published DeepSWE run-to-run half-width. DeepSWE's own board and CursorBench 4.0 have no GPT-6 Luna row. Not comparable with CursorBench 4.0 cells."
      },
      "agentic": {
        "status": "known",
        "score": 0.4,
        "conservative": 0.375,
        "confidence": "medium",
        "assessed_at": "2026-09-22",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-luna",
          "https://artificialanalysis.ai/evaluations/aa-briefcase",
          "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
        ],
        "scale": "AA-Briefcase v1.1 Elo, mapped",
        "note": "Exact AA-Briefcase v1.1 Elo 1299.23 (95% CI lower 1290.31); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
      },
      "ui": {
        "status": "unknown",
        "reason": "Arena WebDev (stamp 2026-09-22, 130 models) has no gpt-6-luna row at any effort.",
        "researched_at": "2026-09-22"
      },
      "spatial-3d": {
        "status": "unknown",
        "reason": "Design Arena's 3D board (data stamp 2026-09-22T18:06Z, 153 models), registry, and changelog through 2026-09-20 have no gpt-6-luna entry.",
        "researched_at": "2026-09-22"
      }
    },
    "economics": {}
  },
  "codex/gpt-6-sol/max": {
    "launch": {
      "agent": "codex",
      "model": "gpt-6-sol",
      "effort": "max"
    },
    "features": ["tools", "vision", "long-context"],
    "context": 1050000,
    "context_evidence": "https://developers.openai.com/api/docs/models/gpt-6-sol",
    "capabilities": {
      "reasoning": {
        "status": "known",
        "score": 0.48,
        "conservative": 0.46,
        "confidence": "high",
        "assessed_at": "2026-09-22",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-sol"
        ],
        "scale": "AA Intelligence Index v4.3.2",
        "note": "GPT-6 Sol (max) 47.53 on v4.3.2; score = index/100, conservative = score - 0.02."
      },
      "implementation": {
        "status": "known",
        "score": 0.69,
        "conservative": 0.662,
        "confidence": "medium",
        "assessed_at": "2026-09-22",
        "evidence": [
          "https://artificialanalysis.ai/agents/coding-agents",
          "https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier"
        ],
        "scale": "DeepSWE v1.1 (Codex harness, Artificial Analysis)",
        "note": "Exact max row 69.03% (337 attempts) in Codex v0.154.0; no published interval, so conservative = score - 0.028, GPT-5.6 Sol max's published DeepSWE run-to-run half-width. DeepSWE's own board and CursorBench 4.0 have no GPT-6 Sol row. Not comparable with CursorBench 4.0 cells."
      },
      "agentic": {
        "status": "known",
        "score": 0.491,
        "conservative": 0.466,
        "confidence": "medium",
        "assessed_at": "2026-09-22",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-sol",
          "https://artificialanalysis.ai/evaluations/aa-briefcase",
          "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
        ],
        "scale": "AA-Briefcase v1.1 Elo, mapped",
        "note": "Exact AA-Briefcase v1.1 Elo 1482.78 (95% CI lower 1472.91); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
      },
      "ui": {
        "status": "unknown",
        "reason": "Arena WebDev (stamp 2026-09-22, 130 models) has no gpt-6-sol row at any effort.",
        "researched_at": "2026-09-22"
      },
      "spatial-3d": {
        "status": "unknown",
        "reason": "Design Arena's 3D board (data stamp 2026-09-22T18:06Z, 153 models), registry, and changelog through 2026-09-20 have no gpt-6-sol entry.",
        "researched_at": "2026-09-22"
      }
    },
    "economics": {}
  }
}
```

The in-progress catalog edit in this worktree points both the `worker`
route and the `codex/gpt-5.6-luna/max` entry's launch at `gpt-6-luna`
while that entry still carries GPT-5.6 Luna cells (CursorBench 0.359,
Briefcase 1345.38, $3.03, 147.5 tok/s). Those cells are GPT-5.6
measurements. Replace them with the `codex/gpt-6-luna/max` object above,
or keep the old id only with its original `gpt-5.6-luna` launch. Do not
carry the $3.03 task cost or the 147.5 tok/s forward.

## Honest gaps

- No DeepSWE board row and no CursorBench 4.0 row for either model as of
  2026-09-22. The implementation cells rest on AA's Codex DeepSWE
  component: exact effort and launch harness, but no interval, about
  three attempts per task, and max effort only.
- AA shows Speed N/A for every GPT-6 Sol and Luna effort. There is no
  published output speed or time-to-first-token. Luna max latency is
  inferred from the predecessor only.
- No task cost qualifies. AA's $0.18 (Luna max) and $2.99 (Sol max) per
  Codex coding task average three benchmarks, not DeepSWE alone. This
  report does not reprice token counts.
- No Agent Arena, WebDev, or Design Arena row for either model. The
  GPT-5.6 xhigh rows are predecessor, other-effort data.
- AA-Briefcase and GDPval-AA make up 25% of the v4.3.2 index, so the
  reasoning and agentic cells are correlated.
- Sol `ultra` (Codex only, "automatic task delegation") has no public
  measurement at all.
- The launch post was fetched through a text reader because openai.com
  returned HTTP 403 to direct requests. Its numbers are S3 and fill no
  cell.
- Secondary press (The New Stack and others surfaced by search) was not
  used for any number.
