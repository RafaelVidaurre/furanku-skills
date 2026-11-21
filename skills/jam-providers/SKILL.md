---
name: jam-providers
description: Show the generation providers a game project can use with the jam toolkit — what each can make, whether it can be called now, and what is left on each account — as one table per capability. Use when the person asks which providers can generate game content (images, meshes, motion, sound, voice), what a generation provider can make, or how many credits remain on a generation provider's account.
---

# Providers and balances

A **provider** is a generation service the project can use: a program, an MCP server, a skill or the agent's own tool. Its descriptor in the toolkit says what it serves, in which modes, how it is reached, its unit and its free balance read. This skill reads those facts through the toolkit and puts them in front of the person. It never restates a provider's facts itself.

`jam` is `node tools/jam/jam.mjs` (the `jam-setup` skill installs it). The neutral provider rules (routes, callable, spending) are in `tools/jam/docs/providers.md`; each provider's own page is under `tools/jam/docs/providers/`.

The request may narrow the answer:

| Input | Default |
| --- | --- |
| A capability: `image`, `mesh`, `motion`, `sound`, `voice` | all of them |
| Provider ids | every provider the project knows |
| Without balances | balances are read; every read is free |

Finding a balance never spends anything: a paid call, a dry run billed as a job, or a quote is never a balance read. Leave credentials and account ids out of what you show.

## 1. List

`jam provider list --json`, with `--capability <c>` when one was asked for. Keep only the provider ids asked for.

Done when you hold, for each provider, its capabilities with their modes, `routes` (the capabilities whose `routes.<capability>` in `jam.config.json` names it), `unit`, and `spend` (`summary`, and `used`: what the project's runs have committed).

## 2. Probe

`jam provider probe --each <id>... --json`, with the ids from step 1; `--each` keeps the answer `{ "providers": [...] }` for one id too.

Done when each provider has `installed`, `authenticated` and `reachable`, each `yes`, `no` or `unknown` with its detail.

## 3. Balances

Skip this step when the person asked without balances.

`jam provider balance <id>... --json`. Each row has a `state`:

| State | What to do |
| --- | --- |
| `read` | The figures are live: `remaining` in the provider's unit, `limit` when it reports an allowance, `parts` it reports apart, `resets` when the allowance renews. The read was an authenticated call that succeeded, so the provider is signed in and reachable. |
| `session` | `detail` names the free tools of the agent session that read it (a server's tools, in the descriptor's order). Call the first that is in this session's tool list and report its answer in its own terms: consumption stays consumption. When none is listed, the balance is unknown and `detail` says where it would come from. |
| `failed` | Report `detail`. `failure` says why: `not installed`, `outdated` (the program is older than the read: it needs an update), `not signed in`, `unanswered` (the program did not say why), or `unreadable` (an answer the toolkit could not read). |
| `none` | Report `detail`: why there is no balance (included in a plan, not billed per job, local compute), or that no read is declared. |

Done when every provider has a balance cell: live figures, a session tool's answer, or the stated reason there is none.

## 4. Present

One table per capability asked for, a row for each provider that serves it:

| Column | From |
| --- | --- |
| Provider | id and label |
| Modes | the capability's modes, `-` when it lists none |
| Preferred | `yes` when the provider's `routes` include this capability |
| Callable | `yes` when the route is callable by the rule in `tools/jam/docs/providers.md` (Routes). Otherwise the first missing fact, from the probe or a balance `failure` (`not installed`, `outdated`, `not signed in`, `not reachable`), or `unknown` with what is known and the free call that would settle it. Without balances, a provider the probe finds signed in but cannot see reach shows `unknown (signed in; not reached: balances not read)`. |
| Unit | the unit's label, with `not billed per job` when it is not paid |
| Balance | what is left, with the portions shown apart and the renewal date; or the reason from step 3; `not read` when balances were skipped |
| Spend | `spend.summary`, and `<used> committed` for a paid provider |

Under the tables, one line per provider that is not callable: what it needs (a sign-in, an install or update, a spending limit only the person sets). Give the time of the balance reads.

Done when every capability asked for has its table and every cell holds a value or a stated reason.

## Without the toolkit

When `tools/jam/` is absent, ask the person which provider tools they have: programs on this machine, MCP servers, skills, the agent's own image tool. For each, find its free balance or account read in its own help or skill and run it; a tool that documents none gets `no balance read` and the reason its docs give. Build the same tables with Preferred and Spend left `-`, and offer `jam-setup` when they want routes and spending limits.

Done when every tool the person named has a row.
