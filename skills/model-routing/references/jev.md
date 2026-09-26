# Jev setup and routing

## One-time choice and toggles

`router.py status` reports `setup-required`, `ready`, or `key-required` without a network request. The machine-wide choice lives at `~/.furanku-skills/model-routing/selector.json`, separate from repository configuration. There is no default before the user chooses.

```sh
python3 <skill-dir>/scripts/router.py setup --selector jev
python3 <skill-dir>/scripts/router.py setup --selector agent
```

Run the command matching the user's choice. With no `--selector`, setup asks yes/no in an interactive terminal. Agent mode needs no credential and makes no Gateway request; switching off retains the saved key for later. Jev mode verifies authentication with a small synthetic evaluation before persisting the choice. A failed verification leaves the previous choice intact. Setup can incur a small Gateway charge. An environment key override is verified for that process; use a saved machine key for persistent readiness.

**Complete when:** setup succeeds and status reports the requested selector ready.

## Handhold Gateway key entry

The credential lives at `~/.furanku-skills/model-routing/secrets/gateway.json`, shared across worktrees and installed copies for this OS user. Check it with `python3 <skill-dir>/scripts/jev.py status`.

If missing or invalid, give the user this command with `<skill-dir>` expanded to the installed path:

```sh
python3 <skill-dir>/scripts/jev.py setup
```

