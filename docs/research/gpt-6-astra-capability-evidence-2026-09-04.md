# GPT-6 Astra capability evidence

Research date: 2026-09-04 (Europe/Lisbon)

## Question and boundary

Assess the exact `gpt-6-astra/high` route against Claude Fable 5.1, using
public evidence and the routing catalog's existing scales. Independent
benchmark operators are S1/S2; vendor evaluations and specifications are S3.
An exact result names the model, effort, and harness. A preference for Astra
high can govern routing without becoming a claim that it wins every benchmark.

## Exact high-effort evidence

| Operator / measurement | GPT-6 Astra high | Claude Fable 5.1 high | Configuration and source |
| --- | ---: | ---: | --- |
| AA Intelligence Index v4.1.1 | **60** | **62** | API measurements; Fable uses adaptive reasoning and default fallback. [Astra card](https://artificialanalysis.ai/models/gpt-6-astra-high), [Fable card](https://artificialanalysis.ai/models/claude-fable-5-1-high) |
| AA Intelligence Index task cost | **$0.96** | **$1.43** | Weighted benchmark task cost, not DeepSWE cost. Same AA cards. |
| AA API output speed | **Unavailable** | **56.1 tok/s** | Same AA cards, observed 4 September; serving measurements can change. |
| DeepSWE v1.1 | **73.23%** | No published row found | Astra in `mini-swe-agent`; [DeepSWE](https://deepswe.datacurve.ai/) |
| CursorBench 3.2 | No published row found | **69.4%** | Cursor's production agent harness; [Cursor leaderboard](https://cursor.com/evals) |

Astra's high-effort reasoning result is directly measured. It is two rounded
index points below Fable high, while its AA task cost is about 33% lower
(calculated from the displayed costs). These observations support a cost/quality
tradeoff; they do not establish universal superiority. The two implementation
rows use different benchmarks and cannot establish a head-to-head winner.

DeepSWE's default **Best** view displays Astra xhigh. Its public HTML also
contains `mini_swe_agent_gpt_6_astra_high`: **331/452** successful attempts
across **113 tasks and four runs**, with a **69.81–76.65%** run-to-run 95%
interval. Mean output was **26,506 tokens** and **27.42 agent steps**. The
embedded data was generated **2026-09-03T22:24:37Z**. The
[3 September changelog](https://deepswe.datacurve.ai/changelog) confirms all
five reasoning efforts were added.

The same row reports **$5.7237/task**, using expected launch prices per million:
**$12 input, $15 cache writes, $1.20 cache reads, $50 output, $2 compute units**.
That is a published historical benchmark estimate, not current API billing.
Its pricing basis differs from the official specification below. Preserve the
basis when recording this value; do not silently reprice aggregate tokens or
present it as a current production forecast. Source: [DeepSWE data](https://deepswe.datacurve.ai/).

## Broader comparisons have different effort settings

OpenAI reports the following selected comparisons. Its table uses the best
result obtained at any effort and research/API harnesses, so these are **not
Astra high measurements**. All rows in this table are vendor-reported S3
comparisons from the [Astra launch evaluation](https://openai.com/index/gpt-6-astra/).

| Benchmark | Astra | Fable 5.1 |
| --- | ---: | ---: |
| DeepSWE v1.1 | 74.1% | 67.4% |
| Terminal-Bench 4.0 | 57.9% | 55.8% |
| Terminal-Bench Science 0.1 | 64.6% | 52.6% |
| AutomationBench | 41.4% | 31.4% |
| FrontierMath Tier 4 v2 | 97.6% | 87.8% |
| GPQA Diamond | 96.0% | 93.7% |
| Humanity's Last Exam with tools | 57.2% | 65.0% |
| AA Intelligence Index v4.1.1, reproduced by OpenAI | 61.2 | 65.7 |

These results favor Astra on several software, science, and workflow tasks,
with exceptions. They support workload-specific preference, not an exact-high
ranking across all tasks.

AA's own [3 September analysis](https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra)
reports Coding Agent Index **67 for Astra in Codex** versus **70 for Fable
5.1 in Claude Code**. The article discusses Astra's max-effort cost frontier;
its prose does not establish a high-versus-high coding comparison. Retain the
harness distinction and do not copy 0.67 into the catalog's resolved-task scale.

AA's max-effort model cards show Intelligence Index **61 / $1.67 per task**
for [Astra max](https://artificialanalysis.ai/models/gpt-6-astra) and
**66 / $3.69 per task** for [Fable 5.1 max with fallback](https://artificialanalysis.ai/models/claude-fable-5-1/).
These rounded card values are consistent with the more precise intelligence
scores reproduced by OpenAI. Neither max row supplies the high route's score.

## Recommended catalog mapping

These recommendations apply to the same model/effort reached through either
the `codex` or `claudex` launcher. Conservative scores are routing judgments,
not new benchmark measurements. Record the assessment date as 2026-09-04.

| Cell | Recommendation | Rationale |
| --- | --- | --- |
| reasoning | **0.60 / 0.58 conservative; high confidence** | Exact AA high; two-point reserve follows the existing Fable treatment. |
| implementation | **0.7323 / 0.698 conservative; medium confidence** | Exact DeepSWE high; use the published lower interval endpoint, with confidence reflecting transfer from `mini-swe-agent` to the launch harness. |
| agentic | **unknown** | No Astra row found on [Agent Arena](https://arena.ai/leaderboard/agent/overall); no exact-high general-agentic score established here. |
| ui | **unknown** | No Astra row found on [Arena WebDev](https://arena.ai/leaderboard/code). |
| spatial-3d | **unknown** | No Astra entry found in [Design Arena's changelog](https://www.designarena.ai/changelog); no dated browser-3D ranking established. |
| output tokens/sec | **unknown** | AA high explicitly reports unavailable speed. |
| DeepSWE task cost | **$5.7237, only with expected-launch-pricing basis** | Exact model/effort estimate qualifies under the catalog's benchmark-only definition; current production task cost remains unknown. |
| context | **1,050,000** | Official model specification, rather than AA's rounded 1M display. |

Sources for the two numerical capability cells are respectively the
[AA high card](https://artificialanalysis.ai/models/gpt-6-astra-high) and
[DeepSWE](https://deepswe.datacurve.ai/). Missing arena evidence is an observed
gap in the inspected sources, not proof that no evaluation exists elsewhere.

## Official interface and economics

[Official OpenAI documentation](https://developers.openai.com/api/docs/models/gpt-6-astra)
specifies `gpt-6-astra`, a **1,050,000-token context window**, **128,000 maximum
output tokens**, text/image input, text output, function calling, and tools.
Supported reasoning efforts are `low`, `medium`, `high`, `xhigh`, and `max`.

Standard prices per million tokens are **$10 input**, **$1 cached input**,
**$12.50 cache writes**, and **$50 output**. Requests exceeding **272K input
tokens** use **2× input/cache rates and 1.5× output rates for the full request**.
Batch/Flex cost half Standard; Fast costs twice the applicable rates. These API
prices do not estimate subscription quota consumption. Source: the same
[model specification](https://developers.openai.com/api/docs/models/gpt-6-astra).
