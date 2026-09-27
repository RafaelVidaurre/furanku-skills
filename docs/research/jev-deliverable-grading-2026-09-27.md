# Explicit deliverable grading — 2026-09-27

## Result and decision

**The simpler question produces useful distinctions, but reliable numeric quality
grading is still unproven. Both frozen control tests failed.** Keep the production
retrospective, installed skill, and routing scores unchanged.

On the six untouched constructed controls, the candidate accepted four numeric
grades: three matched the frozen ranges and one overstated defect severity.
Both good artifacts and both defective artifacts received the corresponding
broad category. Neither missing-artifact case received a numeric score, although
only one produced a confident explicit unknown. The broad-category agreement is
a post-hoc observation, not a replacement for the failed ordinal criterion.

The next measurement should be **requirement satisfaction: met, demonstrably
unmet, or insufficient evidence, with a source anchor for each determination**.
Keep availability of evidence separate from correctness. Defer severity and
repair effort until they have distinct meanings and independent references.
This is the next design to test, not an implemented or validated replacement.

## What ran

Following the [paired evidence experiment](jev-paired-evidence-feasibility-2026-09-27.md),
an independent Astra reviewer constructed six development and six held-out
controls, each containing two good, two defective, and two unobservable results.
They cover code reviews, documentation, and simple implementations. These are
explicitly constructed controls, never historical model-performance evidence.

The reviewer also prepared three source-checked historical transfer packets from
previously observed cases. Those are development after observation, not fresh
validation. All three native source hashes and all 42 excerpt anchors checked.
Historical sources and results remain private.

The candidate sends only four state fields: requested deliverable, requirements,
artifact, and observed evidence. One Choice question offers standalone quality
levels 0–4 plus unknown. It grades the requested report or document itself;
it does not require external approval of directly inspectable properties.
Expected answers, reference rationales, and model identities are excluded.

The comparison calls production `assess_task` on a constructed event wrapper
containing the same evidence. The experiment supplies the domain classification
and actor identity. This isolates an assessment boundary; it does not test native
segmentation, attribution, classification, or end-to-end retrospective behavior.
Production code was not modified. These arms also differ in state structure,
questions, and gates, so their difference cannot be assigned to one prompt phrase.

### Frozen decision rules

A candidate numeric level is accepted only when its Choice probability meets
the threshold and exceeds the next option by at least 0.10. Unknown must meet the
same gates to count as a confident semantic abstention. Uncertain and execution
failure remain distinct from successful unknown.

Before calls, the threshold search was fixed to 0.4, 0.5, 0.6, 0.7, and 0.8.
Choose the highest satisfying development criteria; if none passes, retain the
failure and use the predefined 0.6 default for a diagnostic held-out run.
Success requires at least 3/4 known-quality controls within their reference
ranges, at least one good and one defective accepted, 2/2 confident unknowns,
zero accepted scores outside reference ranges, and no execution errors.

No development threshold passed. The default 0.6, questions, runner, production
code hashes, taxonomy hash, and references were frozen before held-out contents
were exposed to the root agent. Each case ran once per arm; no failures were
rerolled. All 45 validated calls reported one attempt; no provider or client
errors occurred. Cached reported cost was $0.005237316 for 124,698 input tokens.

The threshold search is tuning on six examples, not established calibration.
The Gateway response identifies `typesafe-ai/jev`; an immutable underlying
TypeSafe revision was not supplied by this client, limiting later reproducibility.

## Results

| Split | Candidate grades matching reference | Candidate accepted outside range | Confident unknown | Baseline grades matching reference |
| --- | ---: | ---: | ---: | ---: |
| Development controls | 3/4 | 0 | 1/2 | 0/4 |
| Held-out controls | 3/4 | 1 | 1/2 | 0/4 |
| Previously observed historical transfer | 2/3 | 0 | No unknown controls | 1/3 |

The baseline withheld every missing-artifact score. Its null result does not
distinguish semantic unknown from other gate exclusions, so no comparable
confident-unknown or combined pass/fail result is claimed for it. The historical
product candidate grades a holistic deliverable while the baseline grades its
product domain; **2/3 versus 1/3 is descriptive, not a clean accuracy comparison**.

### Each control

Unknown is not quality zero. Uncertain means no grade passed the acceptance gate.
The baseline accepted no numeric grades for any constructed control.

| ID | Requested work | Reference | Candidate at 0.6 | Result |
| --- | --- | --- | --- | --- |
| d01 | Review half-open interval overlap | 3 | 3 | Match |
| d02 | Review incorrect integer normalization | 0–1 | 0 | Match |
| d03 | Write save-behavior FAQ | 3 | 3 | Match |
| d04 | Write runbook; body missing | Unknown | Unknown | Match |
| d05 | Implement stable deduplication; wrong order | 2 | Uncertain | Missing numeric grade |
| d06 | Implement sum; execution host unavailable | Unknown | Uncertain | Not confident unknown |
| h01 | Review token-expiry boundary; false approval | 0–1 | 1 | Match |
| h02 | Review function; report never supplied | Unknown | Uncertain | Not confident unknown |
| h03 | Write binary-frame decoder guide | 3 | 3 | Match |
| h04 | Write cursor-pagination guide; wrong stopping rule | 2 | 1 | Outside frozen range |
| h05 | Implement run-length encoding | 3 | 3 | Match |
| h06 | Claimed implementation and passing tests; both absent | Unknown | Unknown | Match |

