# Proposal: route for expected value, with Jev measuring the task

Date: 2026-09-24. This proposal does not change the configured selector or replace the catalog. It follows the [criteria audit](model-routing-criteria-audit-2026-09-24.md), [first retrospective pilot](model-routing-retrospective-pilot-2026-09-24.md), current routing code, and a second bounded Jev pilot below.

## What the evidence says now

The current router makes eligibility mechanical: configuration state, explicit requests, exact routes, launch mechanism, features, context, account/quota status, and the max-effort gate. Jev then makes a real task-fit judgment among the remaining offers. The present catalog cannot reproduce that judgment with a defensible arithmetic score: it has reasoning, implementation, agentic, UI, and spatial/3D cells, **no art-quality dimension**, sparse UI/spatial measurements, different implementation scales, correlated reasoning/agentic benchmarks, and incomplete cost data. Jev's choices have not been compared to worker outcomes. A rule that sums these cells would be mechanical, but its precision would be invented. [Catalog](../../skills/model-routing/references/routing-catalog.json); [audit](model-routing-criteria-audit-2026-09-24.md).

The private journal currently contains 16 events: 10 decision events, four worker links, and two failed attempts. Eight decisions selected a candidate; six of those had only one eligible offer, so Jev did not compare models. Both five-offer Jev decisions returned `needs-acceptance` and have no worker link. The linked Orca terminal was still running when inspected; the other three links were context IDs without accessible completed transcripts in this audit. Orca session-history search was disabled. Thus **zero linked decisions can currently supply a verified outcome**. These counts describe this machine's journal at the time of inspection, not a model comparison. No score update is justified.

Historical local session tests used user turns and assistant final answers, not visual assets or independent checks. Jev marked animation-reference work as core art and spatial/3D (both 1.00) and classified the revisions as a mixture of mistakes and new direction (0.98); quality was `mixed` (0.87). In an equipment-art session it identified multiple deliverables (0.96), core art (1.00), and core spatial/3D (0.90), while quality remained `unknown` (0.51). In technical research, it marked research core (0.99) and quality unknown (0.79). These are useful classifications, but quality evidence is uneven, and art images were absent from the input. The numeric values are Jev's option probabilities, **not calibrated odds that the worker succeeded**. One equipment-art evaluation hit HTTP 429, while a separate request succeeded immediately afterward. The Jev client now gives 429s short bounded retries and honors a usable `Retry-After` header.

A prospective classification probe exposed an important failure mode. For “Make the game look much better,” Jev correctly wanted clarification (0.74) but simultaneously labeled art, coding, and UI as core with high probability. Those domain labels must be ignored when the task is underspecified. A first sufficiency question also asked for more information on a detailed helmet-turnaround request; phrasing it specifically as “would a missing fact change the model/effort choice?” changed the answer to `route_now` (0.67). Prompt wording and calibration matter. The probe is too small to set a confidence threshold.

## Recommended division of labor

