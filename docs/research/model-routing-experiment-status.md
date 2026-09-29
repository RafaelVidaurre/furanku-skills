# Model-routing research: working status

## Objective

Learn which model and effort provides useful quality for its total resource cost
in each work domain. Historical grades are observations, not calibrated model
rankings or permission to replace routing policy.

## Canonical working locations

- Experiment branch: `model-routing-evidence` (dedicated Orca worktree).
- Preserved research baseline: `7393041`; also on `model-routing-states`.
- Production baseline integrated: fetched `origin/main` at `4e86f7d`.
- Private evidence: machine-global model-routing `retrospectives/` directory.
  Native transcripts, source identifiers and private paths stay outside this repo.
- Research tracker: `furanku-skills-b5k`.

Run experiment commands from this branch, using its scripts explicitly. The
installed skills serve ordinary work. Publishing a research report does not
install the experimental skill or activate learned routing tables.

## Preservation check

The installed crew and model-routing tracked files matched the production
baseline: 8 crew files and 17 model-routing files. The experiment checkout was
clean at its research baseline. All 43 files referenced by the reviewed evidence
passed their recorded SHA-256 checks. The Luna recovery and prospective study
bundles were also present; presence alone is not a new validation of those bundles.

The research branch now includes the fetched production baseline. Research-only
files remain experimental; their absence from the install is not loss of research.
Future production changes still need reconciliation before a release. This merge
updates the research checkout only; it does not authorize installing the
experimental retrospective feature.

## What is established

See [the complete provisional ratings](provisional-model-ratings-2026-09-29.md).

- 16 reviewed sessions represent 14 original tasks.
- 23 model/effort/domain cells have descriptive ratings, with only 1–2 tasks each.
- Continuations, scope changes, original completion and corrections stay visible.
- Completed assessments are reused; aggregation requires no assessor call.
- No calibrated model ranking or cost-quality comparison has been established.
- New outcome fields have structural tests and manual source review; fresh
  automated scoring of those fields has not been validated.
- The prospective Luna/Sol study is prepared only: zero enrolled assignments,
  no collector, no background experiment.

## Next bounded work

1. **Completed:** integrated production through `4e86f7d`, retaining research
   modules and production ownership, launch, recovery and routing guidance.
   Verification is recorded below; installed skills remain untouched.
2. **Next:** validate the new scorer contract against frozen controls with known outcomes:
   original goal met, narrowed goal, worker correction, external blocker and
   insufficient evidence. Reuse existing controls where their evidence supports
   the distinction. First run the mechanical checks without assessor calls.
   Completion: explicit expected judgments and failure criteria recorded before
   any model run, plus an input/output budget for a bounded scorer trial.
3. Use the trial to decide whether more scoring is justified. Record scorer
   mistakes separately from the historical worker's mistakes. Reuse completed
   historical assessments; do not run another broad archive pass.
   Completion: a go/no-go verdict with examples and measured usage.
4. Once judging is trustworthy, collect comparable ordinary work for a specific
   routing choice, starting with the prepared Luna/Sol comparison if still
   applicable to current configuration. Enrollment must be explicit and visible.
   Completion: a specific decision supported by comparable outcomes and costs,
   or a clear statement of the remaining missing evidence.

## Experiment record requirement

Each run records its question, code commit, frozen inputs, expected outcomes,
budget, actual usage, results, limitations and resulting decision. Keep one
canonical private run directory and link a public sanitized report here. A run
that does not change a decision or test a stated failure mode needs a better
question before spending tokens.

## Integration verification

The merge preserved the stricter research explicit-request checks, configuration
preview before writes, routing journal links, opt-in Jev abstention and assessment
modules. It adopted current production task judgment and quota-cost guidance,
Luna task preferences, Crew launch arguments, exact packet export, supported
principals, startup recovery and lifecycle procedures. Beads retains all four
unique issue records, including the research epics and production Crew outcome.

Related checks passed: 145 routing/configuration/selector/journal/assessment/
inventory/sampling tests; 57 Crew assignment tests; 10 Node skill-format tests.
Python tests used the standard-library unittest runner with isolated home
configuration. The repository has no dependency-aware related-test command;
selection used module dependencies and existing test boundaries. A future wrapper
would need to account for subprocess and catalog-file dependencies as well as
imports. Unchanged codemap internals and the full release suite were not rerun.

All 43 referenced evidence artifacts still match their saved hashes. Installed
Crew and model-routing still match the 8 and 17 tracked production files. No new
assessor calls, production installation, routing configuration change or background
study launch occurred during integration.
