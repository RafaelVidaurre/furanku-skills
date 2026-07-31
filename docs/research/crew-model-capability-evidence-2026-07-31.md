# Crew model-capability evidence

Research date: 2026-07-31 (Europe/Lisbon)

## Question and boundary

This report compiles evidence that can later inform Crew route selection for the
model-and-effort combinations discussed on this machine. It does **not** design
the selector, weights, thresholds, or fallback policy.

The central finding is that four different things must remain separate:

1. **coordination role** — Captain or Worker;
2. **harness** — Codex, Claude Code, Grok Build, OpenCode, and so on;
3. **model plus effort** — for example GPT-5.6 Sol at `xhigh`;
4. **account availability** — live subscription quota, entitlement, and rate
   windows.

A benchmark result usually measures a model inside a particular harness. It is
not automatically evidence for that model in every other harness.

## Evidence standard

| Strength | Meaning | Confidence use |
| --- | --- | --- |
| S1 | Independent benchmark operator's original measurement, with model, effort, harness, and method visible | High when the target combination matches; medium when used as a proxy |
| S2 | Independent human-preference or randomized in-the-wild arena run by the measurement owner | High for that arena's behavior; medium for transfer to repository work |
| S3 | Vendor documentation, system card, launch evaluation, or pricing page | High for interface and price; medium for capability claims |
| S4 | Zero-turn local CLI catalog/configuration observation | High for this machine's accepted identifiers; no capability inference |
| S5 | Practitioner post or secondary synthesis | Discovery only; not used in the matrix below |

Primary sources were preferred. Vendor-selected comparisons are labeled as
vendor claims. Independent means the benchmark operator produced the result; it
does not mean the benchmark is complete or free of sponsorship.

## Exact local access surfaces

Observed without paid model turns on 2026-07-31:

| Candidate | Local harness identifier | Effort surface | What the identifier means | Strength / confidence |
| --- | --- | --- | --- | --- |
| GPT-5.6 Sol | Codex `gpt-5.6-sol` | `low` through `ultra` | Public OpenAI model through Codex | S4 / high |
| GPT-5.6 Terra | Codex `gpt-5.6-terra` | `low` through `ultra` | Public OpenAI model through Codex | S4 / high |
| GPT-5.6 Luna | Codex `gpt-5.6-luna` | `low` through `max` | Public OpenAI model through Codex | S4 / high |
| Claude Fable 5 | Claude Code `claude-fable-5[1m]` | `low` through `max` | Fable 5 plus a Claude Code context modifier, not a separate model | S4 / high |
| Claude Opus 5 | Claude Code `claude-opus-5` | `low` through `max` | Public current Opus model; `high` is the API default | S3+S4 / high |
| Grok 4.5 | Grok Build `grok-4.5` | `low`, `medium`, `high` | Public SpaceXAI model; only current local Grok choice | S4 / high |
| Kimi K3 | OpenCode `kimi-for-coding/k3` | `low`, `high`, `max` variants | OpenCode provider route to Kimi Code model ID `k3`, family K3 | S4 / high |

Local versions were Codex 0.146.0, Claude Code 2.1.220, Grok 0.2.114,
and OpenCode 1.18.9. OpenCode also listed `kimi-for-coding/k3-256k`.
`opencode-go/kimi-k3` is a different OpenCode Go access route; it must not be
silently treated as the same provider/account as `kimi-for-coding/k3`.

