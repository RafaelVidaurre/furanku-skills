# Repository-aware codemap acceptance

Date: 2026-09-23. Work record: `furanku-skills-2cp.22.3`.

## Scope and isolation

The public fixture is
`skills/codemap/scripts/fixtures/project-types/web-service/`. It is a single
Python HTTP product, with domain and SQLite modules, an ordered middleware
pipeline, and an optional local Compose declaration. Its example draft proposes
one project and request/infrastructure views; it supplies no final decisions.

The contrasting example is an existing private game monorepo. Private source
contents, project cards and generated maps remain in
`/tmp/codemap-project-types/verification/`; this report contains only aggregate
findings and artifact references. The original repository and the user's codemap
store were read-only for this verification. This worker made no commit or push.

All pipeline commands use
`FURANKU_SKILLS_HOME=/tmp/codemap-project-types/verification/store`. Credentials
are loaded through the supported Jev client; no credential is copied into the
fixture, report or temporary scripts.

## Preparation evidence

- The fixture starts with the Python standard library and serves real HTTP.
  `/books` without the demo header returns 403; admitted `/books` returns 200
  with only the published title; an admitted unknown route returns 404. Each
  response includes the trace middleware header. Evidence:
  `/tmp/codemap-project-types/verification/fixture-http.json`.
- The fixture scan finds 3 Python files, 1 component, 1 module and 0 unresolved
  imports. Its draft has zero required-field gaps.
- A fresh game scan at commit `ed71b68f7e3cacadfb800e59c6191ccb4c6f25f0`
  finds 2,254 supported-language files, 54 components, 385 modules and 37
  unresolved imports. Component prose was inherited from the existing stored
  draft; project cards and view graphs were newly authored against current
  architecture, source, tool contracts and deployment declarations. The fresh
  skeleton introduces no component/edge gaps in that inherited draft.
- The game has source-backed fixed-step simulation, explicit repeat behavior,
  and ECS-flavored identity/state/system separation without a framework ECS
  scheduler. Current source establishes the tick cadence; an older ADR's timing
  was not reused. Independent authoring operations justify proposing a second
  project, with shared code membership left to Jev.
- Infrastructure views name declared local environments. They do not claim
  deployed services or use code imports as network traffic.

## Reproduction and artifacts

The fixture README contains the public scan → skeleton → draft → decide → build
commands. Store directories used by this run:

| Example | Temporary store |
| --- | --- |
| API | `/tmp/codemap-project-types/verification/store/codemap/web-service-a6bd77b2/` |
| Game | `/tmp/codemap-project-types/verification/store/codemap/ue-mmo-3b3218af/` |
| Synthetic landscape | `/tmp/codemap-project-types/verification/store/codemap/independent-projects-07fe46eb/` |

For the private repository, use its local root as `--repo` with the same command
sequence and temporary store. The private
`/tmp/codemap-project-types/verification/author_drafts.py` records the exact
source-backed proposal additions for this acceptance run. It is intentionally
not published because it contains private repository details.

## Live decision evidence

Live-call counts below are the successful evaluations reported by
`decide.summary.calls_made`; failed HTTP/backoff attempts are additional. Cache
counts are reused question records, not saved HTTP requests.

The API first run made 6 live Gateway calls and reused no cache. It accepted a
single web-service project and declared infrastructure, but rejected the request
proposal at `P(true)=0.39`. One grounded graph correction made middleware return
and trace-header paths explicit; its one new call returned `0.43`, still
uncertain. Both results were retained, and no accepted decision was authored.

This exposed an evidence-input gap: graph claims and file paths reached Jev,
but independent source contents did not. The pipeline owner added bounded,
fingerprinted `evidence_excerpts`. Supplying exact contiguous text from the
fixture's three source files then made 5 live calls and reused 4 question records:
the unchanged corrected request graph was accepted at `0.76`, infrastructure at
`0.68`, with no uncertain nodes or provider failures. Decision criteria and
thresholds were unchanged. The public example draft includes those excerpts.

The game first run made 106 live calls and reused no cache. One component call
returned HTTP 503; no provider fallback was used. The map built with explicit
unresolved diagnostics, but repository shape and all three specialist views
remained unresolved, uncertain or rejected. The authorized exact-source evidence
pass then made 48 live calls and reused 218 question records: game loop was
accepted at `0.65` and ECS at `0.68`. Repository shape remains unresolved at
`0.27`, authoring kind unresolved at `0.28`, and infrastructure uncertain at
`0.52`; none was forced into an accepted value. The same component received a
fresh HTTP 503 during the second run. Inspection confirmed it has no cached
question records, so this is a repeated provider failure, not a cache defect.
No accepted records were invalidated and no further retry was forced.
Two component attributes also remain uncertain because their area/nature
boundaries overlap; those badges are preserved.

Since the private repository did not establish a landscape, a clearly synthetic
temporary collection colocates the executable API and an independent Go
simulation. They share no code, state or runtime communication. The Go program
was executed and printed positions `0.02`, `0.04`, `0.06` at its three fixed
steps. The pipeline finds the API component and tracks the Go source as evidence
without pretending to parse its imports. Live Jev made 8 calls, accepted the
landscape at `0.98`, accepted both projects and all three proposed views, and
reported no uncertainty or provider failure. The simulation project honestly
has zero parsed components. This supplements, rather than replaces, the real
game verification.

Final cache replays for the API and synthetic collection made **zero live
calls**, reusing 9 and 11 question records respectively. Cache counts refer to
question records, not saved HTTP requests.

