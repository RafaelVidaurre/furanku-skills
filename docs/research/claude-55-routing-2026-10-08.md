# Claude Sonnet 5.5 and Haiku 5.5 routing evidence

Research date: 2026-10-08 (Europe/Lisbon).

## Scope and evidence rules

Assess Claude Sonnet 5.5 and Claude Haiku 5.5 for the existing
model-routing catalog. This note changes no routing configuration.
The catalog's current methodology and
[score-normalization research](model-routing-score-normalization-2026-09-22.md)
determine the mappings below. Public measurements contribute scores;
vendor positioning contributes qualitative task fit. Each quantitative
row must name the exact model and effort. Neither predecessor scores nor
another effort's scores transfer.

Independent benchmark operators are primary sources for their own
measurements. Anthropic is the primary source for interfaces and vendor
claims. None of the results below is a local evaluation or a measurement
of subscription quota consumption.

## Model identities and interfaces

| Property | Sonnet 5.5 | Haiku 5.5 |
| --- | --- | --- |
| Claude API ID | `claude-sonnet-5-5` | `claude-haiku-5-5` |
| Bedrock ID | `anthropic.claude-sonnet-5-5` | `anthropic.claude-haiku-5-5` |
| Release | 2026-09-28 | 2026-10-07 |
| Context / maximum output | 1,000,000 / 128,000 tokens | 1,000,000 / 128,000 tokens |
| Modalities | Text and images in; text out | Text and images in; text out |
| Thinking | Adaptive | Adaptive |
| API default effort | `high` | `medium` |
| Reliable knowledge cutoff | June 2026 | June 2026 |

