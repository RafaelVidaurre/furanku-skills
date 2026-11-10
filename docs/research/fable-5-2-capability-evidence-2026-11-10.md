# Claude Fable 5.2 capability evidence

Research date: 2026-11-10.

## Scope and evidence rules

Record public capability evidence for Claude Fable 5.2 at the exact
efforts **medium, high, xhigh, and max**, so that four candidates can
replace `claude/claude-fable-5-1[1m]/high` in the routing catalog. This
note changes no routing configuration. The catalog's `methodology` block
and the [score-normalization research](model-routing-score-normalization-2026-09-22.md)
determine the mappings; the shape follows the
[Claude 5.5 note](claude-55-routing-2026-10-08.md).

Benchmark operators are the primary source for their own measurements.
Anthropic is the primary source for interface facts. A number counts
only when the source names Fable 5.2 **and** the effort. No Fable 5.1
value and no other effort's value is carried to a 5.2 cell. Nothing
below is a local evaluation or a measurement of subscription quota.

## Model identity and interface

| Property | Claude Fable 5.2 |
| --- | --- |
| Claude API ID | `claude-fable-5-2` (the alias is the same string) |
| Bedrock ID | `anthropic.claude-fable-5-2` |
| Release | 2026-11-09 |
| Context / maximum output | 1,000,000 / 128,000 tokens |
| Modalities | Text and images in; text out |
| Thinking | Adaptive, always on; cannot be disabled |
| Efforts | `low`, `medium`, `high`, `xhigh`, `max` |
| API default effort | `high` |
| Claude Code default effort | `medium` |
| Minimum Claude Code version | v2.1.321 |
| Reliable knowledge cutoff | June 2026 |

