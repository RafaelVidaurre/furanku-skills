# Codex CLI image tool

Serves the image route from any harness by launching a Codex agent that has a built-in image tool. Unit: the person's ChatGPT plan allowance, so no job is billed and no spending cap applies. The neutral procedure is [providers.md](../providers.md); image rules are in [images.md](../images.md).

## What it costs, in words (checked 2026-11-11)

With ChatGPT sign-in, images come out of the plan's included allowance: no extra charge inside it. Image turns use the shared Codex limits about 3 to 5 times faster than other turns, and use beyond the limits can draw on purchased credits. Image generation is not available on the Free plan ([image generation](https://learn.chatgpt.com/docs/image-generation), [pricing](https://learn.chatgpt.com/docs/pricing#how-does-image-generation-count-toward-usage-limits)). Say this once when offering the route.

With API-key sign-in the same tool is billed through the API, outside this ledger. Treat that as a different, paid route the toolkit does not track: say so and let the person choose. Choosing this route never authorizes buying credits, asking for an API key, or switching to a billed API.

## Check it is callable

1. `codex --version`, `codex exec --help`, `codex login status`; `codex features list` when in doubt.
2. An installed CLI, an enabled feature or an installed image skill is preliminary. The route is callable when a launched agent reports a callable image tool and its sign-in mode (ChatGPT plan, API key or unknown). A capability-only turn generates nothing but still uses allowance.
3. Missing installation or sign-in is setup work for the person: give them the steps before asking whether it is done.

Follow the host's own rules for which account and model a launched agent uses; do not copy credentials or change account settings.

## Run one image

One fresh top-level `codex exec` per independent image, never `resume` or `fork`; an edit of one chosen image may continue that image's own session.

```
codex exec --cd . --sandbox workspace-write --json --output-last-message <folder>/result.txt -- 'Read <folder>/brief.md. Use $imagegen and its built-in tool to generate exactly one image with the prompt under "Image prompt", unchanged in content. Copy the original file into <folder>/ and report its path, the exact prompt sent, the image inputs used and any visible deviation. If the tool is missing or fails, report and stop: no retry, no API fallback, no installs.'
```

- `<folder>/brief.md` holds the exact image prompt under its own heading, separate from scope and authorization. The launched agent executes it; it does not redesign it.
- Attach reference images with `-i <file>`, once per file. A file name in the prompt attaches nothing. Because `-i` takes several values, pass the prompt on standard input or after `--`.
- Quote the prompt so `$imagegen` reaches the agent unchanged.
- `--json` and `--output-last-message` are text outputs. The image is wherever the agent copied it.

## Evidence

A zero exit code or a report that says "generated" is not an image. Open the returned file. Compare the prompt the agent reports with the one in the brief. Some CLI versions leave image-tool events out of the JSON stream; where the session record is available, that invocation's image records show the real prompt, inputs and output path. State what could not be confirmed.

If the process loses its response, read that invocation's events and output folder before considering another generation.

Record the result with `--tool "codex <version>, built-in image tool"`. One generation and file hand-off was verified on macOS with CLI 0.167.0 and ChatGPT sign-in; editing and other platforms were not.