### Development threshold search

| Threshold | Matching numeric grades | Incorrect accepted grades | Confident unknowns | Pass |
| --- | ---: | ---: | ---: | --- |
| 0.4 | 3/4 | 1 | 1/2 | No |
| 0.5 | 3/4 | 1 | 1/2 | No |
| 0.6 | 3/4 | 0 | 1/2 | No |
| 0.7 | 2/4 | 0 | 1/2 | No |
| 0.8 | 2/4 | 0 | 1/2 | No |

### Historical transfer

| Artifact | Reference | Candidate | Wrapped baseline |
| --- | --- | --- | --- |
| Requirements capture | 2–3 | 3 | 3 |
| Provenance review | 3 | 3 | Withheld |
| Numerical review | 2–3 | Uncertain | Withheld |

The numerical-review Choice placed 0.49 on level 3 and 0.27 on level 4; no level
passed the frozen gate. This does not establish poor historical performance.
These holistic artifact observations are not new per-model/domain routing scores.

## Interpretation and independent review

The pagination guide has a real correctness defect: it stops on an empty page
despite a continuation cursor. Reference 2 remains defensible because correcting
one instruction preserves the rest of the guide. A low severity grade is also
understandable because the instruction can lose substantial data. Our scale mixes
consequence severity with repair effort. The accepted grade 1 remains a frozen
failure; we did not widen its reference after seeing the answer. JEV returned no
explanation, so this is a rubric-ambiguity hypothesis, not a proven account of
its reasoning. The development ordering example raises a similar concern.

The broad good/defective agreement on all four visible held-out artifacts is
encouraging but small and post-hoc. The Choice answers do not identify defects
or cite evidence, so even correct categories do not prove correct reasoning.
Two historical artifacts gained accepted grades, but the selected transfer
packets cannot establish generalization or model rankings.

The Astra review checked references, result hashes, excerpt provenance, wrapper
limitations, and error handling. It recommended requirement-level satisfaction
next, rather than changing evaluator or domain classifier while the measurement
target remains ambiguous. Future tests must include source-backed assertions,
real defective outcomes, missing evidence, and independent acceptance criteria.
Neither this result nor an eventual small control pass authorizes bulk scoring.

## Reproduction and evidence

- [Research runner](experiments/jev_deliverable_probe.py), using the existing
  bounded JEV client, privacy configuration, response cache, and shared cooldown.
- [Development controls](experiments/deliverable-controls/development-controls.json)
  and [held-out controls](experiments/deliverable-controls/heldout-controls.json).
  Both are now exposed and consumed; future tuning must treat them as development.
- [Four hermetic runner tests](experiments/test_jev_deliverable_probe.py) cover
  reference leakage, uncertainty versus failure, missing-evidence accounting,
  and numeric-reference checking. All pass.

The runner takes `--directory <private-experiment-dir> --split development|heldout|historical`.
It requires frozen `*-controls.json` files and an explicit `rubric-freeze.json`
for non-development runs. Results are immutable; it refuses to overwrite an
existing run. An interrupted/provider-blocked experiment requires inspecting the
saved partial result rather than blindly rerunning. The research CLI uses this
session's authorized no-ZDR/no-prompt-training mode; this is not an installed
skill command or a default for other users.

Private evidence includes protocol, frozen references and pre-call revisions,
full requests/responses, results for all arms, source spans, a 30-row CSV, and
hashes of baseline code and taxonomy. Synthetic references were corrected before
calls to align wholly false reviews with the explicit level-zero rubric; no
outcome-based reference edits occurred.

| Frozen artifact | SHA-256 |
| --- | --- |
| Protocol | `6a15d85abceff7083678cf93e75099c4ff1de86fbd06f74c5bd818705f8d52a2` |
| Development controls | `0253365f70b53c9dcfdfa3d55271d69c0914101cb71b8df3a0b398cace69d64f` |
| Held-out controls | `a3e258e045a802405a4dfd6c510108a9a31e34005f0d7f5c65d1f2582b803d93` |
| Historical transfer | `3c3583884917f5d96fc18165b37661710242ed7a3a23325f160c2681c0048eaa` |
| Research runner | `1defa34f3e5405d9dc831d2926a3eeec93c87214015907ec957c12c2f8979dbb` |
| Rubric freeze | `515305d6c6816d671a6adaf571d4ef8309384a86830f513b18201ae4e9a3aa4c` |