1. **Code enforces eligibility.** Keep the existing hard gates and exact/explicit semantics. This is deterministic and auditable.
2. **Jev measures task features, not the winning model.** Ask atomic, typed questions about the requested outcome. Its first question identifies whether a missing fact could materially change routing. If so, ignore speculative domain scores and ask one targeted question. TypeSafe explicitly recommends atomic questions and combining them in code; it provides `Choice`, ordered-rubric `Score`, and binary `Noul` questions. Our client currently supports only `Choice`, so adding validated `Score`/`Noul` support is part of this design. [TypeSafe introduction](https://docs.typesafe.ai/introduction); [Choice](https://docs.typesafe.ai/primitives/choice); [Score](https://docs.typesafe.ai/primitives/score).
3. **Code chooses among eligible offers using calibrated outcome and cost estimates.** Do this only when the estimates have earned trust. Until then, run the new calculation in shadow mode alongside the existing Jev/agent selector. The selector changes only after prospective evaluation shows equal or better accepted outcomes at lower total cost.
4. **Jev classifies completed work retrospectively.** Link each launched decision to a real worker session and identify *task outcomes within* the session. Use Jev for domain and feedback classification; use tests, artifacts, user acceptance, and visual review for quality evidence. Never turn an `unknown` into an average score.

This retains Jev where semantic interpretation is valuable while making the final tradeoff reproducible. It does **not** assume Jev's current choice is equivalent to arithmetic; that remains unproven.

| Approach | What it gets right | Why it is insufficient today |
| --- | --- | --- |
| Current Jev chooses the offer | Reads task facts and can distinguish work types despite missing table cells | Opaque tradeoff, provider dependency, no outcome calibration |
| Sum the current catalog scores | Fast and reproducible | Mixed scales and correlated evidence, no art-quality score, sparse UI/3D data, no validated cost-to-acceptance model |
| Jev task measurements + calibrated value calculation | Semantic classification plus an auditable cost/quality tradeoff | Needs task-level outcomes, rubric validation, and a shadow rollout before it can replace current choices |

## Task measurements

Use a versioned, multi-label taxonomy. Start with domains that produce different failure and rework patterns:

- software implementation and debugging; architecture and systems design; research and fact checking; technical and general writing;
- UI visual design and UX interaction design; visual art and game assets; spatial/3D modeling and animation; data analysis; operations/deployment; planning and coordination.

For each domain ask whether it is absent, supporting, or central to the *deliverable*. Record the whole answer distribution, not just its mode. Do not call this an amount of work: a small but critical visual detail can dominate acceptance. Measure separately task novelty/complexity, visual-fidelity demand, verification difficulty, rework cost, failure severity, reversibility, and required context/features. Where the answer depends on one missing requirement, use a predefined missing-fact category and have the spawning agent ask a specific question. TypeSafe questions in one request are independent; code can ignore domain answers when the sufficiency answer says to clarify. [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice); [TypeSafe Score](https://docs.typesafe.ai/primitives/score).

The Jev request should contain the outcome, acceptance criteria, known facts, authority and failure impact, while the gates receive actual launcher/features/context requirements. The spawned agent still owns gathering facts and asking the user. Cache only a private, versioned task-feature result for a genuinely repeated outcome; a semantic resemblance is not a cache hit.

## Value calculation

Optimize **expected cost to an accepted result**, subject to a quality floor appropriate to the task's risk:

```
expected_loss(offer, task)
  = run_cost + latency_cost + quota_opportunity_cost
  + P(rework) × expected_rework_cost
  + P(harmful_unrecovered_error) × failure_impact
```

Run cost includes metered charges or provider-specific quota burden; quota is an opportunity cost even on a subscription. Rework cost includes the next model run, human review, and downstream redo. For art/3D, a weak image can force redraw and remodeling, so a stronger first pass can be cheaper overall. Higher failure severity raises the quality floor or the error-loss term; a reversible low-risk edit can favor a cheaper offer. A high-risk task should use a conservative lower credible bound on acceptable-result probability rather than an optimistic point estimate. Missing quality/cost data raises uncertainty; it does not become a zero or a presumed average.

Illustration only: a one-unit model with 60% first-pass acceptance and four units of rework has expected spend of `1 + 0.40 × 4 = 2.6`. A two-unit model with 90% acceptance yields `2 + 0.10 × 4 = 2.4`, so the dearer run is the better value. On a critical task, the cost of an undetected error can dominate both figures. These numbers are not estimates for any current catalog offer.

Do not multiply a domain weight directly by a benchmark score and call the result success probability. The current scales are not comparable, and correlated cells would be counted twice. Initially use the catalog as ordinal prior evidence and a safety constraint, not a fabricated probability. Later estimate first-pass acceptance and rework by model/effort and task features from outcomes, with partial pooling across related domains and efforts. Bound one session's contribution, separate task families, report effective sample size and uncertainty intervals, and keep a held-out validation set. A model/effort/domain score becomes trustworthy when its interval supports the relevant route comparison, not after an arbitrary raw count. For rare art or critical tasks, an explicit low-confidence state may persist for a long time.

Start with three measured outcomes per task: accepted on first pass (binary), material revision rounds (count), and total cost to acceptance (time, tokens, quota or money). Fit a hierarchical model with a shared task-family baseline, an offer effect, and only evidence-supported domain/effort interactions. Partially pool sparse cells toward their family baseline; keep the posterior interval rather than just the mean. Give at most one unit of weight to all revisions inside one original task, and use a robust cost distribution so one runaway session cannot dominate. An unverified or externally abandoned task contributes to coverage/missingness reporting, not to a model failure rate. More elaborate visual-quality scores can follow once their rubrics have independent visual evidence.

## Retrospective unit and rubric

The unit is one delegated outcome, not an entire chat. Record the decision ID, worker session ID, catalog/rubric versions, task profile, actual model/effort, artifact references, acceptance checks, user follow-ups, elapsed work, and provider spend/quota category. Session history is read from its source at review time; the routing journal holds links and metadata, not transcript copies.

For each outcome classify: completion, first-pass acceptance, material defects, number and cause of revisions, user acceptance/rejection, abandonment cause, and the domains involved. Keep separate functional correctness, visual quality, and process/communication quality. The rubric distinguishes a user changing taste from a model failing the original brief, and a blocked dependency from a poor worker. Jev's text-only assessment may identify explicit art feedback but cannot verify images it has not seen; visual outcomes need a vision-capable check or human review. The present Jev client returns no evidence spans, so score updates need separately recorded message/artifact references and a reviewable check of the label against them. Low-confidence or unsupported labels remain missing.

## Rate limits and continuity

The client now handles a transient 429 inside the existing 20-second call budget, using `Retry-After` when present and short waits of 0.25 then 1 second otherwise. It stops after three attempts and reports a longer server delay rather than sleeping through a launch. This removes the observed “one 429, give up indefinitely” failure for brief limits; it cannot guarantee recovery from a sustained outage. HTTP defines `Retry-After` as seconds or an HTTP date, and a 429 may include it. [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3); [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585.html#section-4); [Vercel 429 guidance](https://vercel.com/academy/ai-gateway/ai-gateway-pricing).

Once a mechanical selector has passed shadow evaluation, a persistent Jev 429 should bypass the task classifier only through a documented fallback: use known explicit task facts plus a conservative uncertainty envelope, gate-check the chosen enabled offer, and mark the route as `classifier_unavailable`. If uncertainty could change a critical route and no safe default exists, surface one targeted question or a precise retry time. Do not switch to an explicit/disabled offer or silently replace a principal's exact route. Until that selector exists, the present one-time Jev setting still forbids an automatic agent-choice fallback; the short retry is the continuity improvement available now.

## Rollout gates

1. **Classifier pilot:** hand-label diverse real tasks, including vague briefs and art/3D work. Measure domain agreement, missing-information false asks/misses, and stability under paraphrase. Add `Score`/`Noul` support and freeze the rubric; reject a classifier that overconfidently invents domains for vague tasks.
2. **Outcome collection:** make worker links reliable across Orca, harness-native Codex, and Claude; obtain task-level artifact/user evidence; report missingness. Run Jev assessment in shadow mode and manually audit a stratified sample, especially art and critical tasks.
3. **Value calibration:** compare total accepted-result cost and failure/rework by offer and task family. Use uncertainty-aware estimates and a holdout. Shadow-route the same tasks with current Jev choice, an agent baseline, and the proposed mechanical selector. A different choice alone is not a win; outcomes must improve.
4. **Controlled switch:** enable mechanical selection only for task families where it matches or beats the baseline within a predeclared quality floor. Keep the current selector for unsupported families. Measure 429 delays, fallback frequency, acceptance, rework, cost, and regret after launch; rollback on quality regression.

The key decision before implementation is the **fallback policy for a sustained Jev outage**: the recommendation is to allow a conservative enabled candidate for low-risk, well-specified tasks once the mechanical selector is validated, while critical/underspecified work gets a precise wait or targeted question. This avoids unbounded delays without pretending the current sparse table is already a reliable value model.
