# Routing retrospective: labeling and local-history audit

Date: 2026-09-24. This document distinguishes a **metadata census**, Jev classifications, and evidenced quality scores. The initial census covered the standard Codex, Claude Code, and Grok stores; later sections expand it to Orca-managed Codex homes, deduplicate mirrored sessions, and analyze every configured model/effort match. A complete first-follow-up classification is available, but no provider-wide quality scores or routing-table changes follow from it.

## Why the pilot labels were weak

The version 3 rubric let a purchasing task count as product strategy and treated an incidental foreign-language phrase as localization. On a paper-fan shopping session, Jev chose product **central** and localization **supporting**, although the actual deliverable was buying options. Version 4 adds **procurement** and makes the boundaries of product, localization, quantitative work, and research explicit. In a controlled repeat of that same task, Jev chose product **absent** (probability 1.00), localization **absent** (0.83), research **central** (1.00), and procurement **central** (1.00). The full version 4 question set also returned only research and procurement as central for that session. Translation and game-planning positive controls retained their expected localization and product labels under the revised question wording. These are prompt-sensitivity checks, not a validated labeling accuracy estimate.

The pilot also aggregated entire conversations. One three-request asset-workflow session received nine active domain labels. Splitting its requests produced three different domain combinations: (1) verification, research, and 3D; (2) research, visual art, and 3D; (3) architecture, research, product, UI, UX, writing, and documentation. Session-level labels therefore cannot be assigned to each routed task. The original transcript parser also dropped real requests following an injected browser-context block; a UI session grew from three visible turns to eight after extraction was corrected.

The first Claude Code and Grok diagnostic calls exposed a second parser defect: an Orca dispatch wrapped in `<pasted_content>` or `<user_query>` was not recognized as a dispatch. Its long launch instructions then displaced the actual task under the text cap. Both Jev responses labeled **writing supporting**. After unwrapping and extracting the `=== TASK ===` block *before* truncation, both repeated calls removed writing. Grok's first user record was a workspace-rules injection; it is now discarded instead of treated as a request. A sweep of the 282 current-route matches then found 218 projected Claude turns beginning with a background-task notification and three with fork boilerplate; those records are now excluded as requests. One incomplete Orca preamble without a task block and four Claude compaction summaries are also excluded. Opus 5.5 adversarial review exposed a further stacked-context parser bug, which is now fixed and covered by regression tests. This demonstrates input contamination, not a need to change the writing-domain wording. The current parser still bounds long sessions to the first and last ten answered turns, truncates request and response text, and omits artifacts, images, tool results, and tests. Thus it cannot reliably score output quality or associate all work with the right task. Mixed-model sessions are refused rather than falsely assigned to one model.

The old report used `C` for **central**, `S` for **supporting**, `?` for **quality unknown**, and an em dash for **absent**. Its tables now spell these words out. A numeric quality choice runs from 0 (failed through model error) to 4 (excellent with explicit acceptance); a silent user or the assistant's own completion claim does not establish quality. The old scores should not be used for model ranking.

## Initial standard-store census

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

These route rows sum to **1,240 distinct matching records**, **1,221 with a raw exchange**, and **21 mixed**. The 282 records matching currently enabled or explicit routes include 23 Codex, 250 Claude Code, and 9 Grok records. After filtering transport records and repairing stacked-context extraction, transcript projection succeeded for **265**: 18 Codex, 241 Claude Code, and 6 Grok. The other 17 are mixed-model, have no work turn, or lack an assistant response. The bounded projection omitted 171 answered turns from the 241 Claude sessions and truncated 225 selected requests across providers; it is not a full-session assessment. Disabled Terra's historical work remains relevant to performance analysis, although the disabled route cannot be selected now. A match to a configured model/effort is not proof that a routing decision launched the session.

## What was actually assessed

