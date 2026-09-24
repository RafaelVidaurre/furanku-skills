# Routing retrospective: labeling and local-history audit

Date: 2026-09-24. This document distinguishes a **metadata census** from a **Jev assessment**. The census read every discoverable local Codex, Claude Code, and Grok session record in their standard stores. The only completed multi-session Jev assessment remains the earlier 17-session, selected Codex pilot. No provider-wide quality scores or routing-table changes follow from it.

## Why the pilot labels were weak

The version 3 rubric let a purchasing task count as product strategy and treated an incidental foreign-language phrase as localization. On a paper-fan shopping session, Jev chose product **central** and localization **supporting**, although the actual deliverable was buying options. Version 4 adds **procurement** and makes the boundaries of product, localization, quantitative work, and research explicit. In a controlled repeat of that same task, Jev chose product **absent** (probability 1.00), localization **absent** (0.83), research **central** (1.00), and procurement **central** (1.00). The full version 4 question set also returned only research and procurement as central for that session. Translation and game-planning positive controls retained their expected localization and product labels under the revised question wording. These are prompt-sensitivity checks, not a validated labeling accuracy estimate.

The pilot also aggregated entire conversations. One three-request asset-workflow session received nine active domain labels. Splitting its requests produced three different domain combinations: (1) verification, research, and 3D; (2) research, visual art, and 3D; (3) architecture, research, product, UI, UX, writing, and documentation. Session-level labels therefore cannot be assigned to each routed task. The original transcript parser also dropped real requests following an injected browser-context block; a UI session grew from three visible turns to eight after extraction was corrected.

The first Claude Code and Grok diagnostic calls exposed a second parser defect: an Orca dispatch wrapped in `<pasted_content>` or `<user_query>` was not recognized as a dispatch. Its long launch instructions then displaced the actual task under the text cap. Both Jev responses labeled **writing supporting**. After unwrapping and extracting the `=== TASK ===` block *before* truncation, both repeated calls removed writing. Grok's first user record was a workspace-rules injection; it is now discarded instead of treated as a request. A sweep of the 282 current-route matches then found 218 projected Claude turns beginning with a background-task notification and three with fork boilerplate; those records are now excluded as requests. One incomplete Orca preamble without a task block and four Claude compaction summaries are also excluded. Opus 5.5 adversarial review exposed a further stacked-context parser bug, which is now fixed and covered by regression tests. This demonstrates input contamination, not a need to change the writing-domain wording. The current parser still bounds long sessions to the first and last ten answered turns, truncates request and response text, and omits artifacts, images, tool results, and tests. Thus it cannot reliably score output quality or associate all work with the right task. Mixed-model sessions are refused rather than falsely assigned to one model.

The old report used `C` for **central**, `S` for **supporting**, `?` for **quality unknown**, and an em dash for **absent**. Its tables now spell these words out. A numeric quality choice runs from 0 (failed through model error) to 4 (excellent with explicit acceptance); a silent user or the assistant's own completion claim does not establish quality. The old scores should not be used for model ranking.

## Full local-file census

| Provider | Local session records scanned | Records with model metadata | Records with a raw user/assistant exchange | Mixed model/effort records |
| --- | ---: | ---: | ---: | ---: |
| Codex | 6,039 | 6,019 | 4,995 | 63 |
| Claude Code | 769 | 748 | 760 | 16 |
| Grok | 878 | 878 | 843 | 0 detected from available summary metadata |
| **Total** | **7,686** | **7,645** | **6,598** | **79 detected** |

The scan covered Codex active and archived JSONL, Claude Code project JSONL, and Grok session summaries plus chat histories. Reproduce a current census with `python3 skills/model-routing/scripts/history_inventory.py --output "$HOME/.furanku-skills/model-routing/retrospectives/history-inventory-$(date +%Y%m%d-%H%M%S).jsonl"`; the command prints provider and metadata counts and writes a private per-file inventory. File counts are a snapshot: a later scan in this same work session found 7,667 records because 22 earlier Claude files had disappeared while two Claude files and one Codex file had appeared. Stores outside the documented paths are not covered. A Grok summary reports its current model and effort, which cannot prove that earlier turns used the same settings. Claude logs show the Fable base model but do not independently prove the configured `[1m]` context variant.

| Configured route | Status | Matching session records | With raw exchange | Mixed model/effort |
| --- | --- | ---: | ---: | ---: |
| Claude Fable 5.1 `[1m]` / high | enabled | 123 | 123 | 9 |
| Claude Opus 5.5 / high | enabled | 127 | 127 | 0 |
| Codex GPT-6 Astra / high | explicit | 21 | 21 | 2 |
| Codex GPT-6 Sol / high | enabled | 2 | 2 | 1 |
| Grok 4.7 / high | enabled | 9 | 6 | 0 detected |
| Codex GPT-5.6 Terra / max | disabled | 958 | 942 | 9 |
| All other configured model/effort routes | enabled, explicit, or disabled | 0 | 0 | 0 |

These route rows sum to **1,240 distinct matching records**, **1,221 with a raw exchange**, and **21 mixed**. The 282 records matching currently enabled or explicit routes include 23 Codex, 250 Claude Code, and 9 Grok records. After filtering transport records and repairing stacked-context extraction, transcript projection succeeded for **265**: 18 Codex, 241 Claude Code, and 6 Grok. The other 17 are mixed-model, have no work turn, or lack an assistant response. The bounded projection omitted 171 answered turns from the 241 Claude sessions and truncated 225 selected requests across providers; it is not a full-session assessment. Disabled Terra contributes 958 historical matches but is excluded from current candidate calibration. A match to a configured model/effort is not proof that a routing decision launched the session.

## What was actually assessed

| Stage | Coverage | Result |
| --- | --- | --- |
| Local metadata census | All 7,686 discoverable session records | Provider, model/effort, exchange presence, and mixed-model status counted. |
| Transcript projection check | All 282 records matching currently selectable routes | 265 could be projected; 17 could not; 171 Claude turns were omitted by the bound and 225 selected requests were truncated. |
| Jev domain and quality assessment | 17 selected Codex sessions, using rubric version 3 | 82 active session/domain labels; only 12 numeric quality choices. None were calibrated capability estimates. |
| Jev version 4 diagnostic | Shopping session; targeted translation and product controls; one Claude Code and one Grok session before and after parser repair | Clearer boundaries fixed the shopping false positives. Correct task extraction removed a spurious writing label in both cross-provider cases. Every scored quality label in those two cases was **unknown**. |
| Full-history Jev assessment | **Not completed** | A two-session version 4 batch was rate-limited after the Jev client's three bounded attempts. The 265 projectable current-route records and 958 disabled-route matches were not bulk assessed. |

The private per-session inventory and Jev outputs live under the machine-global retrospective directory with user-only permissions. No transcript, session ID, or private path is committed here. The version 4 descriptions actually passed to Jev are in [`retrospective-domains.json`](../../skills/model-routing/references/retrospective-domains.json). A valid calibration run still needs task-level splitting, artifact/test evidence, routing-decision links, and enough independent observations per model, effort, and domain. It must report unknown quality and missing coverage explicitly before changing scores.
