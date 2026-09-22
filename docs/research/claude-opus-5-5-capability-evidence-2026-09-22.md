# Claude Opus 5.5 capability evidence

> Maintained-catalog assessment as of 2026-09-22 (Europe/Lisbon). This file
> is the Opus 5.5 assessment for `claude/claude-opus-5-5/high`. It replaces
> the `claude/claude-opus-5/high` candidate. The
> [2026-07-31 snapshot](crew-model-capability-evidence-2026-07-31.md) stays a
> dated record of the Opus 5 measurements. Do not relabel those numbers as
> Opus 5.5.

Research date: 2026-09-22 (Europe/Lisbon)

## Question and boundary

This report replaces the catalog cell for `claude/claude-opus-5/high` with
an assessment of the same launcher on Claude Opus 5.5 at **high** effort:

- `claude/claude-opus-5-5/high` (agent `claude`, model `claude-opus-5-5`)

It does **not** change selector weights or exact routes. It does **not**
copy the Opus 5 scores: reasoning 0.59 / 0.57, implementation 0.74 / 0.68,
agentic 0.88 / 0.82, ui 0.96 / 0.92, spatial-3d 0.78 / 0.72, speed 56.

Public research only. No local model evaluation contributes scores.
Vendor tables and charts are S3. Independent operator measurements are
S1/S2.

Exact means the published number names this model **and** high effort.
Anything else that is still usable is a labeled effort proxy. Missing
direct evidence stays unknown.

Peers cited from existing files and the live catalog, not re-scored here:

- `claude/claude-fable-5-1[1m]/high` —
  [Fable 5.1 evidence](fable-5-1-capability-evidence-2026-09-02.md)
- `codex/gpt-6-astra/high` —
  [Astra evidence](gpt-6-astra-capability-evidence-2026-09-04.md)
- `grok/grok-4.7/high` —
  [Grok 4.7 evidence](grok-4.7-capability-evidence-2026-09-22.md)
- Opus 5 high, the predecessor — the 2026-07-31 snapshot and the live
  catalog cell

## What Claude Opus 5.5 is

Anthropic released Claude Opus 5.5 on 22 September 2026. It is the first
model in a Claude 5.5 family. Anthropic's positioning: long-running agentic
coding and knowledge work, Fable 5.1-level performance on most work, and
about 40% lower cost than Opus 5 at default settings on typical workloads.
The launch post also says Opus 5.5 generates output "more than 30% faster
than Opus 5." That is a vendor claim, not a measured tokens-per-second
figure.

Official identifiers and interface (S3 / high):