| Stage | Coverage | Result |
| --- | --- | --- |
| Local metadata census | All 7,686 discoverable session records | Provider, model/effort, exchange presence, and mixed-model status counted. |
| Transcript projection check | All 282 records matching currently selectable routes | 265 could be projected; 17 could not; 171 Claude turns were omitted by the bound and 225 selected requests were truncated. |
| Jev domain and quality assessment | 17 selected Codex sessions, using rubric version 3 | 82 active session/domain labels; only 12 numeric quality choices. None were calibrated capability estimates. |
| Jev version 4 diagnostic | Shopping session; targeted translation and product controls; one Claude Code and one Grok session before and after parser repair | Clearer boundaries fixed the shopping false positives. Correct task extraction removed a spurious writing label in both cross-provider cases. Every scored quality label in those two cases was **unknown**. |
| Full-history domain/quality assessment at the initial pilot stage | **Not completed** | A two-session version 4 batch was rate-limited after the Jev client's three bounded attempts. The later 558-session first-follow-up census classifies reactions, not full-session domains or quality. |

The private per-session inventory and Jev outputs live under the machine-global retrospective directory with user-only permissions. No transcript, session ID, or private path is committed here. The domain descriptions actually passed to Jev are in [`retrospective-domains.json`](../../skills/model-routing/references/retrospective-domains.json). A valid model-performance calibration needs task-level splitting, artifact/test and feedback evidence, and enough independent observations per model, effort, and domain. Routing-decision links are needed only to evaluate whether the router selected well. Unknown quality and missing coverage must be reported explicitly before changing scores.

## Linked-decision gate checked later the same day

The first exact-link coverage check read 80 retained routing-journal events at 12:57 UTC. It found 44 selected verdicts: 22 had no worker link recorded, while 22 links did not match a local agent session ID. An unlinked verdict may have been a diagnostic check or a route that was never launched; an unresolved link may also identify a session held elsewhere. **Zero selected verdicts could be attributed to a local transcript by exact ID.** The count can change as active work continues. Orca's Agent Session History search reported `enabled: false`, so its host index could not be used to resolve older references. Live terminal listings matched only a few handles and did not expose a durable agent session ID. No model outcome score follows from these links. The coverage command was then expanded to include exact-route verdicts and to scan the entire retained journal, bounded at 100,000 events.

For future decisions, link the actual agent session ID when available. An earlier terminal or dispatch link can remain as launch evidence; the coverage check uses a unique reference that matches a local agent session. Model-performance analysis instead starts from every informative session with a verified model and effort, including sessions predating the router. Split work by task, inspect artifacts, tests, and user follow-ups, audit Jev's domain and feedback labels, and then estimate model/effort performance with uncertainty. Exact links remain necessary to judge the router's own choices.

After Opus 5.5 reviewed the coverage check, a corrected run at 13:06 UTC scanned all 87 retained journal events and included exact-route verdicts. It found **48 routable verdicts**: 23 without a recorded worker link and 25 whose references could not be matched to a local agent session. A missing link does not prove a launch; an unresolved reference does not prove the transcript is unavailable. The number of safely attributable routed outcomes remained **zero**. The private report records each disposition for later repair.

## Expanded Orca history and recovered links

After Orca Agent Session History was enabled, its search found recent worker and coordinator sessions. That exposed a census omission: Orca keeps Codex sessions in separate account homes. An initial raw scan of those homes plus the standard stores found over 40,000 files, but many Codex files were mirrored across accounts as hard links or older copies. A later scan counted each native session once and kept its local copies for link validation. It yielded **9,981 session records**: 8,348 Codex, 755 Claude Code, and 878 Grok. Of these, 9,919 had model metadata, 8,760 had a raw user/assistant exchange, and 206 contained more than one model/effort tuple. This is a local snapshot, not an account-wide or cloud census.

| Configured model and effort | Distinct local sessions | Raw exchange | Mixed model/effort |
| --- | ---: | ---: | ---: |
| GPT-6 Sol / high | 102 | 102 | 5 |
| GPT-6 Sol / max | 6 | 6 | 1 |
| GPT-6 Astra / high | 498 | 498 | 8 |
| GPT-6 Astra / xhigh | 2 | 2 | 0 |
| GPT-5.6 Terra / max | 1,031 | 1,017 | 14 |
| Claude Opus 5.5 / high | 134 | 134 | 0 |
| Claude Fable 5.1 base model / high | 128 | 128 | 9 |
| Grok 4.7 / high | 9 | 6 | 0 detected |

The configured GPT-6 Sol/xhigh and GPT-6 Luna/max routes had no matching local records in this snapshot. Fable's transcript identifies its base model, not whether the configured 1M context variant was active. The row counts can overlap when a session changed model or effort. Historical matches do not prove that model routing selected those sessions.

