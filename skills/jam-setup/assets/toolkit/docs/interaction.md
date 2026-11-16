# Talking with the person

How to ask, what to show and how to word it, for every jam skill. The reader may not be a programmer.

## How much to ask

1. **Ask about the game once, up front.** Before the first image or model of a project, know what the player does, whether it is 2D, 3D or a mix, and how the player sees it. Read the project's notes and the conversation first; ask only for what is missing, in one short message. Work that starts with no idea of the game produces generic results.
2. **After that, one consequential question at a time.** A question is consequential when the answer changes the result or the cost. Ask it when the work reaches it.
3. **Never a questionnaire.** A list of four questions is four decisions the person did not ask to make. Decide routine details yourself and say what you assumed.
4. **Never ask twice.** An answer given earlier in the conversation, in the brief or in the project's settings stands. That includes "generate it": see [task-intent.md](task-intent.md).

When the person says to stop asking, record it as standing authorization and proceed on your own judgement inside it.

## Shape of a question

Lead with the question in bold. Give two to four concrete choices, say which you recommend and why in a clause, and leave room for their own words or a reference image. Keep tool output, ids, logs and account details out of it. One provider, one step or one image round per question.

> **How should the player see the village?**
>
> - From above, with the whole layout visible (my suggestion for a builder).
> - Near ground level, following a character.
> - Not sure yet: show me both.
>
> A screenshot of a game whose camera you like works too.

## The game, once

> **What kind of game is this: what does the player mainly do, is it 2D or 3D, and how do they see it?**
>
> A sentence is enough, or share images or games you have in mind.

A view named by a label ("third-person", "top-down") still needs physical numbers before any gameplay image: [style-exploration.md](style-exploration.md#the-brief) has the proposal to confirm.

## No style yet

> **The game has no agreed look yet. Settle that first, or go ahead with the barrel?**
>
> - Go ahead (my suggestion for one small prop; it may need redoing once the look is chosen).
> - Settle the look first with a few comparison pictures.

## Image source

Offer only routes found callable ([providers.md](providers.md#routes)), each with its cost in words and what is still missing, and recommend one that is already paid for when there is one.

> **How should we make the first images?**
>
> - **The image tool included in your plan (recommended):** no extra charge within the plan's allowance; ready.
> - **A paid image service:** charged in its own credits; needs a spending limit from you first.
> - **References:** I search, or you share images.

## Spending

Follow [settings.md](settings.md#spending): one provider per question, the unit named in words, three choices.

> **May I spend this service's credits on the barrel model?** One model costs about 20 of its credits by its own estimate.
>
> - **Yes, up to a limit:** tell me the most to spend per asset.
> - **Yes, no limit.**
> - **No:** I will use only routes that cost nothing extra.

## Asset budget

Ask when [settings.md](settings.md#budgets) says a budget is due, in terms of what the person sees.

> **How detailed may the barrel be?** It is background dressing seen from a few metres, and a cellar may hold several.
>
> - **Light (my suggestion):** about 3,000 triangles (the small flat faces a model is built from), 8,000 at most, one 1024-pixel texture.
> - **Heavier:** about 10,000; sharper up close, slower with many on screen.
> - Your own numbers.

## Mesh input

Ask only when both modes are available and nobody has chosen ([providers.md](providers.md#mesh-input)).

> **How should the five views be used for the model?**
>
> - **All the views it accepts (recommended):** the back and sides shape the model too.
> - **Front view only:** [the real advantage on this route], but the model's back is the service's guess.

## Showing images

Show the original files in the conversation, each with a letter and one line about what is visible in it and what it helps decide. The rules are in [images.md](images.md#show-the-originals). Then ask the one decision:

> **Which direction should we develop?** Pick one, mix parts of several, ask for new directions, or tell me what feels wrong.

Choosing one to refine is not approval of it as final; say so when it matters.

## Review request

One decision per request, with the link or the images ([review.md](review.md#asking-a-person-to-review)).

> **Is this the barrel you want modelled?** It is the second design with the iron bands you asked for; the lid is still plain.
> Review it here: <link> (it opens on the computer where the project is)
> Accept it, tell me what to change, or reject it.

Give the link every time, even when the person has had it before.

## Progress and failure

Report what is happening in a line: "Two images are ready; the third is still generating." For a wait, give the provider's stated time, not a guess. On failure, say what failed and the next available action, and keep the same route unless the person agrees to change it.

## Sign-in

The person signs in; you prepare and verify. The order and wording are in [setup.md](setup.md#handing-a-sign-in-to-the-person).
