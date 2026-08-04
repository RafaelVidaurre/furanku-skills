# furanku-skills

Tools and skills that help **AI coding agents** work the way you want on your projects.

If you use Claude Code, Codex, Cursor, or a similar agent, this repo gives you:

1. **Skills** — short instruction packs the agent can load when the task matches (install once, then ask in normal language).
2. **A command-line tool** — `furanku-skills`, with namespaces such as [guidance-composer](skills/guidance-composer/README.md) for picking engineering principles and writing them into your project so agents keep following them.

You do not need every skill. Install what matches how you work.

## Install skills

[Agent Skills](https://agentskills.io) are portable. From any project:

```bash
# all skills from this collection
npx skills add rafaelvidaurre/furanku-skills

# or just one
npx skills add rafaelvidaurre/furanku-skills --skill guidance-composer
npx skills add rafaelvidaurre/furanku-skills --skill testing-best-practices
```

After install, talk to your agent as usual. When a skill fits, it should load and follow it.

## Command-line tool

The collection ships one CLI: **`furanku-skills`**.

### Quick start (recommended)

From a checkout, in **your project** directory:

```bash
node /path/to/furanku-skills/bin/furanku-skills.js
# or jump straight into setup:
node /path/to/furanku-skills/bin/furanku-skills.js init
```

Via npx (when the package is available):

```bash
npx furanku-skills
npx furanku-skills init
```

With no command, the CLI opens an **interactive menu** (setup wizard, agent files, guidance, help). The **init** wizard walks you through:

1. **Agent instructions** — create `AGENTS.md` and a `CLAUDE.md` → `AGENTS.md` symlink  
2. **Install skills** — hands off to interactive `npx skills@latest add rafaelvidaurre/furanku-skills` (the skills CLI owns the picker)  
3. **Project guidance** — optional [guidance-composer](skills/guidance-composer/README.md) setup  

Non-interactive (agents / CI):

```bash
# sensible default: AGENTS.md + all skills, no guidance yet
npx furanku-skills init --yes

# pick pieces explicitly
npx furanku-skills init --yes --agents-md --skills guidance-composer,testing-best-practices --no-guidance
npx furanku-skills init --yes --no-skills --guidance simplest-current,prefer-libraries --guidance-mode inline
```

### Commands & namespaces

| Command / namespace | What it does |
| --- | --- |
| **`init`** | Interactive (or flagged) project setup — agents file, skills install, guidance |
| **`agents-md`** | Only create empty `AGENTS.md` + `CLAUDE.md` → `AGENTS.md` symlink |
| **`guidance-composer`** | Compose engineering rules from a catalog into the project ([guide](skills/guidance-composer/README.md)) |

```bash
node bin/furanku-skills.js help
node bin/furanku-skills.js agents-md --yes
node bin/furanku-skills.js guidance-composer list
node bin/furanku-skills.js guidance-composer inject --ids simplest-current --mode inline --harness agents --yes
```

## Skills (what each one is for)

### guidance-composer

**Useful if:** you want agents to follow a few explicit principles (for example “keep it simple,” “don’t keep old APIs around”) without rewriting those rules every chat.

**What it does:** offers a catalog of short, opinionated rules. You pick which ones apply. They are written into a file your agent already reads (often `AGENTS.md`), or into a linked doc.

You can use the **CLI yourself** or ask an agent to help you choose. Details: [guidance-composer README](skills/guidance-composer/README.md).

```text
> Help me set up project guidance — simplest path, no backward compatibility.
> What guidance options are in the catalog?
```

---

### testing-best-practices

**Useful if:** you want better automated tests — clearer failures, less brittleness, less noise — without being forced into one testing religion.

**What it does:** steers the agent to treat each test as *evidence* for behavior that matters, and to match your project’s language and tools.

```text
> Add tests for this change using the project's conventions.
> Review this test suite for flaky or low-value tests.
> What's the smallest useful test for this database path?
```

Optional deep dive: [interactive testing guide](artifacts/testing-best-practices.html).

---

### product-memory

**Useful if:** product decisions get lost across chats, agents, or weeks — and you want a durable place for “what the user said” vs “what we currently believe the product is.”

**What it does:** keeps structured product notes under `docs/product-memory/` (requirements, decisions, open questions, risks) so later sessions can continue without reinventing the story.

```text
> Initialize product memory for this project.
> Capture this conversation into product memory.
> Reconcile product memory after this scope change.
```

---

### progress-report

**Useful if:** you want a clear status of what changed recently, what’s in flight, and what’s blocked — based on real project evidence, not vibe.

**What it does:** writes a human-readable progress report over several time windows (fresh work through about the last month).

```text
> Give me a progress report for this project.
> Summarize status and progress for the last week.
```

---

### decision-trail

**Useful if:** an agent (or you) will make a series of important choices and you want a compact log you can review later without replaying the whole session.

**What it does:** appends a simple table of decisions, reasons, evidence, and results (local by default).

```text
> Keep a decision trail while you work through this migration.
> Leave a reviewable record of the important calls.
```

---

### council

**Useful if:** a decision is hard enough that you want several AI models to argue it out before you trust a single answer.

**What it does:** your agent runs a moderated “council”: multiple models take positions, challenge each other, and vote. You get a verdict plus dissent — not one model talking to itself.

```text
> Council: should we migrate this service from REST to gRPC?
> Council of 5 — brainstorm product names.
```

First use walks you through approving which model tools may run on your machine.

---

### crew

**Useful if:** you run multi-agent work and want clear ownership (who plans, who implements, who reports to whom) instead of a pile of unnamed agents.

**What it does:** defines simple roles — optional overall coordinator, lead for a larger front of work, and people focused on one concrete outcome — and helps pick sensible model setups when spawning them. Works best if you already use complementary coordination tools in your setup.

```text
> Act as Commander and coordinate my projects without editing project files.
> You are Captain for the editor work. Report to me.
> Show the effective Crew routes for this repository.
```

## Repository layout

```text
skills/
  <name>/
    SKILL.md       # what the agent follows
    README.md      # human docs (where present)
    references/    # extra detail the skill loads when needed
    scripts/       # helpers
    bin/           # CLIs (where present)
```

## License

See [LICENSE](LICENSE). Issues and contributions welcome.
