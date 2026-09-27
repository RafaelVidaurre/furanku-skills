# JEV access restored; retrospective validation still incomplete

## Result

Purchased Gateway credit restored access. A public Boolean smoke succeeded on
the first attempt in 0.77 seconds. The four-case development batch then completed
70 new evaluation calls, each on its first attempt, with no rate-limit waits.
The Gateway-reported cost for those calls totals approximately $0.024.

The batch used commit `62601f4`, task pipeline v11 and taxonomy v8. These are the
previously failed historical cases, now explicitly marked development. The
original frozen references and their failure remain unchanged. This rerun is
not fresh held-out evidence and does not establish corpus-wide accuracy.

## Historical case results

Quality is ordinal 0–4; 3 means the main requirements are demonstrated. Repair
burden is separate, 0–3. Unknown is missing supported evidence, not a zero score.

| Case | Required domains | Observed result | Full reference check |
| --- | --- | --- | --- |
| Canceled bootstrap implementation | Implementation, debugging, verification | Verification found; implementation/debugging unresolved. No quality or repair accepted, correctly withholding scores for unattempted work. | Fail: two required domains missing. |
| CLI path/version inspection | Deployment and operations | Correct domain and task boundary. Quality **3** accepted. Repair remains unknown; reference expects observed repair **0**. | Fail: repair coverage. |
| Remote tests blocked before execution | Verification, deployment and operations | Both required domains found; optional implementation also involved. No quality or repair accepted. | **Pass**. |
| HEAD/base test comparison | Verification, deployment and operations | Verification found; operations unresolved. Implementation, debugging and science additionally involved. All quality and repair remain unknown. | Fail: domain mismatch and two missing positive quality observations. |

One of four full case checks passes. One of the three expected positive
domain-quality observations is accepted. All task boundaries match the
references. The private report includes all 84 session/domain cells, raw
distributions, accepted values and exclusion reasons.

## Independent Astra review

- **Canceled work:** full referenced requirements now reach classification.
  Implementation involvement is .61 and debugging .73, below the unchanged .75
  threshold. Whether cancellation causes the uncertainty remains unisolated.
- **CLI evidence:** the original three work events are small, but large historical
  policy triggers retrieval. Quality/repair inherited that retrieval and received
  only the result and final response, omitting the command invocation. The packet
  explicitly warned that history may be missing, so repair abstention was
  defensible on the supplied evidence.
- **Conditional scope:** the comparison contract conditionally requests repair.
  The reference excludes that branch because its condition never became true,
  but request-only classification lacks the observed branch-resolution facts.
  This is an interface/reference mismatch; preserve the failed comparison while
  defining requested, conditional and actually attempted scope explicitly.
- **Taxonomy ambiguity:** science includes broad engineering reasoning, which can
  overlap with host-load diagnosis. Its unexpected label alone does not establish
  evaluator error.
- **Comparison evidence:** retrieval still omits complete HEAD-result and
  issue/comment receipts. Assessability .80 on that packet must not be overridden
  to manufacture the expected score.

## Narrow evidence-handoff repair

Pipeline v12 first considers all original observed task events for quality and
support, independently of the earlier authority-context retrieval. It preserves
actor attribution, source order, linked requirements and later contrary events.
It reserves space for both scoring and the longest support claims. If complete
work cannot fit, retrieved/selected fallback remains explicitly incomplete.
Authority still participates in the earlier attempt, ownership and cause checks.

69 related hermetic tests pass. Astra found no blocking defect in the diff. The
tests verify packet construction and gates, not semantic accuracy.

A controlled development probe changed only the CLI outcome packet to include
all three original work events; the earlier fact judgments were unchanged. Two
new calls returned supported quality level 3 again, but repair assessability was
.28 and support for zero repair .41. Thus restoring completeness alone **does not
fix repair coverage**. This probe is not an end-to-end v12 validation pass.

## Next experiments and stopping boundary

1. Clarify observed repair **zero** versus unknown, then test complete clean work,
   observed correction, and incomplete-history controls with unchanged thresholds.
2. Separate unconditional requested domains, conditional scope, and attempted work;
   test branch-resolution evidence without changing frozen references retroactively.
3. Test complete comparison receipts separately from taxonomy changes.
4. Only after development succeeds, freeze new independent historical references
   and run the native pipeline against them before bulk scoring.

No routing scores or installed skills were changed. Full-history scoring,
calibration and semantic validation remain unfinished.
