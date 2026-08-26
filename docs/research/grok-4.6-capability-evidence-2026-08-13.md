# Grok 4.6 capability evidence

Research date: 2026-08-13 (Europe/Lisbon)

## Question and boundary

This report replaces the 2026-08-13 catalog reset that left both Grok 4.6
candidates (`grok/grok-4.6/high` and `claudex/grok-4.6/high`)
as unknown. It does **not** change selector weights or exact routes.

> Renamed 2026-08-26: `claude/grok-4.6-via-claude-code/high` became
> `claudex/grok-4.6/high` when claudex gained its own catalog agent token.
> Same model, same effort, same evidence — only the launcher identity moved
> out of the model name.


The 2026-07-31 Crew matrix measured **Grok 4.5 high**. Those numbers must not
be relabelled as 4.6. This file is the 4.6 assessment.

Public research only. No local model evaluation contributes scores. Vendor
tables are labeled S3. Independent operator measurements are S1/S2.

## What Grok 4.6 is

xAI released Grok 4.6 on 12 August 2026 as the successor to Grok 4.5. Official
positioning: a frontier model for coding, agentic tasks, and knowledge work,
trained for longer-running agents and stronger first cuts on visual /
interactive artifacts. xAI's headline claim: it matches GPT-5.6 Sol on the
Artificial Analysis Intelligence Index.

Official identifiers and interface (S3 / high):

