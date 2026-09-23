# Model-routing score normalization

Research date: 2026-09-22 (Europe/Lisbon)

## Question and boundary

The capability cells in
`skills/model-routing/references/routing-catalog.json` mix scales inside
one dimension:

- **reasoning** uses AA Intelligence Index v4.1.1 or older for Fable 5.1,
  Astra, Terra, Luna, and Kimi K3, and v4.3.2 for Opus 5.5 and Grok 4.7.
- **implementation** mixes DeepSWE v1.1 (Astra, Terra, Luna, K3),
  CursorBench 3.2 (Fable 5.1), and CursorBench 4.0 (Opus 5.5).
- **agentic** mixes Agent Arena ordinals (K3), AA agentic-work evidence
  (Terra, Luna), and AA-Briefcase/GDPval anchors (Opus 5.5, Grok 4.7).

This report puts each dimension on **one current scale** for every catalog
candidate where the primary source publishes the exact model **and**
effort. It labels every cell that still cannot join the common scale.
It does not change selector weights, routes, or economics. It does not
edit the catalog.

Public research only. No local model evaluation contributes scores.
Independent operator measurements are S1/S2. Vendor tables are S3 and
fill no cell. Exact means the published row names the candidate's model
**and** effort.

Candidates. Ten catalog ids reduce to seven distinct model/effort tuples:

| Tuple | Catalog ids |
| --- | --- |
| Claude Fable 5.1, high | `claude/claude-fable-5-1[1m]/high` |
| GPT-5.6 Terra, max | `codex/gpt-5.6-terra/max` |
| GPT-5.6 Luna, max | `codex/gpt-5.6-luna/max` |
| Kimi K3, max | `opencode/kimi-for-coding/k3/max`, `claude/kimi-k3[1m]/max` |
| Claude Opus 5.5, high | `claude/claude-opus-5-5/high` |
| Grok 4.7, high | `grok/grok-4.7/high`, `claudex/grok-4.7/high` |
| GPT-6 Astra, high | `codex/gpt-6-astra/high`, `claudex/gpt-6-astra/high` |

Sources fetched on 2026-09-22:

