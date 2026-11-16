# What the person has already authorized

Authorization is read across the whole conversation: the request, the skill it invoked, and the answers given since. It is not a separate "go" sentence.

## A request plus its answers is the authorization

- The person asks for a model of a named asset; you ask the budget or route question the job needs; they answer. Submit the job when its inputs are ready. Asking "shall I generate?" now asks for something they already gave.
- The person asks for alternatives or a specific edit within what is already agreed. Make that bounded batch.
- An answer that completes a prerequisite of a requested operation lets the operation proceed. The request keeps its intent while questions are answered.

State what you are about to do in one line and do it.

## What is not a request

- Describing a preference, sharing a reference, or saying an image looks good while options are discussed is feedback. "I like B" asks for nothing; "make B softer" asks for that edit.
- Choosing a route or setting a spending cap during setup is configuration.
- A cap, a budget or a standing authorization never starts work on its own.

When the next action is unclear after reading the conversation, ask one question about that action.

## Standing authorization

When `spend.<provider>.standing` is set ([settings.md](settings.md#spending)), spending inside the caps for requested work needs no question: decide, proceed, and report afterwards what was spent and why. The same holds for art decisions the person has delegated in their own words. An instruction such as "do not stop to ask me" is recorded there, in their words, and followed until they change it.

## Stop and ask only for

- spending that would pass a cap, or a provider with paid work off;
- something that cannot be undone, or that is outside what was asked;
- a choice that changes the result or the cost and that nobody has made, such as single-view instead of multiview for a mesh;
- a step the person told you to hold ("ask before generating").

A human gate on a result is separate from permission to produce it: permission to generate is not acceptance of what comes back.

## Two kinds of budget

**Spending** is provider credits for this work. An **asset budget** is triangles, texture size and materials. Approving one says nothing about the other. When an asset budget is decided is in [settings.md](settings.md#budgets); ask earlier only when an earlier step really depends on one, and say why.

## Recording it

`jam job open` takes the authorization from the standing entry, or from `--authorized "<who, when: their words>"`. Record the actual request and answers; never write an approval that did not happen.

A worker agent receives the scope and the person's words in its brief and acts on them. It asks again only for something outside that scope.