| Spec | Value | Source |
| --- | --- | --- |
| Model id | `claude-opus-5-5` (dateless, pinned snapshot). Bedrock `anthropic.claude-opus-5-5` | [model page](https://platform.claude.com/docs/en/models/opus-5-5/overview), [models overview](https://platform.claude.com/docs/en/about-claude/models/overview) |
| Released | 22 September 2026. Retirement not sooner than 22 September 2027 | [model page](https://platform.claude.com/docs/en/models/opus-5-5/overview) |
| Context | 1,000,000 tokens. Max output 128K (300K on Batch with the `output-300k-2026-03-24` beta) | same |
| Knowledge cutoff | reliable June 2026; training data June 2026 | same |
| Modalities | text and images in; text out | same |
| Thinking | adaptive, always on. `thinking: disabled` and manual budgets return 400 | [what's new](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5) |
| Effort | `low`, `medium`, `high`, `xhigh`, `max`. **Default `medium`**, not `high` | [effort](https://platform.claude.com/docs/en/build-with-claude/effort) |
| Tools | server-side and client-side tools, vision, PDF, Files API, computer use through `computer_toolset_20260801` only on the Claude API and Google Cloud. Forced tool use (`tool_choice` `any` / `tool`) returns 400 | [what's new](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5) |
| List price | $4 in / $20 out per 1M. 5m cache write $5, 1h cache write $8, cache read $0.20 (0.05× input) | [pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Long context | full 1M window at standard rates, no surcharge above 200k | same |
| Batch | 50% off: $2 / $10 | same |
| Fast mode | research preview, Claude API only: $8 / $40 per 1M | same |
| US-only inference | 1.1× all token categories | same |

Opus 5 for comparison on the same pricing page: $5 / $25, cache read
$0.50, 5m cache write $6.25.

Anthropic says effort labels are model-specific. On Opus 5.5, "at the same
effort setting the model tends to think more per turn than Claude Opus 5,
most of all at `xhigh` and `max`"
([what's new](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5)).
So Opus 5 high results are not Opus 5.5 high results.

Claude Code identity (S3): the `opus` alias resolves to Opus 5.5 on the
Anthropic API. Opus 5.5 requires Claude Code v2.1.280 or later. It starts
at `medium` effort in Claude Code too, and a top-level `effortLevel` in
user settings does not apply to it. It runs the native 1M window on every
plan, with no `[1m]` variant
([Claude Code model configuration](https://code.claude.com/docs/en/model-config)).
The catalog launch must pass `high` explicitly, or the route runs at
medium.

Launch post: [Introducing Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5).
The models page links `https://www.anthropic.com/news/claude-opus-5-5`,
which returned 404 on 2026-09-22. The post itself is at the URL cited
here. System card: [Opus 5.5 system card](https://www.anthropic.com/claude-opus-5-5-system-card).

Catalog features this evidence supports: `tools`, `vision`,
`long-context`. The 1M window is the same size that `long-context` marks
on the Fable 5.1 and Astra candidates.

## Comparable quantitative evidence

Artificial Analysis Intelligence Index **v4.3.2** is not the index behind
the catalog's Opus 5 cell (59), Fable 5.1 (62, v4.1.1), or Astra (60,
v4.1.1). Opus 5.5 high's 54 on v4.3.2 is not 5 points worse than Opus 5's
catalog 59. On v4.3.2, the current cards show Opus 5 high at **48**.

AA-Briefcase and GDPval-AA below come from AA's current v1.1 and v2.1
boards. Those Elo values are not the v1/v2 values quoted in the 2026-07-31
snapshot.

| Signal | Opus 5.5 high | Opus 5 high (current AA / Cursor / DeepSWE rows) | Claude Fable 5.1 high | GPT-6 Astra high | Grok 4.7 high | Strength |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| AA Intelligence Index v4.3.2 | **54** (53.58) | 48 | 51 | 51 | 46 | S1, all on v4.3.2 as fetched 2026-09-22 |
| AA output speed | **not published** (card shows N/A) | 55.8 tok/s | 55.4 tok/s | 52.2 tok/s | not restated here | S1 |
| AA index-task cost | **not published** (N/A; card price $0.00) | $3.61 | $3.91 | $1.73 | not restated here | S1. Not DeepSWE cost |
| AA-Briefcase v1.1 Elo | **1704.5** (95% CI 1694.5–1714.5) | 1573.3 | 1592.2 | 1506.9 | 1643.9 | S1, exact high |
| GDPval-AA v2.1 Elo | **1691.7** | 1581.0 | 1617.3 | 1484.5 | 1693.7 | S1, exact high |
| CursorBench 4.0 | **56.0%**, $3.97/task, 53,078 tokens, 68 steps | 44.7%, $9.00 | 49.2%, $9.08 | no row | 43.9%, $4.69 | S1, exact high, Cursor harness |
| DeepSWE v1.1, mini-swe-agent | **not published** | 72.83% ±1.95, $6.08/task (exact high) | no 5.1 row | 73.23%, $5.7237 (catalog) | no row | S1 where a row exists |
| Agent Arena | **no Opus 5.5 row** | Opus 5 (High) listed | — | — | no row | S2 for the absence |
| WebDev Arena | **no Opus 5.5 row** | `claude-opus-5-high` listed | — | — | no row | S2 for the absence |
| Design Arena 3D | **no Opus 5.5 ranking** | — | — | — | no row | missing |

Sources checked 2026-09-22:
[AA Opus 5.5 high card](https://artificialanalysis.ai/models/claude-opus-5-5-high),
[AA Opus 5.5 release page](https://artificialanalysis.ai/models/releases/claude-opus-5-5),
[AA max card](https://artificialanalysis.ai/models/claude-opus-5-5),
[AA xhigh card](https://artificialanalysis.ai/models/claude-opus-5-5-xhigh),
[AA medium card](https://artificialanalysis.ai/models/claude-opus-5-5-medium),
[AA Opus 5 high card](https://artificialanalysis.ai/models/claude-opus-5-high),
[AA Fable 5.1 high card](https://artificialanalysis.ai/models/claude-fable-5-1-high),
[AA Astra high card](https://artificialanalysis.ai/models/gpt-6-astra-high),
[AA Grok 4.7 high card](https://artificialanalysis.ai/models/grok-4-7-high),
[AA-Briefcase board](https://artificialanalysis.ai/evaluations/aa-briefcase),
[GDPval-AA board](https://artificialanalysis.ai/evaluations/gdpval-aa),
[CursorBench](https://cursor.com/evals),
[DeepSWE](https://deepswe.datacurve.ai/),
[Agent Arena](https://arena.ai/leaderboard/agent),
[WebDev Arena](https://arena.ai/leaderboard/code/webdev),
[Design Arena](https://www.designarena.ai/leaderboard),
[Design Arena changelog](https://www.designarena.ai/changelog).

### Artificial Analysis

The high card names the configuration "Adaptive Reasoning, High Effort,
Default Fallback." AA ran it with Anthropic's default server-side
fallback, the same labeling as the Fable 5.1 high card. Its model record
gives releaseDate **2026-09-17** for high, xhigh, and medium, and
**2026-09-22** for max. Anthropic's release date is 22 September. The
earlier date is AA's metadata and is recorded as printed.

The five efforts on the release page, all v4.3.2:

| Effort | Index | AA-Briefcase v1.1 | GDPval-AA v2.1 | AA Terminal-Bench 4.0 | Index output tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| max | 58 | 1821.9 | 1846.2 | 59.6% | 260M |
| xhigh | 56 | 1779.5 | 1820.1 | 59.6% | 100M |
| **high** | **54** | **1704.5** | **1691.7** | **56.6%** | **53M** |
| medium | 51 | 1642.1 | 1576.2 | 52.5% | 38M |
| low | 42 | not extracted | not extracted | not extracted | not extracted |

Every Opus 5.5 effort shows speed "N/A" and index-task cost "N/A". Input
and output prices display $0.00. No `medianOutputSpeed` is in any Opus 5.5
model record. The speed and AA cost cells are not published, not zero.

The high card's Briefcase breakdown: analytical quality **2039.5** Elo,
presentation **1555.4** Elo, rubric pass rate **58.9%**. The high
configuration used about 35.6k output tokens per index task.

Ordinal placement on AA's boards as of 2026-09-22 (top 20 shown on each
board):

- **AA-Briefcase:** Opus 5.5 high is **#3**, behind only Opus 5.5 max and
  xhigh. It is ahead of every other model at every effort, including
  Fable 5.1 max (1678.4), Opus 5 max (1673.3), Grok 4.7 xhigh (1657.2),
  and Grok 4.7 high (1643.9).
- **GDPval-AA:** Opus 5.5 high is **#8** at 1691.7. Ahead of it: Opus 5.5
  max and xhigh, Fable 5.1 max (1734.7) and xhigh (1720.9), Opus 5 max
  (1707.9), and Grok 4.7 xhigh (1695.2) and high (1693.7). The last two
  are within 4 Elo, so read that as a tie.

### Cursor

Cursor's public CursorBench 4.0 table lists **Opus 5.5 High at 56.0%**,
$3.97 per task, 53,078 tokens per task, 68 steps per task. This is an
exact high row in Cursor's own agent harness. It is the same class of
evidence the catalog uses for Fable 5.1 high (CursorBench 3.2, 69.4%).

CursorBench **4.0** is a different benchmark version from 3.2. Cursor's
changelog says 4.0 arrived on 10 September 2026 and "introduced new
long-horizon problems focused on edit, refactor, investigation, intent
understanding, managing jobs, and design adherence." A 4.0 percent is not
on the 3.2 scale and is not on DeepSWE's scale. On the same 4.0 table:

| CursorBench 4.0 row | Score | $/task | Steps |
| --- | ---: | ---: | ---: |
| Opus 5.5 Max | 57.8% | $13.43 | 185 |
| Opus 5.5 Extra High | 56.0% | $6.98 | 109 |
| **Opus 5.5 High** | **56.0%** | **$3.97** | **68** |
| Opus 5.5 Medium | 52.5% | $2.91 | 54 |
| Fable 5.1 Max | 51.8% | $17.28 | 128 |
| Fable 5.1 High | 49.2% | $9.08 | 77 |
| Opus 5 High | 44.7% | $9.00 | 86 |
| Grok 4.7 High | 43.9% | $4.69 | 71 |
| GPT-5.6 Sol High | 35.7% | $2.85 | 41 |

GPT-6 Astra has no row on this table. Cursor's $3.97 is a CursorBench
cost. It is not a DeepSWE task cost and does not go in `task_cost_usd`.

### DeepSWE

The public board says "updated September 22, 2026." Its live JSON
(`/artifacts/v1.1/leaderboard-live.json`) was generated
**2026-09-22T06:27:15Z**, 113 tasks, 70 configurations, harness
`mini-swe-agent`. The latest job is the 1 September GPT-6 Astra run.
Claude model ids present: `claude-fable-5`, `claude-opus-4-8`,
`claude-opus-5`, `claude-sonnet-4-6`, `claude-sonnet-5`. There is no
`claude-opus-5-5` row at any effort.

The board now has an exact **Opus 5 high** row: 72.83% ±1.95%, mean
$6.08/task. That is predecessor data. It is not a 5.5 measurement. It is
also not applied back to the retired Opus 5 cell here.

### Anthropic launch charts (S3)

The launch post's headline table is **max** effort unless noted.
Terminal-Bench 4.0 is **xhigh** in Claude Code (66.4%). The accuracy-vs-cost
charts embed a per-effort series. The **high** points for Opus 5.5, with
Opus 5 high from the same charts:

| Benchmark (vendor chart) | Opus 5.5 high | Opus 5 high | Note |
| --- | ---: | ---: | --- |
| Terminal-Bench 4.0 | 64.2%, $3.88/attempt | 47.0% | Anthropic harness. AA's own Terminal-Bench 4.0 component at high is 56.6% |
| FrontierCode v1.1 main | 54.0%, $1.09/task | 48.0% | medium is 54.6%, above high |
| CursorBench 4.0 | 56.0%, $3.97/task | 44.7% | matches Cursor's public row |
| GDPval-AA v2.1 | 1692 Elo, $1.54/task | 1581 | matches AA's card |
| AutomationBench | 32.0% | 20.6% | Zapier |
| WANDR | 67.3% | 64.6% | Anthropic-run setup, not Perplexity's published one |

Anthropic's footnote: when production safeguards intervened, cybersecurity
tasks were completed by Opus 4.8 and biology and frontier-LLM development
tasks by Opus 5. The CursorBench and GDPval high points agree with the
independent boards. The others are vendor-only and do not fill any cell.

The launch post has one UI-adjacent claim: a tester had several Claude
models build a game from a single prompt, and Opus 5.5 "scored higher
than any other model on the strength of its graphics and polish." That is
an anecdote, not a WebDev or Design Arena rank.

### Arenas

Agent Arena, fetched 2026-09-22 (page `dateModified` 2026-09-22), carries
snapshot `lastUpdated` **2026-09-15T20:00Z**, 1,850,083 sessions. It lists
Opus 5 (High) and Opus 5 (Max). No Opus 5.5 row.

WebDev's full board (`/leaderboard/code/webdev`) has vote cutoff
**2026-09-11T19:00Z**, 679,295 votes, 129 models. It lists
`claude-opus-5-high`, `claude-opus-5-max`, and `claude-fable-5.1-max`. It
does not contain `claude-opus-5-5`.

Design Arena's leaderboard page says "Last updated September 14, 2026."
Its data metadata stamps 2026-09-22T16:30Z. The page and the
`/leaderboard/3d-design` page contain no `claude-opus-5-5` slug, and the
3D page did not render a model table. The changelog runs through **20
September 2026** (added `gpt-6-astra-max`) with no Opus 5.5 addition.

## Mapping onto catalog methodology

The catalog routes on `conservative`. Exact means the published number
matches the candidate's model **and** effort. Otherwise the cell is a
labeled effort proxy.

| Dimension | Raw published number | Catalog score / conservative | Confidence | Exact or proxy | Evidence |
| --- | --- | ---: | --- | --- | --- |
| reasoning | AA Intelligence Index **54** (53.58) for Opus 5.5 **high**, v4.3.2 | **0.54 / 0.52** | high | exact | [AA high card](https://artificialanalysis.ai/models/claude-opus-5-5-high), [AA release page](https://artificialanalysis.ai/models/releases/claude-opus-5-5) |
| implementation | CursorBench **4.0** Opus 5.5 High **56.0%**. No DeepSWE row | **0.56 / 0.53** | medium | exact high, Cursor harness | [CursorBench](https://cursor.com/evals), [DeepSWE](https://deepswe.datacurve.ai/) |
| agentic | AA-Briefcase **1704.5** (#3 on the board, first outside Opus 5.5's own higher efforts). GDPval-AA **1691.7** (#8). Both exact high. Agent Arena has **no 5.5 row** | **0.90 / 0.84** | medium | exact high agentic-work evidence; no Arena row | [AA high card](https://artificialanalysis.ai/models/claude-opus-5-5-high), [AA-Briefcase](https://artificialanalysis.ai/evaluations/aa-briefcase), [GDPval-AA](https://artificialanalysis.ai/evaluations/gdpval-aa), [Agent Arena](https://arena.ai/leaderboard/agent) |
| ui | no `claude-opus-5-5` row on WebDev | **unknown** | — | missing | [WebDev Arena](https://arena.ai/leaderboard/code/webdev) |
| spatial-3d | no Design Arena addition or rank | **unknown** | — | missing | [Design Arena](https://www.designarena.ai/leaderboard), [changelog](https://www.designarena.ai/changelog) |
| task cost | no DeepSWE row at any effort | **unknown** | — | missing. Cursor's $3.97 is not this cell | [DeepSWE](https://deepswe.datacurve.ai/) |
| speed | AA shows N/A for every Opus 5.5 effort | **unknown** | — | missing. Anthropic's "30% faster" is not a figure | [AA high card](https://artificialanalysis.ai/models/claude-opus-5-5-high) |

How each score was derived:

- **Reasoning: 2 points** off the exact v4.3.2 index (54 → 0.52). Same
  reserve the Fable 5.1, Astra, and Grok 4.7 high cells use for an exact
  AA index. No effort haircut: the card is the high configuration.
- **Implementation: exact, harness-transfer haircut only.** The catalog
  accepts CursorBench when exact, as it does for Fable 5.1 high. The raw
  56.0% gives score 0.56. Fable 5.1 took about 2.4 points (0.694 → 0.67)
  for Cursor-to-Claude-Code harness transfer. This cell takes **3
  points** (0.56 → 0.53): the same transfer reserve, rounded up because
  Cursor prints no interval and 4.0 has been live for 12 days. The
  conservative is not reduced further for the scale problem. That problem
  is a comparison caveat, recorded in the note, not a capability deficit.
- **Agentic: starts from the catalog's Opus 5 high Briefcase anchor of
  0.88, then moves on new evidence.** That cell scored Opus 5 high at
  0.88 because it led Fable 5 on AA-Briefcase at high effort. Opus 5.5
  high is exact high on both AA agentic-work boards. On Briefcase it
  beats every non-5.5 configuration at any effort, and beats Opus 5 high
  by 131 Elo on the same v1.1 board. On GDPval it beats Opus 5 high by
  111 Elo but ranks #8, tied with Grok 4.7 high and behind Fable 5.1 max
  and xhigh. That supports **+2 points** over the anchor (0.90), not
  more. **6 points** then come off because Agent Arena has no 5.5 row
  (0.90 → **0.84**). This is the same Arena gap the Grok 4.6 and 4.7
  reports applied. No effort haircut: both Elo figures are high.
- **UI and 3D: no haircut, because there is no row to haircut.** Opus 5
  high's WebDev #3 (0.96 / 0.92) and Design Arena rank (0.78 / 0.72) stay
  on the Opus 5 snapshot.

## Side-by-side with the live catalog peers

Conservative values the router uses. Reasoning numbers are **not** on one
index. 0.52 and Grok 4.7's 0.44 are v4.3.2. Fable 5.1's 0.60 and Astra's
0.58 are v4.1.1. Opus 5's 0.57 is the index AA published in July.
Implementation numbers are **not** on one benchmark either. 0.53 is
CursorBench 4.0, Fable 5.1's 0.67 is CursorBench 3.2, and Astra's 0.698 is
DeepSWE.

| Candidate | reasoning | implementation | agentic | ui | spatial-3d | task cost | speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `claude/claude-opus-5/high` (retired cell) | 0.57 | 0.68 | 0.82 | 0.92 | 0.72 | unknown | 56 |
| `claude/claude-fable-5-1[1m]/high` | 0.60 | 0.67 | unknown | unknown | unknown | unknown | 49.1 |
| `codex/gpt-6-astra/high` | 0.58 | 0.698 | unknown | unknown | unknown | $5.7237 | unknown |
| `grok/grok-4.7/high` | 0.44 | unknown | 0.74 | unknown | unknown | unknown | 54.2 |
| **`claude/claude-opus-5-5/high` (this assessment)** | **0.52** | **0.53** | **0.84** | **unknown** | **unknown** | **unknown** | **unknown** |

Reading:

- **Reasoning.** On v4.3.2, as fetched today, Opus 5.5 high is 54,
  Fable 5.1 high and Astra high are 51, Opus 5 high is 48, and Grok 4.7
  high is 46. Do not rank 0.52 under Astra's 0.58 or Fable's 0.60. Those
  cells have not been restated on v4.3.2.
- **Implementation.** 0.53 is the lowest implementation number in the
  table, but on CursorBench 4.0 Opus 5.5 high leads Fable 5.1 high by 6.8
  points (56.0% vs 49.2%) and Opus 5 high by 11.3 points, at under half
  their cost per task. The low number is a scale effect: CursorBench 4.0
  is harder than 3.2, and DeepSWE is a different benchmark. A router that
  compares implementation conservatives numerically will under-rank this
  candidate. Resolving that means restating the peers on one scale, which
  is outside this report.
- **Agentic.** 0.84 comes from exact high AA agentic-work Elo. It is not
  the old 0.82 relabeled, and it is not an Arena ordinal. Fable 5.1 high
  and Astra high are still unknown on this dimension. Do not read 0.84 as
  a measured win over those unknowns, although AA's current boards also
  place Opus 5.5 high above both of those high configurations on
  Briefcase and GDPval.
- **UI and 3D.** Unknown. The Opus 5 WebDev and Design Arena ranks are
  not Opus 5.5 ranks. Replacing the Opus 5 cell drops two known
  dimensions from the pool until the arenas add 5.5.
- **Speed and economics.** No independent speed figure. List price is
  $4 / $20 with $0.20 cache reads, below Opus 5's $5 / $25 / $0.50.
  That is a tariff, not a task cost. DeepSWE task cost is unknown.

## Recommendation for the catalog candidate

Replace `claude/claude-opus-5/high` with `claude/claude-opus-5-5/high`.
Launch model `claude-opus-5-5`, effort `high`, passed explicitly, because
the model's API and Claude Code default is `medium`.

Do **not** copy Opus 5 scores. Do **not** invent a WebDev, Design Arena,
or Agent Arena rank. Do **not** put Cursor's $3.97, AA prices, or list
prices into `task_cost_usd`. Do **not** put Anthropic's "30% faster" into
`output_tokens_per_second`.

## Proposed catalog cell

```json
{
  "launch": {
    "agent": "claude",
    "model": "claude-opus-5-5",
    "effort": "high"
  },
  "features": ["tools", "vision", "long-context"],
  "context": 1000000,
  "context_evidence": "https://platform.claude.com/docs/en/models/opus-5-5/overview",
  "capabilities": {
    "reasoning": {
      "status": "known",
      "score": 0.54,
      "conservative": 0.52,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/claude-opus-5-5-high",
        "https://artificialanalysis.ai/models/releases/claude-opus-5-5"
      ],
      "note": "AA Intelligence Index v4.3.2 (53.58, displayed 54), high with default fallback. Not comparable to v4.1.1 cells (Fable 5.1 0.62, Astra 0.60) or Opus 5's July cell (0.59). On v4.3.2: Opus 5 high 48, Fable 5.1 high 51, Astra high 51, Grok 4.7 high 46."
    },
    "implementation": {
      "status": "known",
      "score": 0.56,
      "conservative": 0.53,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://cursor.com/evals"
      ],
      "note": "CursorBench 4.0 Opus 5.5 High 56.0% ($3.97/task, 68 steps) in Cursor's harness; 3-point harness-transfer reserve. CursorBench 4.0 is not the 3.2 scale (Fable 5.1 0.694) or DeepSWE (Astra 0.7323). On 4.0: Fable 5.1 High 49.2%, Opus 5 High 44.7%, Grok 4.7 High 43.9%. DeepSWE has no claude-opus-5-5 row as of 2026-09-22T06:27:15Z."
    },
    "agentic": {
      "status": "known",
      "score": 0.9,
      "conservative": 0.84,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/claude-opus-5-5-high",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/evaluations/gdpval-aa",
        "https://arena.ai/leaderboard/agent"
      ],
      "note": "Exact high AA-Briefcase v1.1 1704.5 (#3, first outside Opus 5.5 xhigh/max) and GDPval-AA v2.1 1691.7 (#8). +2 over the Opus 5 high Briefcase anchor (0.88), -6 because Agent Arena (snapshot 2026-09-15) has no Opus 5.5 row."
    },
    "ui": {
      "status": "unknown",
      "reason": "Arena WebDev, checked 2026-09-22 (vote cutoff 2026-09-11, 129 models), has no claude-opus-5-5 row. Opus 5 high's #3 is not carried forward.",
      "researched_at": "2026-09-22"
    },
    "spatial-3d": {
      "status": "unknown",
      "reason": "Design Arena's changelog through 20 September 2026 has no Opus 5.5 addition, and neither the leaderboard nor the 3D page contains a claude-opus-5-5 rank on 2026-09-22.",
      "researched_at": "2026-09-22"
    }
  },
  "economics": {}
}
```

Economics, both unknown:

- `output_tokens_per_second`: **omitted.** Artificial Analysis shows N/A
  for every Opus 5.5 effort on 2026-09-22 and publishes no median speed.
  Anthropic's "more than 30% faster than Opus 5" is a vendor ratio, not a
  measurement. Basis when it appears: Artificial Analysis, Opus 5.5 high;
  source `https://artificialanalysis.ai/models/claude-opus-5-5-high`.
- `task_cost_usd`: **omitted.** DeepSWE has no `claude-opus-5-5` row at
  any effort. Basis when it appears: DeepSWE high, mini-swe-agent; source
  `https://deepswe.datacurve.ai/`.

The router's candidate validator accepts this object, including the empty
`economics` and the extra `note` keys. Jev's context builder copies only
status, score, conservative, confidence, dates, and `reason`. The `note`
text is for maintainers, and Jev never sees it. If the scale caveats
should reach Jev, they need a field Jev reads.

The agentic score is written `0.9` to match the catalog's style for a
two-digit tenth (`0.8` for Grok 4.7). It means 0.90.

## Honest gaps

- Intelligence Index v4.3.2 replaced the scale behind the Opus 5 (59),
  Fable 5.1 (62, v4.1.1), and Astra (60, v4.1.1) catalog cells. This file
  records 54 and does not rescale the peers.
- CursorBench 4.0 replaced 3.2 on Cursor's board on 10 September 2026.
  The implementation cell is exact but sits on a harder scale than Fable
  5.1's 3.2 cell and Astra's DeepSWE cell. Numeric comparison
  under-ranks Opus 5.5.
- DeepSWE has no Opus 5.5 row as of the 2026-09-22T06:27:15Z extract.
  DeepSWE task cost is unknown. Opus 5's new exact high row (72.83%,
  $6.08) is predecessor data.
- Artificial Analysis publishes no output speed or index-task cost for
  any Opus 5.5 effort yet. The speed cell is unknown.
- AA dates the high, xhigh, and medium records 17 September 2026 and max
  22 September. Anthropic's release is 22 September. Recorded as printed.
- Agent Arena (15 September snapshot), WebDev (11 September cutoff), and
  Design Arena (changelog through 20 September) have no Opus 5.5 entry.
  Agentic carries a 6-point Arena gap; UI and 3D are unknown.
- Vendor high-effort points for Terminal-Bench 4.0 (64.2%), FrontierCode
  (54.0%), AutomationBench (32.0%), and WANDR (67.3%) are S3 and fill no
  cell. Anthropic's Terminal-Bench high point differs from AA's
  independent 56.6% at high.
- Anthropic's evaluations ran with production safeguards, and some tasks
  fell back to Opus 4.8 or Opus 5. AA's cards also use default fallback.
  Neither source reports how often fallback happened at high.
- The Anthropic models page links a launch URL under `/news/` that
  returned 404 on 2026-09-22. The live post is at
  `https://www.anthropic.com/claude-opus-5-5`.
- No public code-review or product-UX benchmark for Opus 5.5 was used.
  Customer quotes in the launch post (for example a code-review bug-catch
  rate) are anecdotes and not scores.
