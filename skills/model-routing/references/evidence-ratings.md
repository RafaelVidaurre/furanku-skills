# Provisional ratings from reviewed evidence

Use after source review to aggregate existing observations without more assessor
calls. These are descriptive ratings; the comparison and deployment gates in
[Routing evidence readiness](routing-evidence.md) still apply.

## Prepare one contribution per original task and model/effort

Store a private JSON document with `version: 1`, `reviewed_files` (each containing
`path` and `sha256`), and `contributions`. Select one review revision explicitly.
Preserve earlier attempts and review files; merging them is a source review, not
an automatic maximum-score or latest-timestamp choice.

Each contribution contains:

| Field | Contract |
| --- | --- |
| `original_task_id` | Stable identity shared by continuations and retries. Separate models can have separate contributions to the same original task. |
| `model`, `effort` | Native execution attribution. |
| `family`, `project` | Reviewed grouping, not a new family for every retry. Resolve unknown grouping before pooling. |
| `selection` | `baseline`, `supplement`, `mixed`, or `unknown`. |
| `review_status` | `source_reviewed` for accepted source audits. Other states are excluded. |
| `source_ids` | Catalog of cited native anchors, namespaced by session when combining attempts. |
| `attempts` | All contributing attempts: `session_ref`, `source_sha256`, `request_ids` (namespaced native anchors). |
| `task_outcome` | The mandatory original/final completion, scope and intervention structure in [Domain assessment](domain-assessment.md). |
| `repairs` | Existing observed repairs with responsibility, rationale and sources; group repeated attempts to repair one mistake. |
| `domains` | All taxonomy entries: `id`, `role`, `score`, `rationale`, `source_ids`. Select the reviewed final outcome for each domain; retain prior observations in their original review files. |

For v2 assessments, reuse the reviewed `task_outcome`, repairs and domain values.
For legacy results, add source-reviewed annotations or explicit unknowns. Never
infer overall task completion from a domain score. The original task may have
other unproved deliverables. A scope revision can be legitimate and still leave
original work unfinished. Feedback coverage describes available evidence, not
the confidence of the model's prose.

**Complete when:** lineage and the selected review revision are explicit, every
annotation cites the native evidence, and the input preserves unknown outcomes
and unscored domains alongside successful observations.

## Build the report

```sh
python3 <skill-dir>/scripts/evidence_ratings.py \
  --repo <root> --input <private-reviewed-evidence.json> \
  --output <private-ratings.json>
```

The command verifies referenced review-file hashes, uses effective configured
model/effort combinations, and writes private JSON plus adjacent Markdown. Retired
combinations are excluded; disabled and explicit combinations remain historical
evidence. It makes no model calls and writes no routing configuration.
An identical repeat reuses both outputs. Changed input or report content requires
a new output revision; a missing companion file can be recovered without rewriting
the existing evidence.

Duplicate original-task/model contributions and overlapping native request anchors
are errors: reconcile their lineage or revision rather than double counting.
The JSON includes every configured combination × domain, including unrated cells.

The **observed rating** is the lower median of ordinal final-quality observations
whose task scope stayed unchanged. A two-task cell with grades 2 and 3 has grade 2,
not an invented fractional quality. Narrowed, expanded, replaced and unknown
scope observations remain in a separate final-scope histogram. This conservative
exclusion can be relaxed only by a reviewed domain-specific contract mapping.

Every cell includes original-task completion counts, rated and unscored tasks,
family/project counts, selection strata, observed correction burden and feedback
coverage. Correction counts refer to whole tasks; they are not domain-specific
mistake rates and must not be summed across domain rows. Multiple models on the
same task likewise remain dependent observations.

Unknown-outcome bounds replace unknowns with their best and worst possible outcomes
in this selected sample. They are **not confidence intervals or future success
probabilities**. Leave-one-family-out ratings show dependence on a family; null
means removing it leaves no rated evidence. Report the complete ordinal histogram
beside the median so one outlier or severe failure stays visible.

The existing collection checkpoints supply `examples_only`, `early_signal`, or
`requires_comparison_validation`; those labels never authorize a routing update.
Confidence remains `not_calibrated`, and value remains unknown without matched work
and attributable total costs. The report does not fit a population model or invent
prices for corrections.

**Complete when:** the report gives provisional observations with support and
uncertainty, preserves missingness and scope changes, and keeps routing ineligible
until the separate comparison protocol is satisfied.
