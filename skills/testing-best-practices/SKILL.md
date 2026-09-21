---
name: testing-best-practices
description: Guides writing, running, reviewing, and pruning automated tests so each test is risk-proportionate evidence of general behavior and each run covers only what changed. Use when writing or reviewing automated tests, deciding whether a change needs a test, choosing test scope or doubles, deciding which tests to run after a change, repairing brittle, flaky, slow, noisy, or misleading tests, or auditing a suite's low-signal tests, metrics, execution tiers, or related-tests command.
license: MIT
metadata:
  author: rafaelvidaurre
---

# Testing Best Practices

Treat every test as **evidence** for a behavior that matters, and run only the tests whose evidence a change can invalidate. Match the repository's language, framework, commands, naming, and development methodology. Choose test scope and technique from the risk and confidence needed, not from a universal test doctrine.

## 1. Frame the evidence

Inspect the change, its requirements, nearby tests, repository guidance, and available test commands. State:

- the behavior or contract that matters, as a rule that holds across a class of inputs or states;
- the production behavior that turns the given state into the outcome;
- the regression or failure the test should detect;
- the observable outcome that distinguishes correct from incorrect behavior;
- the boundary at which that outcome can be controlled and observed.

For a defect, preserve the smallest input that reproduces it. For new behavior, derive expectations from the requirement or caller contract rather than from the implementation.

Some changes need no new test. The code is **trivial**: a test could only recheck what the language, framework, a dependency, the compiler, or the type checker already guarantees, as with pass-through accessors and constants. Application mapping, serialization, wiring, and compatibility contracts are evidence worth keeping even when the code is straight-line. Or an existing test already fails for the target defect. Or the change is an edit to content — an asset, copy, data, a setting — with no rule behind it, which a **one-off check** verifies (step 3). Record that outcome with its reason and continue at step 5 with the existing related tests.

**Complete when:** the intended evidence fits the sentence "Given `<class of state>`, when `<action>`, then `<observable outcome>`," the production behavior and the target failure are named — or the no-new-test outcome is recorded with its reason.

## 2. Choose the smallest credible test

Select the least expensive scope that can still fail for the target defect:

| Risk being tested | Candidate evidence |
|---|---|
| Local decision, transformation, or invariant | Narrow in-process test |
| Mapping, serialization, storage, filesystem, process, or runtime wiring | Boundary or integration test |
| Independently versioned request, response, or message | Compatibility or contract test |
| Deployment configuration or emergent multi-component behavior | Focused system or journey test |

These are candidates, not mandatory layers. Record which collaborators are real, replaced, or out of scope and what confidence is lost by each substitution. When the behavior crosses a process, datastore, network, API, queue, file format, configuration, migration, or third-party boundary, read [Integration tests](references/integration-tests.md) before implementing.

**Complete when:** every included participant is necessary to the evidence, every omitted participant is irrelevant or covered elsewhere, and any fidelity gap is explicit.

## 3. Select cases by risk

Choose cases that add distinct evidence: a representative ordinary case, meaningful input partitions and boundaries, specified failures, important state transitions, past regressions, and domain invariants. Use only the categories that change the risk for this behavior.

Every case exercises the rule from step 1 through a representative of its class. Two shapes fail that bar whatever the material — text, pixels, records, markup, configuration:

- A **tautological** case asserts what its setup supplied, with no production behavior in between whose failure could change the assertion. It passes whatever the system does.
- An **edit-pinning** case copies its expectation from the current artifact or diff: the pixel just recoloured has that colour, the file contains the line just added, the setting equals its new value. It restates the edit, detects no defect in any system, and fails on the next legitimate edit. Exact-content assertions stay valid when a requirement stated independently of the edit demands that content — a compatibility format, a published contract, a reviewed golden output.

Reframe either around the behavior that produces the outcome — "an overdue invoice shows the late-fee line" rather than "the fixture just given a line contains that line"; "resizing preserves transparency for any image with an alpha channel" rather than "pixel (3,4) of the logo is red" — or keep it out of the suite.