| Spec | Value | Source |
| --- | --- | --- |
| Model id | `grok-4.6` | [Grok 4.6 developer docs](https://docs.x.ai/developers/grok-4-6) |
| Context | 500,000 tokens (not 2M) | same, and [models list](https://docs.x.ai/docs/models) |
| Knowledge cutoff | 1 February 2026 | same |
| Modalities | text + image in; text out | same |
| Reasoning effort | `low`, `medium`, `high` (default), `xhigh` | [Grok 4.6 developer docs](https://docs.x.ai/developers/grok-4-6) |
| Tools | function calling, web search, X search, code execution | same |
| List price &lt;200k prompt | $2.00 in / $0.50 cached / $6.00 out per 1M | [models list](https://docs.x.ai/docs/models) |
| List price ≥200k prompt | $4.00 / $1.00 / $12.00 for the **whole** request | same |
| Fast / priority variant | 2× standard rates | [launch post](https://x.ai/news/grok-4-6) |

Launch post: [Grok 4.6](https://x.ai/news/grok-4-6).

## Comparable quantitative evidence

| Signal | Grok 4.6 | Grok 4.5 high | GPT-5.6 Sol | Claude Fable 5 | Strength |
| --- | ---: | ---: | ---: | ---: | --- |
| AA Intelligence Index | **61** (high) | 56 (AA) / 54 in the 2026-07-31 catalog | **61** (max) | **62** (max with fallback) | S1 / high |
| DeepSWE v1.1 Pass@1 | **67% ±2%** at **xhigh**, $5.50/task | 54% ±2% at high, $2.42 | 73% ±3% at max, $8.39 | 70% ±4% at max, $21.63 | S1 / high for the labeled effort |
| xAI-table DeepSWE | 65.9% at High | 54% at High | 73% at Sol Max | 70% at Fable 5 Max | S3; matches the independent 4.5 high number |
| GDPval-AA v2 Elo | **1753** | 1526 | 1728 (Sol Max) | 1741 (Fable 5 Max) | S1 via AA article; S3 on the xAI table |
| AA-Briefcase Elo | **1577** | 1313 | 1502 (Sol Max) | 1574 (Fable 5 Max) | S1 via AA article; S3 on the xAI table |
| Terminal-Bench v2.1 | **88.4%** (AA; level with leaders) | — | — | — | S1 / high |
| Terminal-Bench v3.0 | 26% (xAI table) | 15.7% | 34.6% (Sol Max) | 34.1% (Fable 5 Max) | S3; 4.6 trails this trio |
| Agent Arena | **absent** on the 2026-08-12 snapshot | #15, 6.00% net improvement | Sol xHigh #4, 10.80% | Fable 5 High #3, 11.98% | S2 / high for absence |
| WebDev Arena | **#5** `grok-4.6-high` 1630 | not in the current top 10 | Sol xhigh (Codex) #7, 1622 | Fable 5 #6, 1627 | S2 / high |
| Design Arena 3D | no readable ranking on 2026-08-13 | — | — | — | missing |
| API output speed | **65.5 tok/s** | 67 tok/s (2026-07-31 AA) | 63 high / 70 xhigh | 74 max/fallback | S1 / high |
| AA cost / Intelligence Index task | **$0.84** | — | Sol list $5 / $30 | Fable list $10 / $50 | S1 for the AA task cost; S3 for list prices |

Sources: [AA Grok 4.6 model card](https://artificialanalysis.ai/models/grok-4-6),
[AA Grok 4.6 analysis](https://artificialanalysis.ai/articles/grok-4-6-benchmarks-and-analysis),
[DeepSWE](https://deepswe.datacurve.ai/),
[Agent Arena](https://arena.ai/leaderboard/agent?stream=top),
[WebDev Arena](https://arena.ai/leaderboard?category=webdev),
[xAI launch table](https://x.ai/news/grok-4-6).

xAI's launch table also reports CursorBench v3.2 69.9%, FrontierCode v1.1
Extended 61.3%, APEX-Agents 57.5%, APEX-SWE 56.4%, and Harvey LAB (Vals)
15.8% for 4.6 High. Those are S3 competitor-best comparisons, not catalog
dimensions. The page itself says competitor figures are the best of
self-reported or publicly available results.

## Mapping onto catalog methodology

The catalog scores `conservative` for routing. Exact means the published
number matches the candidate's model **and** effort. Otherwise the cell is a
labeled effort proxy.

| Dimension | Raw published number | Catalog score / conservative | Confidence | Exact or proxy | Evidence |
| --- | --- | ---: | --- | --- | --- |
| reasoning | AA Intelligence Index **61** for Grok 4.6 (high) | **0.61 / 0.59** | high | exact | [AA model card](https://artificialanalysis.ai/models/grok-4-6), [AA article](https://artificialanalysis.ai/articles/grok-4-6-benchmarks-and-analysis) |
| implementation | DeepSWE **67% ±2%** at **xhigh**; xAI table 65.9% at High | **0.67 / 0.63** | medium | xhigh proxy for the high candidate | [DeepSWE](https://deepswe.datacurve.ai/), [xAI table](https://x.ai/news/grok-4-6) |
| agentic | AA-Briefcase Elo **1577** (Fable-tier) and GDPval-AA v2 **1753** (ahead of Sol Max 1728 and Fable Max 1741). Agent Arena has **no 4.6 row**. | **0.88 / 0.82** | medium | agentic-work proxy, same pattern as Opus 5 high's Briefcase cell | [AA article](https://artificialanalysis.ai/articles/grok-4-6-benchmarks-and-analysis), [xAI table](https://x.ai/news/grok-4-6) |
| ui | WebDev Arena **#5** at 1630, ahead of Fable 5 (#6, 1627) and Sol xhigh (#7, 1622) | **0.89 / 0.84** | medium | exact high-effort arena row | [WebDev Arena](https://arena.ai/leaderboard?category=webdev) |
| spatial-3d | no dated Design Arena ranking recovered | unknown | — | missing | [Design Arena](https://www.designarena.ai/leaderboard) |
| task cost | DeepSWE **$5.50**/task at xhigh | **$5.50** | medium | xhigh proxy | [DeepSWE](https://deepswe.datacurve.ai/) |
| speed | AA **65.5 tok/s** | **65.5** | high | exact | [AA model card](https://artificialanalysis.ai/models/grok-4-6) |

Conservative haircuts: 2 points on the exact AA index; 4 points on the
xhigh→high DeepSWE transfer (independent CI floor is 65%); 6 points on
agentic-work because Agent Arena has not yet measured 4.6 and xAI's
Terminal-Bench v3.0 cell trails Sol/Fable; 5 points on one WebDev snapshot.

## Side-by-side with the live catalog peers

Conservative values the brief actually routes on:

| Candidate | reasoning | implementation | agentic | ui | task cost | speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `claude/claude-fable-5[1m]/high` | 0.56 | 0.66 | 0.90 | 0.82 | $21.63 | 74 |
| `codex/gpt-5.6-sol/max` | 0.57 | 0.71 | 0.84 | 0.80 | $8.39 | 70 |
| `codex/gpt-5.6-sol/xhigh` | 0.56 | 0.70 | 0.86 | 0.82 | $8.39 | 70 |
| `codex/gpt-5.6-sol/high` | 0.54 | 0.64 | 0.70 | 0.74 | — | 63 |
| **Grok 4.6 high (this assessment)** | **0.59** | **0.63** | **0.82** | **0.84** | **$5.50** | **65.5** |

Reading:

- **Intelligence / architecture.** Grok 4.6 high's exact AA 61 ties Sol **max**
  and sits one point behind Fable **max**. Conservative reasoning (0.59) is
  above Fable high (0.56) and Sol high (0.54), and above Sol max (0.57). It
  belongs in the same intelligence band as Fable 5 and Sol high, and is
  strong enough to own architecture and most complex problems.
- **Implementation.** Independent DeepSWE still has Sol max (73%) and Fable
  max (70%) ahead of Grok 4.6 xhigh (67%). The gap is real and smaller than
  4.5's 54%. Conservative 0.63 is a peer of Sol high (0.64), not of Sol max
  (0.71). Prefer Sol max / Fable when the work is DeepSWE-hard multi-repo SWE
  or Terminal-Bench v3-style unattended terminal loops.
- **Agentic knowledge work.** AA's own line is that 4.6's strongest results
  are agentic rather than static reasoning. Briefcase and GDPval sit at or
  above Fable Max / Sol Max. Score 0.88 matches the catalog's Opus 5 high
  Briefcase cell; conservative 0.82 stays below Fable's Arena-backed 0.90
  until Agent Arena lists 4.6.
- **UI.** Current WebDev preference puts `grok-4.6-high` just ahead of Fable
  5 and Sol xhigh. Treat it as a first-class UI candidate, not a 4.5-class
  #10 leftover.
- **Economics.** $2 / $6 list price and $5.50 DeepSWE proxy are well below
  Fable ($21.63) and Sol ($8.39). AA's Intelligence Index task cost is $0.84.
  Context stays 500k; prompts ≥200k double the whole request.

## Recommendation for both catalog candidates

Apply the same cells to `grok/grok-4.6/high` and
`claudex/grok-4.6/high`. Same model and effort; harness
transfer is already expressed in the conservative column.

Do **not** copy Grok 4.5 scores. Do **not** invent Agent Arena or Design
Arena ranks. Do **not** treat the 500k window as 2M.

## Honest gaps

- Agent Arena has no Grok 4.6 row as of the 2026-08-12 snapshot (1,735,280
  sessions). Agentic is an AA agentic-work proxy, not an Arena ordinal.
- DeepSWE's independent row is **xhigh**, not high. High is a labeled proxy
  supported by xAI's 65.9% High cell.
- Design Arena's 3D board did not yield a dated 4.6 rank on this pass.
- No public SWE-rebench / review-quality benchmark for 4.6 was used.
- xAI Terminal-Bench **v3.0** (26%) disagrees in direction with AA
  Terminal-Bench **v2.1** (88.4%). Catalog agentic follows AA agentic-work
  (GDPval, Briefcase) and records the v3.0 gap as a reason for the
  conservative haircut, not as a second agentic score.
