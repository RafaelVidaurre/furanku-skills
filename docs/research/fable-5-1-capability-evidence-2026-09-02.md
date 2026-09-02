# Claude Fable 5.1 capability evidence

Research date: 2026-09-02 (Europe/Lisbon)

## Question and boundary

This note assesses public evidence for the configured
`claude/claude-fable-5-1[1m]/high` route and records the evidence used to
refresh the routing catalog.

Public research only. Independent operator measurements are S1/S2; Anthropic
documentation, launch evaluations, and the system card are S3. A score is
**exact** only when model, effort, and measured harness are named. Anthropic
explicitly says Fable 5 and 5.1 effort labels do not represent the same amount
of thinking, so Fable 5 results must not be relabeled as 5.1 results
([prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1)).

## Bottom line

Two operators now provide useful **exact high-effort** measurements:

| Operator | Measurement | Fable 5.1 high | Strength |
| --- | --- | ---: | --- |
| Artificial Analysis | Intelligence Index v4.1.1 | **62** | S1; exact high, default server-side fallback |
| Artificial Analysis | API output speed | **49.1 tok/s** | S1; exact high |
| Artificial Analysis | Intelligence Index task cost | **$1.43** | S1; exact high, but not DeepSWE task cost |
| Cursor | CursorBench 3.2 | **69.4%**, **$4.80/task**, 33,153 tokens, 44 steps | S1; exact high in Cursor's production agent harness |

Sources: [AA high model card](https://artificialanalysis.ai/models/claude-fable-5-1-high),
[CursorBench 3.2 leaderboard](https://cursor.com/evals), and
[CursorBench methodology](https://cursor.com/blog/cursorbench). CursorBench
uses ambiguous multi-file tasks from real Cursor sessions and measures
solution correctness in its own agent harness; it is strong implementation and
agentic evidence, but it is not a DeepSWE or Claude Code measurement.

The exact high evidence supports updating catalog reasoning, implementation,
and serving speed. It does **not**
justify carrying Fable 5's Agent Arena, WebDev, Design Arena, or DeepSWE cells
forward unchanged.

## Max and xhigh results are not high results

Artificial Analysis measured multiple effort levels with default fallback:

| Effort | Intelligence Index | Output speed | Index task cost | Use for the high route |
| --- | ---: | ---: | ---: | --- |
| high | **62** | **49.1 tok/s** | **$1.43** | exact |
| xhigh | **65** | **58.8 tok/s** | **$2.65** | xhigh only |
| max | **66** | **66.4 tok/s** | **$3.69** | max only |

Sources: [AA high](https://artificialanalysis.ai/models/claude-fable-5-1-high),
[AA xhigh](https://artificialanalysis.ai/models/claude-fable-5-1-xhigh), and
[AA max](https://artificialanalysis.ai/models/claude-fable-5-1/). AA's launch
analysis reported slightly earlier task-cost snapshots of $2.72 at xhigh and
$3.76 at max; the model cards showed $2.65 and $3.69 when assessed on 2
September. The launch evaluation used Anthropic's default fallback, which
served about 4% of max-run output tokens from Opus 4.8 or Opus 5
([AA analysis](https://artificialanalysis.ai/articles/claude-fable-5-1)).

AA's strongest agentic-work numbers are also **max**, not high: GDPval-AA v2
**1853 Elo** and AA-Briefcase **1694 Elo**. Both are AA's own measurements;
GDPval's lead over Opus 5 max is within the confidence interval and Briefcase
is effectively tied with Opus 5 max at 1685
([AA analysis](https://artificialanalysis.ai/articles/claude-fable-5-1)).

Anthropic's system card says its standard capability configuration is adaptive
thinking at **max effort**, default sampling, averaged over five trials unless
otherwise noted. Its relevant vendor-reported results are:

| Benchmark | Fable 5.1 result | Configuration / limitation |
| --- | ---: | --- |
| DeepSWE v1.1 | **67.4%** | S3; max default configuration, five-trial Anthropic run |
| Terminal-Bench 4.0 | **55.8%** | S3; Claude Code `--bare`, max, 15 trials/task |
| Terminal-Bench-Science 0.1 | **52.6%** | S3; Claude Code `--bare`, max, 10 trials/task; ±3.5-4.5 points |
| CursorBench 3.2 | **73.4%** | S1 through Cursor; exact max, $9.64/task on Cursor's live table |
| GDPval-AA v2 | **1853 Elo** | S1 through AA; exact max |
| AA-Briefcase | **1694 Elo** | S1 through AA; exact max |

Sources: [Anthropic system card](https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card),
[Anthropic release evaluation](https://www.anthropic.com/claude-fable-and-mythos-5-1),
[CursorBench 3.2](https://cursor.com/evals), and
[AA analysis](https://artificialanalysis.ai/articles/claude-fable-5-1).
Anthropic notes that DeepSWE hidden tests sometimes rejected equally valid but
more thorough implementations; this is still vendor evidence and the
independent DeepSWE leaderboard has not published a 5.1 row.

## Mapping to the current catalog

Suggested numbers below preserve the catalog's current scales. Conservative
values are routing recommendations, not additional measurements.

| Dimension | Truthful catalog treatment | Suggested score / conservative | Confidence |
| --- | --- | ---: | --- |
| reasoning | Exact AA high result | **0.62 / 0.60** | high |
| implementation | Exact-high CursorBench 69.4%; cross-harness transfer is reflected in the conservative value | **0.694 / 0.67** | medium; harness transfer |
| agentic | CursorBench does not isolate the catalog's general agentic dimension, and Agent Arena has no 5.1 row | **unknown** | - |
| ui | No Fable 5.1 WebDev Arena row | **unknown** | - |
| spatial-3d | No Fable 5.1 Design Arena row | **unknown** | - |
| speed | Exact AA high API measurement | **49.1 tok/s** | high |
| task cost | No independent DeepSWE 5.1 cost; CursorBench/AA costs use different tasks | **unknown** under the catalog's DeepSWE-only definition | - |
| context | Official model specification | **1,000,000 tokens** | high |

The catalog leaves agentic unknown. Fable 5.1 high beats Fable 5 high on
CursorBench 3.2 (69.4% versus 66.5%), but treating that as an Agent Arena-style
in-the-wild ordinal would add an unsupported cross-harness inference.

Official interface and economics are exact: model id `claude-fable-5-1`, 1M
context, 128K maximum output, `high` default effort, $10/M input, $50/M output,
$12.50/M five-minute cache writes, and $0.25/M cache reads
([Claude model documentation](https://platform.claude.com/docs/en/models/fable-5-1/overview)).

## Honest gaps as of 2026-09-02

- [DeepSWE v1.1](https://deepswe.datacurve.ai/) was last updated 26 August and
  still lists Fable 5 max (70% ±4%, $21.63/task), not Fable 5.1. Neither that
  score nor cost can be renamed to 5.1.
- [Agent Arena](https://arena.ai/leaderboard/agent/overall) still lists Claude
  Fable 5 high, not 5.1. The old in-the-wild ordinal cannot be treated as an
  exact 5.1 observation.
- [WebDev Arena](https://arena.ai/leaderboard/code) still lists
  `claude-fable-5`, not 5.1, so UI remains unknown under the catalog method.
- [Design Arena's changelog](https://www.designarena.ai/changelog) contains no
  Fable 5.1 addition, so its Fable 5 3D rank cannot populate `spatial-3d`.
- Anthropic reports vision and high-fidelity design capabilities, but vendor
  descriptions are not substitutes for the catalog's WebDev and browser-3D
  preference rankings
  ([release page](https://www.anthropic.com/claude/fable)).