- Artificial Analysis model cards (embedded dataset records):
  [Fable 5.1 high](https://artificialanalysis.ai/models/claude-fable-5-1-high),
  [Terra max](https://artificialanalysis.ai/models/gpt-5-6-terra),
  [Luna max](https://artificialanalysis.ai/models/gpt-5-6-luna),
  [Kimi K3 max](https://artificialanalysis.ai/models/kimi-k3),
  [Opus 5.5 high](https://artificialanalysis.ai/models/claude-opus-5-5-high),
  [Grok 4.7 high](https://artificialanalysis.ai/models/grok-4-7-high),
  [Astra high](https://artificialanalysis.ai/models/gpt-6-astra-high).
  Every card names "Artificial Analysis Intelligence Index v4.3.2",
  "AA-Briefcase v1.1", and "GDPval-AA v2.1".
- [AA-Briefcase board](https://artificialanalysis.ai/evaluations/aa-briefcase),
  [GDPval-AA board](https://artificialanalysis.ai/evaluations/gdpval-aa),
  [AA Intelligence Index methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking).
- [CursorBench](https://cursor.com/evals) (CursorBench 4.0 table and
  changelog).
- [DeepSWE](https://deepswe.datacurve.ai/) live JSON
  `/artifacts/v1.1/leaderboard-live.json`, generated
  2026-09-22T06:27:15Z, 113 tasks, harness `mini-swe-agent`, latest job
  `20260901-deep-swe-1-1-gpt-6-astra`; [changelog](https://deepswe.datacurve.ai/changelog).
- [Agent Arena](https://arena.ai/leaderboard/agent): snapshot 15 September
  2026, 1,850,083 sessions, 46 models.
- [Arena WebDev](https://arena.ai/leaderboard/code/webdev): vote cutoff 11
  September 2026, 679,295 votes, 129 models.
- [Design Arena 3D](https://www.designarena.ai/leaderboard/3d-design): the
  page's `/api/leaderboard` response for `arenaType: models, category: 3d`,
  `lastUpdateTime` 2026-09-22T16:06:28Z, 281,293 votes, 153 models. Effort
  labels come from the site's `/api/registry`. The
  [changelog](https://www.designarena.ai/changelog) runs through 20
  September 2026.

## 1. Reasoning: AA Intelligence Index v4.3.2

AA publishes v4.3.2 for **all seven tuples** at the exact effort. Values
are the unrounded `intelligenceIndex` from each card's dataset record,
with none marked estimated (`intelligenceIndexIsEstimated: false`).

| Tuple | AA label | v4.3.2 | Displayed | Current catalog (index version) |
| --- | --- | ---: | ---: | --- |
| Opus 5.5 high | Claude Opus 5.5 (high with fallback) | 53.58 | 54 | 0.54 (v4.3.2) |
| Fable 5.1 high | Claude Fable 5.1 (high with fallback) | 51.15 | 51 | 0.62 (v4.1.1) |
| Astra high | GPT-6 Astra (high) | 50.92 | 51 | 0.60 (v4.1.1) |
| Grok 4.7 high | Grok 4.7 (high) | 46.33 | 46 | 0.46 (v4.3.2) |
| Kimi K3 max | Kimi K3 (max) | 43.59 | 44 | 0.57 (July index) |
| Terra max | GPT-5.6 Terra (max) | 42.08 | 42 | 0.55 (July index) |
| Luna max | GPT-5.6 Luna (max) | 37.32 | 37 | 0.51 (July index) |

Mapping (unchanged method): score = index / 100 rounded to two decimals;
conservative = score − 0.02. Fable 5.1 and Astra tie at 0.51. AA states a
95% interval under ±1% for the index, so a 0.23-point gap is not a
meaningful difference, and the tie is honest.

The large drops are a scale change, not a capability loss. v4.3.2 weights
new agentic and hard-science evaluations (AA-Briefcase v1.1 15%, GDPval-AA
v2.1 10%, Terminal-Bench 4.0, CritPt, and others), and every candidate
here scores lower on it (Opus 5 high, for example, fell from 59 to 48).
Order shifts too: Fable 5.1 (62) led Astra (60) on the old cells, and on
v4.3.2 they tie. K3 (57) led Terra (55) before and still leads it.

**Coverage: 7/7 tuples, 10/10 ids on one scale.**

Caveat: AA-Briefcase and GDPval-AA make up 25% of v4.3.2. The reasoning
and agentic cells below share that evidence and are correlated.

## 2. Implementation: CursorBench 4.0 vs DeepSWE v1.1

### Values at exact effort on both benchmarks

| Tuple | CursorBench 4.0 (Cursor harness) | DeepSWE v1.1 (mini-swe-agent), pass@1 [95% run-to-run CI], mean $/task |
| --- | --- | --- |
| Opus 5.5 high | **56.0%**, $3.97, 68 steps | no `claude-opus-5-5` row |
| Fable 5.1 high | **49.2%**, $9.08, 77 steps | no `claude-fable-5-1` row (Fable 5 only) |
| Grok 4.7 high | **43.9%**, $4.69, 71 steps | no `grok-4-7` row (4.5 and 4.6 only) |
| Terra max | **41.3%**, $5.14, 107 steps | **69.62%** [67.07–72.18], $4.95 |
| Luna max | **35.9%**, $1.03, 208 steps | **67.19%** [63.20–71.18], $3.03 |
| Astra high | no GPT-6 Astra row at any effort | **73.23%** [69.81–76.65], $3.92 (see economics) |
| Kimi K3 max | no Kimi row at any effort | **68.51%** [63.98–73.05], $4.65 |

CursorBench 4.0 went live on 10 September 2026 ("new long-horizon
problems focused on edit, refactor, investigation, intent understanding,
managing jobs, and design adherence"). The table has 52 rows and no Astra
or Kimi row. Cursor prints no intervals and says "small differences in
scores may not be statistically meaningful." DeepSWE's newest job is the
1 September Astra run. The board has not added Fable 5.1, Opus 5.5, or
Grok 4.7.

### Coverage and recommendation

| Benchmark | Tuples covered | Ids covered | Missing |
| --- | ---: | ---: | --- |
| CursorBench 4.0 | **5 / 7** | 6 / 10 | Astra high, K3 max |
| DeepSWE v1.1 | 4 / 7 | 6 / 10 | Fable 5.1 high, Opus 5.5 high, Grok 4.7 high |

**Recommend CursorBench 4.0.** Both benchmarks cover six ids, but
CursorBench covers five of the seven model/effort tuples, and DeepSWE
covers four. CursorBench is the newer version, and it covers the three
frontier models DeepSWE has not run (Opus 5.5, Fable 5.1, Grok 4.7).
Choosing it also turns Grok 4.7's implementation cell from unknown into
an exact high value.

DeepSWE has stronger method properties: an open harness, four runs, and
published intervals. That is a reason to keep DeepSWE as the labeled
fallback, not to choose it. With DeepSWE as the common scale, three
tuples would sit off-scale instead of two, and one of them (Grok) would
have no value at all.

Mapping: score = resolved rate; conservative = score − 0.03, the Opus 5.5
cell's harness-transfer reserve, now applied to every CursorBench cell.
Cursor's agent harness is not Claude Code, Codex, or the Grok CLI, and
Cursor prints no interval.

The two tuples without a CursorBench row are **kept on DeepSWE, labeled
`DeepSWE v1.1 (mini-swe-agent)`**. They are not made unknown. Both are
exact effort rows with intervals, and making them unknown would remove the
Captain route's (Astra high) implementation evidence. Conservative =
DeepSWE's lower 95% bound, the rule the Astra cell already uses.
**These two cells must not be compared numerically with CursorBench
cells.** DeepSWE runs about 25–30 points above CursorBench 4.0 for the
same model: Terra max is 69.6% vs 41.3%, and Luna max is 67.2% vs 35.9%.
A raw comparison would rank Astra and K3 above every CursorBench
candidate. The router's `scale` key keeps them apart. Jev's context
already says "a different scale is not a higher or lower score."

**Coverage: 6 ids normalized on CursorBench 4.0. 4 ids (Astra ×2, K3 ×2)
kept on DeepSWE v1.1, labeled. 0 unknown.**

## 3. Agentic: AA-Briefcase v1.1, mapped

### Values at exact effort on each candidate source

| Tuple | AA-Briefcase v1.1 Elo [95% CI] | GDPval-AA v2.1 Elo | Agent Arena (15 Sep 2026) |
| --- | --- | ---: | --- |
| Opus 5.5 high | **1704.50** [1694.54–1714.47] | 1691.72 | no Opus 5.5 row |
| Grok 4.7 high | **1643.88** [1634.61–1653.14] | 1693.72 | no Grok 4.7 row |
| Fable 5.1 high | **1592.21** [1583.15–1602.38] | 1617.29 | only Fable 5.1 (Max), rank 1 |
| Kimi K3 max | **1510.23** [1502.28–1518.82] | 1523.97 | **Kimi K3 (Max), rank 8 of 46**, net improvement 6.22% ±0.62% |
| Astra high | **1506.86** [1497.09–1517.05] | 1484.52 | only GPT 6 Astra (Max), rank 2 |
| Luna max | **1345.38** [1336.57–1354.76] | 1443.14 | only GPT 5.6 Luna (xHigh), rank 27 |
| Terra max | **1335.93** [1327.50–1345.02] | 1432.27 | only GPT 5.6 Terra (xHigh), rank 23 |

Briefcase and GDPval values come from each card's embedded model record,
which carries every model and effort. The public boards only render the
top 20. Grok 4.7 **high** now has exact Briefcase and GDPval values, so the
current cell's xhigh proxy is out of date.

### Coverage

| Source | Tuples | Ids |
| --- | ---: | ---: |
| AA-Briefcase v1.1 | **7 / 7** | **10 / 10** |
| GDPval-AA v2.1 | 7 / 7 | 10 / 10 |
| Agent Arena | 1 / 7 (K3 max) | 2 / 10 |

**Recommend AA-Briefcase v1.1.** It ties GDPval on coverage. It is AA's
headline agentic benchmark and carries more index weight (15% vs 10%).
Its intervals are about half as wide (about ±10 Elo vs about ±20–25).
It also grades tool-using, multi-week deliverable work, which is closer
to delegated agent work than GDPval's single tasks. The two boards
disagree on two close pairs. GDPval puts Grok 4.7 high 2 Elo over Opus
5.5 high, well inside its ±20 interval, and puts Luna 11 Elo over Terra.
Briefcase separates Opus from Grok by 61 Elo, far outside its ±10
interval, and has Luna 9 Elo over Terra, about one interval. Agent
Arena exact coverage is too thin to be the common scale.

### Mapping

AA publishes its own fixed normalization for both Elo boards. From the
methodology page: "the combined AA-Briefcase v1.1 Elo is frozen at the
time of a model's addition and normalized as clamp((Elo - 500) / 2000),
the same mapping applied to GDPval-AA v2.1. The Elo scale is anchored to
GPT-5.5 (medium) at 1000." (GPT-5.5 medium's record shows exactly
1000.00.) GDPval's anchor is DeepSeek V4.1 Flash (max) at 1600.

- **score = clamp((Briefcase Elo − 500) / 2000, 0, 1)**
- **conservative = clamp((lower 95% bound − 500) / 2000) − 0.02**, the
  same 2-point reserve reasoning uses, here for transfer from AA's
  Stirrup harness to the launcher.

Why this mapping and not an ordinal or logistic one. It is the operator's
own documented transform. It is linear, so Elo gaps stay proportional.
It is order-preserving and stays in [0, 1] for any Elo from 500 to 2500.
It does not move when other models join the board, which rank
percentiles do. A logistic win-probability against the 1000 anchor would
squeeze every candidate into 0.88–0.98. The caveat is AA's own: it "may
update the reference parameters." If it does, re-derive every agentic
cell together.

| Tuple | Score | Conservative | GDPval, same mapping (reference only) |
| --- | ---: | ---: | ---: |
| Opus 5.5 high | 0.602 | 0.577 | 0.596 |
| Grok 4.7 high | 0.572 | 0.547 | 0.597 |
| Fable 5.1 high | 0.546 | 0.522 | 0.559 |
| Kimi K3 max | 0.505 | 0.481 | 0.512 |
| Astra high | 0.503 | 0.479 | 0.492 |
| Luna max | 0.423 | 0.398 | 0.472 |
| Terra max | 0.418 | 0.394 | 0.466 |

The Agent Arena and Elo-anchor haircuts in the current Opus 5.5 and
Grok 4.7 cells are dropped. Those haircuts existed to price
a missing Arena row, but Arena is no longer the scale. Confidence is
**medium** for all seven, because Briefcase is knowledge-work agentic
evidence in AA's harness and not a coding-agent measurement. K3's Agent
Arena rank (8 of 46) stays in this file and is not used. Its current 0.82
came from an earlier snapshot where K3 ranked #4.

**Coverage: 7/7 tuples, 10/10 ids on one scale.**

## 4. UI (Arena WebDev) and spatial-3d (Design Arena 3D)

### Arena WebDev, vote cutoff 2026-09-11, 129 models

| Tuple | Exact row | Nearest row (not used) |
| --- | --- | --- |
| Kimi K3 max | **`kimi-k3-max` rank 5, score 1674 ±11, rank spread 3–8, 4,547 votes** | — |
| Astra high | none | `gpt-6-astra-max` rank 1, 1800 |
| Fable 5.1 high | none | `claude-fable-5.1-max` rank 2, 1758 |
| Terra max | none | `gpt-5.6-terra-xhigh (codex-harness)` rank 35, 1521 |
| Luna max | none | `gpt-5.6-luna-xhigh (codex-harness)` rank 37, 1519 |
| Opus 5.5 high | none | — |
| Grok 4.7 high | none | — (`grok-4.6-high` rank 13 is the predecessor) |

### Design Arena 3D, data stamp 2026-09-22T16:06Z, 153 models

Design Arena's model ids carry no effort, except where the registry
display name adds one.

| Tuple | Board row | Effort evidence | Treatment |
| --- | --- | --- | --- |
| Kimi K3 max | `kimi-k3` rank 4, Elo 1422, 68.6% win, 3,055 battles | not labeled. Kimi's API default is `max` ("Reasoning effort supports `low`, `high`, and `max` (default `max`)", [Kimi K3 quickstart](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart)) | effort inferred from the API default |
| Fable 5.1 high | `claude-fable-5-1` rank 2, Elo 1423, 68.2% win, 1,121 battles | not labeled. Anthropic's default effort for Fable 5.1 is `high` ([Fable 5.1 evidence](fable-5-1-capability-evidence-2026-09-02.md)) | effort inferred from the API default |
| Astra high | `gpt-6-astra` rank 1, Elo 1476 | registry display name **"GPT-6 Astra (xhigh)"** | not high → unknown |
| Terra max | `gpt-5.6-terra` rank 77, Elo 1162 | not labeled. OpenAI's API default is medium ("Reasoning.effort supports: none, low, medium (default), high, xhigh, and max", [model page](https://developers.openai.com/api/docs/models/gpt-5.6-terra)) | not max → unknown |
| Luna max | `gpt-5.6-luna` rank 84, Elo 1151 | same default, medium ([model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna)) | not max → unknown |
| Opus 5.5 high | none; no changelog addition through 20 Sep | — | unknown |
| Grok 4.7 high | none; no changelog addition through 20 Sep | — | unknown |

The API publishes no Bradley-Terry standard error (`btStdErr: null`).
Ranks 2–4 sit inside 1 Elo of each other: Fable 5.1 at 1423, Muse Spark
1.3 max at 1423, and K3 at 1422.

Note: Kimi Code's own model table gives `high` as the default for `k3`,
while the platform API default is `max`
([Kimi Code models](https://www.kimi.com/code/docs/en/kimi-code/models.html)).
Design Arena calls the API, so the API default is the relevant one. Both
K3 catalog launches pass `max` explicitly.

### Mapping (ordinal, as the catalog methodology already specifies)

- **score = 1 − (rank − 1) / (N − 1)**, where N is the board's ranked
  model count on the stamp date. This is order-preserving and bounded.
  Because it moves when N changes, record N and the stamp in each note.
- WebDev **conservative** uses the worst rank in Arena's published rank
  spread.
- Design Arena **conservative** = score − 0.05, because the board has no
  interval and the effort is inferred rather than stated.

| Cell | Score | Conservative | Confidence |
| --- | ---: | ---: | --- |
| K3 max, ui (rank 5/129, spread to 8) | 0.969 | 0.945 | high |
| K3 max, spatial-3d (rank 4/153) | 0.980 | 0.930 | medium |
| Fable 5.1 high, spatial-3d (rank 2/153) | 0.993 | 0.943 | low |

**Coverage.** UI: 1/7 tuples (2 ids) on WebDev, the rest unknown.
Spatial-3d: 2/7 tuples (3 ids) on Design Arena, the rest unknown. The
Fable 5.1 3D cell is the least certain cell in this report. Making it
unknown is defensible if inferred-default effort is judged too weak. K3's
3D cell rests on the same inference and already carries it in the
current catalog.

## Changes greater than 0.05 versus the current catalog

Score / conservative. "new" means the cell was unknown.

| Id(s) | Dimension | Current | Proposed | Why |
| --- | --- | --- | --- | --- |
| Fable 5.1 high | reasoning | 0.62 / 0.60 | 0.51 / 0.49 | v4.1.1 → v4.3.2 |
| Terra max | reasoning | 0.55 / 0.53 | 0.42 / 0.40 | July index → v4.3.2 |
| Luna max | reasoning | 0.51 / 0.49 | 0.37 / 0.35 | July index → v4.3.2 |
| K3 max (×2) | reasoning | 0.57 / 0.55 | 0.44 / 0.42 | July index → v4.3.2 |
| Astra high (×2) | reasoning | 0.60 / 0.58 | 0.51 / 0.49 | v4.1.1 → v4.3.2 |
| Fable 5.1 high | implementation | 0.694 / 0.67 | 0.492 / 0.462 | CursorBench 3.2 → 4.0 |
| Terra max | implementation | 0.70 / 0.68 | 0.413 / 0.383 | DeepSWE → CursorBench 4.0 |
| Luna max | implementation | 0.67 / 0.65 | 0.359 / 0.329 | DeepSWE → CursorBench 4.0 |
| Grok 4.7 high (×2) | implementation | unknown | 0.439 / 0.409 (new) | exact CursorBench 4.0 High row |
| K3 max (×2) | agentic | 0.82 / 0.75 | 0.505 / 0.481 | Arena ordinal → Briefcase mapped |
| Terra max | agentic | 0.64 / 0.60 | 0.418 / 0.394 | older AA evidence → Briefcase mapped |
| Luna max | agentic | 0.59 / 0.55 | 0.423 / 0.398 | older AA evidence → Briefcase mapped |
| Opus 5.5 high | agentic | 0.90 / 0.84 | 0.602 / 0.577 | Briefcase anchor → Briefcase mapped |
| Grok 4.7 high (×2) | agentic | 0.80 / 0.74 | 0.572 / 0.547 | xhigh proxy → exact high, mapped |
| Fable 5.1 high | agentic | unknown | 0.546 / 0.522 (new) | exact Briefcase high |
| Astra high (×2) | agentic | unknown | 0.503 / 0.479 (new) | exact Briefcase high |
| Fable 5.1 high | spatial-3d | unknown | 0.993 / 0.943 (new) | Design Arena rank 2, effort inferred |

Changes of 0.05 or less: Opus 5.5 and Grok 4.7 reasoning (unchanged);
Opus 5.5 implementation (unchanged); Astra implementation (unchanged,
now labeled DeepSWE); K3 implementation 0.69 / 0.67 → 0.685 / 0.640; K3
ui 0.94 / 0.90 → 0.969 / 0.945; K3 spatial-3d 0.95 / 0.92 → 0.980 / 0.930.

Reading the new cells:

- Most drops are scale moves. Within a dimension, the new cells can be
  compared with each other and the old ones cannot. Terra and Luna fall
  furthest on implementation because CursorBench 4.0 is much harder on
  them than DeepSWE: 41.3% and 35.9%, against Opus 5.5 high at 56.0%.
- Agentic order is now Opus 5.5 > Grok 4.7 > Fable 5.1 > K3 ≈ Astra >
  Luna ≈ Terra. The K3–Astra and Luna–Terra gaps are inside Briefcase's
  intervals.

## Economics (applied to the catalog on 2026-09-22)

**Clear correction: Astra `task_cost_usd`.** DeepSWE's live JSON now
prices `mini_swe_agent_gpt_6_astra_high` at **$3.9237/task** mean. Its
`cost_basis` field reads "Current pricing at all context lengths: $10/M
uncached input, $12.50/M cache writes, $1/M cache reads, $50/M output; no
separate compute-unit fee." Both Astra catalog cells still carry $5.7237
on the expected-launch basis. The DeepSWE changelog records no repricing
entry after 3 September. The new basis matches OpenAI's official tariff
in the [Astra evidence](gpt-6-astra-capability-evidence-2026-09-04.md), so
the correction is clear. Proposed value 3.9237, basis "DeepSWE high,
mini-swe-agent; current OpenAI pricing".

Unchanged DeepSWE costs: Terra max $4.9458, Luna max $3.0281, K3 max
$4.6547.

**Serving-speed drift (not corrections; AA medians move):**

| Tuple | Catalog tok/s | AA card on 2026-09-22 |
| --- | ---: | ---: |
| Fable 5.1 high | 49.1 | 55.4 |
| Terra max | 136 | 95.2 |
| Luna max | 188 | 147.5 |
| Kimi K3 max | 32 | 38.2 |
| Grok 4.7 high | 54.2 | 49.8 |
| Astra high | absent | 52.2 |
| Opus 5.5 high | absent | card still displays N/A |

The catalog now carries these 2026-09-22 speeds. The Opus 5.5 card
still displays "Speed N/A", so no value is proposed for it.

## Honest gaps

- CursorBench has no Astra or Kimi row at any effort, and DeepSWE has no
  Fable 5.1, Opus 5.5, or Grok 4.7 row. Implementation stays split across
  two labeled scales until either board fills in.
- CursorBench prints no intervals. The 0.03 reserve is a routing
  judgment, not a measured bound.
- AA-Briefcase measures AA's Stirrup harness on knowledge-work projects.
  It is the best common agentic scale available, but it is not an
  in-the-wild coding-agent measurement.
- AA-Briefcase and GDPval-AA feed 25% of the Intelligence Index, so the
  reasoning and agentic dimensions are not independent evidence.
- AA "may update the reference parameters" of the Elo normalization. If
  it does, recompute every agentic cell together.
- K3's AA, WebDev, and Design Arena rows measure Moonshot's API. The
  catalog launches go through Kimi Code (OpenCode, or Claude Code as a
  proxy). That transfer sits in the reserves, as before.
- Design Arena labels no effort for Fable 5.1 or K3. Both 3D cells rely
  on documented API defaults, and the board publishes no standard error.
- Rank-percentile cells (ui, spatial-3d) move when N changes, even if
  the model's own rating does not.
- Agent Arena (15 September snapshot) and WebDev (11 September cutoff)
  predate Opus 5.5 and Grok 4.7.

## Proposed catalog cells

Cells for every candidate and dimension. Each replaces the whole cell.
The object passes `router.validate_compiled_candidate` when grafted onto
each candidate, checked 2026-09-22. `scale` and `note` reach Jev through
`jev_context.py`.

```json
{
  "claude/claude-fable-5-1[1m]/high": {
    "reasoning": {
      "status": "known",
      "score": 0.51,
      "conservative": 0.49,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/claude-fable-5-1-high"
      ],
      "scale": "AA Intelligence Index v4.3.2",
      "note": "Claude Fable 5.1 (high with fallback) 51.15 on v4.3.2; score = index/100, conservative = score - 0.02."
    },
    "implementation": {
      "status": "known",
      "score": 0.492,
      "conservative": 0.462,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://cursor.com/evals"
      ],
      "scale": "CursorBench 4.0",
      "note": "CursorBench 4.0 exact row 49.2% in Cursor's harness; conservative = score - 0.03 harness-transfer reserve (no published interval)."
    },
    "agentic": {
      "status": "known",
      "score": 0.546,
      "conservative": 0.522,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/claude-fable-5-1-high",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
      ],
      "scale": "AA-Briefcase v1.1 Elo, mapped",
      "note": "Exact AA-Briefcase v1.1 Elo 1592.21 (95% CI lower 1583.15); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
    },
    "ui": {
      "status": "unknown",
      "reason": "Arena WebDev (vote cutoff 2026-09-11) lists only claude-fable-5.1-max (rank 2), not high. The max rank is not carried to high.",
      "researched_at": "2026-09-22"
    },
    "spatial-3d": {
      "status": "known",
      "score": 0.993,
      "conservative": 0.943,
      "confidence": "low",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://www.designarena.ai/leaderboard/3d-design",
        "https://platform.claude.com/docs/en/models/fable-5-1/overview"
      ],
      "scale": "Design Arena 3D rank, percentile",
      "note": "claude-fable-5-1 rank 2 of 153, Elo 1423, data stamp 2026-09-22T16:06Z. Design Arena does not label effort; Anthropic's default for Fable 5.1 is high, so high is inferred, not stated. score = 1 - (rank - 1)/(N - 1); conservative = score - 0.05."
    }
  },
  "codex/gpt-5.6-terra/max": {
    "reasoning": {
      "status": "known",
      "score": 0.42,
      "conservative": 0.4,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/gpt-5-6-terra"
      ],
      "scale": "AA Intelligence Index v4.3.2",
      "note": "GPT-5.6 Terra (max) 42.08 on v4.3.2; score = index/100, conservative = score - 0.02."
    },
    "implementation": {
      "status": "known",
      "score": 0.413,
      "conservative": 0.383,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://cursor.com/evals"
      ],
      "scale": "CursorBench 4.0",
      "note": "CursorBench 4.0 exact row 41.3% in Cursor's harness; conservative = score - 0.03 harness-transfer reserve (no published interval). DeepSWE v1.1 exact row 69.62% is recorded in the research file, not used."
    },
    "agentic": {
      "status": "known",
      "score": 0.418,
      "conservative": 0.394,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/gpt-5-6-terra",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
      ],
      "scale": "AA-Briefcase v1.1 Elo, mapped",
      "note": "Exact AA-Briefcase v1.1 Elo 1335.93 (95% CI lower 1327.50); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
    },
    "ui": {
      "status": "unknown",
      "reason": "Arena WebDev (vote cutoff 2026-09-11) lists only gpt-5.6-terra-xhigh (codex harness), not max.",
      "researched_at": "2026-09-22"
    },
    "spatial-3d": {
      "status": "unknown",
      "reason": "Design Arena's 3D board lists gpt-5.6-terra (rank 77 of 153, Elo 1162) without an effort label; OpenAI's API default is medium, not max, so the rank is not a max result.",
      "researched_at": "2026-09-22"
    }
  },
  "codex/gpt-5.6-luna/max": {
    "reasoning": {
      "status": "known",
      "score": 0.37,
      "conservative": 0.35,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/gpt-5-6-luna"
      ],
      "scale": "AA Intelligence Index v4.3.2",
      "note": "GPT-5.6 Luna (max) 37.32 on v4.3.2; score = index/100, conservative = score - 0.02."
    },
    "implementation": {
      "status": "known",
      "score": 0.359,
      "conservative": 0.329,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://cursor.com/evals"
      ],
      "scale": "CursorBench 4.0",
      "note": "CursorBench 4.0 exact row 35.9% in Cursor's harness; conservative = score - 0.03 harness-transfer reserve (no published interval). DeepSWE v1.1 exact row 67.19% is recorded in the research file, not used."
    },
    "agentic": {
      "status": "known",
      "score": 0.423,
      "conservative": 0.398,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/gpt-5-6-luna",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
      ],
      "scale": "AA-Briefcase v1.1 Elo, mapped",
      "note": "Exact AA-Briefcase v1.1 Elo 1345.38 (95% CI lower 1336.57); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
    },
    "ui": {
      "status": "unknown",
      "reason": "Arena WebDev (vote cutoff 2026-09-11) lists only gpt-5.6-luna-xhigh (codex harness), not max.",
      "researched_at": "2026-09-22"
    },
    "spatial-3d": {
      "status": "unknown",
      "reason": "Design Arena's 3D board lists gpt-5.6-luna (rank 84 of 153, Elo 1151) without an effort label; OpenAI's API default is medium, not max, so the rank is not a max result.",
      "researched_at": "2026-09-22"
    }
  },
  "opencode/kimi-for-coding/k3/max": {
    "reasoning": {
      "status": "known",
      "score": 0.44,
      "conservative": 0.42,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/kimi-k3"
      ],
      "scale": "AA Intelligence Index v4.3.2",
      "note": "Kimi K3 (max) 43.59 on v4.3.2; score = index/100, conservative = score - 0.02."
    },
    "implementation": {
      "status": "known",
      "score": 0.685,
      "conservative": 0.64,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://deepswe.datacurve.ai/"
      ],
      "scale": "DeepSWE v1.1 (mini-swe-agent)",
      "note": "Not on the CursorBench 4.0 scale: Cursor publishes no row for this model at any effort. DeepSWE exact row; conservative = lower 95% run-to-run bound. Do not compare numerically with CursorBench 4.0 cells."
    },
    "agentic": {
      "status": "known",
      "score": 0.505,
      "conservative": 0.481,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/kimi-k3",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
      ],
      "scale": "AA-Briefcase v1.1 Elo, mapped",
      "note": "Exact AA-Briefcase v1.1 Elo 1510.23 (95% CI lower 1502.28); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
    },
    "ui": {
      "status": "known",
      "score": 0.969,
      "conservative": 0.945,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://arena.ai/leaderboard/code/webdev"
      ],
      "scale": "Arena WebDev rank, percentile",
      "note": "kimi-k3-max rank 5 of 129 (rank spread 3-8), score 1674 +/-11, vote cutoff 2026-09-11. score = 1 - (rank - 1)/(N - 1); conservative uses the worst rank in the published spread."
    },
    "spatial-3d": {
      "status": "known",
      "score": 0.98,
      "conservative": 0.93,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://www.designarena.ai/leaderboard/3d-design",
        "https://platform.kimi.ai/docs/guide/kimi-k3-quickstart"
      ],
      "scale": "Design Arena 3D rank, percentile",
      "note": "kimi-k3 rank 4 of 153, Elo 1422 (1 below rank 2), data stamp 2026-09-22T16:06Z. Design Arena does not label effort; Kimi's API default is max. score = 1 - (rank - 1)/(N - 1); conservative = score - 0.05 (no published interval, effort inferred)."
    }
  },
  "claude/kimi-k3[1m]/max": {
    "reasoning": {
      "status": "known",
      "score": 0.44,
      "conservative": 0.42,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/kimi-k3"
      ],
      "scale": "AA Intelligence Index v4.3.2",
      "note": "Kimi K3 (max) 43.59 on v4.3.2; score = index/100, conservative = score - 0.02."
    },
    "implementation": {
      "status": "known",
      "score": 0.685,
      "conservative": 0.64,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://deepswe.datacurve.ai/"
      ],
      "scale": "DeepSWE v1.1 (mini-swe-agent)",
      "note": "Not on the CursorBench 4.0 scale: Cursor publishes no row for this model at any effort. DeepSWE exact row; conservative = lower 95% run-to-run bound. Do not compare numerically with CursorBench 4.0 cells."
    },
    "agentic": {
      "status": "known",
      "score": 0.505,
      "conservative": 0.481,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/kimi-k3",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
      ],
      "scale": "AA-Briefcase v1.1 Elo, mapped",
      "note": "Exact AA-Briefcase v1.1 Elo 1510.23 (95% CI lower 1502.28); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
    },
    "ui": {
      "status": "known",
      "score": 0.969,
      "conservative": 0.945,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://arena.ai/leaderboard/code/webdev"
      ],
      "scale": "Arena WebDev rank, percentile",
      "note": "kimi-k3-max rank 5 of 129 (rank spread 3-8), score 1674 +/-11, vote cutoff 2026-09-11. score = 1 - (rank - 1)/(N - 1); conservative uses the worst rank in the published spread."
    },
    "spatial-3d": {
      "status": "known",
      "score": 0.98,
      "conservative": 0.93,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://www.designarena.ai/leaderboard/3d-design",
        "https://platform.kimi.ai/docs/guide/kimi-k3-quickstart"
      ],
      "scale": "Design Arena 3D rank, percentile",
      "note": "kimi-k3 rank 4 of 153, Elo 1422 (1 below rank 2), data stamp 2026-09-22T16:06Z. Design Arena does not label effort; Kimi's API default is max. score = 1 - (rank - 1)/(N - 1); conservative = score - 0.05 (no published interval, effort inferred)."
    }
  },
  "claude/claude-opus-5-5/high": {
    "reasoning": {
      "status": "known",
      "score": 0.54,
      "conservative": 0.52,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/claude-opus-5-5-high"
      ],
      "scale": "AA Intelligence Index v4.3.2",
      "note": "Claude Opus 5.5 (high with fallback) 53.58 on v4.3.2; score = index/100, conservative = score - 0.02."
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
      "scale": "CursorBench 4.0",
      "note": "CursorBench 4.0 exact row 56.0% in Cursor's harness; conservative = score - 0.03 harness-transfer reserve (no published interval)."
    },
    "agentic": {
      "status": "known",
      "score": 0.602,
      "conservative": 0.577,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/claude-opus-5-5-high",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
      ],
      "scale": "AA-Briefcase v1.1 Elo, mapped",
      "note": "Exact AA-Briefcase v1.1 Elo 1704.50 (95% CI lower 1694.54); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
    },
    "ui": {
      "status": "unknown",
      "reason": "Arena WebDev (vote cutoff 2026-09-11, 129 models) has no claude-opus-5-5 row.",
      "researched_at": "2026-09-22"
    },
    "spatial-3d": {
      "status": "unknown",
      "reason": "Design Arena's 3D board (data stamp 2026-09-22T16:06Z, 153 models) and changelog through 2026-09-20 have no claude-opus-5-5 entry.",
      "researched_at": "2026-09-22"
    }
  },
  "claudex/grok-4.7/high": {
    "reasoning": {
      "status": "known",
      "score": 0.46,
      "conservative": 0.44,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/grok-4-7-high"
      ],
      "scale": "AA Intelligence Index v4.3.2",
      "note": "Grok 4.7 (high) 46.33 on v4.3.2; score = index/100, conservative = score - 0.02."
    },
    "implementation": {
      "status": "known",
      "score": 0.439,
      "conservative": 0.409,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://cursor.com/evals"
      ],
      "scale": "CursorBench 4.0",
      "note": "CursorBench 4.0 exact row 43.9% in Cursor's harness; conservative = score - 0.03 harness-transfer reserve (no published interval)."
    },
    "agentic": {
      "status": "known",
      "score": 0.572,
      "conservative": 0.547,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/grok-4-7-high",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
      ],
      "scale": "AA-Briefcase v1.1 Elo, mapped",
      "note": "Exact AA-Briefcase v1.1 Elo 1643.88 (95% CI lower 1634.61); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
    },
    "ui": {
      "status": "unknown",
      "reason": "Arena WebDev (vote cutoff 2026-09-11, 129 models) has no grok-4.7 row.",
      "researched_at": "2026-09-22"
    },
    "spatial-3d": {
      "status": "unknown",
      "reason": "Design Arena's 3D board (data stamp 2026-09-22T16:06Z, 153 models) and changelog through 2026-09-20 have no grok-4.7 entry.",
      "researched_at": "2026-09-22"
    }
  },
  "grok/grok-4.7/high": {
    "reasoning": {
      "status": "known",
      "score": 0.46,
      "conservative": 0.44,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/grok-4-7-high"
      ],
      "scale": "AA Intelligence Index v4.3.2",
      "note": "Grok 4.7 (high) 46.33 on v4.3.2; score = index/100, conservative = score - 0.02."
    },
    "implementation": {
      "status": "known",
      "score": 0.439,
      "conservative": 0.409,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://cursor.com/evals"
      ],
      "scale": "CursorBench 4.0",
      "note": "CursorBench 4.0 exact row 43.9% in Cursor's harness; conservative = score - 0.03 harness-transfer reserve (no published interval)."
    },
    "agentic": {
      "status": "known",
      "score": 0.572,
      "conservative": 0.547,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/grok-4-7-high",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
      ],
      "scale": "AA-Briefcase v1.1 Elo, mapped",
      "note": "Exact AA-Briefcase v1.1 Elo 1643.88 (95% CI lower 1634.61); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
    },
    "ui": {
      "status": "unknown",
      "reason": "Arena WebDev (vote cutoff 2026-09-11, 129 models) has no grok-4.7 row.",
      "researched_at": "2026-09-22"
    },
    "spatial-3d": {
      "status": "unknown",
      "reason": "Design Arena's 3D board (data stamp 2026-09-22T16:06Z, 153 models) and changelog through 2026-09-20 have no grok-4.7 entry.",
      "researched_at": "2026-09-22"
    }
  },
  "codex/gpt-6-astra/high": {
    "reasoning": {
      "status": "known",
      "score": 0.51,
      "conservative": 0.49,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/gpt-6-astra-high"
      ],
      "scale": "AA Intelligence Index v4.3.2",
      "note": "GPT-6 Astra (high) 50.92 on v4.3.2; score = index/100, conservative = score - 0.02."
    },
    "implementation": {
      "status": "known",
      "score": 0.7323,
      "conservative": 0.698,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://deepswe.datacurve.ai/"
      ],
      "scale": "DeepSWE v1.1 (mini-swe-agent)",
      "note": "Not on the CursorBench 4.0 scale: Cursor publishes no row for this model at any effort. DeepSWE exact row; conservative = lower 95% run-to-run bound. Do not compare numerically with CursorBench 4.0 cells."
    },
    "agentic": {
      "status": "known",
      "score": 0.503,
      "conservative": 0.479,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/gpt-6-astra-high",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
      ],
      "scale": "AA-Briefcase v1.1 Elo, mapped",
      "note": "Exact AA-Briefcase v1.1 Elo 1506.86 (95% CI lower 1497.09); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
    },
    "ui": {
      "status": "unknown",
      "reason": "Arena WebDev (vote cutoff 2026-09-11) lists gpt-6-astra-max (rank 1) only; no high row. The max rank is not carried to high.",
      "researched_at": "2026-09-22"
    },
    "spatial-3d": {
      "status": "unknown",
      "reason": "Design Arena's 3D board ranks gpt-6-astra #1 (Elo 1476), but its registry labels that model 'GPT-6 Astra (xhigh)'. An xhigh rank is not a high rank.",
      "researched_at": "2026-09-22"
    }
  },
  "claudex/gpt-6-astra/high": {
    "reasoning": {
      "status": "known",
      "score": 0.51,
      "conservative": 0.49,
      "confidence": "high",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/gpt-6-astra-high"
      ],
      "scale": "AA Intelligence Index v4.3.2",
      "note": "GPT-6 Astra (high) 50.92 on v4.3.2; score = index/100, conservative = score - 0.02."
    },
    "implementation": {
      "status": "known",
      "score": 0.7323,
      "conservative": 0.698,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://deepswe.datacurve.ai/"
      ],
      "scale": "DeepSWE v1.1 (mini-swe-agent)",
      "note": "Not on the CursorBench 4.0 scale: Cursor publishes no row for this model at any effort. DeepSWE exact row; conservative = lower 95% run-to-run bound. Do not compare numerically with CursorBench 4.0 cells."
    },
    "agentic": {
      "status": "known",
      "score": 0.503,
      "conservative": 0.479,
      "confidence": "medium",
      "assessed_at": "2026-09-22",
      "evidence": [
        "https://artificialanalysis.ai/models/gpt-6-astra-high",
        "https://artificialanalysis.ai/evaluations/aa-briefcase",
        "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
      ],
      "scale": "AA-Briefcase v1.1 Elo, mapped",
      "note": "Exact AA-Briefcase v1.1 Elo 1506.86 (95% CI lower 1497.09); mapped with AA's own clamp((Elo - 500) / 2000); conservative = mapped lower bound - 0.02 harness transfer (Stirrup to launcher)."
    },
    "ui": {
      "status": "unknown",
      "reason": "Arena WebDev (vote cutoff 2026-09-11) lists gpt-6-astra-max (rank 1) only; no high row. The max rank is not carried to high.",
      "researched_at": "2026-09-22"
    },
    "spatial-3d": {
      "status": "unknown",
      "reason": "Design Arena's 3D board ranks gpt-6-astra #1 (Elo 1476), but its registry labels that model 'GPT-6 Astra (xhigh)'. An xhigh rank is not a high rank.",
      "researched_at": "2026-09-22"
    }
  }
}
```