Tell them: **Run this in your terminal, paste your existing Vercel AI Gateway key into the hidden prompt, and press Enter.** Never request a key in chat. Let the user enter it, then check readiness and resume `router.py setup --selector jev`. Interactive router setup runs this hidden prompt directly when needed. There is no browser/provisioning workflow. If they need a key, point to [Gateway authentication](https://vercel.com/docs/ai-gateway/authentication-and-security); they supply it themselves.

Key setup saves a mode `600` JSON file in a mode `700` directory. Empty or invalid input preserves the old key. Secret managers may pipe to `jev.py setup --stdin`. `AI_GATEWAY_API_KEY` overrides the saved key for the current process. Neither credential status nor credential setup tests authentication; router setup does. Readiness output never includes the key or its prefix.

For 401, guide the user to replace the key. For 402/403, report the budget/access error. `customer_verification_required` means the key's Vercel team needs a valid payment card, including for free credits: ask the user to complete that team's verification and resume the same command when ready. Never switch providers to mask a failure.

**Complete when:** the saved key is ready and router setup has verified a live evaluation. A concrete provider failure remains resumable.

## Give Jev enough context

Create a private task JSON file outside tracked source. Include the desired outcome and acceptance criteria; relevant repository facts; scope and deliverable; write/deploy authority; failure impact; unresolved questions; prior attempts and their observed failures; dependencies; and principal constraints. Use strings or lists of strings. State unknowns instead of filling them with guesses. Provide the facts that would change the model choice, not a full conversation, source dump, or secrets. Jev receives text, so describe visual/spatial requirements and pass the `vision` gate when the worker must inspect images.

```json
{
  "outcome": "Diagnose stale cache reads after process failure.",
  "acceptance_criteria": ["Reproduce the race", "Explain a recovery protocol"],
  "repository_facts": ["Three services update the same records"],
  "authority": "Diagnosis and proposal; no deployment",
  "failure_impact": "Incorrect recovery could lose updates",
  "unknowns": ["Cross-process ordering"],
  "prior_attempts": [],
  "deliverable": "Reproducer and protocol proposal",
  "dependencies": [],
  "constraints": []
}
```

The script adds eligible model/effort capabilities, evidence dates/confidence, context size, cost/speed evidence, effective scoped preferences, and anonymous live quota summaries. Account identities, local config paths, diagnostic commands, and launch notes are excluded. Preference text and evidence descriptions are sent as configured: keep secrets out of these fields. This is an explicit field projection, not an automatic secret scrubber.

Use actual consumer constraints and the principal's explicit model/effort restrictions:

```sh
python3 <skill-dir>/scripts/router.py route --repo <root> \
  --task-file <private-task.json> --launchable-via <agent,...> --quota-axi \
  [--require-feature vision] [--minimum-context <tokens>] \
  [--allow-model <model>] [--allow-effort <effort>] \
  [--allow-abstain] \
  [--max-effort-basis "<why the strongest lower effort is insufficient>"]
```

`--allow-model` and `--allow-effort` are repeatable hard filters for Jev. Use them only for principal constraints, never to force an agent's preferred answer. Agent mode uses the ordinary candidate/reason check instead. Maximum-effort offers needing a basis remain ineligible without the existing explicit comparison. By default, Jev must choose one of the eligible agent/model/effort tuples; an empty set fails locally before a Gateway call, and a single eligible tuple is selected locally and gate-checked without asking Jev a one-option Choice. Add `--allow-abstain` when Jev should be able to decline because no candidate can carry out the assigned scope or a missing prerequisite prevents any candidate from starting. Facts assigned to the worker to investigate do not count as missing prerequisites. The selector result includes Jev's full candidate probability distribution for auditing, but no prose rationale or worker-success probability.

`route` returns the same `selected`, `refused`, and `needs-acceptance` contract as `check`. Only `selected` (or principal-requested `exact`) permits launch. Jev confidence is distribution confidence, not a worker-success probability, and there is no agent-expectation veto. An opt-in abstention requires improved task context or candidate evidence before another call. A provider error has no automatic selector fallback; switching to agent mode requires the user's choice.

The chosen candidate is rechecked against fresh configuration/runtime after evaluation. For `needs-acceptance`, preserve the decision and follow the main skill's remedy/acceptance rules. Recheck the **same candidate** with `check --candidate <selected.id> --reason <reason>` plus original hard requirements, launchers, max-effort basis and authorized acceptance. Keep the original `selector` evidence alongside the rechecked artifact; do not ask Jev to substitute another model to bypass quota. This check does not choose a model.

For Crew, save the successful decision privately and supply `packet --decision-json <file>`; use the manifest's launchable agents for the route call. Exact routes remain principal-controlled via `check --exact-route ... --route-basis ...` and do not call Jev.

Transport is fixed to `typesafe-ai/jev` through Vercel `/v1/evaluate`, with
TypeSafe-only routing, no redirects, bounded payload/response size, and a 20-second
whole-call deadline. Calls sharing a Gateway credential and endpoint coordinate
through private machine-wide state in `~/.furanku-skills/model-routing/gateway-backoff/`.
A file lock admits one request at a time; an occupied lock returns `in_flight`
with zero HTTP attempts and a short retry delay. Process exit releases the lock.

HTTP 429 persists a cooldown before reading the diagnostic body. `Retry-After`
controls the delay when supplied. Otherwise equal-jitter exponential backoff uses
ranges of 1–2, 2–4, 4–8, 8–16, 16–32, then 30–60 seconds. The failure count
survives separate calls and process restarts; a successful validated response
resets it. The client makes at most three HTTP attempts and waits only within its
18-second transport budget. A longer cooldown returns immediately with the
remaining delay, its source, and zero HTTP attempts when the call was held locally.
No alternate provider or selector is used. This coordination applies to copies
running this client; older installed clients do not observe its cooldown.

Diagnostics retain allowlisted error codes, numeric rate-limit headers, a fixed
message category, and a numerical limit explicitly stated in recognized message
wording. Raw provider bodies, free-form messages, and credentials are never saved
or echoed. A request-rate category alone does not identify whether Gateway or the
upstream provider enforces the limit. Other HTTP failures remain distinct.

Resume after the returned delay. Retrospective jobs can opt into a bounded waiting
budget as described in [Historical model performance](performance-history.md);
interactive launches surface the cooldown when it exceeds the short call budget.
Keep the same task constraints and privacy mode on retries. `--require-zdr`
requests Gateway zero data retention when the user's policy requires it; Gateway
plan access is required. Without it, provider/Gateway defaults apply.

**Complete when:** a fresh gate-checked launchable decision is available, or abstention, quota acceptance, or provider failure is surfaced with its next action.

## Typed evaluation requests

`jev.py evaluate --request <file>` supports the Gateway `/v1/evaluate` contract:

| Type | Criteria | Returned value |
| --- | --- | --- |
| `choice` | Object mapping option names to standalone descriptions | Selected `choice`, option probabilities, optional distribution confidence |
| `boolean` | Optional object with `true` and `false` descriptions | `probability` of true |
| `score` | Ordered array of 2–10 standalone level descriptions | Interpolated `score`, level probabilities, optional distribution confidence |

Use Boolean for one yes/no claim, Choice for categories, and Score for one ordered
judgment. TypeSafe calls its yes/no primitive Noul; this Gateway endpoint names it
`boolean`, so `noul` is rejected locally. Question IDs are response keys, not
instructions visible to Jev. Independent questions can share one state and request;
combine their answers mechanically. A dependent evidence lookup requires a later
request. The client validates each answer against its question type while preserving
existing Choice consumers. Missing confidence stays unknown; probability and
confidence are not measured downstream success rates.

For historical scoring inputs and validation, use
[Historical model performance](performance-history.md). API contract:
[Vercel evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation).

## Optional exploratory trials

```sh
python3 <skill-dir>/scripts/jev_trial.py --repo <root> \
  --launchable-via <agent,...> --quota-axi --public-context --live \
  --output <private-directory>
```

Omit `--live` to prepare inputs without API calls. `--public-context` uses builtin public profiles and synthetic policy; omit it to use configured preferences/evidence. `--case <id>` limits the [synthetic cases](jev-trial-cases.json). `--allow-abstain` opts into the same abstain criterion; without it, a trial with only one eligible candidate has no comparative Jev Choice and reports that condition. `--require-zdr` has the same meaning as for routing. Trials never launch workers. Results record the full candidate probability distribution, distribution confidence, usage, observed cost and latency. Agent guesses are not correct-answer labels; routing quality needs actual worker outcomes, with agent selection as one possible baseline. The historical [trial report](https://github.com/RafaelVidaurre/furanku-skills/blob/main/docs/research/jev-trial-2026-09-20.md) records the initial integration run.

**Complete when:** observed selections and limitations are recorded without claiming routing accuracy from agreement with an agent.