## Model-performance corpus, independent of routing

The expanded inventory was rechecked against **every configured model and effort**, including disabled and explicit routes. It found **1,909 distinct matching sessions**. The bounded transcript parser projected 1,821 single-model sessions; 36 changed model or effort, 17 lacked a raw user/assistant exchange, and 35 had no usable work turn or assistant response. These dispositions sum to 1,909. After extracting the actual `ARGUMENTS:` from Claude skill invocations and excluding injected skill instructions and transport notifications, **1,263** projected sessions have one answered work turn and **558** have at least two; 27 projected sessions also end with an unanswered user message. Claude tool-result records with `sourceToolUseID` are excluded, while genuine coordinator requests are retained even when marked `isMeta`. This is a corpus and evidence-availability count, **not 1,821 quality assessments**. The mixed sessions require turn-level model attribution rather than a whole-session score. A one-turn session may still have useful artifact or test evidence, but silence after its final answer is not approval.

| Historical model / effort | Matching sessions | Projected | One turn | Multiple turns | Other dispositions |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-5.6 Terra / max | 1,031 | 987 | 668 | 319 | 44 |
| GPT-6 Astra / high | 498 | 472 | 359 | 113 | 26 |
| GPT-6 Astra / xhigh | 2 | 2 | 2 | 0 | 0 |
| GPT-6 Sol / high | 102 | 96 | 74 | 22 | 6 |
| GPT-6 Sol / max | 6 | 5 | 4 | 1 | 1 |
| Claude Opus 5.5 / high | 134 | 134 | 79 | 55 | 0 |
| Claude Fable 5.1 base / high | 128 | 119 | 74 | 45 | 9 |
| Grok 4.7 / high | 9 | 6 | 3 | 3 | 3 |

No local match was found for configured GPT-6 Sol/xhigh or GPT-6 Luna/max. A mixed session can appear in two route rows, so row totals exceed the distinct-session count by one. The Fable base-model row still cannot prove its configured 1M context variant. These counts are reproducible with [`performance_census.py`](../../skills/model-routing/scripts/performance_census.py) against the private deduplicated inventory.

This census exposes the earlier selection error: Jev involvement and a journal link have no bearing on whether a session can teach us about a model's ability in a work domain. They matter only when measuring the router's selection policy. A model-performance observation requires a reliably identified model and effort, an actual work request, domain-specific outcome evidence, and a quality judgment whose uncertainty is retained. Repeated turns and workers on one task must not be counted as independent trials. The current parser limits long transcripts and omits tool results, artifacts, images, and later feedback in other sessions, so its projections alone cannot support a capability table.

An art-session check shows why the unit of analysis matters. The first requested helmet received an explicit negative style correction. Whole-session Jev scoring returned `unknown` for art and 3D because later requests were folded in. When given only the first request, first response, and correction, Jev scored the art result **1 of 4**. A broad question also scored 3D and animation as failures, although the correction addressed style and the deliverable was a static reference sheet. A targeted repeat correctly marked animation **absent** and 3D quality **unknown**. Version 5 of the taxonomy now draws those boundaries explicitly. This is one diagnostic example, not evidence that Astra's domain score is 1; it demonstrates both recoverable feedback and prompt sensitivity that must be audited before aggregation.

An earlier one-off scan of the then-current 1,258 one-turn sessions found **428** with a recognizable passing-test summary in tool output. The parser correction changed the one-turn count to 1,263; the marker scan has not been rerun against that final set, so 428 is only a pilot finding. In any case, a test-output marker is not a task-success verdict. The output still needs to be tied to the requested change, checked for meaningful coverage, and combined with artifacts or later user feedback.

A first-follow-up Jev pass classified the final **558** multi-turn sessions as **86 explicit negative reactions, 7 positive reactions, 287 neutral continuations, 87 independent new tasks, and 91 status or unclear messages**. Of these, 555 had unchanged first-two-turn projections from the earlier pass; three changed projections were reassessed. This asks whether the second requester message evaluates the first response; it does not score any session. Manual spot checks found negative labels caused by transport truncation, coordinator stop messages, and scope corrections alongside genuine output complaints. The first ten attempted domain-quality assessments exposed another failure: a scope correction was assigned low scores in unrelated architecture, science, and product domains. That scoring pass was stopped. A retrospective needs separate axes for *what work was requested*, *which part of the output was criticized*, and *whether the event was an instruction-following, external, or preference-change issue*. A process error should affect a process-reliability measure, not every domain touched by the task.

