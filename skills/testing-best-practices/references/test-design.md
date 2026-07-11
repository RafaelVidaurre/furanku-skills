# Test Design

Read this reference when selecting test cases, assertions, a test boundary, property-based tests, or test doubles, or when reviewing an individual test.

## Quality model

A strong test provides six kinds of evidence:

| Quality | Question |
|---|---|
| Relevance | Does this protect behavior a caller or operator relies on? |
| Sensitivity | Would a plausible regression make it fail? |
| Determinism | Does unchanged behavior produce the same result? |
| Diagnosis | Does failure identify the broken guarantee? |
| Resilience | Does behavior-preserving refactoring leave it valid? |
| Economy | Is its confidence worth its runtime and maintenance cost? |

Use the model as a set of tensions. A more realistic test can cost determinism; a more isolated test can cost fidelity. State the trade-off instead of turning one quality into dogma.

## Test behavior through a supported interface

Choose the interface that callers of the tested unit are expected to use. A unit may be a function, object, module, package, or cohesive group; language-level visibility alone does not define it.

Assert observable state, return values, emitted domain events, or meaningful side effects. Interaction assertions are appropriate when the interaction is the contract, such as "charge once," "publish nothing," or required ordering. Incidental calls and private helpers belong to implementation and make weak contracts.

Frame one coherent behavior per test. Several assertions can jointly describe one outcome. Separate tests when they have different causes, actions, or reasons to fail.

## Select a compact, discriminating case set

Start with the behavior's input and state space:

- **Representative case:** an ordinary example that documents the contract.
- **Equivalence partitions:** one value from each class expected to behave differently.
- **Boundaries:** values at and immediately around an ordered transition.
- **Absence and invalidity:** empty, missing, malformed, unsupported, or forbidden values when distinguished by the contract.
- **State transitions:** meaningful before/after states and invalid transitions.
- **Decision combinations:** combinations that change a rule's outcome, reduced by irrelevant conditions.
- **Failure behavior:** error result, recovery, and externally meaningful side effects.
- **Regression:** the smallest example of an escaped defect.
- **Property:** an invariant spanning a large input space.

Prefer the smallest values that make the distinction clear. Parameterize cases that share one behavior and assertion shape; keep named standalone examples when the scenario deserves independent documentation or diagnosis.

Derive expected values from a specification, independent calculation, trusted model, or explicit literal. Expected-value code that repeats the production algorithm can repeat its defect. Keep test logic straight-line and inspectable; express data tables as data rather than loops with evolving expectations.

## Control every variable that matters

Make time, randomness, scheduling, locale, time zone, environment, configuration, filesystem paths, network endpoints, and generated identifiers explicit when they influence the result. Record seeds for generated cases. Give mutable fixtures a fresh instance or isolated namespace and restore process-wide state reliably.

Run order randomization and repetition when hidden shared state or nondeterminism is plausible. A repeatable test produces the same result for the same code, inputs, and declared environment; it does not require production behavior itself to be deterministic.

## Use test doubles by role and fidelity

Choose from the highest-fidelity practical option:

| Option | Best fit | Main cost |
|---|---|---|
| Real implementation | Fast, deterministic, safe, and easy to construct | Setup or runtime may grow |
| Fake | Reusable lightweight behavior can preserve the contract | Fake can drift and needs contract tests |
| Stub | A precise value or rare error establishes the scenario | Hardcoded assumptions can diverge |
| Interaction check | The call or call count is itself observable behavior | Couples the test to orchestration |

Use a double for a named reason: control, safety, speed, unavailable infrastructure, or reachability of a failure. Configure only behavior the scenario consumes. For important fakes, run shared contract examples against the fake and real implementation when feasible.

More double setup than behavior, exact assertions on incidental call order, or failures after harmless refactors are signals to raise fidelity or observe state instead.

## Combine examples and properties deliberately

Use examples for named scenarios and documentation. Use property-based testing when the domain has laws such as round-trip behavior, idempotence, conservation, ordering, monotonicity, model equivalence, or validity of every output.

A useful property has:

- an implementation-independent invariant;
- generators that model valid and invalid domains intentionally;
- visible distributions, discarded cases, and size ranges;
- explicit edge examples where generation may undersample them;
- a replayable seed and a reduced counterexample when supported.

Generated volume is evidence only for the distribution actually explored. Preserve a discovered counterexample as a stable regression example when it clarifies the contract.

## Optimize for the failure reader

Name tests with the scenario or action and expected result. Keep decisive inputs beside the action. Use domain-aware assertions that report expected and actual structures or differences. Add relevant parameters and state to the failure message; keep secrets and unrelated fixture noise out.

Use helpers as a test vocabulary: a helper should reveal domain intent or hide irrelevant construction. Setup hidden in global hooks, generic helpers, or deeply nested builders is a signal to return decisive state to the test body.

## Repair signals

| Symptom | Target state |
|---|---|
| Refactors break many tests | Assert supported behavior at a more stable boundary |
| Test passes after behavior is removed | Strengthen the oracle or exercise the missing path |
| Test result depends on order | Give it isolated state and explicit lifecycle |
| Failure says only true/false | Show expected, actual, and scenario context |
| Cases differ without changing risk | Remove duplication or use a data table |
| Helper reading requires mental execution | Keep decisive values and assertions local |
| Double behavior dominates the test | Use a real implementation, maintained fake, or narrower claim |
| Property generates mostly trivial cases | Redesign generators and inspect distributions |

Apply every quality relevant to the behavior; the review is complete when each retained test provides distinct, sensitive, repeatable, diagnosable evidence.
