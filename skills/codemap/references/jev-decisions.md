# Jev decisions

`decide.py` asks Jev (`typesafe-ai/jev` through Vercel AI Gateway) every discrete judgment in the map. Jev writes no prose; it returns a typed answer with a probability distribution and a confidence. The instruction text per question is a versioned constant in `decide.py` (`INSTRUCTIONS_VERSION`); changing any instruction bumps the version and invalidates every cached answer.

## Questions

| Question | Node | Type | State Jev sees | Options |
| --- | --- | --- | --- | --- |
| `area` | each component | Choice | the component card (below) | one per proposed area (name, definition, expected members), `build_verify`, `new_area`, `abstain` |
| `runtime` | each component | Choice | the same card | `server`, `client`, `fullstack`, `shared`, `cli`, `build`, `none`, `abstain` |
| `nature` | each component | Choice | the same card | `product`, `tooling`, `test`, `content`, `docs`, `experiment`, `abstain` |
| `role` | each component | Choice | the same card | `surface`, `adapter`, `core`, `kernel`, `abstain` |
| `core_uses_adapter` | a production edge from a product `core` to a product `adapter` | Boolean | both cards (id, name, responsibility, why, kind, role), the edge reason, count, up to 3 example imports | `true` acceptable by design, `false` finding |
| `crosses_the_wire` | a production edge between a product `client` and a product `server`, either way | Boolean | both cards with their runtimes, the edge reason, count, up to 3 example imports | `true` acceptable by design, `false` finding |
| `mixed_responsibility` | a component with two path-backed `mixed_jobs` in the draft | Boolean | its card, both jobs and paths, and resolved classifications | `true` confirms two independent reasons to change; `false` leaves no quality finding |
| `upward_dependency` | a production product edge from a lower role to a higher one, except `core` → `adapter` | Boolean | both cards, roles, edge reason and import examples | `true` acceptable by design, `false` finding |
| `stability_inversion` | a production product edge whose source has lower structural instability than its target | Boolean | both cards, fan-in/out and instability ratios, edge reason and import examples | `true` acceptable by design, `false` finding |
| `hub_coupling` | a product component with at least three production importers and three production dependencies | Boolean | its card, neighbor roles and natures, degree metrics and example imports | `true` coherent boundary, `false` finding |
| `holds` | a changed component (`--changes` only) | Boolean | the card, the previous four answers, the change summary | `true` keeps the previous answers |

Repository-aware drafts add these independent questions (shapes and diagnostics in [project types](project-types.md)):

| Question | State | Options |
| --- | --- | --- |
| `repository_shape` | Project cards, proposed relationships, concise component facts and reading leads | `single`, `landscape`, `abstain` |
| `project_kind` | Project purpose, its proposed component cards and repository context | Primary kinds in project types, plus `abstain` |
| `project_membership` | One component card, one project and repository context | Boolean; sharing is allowed |
| `view_support` | Entire graph with grounded detail, relevant component cards and repository context | Boolean; support and usefulness for the stated scope |

These states preserve all supplied decisive facts and include the draft-only source excerpts described in [project types](project-types.md) for paths the question cites. Reading leads are limited to 40 paths per category with omitted counts; actual request state over 250 KB fails before calling Jev. Repository decisions use the same cache and provider failure behavior as component questions, independently of component `holds`; their states also include the scanned revision. Membership/view true probability ≥0.6 accepts, ≤0.4 rejects, and the interval between stays uncertain. Shape and primary-kind choices use the existing Choice thresholds. Uncertainty appears in summary node lists and map diagnostics, never as draft-only accepted membership.

The four per-component Choices travel in one request sharing the card, so a component costs one call. The areas are the draft's `areas` (proposed by the agent; the principle is fixed by the skill: a group of parts one kind of person uses for one purpose). Jev never chooses between alternative groupings; it places each component. The `area` rubric: place the component with the people who use it, judging by responsibility rather than by who imports it; a library every area uses belongs to the area that owns its vocabulary; supporting code belongs to the area it serves, or to `build_verify` ("supporting code that serves the repository itself rather than one area: build, gates, dev stack, repo-wide tests, docs") when it serves the repository itself. `build_verify` is an accepted value like any area; the map draws it as the implicit `build-verify` area. `new_area` means product code no offered area fits and leaves the component unresolved. `role` is asked of every component to keep that single request; when `nature` is not `product` the answer is recorded but unused (`resolution[id].role_applies` is false, the map shows role `none`).

