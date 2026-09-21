# Suite Health

Read this reference when auditing or repairing flaky, slow, brittle, low-signal, or misleading tests; pruning a suite; choosing execution tiers; or interpreting test metrics.

## Use a portfolio of signals

No single metric proves test quality. Review:

| Signal | Question it should answer |
|---|---|
| Behavior inventory | Which important contracts and risks have evidence? |
| Coverage gaps | Which important code or branches are never exercised? |
| Mutation results | Which plausible faults survive the assertions? |
| Runtime and queue time | Which tests delay useful feedback? |
| Flakiness | Which tests disagree with themselves for unchanged code? |
| Diagnostic time | How long does a failure take to reproduce and localize? |
| Maintenance churn | Which tests change during behavior-preserving refactors? |
| Escaped defects | Which missing scenario, seam, or test level let the defect pass? |
| Run selection | Can one documented command run just the tests related to a change? |
| Run output | Does a run print only its summary and its failures? |

Use coverage to find absences, not to certify assertions or input selection. Inspect uncovered changed and critical behavior. Apply mutation testing selectively where a surviving change would alter a real decision; full mutation adequacy can cost more than the evidence is worth.

## Triage failures by source

Classify a failure before changing code:

1. **Product regression:** intended behavior broke; repair production code.
2. **Contract change:** intended behavior changed; update the contract and affected evidence together.
3. **Test defect:** oracle, fixture, or assumption is wrong; repair the test without losing the protected behavior.
4. **Environment defect:** dependency or harness is unhealthy; repair or clearly separate environment health.
5. **Nondeterminism:** test or product sometimes violates the same expectation; reproduce and remove the uncontrolled cause.

This classification keeps "make the build green" from deciding which source to edit.

## Drive out flakiness

Treat the first conflicting result as evidence to investigate. Capture seed, order, timing, resource load, participant versions, and artifacts. Repeat and shuffle to reproduce while preserving the original failure.

Common repair targets include:

- shared mutable fixtures or order dependence;
- wall-clock time, unseeded randomness, or locale;
- fixed sleeps and overloaded deadlines;
- unowned processes, ports, files, schemas, tenants, or queues;
- asynchronous work that outlives cleanup;
- remote availability or unknown dependency versions;
- real races or nondeterministic product behavior.

Retries can collect evidence or temporarily protect delivery. Keep the underlying flake visible, owned, and bounded by a repair or removal condition. Quarantine should remove noise from the critical path while retaining an explicit gap in confidence.

## Protect feedback speed

Put each test in the earliest execution tier where its decision value justifies its cost, with resource-heavy or shared checks at the release gate. [Running tests](running-tests.md) owns execution scope, timing, and output; this section reduces the cost of the tests selected.

Reduce cost by narrowing scope, isolating state for parallelism, reusing immutable build artifacts, and replacing guessed waits with readiness or completion conditions. Preserve real dependencies when their fidelity is the point of the test.

Track percentiles and outliers rather than only total time. A small set of slow or serial tests often controls the feedback loop.

## Keep tests resilient and relevant

Behavior-preserving refactors should leave contract tests valid. Frequent test churn during internal changes signals coupling to private structure or orchestration. Repair toward supported interfaces and observable state.

For every escaped defect, add evidence at the smallest scope with sufficient fidelity. Keep the broad regression too only when it protects another risk.

Keep fixtures, fakes, snapshots, contracts, migration baselines, and test infrastructure versioned and owned. Run shared contract examples against important fakes and real implementations where feasible.

## Prune low-signal tests

A test earns its place by failing for a defect a caller would care about that no cheaper test already catches. A suite that only grows is decaying: every low-signal test costs runtime, output, and maintenance on each change while adding no confidence.

| Kind | Tell |
|---|---|
| Tautological, edit-pinning, or trivial | As defined in `SKILL.md` steps 1 and 3. Common forms: asserting that a stub returns its configured value; a one-off check that was never removed. |
| Ad-hoc | One incidental scenario with no class behind it; it breaks when fixtures, copy, or structure change while behavior holds. |
| Superseded or duplicate | Another test fails for the same defects at equal or better fidelity and lower cost. |
| Obsolete | The protected behavior or compatibility promise was removed. |
| Rubber-stamped | A snapshot or golden output is regenerated on each change without review. |
| Insensitive | It passes when its named guarantee is deliberately violated. A surviving equivalent or unrelated mutation is insufficient evidence. |
| Unrecoverable | Its intent cannot be reconstructed from its name, body, or history. |

Apply the deletion check to each candidate:

1. Name the behavior, if any, the test was written for.
2. When callers rely on that behavior, find another test that fails for its defects at equal or better fidelity. When none exists, keep this test and rewrite it around the behavior; the check ends here for this candidate.
3. Delete the remaining candidates — behavior obsolete, or evidence held elsewhere — along with fixtures and helpers only they used, and record the reason and the replacement evidence.

A coverage drop after pruning is expected; judge the result by the behavior inventory.

## Audit completion

The suite audit is complete when:

- every critical behavior and integration seam maps to evidence or an explicit gap;
- flaky and quarantined tests have owners and next actions;
- slow tests have justified tiers or scoped improvement work;
- coverage and mutation findings lead to risk-based actions rather than target chasing;
- brittle tests have been repaired, every confirmed low-signal test is deleted or rewritten, and any left in place has a named blocker and next action;
- a documented related-tests command exists where the runner has a native mechanism, otherwise a concrete proposal is recorded; runs print only their summary and failures;
- failed commands, unavailable environments, and residual confidence gaps are reported.