Sources: [Fable 5.2 overview](https://platform.claude.com/docs/en/models/fable-5-2/overview),
[models overview](https://platform.claude.com/docs/en/about-claude/models/overview),
[effort guide](https://platform.claude.com/docs/en/build-with-claude/effort),
[Claude Code model configuration](https://code.claude.com/docs/en/model-config).

- **Model ID verified.** The expected `claude-fable-5-2` is the ID the
  overview lists for the Claude API, Google Cloud, Microsoft Foundry and
  Claude Platform on AWS.
- **1M context is native.** Claude Code's docs say "Fable models, Sonnet
  5 and later, Haiku 5.5, and Opus 4.7 and later run with the 1M window
  by default, with no `[1m]` suffix needed." No beta header is involved.
  The current catalog key `claude-fable-5-1[1m]` carries a suffix the
  docs call unnecessary for Fable; the 5.2 launch model should be the
  bare `claude-fable-5-2`.
- **Defaults differ by surface.** The API default is `high`. Claude Code
  lists Fable 5.2 with Opus 5.5, Sonnet 5.5 and Haiku 5.5 as defaulting
  to `medium`. Launch an explicit effort.
- **Minimum version.** "Fable 5.2 requires Claude Code v2.1.321 or
  later, and Fable 5.1 requires v2.1.257 or later." The launcher on the
  research machine reported 2.1.322 on the research date.
- **Alias.** In Claude Code the `fable` alias resolves to Fable 5.2,
  except in Claude apps gateway sessions, where it resolves to Fable 5.
  The full ID keeps the intended version. No Fable model is an
  account-type default; depending on plan and seat, Fable usage can bill
  to usage credits, and non-interactive (`-p`) runs bill without a
  consent prompt.
- **Features.** The models overview states every current model supports
  "text and image input, text output, multilingual capabilities, vision,
  and tool use", which supports the catalog features `tools`, `vision`
  and `long-context`. Forced tool use (`tool_choice` `any`/`tool`)
  returns a 400. The model requires 30-day data retention and is not
  available under zero data retention unless Anthropic authorizes it.
- **Mythos 5.2.** `claude-mythos-5-2` "offers the same capabilities only
  to organizations verified through Anthropic's verification programs"
  and "shares Claude Fable 5.2's specifications and pricing". It is a
  restricted-access sibling, not a routing candidate here.

Anthropic's effort guidance for this model: start at `high`; "most of
the gain in capability is already present at `high`, and above it, gains
are uneven and depend on the task"; use `xhigh` where a gain is
measured; step down to `medium` or `low` where evals show quality holds;
reserve `max` for measuring the ceiling, since it "runs slower and costs
more than at `xhigh`, often for only a small gain". It also says to run
a fresh effort sweep "rather than carrying settings over from Claude
Fable 5.1". This is vendor guidance, not a benchmark cell.

## Current API tariffs

USD per million tokens
([pricing](https://platform.claude.com/docs/en/about-claude/pricing)):

| Mode | Input | Output | 5m cache write | 1h cache write | Cache read |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard | 8.00 | 40.00 | 10.00 | 16.00 | 0.20 |
| Batch | 4.00 | 20.00 | — | — | — |
| Fast mode | 16.00 | 80.00 | — | — | — |

Fable 5.1 was $10 / $50, so 5.2 is cheaper per token. Tariffs are not
task costs and not subscription-quota burden.

## Independent exact-effort measurements

### Artificial Analysis

AA publishes one card per effort. Every card's model name carries the
qualifier **Default Fallback**, for example "Claude Fable 5.2 (High,
Default Fallback)". Values below are the unrounded numbers in each
card's embedded model record, read 2026-11-10.

| Effort | Card | Intelligence Index v5.0.1 | Displayed | Output tokens/s | AA-Briefcase v1.1 Elo | 95% CI |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| low (not requested) | [low](https://artificialanalysis.ai/models/claude-fable-5-2-low) | 53.92494 | 54 | 91.30756 | 1562.73 | 1553.18–1572.27 |
| medium | [medium](https://artificialanalysis.ai/models/claude-fable-5-2-medium) | 56.40832 | 56 | 87.01275 | 1622.24 | 1613.04–1631.43 |
| high | [high](https://artificialanalysis.ai/models/claude-fable-5-2-high) | 61.82188 | 62 | 93.50011 | 1677.44 | 1667.48–1687.40 |
| xhigh | [xhigh](https://artificialanalysis.ai/models/claude-fable-5-2-xhigh) | 62.21674 | 62 | 102.54491 | 1737.78 | 1727.89–1747.66 |
| max | [max (bare slug)](https://artificialanalysis.ai/models/claude-fable-5-2) | 64.56360 | 65 | 102.35746 | 1785.32 | 1773.79–1798.07 |

The [release comparison](https://artificialanalysis.ai/models/releases/claude-fable-5-2)
carries the same index and speed values for all five efforts.

Three things differ from the September and October notes and matter for
the catalog:

1. **The index version is v5.0.1, not v4.3.2.** Every Fable 5.2 card and
   the [methodology page](https://artificialanalysis.ai/methodology/intelligence-benchmarking)
   name "Artificial Analysis Intelligence Index v5.0.1", built from nine
   evaluations (AA-Briefcase v1.1, AutomationBench-AA, Terminal-Bench
   4.0, FrontierCode 2.0, AA-Omniscience v1.1, GDP.pdf, HLE-Diamond,
   CritPt v2 Hard Subset, Terminal-Bench-Science 0.1). The version
   history dates v5.0 to October 2026 (added HLE-Diamond,
   Terminal-Bench-Science and FrontierCode 2.0; removed GDPval-AA,
   SciCode, AA-LCR and HLE) and v5.0.1 to November 2026 (CritPt v2
   regrade). AA shows no v4.3.2 value for Fable 5.2. The catalog
   methodology says "different versions are not comparable", so these
   cells cannot be ranked against the v4.3.2 cells of current peers. For
   scale: the Fable 5.1 high card now reads 47.17 on v5.0.1, against
   51.15 on v4.3.2 in the catalog.
2. **The speed field changed.** Earlier notes read `medianOutputSpeed`.
   Today's payload has no such field; the cards expose
   `headline.outputSpeed`. The page describes output speed as "output
   tokens divided by total request time, including time to first token"
   and says "the headline value averages each Performance v3 workload
   over the past 5 days, then averages the workloads." The requested
   "median output tokens/s" therefore has no exact row; the value above
   is AA's current headline end-to-end output speed. It is not the same
   statistic as the catalog's existing speed cells.
3. **No estimated flag.** The payload no longer contains
   `intelligenceIndexIsEstimated`, so this note cannot confirm, as the
   October note did, that no value is estimated.

[AA-Briefcase](https://artificialanalysis.ai/evaluations/aa-briefcase)
is still **v1.1**, at 15% of the index, and the methodology page still
gives the mapping the catalog uses: "the combined AA-Briefcase v1.1 Elo
is frozen at the time of a model's addition and normalized as
clamp((Elo - 500) / 2000). The Elo scale is anchored to GPT-5.5 (medium)
at 1000". The 95% bounds come from `briefcaseBreakdown.overall` on each
card. Briefcase runs in AA's Stirrup harness on knowledge-work projects;
it is not a coding-agent pass rate, and its Elo moves as submissions
enter. Adjacent-effort intervals do not overlap for Fable 5.2.

Other exact values on the cards, kept here and not mapped to a cell:

| Effort | Index cost per task (USD) | Time to first token (s) | GDPval-AA v2.1 Elo [95% CI] |
| --- | ---: | ---: | --- |
| medium | 3.80 | 12.6 | 1591.16 [1574.93–1607.40] |
| high | 9.08 | 30.5 | 1718.13 [1699.84–1736.43] |
| xhigh | 14.83 | 74.6 | 1750.65 [1729.28–1772.01] |
| max | 26.54 | 221.2 | 1831.33 [1804.31–1858.34] |

Index cost per task is AA's weighted cost across its index suite. It is
not DeepSWE task cost.

### CursorBench 4.0

The [operator table](https://cursor.com/evals) is titled CursorBench 4.0
(86 rows) and has an exact row for every Fable 5.2 effort:

| Effort | Table rank | Resolved rate | USD/task | Tokens/task | Steps/task |
| --- | ---: | ---: | ---: | ---: | ---: |
| low (not requested) | 9 | 53.2% | 3.94 | 36,616 | 30 |
| medium | 8 | 54.8% | 4.66 | 44,103 | 35 |
| high | 3 | 56.9% | 9.70 | 99,259 | 69 |
| xhigh | 4 | 56.3% | 15.48 | 161,251 | 108 |
| max | 1 | 60.0% | 32.79 | 352,794 | 218 |

**xhigh scores below high** (56.3% against 56.9%) at 1.6 times the cost.
Cursor prints no interval and says "small differences in scores may not
be statistically meaningful", so read the two as tied. This matches
Anthropic's statement that gains above `high` are uneven. Max is the top
row of the table and costs 3.4 times high per task.

The page's changelog has no entry for the Fable 5.2 addition; its latest
dated entry is still 2026-10-07 (Sonnet 5.5 repricing), and 4.0 is the
version introduced on 2026-09-10. Costs apply published tariffs to
recorded token use in Cursor's harness.

### Arena WebDev (UI)

[Arena WebDev](https://arena.ai/leaderboard/code/webdev) shows the date
"Nov 8, 2026", 984,664 votes and 156 models. The page prints the date
with no "cutoff" label.

| Row | Rank | Rank spread | Score | Votes | Label |
| --- | ---: | --- | --- | --- | --- |
| Claude Fable 5.2 (xHigh) | 1 | 1–1 | 1832 ±18 | N/A | **AutoEval** |

This is the only Fable 5.2 row. **Medium, high and max have no row.**

The xhigh row is an **AutoEval** score, not a human-voted one. Arena's
[AutoEval post](https://arena.ai/blog/autoeval-scores) describes it as a
"Day-1 signal": a reward model trained on Arena votes casts proxy votes
for the new model, which are combined "with the live human votes for
other models", and the score is "updated once enough human votes arrive
to validate them". Arena reports rank correlation above 0.98 with live
scores and says most AutoEval scores fall within the live confidence
intervals. The row's vote count is "N/A", and the page date (8 November)
precedes the model's release (9 November), which fits a row with no
human votes.

For context, the next rows are Claude Opus 5.5 (Max) at 1818 ±12 and
Claude Sonnet 5.5 (xHigh) at 1774 ±10. Fable's lower bound (1814) sits
below Opus 5.5 Max's score.

Retrieval caveat: a direct request for this page returned HTTP 403, so
the rows were read through a web reader that returns page text. Three
reads agreed on score, interval, the AutoEval badge, "N/A" votes, and
the absence of other Fable 5.2 rows. They printed the rank spread as the
run-together digits "11", read here as 1–1.

### Design Arena 3D (spatial-3d)

The [3D leaderboard](https://www.designarena.ai/leaderboard/3d-design)
payload (board `arenaType: models, category: 3d`, `lastUpdateTime`
2026-11-10T10:06:33Z, 322,145 total votes, 178 models) has **no
`claude-fable-5-2` row**. Its Fable rows are `claude-fable-5-1` (rank 9,
Elo 1391) and `claude-fable-5` (rank 25, Elo 1303).

The [changelog](https://www.designarena.ai/changelog) records "added
claude-fable-5-2" on 2026-11-09, and the site registry lists the model
for the 3D arena. It already appears on a website sub-board with 77
battles, but not yet on the 3D board. The registry display name is
"Claude Fable 5.2", **with no effort label**. When a 3D row appears, its
effort will again have to be inferred from the API default (`high`), as
it was for Fable 5.1; it could support the high cell at most.

### DeepSWE v1.1 (task cost)

The [DeepSWE board](https://deepswe.datacurve.ai/) reads "113 tasks ·
updated September 22, 2026". Its only Fable configurations are
`claude_fable_5` at five efforts. There is **no Fable 5.2 row and no
Fable 5.1 row**, so no average task cost exists for any 5.2 effort.

## Cursor CLI inventory

`cursor-agent models` ran successfully on the research machine
(`cursor-agent` version `2026.10.22-27dcf5f`). It lists Fable 5.2 with
five effort-suffixed aliases and no bare, `-thinking-` or `-fast`
variant:

```text
claude-fable-5-2-low - Claude Fable 5.2 1M Low (NO ZDR)
claude-fable-5-2-medium - Claude Fable 5.2 1M Medium (NO ZDR)
claude-fable-5-2-high - Claude Fable 5.2 1M (NO ZDR)
claude-fable-5-2-xhigh - Claude Fable 5.2 1M Extra High (NO ZDR)
claude-fable-5-2-max - Claude Fable 5.2 1M Max (NO ZDR)
```

Fable 5.1 is still listed, with both plain and `-thinking-` aliases:

```text
claude-fable-5-1-low - Claude Fable 5.1 1M Low (NO ZDR)
claude-fable-5-1-medium - Claude Fable 5.1 1M Medium (NO ZDR)
claude-fable-5-1-high - Claude Fable 5.1 1M (NO ZDR)
claude-fable-5-1-xhigh - Claude Fable 5.1 1M Extra High (NO ZDR)
claude-fable-5-1-max - Claude Fable 5.1 1M Max (NO ZDR)
claude-fable-5-1-thinking-low - Claude Fable 5.1 1M Low Thinking (NO ZDR)
claude-fable-5-1-thinking-medium - Claude Fable 5.1 1M Medium Thinking (NO ZDR)
claude-fable-5-1-thinking-high - Claude Fable 5.1 1M Thinking (NO ZDR)
claude-fable-5-1-thinking-xhigh - Claude Fable 5.1 1M Extra High Thinking (NO ZDR)
claude-fable-5-1-thinking-max - Claude Fable 5.1 1M Max Thinking (NO ZDR)
```

The unsuffixed display name ("1M" with no effort word) sits on the
`-high` alias for both models. This is an inventory listing for one
account on one date. No model was launched, so it shows that the aliases
are offered, not that a launch succeeds. The catalog also carries five
`cursor/claude-fable-5-1/*` launch-only candidates; whether to mirror
them for 5.2 is a catalog decision outside this note.

## Mapping to the catalog

Launch tuple for all four: agent `claude`, model `claude-fable-5-2` (no
`[1m]` suffix), features `tools`, `vision`, `long-context`, context
1,000,000 with `context_evidence`
`https://platform.claude.com/docs/en/models/fable-5-2/overview`.
`assessed_at` / `researched_at` 2026-11-10.

Transforms are the catalog's existing ones, at the precision the Sonnet
5.5 cells use:

- Reasoning: index / 100; conservative = score − 0.02; high confidence.
- Implementation: CursorBench resolved fraction; conservative = score −
  0.03; medium confidence.
- Agentic: (Elo − 500) / 2000; conservative = (lower 95% bound − 500) /
  2000 − 0.02; medium confidence.
- UI: 1 − (rank − 1) / (N − 1); conservative uses the worst rank in the
  published spread.
- Spatial-3d: 1 − (rank − 1) / (N − 1); conservative = score − 0.05.

| Dimension | medium | high | xhigh | max |
| --- | --- | --- | --- | --- |
| reasoning (score / conservative) | 0.5641 / 0.5441 | 0.6182 / 0.5982 | 0.6222 / 0.6022 | 0.6456 / 0.6256 |
| implementation | 0.548 / 0.518 | 0.569 / 0.539 | 0.563 / 0.533 | 0.600 / 0.570 |
| agentic | 0.5611 / 0.5365 | 0.5887 / 0.5637 | 0.6189 / 0.5939 | 0.6427 / 0.6169 |
| ui | unknown | unknown | 1.000 / 1.000, see caveat | unknown |
| spatial-3d | unknown | unknown | unknown | unknown |
| output tokens/s | 87.01 | 93.50 | 102.54 | 102.36 |
| task-cost | unknown | unknown | unknown | unknown |
| context | 1,000,000 | 1,000,000 | 1,000,000 | 1,000,000 |

Per-dimension confidence, scale, evidence and note text (`<effort>` and
the bracketed values come from the tables above):

| Dimension | Confidence | Scale | Evidence | Note text |
| --- | --- | --- | --- | --- |
| reasoning | high | `AA Intelligence Index v5.0.1` | the effort's AA card; the release comparison | "Exact `<effort>` with Default Fallback row `<index>` on v5.0.1; score = index/100, conservative = score - 0.02. v5.0.1 is not comparable with v4.3.2 cells." |
| implementation | medium | `CursorBench 4.0` | `https://cursor.com/evals` | "CursorBench 4.0 exact `<effort>` row `<rate>`% in Cursor's harness; conservative = score - 0.03 harness-transfer reserve (no published interval)." |
| agentic | medium | `AA-Briefcase v1.1 Elo, mapped` | the effort's AA card; the release comparison | "Exact `<effort>` with Default Fallback Elo `<elo>` (95% CI lower `<lower>`); score = (Elo - 500)/2000, conservative = mapped lower bound - 0.02 for Stirrup-to-launcher transfer. Snapshot 2026-11-10; older catalog peers have earlier assessment dates." |
| ui, xhigh | low (suggested) | `Arena WebDev rank, percentile` | `https://arena.ai/leaderboard/code/webdev`; `https://arena.ai/blog/autoeval-scores` | "Exact xHigh row, rank 1 of 156 (rank spread 1-1), score 1832 ±18, page date 2026-11-08. AutoEval score from Arena's reward model, no human votes yet; score = 1 - (rank - 1)/(N - 1), conservative uses the worst rank in the published spread. Percentile is specific to this board population." |
| ui, medium / high / max | — | — | — | unknown, reason: "Arena WebDev (page date 2026-11-08, 156 models) lists only Claude Fable 5.2 (xHigh), an AutoEval row; no exact-effort row for this tuple, and xhigh is not transferred." |
| spatial-3d, all | — | — | — | unknown, reason: "Design Arena added claude-fable-5-2 on 2026-11-09, but the 3D board (data stamp 2026-11-10T10:06Z, 178 models) has no row for it, and the registry labels no effort. The Fable 5.1 rank is not carried over." |
| output tokens/s | — | — | the effort's AA card | basis: "Artificial Analysis, exact `<effort>` with Default Fallback, headline end-to-end output speed (5-day average, includes time to first token); not a median and not end-to-end task latency" |
| task-cost, all | — | — | — | unknown, reason: DeepSWE v1.1 (updated 2026-09-22) has no Fable 5.2 row at any effort. CursorBench and AA index costs are different task sets and stay in this note. |
| context | high | — | Fable 5.2 overview | 1,000,000 tokens, native; 128,000 maximum output. |

Caveats on applying the table:

- **Reasoning scale mismatch.** These are the first v5.0.1 cells. Until
  peers are re-read on v5.0.1, the brief must show Fable 5.2 reasoning
  on its own lettered scale. Do not read 0.6182 (v5.0.1) against Opus
  5.5 high's v4.3.2 cell. A peer rebase would use the same AA cards.
- **UI xhigh is the weakest known cell.** The existing transform gives
  1.000 / 1.000, which overstates a reward-model estimate with no human
  votes. Two defensible treatments: keep it `known` with **low**
  confidence and the AutoEval wording above, or hold it `unknown` until
  Arena replaces the AutoEval score with a voted one. If kept, a lower
  conservative of 0.9935 (rank 2 of 156) is defensible because the
  score's lower bound, 1814, is below the second row's 1818; that
  derivation is new and not one of the catalog's existing transforms.
- **Speed is a different statistic** from the catalog's existing cells
  (see the AA section). Higher effort does not show lower throughput
  here; medium is the slowest of the four. Time to first token grows
  steeply with effort (12.6 s at medium, 221.2 s at max), which the
  throughput value does not show.
- **Implementation does not rise monotonically.** High (0.569) and xhigh
  (0.563) are a tie on a board without intervals.
- Reasoning and agentic share evidence: Briefcase is 15% of the index.

## Honest gaps

- **AA index version.** Only v5.0.1 exists for Fable 5.2. No v4.3.2
  value was found, so the reasoning cells are off the catalog's current
  common scale until peers are refreshed.
- **AA median speed.** No field or label named median output speed
  exists for these cards today. The recorded value is AA's headline
  end-to-end output speed. Whether older catalog speed cells used the
  same computation under a different field name was not verified.
- **AA estimated flag.** Absent from the payload; not verified either
  way.
- **Default Fallback share.** AA labels every effort "Default Fallback".
  No AA article for Fable 5.2 was found (the expected article URL
  returned 404), so the share of output served by a fallback model is
  unknown.
- **Arena WebDev.** Only xhigh has a row, and it is AutoEval. The page
  could not be fetched directly (HTTP 403); values come from a web
  reader's text. The rank spread "1–1" is a reading of run-together
  digits. The page's date is not labelled as a vote cutoff, and no vote
  count exists for the row.
- **Design Arena 3D.** No Fable 5.2 row and no effort label. Every 3D
  cell is unknown. This is missing evidence, not evidence of weak 3D
  ability.
- **DeepSWE.** No Fable 5.2 row, so `task_cost_usd` is unknown at every
  effort. The board has not been updated since 2026-09-22.
- **CursorBench.** No intervals; the 0.03 reserve is routing policy, not
  a measured bound. The page's changelog does not date the Fable 5.2
  rows.
- **Vendor evaluations.** The Anthropic announcement and system card
  were not reviewed for this note. Vendor launch numbers would not fill
  a catalog cell on these scales in any case.
- **Subscription quota.** Tariffs, CursorBench dollars and AA index cost
  do not measure Claude subscription consumption or usage-credit
  billing for Fable.
- **Cursor.** The CLI inventory is one account on one date; launch
  success and Cursor-harness capability for the 5.2 aliases were not
  tested.
- All benchmark values are dated snapshots. Briefcase Elo and Arena
  rank percentiles move as boards change.