The card is: `id`, `name`, `path`, `kind`, the scan's `hints` (`executable`, `wasm`, `server_libs`, `client_libs`, `desktop`, `test_libs`, `directory_kind`, `test_file_share`), `derived` (plain sentences computed from the skeleton: "Imported by 3 components: a, b, c", "Imports server libraries: axum, tokio", "Has an executable entry", "Compiles to wasm", "Lives under tools/ (directory kind: tools)", "62% of its files are tests"), `responsibility`, `runs`, `why`, `entry_points`, `evidence` (paths only), optional `mixed_jobs`, `loc`, `files`, the 8 heaviest dependencies and dependents (id, import count, responsibility), the 8 most-used externals, and 8 sample file paths. Lists are cut deterministically until the card is under 6,000 characters, so a large component sends the same card every run.

### Runtime that follows from the nature

Once a component's nature is decided as `tooling`, `test`, or `experiment`, its runtime is `build`; `docs` is `none`. The runtime answer Jev gave in the same request is kept as a record but not used, the resolution entry carries `derived` with the reason, and the runtime is never re-asked. These are definitions, not judgments: asking Jev to choose between `cli`, `build`, and `shared` for an art pipeline measured only how the options overlapped. `product` and `content` runtimes stay Jev's call.

### Second pass

After the first round, every component whose `runtime`, `nature`, or `role` (role only when it applies) is `uncertain` or `unresolved` is asked those questions once more, with the same card plus `neighbor_facts`: its dependents and dependencies with their first-round runtime and nature, and a derived sentence counting its product importers. The second answer replaces the first unless it is worse (an `abstain` never displaces an uncertain value); those records and resolution entries carry `pass: 2`, and the first-round record is kept so both passes are cached. `summary.second_pass` lists the components re-asked.

## Definitions offered as criteria

| Question | Option | Description |
| --- | --- | --- |
| `runtime` | `server` | a long-lived service process |
| | `client` | a page or desktop app a person uses |
| | `fullstack` | an application whose own code runs both on a server and in the browser, such as server-side rendering with server routes beside its pages |
| | `shared` | a library compiled into more than one runtime |
| | `cli` | a command that is part of the product, run by its users or operators |
| | `build` | runs only while building, testing, developing, or producing assets, however it is started |
| | `none` | not executable: content, docs |
| `nature` | `product` | runs as part of what users use, including the authoring tools designers operate |
| | `tooling` | build, dev stack, quality gates, asset pipelines and the art or data sources they build from |
| | `test` | harnesses, acceptance lanes, test support |
| | `content` | data and scripts the product itself loads at run time |
| | `docs` | documentation and review evidence |
| | `experiment` | prototypes and spikes |
| `role` | `surface` | what a person or another system touches: UI, API handlers, CLI entry points, editor hosts |
| | `adapter` | I/O and engines: persistence, transport, rendering, filesystem, and wrappers of OS or browser APIs |
| | `core` | the system's own behavior: rules, models, sessions, workflows, and compilers of authored rule content |
| | `kernel` | the shared vocabulary: types, schemas and their validators, contracts, and plain utilities every role uses |

Every Choice also offers `abstain` ("the state lacks the evidence to decide; do not guess"); `area` adds `build_verify` and `new_area`.

## Code quality checks

