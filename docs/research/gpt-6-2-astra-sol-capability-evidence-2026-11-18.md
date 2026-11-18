# GPT-6.2 Astra and GPT-6.2 Sol capability evidence

Research date: 2026-11-18, one day after release.

## Scope and evidence rules

This note records public capability evidence for four candidates that
replace older GPT-6 entries in the routing catalog:

| New candidate | Replaces |
| --- | --- |
| `codex/gpt-6.2-astra/high` | `codex/gpt-6-astra/high` |
| `claudex/gpt-6.2-astra/high` | `claudex/gpt-6-astra/high` |
| `codex/gpt-6.2-sol/high` | `codex/gpt-6.1-sol/high` |
| `codex/gpt-6.2-sol/max` | `codex/gpt-6-sol/max` |

`cursor/gpt-6.1-sol/high` becomes `cursor/gpt-6.2-sol/high`. It stays
launch-support-only with every cell unknown: `cursor-agent models`
(version `2026.10.22-27dcf5f`, run 2026-11-18) lists no GPT-6.x model
at all, so no Cursor-harness evidence could exist. No further research
was done for that tuple.

The catalog adopted the JSON at the end of this note on 2026-11-18. The catalog's `methodology` block
and the [score-normalization research](model-routing-score-normalization-2026-09-22.md)
set the mappings. The shape follows the
[Fable 5.2 note](fable-5-2-capability-evidence-2026-11-10.md).
Predecessor figures come from the
[GPT-6 Sol/Luna note](gpt-6-sol-luna-capability-evidence-2026-09-22.md),
the [GPT-6 Astra note](gpt-6-astra-capability-evidence-2026-09-04.md)
and the live catalog.

A number counts only when the source names GPT-6.2 Astra or Sol **and**
the effort. No GPT-6, 6.1 or other-effort value goes into a 6.2 cell.
Nothing below is a local evaluation or a subscription-quota measurement.

## Model identity and interface

| Property | GPT-6.2 Astra | GPT-6.2 Sol |
| --- | --- | --- |
| API model ID | `gpt-6.2-astra` | `gpt-6.2-sol` |
| Release | 2026-11-17 | 2026-11-17 |
| OpenAI positioning | "Our most capable model for your hardest projects, from start to finish." | "Our go-to model for everyday work, from coding to powering agents at scale." |
| API context / max input / max output | 1,050,000 / 922,000 / 128,000 | 1,050,000 / 922,000 / 128,000 |
| API modalities | text and image in; text out; audio and video unsupported | text and image in; text out; audio and video unsupported |
| Knowledge cutoff | 2026-05-18 | 2026-06-01 |
| API efforts | `none` rejected; reasoning guide lists up to `xhigh` and `max` | same |
| Codex efforts (local cache) | `low`, `medium`, `high`, `xhigh`, `max`, `ultra`; default `low` | same; default `low` |
| Codex `context_window` / `max_context_window` | 272,000 / 872,000 | 500,000 / 872,000 |
| Codex `input_modalities` | `text`, `image` | `text`, `image`, `audio` |
| Codex speed tiers | `fast` | `fast`, `ultrafast` |

