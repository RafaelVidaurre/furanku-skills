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

Transport is fixed to `typesafe-ai/jev` through Vercel `/v1/evaluate`, with TypeSafe-only routing, no redirects, bounded payload/response size, and a 20-second whole-call deadline. A Gateway 429 gets at most two automatic retries: the client honors `Retry-After` when it fits the 18-second retry budget. Without that header, it tries after 0.25 and 1 second. A longer server delay is returned immediately with its duration; without a header, three 429s stop with `rate_limited`. Other HTTP failures do not retry, and no alternate provider or selector is used. Resume the same decision after the stated delay when one is supplied. If no delay is supplied and the bounded retries failed, retry once after two seconds; if that also fails, report a sustained routing block with the attempt count and continue independent work. Do not leave the launch in an indefinite “retry when available” state. `--require-zdr` requests Gateway zero data retention when the user's policy requires it; Gateway plan access is required. Keep this flag on failures. Without it, provider/Gateway defaults apply.

**Complete when:** a fresh gate-checked launchable decision is available, or abstention, quota acceptance, or provider failure is surfaced with its next action.

## Optional exploratory trials

```sh
python3 <skill-dir>/scripts/jev_trial.py --repo <root> \
  --launchable-via <agent,...> --quota-axi --public-context --live \
  --output <private-directory>
```

Omit `--live` to prepare inputs without API calls. `--public-context` uses builtin public profiles and synthetic policy; omit it to use configured preferences/evidence. `--case <id>` limits the [synthetic cases](jev-trial-cases.json). `--allow-abstain` opts into the same abstain criterion; without it, a trial with only one eligible candidate has no comparative Jev Choice and reports that condition. `--require-zdr` has the same meaning as for routing. Trials never launch workers. Results record the full candidate probability distribution, distribution confidence, usage, observed cost and latency. Agent guesses are not correct-answer labels; routing quality needs actual worker outcomes, with agent selection as one possible baseline. The historical [trial report](https://github.com/RafaelVidaurre/furanku-skills/blob/main/docs/research/jev-trial-2026-09-20.md) records the initial integration run.

**Complete when:** observed selections and limitations are recorded without claiming routing accuracy from agreement with an agent.
