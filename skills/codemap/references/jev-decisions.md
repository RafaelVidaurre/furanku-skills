# Jev decisions

`decide.py` asks Jev (`typesafe-ai/jev` through Vercel AI Gateway) every discrete judgment in the map. Jev writes no prose; it returns a typed answer with a probability distribution and a confidence. The instruction text per question is a versioned constant in `decide.py` (`INSTRUCTIONS_VERSION`, currently 6); changing any instruction bumps the version and invalidates every cached answer.

## Questions

| Question | Node | Type | State Jev sees | Options |
| --- | --- | --- | --- | --- |
| `area` | each component | Choice | the component card (below) | one per proposed area (name, definition, expected members), `build_verify`, `new_area`, `abstain` |
| `runtime` | each component | Choice | the same card | `server`, `client`, `shared`, `cli`, `build`, `none`, `abstain` |
| `nature` | each component | Choice | the same card | `product`, `tooling`, `test`, `content`, `docs`, `experiment`, `abstain` |
| `role` | each component | Choice | the same card | `surface`, `adapter`, `core`, `kernel`, `abstain` |
| `core_uses_adapter` | a production edge from a product `core` to a product `adapter` | Boolean | both cards (id, name, responsibility, why, kind, role), the edge reason, count, up to 3 example imports | `true` acceptable by design, `false` finding |
| `crosses_the_wire` | a production edge between a product `client` and a product `server`, either way | Boolean | both cards with their runtimes, the edge reason, count, up to 3 example imports | `true` acceptable by design, `false` finding |
| `holds` | a changed component (`--changes` only) | Boolean | the card, the previous four answers, the change summary | `true` keeps the previous answers |

The four per-component Choices travel in one request sharing the card, so a component costs one call. The areas are the draft's `areas` (3–7, proposed by the agent; the principle is fixed by the skill: a group of parts one kind of person uses for one purpose). Jev never chooses between alternative groupings; it places each component. The `area` rubric: place the component with the people who use it, judging by responsibility rather than by who imports it; a library every area uses belongs to the area that owns its vocabulary; supporting code belongs to the area it serves, or to `build_verify` ("supporting code that serves the repository itself rather than one area: build, gates, dev stack, repo-wide tests, docs") when it serves the repository itself. `build_verify` is an accepted value like any area; the map draws it as the implicit `build-verify` area. `new_area` means product code no offered area fits and leaves the component unresolved. `role` is asked of every component to keep that single request; when `nature` is not `product` the answer is recorded but unused (`resolution[id].role_applies` is false, the map shows role `none`).

The card is: `id`, `name`, `path`, `kind`, the scan's `hints` (`executable`, `wasm`, `server_libs`, `client_libs`, `desktop`, `test_libs`, `directory_kind`, `test_file_share`), `derived` (plain sentences computed from the skeleton: "Imported by 3 components: a, b, c", "Imports server libraries: axum, tokio", "Has an executable entry", "Compiles to wasm", "Lives under tools/ (directory kind: tools)", "62% of its files are tests"), `responsibility`, `why`, `entry_points`, `evidence` (paths only), `loc`, `files`, the 8 heaviest dependencies and dependents (id, import count, responsibility), the 8 most-used externals, and 8 sample file paths. Lists are cut deterministically until the card is under 6,000 characters, so a large component sends the same card every run.

### Second pass

After the first round, every component whose `runtime`, `nature`, or `role` (role only when it applies) is `uncertain` or `unresolved` is asked those questions once more, with the same card plus `neighbor_facts`: its dependents and dependencies with their first-round runtime and nature, and a derived sentence counting its product importers. The second answer replaces the first unless it is worse (an `abstain` never displaces an uncertain value); those records and resolution entries carry `pass: 2`, and the first-round record is kept so both passes are cached. `summary.second_pass` lists the components re-asked.

## Definitions offered as criteria

| Question | Option | Description |
| --- | --- | --- |
| `runtime` | `server` | a long-lived service process |
| | `client` | a page or desktop app a person uses |
| | `shared` | a library compiled into more than one runtime |
| | `cli` | a command run by a person or a script |
| | `build` | runs only while building or developing |
| | `none` | not executable: content, docs |
| `nature` | `product` | runs as part of what users use, including the authoring tools designers operate |
| | `tooling` | build, dev stack, quality gates, asset pipelines |
| | `test` | harnesses, acceptance lanes, test support |
| | `content` | data and scripts the product loads |
| | `docs` | documentation and review evidence |
| | `experiment` | prototypes and spikes |
| `role` | `surface` | what a person or another system touches: UI, API handlers, CLI entry points, editor hosts |
| | `adapter` | I/O and engines: persistence, transport, rendering, filesystem, OS and browser APIs |
| | `core` | the system's own rules, models, sessions, workflows |
| | `kernel` | types, schemas, utilities every role shares |

Every Choice also offers `abstain` ("the state lacks the evidence to decide; do not guess"); `area` adds `build_verify` and `new_area`.

## Health checks

Checks run on production edges only; an edge that only test files create is never asked and never a finding. Both endpoints must be `product` with a resolved value for the attribute the check compares (roles for `core_uses_adapter`, runtimes for `crosses_the_wire`); an unresolved endpoint skips the edge. `cycle` and `product-uses-support` (product code importing `tooling`, `test`, or `experiment`) need no judgment: the builder reports them from the scan with `accepted` false.

## Thresholds

Choice answers (`area`, `runtime`, `nature`, `role`):

