# Requirement satisfaction and source support — 2026-09-27

## Decision

**Stop further prompt/threshold tuning of this JEV-only acceptance pipeline.**
Prepared atomic requirements did not solve reliable evidence-backed assessment.
Both frozen control splits failed. This does not establish that JEV is useless:
its raw verdict matched 13/15 judge-evaluated requirements in each split. However,
the procedure lost correct answers and accepted incomplete supporting citations.

Next, retain the requirement/source contract, move exact checks into code, and
compare a stronger assessor for the remaining semantic judgments. JEV can remain
a measured baseline rather than the sole acceptance authority. A stronger model
is a hypothesis to test, not an assumed solution. Reference reviewers must judge
only the packet offered to the evaluator; separately verify its native provenance.

The production retrospective, installed skill, and routing tables are unchanged.
No model-performance scores were published or updated. The full-history goal
remains unfinished.

## Experiment

This follows [explicit deliverable grading](jev-deliverable-grading-2026-09-27.md).
An independent Astra reviewer prepared six development and six untouched
constructed tasks. Each has three requirements: each split contains six met,
six unmet, and six unknown references. Cases include mixed results, false code
approvals, omissions, contradictory documentation, unrelated passing tests,
missing artifacts, and missing runtime verification despite a supplied artifact.
Task contents differ between splits, but their structural patterns are matched;
this is a small feasibility test, not broad task-family generalization.

Two previously observed historical packets add six selected requirements. They
are development transfers, not fresh validation. Requirements are independently
paraphrased and linked to original contracts. Both native source hashes and all
eight exact excerpt anchors were rechecked. Private source text stays local.

### Procedure

1. Validate the prepared requirement/source schema. Artifact IDs must identify
   every supplied artifact body exactly once. With no artifact, record mechanical
   `artifact_not_supplied` for this direct-artifact assessment scope. This does not
   support feedback-only assessments of missing artifacts.
2. Ask JEV independently whether each requirement is met, unmet, or unknown.
   Each question contains the requirement text. Requested reviews and documents
   are the artifacts being judged, distinct from the systems they discuss.
3. For raw met/unmet answers, ask a dependent question selecting the smallest
   supporting bundle of one or two sources, with a none option.
4. Ask a Boolean question whether that selected bundle itself establishes the
   verdict. Other supplied sources may contradict it, but cannot substitute for
   evidence missing from the selected bundle. Retain exact source bodies, hashes,
   and line anchors.
5. Accept met/unmet only with sufficient verdict probability/margin and semantic
   support. Citation-selection probability is not proof: several bundles can be
   valid. Unknown needs a confident verdict but no fabricated citation; its
   packet hash records the evidence scope. Uncertain, unsupported, execution
   error, mechanical unknown, and semantic unknown remain distinct.

The test accepts prepared requirements and sources. It does not extract them,
classify domains, resolve native tasks, attribute workers, measure repair or
severity, or aggregate model/domain capability scores.

Before calls, success required ≥80% correct accepted cells, ≥75% in each class,
≥75% of judge-evaluated unknowns, at least three references per class and three
judge-evaluated unknowns, zero wrong accepted verdicts, zero incorrect accepted
citation bundles, and no execution errors. Mechanical missing-artifact answers
cannot satisfy the separate semantic-unknown criterion.

The predeclared threshold grid was 0.5/0.6/0.7/0.8 with a fixed 0.10 verdict margin.
No development threshold passed; the predetermined 0.6 default was frozen before
the held-out contents were shown to the root agent. Questions, code, thresholds,
source references, and comparison rules were not changed after results arrived.

## Results

| Metric | Development | Held-out | Historical transfer |
| --- | ---: | ---: | ---: |
| Correct accepted answers with valid evidence | 12/18 | 9/18 | 4/6 |
| Correct met requirements | 4/6 | 2/6 | 4/5 |
| Correct unmet requirements | 4/6 | 3/6 | 0/1 |
| Correct unknown requirements | 4/6 | 4/6 | No references |
| Included mechanical missing-artifact answers | 3 | 3 | 0 |
| Correct JEV-derived unknowns | 1/3 | 1/3 | No references |
| Accepted wrong verdicts against frozen references | 0 | 0 | 2¹ |
| Accepted incomplete citation bundles | 1 | 2 | 1¹ |
| Execution/provider errors | 0 | 0 | 0 |

