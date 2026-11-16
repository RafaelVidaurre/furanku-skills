# Gates and review

Who must accept a step, how an agent reviews, and how a person's decision reaches the run. Flags are in [cli.md](cli.md).

## Who must accept

Each recipe step names its gate: `human`, `agent` or `none`. Two settings move it:

- `review.mode` in `jam.config.json` can only lower gates: `agent` caps every gate at agent review, `none` records work with no gate. See [settings.md](settings.md#review-mode).
- `--human <steps>` on `jam run start` or `jam run set` can only raise them, for that run.

`jam run status <id>` shows the gate in force for each step and, when it differs from the recipe's, why.

## Agent review

Review once, against the brief, with the evidence the step already produced: the recorded files, their measurements, the renders or captures beside them.

- Open the files and look. A file that exists, a passing measurement or a provider's "success" says nothing about whether the result is right.
- Reuse evidence, whoever made it. Produce new evidence (another render, a rerun check) only when what is there is missing, stale or contradicted by something you see.
- Accept with the reason at record time (`jam run record ... --accept "<what you checked and saw>"`) or afterwards (`jam run review <id> <step> --accept --reason "..."`). Send back with `--revise --reason "<what must change>"`, or `--reject`.
- A revision is a new record of the step. Files under an accepted record are never replaced.

An accept whose reason could have been written without opening the files is a rubber stamp. Name what you looked at and what you saw.

## A person's decision

A `human` gate is met in one of two ways. Either way the run records who decided and through which channel.

**In the catalog.** `jam catalog open` starts the review site for this checkout if it is not running, and `jam run request-review <id> <step>` then submits the step's files and evidence and prints a link to that review. Give the person that link in the same message that says what they are deciding. The link opens on the computer where the project is, while the site runs; say so when the person may be elsewhere. Their decision is read by `jam run status <id>`: approving every part accepts the step; asking for changes or rejecting returns it with their comment.

**By relay.** When the person answered you directly, record their words:

```
jam run review <id> <step> --accept --relay "<where they answered>: <their words, verbatim>"
```

A relay is honest only when the person was shown this exact candidate and answered about it. Quote them; do not paraphrase into an approval. Silence, a general "looks good" about something else, or an answer to a different question is not a decision. `--revise --relay` records a requested change the same way.

An agent's own `--accept` is refused on a human gate. `request-review` is refused for work the catalog does not list (a recipe that delivers nothing, or a project without the `jam` catalog plugin); its `fix:` line says so, and the answer is then relayed.

## Asking a person to review

One request, one decision. The message carries:

- what is being decided, in a sentence a non-programmer can act on ("Is this the barrel you want modelled?");
- the original images or the link, never a resized collage or a description in their place;
- what changed since they last looked, and any defect you already know of;
- the choices: accept, change something (say what), or reject.

Wording patterns are in [interaction.md](interaction.md#review-request). Work that needs the answer waits for it; independent work continues.

## Guarding a decision

`--record <record id>` on `jam run review` refuses the decision when the step has been recorded again since the candidate was reviewed. Use it when time passed between showing the work and recording the answer.
