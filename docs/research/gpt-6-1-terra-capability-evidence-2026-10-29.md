# GPT-6.1 Terra capability evidence

Assessed 2026-10-29 (Europe/Lisbon). Public source research for the exact
`codex/gpt-6.1-terra` high and xhigh candidates; this note documents the evidence.

## Identity and supported use

Official OpenAI documentation identifies `gpt-6.1-terra`, with API efforts
`none`, `low`, `medium` (default), `high`, `xhigh`, and `max`. It supports
text/image input, text output, function calling through Responses, and a
1,050,000-token context (922,000 max input; 128,000 max output). These establish
model features, not benchmark performance or the local launcher's effective
context. [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-6.1-terra)

Codex CLI support requires version 0.159.0 or later. Official task positioning
emphasizes writing, visual understanding and computer use; availability remains
client/account dependent. [OpenAI Models documentation](https://learn.chatgpt.com/docs/models)

## Exact high evidence and catalog implications

The [AA high card](https://artificialanalysis.ai/models/gpt-6-1-terra-high)
currently labels its Intelligence Index **v5.0**. Its embedded, non-estimated
record gives **42.3344508712563**. AA-Briefcase **v1.1** is **1263.50 Elo**, with
95% CI **[1253.76, 1273.52]**. Output speed is about **90.9 tokens/s**.

Under the existing catalog's Briefcase transform, high earns
`(1263.50 - 500) / 2000 = 0.38175`; applying the established lower-bound and
0.02 harness-transfer deduction gives
`(1253.76 - 500) / 2000 - 0.02 = 0.35688` (rounded 0.382 / 0.357).
The deduction is a policy estimate; only the Elo bounds are measured intervals.
Briefcase is knowledge-work evidence in AA's harness, not a local Codex run.
[AA-Briefcase](https://artificialanalysis.ai/evaluations/aa-briefcase)

The catalog records the v5 observation on its own scale; it must not be
compared to v4.3.2 scores or relabeled v4.3.2. AA introduced v5 on **October 27**, changing its benchmark
composition. [AA v5 announcement](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v5)
The October 26 Terra article still explicitly describes **v4.3.2** and its
launch-era economics, which explains older search snippets disagreeing with
today's cards. [AA Terra launch analysis](https://artificialanalysis.ai/articles/gpt-6-1-terra-pushes-the-cost-efficiency-frontier)

## Exact Codex coding evidence, separate from the implementation cell

[AA's coding board](https://artificialanalysis.ai/agents/coding-agents) publishes
these exact Terra configurations, all in **Codex 0.163.0**:

| Effort | Index v2.0 | FrontierCode v1.1 | SWE-Atlas-QnA-AA | Terminal-Bench 4.0 | Mean API $/task |
| --- | ---: | ---: | ---: | ---: | ---: |
| low | 0.348568 | 0.406083 | 0.387097 | 0.252525 | 0.198820 |
| medium | 0.420492 | 0.437512 | 0.470430 | 0.353535 | 0.394994 |
| **high** | **0.462788** | **0.434551** | **0.529570** | **0.424242** | **0.544032** |
| xhigh | 0.482238 | 0.449485 | 0.537634 | 0.459596 | 0.690844 |
| max | 0.481004 | 0.417842 | 0.540323 | 0.484848 | 1.240385 |

High has 300 / 372 / 198 scored attempts respectively; its mean wall time is
759.27 seconds. These observations do not establish statistically significant
effort differences. API task cost does not measure subscription quota.

AA's **v2.0 replaced DeepSWE v1.1 with FrontierCode v1.1**. Its index is an
equal-weight composite, not a DeepSWE rate. Neither it nor a FrontierCode score
fills the current CursorBench/DeepSWE implementation cell. FrontierCode 1.1 in
this Codex board is also distinct from FrontierCode 2.0 in Intelligence Index v5.
[Coding methodology and version history](https://artificialanalysis.ai/methodology/coding-agents-benchmarking)

## Other efforts and missing dimensions

The [AA release page](https://artificialanalysis.ai/models/releases/gpt-6-1-terra)
currently gives these **v5.0** values: low 29.216928, medium 38.115208, high
42.334451, xhigh 44.950052, max 50.976519; non-reasoning 30.415899.
These are effort-specific observations, not estimates for high.

The [xhigh card](https://artificialanalysis.ai/models/gpt-6-1-terra-xhigh)
also reports AA-Briefcase v1.1 Elo 1332.90, 95% CI [1322.14, 1343.20].
The catalog maps this to 0.416 and uses 0.391 after applying the lower
confidence bound and the estimated 0.02 harness-transfer deduction. As with
high, the deduction is not a measured confidence interval.

- **Implementation:** [CursorBench 4.0](https://cursor.com/evals) has no Terra
  6.1 row. [DeepSWE's live v1.1 artifact](https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json)
  likewise has none; it was generated `2026-09-22T06:27:15.860279+00:00`.
  Keep implementation and DeepSWE task cost unknown.
- **UI:** [WebDev Arena](https://arena.ai/leaderboard/code/webdev) lists only
  Terra **max**, rank 14/153, Elo 1673 ±15, 1,821 votes, dated October 27.
  This supports max only; high remains unknown.
- **Spatial-3D:** [Design Arena's registry](https://www.designarena.ai/api/registry)
  registers `gpt-6.1-terra` for its 3D arena without an effort label. The
  [3D page](https://www.designarena.ai/leaderboard/3d-design) did not expose
  scores in its fetched HTML. No exact-high result was established; keep unknown.

## Reproducing the exact fields

Fetch the AA high card and coding board URLs above with `curl -fsSL`. Their
server-rendered HTML embeds JSON in `self.__next_f.push(...)` script blocks.
JSON-decode each push argument, concatenate its string payload (element 1),
then JSON-decode the `initialModels` array on the high card. Select
`slug == "gpt-6-1-terra-high"`; read `intelligenceIndex`,
`intelligenceIndexIsEstimated`, and `briefcaseBreakdown.overall` (`elo`,
`lower95ci`, `upper95ci`). Confirm the surrounding rendered page labels v5.0.

For coding, select the object whose `displayLabel` is
`Codex - GPT-6.1 Terra (High)`. Read `indexScore`, each `evals[].mean.reward`,
`evals[].safety.attemptCount`, `mean.costUsd`, `mean.agentWallTimeSec`, and
`versions`. The published row ID was `41bcc9881ff1465f62e417e5a7535e20`.
The numeric tables above are bounded extractions, not a separately run model
evaluation. Re-fetch before a later refresh: these operator pages are mutable.