Anthropic documents that model aliases can move and that context suffixes are
harness modifiers. Current Claude Code makes Fable's 1M context the default and
strips the suffix before provider dispatch, so `[1m]` should not become a model
capability dimension. See [Claude Code model configuration](https://code.claude.com/docs/en/model-config).

OpenCode's verbose catalog reports K3 as a 1,048,576-context reasoning model
with image/video input and tool calls. Kimi's own documentation confirms `k3`
and `k3-256k`, the three effort levels, and notes that the 1M route consumes
about twice the subscription quota of the 256K route. See [Kimi Code overview](https://www.kimi.com/code/docs/en/)
and [model configuration](https://www.kimi.com/code/docs/en/kimi-code/models.html).

## Comparable quantitative evidence

The table intentionally preserves mismatches instead of pretending that every
cell evaluates the exact requested effort.

| Combination of interest | AA Intelligence Index | DeepSWE v1.1 | In-the-wild agent evidence | API output speed | List price input/output per 1M | Strength / confidence |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| Fable 5 `high` | 60 for **max with Opus 4.8 fallback**, not high | 70% for max | #1 Agent Arena on 2026-07-21 at high; strongest reported steerability | 74 tok/s for max/fallback | $10 / $50 | S1/S2; high for Agent Arena, medium elsewhere |
| Sol `xhigh` | 58 | 73% for max, not xhigh | #2 Agent Arena on 2026-07-21 at xhigh | 70 tok/s | $5 / $30 | S1/S2; high for exact AA and Arena, medium for DeepSWE transfer |
| Sol `high` | 56 | no same-harness high result found | no exact current result found | 63 tok/s | $5 / $30 | S1; high for broad index, low for agent routing |
| Terra `max` | 55 | 70% | no exact current result found | 136 tok/s | $2.50 / $15 | S1; high for coding and broad index |
| Luna `max` | 51 | 67% | no exact current result found | 188 tok/s | $1 / $6 | S1; high for coding/speed, low for trivial-work claim |
| Kimi K3 `max` | 57 | 69% | #4 aggregate and #1 confirmed success on Agent Arena's 2026-07-21 snapshot; effort not labeled there | 32 tok/s | $3 / $15, $0.30 cached input | S1/S2; high for DeepSWE, medium for Arena transfer |
| Opus 5 `high` | 59 | 74% for max, not high | AA-Briefcase high beat Fable 5; current Arena includes exact high | 56 tok/s | $5 / $25 | S1/S2; high for broad index, medium for coding transfer |
| Grok 4.5 `high` | 54 | 54% | top-ten Bash Recovery on the 2026-07-21 Agent Arena snapshot | 67 tok/s | $2 / $6 | S1/S2; high for exact DeepSWE and cost |

Sources: [Artificial Analysis GPT-5.6 results](https://artificialanalysis.ai/articles/gpt-5-6-has-landed),
[Sol high](https://artificialanalysis.ai/models/gpt-5-6-sol-high),
[Sol xhigh](https://artificialanalysis.ai/models/gpt-5-6-sol-xhigh/),
[Terra max](https://artificialanalysis.ai/models/gpt-5-6-terra),
[Luna max](https://artificialanalysis.ai/models/gpt-5-6-luna),
[Fable 5](https://artificialanalysis.ai/models/claude-fable-5),
[Opus 5 high](https://artificialanalysis.ai/models/claude-opus-5-high),
[Grok 4.5 high](https://artificialanalysis.ai/models/grok-4-5/),
[Kimi K3](https://artificialanalysis.ai/models/kimi-k3),
[DeepSWE](https://deepswe.datacurve.ai/), and
[Agent Arena](https://arena.ai/leaderboard/agent?stream=top).

DeepSWE is unusually useful here because all models run through
`mini-swe-agent`: Opus 5 max scored 74%, Sol max 73%, Fable max and Terra max
70%, K3 max 69%, Luna max 67%, and Grok high 54%. It also reports average task
costs of $11.84, $8.39, $21.63, $4.95, $4.65, $3.03, and $2.42 respectively.
That is stronger evidence than cross-vendor launch charts for repository-level
implementation, while still measuring a shared benchmark harness rather than
Codex, Claude Code, Grok Build, or OpenCode.

## Capability evidence matrix for later scoring

This matrix records evidence, not numeric routing scores.

| Combination | Coding / implementation | Architecture / planning proxy | Review / debugging proxy | UI / UX / product surfaces | Visual / spatial / multimodal | 3D | Speed / cost | Agentic reliability | Overall evidence confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fable 5 high | Frontier; max is 70% DeepSWE | Strongest high-effort Agent Arena steerability; vendor claims days-long planning | No direct review benchmark; strong coding is only a proxy | Strong human-preference results, but not always #1 | Strong vision and image-to-web evidence | Near top of current Design Arena 3D board | Highest list price; moderate throughput | Best dated Agent Arena aggregate | High for agent behavior; medium for exact high coding |
| Sol xhigh | Frontier; max is 73% DeepSWE and leads AA coding index | Strong professional-work and agent results | No direct review benchmark | Current WebDev evidence is strong, behind Opus 5/K3 in the latest snapshot | Image input and strong visual web output | Near top of current 3D web arena | Mid-high price; moderate throughput | #2 dated Agent Arena aggregate | High |
| Sol high | Broad index only two points below xhigh, with materially fewer eval output tokens | Plausible fit for moderately complex architecture; no architecture-specific benchmark | No direct evidence | Not separately measured in the current web arena | Image input supported | No exact effort result | Same token tariff as xhigh; lower reasoning/token use | No exact result | Medium |
| Terra max | 70% DeepSWE, tied Fable max in same harness | Broad index 55 and professional-work evidence support substantial tasks | No direct evidence | Sparse | Image input supported | Sparse | 136 tok/s; DeepSWE cost $4.95 | Sparse | High for implementation; low for design/review |
| Luna max | 67% DeepSWE is stronger than a “grunt-only” label suggests | Broad index 51 | No direct evidence | Sparse | Image input supported | Sparse | Fastest measured API output and $3.03 DeepSWE cost, but max has long reasoning latency | Sparse | High for implementation/speed; low elsewhere |
| Kimi K3 max | 69% DeepSWE and frontier broad index | #1 confirmed success in dated Agent Arena; AA-Briefcase strong but presentation weaker than Sol | No direct evidence | #2 current WebDev snapshot; strong UI preference evidence | Native vision; strong frontend evidence | #1 current Design Arena 3D web experience board | Low per-token price but slow API throughput and high turn count | Strong success, weaker steerability than Fable/Sol | High for coding/UI; medium for 3D; low for review |
| Opus 5 high | Max leads DeepSWE; high broad index equals Sol max | High leads Fable on AA-Briefcase; Anthropic positions high as default | No direct review benchmark | #3 current WebDev snapshot; Anthropic documents UI replication strength | Strong chart/document/diagram vision | Current Design Arena 3D board trails K3/Fable/Sol | Same standard input as Sol, lower output price; slow API throughput | Newer and less mature Agent Arena sample | High for knowledge/planning; medium for exact-high coding |
| Grok 4.5 high | Cheapest DeepSWE run but materially lower 54% resolve rate | Vendor and broad-index evidence support ordinary knowledge work | No direct evidence | Competitive but below the leaders in current WebDev | Image input supported | Vendor demos only; weak independent evidence | Lowest DeepSWE cost and concise trajectories; Luna/Terra have higher raw API throughput | Good Bash Recovery; lower aggregate evidence | High for cost/coding trade-off; low for review/3D |

### Coding, architecture, review, and debugging

- The best apples-to-apples implementation evidence is DeepSWE. It contradicts
  “Grok is just as good” as a blanket quality statement: Grok is dramatically
  cheaper there, but resolves fewer tasks than every other named candidate.
- Terra max and Luna max are not merely fallback models in that benchmark.
  Their 70% and 67% results make them credible implementation candidates.
- Architecture and planning lack a direct public benchmark. AA-Briefcase,
  GDPval-AA, Agent Arena steerability, and long-horizon terminal tasks are useful
  proxies, not proof of architecture quality.
- No trustworthy public benchmark located in this survey tests **code review**
  for these exact new combinations. Bug fixing is not the same task as finding
  defects in an otherwise plausible patch. Review should remain explicitly
  unknown until direct public evidence exists.

Sources: [AA-Briefcase](https://artificialanalysis.ai/evaluations/aa-briefcase),
[Opus 5 AA-Briefcase analysis](https://artificialanalysis.ai/articles/claude-opus-5-leader-agentic-knowledge-work),
and [Agent Arena methodology](https://arena.ai/blog/agent-arena-methodology/).

### UI, UX, product empathy, and visual work

Arena's current WebDev snapshot (observed 2026-07-31) ranked Opus 5 max first,
K3 max second, Opus 5 high third, Fable 5 fourth, Sol xhigh in the Codex harness
fifth, and Grok 4.5 tenth. These are blind human preferences over rendered web
outputs and therefore stronger UI evidence than vendor screenshots. See the
[Arena WebDev leaderboard](https://arena.ai/leaderboard?category=webdev).

The result does **not** establish user empathy. “Product empathy” combines
problem framing, accessibility, research interpretation, tone, and trade-off
judgment. No current, independently run benchmark covering the named exact
combinations was found. UI preference and Agent Arena's praise/complaint and
steerability signals are only partial proxies. Keep empathy distinct rather
than inferring it from attractive frontend output.

Anthropic says Opus 5 is strong at chart, document, and diagram understanding
and iterative UI/frontend visual replication. That is a vendor claim, though it
is directionally consistent with the human-preference board. See
[Prompting Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5).

### 3D

The current Design Arena 3D category ranks Kimi K3 first, ahead of Fable 5,
Sol, and Opus 5. This supports a narrow claim: K3 is currently preferred for
interactive browser-based 3D experiences in that arena. See
[Design Arena](https://www.designarena.ai/leaderboard).

Evidence confidence is only **medium**. A web/Three.js preference arena does
not measure Blender topology, UVs, rigging, animation readiness, CAD precision,
Godot/Unreal import correctness, or asset optimization. Moonshot's own K3 page
claims strength in game development and 3D, but that remains first-party. See
[Kimi K3 technical blog](https://www.kimi.com/ja/blog/kimi-k3) and
[technical report](https://arxiv.org/abs/2607.24653). No equivalent independent
general 3D-modeling benchmark for all seven combinations was found.

## Effort is a model-specific control

The same effort word is not a portable amount of compute. Anthropic explicitly
says effort controls thinking and tool-call volume, defaults Opus 5 to `high`,
and recommends `xhigh` for demanding coding/agentic work and `max` only when
unconstrained spend is justified. See [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort).

OpenAI's independent results show meaningful but nonlinear Sol differences:
high 56, xhigh 58, max 59 on the AA index, while measured output-token use rose
from 21M to 35M to 70M across the full evaluation. A future selector should
therefore treat effort as part of the evaluated candidate, not as a universal
post-selection multiplier.

Kimi K3 supports only `low`, `high`, and `max`, defaulting to max. Grok's local
catalog supports `low`, `medium`, and `high`. Luna lacks Codex `ultra`.

## Speed and cost need three separate signals

1. **List price** is the API tariff, not subscription marginal cost.
2. **Serving speed** is output tokens per second after generation begins, not
   time to finish a repository task.
3. **Task cost and time** include reasoning tokens, turns, tool calls, cache
   behavior, and harness efficiency.

Independent API measurements put Luna max near 188 tok/s, Terra max 136, Fable
max/fallback 74, Sol xhigh 70, Grok high 67, Opus 5 high 56, and K3 32. That
does not make Luna max the fastest interactive choice: max-effort time to first
token was also very high in those measurements. K3's low token tariff likewise
did not make it fast on AA-Briefcase: it averaged 56.4 minutes and 83 turns,
versus 50 turns for Sol max. See [K3 AA-Briefcase analysis](https://artificialanalysis.ai/articles/kimi-k3-agentic-knowledge-benchmark).

Official standard API prices are:

| Model | Cached input | Input | Output | Source strength |
| --- | ---: | ---: | ---: | --- |
| Sol | $0.50 | $5.00 | $30.00 | S3 / high |
| Terra | $0.25 | $2.50 | $15.00 | S3 / high |
| Luna | $0.10 | $1.00 | $6.00 | S3 / high |
| Fable 5 | $1.00 | $10.00 | $50.00 | S3 / high |
| Opus 5 | $0.50 | $5.00 | $25.00 | S3 / high; fast mode is separately $10/$50 |
| Grok 4.5 | $0.50 | $2.00 | $6.00 | S3 / high |
| Kimi K3 | $0.30 | $3.00 | $15.00 | S3 / high |

Sources: [OpenAI GPT-5.6](https://openai.com/index/gpt-5-6/),
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[Grok 4.5](https://x.ai/news/grok-4-5), and
[Kimi K3 pricing](https://www.kimi.com/resources/kimi-k3-pricing).

## Subscription quota and quota-axi

`quota-axi` can provide a live **provider/account availability** input for
Claude, Codex, Grok, and Kimi. Its normalized JSON exposes window freshness,
remaining percentages, reset times, pace, `effectiveAvailability`, and the
windows that bound it. It intentionally does not route or recommend.

A live read-only probe on this machine on 2026-07-31 found fresh, known quota
semantics for Claude, Codex, and Grok. Kimi returned `auth_required`, so its
quota was unknown. This is not contradicted by OpenCode successfully listing
K3: quota-axi does not read OpenCode auth. It reads supported Kimi Code/Pi auth
sources, so **OpenCode model availability must not be converted into a Kimi
quota percentage**.

Provider percentages are also not comparable units. Fifty percent of a Claude
weekly window is not economically equivalent to fifty percent of a Codex or
Grok window. A stale or unknown result is not headroom. Account-wide and
model-specific windows can both bind a candidate; use the effective scope and
`boundedBy`, not a convenient raw window.

Primary reference: [quota-axi README](https://github.com/kunchenguid/quota-axi/blob/main/README.md).
Kimi documents that CLI, VS Code, and third-party tools share Kimi Code quota,
with both weekly and rolling five-hour limits: [Kimi membership benefits](https://www.kimi.com/code/docs/en/kimi-code/membership.html).

## Benchmark limitations that must survive into any later design

- **Model and harness are coupled.** Native Codex, Claude Code, Grok Build, and
  OpenCode can differ in context assembly, tools, prompts, retries, compaction,
  and subagents.
- **Fable identity can be mixed.** Artificial Analysis evaluated Fable max with
  Opus 4.8 fallback and observed fallback on about 8% of tasks. An independent
  RuBench audit found Claude Code substituted Opus 4.8 on 5 of 25 Fable
  trajectories. See [Fable analysis](https://artificialanalysis.ai/articles/claude-fable-5-mythos-intelligence-index)
  and [RuBench](https://arxiv.org/abs/2607.06411).
- **Arena ratings are living measurements.** Ranks change with new votes and
  models; confidence intervals can overlap. Store observation date, sample
  count, and category.
- **Vendor charts are not apples-to-apples by default.** Vendors may choose
  efforts, harnesses, tasks, and competitor numbers from different sources.
- **A composite index is not a capability taxonomy.** AA's index mixes coding,
  knowledge, reasoning, and agentic evaluations. It cannot alone identify the
  best reviewer, architect, or UX designer.
- **Sparse cells are real information.** Review quality, product empathy, and
  general production 3D modeling currently lack direct comparative evidence.
- **Context length is not effective context reliability.** A 1M limit says what
  can be sent, not what is recalled or acted on correctly across a long task.
- **Price and quota drift independently.** API price, subscription entitlements,
  model-specific caps, and live account pace require separate timestamps.

## Evidence-backed corrections to the starting intuitions

- Fable is broadly excellent and expensive, but current evidence does not make
  it the automatic winner: Opus 5 high leads it on agentic knowledge work, and
  K3/Opus lead the latest WebDev preference snapshot.
- Sol xhigh is close to the frontier across broad, coding, and real-agent
  evidence. The claim that it mainly falls short on UI is too strong; it is
  strong there, just not the current leader.
- Sol high is a credible lower-compute architecture candidate, but the evidence
  is a proxy rather than an architecture-specific result.
- K3 has strong independent coding, frontend, and narrow browser-3D evidence.
  Its serving speed and agent turn counts argue against calling it universally
  fast.
- Opus 5 high has stronger evidence than “same category as Grok”: it is frontier
  on broad intelligence and agentic knowledge work, although its max result—not
  high—leads DeepSWE.
- Grok high is the cheapest named candidate per DeepSWE task and uses few
  tokens/steps, but it is not equal on success rate and is not the fastest raw
  API model among these candidates.
- Terra max is substantially stronger than a generic middle tier on the
  same-harness coding evidence.
- Luna max is fast and inexpensive but is not an obvious trivial-work setting:
  max reasoning can impose high initial latency. Luna at lower effort needs its
  own evidence before being labeled the default grunt route.

## Public routing systems and scoring precedents

This section surveys routing mechanisms rather than proposing Crew's design.
It distinguishes three decisions that are often called “routing” but have
different inputs and failure modes:

1. **task classification** maps a request to an intent, domain, action, or
   capability requirement;
2. **candidate selection** compares that task representation with model
   capabilities and objectives;
3. **serving selection** chooses a healthy endpoint for an already-selected
   model.

Most API gateways are strongest at the third decision. Crew's problem is a
long-running coding-agent assignment, so per-request systems are evidence for
scoring primitives, not drop-in solutions.

### Comparative matrix: learned and benchmark-driven routers

| System | Task representation / candidate metadata | Eligibility | Score or learning shape | Cost, latency, quota, health | Uncertainty, fallback, adaptation | Reusable lesson and limitation for Crew |
| --- | --- | --- | --- | --- | --- | --- |
| [GitHub Copilot HyDRA](https://arxiv.org/abs/2605.17106) | Current user text plus seven flags: turn-count bin, error, file, URL, command, code, and short-message. A ModernBERT encoder predicts four independent requirements: reasoning, code generation, debugging, and tool use. Each model has a YAML capability vector and cost. | Hard-gates image requests to `vision: true`; infrastructure health removes candidates but does not rerank them. | Weighted positive-only shortfall: `sum(w[k] * max(0, requirement[k] - capability[k]))`. Models below runtime threshold `tau` are eligible; choose the cheapest eligible. Model vectors are weighted public-benchmark aggregates, then normalized to the predictor's score band. | Explicit cost; production layer observes utilization, errors, latency, and throughput as health vetoes. Subscription quota is absent. | Surplus in one capability cannot cancel a deficit in another. If none qualify, fail open to the least-shortfall model. Low-confidence requests remain session-sticky; model profiles, weights, and threshold change without retraining. | Best direct precedent for separating task requirements from extensible model profiles. It is production coding routing, but its published predictor is single-turn and has only four dimensions; repository state and prior tool output are excluded. |
| [RouteLLM](https://github.com/lm-sys/RouteLLM) | Prompt embedding or similarity features; a fixed strong/weak pair. Matrix-factorization, BERT, causal-LLM, and similarity-weighted routers estimate the strong model's conditional win probability from preference data. | Candidate set is the configured pair. No general modality, context, tool, provider, or quota gates. | Route strong when estimated win rate exceeds a calibrated threshold; otherwise weak. Threshold can be calibrated to a target strong-model call percentage. | The threshold expresses a quality/cost operating point, but live latency, quota, and health are outside the learned score. | No native abstention beyond choosing strong at conservative settings. New model identities generally require compatible preference data or retraining. | Clear and auditable scalar threshold, but binary routing collapses specialization and cannot express a pool of model-effort combinations well. |
| [LiteLLM Adaptive Router v0](https://github.com/BerriAI/litellm/blob/main/litellm/router_strategy/adaptive_router/README.md) | Latest user message is classified into one of seven request types. Each model declares quality tier, strengths, and token cost; each `(request type, model)` cell has a Beta posterior. | Request/header metadata can impose a hard minimum quality tier before scoring. | Thompson-sample every eligible posterior, then maximize `quality_weight * sample + cost_weight * normalized_cost`. Priors derive from quality tier plus declared strength bonus. | Static token cost is scored; latency, subscription quota, and endpoint health are absent from the adaptive score. | Regex and tool-call signals credit or blame the serving model; updates batch to Postgres. There is no stickiness and every turn resamples. A 200-observation cap prevents drift adaptation in v0. | Rare public example of a configurable specialization prior updated online. The authors label feedback mapping unvalidated; signals are English-biased, per-turn, heuristic, and cannot yet support a durable research-only capability table. |
| [Not Diamond](https://docs.notdiamond.ai/docs/what-is-model-routing) | Messages plus candidate model identities. Custom routers learn from representative prompts, every candidate's responses, and arbitrary numeric evaluation scores; custom endpoints add context length, input/output price, and latency metadata. | Caller supplies the model pool; context and provider compatibility are candidate metadata. | Pretrained router predicts best model; request-time quality, cost, latency, or continuous 0–10 cost-quality modes use Pareto-style tradeoffs. Custom routing clusters similar queries and learns candidate performance patterns from supplied scores. | Static price and latency are first-class; no documented subscription quota or live endpoint-health input in model scoring. | Custom routers are replaced by retraining with the same preference ID. The model-select API returns a session ID for feedback, but the public docs do not specify an online update algorithm. | Useful evidence that the quality metric can remain operator-defined and that agents themselves can be candidates. The learned scoring internals are closed, and custom-router catalog changes are training-coupled. |
| [Arch-Router](https://arxiv.org/abs/2506.16655) | A compact router maps the prompt to a **domain** and an **action**; configuration associates domain-action preferences with models. Examples include programming plus code generation, or travel plus booking. | The configured domain/action-to-model mapping forms the candidate preference set; operational health is outside the published method. | Semantic and contextual cues predict domain/action, then explicit user preferences select the model. New domains, actions, and models can be added through configuration without retraining the router. | The motivation includes quality, style, latency, and cost preferences, but it is not a live multi-objective serving score. | Transparent preference mapping; no documented probabilistic abstention or health fallback in the research model. | Strong precedent for human-readable specialization axes and user/project preference overrides. It classifies work rather than measuring whether a model clears a multi-dimensional quality floor. |
| [Brick SR1](https://github.com/regolo-ai/brick-SR1) | Classifies recent conversation turns for complexity and six capabilities: coding, creative synthesis, instruction following, math reasoning, planning/agentic work, and world knowledge. Models carry benchmark-derived skill vectors, per-dimension confidence, cost weight, reasoning family, and endpoint preferences. | Only models with a resolvable skill card enter the pool; supports modality handling, allowed model pools, keyword overrides, and endpoint discovery. | Capability/complexity matching chooses among N models; continuous cost-quality preference and five modes alter the affordable tier. Dynamic effort is selected from query difficulty and model headroom. | Static cost is explicit. Endpoint health and fallback are operational inputs. Cache-aware hysteresis estimates whether quality gain pays for re-priming the prompt. No subscription quota input. | Defaults and fallback maps cover missing classifiers/cards. `sticky` and `smartsqueeze` avoid marginal model switches; route data exposes selected model, effort, latency, difficulty, and fallback rate. | Most concrete open configuration example of extensible skill vectors plus effort selection. Its core “spatial” matching and hosted complexity model are not fully specified, so the score is less auditable than HyDRA's. |
| [OpenRouter Auto Beta](https://openrouter.ai/docs/guides/routing/routers/auto-router) | Lightweight classifier assigns about 30 task types such as `code:debugging` and `agent:multi_step_planning`. Candidate rank is trailing seven-day community spend share for that task; average cost per generation supplies a cost distribution. | Caller can hard-filter allowed model patterns and output modality. | Rank by task-specific spend share, then apply a 0–10 cost-quality control as a cost-percentile ceiling or select a named contiguous cost tier; surviving candidates stay in spend-share order. | Task-average cost is explicit. Provider routing separately handles endpoint availability. Subscription quota is absent. | Primary plus ranked fallbacks; default model set if classification/rankings fail. Model and provider can be sticky per session. Spend-share rankings update within days without retraining. | Useful online-adaptation precedent and explicit user override. Spend is revealed preference, not measured task success, and can encode popularity, price, or marketing effects. |
| [LLMRouter](https://github.com/ulab-uiuc/LLMRouter) | Unified data model over prompts, model responses/scores, chat context, retrieved history, and optionally user or modality nodes. Includes KNN, SVM, MLP, matrix factorization, Elo, dual-contrastive, graph, causal-LM, multi-round, multimodal, and personalized routers. | Depends on selected router and configured services; the library supplies `smallest` and `largest` baselines as well as learned policies. | More than 16 methods expose fundamentally different score shapes under one training/inference interface rather than asserting one universal router. | Cost-aware experiments are supported; serving health and subscription quota are not a common learned input. | Some routers generalize through embeddings or profiles; model-coupled methods require new training data. Multi-round policies can use full context or retrieved historical queries. | Valuable catalog of alternatives and proof that task representation is separable from scoring method. It is a research framework, not one production policy, and many methods assume a full prompt-by-model outcome matrix. |
| [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) | Extracts orthogonal signals for complexity, domain, context, conversation/tool-loop shape, modality, language, preference, user feedback, re-asks, structure, authorization, and safety. Projections turn signals into reusable policy concepts; model records include reasoning and provider bindings. | Boolean decisions and priorities form the eligible set before an algorithm ranks it. Provider health and active tool-loop/session portability can constrain switching. | Supports static, semantic/contrastive, AutoMix, hybrid, KNN/KMeans/SVM/MLP, latency-aware, confidence, ratings, and fusion algorithms behind the same decision layer. | Provider/latency state and cache/prefix locality are explicit. No cross-harness subscription quota input. | Defaults, signal confidence, escalation, user-feedback/re-ask signals, and session-aware stay bias/switch margin are modeled. Routing reasons are replayable. | Best open architectural precedent for separating signals, policy eligibility, scoring algorithm, and concrete provider binding. Breadth also means it is a framework rather than one validated Crew-ready score. See its [decision architecture](https://vllm-sr.ai/docs/tutorials/decision/overview/). |
| [ParetoBandit](https://github.com/ParetoBandit/ParetoBandit) | Prompt embeddings provide context; candidates carry token cost and speed/latency profiles. | Request-level maximum cost and optional latency constraints hard-filter candidates. | Contextual bandit balances exploitation and exploration; delayed quality feedback supplies reward. A primal-dual budget pacer targets spend over an open-ended stream. | Cost and latency are first-class; geometric forgetting handles quality or price drift. Subscription quota and harness compatibility are absent. | Exploration represents uncertainty; new models can enter at runtime and collect evidence. Reliable delayed reward attribution is assumed. | Strong precedent for non-stationary online adaptation and budget pacing, but its reward requirement and per-request framing do not solve long-horizon trajectory success. |
| [FrugalGPT](https://arxiv.org/abs/2305.05176) | Query plus the text generated by each attempted model. A learned scoring function estimates whether an answer is good enough before escalating. | A budget constrains which cascade order and thresholds are feasible. | Learns a model cascade and per-stage quality thresholds under a cost budget; stop at the first accepted response. | Per-call API cost is central. Latency grows with each failed stage; live quota and health are absent. | Explicit abstention at every cheap stage causes escalation. Reconfiguration/retraining is needed when model performance or price changes. | Demonstrates that uncertainty can trigger escalation and sometimes improves quality over one model. It wastes latency/tokens on rejected calls, which is especially costly for long coding-agent trajectories. |

HyDRA's model-profile construction is particularly relevant to a research-only
evidence policy. A public benchmark contributes only to dimensions it plausibly
exercises; benchmark importance and dimension relevance are separate weights.
That prevents an aggregate score from silently becoming evidence for review,
UX, or 3D. The router then uses a positive-only shortfall, so excellent coding
cannot compensate for inadequate visual capability. See the paper's
[capability profile and shortfall equations](https://arxiv.org/pdf/2605.17106#page=3).

### Comparative matrix: gateways, semantic classifiers, and harness policies

| System | Representation and policy | Runtime resilience | Composition / overrides | What it contributes; what it does not |
| --- | --- | --- | --- | --- |
| [LiteLLM deployment router](https://docs.litellm.ai/docs/routing) | Deployments declare model name, credentials/base URL, RPM/TPM, order/weight, and optional provider-specific metadata. Strategies include simple shuffle, least busy, usage-based, latency-based, cost-based, rate-limit-aware, and custom routing. | Retries, cooldown after failures/rate limits, context-window and content-policy fallbacks, and health checks operate on deployments. | YAML model lists and fallback maps provide a reusable operational layer; aliases can fan out one logical model to multiple deployments. | Excellent source for hard availability and health mechanics after a model has been chosen. Its separate Adaptive Router is covered above; deployment routing itself does not infer architecture, debugging, UI, or 3D fitness. |
| [Portkey AI Gateway](https://portkey.ai/docs/product/ai-gateway/conditional-routing) | Ordered predicates over flat request metadata, primitive request parameters, and URL path choose named targets. Conditions compose with nested boolean operators; first match wins. | Retries, circuit breakers, timeouts, load balancing, budget/rate limits, and status-code-specific fallbacks are composable. | A target may itself be a conditional router, load balancer, or fallback chain; a default target is mandatory. | Strong policy-composition precedent for deterministic hard gates and branch-local fallbacks. It has no learned or benchmark-backed task-to-model score. |
| [semantic-router](https://github.com/aurelio-labs/semantic-router) | Each route has example utterances. The query and examples are embedded; semantic similarity and route-specific thresholds classify intent. Static and dynamic routes can return structured parameters. | If no route clears its threshold, it returns `None`; the caller owns fallback. | Routes can be saved/loaded and thresholds optimized against labeled examples. | Cheap, inspectable specialization matching with real abstention. Semantic resemblance alone does not rank multiple models by quality/cost or assess long-horizon difficulty. |
| [Hugging Face Chat UI router](https://huggingface.co/docs/chat-ui/configuration/llm-router) | Deterministic policy chooses multimodal when an image exists, agentic when MCP is selected, otherwise a configured default. | Try route primary, then ordered route fallbacks, then global fallback. | A policy file defines routes; multimodal can bypass it through a dedicated environment override. | Minimal example showing capabilities are hard gates and defaults remain explicit. It is routing by request surface, not model competence. |
| [Aider architect/editor mode](https://aider.chat/docs/usage/modes.html) | Role-specific slots: the main model proposes a solution, an editor model translates it into file edits, and a weak model handles cheaper side work. Model metadata can set defaults such as edit format. | Users can explicitly change every slot; failures remain visible rather than being hidden by a learned router. | CLI/config overrides beat built-in main-to-editor defaults. | Direct coding-harness evidence that task phase and model selection are separate axes. It is a static slot assignment, not automatic scoring. |
| [Hermes Agent auxiliary models](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/configuring-models.md) | Main model plus explicit task slots for vision, web extraction, compression, approval, MCP routing, triage, decomposition, and other bounded work. Each slot has provider, model, base URL, reasoning effort, and optional fallback chain. | Candidate providers appear only when authenticated; task fallback chain, main fallback, then built-in discovery handle capacity or missing credentials. Context compatibility is an explicit guard for compression. | Per-task config overrides `auto`; delegation can separately override provider/model while otherwise inheriting the parent. | Useful composition pattern: stable semantic slots, whole-row overrides, authentication eligibility, and effort per slot. It does not score open-ended implementation assignments. |

Portkey and LiteLLM demonstrate an important ordering rule: health, credentials,
rate limits, region/policy, modality, and context compatibility are eligibility
or serving concerns. Folding them into a single “model intelligence” number
would allow a brilliant but unavailable or incompatible model to remain ranked.

### Router evaluation precedents

[RouterBench](https://github.com/withmartian/routerbench) formalizes routing as
a matrix of prompt-by-model outcomes plus model cost, and evaluates policies on
the performance-cost frontier. Its dataset contains more than 405,000 inference
outcomes. The later
[LLMRouterBench](https://github.com/ynulihao/LLMRouterBench) expands unified
evaluation to more than 400,000 instances, 21 datasets, 33 models, and 10
baselines. Its authors report that several complex and commercial routers fail
to reliably beat simple baselines, careful model-pool curation matters more
than indefinitely growing the pool, and gains diminish as models are added.
Those are cautions against mistaking scoring sophistication for routing value.

Both are primarily one-shot. [TwinRouterBench](https://github.com/CommonstackAI/TwinRouterBench)
is closer to Crew: it labels **router-visible prefixes at intermediate agent
steps**, offers a static track of 970 prefixes from 520 instances, and a dynamic
SWE-bench track where the router selects a concrete model at each call and is
scored by official task resolution plus realized API spend. Its released
downgrade-and-cascade procedure estimates the cheapest tier that preserves the
downstream trajectory. This establishes a critical distinction: prompt-level
classification accuracy is not enough for agent assignment; the evaluation
unit should preserve downstream task success and total trajectory cost.

### Theo Browne / T3 scoring-table provenance

The strongest primary match is Theo's 31 March 2025 video
[“I ranked every AI based on vibes”](https://www.youtube.com/watch?v=3yrAK2hMWw8),
together with the community-built
[v0 AI Model Tier List](https://v0.app/chat/ai-model-tier-list-5l4RVB4G8EG)
used on screen. Theo constructs the ranking live, calls it a “gut feel” ranking,
and describes the operative tradeoff as performance, price, speed, and quality.
He also consults Artificial Analysis's intelligence-versus-cost chart. The
result is a manually ordered S-to-F tier list—not a numeric multi-capability
score or reproducible weighted formula.

The v0 artifact models four boolean capabilities—vision, web, document, and
reasoning—separately from tier placement. That is a useful precedent for hard
capability flags plus a subjective preference rank, but the saved app does not
contain Theo's final local ordering. The video's final visible ordering includes
Grok 3, Gemini 2.0 Flash, o3-mini, Claude 3.5 Sonnet, and DeepSeek V3 in S tier;
it predates every current candidate in this report and is therefore structural
inspiration, not current model evidence.

If the remembered artifact was instead a numeric table with per-specialty
scores, this survey could not confirm it as a public Theo artifact. The search
covered Theo's official video catalog and relevant transcripts through July
2026, indexed posts from his X account, the `pingdotgg` repositories and
history, current and historical t3code, and the v0 project. The tier-list video
is the only primary artifact that closely matches the recollection; the report
does not invent missing columns or values.

Current t3code also does **not** implement task-aware scoring. At pinned commit
[`ef4ec2ad`](https://github.com/pingdotgg/t3code/commit/ef4ec2ad4b9b08d1aca31d68aea28f0a846ef295)
from 31 July 2026:

- drivers are statically ordered only as a UI tie-breaker
  ([source](https://github.com/pingdotgg/t3code/blob/ef4ec2ad4b9b08d1aca31d68aea28f0a846ef295/apps/server/src/provider/builtInDrivers.ts#L42-L53));
- provider probes report availability, inventory, default marker, and
  provider-specific option descriptors such as effort
  ([contract](https://github.com/pingdotgg/t3code/blob/ef4ec2ad4b9b08d1aca31d68aea28f0a846ef295/packages/contracts/src/model.ts#L7-L53));
- picker eligibility requires enabled, available, and runtime-ready instances
  ([source](https://github.com/pingdotgg/t3code/blob/ef4ec2ad4b9b08d1aca31d68aea28f0a846ef295/apps/web/src/providerInstances.ts#L67-L79));
- fallback selects the first eligible instance and its provider-reported
  default or first model, not the highest task score
  ([source](https://github.com/pingdotgg/t3code/blob/ef4ec2ad4b9b08d1aca31d68aea28f0a846ef295/apps/web/src/modelSelection.ts#L239-L311));
- user-authored order and favorites precede provider order
  ([source](https://github.com/pingdotgg/t3code/blob/ef4ec2ad4b9b08d1aca31d68aea28f0a846ef295/apps/web/src/modelOrdering.ts#L35-L85)).

Its reusable precedent is the separation of provider instance, runtime
eligibility, model inventory, provider-specific options, user preference, and
fallback. A future task-fit score would be a new layer, not something already
hidden in T3's picker.

### Unify provenance caveat

The earlier Unify model-routing product is widely described as optimizing
quality, cost, and latency against continuously benchmarked endpoints, but the
current first-party `unify.ai` documentation and public `unifyai` repositories
now describe a different agent platform and do not expose the historical
router's scoring formula or benchmark catalog. With no current authoritative
artifact verified, Unify is not used as scoring evidence here. The general
three-objective claim is already supported by reproducible sources above.

## Research-derived criteria taxonomy

The public systems converge on five kinds of input. They should remain separate
because they have different provenance and update cadence.

| Kind | Candidate primitives found in primary sources | Evidence source |
| --- | --- | --- |
| Task requirements | intent/domain/action; reasoning depth; code complexity/generation; debugging difficulty; tool orchestration; planning/agentic depth; instruction following; creative synthesis; world knowledge; math; modality; language; repository dependence; turn count; error/file/URL/command/code flags | HyDRA, Arch-Router, Brick, OpenRouter Auto, semantic-router |
| Model capability | per-dimension benchmark score; confidence/evidence grade; context length; input modalities; tool/function support; structured output; edit-format reliability; reasoning-effort surface; harness compatibility | HyDRA, Brick, Not Diamond, Aider, Hermes |
| Economic and temporal cost | input/output/cache price; expected task tokens/turns; average generation cost by task; time to first token; throughput; total trajectory time; cache re-priming cost; user-selected quality/cost operating point | OpenRouter Auto, Not Diamond, FrugalGPT, TwinRouterBench, Brick |
| Hard eligibility | authenticated harness/provider; live quota known and above reserve; model/effort supported; required modality/tools/context; project/admin allowlist; locality/privacy/region; healthy endpoint; concurrency capacity | Copilot/HyDRA, LiteLLM, Portkey, OpenRouter, Hermes |
| Decision provenance | classifier output/confidence; score contribution by dimension; selected and rejected candidates; winning config layer; health/quota snapshot; fallback reason; manual override; source and date of every capability value | HyDRA, Brick, OpenRouter, Portkey, RouterBench |

Review, architecture judgment, product empathy, and production 3D remain valid
capability dimensions even where the first report found sparse direct evidence.
The research-backed response is **not** to invent local tests or collapse them
into “coding.” It is to keep those dimensions explicitly unknown or
low-confidence, continue targeted primary-source research, and let uncertainty
affect the routing rule.

## Menu of scoring primitives found in the literature

These are reusable mathematical or policy shapes, not a recommendation yet.

1. **Hard filter, then score.** Remove incompatible, disallowed, unauthenticated,
   exhausted, or unhealthy candidates before any quality comparison. Used by
   HyDRA, OpenRouter, LiteLLM, Portkey, and Hermes.
2. **Positive-only capability shortfall.** Penalize only deficits relative to
   task requirements; do not let surplus in coding erase a visual or tool-use
   deficit. HyDRA's published form is
   `shortfall(m) = sum(w[k] * max(0, requirement[k] - capability[m,k]))`.
3. **Cheapest sufficient candidate.** Establish an eligible quality set first,
   then minimize cost within it. HyDRA implements this directly; Not Diamond's
   cost mode expresses the same ordering less transparently.
4. **Conditional strong-model win probability.** Estimate whether the stronger
   model's quality gain clears a threshold. RouteLLM is the clean binary form.
5. **Task-type rank table.** Classify a semantic task and consult per-task model
   ranks. Arch-Router uses explicit preferences; OpenRouter uses recent spend
   share; semantic-router supplies the classification mechanism.
6. **Pareto frontier and budget utility.** Keep nondominated quality/cost/latency
   candidates, then choose an operating point or maximize
   `expected_quality - lambda_cost*cost - lambda_latency*latency`. RouterBench,
   Not Diamond, and FrugalGPT provide variants.
7. **Cascade with abstention.** Try a cheap model and escalate when its response
   confidence is insufficient. FrugalGPT shows the quality/cost upside and the
   extra calls/latency downside.
8. **Confidence-aware conservative escalation.** Unknown task requirements or
   low-confidence model capabilities route upward instead of silently treating
   missing evidence as zero. HyDRA uses conservative defaults for
   repository-dependent queries it cannot reconstruct.
9. **Online empirical prior.** Refresh task-model preferences from recent
   aggregate behavior. OpenRouter's seven-day spend-share table is one example;
   its limitation is that observed spend is not ground-truth quality. LiteLLM's
   Thompson-sampled Beta cells instead update from post-call behavioral signals,
   but its current signals and feedback mapping are explicitly experimental.
10. **Stickiness and hysteresis.** Require meaningful expected gain before
    changing model within an established trajectory, because context, behavior,
    and prompt-cache continuity have value. Copilot HyDRA, OpenRouter, and Brick
    all implement a form of this.
11. **Ordered deterministic rules.** Apply explicit project/user predicates in
    documented order, then default. Portkey and Hugging Face Chat UI demonstrate
    the most auditable form.
12. **Human override with provenance.** Permit an explicit model choice or
    project policy to override automation, surface the actual selected model,
    and retain the reason. Copilot Auto and OpenRouter expose this directly.

## Research-backed next step

Continue the evidence program rather than creating a local benchmark. For each
model-effort candidate, construct a versioned capability profile whose cells
cite public primary evidence, carry observation date and confidence, and remain
`unknown` where research is still absent. Search specifically for direct work
on code-review defect finding, software architecture decisions, product/UX
judgment, and production 3D workflows; add evidence only when the benchmark or
evaluation actually exercises that dimension.

Then compare the published scoring families against the intended Crew boundary
on paper: multi-dimensional HyDRA-style shortfall, domain/action preference
tables, task-rank lookup, Pareto utility, and cascades. Evaluate each for
explainability, project-level composition, model-catalog churn, quota eligibility,
Captain override, and long-running assignment semantics. That research and
design comparison can produce a scoring proposal without making local model
evaluation a prerequisite.
