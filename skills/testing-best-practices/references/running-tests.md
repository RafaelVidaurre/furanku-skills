# Running Tests

Read this reference when choosing which tests to run, when the project has no related-tests command, or when test runs are slow or noisy.

## Buy only new evidence

A test result is evidence about its inputs: the production code and artifacts it executes, reads, validates, or generates, the test itself, its fixtures and helpers, its configuration, and its dependency versions. A pass stays valid until one of those changes. Before each run, name what changed since the last pass and run the tests that depend on it:

| Changed since the last pass | Run |
|---|---|
| One test or its local fixture | That test |
| Production code in a unit | Tests related to the unit and to its dependents |
| Shared fixture, helper, or test configuration | Tests that use it |
| Dependency version, build, or runtime configuration | Tests at the boundaries that consume it |
| Files no test or build step executes, reads, validates, or generates from | Nothing, after confirming nothing consumes them |

Repeat an unchanged test only to investigate suspected nondeterminism, scoped to the suspect tests.

## The full suite is a release gate

`SKILL.md` step 5 owns the rule; this section covers its edges. "Every other point" includes iteration, task completion, handoff, and commit. A production release is one that ships changes to real users.

Run the identified related set even when it is large. When that set is the entire suite (a toolchain upgrade, a shared core type), ask the user to authorize the full run, and report the affected scope as unverified until they do. Report which scope ran and which was left unrun, so the release gate knows what it still owes.

This rule governs the runs you start. Pipelines the project already runs are its own policy; when auditing them, recommend related tests on each change and the full suite at release.

## Use the related-tests command

A healthy repository offers one documented command that maps changed files or a base ref to the tests that depend on them. Look for it in agent guidance, contributor docs, package scripts, task-runner targets, and the test runner's help. Runners and build tools usually supply the mechanism natively: related-file and changed-since modes, per-package or per-path selection, import-graph plugins, and affected-project queries.

When the project has no such command:

1. Select by convention for this run — co-located or mirrored test paths, plus the modules that import the changed code — and state the mapping you used.
2. Close the gap: add a one-command wrapper over the runner's native mechanism where the project keeps its scripts, document it where agents read first, and report the addition. When the runner has no native mechanism, so the command would need new tooling or a test-layout change, report the gap with a concrete proposal instead.

Treat any selection, conventional or native, as a candidate set: selectors follow static imports and miss runtime loading, subprocesses, consumed files, shared configuration, and generated artifacts. Add the affected tests outside the selector's graph, and accept an empty selection only after confirming that no tested behavior depends on the change.

A related-tests command is good when it:

- accepts changed paths or a base ref; its default covers staged, unstaged, and untracked changes, and deletions and renames keep their old paths when finding dependents;
- follows dependencies rather than only matching file names;
- starts fast enough to use after every edit;
- uses the lean output below;
- is documented where an agent looks first.

Test layout serves the same goal: co-located or predictably mirrored test files keep the mapping mechanical.

## Keep runs lean

- Select the runner's quiet or failures-only reporter. Leave progress bars, banners, per-test pass lines, and coverage tables off unless they are the question.
- A pass prints one summary line. A failure prints the test name, the broken guarantee, expected, actual, relevant inputs, and location.
- Capture logs from the code under test and show them only for failing tests.
- Bound diffs and dumps to the differing part rather than whole structures or snapshots. Write unavoidably large artifacts to a file and print the path.
- Repair recurring warnings at their source; standing noise buries the one line that matters.
- Stop at the first failure while iterating; collect the full failure list when confirming.

For reducing the runtime of the tests themselves, read "Protect feedback speed" in [Suite health](suite-health.md).

## Run completion

A run is complete when each executed test is justified by a changed input, an explicit full-suite request, the release gate, or a scoped nondeterminism investigation; every affected test passed or is reported as unverified; and the output contains only the summary and the failures.
