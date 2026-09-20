# Jev through AI Gateway for model-routing

Researched 2026-09-20. Scope: setup, documented API contract, and integration design; no implementation or authenticated model request. Public documentation and published npm source were inspected. Examples below are proposed, unexecuted code, not observed responses.

Follow-up: a credential setup command and non-launching trial runner now exist.
Use [the current Jev instructions](../../skills/model-routing/references/jev.md)
for the implemented interface; the design below records the earlier research.

## Recommendation

Use the documented HTTP evaluation endpoint from the existing Python router. Jev can choose among eligible routing candidates; local code must retain eligibility, authorization, quota, and launch decisions. The HTTP option avoids introducing Node solely for this feature. This is a design recommendation, not a benchmark result.

## Verified interface

| Concern | Contract |
|---|---|
| Gateway model | `typesafe-ai/jev` |
| HTTP | `POST https://ai-gateway.vercel.sh/v1/evaluate` |
| Authentication | `Authorization: Bearer <AI_GATEWAY_API_KEY>` and JSON content type |
| Body | `model`, `state`, `questions`; optional `providerOptions` |
| State | JSON string, object, or array |
| Choice question | `{type: "choice", instructions: "…", criteria: {candidateId: "description", …}}` |
| Result | `answers`, `usage`, `model`, `providerMetadata`; examples include Gateway routing, costs, generation ID |
| Compatibility | Evaluation is separate from OpenAI chat/responses, Anthropic, and Cohere endpoints |