Relevant logs are `api-decide.log`, `api-decide-evidence-pass.log`,
`api-decide-excerpts.log`, `api-decide-final-cached.log`, `game-decide.log` and
`game-decide-excerpts.log` under the temporary verification directory. The
pre-excerpt decisions are preserved as `api-decisions-before-excerpts.json` and
`game-decisions-before-excerpts.json`. The synthetic fixture, proposal authoring
script, execution log and pipeline logs are `independent-projects/`,
`author_independent.py`, `simulation-execution.log` and `independent-*.log` in the
same temporary directory; they contain no private game material.

## Browser acceptance

Initial checks used real Chrome through browser-harness. Another concurrent
session changed the shared attachment, so mismatched captures were discarded.
A named local connection requested Chrome debugging approval, but its approval
helper returned `not-found`. The coordinator explicitly approved an isolated
Chrome instance through the installed Playwright library; this changed the
acceptance mechanism instead of emulating the failed helper. Final evidence
uses real Chrome `153.0.8010.53`, a fresh context, and a 1440 × 1000 viewport.

Eleven focused outcomes passed with zero browser page errors:

- A single product opens directly on Purpose, with no landscape level and no
  empty Ships in or Contracts selector.
- The admitted/rejected API request branches render in both themes. First click
  opens the middleware evidence card; its source link and Enter reach component
  modules, preserving project context through Back and Forward.
- Infrastructure names the declared environment, disclaims live deployment,
  and limits its legend to the displayed network/file relationships.
- The synthetic landscape opens by default. First click shows a project card;
  its Open button or Enter reaches a project. The Go project explains absent
  source parsing and still opens its accepted behavior view.
- The real game loop renders its repeat edge and supports card-to-source
  navigation. Its ECS view states the actual identity/data/system discipline
  without inventing framework scheduling.
- Seven accepted shared components remain available in both game project
  scopes. Unknown view IDs safely return to a valid picture.
- Normal zoom and horizontal pan expose a readable request branch and evidence
  card; the verified zoomed node is about 250 pixels wide.

`browser-acceptance.json` records the outcomes. `browser_acceptance.py` is the
reproducible complete journey script; the observed run completed its first API
checks, then resumed remaining cases through `browser_remaining.py` and
`browser_game.py` after correcting test timing and an accessible-name selector.
`browser_zoom.py` covers normal zoom/pan. These temporary scripts use real
rendered pages and preserve the generated decisions; no fake map is substituted.

Representative screenshots were opened and visually inspected. All files below
are under `/tmp/codemap-project-types/verification/`; private game screenshots
remain local and are not embedded in this public report.

| Behavior | Screenshots |
| --- | --- |
| Single product | `api-single-light.png`, `api-single-dark.png` |
| Request branch and evidence | `api-request-light.png`, `api-request-dark.png`, `api-request-auth-card.png`, `api-request-zoomed.png` |
| Declared infrastructure | `api-infrastructure-light.png`, `api-infrastructure-dark.png`, `api-infrastructure-dark-card.png` |
| Landscape and projects | `landscape-light.png`, `landscape-dark.png`, `landscape-project-card.png`, `landscape-api-project.png`, `landscape-unparsed-go-project.png`, `landscape-go-loop.png` |
| Real loop and ECS | `game-loop-light.png`, `game-loop-dark.png`, `game-loop-card.png`, `game-ecs-light.png`, `game-ecs-dark.png` |
| Source navigation | `api-source-component.png`, `game-source-component.png` |
| Unresolved judgments | `game-root-uncertainty.png`, `game-project-kind-uncertainty.png` |

The isolated Chrome processes were closed. The named browser-harness startup
later completed; its daemon was stopped with the supported named `--reload`
command. The shared tab was retained because another session had reused it.

## Approved diagnostic repair and validation

Browser acceptance exposed a real omission: an unresolved repository shape
correctly fell back to Purpose but the start page did not explain why. The
coordinator expanded this assignment to add a small diagnostic helper in
`viewer.html`, show the repository notice only on the combined system page, and
show uncertain primary kinds in project cards/pages while retaining the generic
kind. The rebuilt real game map visibly confirms both notices. The root README
codemap paragraph was also updated under explicit coordinator direction.

Validation after the executable change:

- `python3 -m pytest skills/codemap/scripts/test_viewer.py -q`: **16 passed**,
  including the new status/scope/legacy diagnostic regression through the
  existing Node harness.
- `npm test`: **passed**, including **347 Python tests and 89 subtests**;
  output is preserved in `npm-test.log`.
- All three temporary maps rebuilt successfully; browser checks of the real
  game used the rebuilt template. `git diff --check` passed.

## Remaining limits and unmet conditions

- The real game did **not** establish a repository landscape or primary
  authoring kind. Its generic picture and explicit diagnostics are the honest
  outcome; live landscape acceptance is supplied by the independent synthetic
  collection.
- The game's declared-infrastructure proposal remains uncertain and is omitted.
  Accepted infrastructure browser evidence comes from the API fixture.
- One real-game component still lacks classification because the provider
  returned HTTP 503 on both runs. Provider recovery remains incomplete for that
  component; successful views and unrelated decisions are retained, and the
  unresolved component is visible.
- Two real-game component attributes remain ambiguous after their evidence
  review. Their badges remain visible. The fresh scan has 37 unresolved imports
  and 28,279 tracked files outside supported-language import parsing; these are
  disclosed coverage limits, not inferred imports.
- The generic graph renderer fits long chains horizontally. Request and game
  loop overview labels can be very small at this viewport; zoom/pan and evidence
  cards are required for comfortable reading. The zoomed request capture proves
  those controls work; no source graph was simplified to conceal the tradeoff.
- Browser-harness did not complete the entire final acceptance due to shared
  attachment/approval issues. The coordinator-approved isolated Chrome change
  and all resulting evidence are recorded above.
