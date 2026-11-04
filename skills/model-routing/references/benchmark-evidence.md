# How benchmark evidence reaches a launch

`routing-catalog.json` owns the capability data and built-in task preferences.
Each candidate is an exact agent/model/effort tuple. Its `methodology` names
the measurement and transform for each dimension; consult it when adding or
refreshing scores. Research notes alone do not update routing.

## Consumers

- `router.py brief` renders conservative scores, confidence, benchmark scale,
  assessment dates, source URLs, and uncertainty for the spawning agent.
- The spawning agent judges task fit using that brief
  and applicable preferences. There is no weighted overall score or automatic
  leaderboard winner.
- `check` enforces eligibility, features, context, launch surface, authentication,
  quota, and maximum-effort proportionality. It does not validate the selector's
  comparative benchmark reasoning or apply a minimum capability score.
- Crew consumes the resulting decision and launch tuple; it does not maintain
  a separate model ranking.

## Limits and maintenance

Capability data is a manually researched snapshot. A fresh brief refreshes
quota, not benchmark results. Assessment dates are displayed but do not expire
capability evidence automatically. Existing candidates can therefore have
older observations than newly added models.

Compare exact efforts on the same benchmark version and harness scale. A
normalized number is not a universal success probability. Conservative
deductions are documented estimates, not measured confidence intervals unless
the underlying source publishes an interval. Rank percentiles also depend on
the dated board population. Unknown means unmeasured, not zero capability.

Task-fit preferences are qualitative instructions, distinct from measurements.
API prices, benchmark dollars per task, output speed, and subscription quota
answer different questions. Local usage-drain reports are not automatically
ingested into routing, and no local evaluation feeds capability scores.

After an evidence refresh, validate the catalog and inspect the brief. Completion means each changed score has a source,
date, exact effort, scale, and documented conservative derivation; unsupported
dimensions remain unknown.

## Claude 5.5 evidence added on 2026-10-08

Sonnet 5.5 and Haiku 5.5 each expose all five efforts. Their verified model
IDs, context and modalities come from the official
[Sonnet overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)
and [Haiku overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview).
Claude Code requires v2.1.284 or later for Sonnet 5.5 and v2.1.293 or later for
Haiku 5.5; verify the installed launcher against the
[model configuration docs](https://code.claude.com/docs/en/model-config)
before launch. The catalog uses full model IDs because provider aliases can
resolve to older models. Catalog eligibility alone does not prove the installed
CLI can serve a model.

Independent exact-effort coding measurements come from
[CursorBench 4.0](https://cursor.com/evals). Vendor launch-table results on
Terminal-Bench or FrontierCode are separate evidence and do not populate the
CursorBench dimension. Each remaining measurement cites its operator in the
catalog. Performance in those operators' harnesses is not a local Claude Code
acceptance run.
