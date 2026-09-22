# Grok 4.7 capability evidence

> Score update, 2026-09-22: catalog scores now sit on one scale per
> dimension. See [score normalization](model-routing-score-normalization-2026-09-22.md).

> Maintained-catalog assessment as of 2026-09-22 (Europe/Lisbon). This file
> is the 4.7 assessment for `grok/grok-4.7/high` and `claudex/grok-4.7/high`.
> The [Grok 4.6 snapshot](grok-4.6-capability-evidence-2026-08-13.md) stays a
> dated record of the 4.6 measurements. Do not relabel those numbers as 4.7.

Research date: 2026-09-22 (Europe/Lisbon)

## Question and boundary

This report replaces the catalog cells for `grok/grok-4.6/high` and
`claudex/grok-4.6/high` with an assessment of the same two launchers on
Grok 4.7 at **high** effort:

- `grok/grok-4.7/high` (agent `grok`)
- `claudex/grok-4.7/high` (agent `claudex`, same model and effort)

It does **not** change selector weights or exact routes. It does **not**
copy the 4.6 scores, including agentic 0.88 / 0.82.

Public research only. No local model evaluation contributes scores. The
local `grok models` listing is identity evidence only. Vendor tables are
S3. Independent operator measurements are S1/S2.

Exact means the published number names this model **and** high effort.
Anything else that is still usable is a labeled effort proxy. Missing
direct evidence stays unknown.

Peers cited from existing files, not re-measured here:

- `claude/claude-fable-5-1[1m]/high` —
  [Fable 5.1 evidence](fable-5-1-capability-evidence-2026-09-02.md) and the
  live catalog
- `codex/gpt-6-astra/high` —
  [Astra evidence](gpt-6-astra-capability-evidence-2026-09-04.md) and the
  live catalog
- Grok 4.6 high — the 2026-08-13 snapshot, as the predecessor

## What Grok 4.7 is

SpaceXAI released Grok 4.7 on 21 September 2026. The current docs brand
the lab SpaceXAI. The API host is still `https://api.x.ai/v1`. Official
positioning: a frontier model for coding, agentic tasks, and knowledge
work, on a larger base than Grok 4.6, with a longer reinforcement-learning
run aimed at multi-hour tasks. The launch post says it is served at the
same price and speed as Grok 4.6.

The API model id and the Grok CLI default are both `grok-4.7`. On
2026-09-22, `grok models` (`/Users/rafaelvidaurre/.grok/bin/grok`, logged
in with grok.com) printed:

- default: `grok-4.7`
- also listed: `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`

`grok-4.7-build-fast` is the CLI name for the Fast variant. It is not the
public API id, and it is not the catalog candidate. The CLI listing does
not set capability scores.

Official identifiers and interface (S3 / high):

