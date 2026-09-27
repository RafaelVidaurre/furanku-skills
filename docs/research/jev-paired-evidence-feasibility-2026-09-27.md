# JEV paired evidence feasibility — 2026-09-27

## Decision

**Useful historical quality scoring remains unproven.** Both arms of a new
six-task experiment failed the criteria frozen before evaluation. Source-checked
evidence made evaluation cheaper and improved required-domain recall, but yielded
only one of eight expected quality observations. Keep bulk scoring, learned
routing-table updates, and installation of this experimental branch paused.

The next priority is a bounded experiment grading an explicitly identified
requested deliverable against its requirements. Further retrieval refinement or
repair-burden tuning has less immediate value: we first need evidence that the
judge and rubric can distinguish useful, defective, and unobservable work.

This changes the next experiment, not earlier acceptance criteria. The
[original native failures](jev-native-heldout-validation-2026-09-26.md) and
[development results](jev-restored-access-development-2026-09-27.md) remain failures
under their original criteria. Repair burden was recorded separately and was not
a criterion in this new prospective experiment.

## Frozen comparison

- Six fresh, independently source-audited Claude and Codex tasks: four completed
  tasks and two without an assessable completed outcome. Eight numeric reference
  cells and five reference-null cells span multiple domains.
- Automatic arm: complete parsed task turns through production `assess_task`.
- Source-checked arm: focused verbatim turns/excerpts and resolved source-contract
  linkage through the same questions, taxonomy, thresholds, and gates. Evidence
  is explicitly identified as a subset. References and audit conclusions were
  not sent to JEV; source/turn equality and excerpt spans were checked first.
- Task grouping was fixed independently. This does **not** test native discovery
  or segmentation, and manual linkage means it is not a pure packet-size test.
- Each frozen case ran once per arm. No outcome-driven rerolls, reference changes,
  prompt tuning, or threshold changes were allowed. Actual JEV calls used the
  shared client. No provider-access or rate-limit failures occurred.
- Minimum domain recall and precision: 80% each. Minimum accepted positive
  quality coverage: 75%. Unsupported, out-of-range, and unjudged accepted scores
  must all be zero. Unknown positive scores count as missing.

The evaluation used commit `e3f16ae95b88105bc4f5390cf07ebbc02646aecf`.
Private artifacts retain every request, response, source anchor, domain row,
and code hash. Frozen protocol SHA-256:
`818cec6cf0da4c51c6531a2d4c93485892264c9e52a369602e247d9b38cf31df`.
Frozen cases SHA-256:
`c700ad1d3a304e0df4e8573bf0d12ee651b0fe78b23a07450faecd9ca367e217`.

An independent review initially alleged a defect in a numerical review using a
counterexample that overlooked a paired minimum in the algorithm. We caught and
corrected that reference before freezing and before any evaluation calls. There
is consequently no established poor-quality control in this experiment; every
numeric reference range includes level 3. It cannot demonstrate good-versus-poor
discrimination.

## Results

| Metric | Automatic | Source-checked | Required |
| --- | ---: | ---: | ---: |
| Required domains found | 7/11 (63.6%) | 9/11 (81.8%) | ≥80% |
| Domain precision within allowed scope | 9/15 (60.0%) | 11/19 (57.9%) | ≥80% |
| Accepted positive quality cells | 0/8 (0%) | 1/8 (12.5%) | ≥75% |
| Unsupported/out-of-range/unjudged accepted scores | 0 | 0 | 0 |
| Exact case comparisons passing | 0/6 | 0/6 | Diagnostic |
| New validated evaluation calls | 169 | 24 | Diagnostic |
| Cache hits | 0 | 4 | Diagnostic |

There are 193 validated cached responses, all reporting one attempt. Their
reported cost totals approximately $0.072 and 1,712,933 input tokens. Invalid
responses are not cached or included in the evaluator's validated-call count;
these are **not complete billing or HTTP-attempt totals**.

### Per-task reference-domain quality

Task names below are generic. Unknown means no accepted quality observation,
not zero quality. Scale: 0 unusable, 1 major defects, 2 partly usable,
3 main requirements demonstrated, 4 substantively exceeds requirements.