Sources: [GPT-6.2 Astra model page](https://developers.openai.com/api/docs/models/gpt-6.2-astra),
[GPT-6.2 Sol model page](https://developers.openai.com/api/docs/models/gpt-6.2-sol),
[API changelog, Nov 17](https://developers.openai.com/api/docs/changelog),
[Using GPT-6.2](https://developers.openai.com/api/docs/guides/latest-model),
[reasoning guide](https://developers.openai.com/api/docs/guides/reasoning).
The Codex facts come from `~/.codex/models_cache.json`
(`fetched_at` 2026-11-18T12:06:48Z, client 0.169.0), which is identity
evidence only.

- **Sol audio input differs by surface.** The Codex cache lists `audio`
  for `gpt-6.2-sol`. The API model page lists audio as unsupported. The
  catalog feature `vision` is supported on both surfaces. Nothing here
  supports an audio feature for API use.
- **The Codex window is not the API window.** Codex serves Astra at
  272,000 and Sol at 500,000 tokens. The API page says 1,050,000.
  Artificial Analysis cards show "1M". The requested entries carry no
  `context` field, consistent with the entries they replace.
- **Defaults.** OpenAI's migration guide says to "Start with `medium`
  for a new integration". The Codex cache default is `low`. Launch an
  explicit effort.
- **`ultra`** ("Maximum reasoning with automatic task delegation") is
  Codex-only. No public source measures it.
- **Breaking API changes** (relevant to API callers, not to Codex
  launches): the Responses API drops reasoning items after prefix edits,
  and top-level `instructions` are appended after `input`.

## Current API tariffs

USD per 1M tokens, Standard tier, short context (≤272K input), from the
model pages and the [pricing page](https://developers.openai.com/api/docs/pricing):

| Model | Input | Cached input | 30m cache write | 12h cache write | Output |
| --- | ---: | ---: | ---: | ---: | ---: |
| `gpt-6.2-astra` | 8.00 | 0.40 | 10.00 | 20.00 | 40.00 |
| `gpt-6.2-sol` | 2.00 | 0.10 | 2.50 | 5.00 | 10.00 |
| `gpt-6-astra` (predecessor) | 10.00 | 1.00 | 12.50 | 25.00 | 50.00 |
| `gpt-6.1-sol` (predecessor) | 2.00 | 0.10 | 2.50 | 5.00 | 10.00 |

Above 272K input tokens the whole request is billed at 2× input and
cache rates and 1.5× output. Batch is 50% of Standard. Fast is 2×.
Ultrafast is 3× through 2027-02-28 and 6× from 2027-03-01. Background
completion windows (public beta, 2026-11-17) are 30% off for two hours
and 40% off for eight hours. Artificial Analysis's
[launch article](https://artificialanalysis.ai/articles/openai-has-the-2-model-in-the-intelligence-index-with-the-release-of-gpt-6-2-astra-and-gpt-6-2-sol)
confirms Astra is "20% below GPT-6 Astra" and Sol is "unchanged from
GPT-6.1 Sol". Tariffs are not task costs and do not measure ChatGPT/Codex
subscription quota.

## Independent exact-effort measurements

### Artificial Analysis

**The URL layout changed.** Per-effort slugs now return HTTP 308 to the
release page: `/models/gpt-6-2-astra-high` and `-xhigh` go to
`/models/gpt-6-2-astra`, and `/models/gpt-6-2-sol-high` goes to
`/models/gpt-6-2-sol`. The same applies to `/models/claude-fable-5-2-high`,
so this is a site-wide change since 2026-11-10. Each release page embeds
one model record per effort. The values below are the unrounded fields
of those records, read 2026-11-18:

- [GPT-6.2 Astra](https://artificialanalysis.ai/models/gpt-6-2-astra)
- [GPT-6.2 Sol](https://artificialanalysis.ai/models/gpt-6-2-sol)

Both pages name "Artificial Analysis Intelligence Index v5.0.1" and
"AA-Briefcase v1.1". The records carry no "estimated" field and no
fallback qualifier. Performance and price data are first-party (OpenAI
API).

| Model (AA name) | Intelligence Index v5.0.1 | AA-Briefcase v1.1 Elo | 95% CI | Output tok/s | TTFT (s) | Index cost / task (USD) |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| GPT-6.2 Astra (Max) | 62.1387990593969 | 1643.50 | 1633.04–1654.99 | 53.00 | 171.0 | 4.00 |
| GPT-6.2 Astra (Xhigh) | 61.5602325371388 | 1594.37 | 1584.42–1604.70 | 54.16 | 52.9 | 2.52 |
| **GPT-6.2 Astra (High)** | **60.0882280338247** | **1570.41** | **1560.83–1580.63** | **55.60** | 22.1 | 2.07 |
| GPT-6.2 Astra (Medium) | 56.9986252138657 | 1408.20 | 1398.19–1418.60 | 52.73 | 3.2 | 1.62 |
| GPT-6.2 Astra (Low) | 45.6504174923967 | 1038.71 | 1029.33–1048.69 | 53.35 | 2.8 | 0.66 |
| **GPT-6.2 Sol (Max)** | **57.2576209885477** | **1612.06** | **1602.83–1623.07** | **84.58** | 66.7 | 1.01 |
| GPT-6.2 Sol (Xhigh) | 55.7351067246438 | 1580.04 | 1570.05–1592.21 | 81.03 | 26.6 | 0.65 |
| **GPT-6.2 Sol (High)** | **54.8898658241942** | **1540.79** | **1530.79–1552.48** | **77.83** | 9.6 | 0.56 |
| GPT-6.2 Sol (Medium) | 52.6777305876603 | 1494.92 | 1484.69–1505.51 | 72.76 | 3.0 | 0.41 |
| GPT-6.2 Sol (Low) | 40.5525089432850 | 1229.56 | 1218.19–1241.38 | 70.40 | 2.0 | 0.18 |

Bold rows are the catalog tuples. Output speed is the record's
`headline.outputSpeed`. AA defines it as end-to-end output speed
averaged over five days. It is not a median, which matches the Fable
5.2 cells and differs from the older median cells. TTFT is
`headline.timeToFirstToken`. Index cost per task is AA's weighted cost
over its index suite, not a DeepSWE task cost.

Predecessors on the **same** v5.0.1 scale, read from the same site on
the same day. These are context only and fill no 6.2 cell:

| Predecessor (AA name) | Index v5.0.1 | Briefcase Elo [95% CI] | Output tok/s |
| --- | ---: | --- | ---: |
| GPT-6 Astra (High) | 54.85 | 1502.98 [1495.30–1510.95] | 43.74 |
| GPT-6 Astra (Max) | 56.85 | 1568.82 [1561.64–1577.67] | 43.39 |
| GPT-6.1 Sol (High) | 50.33 | 1468.58 [1459.20–1478.39] | 50.52 |
| GPT-6.1 Sol (Max) | 54.61 | 1557.04 [1548.78–1565.99] | 48.22 |
| GPT-6 Sol (Max) | 44.16 | 1475.58 [1467.95–1483.76] | 116.98 |

The catalog's current predecessor cells are v4.3.2 (GPT-6 Astra high
50.92; GPT-6 Sol max 47.53). They cannot be compared with these v5.0.1
values. On v5.0.1, Astra high gains about 5.2 index points over GPT-6
Astra high, and Briefcase rises about 67 Elo. Sol high gains about 4.6
points and 72 Elo over GPT-6.1 Sol high. Sol max gains about 13 points
over GPT-6 Sol max. Two side notes: the GPT-6 Astra high Briefcase Elo
now reads 1502.98, against 1506.86 in the catalog, so Elo drifts as
submissions arrive. The predecessor GPT-6 Sol records show no index
value below max on v5.0.1.

The [AA launch article](https://artificialanalysis.ai/articles/openai-has-the-2-model-in-the-intelligence-index-with-the-release-of-gpt-6-2-astra-and-gpt-6-2-sol)
(2026-11-17) puts GPT-6.2 Astra second in the index behind Claude Fable
5.2. It says Sol "gains 2 points at 57". Measured on the Codex harness
at max, it reports "no improvement in Coding Agent Index": Astra is flat
with GPT-6 Astra, and Sol loses 3 points against GPT-6.1 Sol, driven by
a 14-point drop in SWE-Atlas-QnA-AA. Hallucination rates at max are 59%
for Astra and 55% for Sol.

### Implementation: CursorBench 4.0, DeepSWE v1.1, AA Coding Agent Index

| Source | GPT-6.2 Astra | GPT-6.2 Sol | Stamp |
| --- | --- | --- | --- |
| [CursorBench 4.0](https://cursor.com/evals) | no row | no row | No GPT-6.x row at all. The chart lists GPT-5.6 Sol/Terra/Luna as the newest OpenAI models. Latest changelog entry 2026-10-07. |
| [DeepSWE v1.1](https://deepswe.datacurve.ai/) | no row | no row | Page: "113 tasks · updated September 22, 2026". [Live JSON](https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json) `generated_at` 2026-09-22T06:27:15Z. Its only GPT-6 model is `gpt-6-astra`. The [changelog](https://deepswe.datacurve.ai/changelog) ends at the 2026-09-03 GPT-6 Astra entry. |
| [AA Coding Agent Index v2.1](https://artificialanalysis.ai/agents/coding-agents), Codex 0.166.0 | exact rows at all five efforts | exact rows at all five efforts | `materializedAt` 2026-11-18T03:12Z |

The AA coding board has exact Codex rows. Its components are
**FrontierCode 2.0, SWE-Atlas-QnA and Terminal-Bench v4**, and DeepSWE
is not among them. AA dropped DeepSWE from this index at v2.0, as the
[Terra note](gpt-6-1-terra-capability-evidence-2026-10-29.md) records.
The September route that filled GPT-6 Sol max with AA's Codex DeepSWE
component is therefore closed. These rows are on neither the
CursorBench 4.0 nor the DeepSWE v1.1 scale, and they fill no
implementation cell. They are recorded here for context:

| Codex row | Index v2.1 | FrontierCode 2.0 | SWE-Atlas-QnA | Terminal-Bench v4 | Mean API USD / task | Mean wall time (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GPT-6.2 Astra (High) | 0.5228 | 0.4216 | 0.5457 | 0.6010 | 2.37 | 947 |
| GPT-6.2 Astra (Max) | 0.5347 | 0.4167 | 0.5511 | 0.6364 | 5.12 | 1507 |
| GPT-6.2 Sol (High) | 0.4746 | 0.3829 | 0.5054 | 0.5354 | 0.76 | 635 |
| GPT-6.2 Sol (Max) | 0.4862 | 0.4153 | 0.4624 | 0.5808 | 1.22 | 1051 |

Each row has 966 scored attempts (396 / 372 / 198) and no interval.
Hard-stop refusals: Astra high 6, Astra max 8, Sol high 14, Sol max 25,
mostly on SWE-Atlas-QnA. The mean API cost averages three benchmarks.
It is not a DeepSWE task cost and does not fill `task_cost_usd`.

### Arena WebDev (UI)

[Arena WebDev](https://arena.ai/leaderboard/code/webdev) shows the date
"Nov 13, 2026", 1,007,405 votes and 159 models. That date is four days
before the release. No GPT-6.2 row appears in the readable ranks 1–152,
and no AutoEval or Preliminary row appears either. The nearest OpenAI
rows are GPT-6 Astra (Max) at rank 5 (1763 ±8) and GPT-6.1 Sol (Max) at
rank 8 (1742 ±10). Both are other models and are not used.

Retrieval caveat: direct requests and a text reader both returned
HTTP 403 (Cloudflare challenge). The rows were read through a
summarizing web reader whose output was truncated after rank 152, so
ranks 153–159 were not seen. A new model would normally enter far above
rank 153, and the page date predates the launch.
[`/leaderboard/code`](https://arena.ai/leaderboard/code) showed no rows
and no date.

### Design Arena 3D (spatial-3d)

- The [changelog](https://www.designarena.ai/changelog) records "added
  gpt-6.2-astra" and "added gpt-6.2-sol" on **2026-11-17**.
- The [`/api/registry`](https://www.designarena.ai/api/registry) lists
  both for the `3d` model arena. Their display names are "GPT-6.2 Astra"
  and "GPT-6.2 Sol", **with no effort label**. Compare GPT-6 Astra,
  labelled "GPT-6 Astra (xhigh)", and GPT-6.1 Sol max, labelled
  "GPT-6.1 Sol (max)". The registry also carries API prices that match
  OpenAI's.
- The [3D leaderboard](https://www.designarena.ai/leaderboard/3d-design)
  payload (board `models/3d`, variation `public`, `lastUpdateTime`
  2026-11-18T10:37:01Z, 321,841 votes, 183 models) has **no `gpt-6.2-*`
  row**. Its GPT-6 rows are `gpt-6-astra-max` #1 (1533),
  `gpt-6-astra` #4 (1456), `gpt-6.1-sol` #8 (1420), `gpt-6-sol` #27,
  `gpt-6.1-terra` #32 and `gpt-6-luna` #73. All are predecessors and are
  not carried over.

When a row appears, its effort will have to be inferred, because the
registry names none. The bare `gpt-6.2-sol` id would not support a max
cell unless a `-max` mode is added, as was done for 6.1 Sol.

The AA launch article reports **AA-3D** Elo (Astra 1318, Sol 1259; Fable
5.2 1271). That is Artificial Analysis's own human-graded benchmark, not
Design Arena 3D, and the article names no effort. It fills no cell.

### Vendor claims

The [launch post](https://openai.com/index/introducing-gpt-6-2-astra-sol/)
returned HTTP 403 to both direct and reader requests and was not read.
The [system card](https://deploymentsafety.openai.com/gpt-6-2-astra-sol)
was not reviewed. Vendor numbers would fill no cell on these scales in
any case.

## Mapping to the catalog

Transforms are the catalog's existing ones, at the precision the Fable
5.2 cells use:

- Reasoning: index / 100; conservative = score − 0.02; high confidence;
  scale `AA Intelligence Index v5.0.1`.
- Agentic: (Elo − 500) / 2000; conservative = (lower 95% bound − 500) /
  2000 − 0.02 for Stirrup-to-launcher transfer; medium confidence.
- Output speed: AA headline end-to-end output speed at the exact effort.

| Dimension | Astra high (codex, claudex) | Sol high | Sol max |
| --- | --- | --- | --- |
| reasoning (score / conservative) | 0.6009 / 0.5809 | 0.5489 / 0.5289 | 0.5726 / 0.5526 |
| implementation | unknown | unknown | unknown |
| agentic (score / conservative) | 0.5352 / 0.5104 | 0.5204 / 0.4954 | 0.5560 / 0.5314 |
| ui | unknown | unknown | unknown |
| spatial-3d | unknown | unknown | unknown |
| output tokens/s | 55.6 | 77.8 | 84.6 |
| task-cost | unknown | unknown | unknown |

Caveats on applying the table:

- **Reasoning scale.** All three are v5.0.1 cells. They compare with
  the Fable 5.2 cells (v5.0.1). They do not compare with the v4.3.2 or
  v5.0 cells. The predecessors these entries replace held v4.3.2 cells,
  so the GPT-6 → 6.2 change cannot be read off the catalog. Use the
  same-scale predecessor table above.
- **Implementation drops from known to unknown** for the Astra and Sol
  max replacements. `codex/gpt-6-astra/high` had a DeepSWE
  (mini-swe-agent) cell and `codex/gpt-6-sol/max` had an AA-Codex
  DeepSWE cell. Neither path exists for 6.2. The AA Coding Agent Index
  v2.1 rows are exact but on a different composite scale. The router
  will therefore show no implementation evidence for these candidates
  until CursorBench or DeepSWE publishes a 6.2 row.
- **Task cost drops** for the Astra replacement: the GPT-6 Astra
  $3.9237 DeepSWE cost does not transfer.
- **Speed:** Sol is faster than Astra at every effort (78–85 against
  53–56 tok/s). Time to first token grows steeply with effort (Sol: 9.6
  s at high, 66.7 s at max; Astra: 22.1 s at high, 171.0 s at max). The
  throughput value does not show this.
- Reasoning and agentic share evidence: Briefcase is 15% of index v5.0.1.
- Sol max beats Astra high on agentic (0.5314 against 0.5104
  conservative) and Astra high beats Sol max on reasoning (0.5809
  against 0.5526). Sol max costs about half of Astra high per AA index
  task ($1.01 against $2.07).

## Honest gaps

- **Implementation:** no CursorBench 4.0 or DeepSWE v1.1 row for either
  model at any effort as of 2026-11-18. CursorBench's last changelog
  entry is 2026-10-07 and DeepSWE's last update is 2026-09-22.
- **Task cost:** no DeepSWE row. AA index cost and AA coding-board cost
  are different task sets.
- **UI:** the WebDev board predates the release, and ranks 153–159 were
  not readable (HTTP 403; truncated reader).
- **Spatial-3d:** both models were added to Design Arena on 2026-11-17,
  but no 3D row exists yet and the registry names no effort.
- **AA per-effort URLs** now redirect to release pages. The evidence
  links below point at the release pages that hold the records.
- **AA estimated flag:** absent from the payload; not verified either
  way.
- **Launch post and system card:** not read (403 / not reviewed).
- **Codex vs API surface:** Codex windows (272K / 500K) and Sol's Codex
  audio input differ from the API page. `ultra` is unmeasured.
- **Subscription quota:** nothing here measures Codex or ChatGPT plan
  consumption.
- All benchmark values are dated snapshots. Briefcase Elo moves as
  submissions arrive.

## Ready-to-paste catalog objects

`quota_provider` on the claudex entry is copied verbatim from
`claudex/gpt-6-astra/high`. No `task_cost_usd` is included because no
exact evidence exists.

```json
{
  "codex/gpt-6.2-astra/high": {
    "launch": {
      "agent": "codex",
      "model": "gpt-6.2-astra",
      "effort": "high"
    },
    "features": ["vision"],
    "capabilities": {
      "reasoning": {
        "status": "known",
        "score": 0.6009,
        "conservative": 0.5809,
        "confidence": "high",
        "assessed_at": "2026-11-18",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-2-astra",
          "https://artificialanalysis.ai/articles/openai-has-the-2-model-in-the-intelligence-index-with-the-release-of-gpt-6-2-astra-and-gpt-6-2-sol"
        ],
        "scale": "AA Intelligence Index v5.0.1",
        "note": "Exact GPT-6.2 Astra (High) record 60.0882 on v5.0.1 (AA per-effort URL now redirects to the release page); score = index/100, conservative = score - 0.02. v5.0.1 is not comparable with v4.3.2 or v5.0 cells."
      },
      "implementation": {
        "status": "unknown",
        "reason": "CursorBench 4.0 (changelog through 2026-10-07) has no GPT-6.x row and DeepSWE v1.1 (updated 2026-09-22) has no GPT-6.2 row. AA's exact Codex row (Coding Agent Index v2.1: FrontierCode 2.0, SWE-Atlas-QnA, Terminal-Bench v4) is a different scale; GPT-6 Astra's DeepSWE cell is not carried over.",
        "researched_at": "2026-11-18"
      },
      "agentic": {
        "status": "known",
        "score": 0.5352,
        "conservative": 0.5104,
        "confidence": "medium",
        "assessed_at": "2026-11-18",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-2-astra",
          "https://artificialanalysis.ai/evaluations/aa-briefcase",
          "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
        ],
        "scale": "AA-Briefcase v1.1 Elo, mapped",
        "note": "Exact high Elo 1570.41 (95% CI lower 1560.83); score = (Elo - 500)/2000, conservative = mapped lower bound - 0.02 for Stirrup-to-launcher transfer. Snapshot 2026-11-18, one day after release."
      },
      "ui": {
        "status": "unknown",
        "reason": "Arena WebDev (page date 2026-11-13, 159 models) predates the 2026-11-17 release and shows no GPT-6.2 row in the readable ranks 1-152. GPT-6 Astra (Max) rank is not carried over.",
        "researched_at": "2026-11-18"
      },
      "spatial-3d": {
        "status": "unknown",
        "reason": "Design Arena added gpt-6.2-astra on 2026-11-17, but the 3D board (data stamp 2026-11-18T10:37Z, 183 models) has no row for it and the registry labels no effort. GPT-6 Astra ranks are not carried over; AA-3D is a different benchmark.",
        "researched_at": "2026-11-18"
      }
    },
    "economics": {
      "output_tokens_per_second": {
        "value": 55.6,
        "basis": "Artificial Analysis, exact high, headline end-to-end output speed (5-day average); not a median and not end-to-end task latency",
        "assessed_at": "2026-11-18",
        "source": "https://artificialanalysis.ai/models/gpt-6-2-astra"
      }
    }
  },
  "claudex/gpt-6.2-astra/high": {
    "launch": {
      "agent": "claudex",
      "model": "gpt-6.2-astra",
      "effort": "high"
    },
    "features": ["vision"],
    "capabilities": {
      "reasoning": {
        "status": "known",
        "score": 0.6009,
        "conservative": 0.5809,
        "confidence": "high",
        "assessed_at": "2026-11-18",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-2-astra",
          "https://artificialanalysis.ai/articles/openai-has-the-2-model-in-the-intelligence-index-with-the-release-of-gpt-6-2-astra-and-gpt-6-2-sol"
        ],
        "scale": "AA Intelligence Index v5.0.1",
        "note": "Exact GPT-6.2 Astra (High) record 60.0882 on v5.0.1 (AA per-effort URL now redirects to the release page); score = index/100, conservative = score - 0.02. v5.0.1 is not comparable with v4.3.2 or v5.0 cells."
      },
      "implementation": {
        "status": "unknown",
        "reason": "CursorBench 4.0 (changelog through 2026-10-07) has no GPT-6.x row and DeepSWE v1.1 (updated 2026-09-22) has no GPT-6.2 row. AA's exact Codex row (Coding Agent Index v2.1: FrontierCode 2.0, SWE-Atlas-QnA, Terminal-Bench v4) is a different scale; GPT-6 Astra's DeepSWE cell is not carried over.",
        "researched_at": "2026-11-18"
      },
      "agentic": {
        "status": "known",
        "score": 0.5352,
        "conservative": 0.5104,
        "confidence": "medium",
        "assessed_at": "2026-11-18",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-2-astra",
          "https://artificialanalysis.ai/evaluations/aa-briefcase",
          "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
        ],
        "scale": "AA-Briefcase v1.1 Elo, mapped",
        "note": "Exact high Elo 1570.41 (95% CI lower 1560.83); score = (Elo - 500)/2000, conservative = mapped lower bound - 0.02 for Stirrup-to-launcher transfer. Snapshot 2026-11-18, one day after release."
      },
      "ui": {
        "status": "unknown",
        "reason": "Arena WebDev (page date 2026-11-13, 159 models) predates the 2026-11-17 release and shows no GPT-6.2 row in the readable ranks 1-152. GPT-6 Astra (Max) rank is not carried over.",
        "researched_at": "2026-11-18"
      },
      "spatial-3d": {
        "status": "unknown",
        "reason": "Design Arena added gpt-6.2-astra on 2026-11-17, but the 3D board (data stamp 2026-11-18T10:37Z, 183 models) has no row for it and the registry labels no effort. GPT-6 Astra ranks are not carried over; AA-3D is a different benchmark.",
        "researched_at": "2026-11-18"
      }
    },
    "economics": {
      "output_tokens_per_second": {
        "value": 55.6,
        "basis": "Artificial Analysis, exact high, headline end-to-end output speed (5-day average); not a median and not end-to-end task latency",
        "assessed_at": "2026-11-18",
        "source": "https://artificialanalysis.ai/models/gpt-6-2-astra"
      }
    },
    "quota_provider": {
      "provider": "codex",
      "detail": "This proxy route bills the Codex provider rather than the claudex launcher. Configure quota_pool in a private layer when the deployment rotates credentials."
    }
  },
  "codex/gpt-6.2-sol/high": {
    "launch": {
      "agent": "codex",
      "model": "gpt-6.2-sol",
      "effort": "high"
    },
    "features": ["vision"],
    "capabilities": {
      "reasoning": {
        "status": "known",
        "score": 0.5489,
        "conservative": 0.5289,
        "confidence": "high",
        "assessed_at": "2026-11-18",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-2-sol",
          "https://artificialanalysis.ai/articles/openai-has-the-2-model-in-the-intelligence-index-with-the-release-of-gpt-6-2-astra-and-gpt-6-2-sol"
        ],
        "scale": "AA Intelligence Index v5.0.1",
        "note": "Exact GPT-6.2 Sol (High) record 54.8899 on v5.0.1 (AA per-effort URL now redirects to the release page); score = index/100, conservative = score - 0.02. v5.0.1 is not comparable with v4.3.2 or v5.0 cells."
      },
      "implementation": {
        "status": "unknown",
        "reason": "CursorBench 4.0 (changelog through 2026-10-07) has no GPT-6.x row and DeepSWE v1.1 (updated 2026-09-22) has no GPT-6.2 row. AA's exact Codex row (Coding Agent Index v2.1: FrontierCode 2.0, SWE-Atlas-QnA, Terminal-Bench v4) is a different scale.",
        "researched_at": "2026-11-18"
      },
      "agentic": {
        "status": "known",
        "score": 0.5204,
        "conservative": 0.4954,
        "confidence": "medium",
        "assessed_at": "2026-11-18",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-2-sol",
          "https://artificialanalysis.ai/evaluations/aa-briefcase",
          "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
        ],
        "scale": "AA-Briefcase v1.1 Elo, mapped",
        "note": "Exact high Elo 1540.79 (95% CI lower 1530.79); score = (Elo - 500)/2000, conservative = mapped lower bound - 0.02 for Stirrup-to-launcher transfer. Snapshot 2026-11-18, one day after release."
      },
      "ui": {
        "status": "unknown",
        "reason": "Arena WebDev (page date 2026-11-13, 159 models) predates the 2026-11-17 release and shows no GPT-6.2 row in the readable ranks 1-152. GPT-6.1 Sol (Max) rank is not carried over.",
        "researched_at": "2026-11-18"
      },
      "spatial-3d": {
        "status": "unknown",
        "reason": "Design Arena added gpt-6.2-sol on 2026-11-17, but the 3D board (data stamp 2026-11-18T10:37Z, 183 models) has no row for it and the registry labels no effort. GPT-6.1 Sol ranks are not carried over; AA-3D is a different benchmark.",
        "researched_at": "2026-11-18"
      }
    },
    "economics": {
      "output_tokens_per_second": {
        "value": 77.8,
        "basis": "Artificial Analysis, exact high, headline end-to-end output speed (5-day average); not a median and not end-to-end task latency",
        "assessed_at": "2026-11-18",
        "source": "https://artificialanalysis.ai/models/gpt-6-2-sol"
      }
    }
  },
  "codex/gpt-6.2-sol/max": {
    "launch": {
      "agent": "codex",
      "model": "gpt-6.2-sol",
      "effort": "max"
    },
    "features": ["vision"],
    "capabilities": {
      "reasoning": {
        "status": "known",
        "score": 0.5726,
        "conservative": 0.5526,
        "confidence": "high",
        "assessed_at": "2026-11-18",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-2-sol",
          "https://artificialanalysis.ai/articles/openai-has-the-2-model-in-the-intelligence-index-with-the-release-of-gpt-6-2-astra-and-gpt-6-2-sol"
        ],
        "scale": "AA Intelligence Index v5.0.1",
        "note": "Exact GPT-6.2 Sol (Max) record 57.2576 on v5.0.1; score = index/100, conservative = score - 0.02. v5.0.1 is not comparable with v4.3.2 or v5.0 cells."
      },
      "implementation": {
        "status": "unknown",
        "reason": "CursorBench 4.0 (changelog through 2026-10-07) has no GPT-6.x row and DeepSWE v1.1 (updated 2026-09-22) has no GPT-6.2 row. AA's Coding Agent Index v2.1 no longer contains DeepSWE, so the AA-Codex DeepSWE path used for GPT-6 Sol max is unavailable; GPT-6 Sol's cell is not carried over.",
        "researched_at": "2026-11-18"
      },
      "agentic": {
        "status": "known",
        "score": 0.556,
        "conservative": 0.5314,
        "confidence": "medium",
        "assessed_at": "2026-11-18",
        "evidence": [
          "https://artificialanalysis.ai/models/gpt-6-2-sol",
          "https://artificialanalysis.ai/evaluations/aa-briefcase",
          "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
        ],
        "scale": "AA-Briefcase v1.1 Elo, mapped",
        "note": "Exact max Elo 1612.06 (95% CI lower 1602.83); score = (Elo - 500)/2000, conservative = mapped lower bound - 0.02 for Stirrup-to-launcher transfer. Snapshot 2026-11-18, one day after release."
      },
      "ui": {
        "status": "unknown",
        "reason": "Arena WebDev (page date 2026-11-13, 159 models) predates the 2026-11-17 release and shows no GPT-6.2 row in the readable ranks 1-152. GPT-6 Sol (Max) and GPT-6.1 Sol (Max) ranks are not carried over.",
        "researched_at": "2026-11-18"
      },
      "spatial-3d": {
        "status": "unknown",
        "reason": "Design Arena added gpt-6.2-sol on 2026-11-17, but the 3D board (data stamp 2026-11-18T10:37Z, 183 models) has no row for it and the registry labels no effort (no -max mode). Predecessor ranks are not carried over; AA-3D is a different benchmark.",
        "researched_at": "2026-11-18"
      }
    },
    "economics": {
      "output_tokens_per_second": {
        "value": 84.6,
        "basis": "Artificial Analysis, exact max, headline end-to-end output speed (5-day average); not a median and not end-to-end task latency",
        "assessed_at": "2026-11-18",
        "source": "https://artificialanalysis.ai/models/gpt-6-2-sol"
      }
    }
  }
}
```