| Spec | Value | Source |
| --- | --- | --- |
| Model id | `grok-4.7` | [Grok 4.7 developer docs](https://docs.x.ai/developers/grok-4-7) |
| Context | 500,000 tokens | same, [model detail](https://docs.x.ai/developers/models/grok-4.7), and [models list](https://docs.x.ai/developers/models). `https://docs.x.ai/docs/models` redirects to the models list |
| Knowledge cutoff | May 2026 | [Grok 4.7 developer docs](https://docs.x.ai/developers/grok-4-7) and the models list |
| Modalities | text + image in; text out | same |
| Output limit | No text output limit | [Grok 4.7 developer docs](https://docs.x.ai/developers/grok-4-7) |
| Reasoning effort | `low`, `medium`, `high` (default), `xhigh` | same; default repeated on the [model detail](https://docs.x.ai/developers/models/grok-4.7) |
| Tools | function calling, web search, X search, code execution. Structured outputs: yes | developer docs; structured outputs on the model detail |
| List price &lt;200k prompt | $2.00 in / $0.50 cached / $6.00 out per 1M | [models list](https://docs.x.ai/developers/models) and [pricing](https://docs.x.ai/developers/pricing) |
| List price ≥200k prompt | $4.00 / $1.00 / $12.00 for the **whole** request | same |
| Batch | not supported; no batch discount | [model detail](https://docs.x.ai/developers/models/grok-4.7); pricing lists a 20% batch discount only for older ids |
| Priority processing | 2× standard token rates on the public API, after the cache discount, only when the response says `service_tier: priority` | [pricing](https://docs.x.ai/developers/pricing) |
| Fast variant | same model, Cursor and Grok Build only, not on the public API. Below 200k: $4.00 / $1.00 / $12.00. Above 200k: $6.00 / $1.50 / $18.00 | [pricing](https://docs.x.ai/developers/pricing#grok-47-fast-pricing-cursor-and-grok-build-only) |
| US regional endpoint | `https://us.api.x.ai/v1`, 1.1× global token rates | same pricing page |

The Fast section's prose says "twice the standard token rates." That
matches the below-200k Fast row (2× $2 / $0.50 / $6). It does **not**
match the above-200k Fast row. Twice the standard long-context rates
would be $8 / $2 / $24. The table says $6 / $1.50 / $18. Use the table.

Launch post: [Introducing Grok 4.7](https://x.ai/news/grok-4-7). Rate
limits on the model detail: 150 requests/second, 50,000,000 tokens/minute.
Regions listed there: us-east-1, us-west-2, us-central-1.

Catalog features this evidence supports: `tools`, `vision`. Not
`long-context`. The documented window is 500,000 tokens, the same window
the 4.6 candidates carried without a long-context flag. Do not record
2M, and do not record Cursor's separate 256k display as the API window.

## Comparable quantitative evidence

Artificial Analysis Intelligence Index **v4.3.2** is not the index behind
the catalog's Astra 60, Fable 62, or the August 4.6 snapshot's 61. A 46
on v4.3.2 is not 15 points worse than those older scores. On the 4.7
release page, Grok 4.6's highest listed intelligence is **44**, and both
4.7 efforts display **46**. The 21 September article says 4.7 is +2 over
4.6 and that AA's own evaluation used **xhigh**. The high card
independently displays the same rounded 46.

| Signal | Grok 4.7 | Grok 4.6 high (2026-08-13 snapshot) | GPT-6 Astra high | Claude Fable 5.1 high | Strength |
| --- | ---: | ---: | ---: | ---: | --- |
| AA Intelligence Index | **46** at high, v4.3.2. xhigh card also **46** | **61** on the index AA was publishing in August, not v4.3.2 | **60**, v4.1.1 | **62**, v4.1.1 | S1 for each card. Not one scale |
| AA index-task cost | **$2.73** at high; **$3.74** at xhigh | **$0.84** on the old index | **$0.96**, v4.1.1 | **$1.43**, v4.1.1 | S1. Not DeepSWE cost, and not comparable across index versions |
| AA output speed | **54.2 tok/s** at high (release table rounds to 55). xhigh card **39.5** (release table 39) | **65.5 tok/s** | unavailable as of 2026-09-04 | **49.1 tok/s** | S1, different observation dates |
| DeepSWE v1.1, mini-swe-agent | **not published** | snapshot used **67% ±2%** at **xhigh**, $5.50/task, as a proxy for high | **73.23%**, $5.7237/task, exact high, expected-launch prices | no 5.1 row in the 2026-09-02 report | S1 where a row exists |
| DeepSWE task cost | **not published** | $5.50, xhigh proxy in the snapshot | $5.7237, launch-price basis | unknown under the DeepSWE-only rule | — |
| AA-Briefcase | **1657** Elo, article's **xhigh** run. High Elo not published | snapshot **1577**, treated there as high | not a high figure in the Astra report | max **1694** in the 2026-09-02 report; not high | S1 for the 4.7 xhigh article. Not an exact high cell |
| GDPval-AA | **1695** Elo, same xhigh article, vs 1605 for 4.6 high | snapshot **1753** | not used as an exact high cell | max **1853** in the 2026-09-02 report; not high | S1, xhigh |
| Agent Arena | **no 4.7 row** | absent on the August snapshot. The 15 Sep 2026 board now lists **Grok 4.6 (xHigh)** at rank 21, not high | no exact high row in the Astra report | no exact high row in the Fable report | S2 for the absence |
| WebDev Arena | **no 4.7 row** | snapshot **#5** `grok-4.6-high` at 1630 | no exact high row in the Astra report | no 5.1 row in the Fable report | S2 for the absence |
| Design Arena 3D | no 4.7 ranking recovered | no dated rank on 2026-08-13 | no dated rank in the Astra report | no dated rank in the Fable report | missing |
| AA Coding Agent Index | **56**, Grok 4.7 **xhigh** in **Grok Build** | not this cell | not copied into Astra's resolved-task score | not a high DeepSWE row | S1, wrong effort and harness for this cell |

Sources checked 2026-09-22:
[AA high card](https://artificialanalysis.ai/models/grok-4-7-high),
[AA xhigh card](https://artificialanalysis.ai/models/grok-4-7),
[AA release comparison](https://artificialanalysis.ai/models/releases/grok-4-7),
[AA article, 21 September 2026](https://artificialanalysis.ai/articles/benchmarking-grok-4-7),
[DeepSWE](https://deepswe.datacurve.ai/),
[Agent Arena](https://arena.ai/leaderboard/agent),
[WebDev Arena](https://arena.ai/leaderboard/code/webdev),
[Design Arena](https://www.designarena.ai/leaderboard),
[Design Arena changelog](https://www.designarena.ai/changelog),
[xAI launch table](https://x.ai/news/grok-4-7).

The high card does not print a separate observation clock. It says the
model was released 21 September 2026 and marks intelligence "Updated."
The article is dated 21 September 2026. This pass fetched the cards on
22 September 2026. The high card also reports time-to-first-answer-token
**0.84s**, 200M Intelligence Index output tokens for the whole run, and
a 7:2:1 cache-hit/input/output blended price of **$1.35** per 1M tokens.
The release table's Price column shows **$1.4** for both efforts. That
column is not the $2.73 index-task cost. None of these are DeepSWE task
cost.

The article's own run is xhigh. It reports about **81k** output tokens
per Intelligence Index task, about **7.1** minutes per task, and about
**188 tok/s** on long prompts. Those figures are not the high card's
**54.2 tok/s** median. Do not put 188 in the speed cell. The same article
gives xhigh component moves versus 4.6 high: Terminal-Bench 4.0 +4.5
points, GDP.pdf +3.0 points, AA-LCR −3.7 points, AutomationBench-AA
−1.1 points. It does not print the absolute AA Terminal-Bench percent.
AA-Omniscience hallucination is 29% versus 34% for 4.6 high; accuracy
47% versus 48%; the omniscience index 32 versus 30. Briefcase analytical
quality is 1994 Elo versus 1690, and presentation is 1499 versus 1519.
The combined 1657 gain is analytical. Presentation did not improve.

Coding Agent Index detail, still xhigh and still Grok Build: DeepSWE
v1.1 65% to **73%**, Terminal-Bench 4.0 18% to **33%**, SWE-Atlas-QnA
58% to **63%**. Ranked 4th among native harnesses, behind Claude Fable
5.1, GPT-6 Astra, and Claude Opus 5. The article does not print those
three peers' index values. This is not the catalog implementation cell.
The Astra report already refused to copy a Coding Agent Index into the
resolved-task scale.

DeepSWE's public board, checked 2026-09-22, says it was updated that
day. Its live JSON (`/artifacts/v1.1/leaderboard-live.json`) was
generated **2026-09-22T06:27:15Z**, 113 tasks, 70 configurations, harness
`mini-swe-agent`. Model ids present for this lab are `grok-4-5` and
`grok-4-6` only. There is no `grok-4.7` row at any effort. The changelog
has no 4.7 entry; the last Grok add is 4.6 on 12 August 2026. The 4.6
rows that are still on the board are predecessor data. They are not a
4.7 measurement, and this report does not replace the August snapshot
with them.

xAI's launch table is S3. The 4.7 column is **xHigh**, except DeepSWE,
which is footnoted **high effort**. Competitor columns are Grok 4.6
High, GPT-5.6 Sol Max, and Fable 5.1 Max.

| Benchmark | Grok 4.7 | Grok 4.6 High | Sol Max | Fable 5.1 Max |
| --- | ---: | ---: | ---: | ---: |
| Input / output $ per 1M | $2 / $6 | $2 / $6 | $4 / $20 | $10 / $50 |
| CursorBench 4.0 | 46.3% (xHigh column) | 40.4% | 41.7% | 51.8% |
| DeepSWE v1.1 | **71.0% at high** | 65.2% | 72.7% | 70.0% |
| EEBench | 64.0% | 53.0% | 39.4% | 56.4% |
| AA Briefcase v1.1 | 1,657 | 1,546 | 1,487 | 1,678 |
| Terminal-Bench 4.0 | 38.0% | 20.3% | 37.3% | 57.9% |
| Harvey Legal Agent Benchmark | 19.6% | 15.8% | 2.5% | 6.7% |
| HealthBench Professional | 56.7% | 48.5% | 60.5% | 62.1% |

The vendor DeepSWE cell names high effort, but it gives no harness, no
interval, and no cost. It is not the independent mini-swe-agent row.
CursorBench 4.0 at 46.3% is the xHigh column, a different benchmark
version from Fable 5.1 high's CursorBench 3.2 at 69.4%, and it is not
Cursor's public leaderboard. Neither vendor number fills the
implementation cell.

Agent Arena, fetched 2026-09-22, still stamps **15 September 2026**,
1,850,083 sessions, 46 models. Grok rows on that board are Grok 4.5
(rank 19, 2.92% ±0.99% net improvement) and Grok 4.6 (xHigh) (rank 21,
2.01% ±1.05%, 22,548 sessions). No Grok 4.7 row, and no Grok 4.6 high
row. WebDev's full board (`/leaderboard/code/webdev`) stamps **11
September 2026**. Its HTML contains `grok-4.6` and does not contain
`grok-4.7`. The overview top 10 also has no 4.7 row. Design Arena's
changelog runs through **20 September 2026** and has no `grok-4.7`
addition. The 3D leaderboard page did not render a model table on this
pass.

## Mapping onto catalog methodology

The catalog scores `conservative` for routing. Exact means the published
number matches the candidate's model **and** effort. Otherwise the cell
is a labeled effort proxy.

| Dimension | Raw published number | Catalog score / conservative | Confidence | Exact or proxy | Evidence |
| --- | --- | ---: | --- | --- | --- |
| reasoning | AA Intelligence Index **46** for Grok 4.7 **high**, v4.3.2. xhigh also displays 46 | **0.46 / 0.44** | high | exact | [AA high card](https://artificialanalysis.ai/models/grok-4-7-high), [AA release page](https://artificialanalysis.ai/models/releases/grok-4-7) |
| implementation | no independent DeepSWE or CursorBench row names `grok-4.7`. Vendor S3 DeepSWE **71.0%** is high but harness-unnamed. AA's **73%** is xhigh inside Grok Build | **unknown** | — | missing independent row. Do not enter 0.71 or 0.73 | [DeepSWE](https://deepswe.datacurve.ai/), [launch table](https://x.ai/news/grok-4-7), [AA article](https://artificialanalysis.ai/articles/benchmarking-grok-4-7) |
| agentic | AA-Briefcase **1657** and GDPval-AA **1695**, article's **xhigh** run. Agent Arena has **no 4.7 row** | **0.80 / 0.74** | medium | xhigh agentic-work proxy | [AA article](https://artificialanalysis.ai/articles/benchmarking-grok-4-7), [Agent Arena](https://arena.ai/leaderboard/agent) |
| ui | no `grok-4.7` row on the WebDev board | **unknown** | — | missing | [WebDev Arena](https://arena.ai/leaderboard/code/webdev) |
| spatial-3d | no dated Design Arena 3D rank | **unknown** | — | missing | [Design Arena](https://www.designarena.ai/leaderboard), [changelog](https://www.designarena.ai/changelog) |
| task cost | no DeepSWE average for 4.7 at any effort | **unknown** | — | missing. AA's $2.73 is an index-task cost, not this cell | [DeepSWE](https://deepswe.datacurve.ai/) |
| speed | AA **54.2 tok/s** at high | **54.2** | high | exact | [AA high card](https://artificialanalysis.ai/models/grok-4-7-high) |

Conservative haircuts, tied to this evidence:

- **2 points** on the exact v4.3.2 index (46 → 0.44). Same reserve the
  Fable and Astra high cells use for an exact AA index. High and xhigh
  both display 46, so there is no extra effort haircut on the rounded
  index. The 2 points are not the old 61 → 0.59 haircut copied onto a
  new scale.
- **No implementation number.** An xhigh Grok Build component and a
  vendor high percent are not an independent mini-swe-agent row. The
  4.6 file could proxy because that board had published an xhigh row.
  This board has not published 4.7 at all.
- **Agentic starts from the catalog's Opus 5 high Briefcase cell of
  0.88, then leaves it.** That cell is the existing Fable-tier
  agentic-work anchor (assessed 2026-07-31). It is not the 4.6 score,
  and 0.88 / 0.82 is not reused. The launch table puts xhigh Briefcase
  21 Elo behind Fable 5.1 Max (1,657 vs 1,678), so the result is
  frontier-adjacent, not better than that anchor. **8 points** come off
  for effort: the published Elo is xhigh, and no high-effort Briefcase
  or GDPval Elo is printed (0.88 → **0.80**). **Another 6 points** come
  off because Agent Arena has no 4.7 row (0.80 → **0.74**). The 6-point
  Arena gap is the same size as the 4.6 report's Arena haircut, applied
  to this lower score rather than to 0.88. Confidence stays medium
  also because Grok 4.6 xHigh, once Arena listed it, ranked 21 of 46.
  That is a warning about Briefcase-to-Arena transfer for this family.
  It is not a 4.7 rank, and it is not subtracted a second time.
- **No UI haircut**, because there is no 4.7 WebDev row to haircut.
  The August #5 / 0.89 / 0.84 cell stays on the 4.6 snapshot.

## Side-by-side with the live catalog peers

Conservative values the router actually uses. Reasoning numbers are
**not** on one Intelligence Index. 0.44 is v4.3.2 divided by 100.
0.60, 0.58, and 0.59 are older index versions. On v4.3.2, AA's 4.7
release page places 4.7 at 46 and the best Grok 4.6 model at 44.

| Candidate | reasoning | implementation | agentic | ui | spatial-3d | task cost | speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `claude/claude-fable-5-1[1m]/high` | 0.60 | 0.67 | unknown | unknown | unknown | unknown | 49.1 |
| `codex/gpt-6-astra/high` | 0.58 | 0.698 | unknown | unknown | unknown | $5.7237 | unknown |
| Grok 4.6 high (2026-08-13 snapshot) | 0.59 | 0.63 | 0.82 | 0.84 | unknown | $5.50 | 65.5 |
| **Grok 4.7 high (this assessment)** | **0.44** | **unknown** | **0.74** | **unknown** | **unknown** | **unknown** | **54.2** |

Reading:

- **Reasoning.** The exact high card is 46 on v4.3.2, tied on the
  rounded index with xhigh and two points above the best 4.6 model on
  that same page. Do not rank 0.44 under Astra's 0.58 or Fable's 0.60.
  Those catalog cells have not been restated on v4.3.2. Inside the 4.7
  release, high is the faster and cheaper effort at the same displayed
  index ($2.73 and 54.2 tok/s versus $3.74 and 39.5).
- **Implementation.** Unknown for both new candidates. Astra high still
  has an exact DeepSWE row. Fable 5.1 high still has CursorBench 3.2.
  4.7 has neither on an independent board. The vendor high DeepSWE
  figure of 71.0% and the Grok Build xhigh component of 73% are
  recorded above and are not scores.
- **Agentic.** 0.74 is an xhigh Briefcase/GDPval proxy with the
  haircuts above. It is not the old 0.82, and it is not an Arena
  ordinal. Fable 5.1 high and Astra high remain unknown on this
  dimension. Do not treat 0.74 as a win over those unknowns.
- **UI and 3D.** Unknown. The 4.6 WebDev rank is not a 4.7 rank.
- **Speed.** 54.2 tok/s is the exact high API figure. It is slower
  than the August 4.6 snapshot's 65.5 and faster than Fable 5.1 high's
  49.1 on the dates those cards were assessed. Serving speed moves.
- **Economics.** List price stays $2 / $0.50 / $6 under 200k prompt
  tokens, and the whole request doubles at ≥200k. That price is not a
  DeepSWE task cost. Task cost is unknown. AA's $2.73 is the cost of
  one v4.3.2 index task at high, not a routing task-cost.

## Recommendation for both catalog candidates

Apply the same capability cells to `grok/grok-4.7/high` and
`claudex/grok-4.7/high`. Same model id `grok-4.7`, same default effort
`high`. Harness transfer is already expressed by leaving implementation
unknown and by the agentic conservative. Change only the agent token.

Do **not** copy Grok 4.6 scores. Do **not** invent an Agent Arena,
WebDev, or Design Arena rank. Do **not** treat 500k as 2M. Do **not**
put the AA index-task cost or the vendor 71.0% into `task_cost_usd`
or `implementation`.

```json
{
  "launch": {
    "agent": "grok",
    "model": "grok-4.7",
    "effort": "high"
  },
  "features": ["tools", "vision"],
  "context": 500000,
  "context_evidence": "https://docs.x.ai/developers/grok-4-7",
  "capabilities": {
    "reasoning": {
      "status": "known",
      "score": 0.46,
      "conservative": 0.44,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/grok-4-7-high",
        "https://artificialanalysis.ai/models/releases/grok-4-7"
      ]
    },
    "implementation": {
      "status": "unknown",
      "reason": "DeepSWE's 2026-09-22 mini-swe-agent leaderboard has no grok-4.7 row at any effort. The vendor 71.0% high cell has no harness, interval, or cost. Artificial Analysis's 73% DeepSWE component is xhigh inside Grok Build, not an exact high resolved-task rate.",
      "researched_at": "2026-09-22"
    },
    "agentic": {
      "status": "known",
      "score": 0.8,
      "conservative": 0.74,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/articles/benchmarking-grok-4-7",
        "https://arena.ai/leaderboard/agent"
      ]
    },
    "ui": {
      "status": "unknown",
      "reason": "Arena WebDev, checked 2026-09-22 (board stamp 11 September 2026), has no grok-4.7 row.",
      "researched_at": "2026-09-22"
    },
    "spatial-3d": {
      "status": "unknown",
      "reason": "Design Arena's changelog through 20 September 2026 has no grok-4.7 addition, and the 3D leaderboard did not render a dated rank on 2026-09-22.",
      "researched_at": "2026-09-22"
    }
  },
  "economics": {
    "output_tokens_per_second": {
      "value": 54.2,
      "basis": "Artificial Analysis, Grok 4.7 high",
      "assessed_at": "2026-09-22",
      "source": "https://artificialanalysis.ai/models/grok-4-7-high"
    }
  }
}
```

For `claudex/grok-4.7/high`, use the same object with `"agent": "claudex"`.
No `task_cost_usd` field: DeepSWE did not publish one. The 4.6 claudex
entry's note that the proxy route bills the Grok provider is launcher
billing, not a new measurement, and is not restated here as a score.

The agentic score is written `0.8` to match the catalog's existing
style for a two-digit tenth (`0.6` for Astra's 0.60). The conservative
stays `0.74`. Both mean 0.80 / 0.74.

## Honest gaps

- Intelligence Index v4.3.2 replaced the scale used for the August 4.6
  snapshot (61) and for the live Astra (60, v4.1.1) and Fable 5.1 (62,
  v4.1.1) catalog cells. This file records 46 and does not rescale the
  peers.
- High and xhigh both display 46. The rounded index does not show an
  effort gap. The article's narrative evaluation is xhigh. Token use
  and index-task cost are higher at xhigh (240M output tokens and
  $3.74 versus 200M and $2.73 on the cards).
- DeepSWE has no 4.7 configuration as of the 2026-09-22T06:27:15Z
  extract. Implementation and DeepSWE task cost are unknown. The
  vendor 71.0% high cell and the Grok Build 73% xhigh component stay
  outside the score.
- Agentic is an xhigh Briefcase (1657) and GDPval (1695) proxy. No
  high-effort Elo for either benchmark was printed. Agent Arena has
  no 4.7 row. The old 0.88 / 0.82 cell is not carried forward. Grok
  4.6 xHigh's new Arena rank (21 of 46 on the 15 September stamp) is
  a transfer warning, not a 4.7 score.
- WebDev has no 4.7 row. Design Arena's changelog through 20 September
  2026 has no 4.7 entry, and the 3D page did not yield a rank.
- The AA high card has no separate measurement timestamp beyond the
  21 September 2026 release and an "Updated" badge.
- The article's ~188 tok/s long-prompt figure is not the high card's
  54.2 tok/s output speed. The speed cell uses 54.2.
- Fast pricing prose ("twice standard") disagrees with the Fast
  long-context table ($6 / $1.50 / $18, not $8 / $2 / $24). The table
  is the figure used here. Priority processing at 2× is a separate
  public-API tier, not the Fast SKU.
- No public SWE-rebench or review-quality number for 4.7 was used.
- Secondary writeups that quoted an AA Terminal-Bench absolute the
  article does not print were not used.