Confirming that an edit took effect is legitimate work for a **one-off check**: a scratch script, temporary test, or manual inspection that you run, read, and remove. One-off checks leave the repository once they have served their purpose; only tests of a durable rule are committed.

When case selection, expected results, property-based testing, or test doubles require judgment, read [Test design](references/test-design.md).

**Complete when:** each case names a unique contract distinction or failure risk and the production behavior it exercises; removing it would remove evidence rather than just a row.

## 4. Make the test trustworthy

Write the test so its behavior is obvious from its name and body:

- keep the decisive setup, action, and expected outcome visible;
- assert caller-observable results and contract-relevant side effects, leaving incidental values and structure unasserted;
- derive expected values independently with simple, inspectable test logic;
- control time, randomness, concurrency, global state, environment, and external resources;
- give each test fresh or isolated mutable state;
- stay silent on pass; on failure print the broken guarantee, expected, actual, and relevant inputs, bounded in size;
- use local helpers only where they remove irrelevant detail without hiding causality.

One coherent behavior may need several assertions. Split when causes or outcomes are independent, not to satisfy an assertion count.

**Complete when:** the test is repeatable alone and with the suite, survives behavior-preserving refactors, and a failure explains which guarantee broke without surrounding noise.

## 5. Challenge the signal

Run the new or changed tests and the tests **related** to the change, through the project's related-tests command where one exists and with the runner's leanest failure-preserving output. A pass stays valid until something the test executes, reads, or is configured by changes: after each further edit, re-run only what that edit can affect.

The full suite is a release gate. Run it only when the user explicitly asks for it or as the final check before a production release; at every other point, related tests are the completion evidence.

Read [Running tests](references/running-tests.md) when the change touches anything beyond one unit and its own tests, the project has no related-tests command, the related set is the whole suite, or runs are slow or noisy.

Establish that the test is sensitive to its target defect using the safest available evidence: an observed pre-fix failure, a reversible perturbation, a useful mutation result, or a causal review showing the assertion cannot pass when the behavior is absent.

Classify unexpected results before editing:

- product behavior regressed;
- intended contract changed;
- test or environment is wrong or nondeterministic.

Update the source that is wrong while preserving the intended contract evidence. Report commands run, the scope left unrun, and checks that could not be executed.

**Complete when:** any new or changed test passes against intended behavior with credible sensitivity to its target failure; every executed test was justified by a changed input, an explicit full-suite request, the release gate, or a scoped nondeterminism investigation; and the related tests have no unexplained result or are reported as unverified.

## 6. Leave the suite healthier

Keep tests close to the behavior they protect and fast enough for their execution tier. Move a broad regression to a narrower test when the narrower test provides equal fidelity; retain broader coverage when it protects an additional integration or deployment risk.

In the same change, delete tests in the area you touched that have gone **low-signal**: superseded by the new test, obsolete with removed behavior, tautological, edit-pinning, trivial, or duplicating evidence held elsewhere — including one-off checks an earlier change left behind. Apply the deletion check in [Suite health](references/suite-health.md#prune-low-signal-tests) to each, and report each deletion with its reason.

When reviewing suite quality, diagnosing flakes, choosing metrics, changing execution tiers, or pruning beyond the touched area, read [Suite health](references/suite-health.md).

**Complete when:** the change adds no unexplained flakiness, hidden shared state, unnecessary scope, or duplicate evidence; every one-off check created for this work is removed; every confirmed low-signal test met in the touched area is deleted or rewritten around its behavior, and any left in place has a named blocker and next action; and any remaining trade-off is documented.

## Decision standard

Prefer the option that gives the strongest relevant confidence for the lowest feedback, maintenance, and output cost. Use project conventions and domain risk to resolve real trade-offs. Fixed coverage targets, test ratios, test-first sequencing, isolation styles, and doubling styles remain local policy choices rather than defaults supplied by this skill.

For the primary-source rationale behind these rules, read [Evidence base](references/evidence-base.md) when adapting the guidance or resolving a disputed practice.