¹ The historical errors overlap, and both historical mismatches have methodological
limitations discussed below. They must not be counted as proven semantic-model
errors. The historical selection has no unknown controls and cannot pass the
control-validation criterion regardless of its accuracy.

There were 36 validated calls, all reporting one attempt, using the existing
bounded client and shared rate-limit coordination. Cached reported cost totals
$0.001903188 for 45,314 input tokens. No live routing or worker launches occurred.
The Gateway reports `typesafe-ai/jev`, not an immutable underlying model revision;
future reproducibility is limited accordingly.

### Every held-out requirement

Withheld means the frozen confidence or support gate did not accept an answer.
“Incomplete citation” means the verdict matches but its selected sources do not
independently establish that verdict.

| Task / requirement | Requirement property | Reference | Observed result |
| --- | --- | --- | --- |
| h01/r1 | Review detects ignored invoice quantity | Unmet | Unmet, incomplete citation |
| h01/r2 | Review contains a concrete example | Unmet | Unmet, supported |
| h01/r3 | Review stays under 80 words | Met | Withheld: uncertain |
| h02/r1 | Rotation instructions record old fingerprint | Unmet | Unmet, supported |
| h02/r2 | Instructions reload the server | Met | Met, supported |
| h02/r3 | External client receives new certificate | Unknown | Withheld: uncertain |
| h03/r1 | Grouping implementation preserves order | Met | Met, supported |
| h03/r2 | Implementation retains odd final element | Unmet | Unmet, supported |
| h03/r3 | Dedicated unit suite passes | Unknown | Unknown |
| h04/r1 | Note uses the specified expiration unit | Unmet | Withheld: uncertain |
| h04/r2 | Note accurately explains zero expiration | Met | Withheld: unsupported |
| h04/r3 | Running server actually expires an entry | Unknown | Withheld: unsupported |
| h05/r1 | Missing rotation implementation avoids mutation | Unknown | Mechanical unknown |
| h05/r2 | Missing implementation rotates correctly | Unknown | Mechanical unknown |
| h05/r3 | Missing implementation handles empty input | Unknown | Mechanical unknown |
| h06/r1 | Test summary reports collected count | Met | Withheld: unsupported |
| h06/r2 | Summary reports failure count accurately | Unmet | Withheld: unsupported |
| h06/r3 | Summary names the tested module | Met | Met, incomplete citation |

### Development threshold search

| Threshold | Correct accepted | Wrong accepted verdicts | Incomplete accepted citations | Correct JEV unknowns | Pass |
| --- | ---: | ---: | ---: | ---: | --- |
| 0.5 | 13/18 | 2 | 3 | 1/3 | No |
| 0.6 | 12/18 | 0 | 1 | 1/3 | No |
| 0.7 | 11/18 | 0 | 1 | 1/3 | No |
| 0.8 | 9/18 | 0 | 0 | 0/3 | No |

Raising the threshold removed some false evidence acceptance but sacrificed useful
coverage. Lowering it admitted wrong verdicts. This is not a calibration pass.

## What failed, and at which layer

**Source support:** h01/r1 cited the defective code alone. That establishes a code
defect, but cannot establish whether the review reported it. h06/r3 cited the test
receipt alone; the receipt cannot establish what the summary says. Both bundles
passed the separate semantic-support check. These are genuine support failures
under the stated requirement/source contract.

**Raw verdicts:** in both splits, a documentation task directly contradicted its
specification and claimed an unobserved operational result. JEV initially called
both requirements met. Gates withheld those answers. Thus raw agreement of 13/15
is promising evidence of some utility, not sufficient acceptance safety.

