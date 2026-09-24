# Historical session mining pilot

Date: 2026-09-24. This is a **pilot**, not a calibrated model leaderboard. Seventeen selected local Codex sessions were assessed live with Jev via the existing Vercel AI Gateway client. They were chosen to cover different deliverables and model/effort settings, not sampled randomly. The private per-question distributions and session filenames remain in the machine-global retrospective file; no transcript or session ID is committed.

## Exact domain rubric passed to Jev

Each of the following descriptions was included in a separate Jev Choice question. The three offered involvement options were: **absent** = not part of the requested deliverable; **supporting** = affects the deliverable but success is mainly judged elsewhere; **central** = poor work in this domain would fail the main acceptance criteria. Jev was told to judge the requested deliverable, exclude incidental mentions and ordinary revisions, and allow multiple central domains. This is taxonomy version 3.

| Domain | Description in the Jev question |
| --- | --- |
| `implementation` | Write or change executable software, scripts, APIs, integrations, or configuration. |
| `debugging` | Find causes of software or system defects or incidents and verify a repair. Ordinary creative revisions are outside this domain. |
| `verification` | Design or run software/system tests, audit behavior, review code, or check an implementation against a specification. Ordinary source fact checking belongs to research. |
| `architecture` | Design component boundaries, data flows, interfaces, infrastructure, or a technical migration. |
| `operations` | Deploy, release, configure, monitor, or operate a running system and its automation. |
| `security` | Assess or implement security, privacy, authentication, authorization, or abuse controls. |
| `research` | Deliver a sourced synthesis, comparison, or factual investigation of external or repository information. Routine code reading during implementation or review is outside this domain. |
| `quantitative` | Calculate, analyze data, model uncertainty, or draw statistical conclusions. |
| `science` | Reason through explicit scientific, mathematical, or engineering concepts beyond routine arithmetic. Visual depiction of physical objects alone is outside this domain. |
| `product` | Define product goals, requirements, priorities, tradeoffs, or acceptance criteria. |
| `game_design` | Design game mechanics, levels, progression, balance, or player learning and engagement. |
| `ui_visual` | Design the visible layout, typography, colors, iconography, or visual hierarchy of an interface. |
| `ux_interaction` | Design user journeys, controls, information architecture, accessibility, or interaction behavior. |
| `visual_art` | Create or direct illustration, concept art, graphic assets, textures, or game visual style. |
| `spatial_3d` | Create or reason about 3D models, geometry, rigging, spatial composition, or physical form. |
| `animation` | Create or direct motion, poses, keyframes, timing, or transitions. |
| `audio` | Create, edit, select, or evaluate sound, music, speech, or audio behavior. |
| `writing` | Write or edit general prose, copy, narrative, or communication for a human audience. Technical instructions and specifications belong to documentation. |
| `localization` | Translate or adapt language and cultural context while preserving intended meaning and voice. |
| `documentation` | Write instructions, specifications, or explanatory reference material for a system or process. Visual reference images alone are outside this domain. |

For each non-absent domain, a second Jev Choice question asked for **actual performance** from visible user feedback and response content: `0` failed/abandoned due to model error, `1` major mistakes or repeated repair, `2` usable but incomplete with meaningful correction, `3` good and accepted with at most minor correction, `4` excellent and explicitly accepted without meaningful correction, or `unknown` when the visible evidence cannot establish quality. It expressly said not to infer acceptance from silence or trust the assistant’s own completion claim as verification. Both calls received the same per-session projection: actual user requests and the last assistant response after each request, capped at 20 turns with bounded text; injected setup and Orca dispatch preambles were removed. Artifacts, tool logs, and images were not included.

## Sessions assessed

| ID | Work | Model / effort | Visible turns |
| --- | --- | --- | ---: |
| S01 | MMORPG equipment turnarounds | `gpt-6-astra high` | 5 |
| S02 | 3D asset pipeline and guidance | `gpt-6-astra high` | 3 |
| S03 | Guest drawer UI | `gpt-6-astra high` | 8 |
| S04 | Codex TUI changes research | `gpt-6-astra high` | 3 |
| S05 | Wedding message translation | `gpt-5.6-sol high` | 2 |
| S06 | Event drink quantities | `gpt-5.6-sol high` | 8 |
| S07 | Physics learning game plan | `gpt-5.6-sol high` | 1 |
| S08 | Character illustration style | `gpt-5.6-sol medium` | 3 |
| S09 | Sword-swing keyframes | `gpt-6-astra high` | 9 |
| S10 | World editor review and repair | `gpt-5.6-luna max` | 1 |
| S11 | World server verification | `gpt-5.6-luna max` | 1 |
| S12 | Character deformation proof | `gpt-5.6-luna max` | 2 |
| S13 | Animation rig rescue | `gpt-5.6-sol xhigh` | 4 |
| S14 | World visuals rescue | `gpt-5.6-sol xhigh` | 6 |
| S15 | Recipe video extraction | `gpt-6-astra high` | 5 |
| S16 | Barber search | `gpt-6-astra high` | 3 |
| S17 | Paper fan sourcing | `gpt-5.6-sol high` | 3 |

## Every domain result