Edge checks run on production imports only; an edge that only test files create is never asked and never a finding. Both endpoints must be `product` with a resolved value for the attribute the check compares. `upward_dependency` extends the layer check beyond `core` → `adapter`, while the existing `core_uses_adapter` question retains that pair so it is judged once. `stability_inversion` uses the skeleton's ratio of distinct production neighbors, `fan_out / (fan_in + fan_out)`; git activity is unrelated to this ratio. `hub_coupling` is a candidate only when both degree counts reach three. A high degree or inverted ratio proposes a question, not a finding. `mixed_responsibility` requires exactly two distinct jobs with paths inside the component, supplied after the evidence pass; classification uncertainty by itself cannot trigger it. The [research note](code-quality-research.md) explains the design principles and evidence limits.

`cycle` and `product-uses-support` (product code importing `tooling`, `test`, or `experiment`) need no Jev judgment: the builder reports these structural facts with `accepted` false. New Jev checks enter `map.health` only on a clear verdict; a weak new answer remains in the decision cache without a finding. The builder adds the plain-language headline, meaning, evidence, and suggested separation where supported.

## Thresholds

Choice answers (`area`, `runtime`, `nature`, `role`):

| Result | Status | On the card |
| --- | --- | --- |
| confidence ≥ 0.6 | `accepted` | value, no flag |
| 0.4 ≤ confidence < 0.6 | `uncertain` | value, flagged uncertain with the confidence |
| confidence < 0.4, `abstain`, or `new_area` | `unresolved` | no value; reason recorded |

Existing edge Booleans: probability ≥ 0.6 accepted by design; ≤ 0.4 a finding; in between a finding flagged uncertain. New edge and hub Booleans use the same clear accept/finding ends but omit the middle band from the map. For `mixed_responsibility`, probability ≥ 0.6 confirms a finding; lower or uncertain answers do not create one. Boolean `holds`: probability ≥ 0.6 carries the previous four answers forward under the new fingerprint (the record keeps `held_from`); anything lower asks all four again.

`decisions.json` exposes these as `resolution[component].{area,runtime,nature,role}` (`value`, `status`, `confidence`, `reason`) plus `role_applies`, `edges[key]` for the two established Jev edge checks, and `quality[key]` for the four new checks. Each verdict has `check`, `accepted`, `flag`, and `probability`; an edge verdict also has `from` and `to`, while a quality verdict names `nodes`. The key is `from->to` for an established edge check, suffixed `|check` when one edge answers both. `build` applies no thresholds of its own.

`build` also flags answers the scan argues against with `contradicts-evidence`: a `tooling`, `test`, or `experiment` component that a product component imports in production code, or a `client`/`server` runtime whose only runtime libraries belong to the other family. The build summary lists them under `contradictions`; sharpen those cards (responsibility, entry points, the manifest evidence) and re-run `decide`.

`build` never stops on an unresolved attribute: an unresolved area lands the component in the `unsorted` group (shown as *Not placed yet*); an unresolved runtime renders as `none`, nature as `product`, and role (product only) as `core`, each flagged `unresolved` on the card and listed in `map.unresolved`. Validation does stop when the answers leave an explicit area without components, when a flow names an endpoint that is not a runnable, an actor, or an external, or when an actor `uses` something that is neither a runnable nor an area; the error names the area, flow, or actor.

## When Jev is in doubt

`summary.unresolved_nodes` lists each `{node, question, reason, torn_between}`, and `summary.uncertain_nodes` each `{node, question, value, confidence, torn_between}`, for questions the map uses (role only for product code); repository diagnostics carry their decision fields and may omit `torn_between`. `torn_between` holds the two most likely options of the latest answer. For each one:

1. Add the fact that separates the two `torn_between` options to `draft.json` for that component, usually in `runs` or `responsibility`, with paths to the README, ADR, or inventory line that states it. For `new_area`, revise the areas themselves: add the area the component belongs to, or sharpen a definition so it covers it. Runtime and nature rest mostly on the scan's hints; when they are unresolved, check the manifest the scan read (a missing `bin`, a dependency declared elsewhere) rather than the prose.
2. Run `decide` once more. Only the components whose cards changed are re-asked.
3. A node still unresolved after that stays unresolved and flagged. Do not assign it a value by hand.

## Caching and fingerprints