**Coverage:** some correctly selected verdicts were rejected by confidence or
support checks despite available evidence. Only one of three present-artifact
unknowns passed per split. Retrieval did not discard these small prepared packets;
there was no access failure or rate-limit explanation.

**Mechanical checks sent to the wrong tool:** the historical verbatim-copy
requirement includes exact whitespace, which should be compared by code. The
reviewer introduced this methodological mismatch. Preserve its frozen failure,
but do not use it to argue against JEV's general semantic capacity. Word limits,
exact byte payloads, counts, and identifier equality also belong in deterministic
checks. A post-hoc code check confirmed the changed quoted line and counted the
held-out review at 21 whitespace-separated words. Neither diagnostic rewrites the
frozen JEV results or constitutes a new validated hybrid pipeline.

**Reference/packet alignment:** the second historical mismatch was an unknown
answer for an integrity check. The packet supplied an `OK` line and matching
directory, but omitted the originating command/checker identity and explicit
linkage to the resulting artifact. The independent reviewer had used fuller
native context to assign met. JEV's unknown is defensible from its actual packet.
This is an evidence-selection/reference problem, not a proven judging error.
Exact excerpt fidelity does not establish adequate context.

The other four historical requirements matched their references. This tiny,
selected, previously observed sample does not establish semantic performance,
domain competence, model rankings, or corpus coverage.

## Next comparison

Freeze the division between deterministic checks and semantic assessment before
another comparison. Use code for exact text, counts, payloads, and structured
check receipts after verifying their task/artifact linkage. Use a stronger
assessor for semantic requirement satisfaction and source support. Assessors and
reference reviewers must see the same evidence packet; provenance verification
is a separate audit. Include wrong-source, contradictory-source, omitted-context,
and missing-result controls alongside successful work.

Compare useful supported coverage, false acceptance, and cost on identical
packets. JEV is a baseline for that comparison, not a default acceptance gate.
Avoid another JEV-specific prompt or threshold iteration on these consumed
examples. If an alternative succeeds, native extraction and domain classification
still require independent validation before full-history scoring or installation.

## Reproduction

- [Research runner](experiments/jev_requirement_probe.py) with an explicit
  `--allow-no-zdr` flag; default requests ZDR. The live test used existing user
  authorization for no-ZDR with no prompt training.
- [Development controls](experiments/requirement-controls/development-controls.json)
  and [held-out controls](experiments/requirement-controls/heldout-controls.json).
  These constructed controls are now exposed and consumed, not future holdouts.
- [Six hermetic tests](experiments/test_jev_requirement_probe.py), all passing:
  missing-artifact behavior, reference exclusion, dependent source verification,
  separate unknown denominators, source-set correctness, and error/input handling.

The runner requires a private retrospective directory, frozen `*-controls.json`,
and `rubric-freeze.json` before non-development runs. It verifies all evaluator
code hashes and refuses to overwrite results. Full payloads, responses, exact
source anchors, all 42 requirement rows in CSV, and reference correction history
remain private. Before calls, verification-delivery wording was corrected to
actual outcome propositions: missing proof and observed failure are different.

| Frozen artifact | SHA-256 |
| --- | --- |
| Protocol | `6a529759e4727d0b66a7aa997b5c7a1b008d9471455c6fe6e4e8b598a8f2a07b` |
| Development controls | `2ada54ad07e6865083d7aceea8ea636393366160b1966129b857fb760b8631e5` |
| Held-out controls | `c89e77806b151811e897b2b7af6ce90dba2dd0bf51718f91b7e7ba90a9b8f130` |
| Historical transfer | `19eeab4caa3de5375189d7f538aaa61a8edf8ec3631db6d1525ee05595cbbec4` |
| Runner | `857217527b64f79ac651575cfa5e5a78cfbc2349778fd4f56b278b3fc4f7e5bf` |
| Rubric freeze | `bb244d8898f791f3e41f9ef24bc4ea0284da5654b128569ab23e1ffaf426f703` |