A second Jev pass over the **93** explicit reactions classified **46 output defects, 32 instruction/scope violations, 6 newly stated preferences, 2 external interruptions, 6 explicit acceptances, and 1 unclear event**. These labels are candidate evidence. Some first requests only name an external task packet or Beads record; classifying their domains without resolving that contract produced false labels in a four-session score pilot. Feedback from a coordinator or agent requester is also different from direct human feedback and needs its provenance retained. The visible feedback can address just one domain in a multi-domain task. The pilot was stopped rather than averaging those scores. The private per-session classification files preserve every probability and uncertainty for audit; no model/domain capability estimates have been promoted into routing.

The original sword-swing reference image could not be opened through the local image viewer (`Operation not permitted`), so that art example has user correction evidence but no independently inspected visual artifact. The retrospective must represent that as a visibility gap, not a verified art-quality judgment.

Six focused first-outcome checks were also run with explicit domain questions and the stricter quality rubric, where ordinary acceptance is at most **3 of 4**. Only two observations passed a manual evidence check:

| Historical route | Domain | Jev result | Evidence decision |
| --- | --- | ---: | --- |
| GPT-6 Astra / high | Debugging | 3 | Accepted observation: the user confirmed the targeted fix worked. |
| GPT-6 Astra / high | Implementation | 3 | Accepted observation: a reviewer accepted the change and focused checks. |
| GPT-5.6 Terra / max | Verification | 2 | Tentative; low Jev confidence and external acceptance criteria. |
| GPT-6 Astra / high | Implementation | 2 | Tentative; low Jev confidence on a correction. |
| GPT-5.6 Terra / max | Verification | Unknown | Outcome evidence did not establish quality in this domain. |
| GPT-5.6 Terra / max | Debugging | Unknown | The task contract was external and unavailable in the projected request. |

The two accepted rows are **individual outcomes**, not Astra capability estimates. There are no supported route comparisons, and no score-table change follows. The complete 1,909-row session disposition table, 93 reaction labels, six focused judgments, and all 21 domain descriptions are in the private machine-local report. The current pilot is intentionally conservative: a 4 requires independent exceptional-quality evidence, not merely a passing test or ordinary acceptance.

The Orca resolver checks a dispatch's assigned terminal and worktree, then requires a worker preamble with the exact dispatch ID, Task ID, and terminal handle. Opus 5.5 adversarial review found that the first pass could accept a preamble after earlier assistant work and could treat an incomplete search index as proof of uniqueness. The corrected resolver checks opening messages across every local copy of each native session and records dispatch state. One earlier append-only link failed this stricter proof and is now gated `dispatch_unverified`. At the 14:05 UTC retained-window snapshot, Orca's index was current and 58 selected or exact verdicts had these dispositions:

| Disposition | Decisions | Meaning |
| --- | ---: | --- |
| Exact transcript match | 18 | Agent, model, effort, session ID, exchange, and timing matched; no incomplete dispatch was recorded. |
| Fable base model matched; 1M context unverified | 4 | Worker identity was proved, but the context variant was not. |
| Dispatch failed or remains running | 1 | Transcript exists but the dispatched work is not a completed quality observation. |
| Dispatch proof unverified | 1 | An earlier link did not pass the stricter opening-preamble check. |
| Terminal or dispatch reference unresolved | 11 | No unique worker session was proved. |
| No worker link recorded | 23 | May include decisions that were never launched. |

The corrected resolver proved 22 dispatches: 21 completed and one failed when inspected. The journal also contains one direct review session link and one earlier link that failed revalidation. All 24 linked decisions point to distinct native sessions in this snapshot. A transcript match establishes identity; it does not by itself establish work quality. The journal and per-decision proof report remain private.

Three linked sessions were then passed through the then-current version 4 Jev pilot. One Opus worker received ten active domain labels and one Fable worker received seven; **all 17 domain quality choices were `unknown`**. A Sol worker initially received no domain labels because its transcript's task text was a Crew envelope pointing to a Beads work record. Feeding Jev that actual work description changed the result to four central domains: implementation, verification, UI visual design, and UX interaction. This is direct evidence that linked sessions still need task-source resolution before domain classification. It is not a validated quality score. The current Jev transcript projection omits artifacts and tool results; until the task contract, output evidence, and user follow-ups are attached per work outcome, numeric model/domain scores would be misleading.

