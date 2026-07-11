# Evidence Base

Read this reference when adapting the guidance to a high-risk domain, resolving a disputed practice, or tracing a rule to its primary source.

## Test design and maintenance

- Erik Kuefler, [Unit Testing — *Software Engineering at Google*](https://abseil.io/resources/swe-book/html/ch12.html): public behavior, state testing, clarity, failure messages, and maintainability.
- Andrew Trenk and Dillon Bly, [Test Doubles — *Software Engineering at Google*](https://abseil.io/resources/swe-book/html/ch13.html): real implementations, fakes, stubs, interaction tests, and fidelity trade-offs.
- [GoogleTest Primer](https://google.github.io/googletest/primer.html) and [Advanced Guide](https://google.github.io/googletest/advanced.html): independence, repeatability, diagnostics, order shuffling, and repetition.
- Microsoft, [Unit testing best practices](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices): readability, explicit structure, minimal cases, and controlled dependencies.
- ISTQB, [CTFL Syllabus v4.0.1](https://www.istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf): equivalence partitions, boundaries, decision tables, state transitions, and integration levels.
- Koen Claessen and John Hughes, [*QuickCheck*](https://www.cs.tufts.edu/~nr/cs257/archive/john-hughes/quick.pdf): executable properties, generators, distributions, and limitations.
- Google, [Code Coverage Best Practices](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html): coverage as an indirect gap signal rather than proof.
- Goran Petrović et al., [Long Term Effects of Mutation Testing](https://research.google/pubs/long-term-effects-of-mutation-testing/) and [Industrial Application](https://research.google/pubs/an-industrial-application-of-mutation-testing-lessons-challenges-and-research-directions/): mutation usefulness and practical limits.
- Celal Ziftci and Diego Cavalcanti, [De-Flake Your Tests](https://research.google/pubs/de-flake-your-tests-automatically-locating-root-causes-of-flaky-tests-in-code-at-google/): nondeterminism and repair workflow.

## Integration testing

- Adam Bender, [Testing Overview — *Software Engineering at Google*](https://abseil.io/resources/swe-book/html/ch11.html): size versus scope, hermeticity, risk, and suite composition.
- Joseph Graves, [Larger Testing — *Software Engineering at Google*](https://abseil.io/resources/swe-book/html/ch14.html): fidelity, SUTs, data, smallest scope, asynchronous waits, diagnostics, and ownership.
- Martin Fowler, [Integration Test](https://martinfowler.com/bliki/IntegrationTest.html): narrow and broad terminology.
- Ham Vocke, [The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html): boundary-focused database and service integration tests.
- Microsoft, [Choosing an EF Core testing strategy](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy): real database behavior, substitute limitations, and isolation trade-offs.
- [Testcontainers documentation](https://java.testcontainers.org/): disposable real dependency instances and known starting state.
- Pact, [Introduction](https://docs.pact.io/), [When to use Pact](https://docs.pact.io/getting_started/what_is_pact_good_for), and [Contract vs Functional Tests](https://docs.pact.io/consumer/contract_tests_not_functional_tests): compatibility scope and contract-test limits.
- Marc Brooker, [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/): partial failures, retry load, side-effect ambiguity, and idempotency.
- Redgate Flyway, [Migrations](https://documentation.red-gate.com/fd/migrations-271585107.html) and [Baselines](https://documentation.red-gate.com/fd/baselines-273973441.html): ordered database evolution and representative build environments.
- Jeff Listfield, [Where do our flaky tests come from?](https://testing.googleblog.com/2017/04/where-do-our-flaky-tests-come-from.html): empirical correlation between test size and flakiness, with causality caveats.
- NIST, [SP 800-115](https://csrc.nist.gov/pubs/sp/800/115/final): production-impact decisions and false PII in non-production tests.