| Task | Recorded model / effort | Domain | Reference | Automatic | Source-checked |
| --- | --- | --- | --- | --- | --- |
| Requirements capture | GPT-5.6 Terra / max | Product planning | 2–3 | Unknown | 3 |
| Requirements capture | GPT-5.6 Terra / max | Technical documentation | 2–3 | Unknown | Unknown |
| Requirements capture | GPT-5.6 Terra / max | Testing and code review | 3 | Unknown | Unknown |
| Provenance review | GPT-5.6 Terra / max | Testing and code review | 3 | Unknown | Unknown |
| Numerical review | Claude Opus 5.5 / high | Testing and code review | 2–3 | Unknown | Unknown |
| Numerical review | Claude Opus 5.5 / high | Scientific and mathematical reasoning | 2–3 | Unknown | Unknown |
| Source reconciliation | GPT-5.6 Terra / max | Deployment and operations | 3 | Unknown | Unknown |
| Source reconciliation | GPT-5.6 Terra / max | Testing and code review | 3 | Unknown | Unknown |
| Incomplete acceptance review | GPT-5.6 Terra / max | Testing and code review | Unknown | Unknown¹ | Unknown |
| Incomplete acceptance review | GPT-5.6 Terra / max | Deployment and operations | Unknown | Unknown | Unknown |
| Incomplete acceptance review | GPT-5.6 Terra / max | Security and privacy | Unknown | Unknown | Unknown |
| Access-timeout review | GPT-6 Astra / high | Testing and code review | Unknown | Unknown | Unknown |
| Access-timeout review | GPT-6 Astra / high | Security and privacy | Unknown | Unknown | Unknown |

¹ This automatic result includes a client validation failure, not a successful
semantic abstention. The client incorrectly rejected a tied Choice because
`0.27999999999999997 < 0.28`. A subsequent patch tolerates floating-point noise
within 1e-12 while still rejecting genuinely lower-probability choices. Its
regression test passes; the frozen experiment has not been rerun or rewritten.

The private CSV contains all 252 task/domain/arm cells, including raw estimates,
labels, and exclusions, rather than only the reference domains shown here.

## What the diagnosis supports

1. **Evidence preparation helps, but is insufficient.** Every supplied focused
   evidence packet fit in the source-checked arm without retrieval loss. This
   rules out retrieval loss as the sole explanation for that arm's low coverage.
   It does not establish that the focused excerpts contain every useful fact.
2. **The requested deliverable can be mistaken for an outcome claim.** In the
   numerical review, `claim` wins the evidence category with probability 0.43
   for science, triggering an unconditional `no_observed_outcome` veto even
   though assessability is 0.86. The review report is itself the requested
   artifact. A report can be inspected as a deliverable without treating its
   claims about the underlying system as verified facts.
3. **Other exclusions come from provisional thresholds.** Review assessability
   of 0.81/0.84 misses 0.85; provenance-review support of 0.69 misses 0.75.
   These explain exclusions, but do not justify lowering thresholds until
   examples pass. The probabilities and thresholds need calibration.
4. **Domain precision remains poor.** Better evidence increased recall but added
   unexpected labels. Mixing requested activity (review/debugging) with subject
   matter (science/animation/security) is a plausible source of confusion.
   Evaluate that hypothesis separately from changing quality questions.
5. **Zero bad accepted scores is weak reassurance at near-zero coverage.** One
   negative cell failed execution. Neither rejection counts nor the single
   accepted score establish sound calibration.

An Astra adversarial review independently agreed with this interpretation and
recommended the deliverable-grading experiment next. This small, selected sample
does not prove that JEV is inherently unsuitable, that another judge is better,
or that any model/effort deserves a routing-score change. Visual quality, repair
accuracy, population accuracy, and model rankings remain unvalidated.

## Next experiment and stopping rule

Use a small, explicitly identified deliverable and its requirements as the
assessment unit. Separate grading the requested review report from believing
every claim in that report. Retain source-backed negative evidence and an
unknown option for missing or unverifiable outcomes.

First establish independently audited good, genuinely defective, and
missing-artifact controls. On development controls, compare the current funnel
with deliverable-relative grading using the actual JEV client. Classify domains
separately so label mistakes do not conceal whether grading works. Evaluate
both accepted-score accuracy and positive coverage; do not optimize one by
silently sacrificing the other.

Freeze the resulting questions, gates, references, and success criteria before
testing untouched cases. If the simpler grading unit still cannot distinguish
these controls with useful coverage, stop adding pipeline machinery and revisit
the evaluator choice or the retrospective's scope. If it succeeds, validate
native evidence construction and task segmentation separately before scaling.

This is a proposed next experiment, not a completed result. The installed skill
and routing tables were not changed by this trial.
