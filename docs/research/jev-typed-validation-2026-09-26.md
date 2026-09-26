# Typed Jev integration: implementation and validation

## Result

The Gateway client now supports Choice, Boolean, and Score. A real mixed request
successfully exercised all three types. The historical scorer still fails its
pilot reference checks; the work does **not** establish useful model rankings.
Keep these changes on the experimental branch. No installed skill or routing
score was updated during this implementation.

## Design implemented

- Validate each question and response against its API type. Keep existing Choice
  consumers compatible; retain score distributions and optional confidence.
- Retain complete tool bodies locally. Large events become decoded field spans
  with source IDs, field paths, and offsets, instead of sliced JSON or body pointers.
- Classify requested domains before assessing outcomes. Combine central and
  supporting probability for involvement; uncertain importance is reported separately.
- Batch independent same-state factual questions. Select final-result and repair
  evidence separately, then give the quality stage the requested work and cited
  sources. Recorded authority remains available to cause and attempt judgments.
- Use Boolean for assessability and observed repair, Score for final quality and
  repair burden, and Choice for categories. Unattempted work gets no quality score.
- Verify citation provenance mechanically and claim support semantically. Final
  quality and repair eligibility are independent. Preserve rejected estimates and
  explicit exclusions; do not promote them to routing evidence.
- Run frozen private benchmark cases through the same task assessor. Save input,
  code, taxonomy, raw responses, comparisons, and request-cache evidence. A negative
  result or unknown score cannot count as successful positive score coverage.

The [official guidance survey](jev-official-guidance-2026-09-26.md) supplies the
API and question-design rationale. Typed primitives fix the API mismatch; they
do not guarantee semantic correctness.

## Observed evidence

These are development observations from successive versions, **not** one complete
benchmark pass. Prior results remain preserved in the private experiment store.

| Check | Observation | Conclusion |
| --- | --- | --- |
| Mixed live API request | Boolean returned 0.98; Choice selected the expected evidence category; Score returned 2 on a 0–2 scale | All three Gateway contracts work through this client |
| Authorization refusal | An early pilot correctly withheld domain quality; a later classifier left one required domain unresolved | Correct refusal handling does not establish classification stability |
| Repaired software work | Required domains were found in one run; final test-quality estimate 2.69 was rejected by its support check | Still missing useful accepted positive evidence |
| Software work later canceled | Original packet omitted referenced requirements; supplying issue requirements changed classification but did not complete a successful validation | Input repair matters; this is not proof of evaluator accuracy |
| Complete short writing task | Writing was central at 0.99; assessability 0.89; raw quality 2.99. Follow-up support was 0.41, so the score was rejected | Positive coverage still fails despite a supplied artifact |
| Same writing task, domain labels | Game-design involvement was 0.82 against a writing-only reference | Definition/reference overlap must be adjudicated: the domain includes player learning, while the artifact is learning-game prose |
| Documentation deliverables | Long native evidence was available; the bounded trial stopped before completing assessment | No completed conclusion about this case |
| Operations task with intent announcement only | No quality score was accepted, but operations involvement remained unresolved | Correct abstention on quality, missed required domain label |

The last focused run completed two cases and accepted zero expected positive
scores. Both cases failed their domain/score reference checks. No full historical
corpus scoring run was performed by this implementation. One inspected Grok source
also used a per-turn model ID different from its summary ID; aliases require
verification before attributing that work to a configured model.

### Reference limitations

The initial hand-selected development packets collapsed request chronology and
omitted a referenced task contract. A revised benchmark restores the chronology
and supplies the optional issue requirements. Those revisions are recorded,
the originals retained, and previously unseen cases relabeled development after
inspection. Some domain boundaries and expected scores still need independent
adjudication. Do not silently change references or lower thresholds to make a run pass.

The benchmark exercises prepared task assessment. Native discovery, segmentation,
model attribution across the corpus, and visual artifact evaluation are separate
coverage requirements. Retrieval still selects a bounded subset of long evidence,
so preservation on disk does not prove every relevant fragment reached the final judge.

## Review and transport status

The requested Claude Fable 5.1 high reviewer launched with the exact model/effort
and began inspecting the changes. Claude Code then reported its weekly usage
limit, resetting September 27 at 17:00 Europe/Lisbon. It produced no review report.
The worker was stopped after that recorded failure. The adversarial review and
improvements based on it remain outstanding; no substitute reviewer was used.

Separate Jev Gateway requests returned HTTP 429 with a five-request limit header
and approximately 60-second Retry-After values. The client honored the shared
cooldown; bounded runs stopped with completed calls cached. These observations
do not identify the enforcing layer or establish the request window. This is
separate from Claude's weekly review limit.

## Next acceptance gates

1. Complete the Fable review when the requested runtime has quota; apply findings.
2. Independently adjudicate ambiguous domain boundaries and score references.
3. Freeze new positive and negative held-out cases, including each history source.
4. Demonstrate useful accepted positive scores, acceptable label precision/recall,
   and rejection of unsupported outcomes. Calibrate thresholds on development
   data without turning distribution confidence into a truth probability.
5. Only then expand the corpus run and assess sampling, correlated tasks, sparse
   cells, cost, and uncertainty before proposing any capability-table update.

This turn's hermetic checks passed: 34 client tests, 102 retrospective tests,
13 selector tests, and 71 router tests. The package dry run includes the new scripts.
They verify contracts, source preservation, attribution, and acceptance mechanics;
they do not prove Jev's semantic accuracy.
