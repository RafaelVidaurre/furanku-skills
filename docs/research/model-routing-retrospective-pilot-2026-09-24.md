# Session retrospective pilot

Date: 2026-09-24. This was a live Jev evaluation of two completed local Codex sessions, both run with GPT-6 Astra high. The request projected only actual user turns and assistant final answers. It excluded injected setup material, tool results, artifact contents, and private session identifiers. No transcript or evaluation payload is committed.

The assessment used separate Choice questions for completion, quality, user correction, and seven work domains. These questions returned classifications and option probabilities, without explanations or cited evidence. The pilot tests feasibility and uncertainty handling; it does not estimate model ability or routing accuracy. The original sessions were not linked to a recorded routing decision.

| Session shape | Jev's relevant results | What the evidence supports |
| --- | --- | --- |
| Three-turn asset-workflow review and design proposal | Completion `complete` 0.47 vs `partial` 0.33; quality `unknown` 0.88; architecture 0.99, 3D 0.95, UX 0.97, writing 1.00; UI tied 0.50/0.50 | The domains reflect the work discussed. The transcript cannot verify the delivered artifact, so no quality score should be assigned. The UI tie is not a positive label. |
| Short guidance-wizard interaction followed by a user “what?” | Completion `unknown` 0.72; quality `unknown` 0.53; user correction `unclear` 0.51 | The visible exchange shows confusion, but cannot establish whether the requested guidance work was ultimately completed. A one-word user response is too ambiguous to classify as a definite correction. |

Both requests succeeded through the existing Vercel AI Gateway Jev client. The first used about 4,501 input and 349 output tokens; the second used about 1,476 input and 350 output tokens. These are sample costs, not forecasts for full transcripts. The existing client accepts Choice questions only, so it cannot return an evidence citation or free-form reason. A future retrospective needs an evidence extraction step or a different structured assessment path for auditable labels.

## Implications for the follow-up epic

- Link routing decisions to actual launched worker sessions. A parent session or model name alone does not prove which decision produced which work.
- Assess task outcomes, not just entire sessions: one session may contain several assignments, domains, and revisions. Pass available session evidence at review time; the routing journal need not retain Jev prompts or transcripts.
- Freeze a domain taxonomy and assessment rubric before calibration. Treat unknown quality and ambiguous corrections as missing evidence rather than a neutral or negative score.
- Verify artifacts and acceptance checks where possible. Distinguish user-requested iteration from repair of an error. Track whether the work was abandoned for external reasons.
- Estimate domain-level model/effort quality with explicit sample size and uncertainty, shrink sparse cells toward a common prior, and bound the influence of any one session. Compare against an agent or simple-rule route baseline before replacing catalog heuristics.