| Result | Status | On the card |
| --- | --- | --- |
| confidence ≥ 0.6 | `accepted` | value, no flag |
| 0.4 ≤ confidence < 0.6 | `uncertain` | value, flagged uncertain with the confidence |
| confidence < 0.4, `abstain`, or `new_area` | `unresolved` | no value; reason recorded |

Boolean checks: probability ≥ 0.6 accepted by design; ≤ 0.4 a finding; in between a finding flagged uncertain. Boolean `holds`: probability ≥ 0.6 carries the previous four answers forward under the new fingerprint (the record keeps `held_from`); anything lower asks all four again.

`decisions.json` exposes these as `resolution[component].{area,runtime,nature,role}` (`value`, `status`, `confidence`, `reason`) plus `role_applies`, and `edges[key]` (`from`, `to`, `check`, `accepted`, `flag`, `probability`; the key is `from->to`, suffixed `|check` when one edge answers both checks), so `build` applies no thresholds of its own.

`build` also flags answers the scan argues against with `contradicts-evidence`: a `tooling`, `test`, or `experiment` component that a product component imports in production code, or a `client`/`server` runtime whose only runtime libraries belong to the other family. The build summary lists them under `contradictions`; sharpen those cards (responsibility, entry points, the manifest evidence) and re-run `decide`.

`build` never stops on an unresolved attribute: an unresolved area lands the component in `Unsorted`; an unresolved runtime renders as `none`, nature as `product`, and role (product only) as `core`, each flagged `unresolved` on the card and listed in `map.unresolved`. Validation does stop when the answers leave an explicit area without a runnable (product code with an executable hint, or a `surface` role in a `client`, `server`, or `cli` runtime), when a flow names an endpoint that is not a runnable, an actor, or an external, or when an actor `uses` something that is neither a runnable nor an area; the error names the area, flow, or actor.

## When a node is unresolved

`summary.unresolved_nodes` lists each `{node, question, reason}`. For each one:

1. Add evidence to `draft.json` for that component: a sharper `responsibility`, the `why`, entry points, and paths to the README, ADR, or inventory line that names it. For `new_area`, revise the areas themselves: add the area the component belongs to, or sharpen a definition so it covers it. Runtime and nature rest mostly on the scan's hints; when they are unresolved, check the manifest the scan read (a missing `bin`, a dependency declared elsewhere) rather than the prose.
2. Run `decide` once more. Only the components whose cards changed are re-asked.
3. A node still unresolved after that stays unresolved and flagged. Do not assign it a value by hand.

## Caching and fingerprints

Every record carries a fingerprint: SHA-256 of the canonical JSON of `[question, INSTRUCTIONS_VERSION, state, criteria]`. On a run, a cached record with the same node, question, and fingerprint is reused without a call; anything else is asked. Because the state is exactly what Jev saw, the same code and draft yield the same answers on every machine and for every agent, and a change to one card re-asks only that component and the neighbours whose cards quote its responsibility. Within one component request each question is cached on its own: editing an area's name, definition, or expected members re-asks `area` for every component while `runtime`, `nature`, and `role` stay cached.

Records for nodes that no longer exist are dropped when the new file is written. The file is written atomically; a provider failure mid-run saves a `partial` cache with every answer obtained so far, and the next run continues from it (`build` refuses a partial cache).

Each record: `node`, `question`, `fingerprint`, `answer`, `probabilities`, `confidence`, `model`, `elapsed_seconds`, `cost_usd` (a batched request's cost split evenly across its questions), `instructions_version`, `decided_at`.

## Cost and latency

Measured today: about 0.5–1 s per request and well under a cent per call (a component card with the four Choices batched runs about 1,800 input tokens). A first run costs one call per component, one more per component the second pass re-asks, and one per checked edge; re-runs cost only what changed. Rate limits (HTTP 429), overloads (529), and timeouts retry with exponential backoff (2, 4, 8, 16, 32 s) before the run stops. `--dry-run` prints every request that would be sent, one JSON per line, without networking. `summary` reports `calls_made`, `calls_cached`, `areas` (proposed) and `areas_assigned` (components per answer, `build_verify` included), `runtimes`, `natures`, `findings` per check, and `total_cost_usd`.

## Errors and actions

Every error is a JSON `{"status":"error","error":"…"}` on stderr, never containing a key or a provider body. The run stops; there is no agent fallback for decisions.

| Error | Action |
| --- | --- |
| Gateway key is missing / empty / malformed | Set `AI_GATEWAY_API_KEY` for this process, or run the model-routing skill's `jev.py setup` (`python3 <model-routing skill dir>/scripts/jev.py setup`). |
| credential must be owned by you with mode 600 / storage must be a regular file | Delete `~/.furanku-skills/model-routing/secrets/gateway.json` and run the setup command again. |
| HTTP 400 or 422 | The request shape was rejected. Reproduce with `--dry-run` and report a codemap bug with that request. |
| HTTP 401 | The key was refused; save a valid key with the setup command. |
| HTTP 402 | The Gateway team is out of credits or over budget; top up, then rerun. |
| HTTP 403 | The key lacks Gateway access; check the team's Gateway settings. |
| HTTP 402/403 with `customer_verification_required` | The Vercel team needs a valid payment card before any request is served, including free credits. Complete billing verification, then rerun. |
| HTTP 429 or 529 after the backoff | Rerun in a few minutes; cached and partial answers are reused, so only the remaining questions are sent. |
| connection failed or timed out | Check network access to `ai-gateway.vercel.sh`; rerun. |
| Gateway returned invalid JSON / inconsistent distribution / unexpected model | Transient provider fault; rerun once, then report it. |
| Corrupt decisions cache | Delete `decisions.json` and rerun; every question is asked again. |
