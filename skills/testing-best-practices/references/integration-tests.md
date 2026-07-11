# Integration Tests

Read this reference when behavior crosses a process, datastore, filesystem, network, API, queue, file format, runtime configuration, migration, or third-party boundary.

## Name the seam rather than trusting the label

"Integration test" can mean a narrow adapter test, several real components on one machine, or a broad deployed-system test. Describe the evidence explicitly:

- participants and interface;
- behavior and target failure;
- real and substituted implementations;
- process and machine boundaries;
- data and environment lifecycle.

The useful boundary is the smallest system that can expose the integration risk. Expand it when protocol stacks, deployment wiring, version skew, real transaction behavior, or emergent behavior materially affects the claim.

## Balance fidelity and hermeticity

Judge the system under test on two axes:

- **Fidelity:** similarity to production implementation, version, configuration, topology, protocol, and data behavior.
- **Hermeticity:** isolation from unrelated traffic, users, tests, mutable state, and remote availability.

A local environment with production binaries and short-lived dependencies often provides both useful fidelity and control. Shared staging or production-like environments add topology fidelity while increasing contention, version ambiguity, and diagnostic distance. Choose them when that topology is the risk, and isolate tenants, namespaces, and data.

Record dependency versions and configuration. Start dependencies within an owned lifecycle, wait on readiness, and capture environment facts on failure. Containers are one provisioning option; they provide evidence only when image versions, configuration, data, readiness, and cleanup are controlled.

## Decide which dependencies must be real

Include a real implementation when the defect could live in its semantics:

- serialization, encoding, framing, or protocol negotiation;
- query translation, collation, types, constraints, transactions, locking, or vendor extensions;
- broker delivery, acknowledgment, ordering, or redelivery;
- filesystem permissions, atomicity, or path behavior;
- framework wiring, startup, deployment configuration, or dependency injection;
- compatibility between independently released versions.

Use a fake, stub server, simulator, record/replay artifact, or contract test when it preserves the claim with better control. State its fidelity gap. A contract-verified double gives compatibility evidence; it still does not prove the provider's functional side effects.

For a third-party service, favor its supported sandbox or simulator for frequent testing, plus a narrow compatibility probe where permitted. Respect rate, cost, data, and safety constraints. Keep production probes separately safeguarded, observable, and unable to harm real users.

## Own the data lifecycle

Separate baseline state from traffic created by the test. Use small explicit fixtures for decisive behavior and representative volume only for a named risk.

Choose a setup path deliberately:

- supported APIs when creation behavior contributes to confidence;
- privileged fixture APIs when they remove irrelevant cost without bypassing the seam under test;
- fresh databases, schemas, tenants, queues, or namespaces for parallel isolation;
- transaction rollback only when commits, multiple connections, and asynchronous consumers are outside the behavior;
- idempotent cleanup that remains safe after partial setup or failure.

Use synthetic or authorized, minimized production-derived data. Keep credentials and personal or security-sensitive data under the project's handling policy and out of diagnostics.

## Databases and migrations

Use the production engine and relevant version for store-specific claims. Exercise application mapping and queries, then observe results through the supported path. A test that only proves the engine can store a row provides little application evidence.

Test migrations as ordered deployment artifacts:

1. provision a representative supported prior baseline;
2. apply the same migration path used in deployment;
3. start the compatible application configuration;
4. verify schema expectations and caller-visible behavior;
5. exercise rollback or roll-forward only when the release strategy promises it.

Include empty-to-latest as one path, not as a substitute for supported upgrades.

## APIs, messages, and contracts

Separate compatibility from functional effect:

- **Contract evidence** checks that consumer and provider agree on requests, responses, messages, and tolerated variation.
- **Functional integration evidence** checks that the collaboration causes the promised state change or outcome.

Exercise contract-relevant fields, metadata, serialization, authentication, authorization, versions, and error categories. Match only what the consumer requires so harmless provider additions remain compatible. Run the real consumer adapter in consumer tests and verify the expectation against the real provider implementation when the contract approach supports it.

Add integrated effect tests for persistence, emitted messages, transactions, or downstream state that a contract alone cannot prove.

## Asynchrony and failure

Wait for an observable terminal condition. Prefer a completion event or subscription; otherwise poll with a bounded deadline and useful cadence. On timeout, report elapsed time and last observed state. A fixed sleep encodes a guess rather than a condition.

Select failure cases from the contract and operational risk:

- unavailable, refused, dropped, or malformed interactions;
- timeout before or after a side effect;
- retryable and terminal errors;
- retry exhaustion, cancellation, and backoff;
- duplicate, delayed, or out-of-order delivery;
- partial success across participants;
- restart, reconnection, and recovery;
- idempotency where a repeated operation could duplicate work.

Inject each failure at the narrowest boundary that preserves the behavior claimed. A stub can faithfully force a transport error; a real broker may be required to prove redelivery or ordering.

## Make distributed failures local

Failure output should include:

- seam, scenario, expected outcome, and actual outcome;
- participant versions and relevant configuration;
- unique test and correlation identifiers;
- redacted request, response, or message metadata;
- logs or traces across process boundaries;
- environment readiness separately from behavior assertions;
- last asynchronous state and deadline;
- owner and reproduction command.

The integration design is complete when the test can run independently, owns its environment and data, exercises the actual seam at risk, and tells an unfamiliar engineer which participant failed first.