Cells combine involvement and quality: `C2` = central, quality 2/4; `S?` = supporting, quality unknown; `—` = Jev chose absent. These are Jev’s modal answers, not verified outcomes. The private file retains all option distributions. Abbreviations map to the domain IDs above.

| Session | Impl | Debug | Verify | Arch | Ops | Sec | Research | Quant | Science | Product |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S01 | — | — | — | — | — | — | — | — | — | — |
| S02 | — | — | S? | C? | — | — | C? | — | — | C? |
| S03 | C? | — | S? | S? | S? | — | — | — | — | — |
| S04 | — | — | — | — | — | — | C? | — | — | — |
| S05 | — | — | — | — | — | — | — | — | — | — |
| S06 | — | — | — | — | — | — | — | C2 | — | — |
| S07 | S? | — | S? | S? | — | — | C? | — | S? | C? |
| S08 | — | — | — | — | — | — | — | — | — | — |
| S09 | — | — | — | — | — | — | — | — | — | — |
| S10 | C? | C? | C? | — | — | — | — | — | — | — |
| S11 | — | C? | C? | — | S? | — | S? | — | — | — |
| S12 | C? | — | C? | S? | — | — | — | S? | S? | — |
| S13 | C? | C? | C? | S? | — | — | S? | S? | C? | S? |
| S14 | C? | S? | C? | S? | — | — | S? | — | — | C? |
| S15 | — | — | — | — | — | — | C2 | — | — | — |
| S16 | — | — | — | — | — | — | C2 | — | — | — |
| S17 | — | — | — | — | — | — | C? | S? | — | C? |

| Session | Game | UI | UX | Art | 3D | Motion | Audio | Writing | Locale | Docs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S01 | — | — | — | C? | C? | — | — | — | — | — |
| S02 | — | S? | S? | — | S? | — | — | S? | — | C? |
| S03 | — | C? | C? | — | — | — | — | — | — | — |
| S04 | — | — | — | — | — | — | — | — | — | C? |
| S05 | — | — | — | — | — | — | — | C3 | C3 | — |
| S06 | — | — | — | — | — | — | — | — | — | — |
| S07 | C? | — | C? | — | — | — | — | — | — | C? |
| S08 | — | — | — | C? | — | — | — | — | — | — |
| S09 | — | — | — | C2 | C2 | C2 | — | — | — | — |
| S10 | — | — | — | — | — | — | — | — | — | S? |
| S11 | — | — | — | — | — | — | — | — | — | — |
| S12 | — | — | — | S? | S? | S? | — | — | — | — |
| S13 | — | — | — | — | C? | C? | — | — | — | S? |
| S14 | — | — | — | C? | C? | S? | — | — | — | S? |
| S15 | — | — | — | — | — | — | — | C2 | C2 | C2 |
| S16 | — | — | — | — | — | — | — | S2 | — | — |
| S17 | — | — | — | — | — | — | — | — | S? | — |

## What can be mined now

Jev marked 82 of 340 session–domain cells involved. It returned a numeric quality choice for 12 of those 82 cells, spanning five sessions; 70 remained unknown. Eleven numeric cells were central. Multiple domain scores from one session are correlated observations, not independent trials.

| Model / effort | Sessions | Central numeric observations | Limit |
| --- | ---: | --- | --- |
| `gpt-6-astra high` | 7 | Art 2, 3D 2, Motion 2 (one session); Research 2 (two sessions); Writing 2, Locale 2, Docs 2 (one session) | Research in the recipe session was nearly tied with `unknown` (0.43 vs 0.40); no verified artifact grading. |
| `gpt-5.6-sol high` | 4 | Writing 3, Locale 3 (one session); Quant 2 (one session) | No repeated domain result; Quant’s modal probability was 0.48. |
| `gpt-5.6-luna max` | 3 | None | Worker artifacts and acceptance absent from the projection. |
| `gpt-5.6-sol xhigh` | 2 | None | Worker artifacts and acceptance absent from the projection. |
| `gpt-5.6-sol medium` | 1 | None | Generated image absent from the projection. |

These results **cannot support a model/effort ranking or a catalog score change**. The historical sessions were not linked to routing decisions; the sample is small and selected, and the quality evidence is missing for most active domains. The current enabled GPT-6 Sol combinations have no assessed session here.

## Rubric audit from the run

- The first draft falsely marked creative revisions as debugging and an image reference as documentation. Version 3 tightened those definitions and the sample was re-evaluated. This is evidence that wording changes the labels.
- S17 (shopping for fans) was labeled `product` central and `localization` supporting although neither is clearly a distinct deliverable. S02 spans a review and a later pipeline reorganization, so its nine labels should be split by task before any calibration.
- S01 and S08 illustrate missing visual evidence: Jev identified visual domains but returned `unknown` quality. S15’s research score is nearly tied with `unknown`. Use neither as a confident capability estimate.
- A useful production assessment must link the routed worker session and delivered artifacts, split multi-task sessions, expose factual/test/user acceptance evidence, and audit a stratified sample of Jev labels. Subject-matter facets such as finance, legal, medical, and pedagogy are not yet separately measured by this work-domain rubric.

The reproducible pilot code is `skills/model-routing/scripts/retrospect.py`; it writes only to an explicitly supplied output path. The work-domain taxonomy is `skills/model-routing/references/retrospective-domains.json`. This pilot does not change live routing or the catalog.
