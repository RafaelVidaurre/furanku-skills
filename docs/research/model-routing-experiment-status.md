# Model-routing research: working status

## Objective

Learn which model and effort provides useful quality for its total resource cost
in each work domain. Historical grades are observations, not calibrated model
rankings or permission to replace routing policy.

## Canonical working locations

- Experiment branch: `model-routing-evidence` (dedicated Orca worktree).
- Preserved research baseline: `7393041`; also on `model-routing-states`.
- Production baseline checked here: `main` at `4e86f7d`.
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

Production and research have diverged. Research-only files absent from production
remain on the experiment branch; their absence from the install is not loss of
research. Reconcile production changes in this worktree before a future release.
A wholesale install of this older research branch would risk replacing newer
production behavior.

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

1. Reconcile the newer production crew/routing changes into this experiment
   branch, preserving the research modules and the installed behavior's fixes.
   Resolve conflicts by contract and verify affected routing and assessment tests.
   Completion: a reviewed integration commit; installed skills remain untouched.
2. Validate the new scorer contract against frozen controls with known outcomes:
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

This checkpoint performed preservation checks only: no new assessor calls,
production installation, routing configuration change or background study launch.