These HTTP fields and supported endpoint distinctions are documented in the [Gateway evaluation reference](https://vercel.com/docs/ai-gateway/modalities/evaluation). Jev evaluates typed decisions without producing prose; multiple questions independently share the supplied state. It cannot supply a generated explanation for a routing choice. [TypeSafe introduction](https://docs.typesafe.ai/introduction)

There is also an official TypeSafe-compatible endpoint at `/typesafe/v1/systemone`, with native `noul`, `input_tokens`, and `provider_metadata` naming, plus `/typesafe/v1/models`. It accepts a Gateway key or Vercel OIDC bearer token. Keep these native shapes separate from `/v1/evaluate`. [TypeSafe API compatibility](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)

**Documentation conflict:** the September 18 [agent-loop article](https://vercel.com/i/jev-agent-control) says Gateway evaluation requires AI SDK and compatibility endpoints are unsupported. The detailed reference and quickstart now explicitly document HTTP and TypeSafe compatibility. Prefer the endpoint-specific references; live availability remains unverified.

## Choice result and confidence

The SDK's generic answer type is:

```ts
{
  type: 'choice';
  choice: keyof Criteria; // string keys
  probabilities?: Record<keyof Criteria, number>;
}
```

The published `ai@7.0.105` implementation validates exact answer IDs, matching answer types, membership of the selected option, and, when provided, complete finite probabilities in `[0,1]`. It checks distribution sums with declared rounding tolerance and that the selected option has maximal probability. Distributions are optional in the generic contract. [Published package source: `src/evaluate/evaluation-result.ts` and `validate-evaluation.ts`](https://registry.npmjs.org/ai/-/ai-7.0.105.tgz)

For the question named `route`, use `result.answers.route.choice` and `result.answers.route.probabilities?.[choice]`. TypeSafe's separate confidence statistic is `result.providerMetadata?.typesafe?.confidence?.route`. It is provider-specific, not a field on the SDK Choice answer and not the selected option's probability. [AI SDK evaluation guide](https://ai-sdk.dev/docs/ai-sdk-core/evaluation)

Native TypeSafe Choice responses instead put `confidence` directly on the answer. Confidence summarizes distribution concentration; it is not assurance that the chosen coding model will succeed. Thresholds need labeled routing outcomes, with an explicit path for missing distributions, low confidence, and errors. [TypeSafe confidence](https://docs.typesafe.ai/confidence), [Vercel threshold guidance](https://vercel.com/i/jev-probabilities-and-thresholds)

**Proposed integration rule:** require and validate the signals the router actually uses; preserve missing values as unavailable. Initially record recommendations without automatic acceptance, then calibrate a threshold against representative tasks. Do not manufacture a confidence value or infer task-success probability from Choice probability.

The SDK validates string-key membership but no provider-wide punctuation or key-length guarantee was established. **Proposed encoding:** send opaque options such as `c001`, retain an exact local mapping to agent/model/effort, and reserve `abstain`; this permits at most 254 launch candidates within the 255-option limit.

## SDK alternative, versions, and runtime

- Vercel identifies **`ai >=7.0.105`** as the first release exposing `experimental_evaluate`; import `experimental_evaluate as evaluate` from `ai` and pass the Gateway model string. [September 16 release](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway)
- The exact published `ai@7.0.105` package requires **Node `>=22`** and depends on `@ai-sdk/gateway@4.0.85`, `@ai-sdk/provider@4.0.17`, and `@ai-sdk/provider-utils@5.0.43`. Pin and lock these if adopting the SDK. [npm version metadata](https://registry.npmjs.org/ai/7.0.105)
- Vercel's directly executable `.mts` quickstart specifies **Node 22.18+**; that is more specific than the package engine floor. A plain `.mjs` entry point avoids native TypeScript execution requirements. [Evaluation quickstart](https://vercel.com/docs/ai-gateway/getting-started/evaluation)
- An explicit provider instance uses `gateway.evaluationModel('typesafe-ai/jev')`. The pinned Gateway package internally calls `/evaluation-model` with SDK protocol headers; use the documented public `/v1/evaluate` for direct HTTP instead of copying that transport. [Gateway source: `src/gateway-evaluation-model.ts`](https://registry.npmjs.org/@ai-sdk/gateway/-/gateway-4.0.85.tgz)

The pinned evaluation function accepts `model`, `state`, `questions`, `maxRetries`, `abortSignal`, `headers`, and `providerOptions`. It defaults to two retries, supports cancellation, and has no `timeout` argument or built-in deadline in that function. A caller can supply `AbortSignal.timeout(...)`; `maxRetries: 0` disables SDK retries. [Published evaluation implementation](https://registry.npmjs.org/ai/-/ai-7.0.105.tgz)

## Setup, limits, pricing, and data handling

Use a Vercel team with Gateway access and available credits. Provision a Gateway API key in the dashboard and expose it as `AI_GATEWAY_API_KEY` through the user's secret management. Hosted Vercel environments can use OIDC; an explicit API key takes precedence. No TypeSafe key is required for ordinary Gateway billing. [Authentication and BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok), [Quickstart](https://vercel.com/docs/ai-gateway/getting-started/evaluation)

Choice supports up to **255 options**. Score has **2–10 ordered levels**. Jev accepts text/JSON, not image/audio/video inputs. TypeSafe documents a **64k-token total request budget** and **32k for state plus the longest question**; the catalog's simpler 32K label should not be interpreted as 32K state plus unlimited questions. [Choice documentation](https://docs.typesafe.ai/primitives/choice), [Vercel Jev guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk), [TypeSafe model limits](https://docs.typesafe.ai/models)

TypeSafe currently lists direct-service limits of 250,000 tokens/second and 1,200 requests/minute, explicitly subject to change. These are not verified Gateway team quotas. HTTP clients should honor a parseable `Retry-After` on rate limiting and otherwise use exponential backoff. [TypeSafe model limits](https://docs.typesafe.ai/models), [Gateway rate limits](https://vercel.com/docs/ai-gateway/rate-limits)

**Proposed routing policy:** impose one short total deadline; make zero retries initially to avoid multiplying routing latency. Report timeout/rate-limit/auth/service failures explicitly and return no launchable decision; do not silently substitute another selector. Ten seconds in the example below is a sample budget, not a service guarantee or measured latency.

Pricing views differ; do not treat the promotion as a durable rate:

- A catalog view observed during research advertised **free through September 25, 2026**, while another indexed view showed **$0.04 per million input tokens**. Account billing and promotion eligibility were not tested. [Jev catalog](https://vercel.com/ai-gateway/models/jev)
- The September 19 guide and TypeSafe model page state **$0.042 per million input tokens, output tokens free**. At that rate, 2,000 input tokens cost $0.000084; 1,000 such calls cost $0.084. This arithmetic excludes promotions and any account-specific terms. [Vercel Jev guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk), [TypeSafe models](https://docs.typesafe.ai/models)

Use returned Gateway cost metadata and current catalog pricing rather than embedding the observed free promotion or rounding $0.042 to $0.04 in budgets.

Gateway documents no retention of prompts/outputs after requests complete. Its provider table lists TypeSafe as ZDR/no-training, with legal/contractual exceptions in the provider description. Evaluation permits `providerOptions.gateway.zeroDataRetention: true` and a provider allowlist. These are documented controls; this research did not verify their behavior for an account. [Gateway ZDR](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr), [Evaluation provider options](https://vercel.com/docs/ai-gateway/modalities/evaluation)

TypeSafe's direct-service documentation separately offers enterprise ZDR; its DPA specifies retention as needed for processing rather than a universal number of days. Do not generalize Gateway treatment to direct TypeSafe accounts. [TypeSafe legal](https://docs.typesafe.ai/legal), [TypeSafe DPA](https://typesafe.ai/legal/data-processing)

## Minimal HTTP setup example — proposed, not executed

After obtaining a Gateway key, export it through your usual secret mechanism. The following Python example uses only the standard library and sends synthetic task information. It is an API smoke test, not the complete routing policy or a total-wall-clock timeout implementation.

```bash
python3 - <<'PY'
import json
import os
import urllib.request

payload = {
    "model": "typesafe-ai/jev",
    "state": {"task": "Correct a typo in a public README."},
    "questions": {
        "route": {
            "type": "choice",
            "instructions": "Choose the smallest adequate capability tier.",
            "criteria": {
                "routine": "Bounded edits with clear mechanical verification.",
                "complex": "Ambiguous tasks needing substantial reasoning.",
                "abstain": "The supplied evidence is insufficient to decide.",
            },
        },
    },
    "providerOptions": {"gateway": {"zeroDataRetention": True}},
}
request = urllib.request.Request(
    "https://ai-gateway.vercel.sh/v1/evaluate",
    data=json.dumps(payload).encode(),
    headers={
        "Authorization": "Bearer " + os.environ["AI_GATEWAY_API_KEY"],
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(request, timeout=10) as response:
    result = json.load(response)
print(json.dumps({
    "answer": result["answers"]["route"],
    "confidence": result.get("providerMetadata", {})
                        .get("typesafe", {}).get("confidence", {}).get("route"),
    "usage": result.get("usage"),
}, indent=2))
PY
```

The transport and envelope follow the [public HTTP reference](https://vercel.com/docs/ai-gateway/modalities/evaluation); the confidence path follows the [SDK evaluation contract](https://ai-sdk.dev/docs/ai-sdk-core/evaluation). Actual HTTP confidence presence/shape, account permissions, ZDR routing, latency, and billing remain smoke-test items. A production client needs bounded response reading, answer validation, redacted errors, a total deadline, and explicit failure outcomes.

## Unverified or unresolved

- No credentials were inspected, packages installed, metered requests made, or live routing quality measured.
- `typesafe-ai/jev` is the documented Gateway identifier; TypeSafe's direct `jev-latest` currently resolves to `jev-1.13.0`. A version-pinned Gateway ID was not established. Record returned model/provider metadata and retest behavior when the alias changes. [TypeSafe aliases](https://docs.typesafe.ai/models)
- No universal latency SLA, universal confidence cutoff, or quality advantage for this repository's tasks was established. Reported speed/cost comparisons are vendor evaluations, not measurements of this integration.
- The SDK evaluation interface is experimental and Gateway marks evaluation beta. Pin a contract fixture and check drift before enabling automated routing. [SDK evaluation guide](https://ai-sdk.dev/docs/ai-sdk-core/evaluation)

## Fit with this repository

The following is a proposed implementation, not an installed capability. The current skill still delegates judgment to the spawning agent.

| Existing seam | Finding and implication |
| --- | --- |
| [Model-routing instructions](../../skills/model-routing/SKILL.md) | Explicitly assign selection and rationale to the spawning agent. Replace that instruction for the opt-in Jev path; merely mentioning Jev would leave conflicting owners. Keep principal-requested exact routes on their existing deterministic path. |
| [Router](../../skills/model-routing/scripts/router.py) | Already compiles candidates and has `gate_check()`, `check()`, and JSON decisions. Add selection beside these functions and reuse their gates; Jev must not become a second implementation of quota or launch policy. |
| [Configuration](../../skills/model-routing/references/configuration.md) | Candidate IDs identify whole agent/model/effort tuples. Preferences are prose, with binding precedence, but are not machine-enforced today. Jev needs resolved task policy as input; hard restrictions need local enforcement. |
| [Crew adapter](../../skills/crew/scripts/assignment.py) | Accepts a checked decision through `packet --decision-json`; validates status and manifest launchability. Its packet summary drops additional selector metadata, so preserve the full decision artifact for review. |
| [Package manifest](../../package.json) | Python scripts already ship through `skills/*/scripts/**`. The public HTTP API fits the current Python implementation without adding an SDK or raising the package's Node >=18 minimum. |

Jev is the selector, not a new worker candidate. Only its evaluation request goes through Gateway; the selected agent still launches through the existing mechanism and uses that route's authentication and quota.

## Context Jev needs to make the decision

Treat Jev as stateless for each delegated outcome. Give it enough information to choose among the actual offers available now, rather than a task sentence and familiar model names. The following is a proposed context contract, not a claim that all fields have equal predictive value. Populate it from the assignment, local inspection, compiled catalog, resolved policy, and runtime; keep unknowns explicit.

| Context | What to supply | Why it changes the route / source |
| --- | --- | --- |
| Requested outcome | A faithful task description, intended deliverable, acceptance criteria, explicit exclusions, and relevant verbatim user constraints | Distinguishes investigation, implementation, review, writing, and design. The assignment/user request owns intent. A title or role name alone is insufficient. |
| Relevant working context | Language/framework, subsystem, current behavior, required change, architectural seams/dependencies, availability of reproduction and tests, relevant repository constraints | A small edit with a known pattern differs from discovering a concurrency fault. Use observed repository facts, with compact excerpts only when a summary loses a decisive detail. |
| Scope and uncertainty | Expected scope and its basis, unresolved questions, whether a solution approach is known, relevant prior attempts and what failed, external dependencies | Separate observed difficulty signals from the caller's guesses. A previous failure is useful evidence about the failure mode, not an automatic premium/max route. |
| Consequences and responsibility | Read-only analysis versus write authority, what the owner must decide autonomously, reversibility, failure impact, review/verification available afterward | Describes the cost of a wrong result and opportunities to catch it. Role labels such as worker or captain should not replace these facts or activate an exact route by themselves. |
| Hard needs and launch surface | Required tools/features, vision requirement, minimum context, permitted launchers, environment/access requirements, explicit agent/model/effort restrictions | Local code filters what it can prove first. Jev still needs the relevant requirements to assess fit. Provide only capabilities verified for that launcher/session. |
| Candidate capability evidence | Exact model and effort; launcher-relevant capabilities; reasoning/implementation/agentic/UI/spatial evidence; confidence, date, harness/effort comparability, unknowns; effective context capacity | The catalog owns these facts. Describe task-relevant strengths and limits explicitly: Jev's prior knowledge may predate models and cannot know local launcher behavior. A benchmark under another effort/harness is a labeled proxy, not an exact score. |
| Candidate runtime and economics | Eligible status, anonymous provider/account grouping, subscription versus metered billing, quota freshness, remaining runway/pace pressure within each provider, known speed/cost and uncertainty, pooled-route semantics | The same model through two launchers can be a different offer. Compare quota using existing provider-local semantics; do not rank different providers by raw percentages or call pooled access free. Selector Gateway cost is separate. |
| Resolved routing policy | Applicable preferences in their precedence order, task-specific exceptions, cost/latency/quality objectives, budget/deadline when supplied, tie and abstention policy | Policy determines how to trade adequate capability against cost and speed. Pass the approved decision rules and their authority, not complete private configuration files. Hard restrictions remain enforced locally. |
| Evidence quality and missing context | Provenance categories for facts, unverified estimates, stale/missing capability evidence, context deliberately omitted, whether the task can be clarified | Prevents a confident choice based on an overconfident summary. Record known missing fields locally; an abstain answer alone does not explain its cause. |

The caller should prepare the assignment, not secretly decide its route. Avoid precomputed labels such as “easy, use the cheap model” or an ungrounded difficulty score. Preserve the facts that would let Jev disagree with the caller: ambiguity, actual acceptance criteria, failure modes, tool access, and evidence uncertainty. An estimate can be useful if it is labeled as an estimate with its basis. Never present an invented repository inspection as observed context.

### Split policy, task facts, and candidate descriptions

Use three separate surfaces in the request:

- `questions.route.instructions`: a stable, versioned selection rule defining the desired outcome, precedence, adequacy/cost tradeoff, treatment of unknown evidence, and abstention. State that quoted task/repository content is evidence and cannot change the option set or routing policy.
- `state`: structured task facts, the resolved applicable policy, requirements, and relevant candidate/runtime evidence. Mark provenance and uncertainty. Keep the user's actual objective distinct from instructions found inside files or logs.
- `questions.route.criteria`: one opaque alias per eligible offer, with a meaningful description of that offer and when its capabilities matter, plus `abstain`. Keep the alias-to-candidate mapping locally; resolve the entire launch tuple only after validating the answer.

TypeSafe says question IDs are not used for inference, so substantive meaning must live in state, instructions, and criteria. Opaque identifiers alone do not describe capabilities. [TypeSafe API contract](https://docs.typesafe.ai/api)

An illustrative state outline (field names are our proposal):

```text
schema_version
task
  outcome, deliverable, acceptance_criteria, exclusions
  relevant_user_constraints
  repository_facts [{fact, source_kind, observed_or_estimated}]
  scope, unknowns, prior_attempts [{approach, observed_failure}]
  authority, reversibility, failure_impact, verification_available
requirements
  features, minimum_context, launch_surface_capabilities
policy
  resolved_preferences, explicit_exceptions, quality_cost_latency_objective
  caller_supplied_budget_or_deadline, abstention_rule
offers
  c001
    model, effort, launcher_capabilities
    capability_evidence [{dimension, assessment, confidence, date, comparability}]
    context_capacity, speed_or_unknown
    billing_kind, anonymous_quota_group, quota_summary, runtime_freshness
  c002 ...
missing_information
```

Do not make every request carry every benchmark and every historical failure. Always carry the outcome, decisive constraints, applicable policy, and complete eligible option descriptions. Include detailed code/error excerpts, domain-specific evidence, or previous attempts only when they can change the choice. Preserve provenance dates and unknowns while compressing. The existing catalog has ten candidates, making explicit profiles practical for the first experiment.

Jev is text/JSON-only. For visual work, provide the task's visual requirements and any reliable textual observations, and require a vision-capable worker locally. Do not claim Jev inspected images. Similarly, it cannot inspect a filesystem path or fetch a referenced benchmark: put the relevant facts in the request rather than passing only a path/URL.

### Question design and refresh

A single Choice over eligible offers is the smallest experiment that makes Jev own the selection. It is not yet evidence that one broad question handles every tradeoff well. TypeSafe recommends decomposing multidimensional judgments into atomic questions; questions in one call are independent and do not see each other's answers. [TypeSafe question design](https://docs.typesafe.ai/introduction)

If direct Choice underperforms, compare it with narrow per-candidate adequacy questions or task-dimension assessments on the same labeled tasks. A final Choice that uses those answers requires a subsequent call with the answers in its state; adding a second question to the same request does not create that dependency. Combining scores in local code would change who makes the final decision, so document that as a separate design rather than silently turning Jev into just a difficulty classifier.

Rebuild task context for each delegated outcome. Reuse stable profiles only while their catalog/policy version and runtime freshness still hold. Changed requirements, new failure evidence, changed preferences, a different launch surface, or changed eligibility invalidate the old decision. The current skill's 30-minute brief freshness rule remains an upper bound, not permission to ignore a known runtime change.

Context validation should check whether adding relevant evidence changes decisions appropriately: for example, the same short “fix the cache” request with a known one-line defect versus an unreproduced cross-process race; the same task with and without a required tool; or an otherwise suitable candidate whose quota becomes unavailable. Compare a task-only baseline with the complete context contract and inspect both disagreements and inappropriate downgrades. Freeze expected acceptable routes before scoring; missing task context and weak candidate selection are different failure modes.

### Proposed agent-facing call

Illustrative interface to implement; this command does not exist yet:

```sh
python3 <model-routing-skill-dir>/scripts/router.py route \
  --repo <worktree> --selector jev --task-file <task.json> \
  --launchable-via <agents-supported-by-this-session> --quota-axi
```

The task file should describe the outcome, acceptance criteria, relevant task context, write authority/risk, hard feature/context requirements, and explicit principal constraints. Let the agent describe the work; Jev chooses the eligible candidate. Derive launchability from Crew's manifest when Crew is the consumer.

Recommended flow:

1. Resolve the existing configuration and current runtime. Honor explicit exact routes without a Jev call. Apply hard restrictions through the shared gates, including disabled candidates, features, context, launcher availability, account compatibility, and exhausted quota. Apply the existing maximum-effort requirement before exposing candidates that need an explicit basis.
2. Build one Choice question over opaque option keys mapped locally to eligible candidate IDs, with an explicit abstain option. Each option describes its exact agent/model/effort tuple, task-relevant capability evidence and uncertainty, and applicable cost/quota semantics. Keep launcher identity: two surfaces serving the same model can have different availability and billing.
3. POST the bounded evaluation request through Gateway. Validate the response's model, question ID/type, option membership and any required finite probability distribution, honoring documented rounding tolerance. Treat abstain as unlaunchable. Preserve the returned confidence separately from option probabilities; absence must remain absence.
4. Recheck the chosen candidate with the existing launch checks and current runtime before emitting `selected`. Unknown/stale quota must retain `needs-acceptance`; a Jev vote cannot accept it. A changed or refused route remains unlaunchable.
5. Emit the existing decision shape, plus a versioned selector record containing model, chosen ID, probabilities, confidence, request/usage/cost metadata where supplied, elapsed time, and input/policy fingerprints. Crew consumes only a successful checked decision. Bound artifact reuse to the same task, constraints, candidate set, and fresh runtime; saved decisions do not themselves refresh quota.

For a changed candidate set, a bounded new Jev evaluation is possible; report the invalidation. On missing credentials, timeout, provider failure, or malformed output, report the selector failure and return no launchable decision. Do not silently replace Jev with agent judgment or an invented choice.

### Two policy details to resolve explicitly

**Rationale:** `check --candidate` and Crew currently require a nonempty `reason`. Jev does not write an explanation. Record an honest deterministic provenance statement, for example that Jev selected a particular candidate under a particular policy version, with its returned probability/confidence when present. Update the skill to distinguish that record from agent-authored judgment. Do not manufacture a task-specific explanation or maximum-effort justification on Jev's behalf. Candidates needing `--max-effort-basis` remain unavailable without a caller-supplied valid basis.

**Preferences:** sending prose preferences to Jev does not make them hard gates. Project explicit prohibitions and fixed constraints into local eligibility before selection; include the remaining resolved preferences, task-specific tradeoffs, and evidence limitations in the decision input. Preserve the existing precedence and surface unresolved conflicts. Test preference compliance separately from schema validity. Gateway spend for the selector and subscription quota for a worker are different costs; API benchmark dollars must not silently rank subscription routes.

### Bound the outbound payload

The current `brief --format json` includes repository paths, configuration-layer metadata, and runtime account information. It is an inspection format, not a request body. Construct a fresh allowlisted payload from task context, public capability facts, resolved routing policy, and anonymous quota summaries. Keep credentials, account identities, local paths, raw configuration, and diagnostic commands local. Preserve distinctions between separate billed accounts using opaque local aliases if necessary.

The builtin catalog currently has ten candidates; a single Choice is a reasonable first experiment. Effective overrides may increase that count. Enforce the verified question/option/context limits and fail clearly rather than silently truncating task constraints or arbitrary candidates. Catalog evidence remains the authority for candidate capabilities; Jev's confidence is not a new benchmark score.

### Worktree experiment and completion checks

Use an explicit selector argument in this worktree initially. The configuration reference says machine-repo state is keyed by Git's common directory, so changing that layer would affect sibling worktrees. Keep installed skills and shared routing defaults unchanged during this research; do not merge until the user authorizes it.

Suggested implementation sequence:

1. Add the bounded Python Gateway client and mocked contract cases. Complete when Choice responses parse, authentication failures/timeouts/malformed responses fail visibly, and credentials cannot enter output or fixtures.
2. Add `route`, reusing the existing gates and JSON decision contract. Complete when exact routes bypass Jev, ineligible choices cannot launch, quota acceptance still works, preference constraints are honored, and no raw brief/private account data enters requests.
3. Update the model-routing skill and Crew invocation guidance, pruning superseded agent-judgment instructions for the Jev path. Complete when an agent can invoke the selector and launch from its checked result without choosing the candidate itself.
4. Make an authenticated smoke call using synthetic task data, then compare Jev decisions on representative repository tasks with predeclared acceptable routes. Include mechanical edits, ordinary implementation, difficult architecture, visual work, explicit overrides, ambiguous tasks, unavailable launchers, and insufficient quota. Measure inappropriate downgrades, preference violations, uncertain decisions, latency, and selector cost. Complete when the error policy and any confidence threshold are justified by those cases; a valid response alone does not establish routing quality.

No live authenticated Jev request, selector implementation, routing-default change, or merge was performed for this research. The remaining empirical question is whether Jev chooses suitable routes for this repository's task distribution and preferences.
