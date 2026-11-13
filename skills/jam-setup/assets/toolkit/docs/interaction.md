# Art workflow message templates

Use these shapes for style guidance and image-route choices; adapt the wording to the user's material. Keep one clear question per turn. For ordinary follow-ups, lead with that question or one short acknowledgement and make the decision question **bold**. The round-start decision instead follows its brief summary below. Aim for 40–100 words for ordinary follow-up questions; image reviews may need additional captions and concrete limitations. [Show original images directly in chat](images.md#show-style-images-directly) before asking the user to judge them; labels/captions are plain chat text, not HTML cards.

Keep tool inspection, command logs, account/project identifiers and background implementation details out of the decision message. Report a relevant failure or setup gap plainly. Present choices as short bullets; use a table only when the user asks for a detailed comparison. Explain applicable costs once using [image-route rules](images.md#cost-and-custody), and reuse the established boundary. These are adaptable templates, not a new form or a word-count validator.

## Missing game context

> **What kind of game are we making—what does the player mainly do?**
>
> A sentence is enough, or share images/game examples. For example: exploring a ruined world, managing a village, or fighting through an arena.

If the user already chose Codex, prepend only “We’ll use Codex.” The next question still concerns the missing game context.

## Missing presentation

> **Should the game use 2D artwork, 3D models, or a hybrid?**
>
> Top-down describes the camera, so any of those could work. A reference image can help explain the result you want.

Skip this when the user already specified it. If they say “2.5D,” clarify which parts are 2D/3D only when that distinction affects the next images.

## Missing camera

Tailor examples to the established game; do not force every camera into every genre.

> A village-building game—got it.
>
> **How should the player see the village?**
>
> - From above, with the whole layout visible.
> - Near ground level, following a character.
> - Undecided—help me compare viewpoints.
>
> A reference image works too.

“Help me compare” selects the camera as an exploration; use the ongoing request and known scope to decide whether the comparison is already authorized. It does not settle a camera. If game, camera or reference roles are already clear, skip the corresponding question.

A viewpoint label still needs a [determined rig](style-exploration.md#establish-the-brief). Propose one in physical terms, derived from real games of the genre, and get it confirmed before the first gameplay image:

> **Third-person, following the character. Shall I use this camera for every gameplay image?**
>
> - Camera about 3.5–4 m behind and 2 m above the player, tilted slightly down, 75° field of view.
> - Player centered, full body, about a quarter of the screen height, mostly walking away from the camera; most of the frame shows the level.
>
> Closer or farther is fine. A screenshot of a game whose camera you like works too.

## Clarify a broad style label

> **What does “anime-like” mean for your tanks?**
>
> For example: rounded toy-like proportions with simple color blocks, or believable machine proportions with crisp cel shading. Which is closer? I’d start with the rounded shapes for small overhead tanks because their silhouettes will stay readable. Images or references are welcome too.

Adapt the recommendation to the actual game; this example assumes small overhead tanks. Use the answer to resolve consequential gaps, or compare the remaining art choices visually when that is the request. Skip questions already answered by clear reference roles.

## Missing representative subject

Ask only when choosing a subject would invent the game's setting or identity; otherwise derive a useful scene from the brief.

> **What place or object should represent the game in our first comparison?**
>
> For the village builder, we could use a market square, a home or a farm. You can also share a reference.

## Choose the image source

Use only discovered routes, with their actual readiness and cost. The example's Codex allowance wording applies to ChatGPT sign-in; API-key mode uses the separate billing/integration explanation in [image routes](images.md#cost-and-custody). Omit this question when the user already chose a route; selecting generation does not resolve missing game context.

> **How should we create the first visual options?**
>
> - **Codex — recommended:** no extra charge within your plan allowance; ready.
> - **Scenario:** paid credits; spending limit needed.
> - **References:** I can search online, or you can share images.
>
> Codex images use the shared allowance several times faster; beyond it, purchased credits may be used. I’ll check that boundary before generating.

Replace “ready” with a concrete missing check when needed. Include other relevant supported image routes. Keep authorization and readiness truthful; no assertion that a message, login or generation succeeded without evidence.

## Confirm a style round

Use this confirmation template only when the round is not already authorized under [task intent](task-intent.md). For an understood requested operation, give a short action summary and proceed; prerequisite answers can complete that request without a separate start click. Otherwise first display a compact summary as bullets grouped by topic, with one nesting level when useful. This is a brief to review, not a transcript: include the facts that constrain the images, keep known choices separate from proposed exploration, and surface unresolved assumptions. The example assumes every listed choice was established; substitute the actual brief.

- **Game**
  - 3D multiplayer tank battles; tile-based map structure.
- **Camera and readability**
  - Fixed overhead gameplay view; agreed tank screen size and playable layout.
- **Art direction**
  - Agreed anime cel shading, clear team colors, fixed arena setting.
  - Map structure does not imply visible grid lines; ground markings follow the agreed choice.
- **This round**
  - Three silhouette treatments in that same arena: rounded low hulls, compact angular hulls, exaggerated large turrets.
  - Codex; one fresh session per image; within the agreed plan allowance.
  - Open choices/assumptions: list any, or omit when none remain.

**Then use the harness question tool**, with this question and these exact two option labels:

- Question: **“How would you like to proceed with this style round?”**
- **“Start generating”** — Generate the summarized round.
- **“Ask me questions”** — Ask the question most likely to narrow the style.

Do not replace an available supported question tool with a prose-only question. Follow the host's tool and notification routing rules without duplicating the request; if a tool cannot support this decision or is unavailable, explain that limitation and use its permitted question surface, still waiting for an answer. Text-input tools cannot accept image uploads: references remain welcome through conversation attachments. Silence, dismissal or an unsubmitted default is not a start.

On **“Ask me questions,”** hold that round and ask one high-impact unresolved question, with concrete alternatives or a reference invitation. An answer to this narrowing question alone does not lift the hold: summarize and use the start choice again unless the user now clearly directs generation. This differs from answering a prerequisite question in an already authorized workflow. **“Start generating”** or an unambiguous equivalent authorizes the summarized round under the [start-decision rules](style-exploration.md#confirm-the-round-before-generation). Reuse known route/cost choices and never repeat a provider menu unnecessarily.

## Propose coverage shots

For a coverage round, replace competing treatments in **This round** with complementary shots and their purpose. Use the topic-grouped summary and Start generating / Ask me questions choice when authorization is missing; execute an already requested batch without repeating the choice. For example, using only approved game situations:

- **Style coverage**
  - Approved: [shot and what it establishes].
  - Proposed: [situation — visual question it answers], [situation — visual question it answers].
  - Remaining gap: [important untested aspect, if any].
- **This round**
  - [Count] new images in the chosen direction, with [approved shared references].
  - [Established route and cost boundary]; one fresh session per independent image.

Use the minimum-three rule to identify missing coverage, not to invent shots or automatically launch a batch.

## Choose a mesh input mode

Follow [mesh input-mode selection](providers.md#choose-the-mesh-input-mode). When both modes are verified and the choice is missing, a concise question can be:

> **How should we use the turnaround to generate the mesh?**
>
> - **Multiview (recommended):** use several approved sides; [relevant topology/cost tradeoff].
> - **Single-view:** use one image; [verified advantage and what the unused sides no longer constrain].

Use the harness question tool with these supported options, substituting actual tradeoffs. Reuse an existing choice. This resolves generation mode, not permission to do the same requested work again; after the answer, continue within the established scope and spending boundary.

## Report generation progress

> I’ll use Codex to show three distinct treatments of the village square from the agreed overhead gameplay view, keeping the layout, activity and building scale the same.

Use this once task intent authorizes the operation, including after prerequisite answers complete an understood request. It reports the action; it is not another permission question. During generation, report the actual state briefly: “Two images are ready; the third is still generating.” On failure, state what failed and the next available action without dumping logs or changing routes silently.

## Review a visual round

Inspect results under the [gameplay-frame check](style-images.md#inspect-before-offering-a-style-choice) first. Display original images labeled A–D with one short caption naming the visible difference and what it helps judge for the game. For example, “A — rounded hulls, clear turret separation; easiest silhouettes to read at this scale,” only if the image actually shows that. Flag mismatches and report incomplete comparisons. If an image is useful for one quality but fails another, separate those judgments; selecting its surface treatment cannot silently approve its wrong camera. Then ask:

> **Which direction should we develop?**
>
> Pick one to refine, mix specific parts, ask for fresh directions, or settle on a result. You can also add references or describe what feels wrong.

For a camera-only comparison, ask which viewpoint suits the game. Keep the question about the decision being shown; refinement is not final approval. For another round, distinguish a requested edit/generation from a preference using [task intent](task-intent.md); ask to start only when the operation is not already authorized.

For hero-shot coverage, show the current set together, with each shot's purpose and any remaining gap, then ask:

> **Does this set capture the game's intended visual range, or what should we develop next?**

Recommend the highest-value missing coverage when needed. Approval of one image can be saved as progress; the [coverage criteria](style-coverage.md) determine whether the style library is complete.