Every record carries a fingerprint: SHA-256 of the canonical JSON of `[question, INSTRUCTIONS_VERSION, state, criteria]`. On a run, a cached record with the same node, question, and fingerprint is reused without a call; anything else is asked. Because the state is exactly what Jev saw, the same code and draft yield the same answers on every machine and for every agent, and a change to one card re-asks only that component and the neighbours whose cards quote its responsibility. Within one component request each question is cached on its own: editing an area's name, definition, or expected members re-asks `area` for every component while `runtime`, `nature`, and `role` stay cached.

Records for nodes that no longer exist are dropped when the new file is written. The file is written atomically; a provider failure mid-run saves a `partial` cache with every answer obtained so far, and the next run continues from it (`build` refuses a partial cache).

Each record: `node`, `question`, `fingerprint`, `answer`, `probabilities`, `confidence`, `model`, `elapsed_seconds`, `cost_usd` (a batched request's cost split evenly across its questions), `instructions_version`, `decided_at`.

## Cost and latency

Measured today: about 0.5–1 s per request and well under a cent per call (a component card with the four Choices batched runs about 1,800 input tokens). A first run costs one call per component, one more per component the second pass re-asks, and one per checked edge; re-runs cost only what changed. Rate limits (HTTP 429), overloads (529), bad gateways and unavailable providers (502, 503), and timeouts retry with exponential backoff (2, 4, 8, 16, 32 s) before the run stops. While it runs, `decide` prints one JSON progress line on stderr per phase boundary and every 10 components (`{"progress", "done", "total", "elapsed_seconds", "calls", "cached"}`, plus `retry` lines with the wait); stdout still carries only the final summary. `decide --dry-run` writes every request that would be sent to `dry-run.jsonl` in the map store, one JSON per line, without networking, and names the largest. `summary` reports `calls_made`, `calls_cached`, `areas` (proposed) and `areas_assigned` (components per answer, `build_verify` included), `runtimes`, `natures`, `findings` per check, and `total_cost_usd`.

## Errors and actions

Every error is a JSON `{"status":"error","error":"…"}` on stderr, never containing a key or a provider body. The run stops; there is no agent fallback for decisions. One exception: when a single card still gets HTTP 502 or 503 after the backoff while the calls around it succeed, it is asked once more in its compact form (every list cut to two entries, every string to 200 characters), which the provider has evaluated where a full card kept failing. Those answers carry `compact: true`, the component is listed in `summary.compacted`, and later runs reuse them from the cache. If the compact card fails too, the component is left unresolved with reason `provider_error`, listed in `summary.provider_failures`, and asked again on the next run; a second failure in a row stops the run as an outage. Rerun `decide` later for those components; do not rewrite their cards to get past it.

| Error | Action |
| --- | --- |
| Gateway key is missing / empty / malformed | Set `AI_GATEWAY_API_KEY` for this process, or run the model-routing skill's `jev.py setup` (`python3 <model-routing skill dir>/scripts/jev.py setup`). |
| credential must be owned by you with mode 600 / storage must be a regular file | Delete `~/.furanku-skills/model-routing/secrets/gateway.json` and run the setup command again. |
| HTTP 400 or 422 | The request shape was rejected. Reproduce with `--dry-run` and report a codemap bug with that request. |
| HTTP 401 | The key was refused; save a valid key with the setup command. |
| HTTP 402 | The Gateway team is out of credits or over budget; top up, then rerun. |
| HTTP 403 | The key lacks Gateway access; check the team's Gateway settings. |
| HTTP 402/403 with `customer_verification_required` | The Vercel team needs a valid payment card before any request is served, including free credits. Complete billing verification, then rerun. |
| HTTP 429, 502, 503, or 529 after the backoff | Rerun in a few minutes; cached and partial answers are reused, so only the remaining questions are sent. |
| connection failed or timed out | Check network access to `ai-gateway.vercel.sh`; rerun. |
| Gateway returned invalid JSON / inconsistent distribution / unexpected model | Transient provider fault; rerun once, then report it. |
| Corrupt decisions cache | Delete `decisions.json` and rerun; every question is asked again. |
