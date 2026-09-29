# Repository-aware codemap acceptance

Date: 2026-09-23. Work record: `furanku-skills-2cp.22.3`.

## Scope and isolation

The public fixture is
`skills/codemap/scripts/fixtures/project-types/web-service/`. It is a single
Python HTTP product, with domain and SQLite modules, an ordered middleware
pipeline, and an optional local Compose declaration. Its example draft proposes
one project and request/infrastructure views; it supplies no final decisions.

A private repository also supplied acceptance evidence. Its identity, revision,
structure, architecture, judgments and artifact locations are withheld from this
public report. The original repository and the user's codemap store were
read-only for verification. This worker made no commit or push.

All pipeline commands use
`FURANKU_SKILLS_HOME=/tmp/codemap-project-types/verification/store`. Credentials
are loaded through the supported Jev client; no credential is copied into the
fixture, report or temporary scripts.

## Public preparation evidence

- The fixture starts with the Python standard library and serves real HTTP.
  `/books` without the demo header returns 403; admitted `/books` returns 200
  with only the published title; an admitted unknown route returns 404. Each
  response includes the trace middleware header. Evidence:
  `/tmp/codemap-project-types/verification/fixture-http.json`.
- The fixture scan finds 3 Python files, 1 component, 1 module and 0 unresolved
  imports. Its draft has zero required-field gaps.
- Infrastructure views name declared local environments. They do not claim
  deployed services or use code imports as network traffic.

## Public reproduction and artifacts

The fixture README contains the public scan → skeleton → draft → decide → build
commands. Public example stores used by this run:

| Example | Temporary store |
| --- | --- |
| API | `/tmp/codemap-project-types/verification/store/codemap/web-service-a6bd77b2/` |
| Synthetic landscape | `/tmp/codemap-project-types/verification/store/codemap/independent-projects-07fe46eb/` |

Private proposals and reproduction artifacts are intentionally omitted.

## Public live decision evidence

Live-call counts below are successful evaluations reported by
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

A clearly synthetic temporary collection colocates the executable API and an
independent Go simulation. They share no code, state or runtime communication.
The Go program was executed and printed positions `0.02`, `0.04`, `0.06` at
its three fixed steps. The pipeline finds the API component and tracks the Go
source as evidence without pretending to parse its imports. Live Jev made 8
calls, accepted the landscape at `0.98`, accepted both projects and all three
proposed views, and reported no uncertainty or provider failure. The simulation
project honestly has zero parsed components. This supplies public landscape
acceptance evidence.

Final cache replays for the API and synthetic collection made **zero live
calls**, reusing 9 and 11 question records respectively.

Relevant public logs are `api-decide.log`, `api-decide-evidence-pass.log`,
`api-decide-excerpts.log` and `api-decide-final-cached.log` under the temporary
verification directory. Pre-excerpt API decisions are preserved as
`api-decisions-before-excerpts.json`. Synthetic artifacts are
`independent-projects/`, `author_independent.py`, `simulation-execution.log`
and `independent-*.log` in the same directory; they contain no private
repository material.

## Browser acceptance

Initial checks used real Chrome through browser-harness. Another concurrent
session changed the shared attachment, so mismatched captures were discarded.
A named local connection requested Chrome debugging approval, but its approval
helper returned `not-found`. The coordinator explicitly approved an isolated
Chrome instance through the installed Playwright library; this changed the
acceptance mechanism instead of emulating the failed helper. Final evidence
uses real Chrome `153.0.8010.53`, a fresh context, and a 1440 × 1000 viewport.

Public fixture and synthetic collection outcomes include:

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
- Normal zoom and horizontal pan expose a readable request branch and evidence
  card; the verified zoomed node is about 250 pixels wide.

`browser-acceptance.json` records the historical outcomes.
`browser_acceptance.py` began the journey; remaining public checks resumed
through `browser_remaining.py` after correcting test timing and an
accessible-name selector. `browser_zoom.py` covers normal zoom/pan. These
temporary scripts use real rendered pages and preserve generated decisions.
Private journey details are omitted.

Representative screenshots were opened and visually inspected. Public example
files below are under `/tmp/codemap-project-types/verification/`; private
screenshots are not listed or embedded.

| Behavior | Screenshots |
| --- | --- |
| Single product | `api-single-light.png`, `api-single-dark.png` |
| Request branch and evidence | `api-request-light.png`, `api-request-dark.png`, `api-request-auth-card.png`, `api-request-zoomed.png` |
| Declared infrastructure | `api-infrastructure-light.png`, `api-infrastructure-dark.png`, `api-infrastructure-dark-card.png` |
| Landscape and projects | `landscape-light.png`, `landscape-dark.png`, `landscape-project-card.png`, `landscape-api-project.png`, `landscape-unparsed-go-project.png`, `landscape-go-loop.png` |
| Source navigation | `api-source-component.png` |

The isolated Chrome processes were closed. The named browser-harness startup
later completed; its daemon was stopped with the supported named `--reload`
command. The shared tab was retained because another session had reused it.

## Diagnostic repair and historical validation

Browser acceptance exposed an omission: an unresolved repository shape fell
back to Purpose without explaining why. The coordinator expanded the assignment
to add a diagnostic helper in `viewer.html`, show the repository notice only
on the combined system page, and show uncertain primary kinds in project
cards/pages while retaining the generic kind. Private acceptance details are
omitted. The root README codemap paragraph was also updated under explicit
coordinator direction.

Historical validation after that executable change:

- `python3 -m pytest skills/codemap/scripts/test_viewer.py -q`: **16 passed**,
  including status/scope/legacy diagnostic regression through the Node harness.
- `npm test`: **passed**, including **347 Python tests and 89 subtests**;
  output is preserved in `npm-test.log`.
- `git diff --check` passed.

## Remaining limits

Private acceptance outcomes and coverage limits are retained privately.
Public landscape evidence comes from the synthetic collection; public
infrastructure evidence comes from the API fixture.

The generic graph renderer fits long chains horizontally. Request overview
labels can be very small at this viewport; zoom/pan and evidence cards are
required for comfortable reading. The zoomed request capture proves those
controls work; no source graph was simplified to conceal the tradeoff.

Browser-harness did not complete the entire final acceptance due to shared
attachment/approval issues. The coordinator-approved isolated Chrome change
and public evidence are recorded above.
