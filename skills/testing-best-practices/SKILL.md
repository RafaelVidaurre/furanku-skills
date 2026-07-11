---
name: testing-best-practices
description: Guides automated-test design and maintenance by choosing evidence proportionate to risk and making tests behavior-focused, trustworthy, diagnostic, and resilient. Use when writing or reviewing automated tests, deciding what evidence a code change needs, choosing test scope or doubles, or repairing brittle, flaky, slow, or misleading tests.
license: MIT
metadata:
  author: rafaelvidaurre
---

# Testing Best Practices

Treat every test as **evidence** for a behavior that matters. Match the repository's language, framework, commands, naming, and development methodology. Choose test scope and technique from the risk and confidence needed, not from a universal test doctrine.

## 1. Frame the evidence

Inspect the change, its requirements, nearby tests, repository guidance, and available test commands. State:

- the behavior or contract that matters;
- the regression or failure the test should detect;
- the observable outcome that distinguishes correct from incorrect behavior;
- the boundary at which that outcome can be controlled and observed.

For a defect, preserve the smallest input that reproduces it. For new behavior, derive expectations from the requirement or caller contract rather than from the implementation.

**Complete when:** the intended evidence fits the sentence "Given `<state>`, when `<action>`, then `<observable outcome>`," and the target failure is named.

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

When case selection, expected results, property-based testing, or test doubles require judgment, read [Test design](references/test-design.md).

**Complete when:** each case names a unique contract distinction or failure risk; removing it would remove evidence rather than just a row.

## 4. Make the test trustworthy

Write the test so its behavior is obvious from its name and body:

- keep the decisive setup, action, and expected outcome visible;
- assert caller-observable results and contract-relevant side effects;
- derive expected values independently with simple, inspectable test logic;
- control time, randomness, concurrency, global state, environment, and external resources;
- give each test fresh or isolated mutable state;
- produce failure output with expected, actual, and relevant inputs;
- use local helpers only where they remove irrelevant detail without hiding causality.

One coherent behavior may need several assertions. Split when causes or outcomes are independent, not to satisfy an assertion count.

**Complete when:** the test is repeatable alone and with the suite, survives behavior-preserving refactors, and a failure explains which guarantee broke.

## 5. Challenge the signal

Run the focused test and the smallest relevant surrounding suite. Establish that the test is sensitive to its target defect using the safest available evidence: an observed pre-fix failure, a reversible perturbation, a useful mutation result, or a causal review showing the assertion cannot pass when the behavior is absent.

Classify unexpected results before editing:

- product behavior regressed;
- intended contract changed;
- test or environment is wrong or nondeterministic.

Update the source that is wrong while preserving the intended contract evidence. Report commands run and checks that could not be executed.

**Complete when:** the new or changed test passes against intended behavior, has credible sensitivity to the target failure, and the relevant suite has no unexplained result.

## 6. Leave the suite healthier

Keep tests close to the behavior they protect, fast enough for their execution tier, and owned by the team that can diagnose them. Move a broad regression to a narrower test when the narrower test provides equal fidelity; retain broader coverage when it protects an additional integration or deployment risk.

When reviewing suite quality, diagnosing flakes, choosing metrics, changing execution tiers, or pruning tests, read [Suite health](references/suite-health.md).

**Complete when:** the change adds no unexplained flakiness, hidden shared state, unnecessary scope, or duplicate evidence, and any remaining trade-off is documented.

## Decision standard

Prefer the option that gives the strongest relevant confidence for the lowest feedback and maintenance cost. Use project conventions and domain risk to resolve real trade-offs. Fixed coverage targets, test ratios, test-first sequencing, isolation styles, and doubling styles remain local policy choices rather than defaults supplied by this skill.

For the primary-source rationale behind these rules, read [Evidence base](references/evidence-base.md) when adapting the guidance or resolving a disputed practice.