| Linked pilot session | Central domains | Supporting domains | Quality result |
| --- | --- | --- | --- |
| Claude Opus 5.5 / high | Implementation, debugging, verification, operations, UI visual, UX interaction | Architecture, security, writing, documentation | Unknown in all ten active domains. |
| Claude Fable 5.1 base / high | Debugging, verification, operations, security, research | Writing, documentation | Unknown in all seven active domains; 1M context variant unverified. |
| GPT-6 Sol / high, transcript only | None | None | No domain quality question was asked. |
| Same GPT-6 Sol task with its work record | Implementation, verification, UI visual, UX interaction | None | Domain correction only; quality not assessed. |

## Expanded whole-session audit and correction

The expanded pass attempted all **570 sessions without a mechanical delegation flag** and 344 additional parent or coordinator sessions before stopping that low-yield pass. It produced 905 completed assessments and nine per-session errors, leaving 907 of the 1,821 projectable sessions pending. Parent sessions can contain directly performed work as well as delegation, so the flag is a triage signal, not a final exclusion for every task inside them.

The first whole-session report was misleading. Jev gave **294 positive writing labels** to one repeated prompt template, with no independent check or user acceptance in those one-turn records. It also called a provider outage and an existing product defect model failures. The report now retains those raw labels for audit but excludes one-turn positive labels without a linked check and low labels without a separately established model-domain cause. A six-session cause review of the remaining numeric candidates retained **one explicitly user-confirmed GPT-6 Astra/high debugging outcome**; the other five first outcomes were unverified or attributable to external conditions. The corrected whole-session report has zero model/effort/domain cells meeting even the preliminary five-session, three-task-family coverage threshold. No historical quality score is being applied to routing.

The next unit is a **requested work outcome**, not a session or Jev label. Mechanically join its originating request, worker transcript, exact model and effort, linked checks, produced artifacts, and subsequent user feedback. Record whether any defect came from the model's domain work, an instruction violation, a changed requirement, or an external blocker. Jev can then classify involved domains and assess the evidence packet; its cause and quality labels need a stratified manual audit before aggregation. Rendered art, UI, and 3D work need visual evidence. Aggregate independent task families with uncertainty and bounded repeated-template influence, then compare a proposed mechanical router against the current selector in shadow mode before changing live scores.

A first task-packet pass joined the 22 proved Orca dispatches to the deduplicated local inventory. **17** have a completed, exactly attributed worker transcript and task preamble; **one** dispatch failed; **four** only show the base Claude model, leaving the configured 1M context variant unverified. The 17 complete packets cover 14 GPT-6 Sol/high workers and three Claude Opus 5.5/high workers. None has a worker-side check captured by the current extractor. Twelve have later parent-session user-channel messages, but those include orchestration notices and have not been tied to the task as feedback; three have no later channel message, and two parent sessions are unavailable. These are evidence packets with null quality, not 17 performance observations. The detailed packets stay private and are reproducible with [`task_outcome_packets.py`](../../skills/model-routing/scripts/task_outcome_packets.py).

The same check extractor scanned all **1,821** projectable historical sessions, regardless of Jev routing. It found recognizable test output in **140**; **101** had a check on the first substantive work turn, while **39** only had checks on later turns. Among the 101, **87** also performed delegation, so their recorded check cannot automatically be credited to the parent model's own work. These are candidate evidence sources, not passing outcomes. A targeted Jev pass assessed 30 of the 101 before it was stopped for rubric repair. Five preliminary positive labels all came from GPT-5.6 Terra/max tasks in one project; inspection found that a reported boot-size table was being treated as an inspectable deliverable and an unrelated test as support. The revised rubric asks separately whether the test checks the first requested behavior and whether the response shows the whole deliverable. On rechecking those five, **two** remained provisional positives, **two** were demoted to unverified for missing direct evidence, and **one** was already unverified. Neither provisional positive has been promoted into routing: the external task plans, produced changes, and coordinator acceptance still need to be joined and audited. The other 71 check candidates have not been assessed with the repaired rubric.