Sources: [Sonnet overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview),
[Haiku overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview).
Both support the catalog features `tools`, `vision`, and `long-context`;
tool behavior is documented in the
[effort guide](https://platform.claude.com/docs/en/build-with-claude/effort).

Both expose `low`, `medium`, `high`, `xhigh`, and `max`. Sonnet's levels
are recalibrated from Sonnet 5. Sonnet supports `between_tools` at high
or below to remove up-front thinking; `disabled` is not its replacement.
Haiku accepts `disabled` at high or below. Both require adaptive thinking
at xhigh/max. Effort is a behavioral signal, not a strict token budget.
[Official effort guide](https://platform.claude.com/docs/en/build-with-claude/effort).

Claude Code defaults to medium for both. Sonnet requires Claude Code
v2.1.284 or later; Haiku requires v2.1.293 or later. Full IDs preserve
the intended version: on the Anthropic API the aliases resolve to 5.5,
but other providers' aliases can still resolve to earlier models.
Their 1M context is native; a `[1m]` suffix is unnecessary.
[Claude Code model configuration](https://code.claude.com/docs/en/model-config).
Launch an explicitly selected effort; the defaults differ across surfaces.

## Current API tariffs

USD per million tokens, standard global routing:

| Model / prompt length | Input | Output | 5m cache write | 1h cache write | Cache read |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sonnet 5.5, full context | 2.00 | 10.00 | 2.50 | 4.00 | 0.10 |
| Haiku 5.5, up to 100,000 prompt tokens | 0.10 | 0.50 | 0.125 | 0.20 | 0.01 |
| Haiku 5.5, over 100,000 prompt tokens | 0.50 | 2.50 | 0.625 | 1.00 | 0.05 |

The Haiku threshold changes all listed rates, including output. Batch
discounts input/output by 50%. US-only inference costs 1.1 times every
token category on the first-party API and Claude Platform on AWS;
partner cloud regional tariffs are independent. These are tariffs,
not measured coding-task costs or subscription-quota burden.
[Official pricing](https://platform.claude.com/docs/en/about-claude/pricing).

Sonnet's September announcement still lists $0.20 cache reads.
Anthropic's October 7 Haiku announcement reports halving Sonnet cache
reads, consistent with today's $0.10 pricing page.
[Sonnet launch](https://www.anthropic.com/claude-sonnet-5-5),
[Haiku launch](https://www.anthropic.com/claude-haiku-5-5).

## Independent exact-effort measurements

### Artificial Analysis

The two release pages identify the scale as **AA Intelligence Index
v4.3.2**, and their embedded model records expose unrounded
`intelligenceIndex` and `medianOutputSpeed`. All ten index values have
`intelligenceIndexIsEstimated: false`.
[Sonnet release comparison](https://artificialanalysis.ai/models/releases/claude-sonnet-5-5),
[Haiku release comparison](https://artificialanalysis.ai/models/releases/claude-haiku-5-5).

| Model | Effort | Index v4.3.2 | Output tokens/s | AA-Briefcase v1.1 Elo | 95% CI |
| --- | --- | ---: | ---: | ---: | --- |
| Sonnet 5.5 | low | 35.86816 | 102.78977 | 1272.30 | 1261.38–1283.52 |
| Sonnet 5.5 | medium | 40.83865 | 101.93815 | 1442.01 | 1430.82–1452.63 |
| Sonnet 5.5 | high | 46.75335 | 103.55156 | 1639.45 | 1628.51–1650.53 |
| Sonnet 5.5 | xhigh | 51.89555 | 107.29743 | 1751.34 | 1737.85–1765.43 |
| Sonnet 5.5 | max | 56.00013 | 130.53701 | 1823.49 | 1811.83–1836.04 |
| Haiku 5.5 | low | 29.44950 | 184.97641 | 1111.58 | 1101.58–1121.59 |
| Haiku 5.5 | medium | 34.46465 | 155.31608 | 1371.70 | 1363.36–1380.05 |
| Haiku 5.5 | high | 37.82402 | 178.45264 | 1442.55 | 1432.83–1452.27 |
| Haiku 5.5 | xhigh | 41.24893 | 192.82336 | 1532.67 | 1521.87–1543.42 |
| Haiku 5.5 | max | 43.39502 | 244.16674 | 1577.72 | 1567.67–1587.77 |

Exact cards supply the Elo confidence bounds through
`briefcaseBreakdown.overall`:

- Sonnet [low](https://artificialanalysis.ai/models/claude-sonnet-5-5-low),
  [medium](https://artificialanalysis.ai/models/claude-sonnet-5-5-medium),
  [high](https://artificialanalysis.ai/models/claude-sonnet-5-5-high),
  [xhigh](https://artificialanalysis.ai/models/claude-sonnet-5-5-xhigh),
  [max](https://artificialanalysis.ai/models/claude-sonnet-5-5).
- Haiku [low](https://artificialanalysis.ai/models/claude-haiku-5-5-low),
  [medium](https://artificialanalysis.ai/models/claude-haiku-5-5-medium),
  [high](https://artificialanalysis.ai/models/claude-haiku-5-5-high),
  [xhigh](https://artificialanalysis.ai/models/claude-haiku-5-5-xhigh),
  [max](https://artificialanalysis.ai/models/claude-haiku-5-5).

Sonnet cards label the configuration **Default Fallback**. Haiku cards
do not carry that qualifier. Preserve it in Sonnet evidence notes.

[AA-Briefcase](https://artificialanalysis.ai/evaluations/aa-briefcase)
assesses 91 deliverable tasks across four business workflows with rubric,
analytical-quality, and presentation grading. It is knowledge-work
agentic evidence in AA's harness, not a coding-agent pass rate. Its Elo
values move as submissions enter the leaderboard. Today's Sonnet max
is 1823.49, whereas the September Sonnet launch table reported 1811.
Use the dated operator measurement and its interval; earlier catalog
peers retain their own assessment dates. A fixed mapping remains valid,
but near-tie comparisons across snapshots deserve caution.

Output speed is generation throughput, not time to first token or total
task latency. These observations do not establish that lower effort
always has higher tokens/s, or measure subscription quota savings.

### CursorBench 4.0

All ten efforts have exact rows in the operator's current table:

| Model | Effort | Resolved rate | USD/task | Tokens/task | Steps/task |
| --- | --- | ---: | ---: | ---: | ---: |
| Sonnet 5.5 | low | 35.8% | 0.37 | 11,668 | 18 |
| Sonnet 5.5 | medium | 39.2% | 0.52 | 16,036 | 22 |
| Sonnet 5.5 | high | 47.8% | 1.20 | 37,391 | 41 |
| Sonnet 5.5 | xhigh | 53.1% | 2.81 | 100,158 | 78 |
| Sonnet 5.5 | max | 55.5% | 7.05 | 271,920 | 170 |
| Haiku 5.5 | low | 30.9% | 0.08 | 23,382 | 25 |
| Haiku 5.5 | medium | 36.9% | 0.17 | 42,659 | 39 |
| Haiku 5.5 | high | 42.3% | 0.32 | 77,057 | 59 |
| Haiku 5.5 | xhigh | 44.3% | 0.56 | 143,813 | 93 |
| Haiku 5.5 | max | 48.4% | 1.12 | 325,934 | 163 |

CursorBench measures ambiguous multi-file tasks from Cursor sessions.
Version 4.0 added long-horizon tasks on September 10; the October 7
changelog updates Sonnet costs for revised pricing. Costs apply tariffs
to recorded token usage. Cursor publishes no interval and cautions that
small score differences may not be meaningful.
[CursorBench operator table](https://cursor.com/evals).

Keep the task costs in this note: the catalog's `task_cost_usd` requires
DeepSWE evidence. The checked [DeepSWE board](https://deepswe.datacurve.ai/)
has predecessor Sonnet 5, with no Sonnet 5.5 or Haiku 5.5 row. That
economics field remains unknown for these candidates.

### UI and 3D

Arena WebDev's October 7 cutoff contains 141 models and 846,326 votes:

| Exact Sonnet row | Rank | Rank spread | Elo | Votes | Percentile score | Conservative |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `claude-sonnet-5.5-high` | 6 | 6–6 | 1716 ±11 | 3,787 | 0.964 | 0.964 |
| `claude-sonnet-5.5-xhigh` | 3 | 2–4 | 1773 ±15 | 2,150 | 0.986 | 0.979 |

Mapping uses `1 - (rank - 1)/(141 - 1)`; conservative uses the worst
published rank. Sonnet low/medium/max and all Haiku 5.5 efforts lack
exact WebDev rows in this snapshot and remain unknown. Neither the
xhigh row nor vendor design praise supplies a max score.
[Arena WebDev](https://arena.ai/leaderboard/code/webdev).

The [Design Arena changelog](https://www.designarena.ai/changelog)
records adding `claude-sonnet-5-5` on September 28, and runs through
October 6 with no Haiku 5.5 addition. The
[3D leaderboard](https://www.designarena.ai/leaderboard/3d-design)
exposed no model rows through the web reader; reads of its leaderboard
API and registry were inaccessible through that tool. A changelog
addition is not a 3D rank or an effort label. Keep every spatial-3d cell
unknown; this is an evidence-access gap, not proof that Sonnet has no
ranking or poor 3D capability.

## Recommended catalog representation

Add both full model IDs on launcher `claude`, with the five exact
efforts. Each has known reasoning, implementation, agentic, and speed
evidence. UI is known only for Sonnet high/xhigh; 3D and DeepSWE task
cost remain unknown.

Apply the existing mappings consistently:

- Reasoning: index/100, rounded to two decimals; conservative minus
  0.02; high confidence; scale `AA Intelligence Index v4.3.2`.
- Implementation: CursorBench resolved fraction; conservative minus
  0.03 for harness transfer and absent intervals; medium confidence;
  scale `CursorBench 4.0`.
- Agentic: `(Elo - 500)/2000`; conservative uses the lower 95% bound
  followed by a 0.02 harness-transfer reserve; medium confidence;
  scale `AA-Briefcase v1.1 Elo, mapped`.
- UI: dated percentile and worst-rank percentile above; high confidence;
  scale `Arena WebDev rank, percentile`.
- Speed: the exact card's median output throughput, rounded to one
  decimal, with model/effort and date retained in the basis.

These reserves are catalog policy, not independently measured errors.
Reasoning and agentic evidence overlap because Briefcase contributes to
the Intelligence Index. Do not treat them as independent replications.

## Task fit and effort selection

Anthropic positions Sonnet for everyday bounded tasks, bug fixes,
polished documents and visual design; its launch post retains Opus 5.5
as stronger for complex, open-ended judgment. It positions Haiku for
classification, extraction, summaries, compaction, database queries,
short tool work and coding subagents. These are vendor claims and
task-fit guidance, not benchmark cells.
[Sonnet launch](https://www.anthropic.com/claude-sonnet-5-5),
[Haiku launch](https://www.anthropic.com/claude-haiku-5-5).

Anthropic recommends Sonnet medium for well-specified agentic coding,
high for harder or longer work, and low/medium for latency-sensitive
work. Haiku starts at medium for most work including coding; low fits
short/simple workloads, while high fits knowledge work, longer tasks
and stricter instruction following. Its low setting can skip a search,
check or continuation in long prompts. Higher efforts require a
workload-specific quality benefit.
[Official effort guide](https://platform.claude.com/docs/en/build-with-claude/effort).

Independent evidence supports offering both as cheaper metered options
for bounded work, with effort chosen for task difficulty. Inference:
Haiku high exceeds Sonnet medium on CursorBench (42.3% vs 39.2%) at
lower measured cost ($0.32 vs $0.52), while their Briefcase intervals
overlap. Sonnet high is materially stronger than Haiku high on the
two capability scales, and Sonnet xhigh gains coding performance and
has direct UI evidence. Haiku max reaches 48.4% on CursorBench, near
Sonnet high's 47.8%, but uses many more tokens and has lower Briefcase
Elo. These comparisons do not justify a universal model ordering.

For both models, max increases benchmark quality and cost over xhigh;
the existing same-model maximum-effort gate should remain effective.
Tariffs and Cursor task costs support metered comparisons. Relative
subscription quota burden remains unknown, so do not encode these
results as measured Claude subscription savings.

## Retrieval and uncertainty

Haiku's overview initially failed to open directly, then succeeded
through the Sonnet overview's official link. The Sonnet max AA card
initially returned a 503 through the web reader; the release comparison
and later primary model-card HTML reads succeeded. The exact values
were extracted from public Next.js payload JSON: release model records
contain the index/speed and per-evaluation score; individual cards
contain `briefcaseBreakdown.overall` confidence bounds. No graph value
was estimated from an image.

Remaining gaps are 3D rank/effort, eight Sonnet/Haiku UI efforts without
rows, exact DeepSWE task costs, and subscription-quota consumption.
Vendor terminal-coding, FrontierCode, computer-use and customer quotes
were reviewed for positioning and fill no catalog score on a different
scale. The benchmark snapshots are dated observations, not guarantees
about individual tasks.
