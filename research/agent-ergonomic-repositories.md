# Research: agent-ergonomic repositories

**Date:** 2026-09-04

**Scope:** What makes a code repository easy for AI coding agents (Claude Code, OpenAI Codex, Cursor, GitHub Copilot coding agent, Gemini CLI) to navigate, understand, verify, and modify. Covers instruction files, layout, docs, feedback loops, module design, checked-in skills/hooks/MCP, permissions and sandboxing, and the measured evidence. Primary sources only: vendor docs, vendor engineering posts, the Agent Skills spec, and published papers.

**Status:** Research input for repository guidance.

Each claim is tagged: **[behavior]** = vendor-documented tool behavior; **[recommendation]** = vendor advice; **[evidence]** = a measured result.

## Executive findings

1. **One shared instruction file works across tools.** Codex, Cursor, Copilot, Gemini CLI (via `context.fileName`), and Claude Code (via `@AGENTS.md` import or symlink) can all read `AGENTS.md`, so a repo needs one source of truth plus thin tool-specific shims ([agents.md](https://agents.md), [Claude Code memory](https://code.claude.com/docs/en/memory), [Gemini CLI](https://geminicli.com/docs/cli/gemini-md/), [Copilot](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)).
2. **Keep the always-loaded file short.** Anthropic targets under 200 lines and says longer files reduce adherence; Codex caps combined `AGENTS.md` content at 32 KiB by default; GitHub's own generation prompt caps it at 2 pages ([Claude Code memory](https://code.claude.com/docs/en/memory), [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Copilot](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)).
3. **Put commands and non-default conventions in, leave out what the agent can derive.** Anthropic's include/exclude table and `/doctor` trims explicitly cut directory layouts, dependency lists, and architecture overviews ([Claude Code best practices](https://code.claude.com/docs/en/best-practices), [memory](https://code.claude.com/docs/en/memory)).
4. **The measured evidence agrees: repository overviews do not help, but instructions are followed.** A 2026 study across SWE-bench and developer-committed context files found no general gain in task success, >20% higher inference cost, and that "repository overviews, although popular and recommended by model providers, are not helpful" ([Gloaguen et al. 2026](https://arxiv.org/abs/2602.11988)).
5. **Nest instruction files by directory; the closest one wins.** Every major tool loads ancestor files and either concatenates root-down (Codex, Claude Code, Gemini) or applies the nearest one (Copilot, Cursor) ([agents.md](https://agents.md), [Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Claude Code large codebases](https://code.claude.com/docs/en/large-codebases)).
6. **Give the agent a check it can run.** Anthropic calls verification "the difference between a session you watch and one you walk away from"; Codex tells users not to accept changes without running checks ([Claude Code best practices](https://code.claude.com/docs/en/best-practices), [Codex best practices](https://learn.chatgpt.com/guides/best-practices)).
7. **Interface guardrails measurably help.** In SWE-agent ablations, a linter that rejects syntactically broken edits raised SWE-bench Lite pass@1 from 15.0% to 18.0%, and a 100-line file window beat showing whole files (12.7%) ([Yang et al. 2024](https://arxiv.org/html/2405.15793)).
8. **Pre-install dependencies so the agent can build and test immediately.** GitHub says trial-and-error dependency discovery "can be slow and unreliable"; Codex says "many quality issues are really setup issues" ([copilot-setup-steps](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment), [Codex best practices](https://learn.chatgpt.com/guides/best-practices)).
9. **Rules that must always hold belong in hooks or settings, not prose.** Anthropic: CLAUDE.md is "a request, not a guarantee"; a `PreToolUse` hook exiting 2 is enforcement ([features overview](https://code.claude.com/docs/en/features-overview), [hooks](https://code.claude.com/docs/en/hooks)).
10. **Move procedures out of the always-on file into skills.** Skills load name+description at startup and the body only on use; the spec recommends under 500 lines and under ~5,000 tokens for SKILL.md ([Agent Skills spec](https://agentskills.io/specification)).
11. **Sandboxing cuts prompts without loosening control.** Anthropic reports sandboxing "reduces permission prompts by 84%" in internal use; Codex defaults to workspace-write with network off ([Anthropic sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing), [Codex approvals](https://learn.chatgpt.com/docs/agent-approvals-security)).
12. **Commit shared permissions and deny rules.** Claude Code's `.claude/settings.json` is meant to be committed; `Read` deny rules keep secrets and generated code out of the agent's reach ([settings](https://code.claude.com/docs/en/settings), [permissions](https://code.claude.com/docs/en/permissions)).
13. **Tool design details matter more than they look.** Anthropic switched a file tool to absolute paths after the model made mistakes with relative paths, and reports that "even small refinements to tool descriptions can yield dramatic improvements" ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [Writing tools](https://www.anthropic.com/engineering/writing-tools-for-agents)).
14. **Task specification quality is a measured lever.** OpenAI built SWE-bench Verified because many original issues were underspecified; a controlled ablation found agents "fail on implementation skill... not missing repository knowledge" and suggests effort on task decomposition and tooling over generic context docs ([SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/), [two-agent ablation 2026](https://arxiv.org/html/2607.27250)).
15. **AI help is not automatically a speedup on mature repos.** A METR randomized trial found experienced developers 19% slower with AI on repos they knew well, against an expected 24% speedup ([METR 2025](https://arxiv.org/abs/2507.09089)).
16. **Logs must fit a bounded window.** Claude Code reads back at most 30,000 characters of a command's output (150,000 max) and spills the rest to a file; Codex budgets tool output with `tool_output_token_limit`; SWE-agent keeps only the last 5 observations in full. Write verbose logs to a known file and have the agent `grep`/`tail` them ([tools reference](https://code.claude.com/docs/en/tools-reference), [Codex config](https://learn.chatgpt.com/docs/config-file/config-reference), [Yang et al. 2024](https://arxiv.org/html/2405.15793)).

## 1. Instruction files (AGENTS.md, CLAUDE.md, .cursor/rules, copilot-instructions.md, GEMINI.md)

### 1.1 What each tool reads [behavior]

| Tool | Files read | Hierarchy | Size limit |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` or `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/*.md`, `@path` imports (max 4 hops) | Loads cwd and every ancestor at launch; subdirectory files load "when Claude reads files in those subdirectories"; all concatenated root-down | Target under 200 lines; files over 4 MiB are skipped |
| Codex | `AGENTS.md`, `AGENTS.override.md`, `~/.codex/AGENTS.md`; extra names via `project_doc_fallback_filenames` | "Concatenates files from the root down... Files closer to your current directory override earlier guidance because they appear later" | `project_doc_max_bytes`, 32 KiB by default; Codex "stops adding files" at the cap |
| Cursor | `.cursor/rules/*.mdc` (`alwaysApply`, `description`, `globs`), `AGENTS.md`, legacy `.cursorrules` | Nested `AGENTS.md` supported "with more specific instructions taking precedence"; order Team → Project → User | Advises "Keep rules under 500 lines" |
| Copilot coding agent | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` with `applyTo` globs, `AGENTS.md` anywhere, or a single root `CLAUDE.md`/`GEMINI.md` | "the nearest AGENTS.md file in the directory tree will take precedence"; repo-wide and path-specific files combine | Generation prompt: "no longer than 2 pages" |
| Gemini CLI | `GEMINI.md` global, workspace and ancestors, plus just-in-time scan of any directory a tool touches; `@file.md` imports; other names via `context.fileName` | Concatenates all found files into every prompt | none stated |

Sources: [Claude Code memory](https://code.claude.com/docs/en/memory); [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md); [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference); [Cursor rules](https://cursor.com/docs/context/rules); [Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions); [Gemini CLI GEMINI.md](https://geminicli.com/docs/cli/gemini-md/).

### 1.2 Keep one source of truth and shim the rest

- **What to do:** Write one `AGENTS.md`. Add a `CLAUDE.md` containing `@AGENTS.md` (or a symlink), set Gemini's `context.fileName` to include `AGENTS.md`, and let Cursor and Copilot read `AGENTS.md` natively. Keep tool-specific notes below the import.
- **Why it helps agents:** Every tool sees the same rules, and there is one file to prune. Claude Code states it "reads CLAUDE.md, not AGENTS.md" and documents the import/symlink pattern; Claude's `/init` also reads `.cursor/rules/` and `.github/copilot-instructions.md`, and `/import` carries over MCP servers, commands, and skills. [behavior]
- **Source:** [Claude Code memory, "AGENTS.md" section](https://code.claude.com/docs/en/memory); [agents.md](https://agents.md); [Gemini CLI](https://geminicli.com/docs/cli/gemini-md/).

### 1.3 What goes in, what stays out

- **What to do:** Include: build, test, lint, and run commands the agent cannot guess; conventions that differ from language defaults; repo etiquette (branch names, PR rules); required env vars and setup quirks; known gotchas. Exclude: anything derivable from the code, standard language conventions, API documentation (link instead), file-by-file descriptions, frequently changing facts, and "write clean code" platitudes.
- **Why it helps agents:** Anthropic: "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" and "For each line, ask: 'Would removing this cause Claude to make mistakes?' If not, cut it." [recommendation] Claude Code's `/doctor` now proposes trims that cut "directory layouts, dependency lists, and architecture overviews" and keep "pitfalls, rationale, and conventions that differ from tool defaults." [behavior] This matches the measured finding that repository overviews do not improve task success while concrete instructions are followed. [evidence]
- **Source:** [Claude Code best practices](https://code.claude.com/docs/en/best-practices); [Claude Code memory](https://code.claude.com/docs/en/memory); [Gloaguen et al. 2026](https://arxiv.org/abs/2602.11988).
- **Folklore check:** GitHub's guidance still recommends "project layout" and "major architectural elements... including the relative paths to the main project files", and Codex suggests "repo layout and important directories." Those are vendor recommendations; the only controlled evidence on overviews says they did not help. Prefer a one-line pointer to a README over a layout dump.

### 1.4 Size and structure

- **What to do:** Keep the root file under 200 lines. Use headers and bullets. Make each rule concrete enough to verify ("Run `npm test` before committing", not "test your changes"). Remove contradictions across nested files. Use `<!-- -->` comments for maintainer notes; Claude Code strips them before injection.
- **Why it helps agents:** Anthropic: "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence"; "if two rules contradict each other, Claude may pick one arbitrarily." [recommendation] Note that one 2026 factorial study found no detectable effect of file size, instruction position, file architecture, or adjacent-file contradictions on adherence across 1,650 Claude Code sessions, but did find compliance decays within a session (about 5.6% lower odds per additional generated function). [evidence] Short files are still cheaper on every turn.
- **Source:** [Claude Code memory](https://code.claude.com/docs/en/memory); [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md); [Instruction adherence factorial study 2026](https://arxiv.org/abs/2605.10039).

### 1.5 Nesting and monorepos

- **What to do:** Root file: rules that apply everywhere (commit format, "run scripts from the package directory", "never edit `generated/`"). One file per package or subsystem with that area's stack-specific conventions. Commit them; the directory owner maintains them. In Claude Code, use `claudeMdExcludes` locally to skip other teams' files.
- **Why it helps agents:** Claude Code: a single root file "tends to either grow to cover every subsystem's conventions... or stay too generic to be useful." Subdirectory files load on demand, so frontend rules do not cost context during backend work. [behavior] agents.md: "The closest AGENTS.md to the edited file wins; explicit user chat prompts override everything." [behavior]
- **Source:** [Claude Code large codebases](https://code.claude.com/docs/en/large-codebases); [agents.md](https://agents.md); [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

### 1.6 Path-scoped rules

- **What to do:** For rules that apply to a file type rather than a directory (all `*.tsx`, all migrations), use Claude Code `.claude/rules/*.md` with `paths:` frontmatter, Cursor `.mdc` `globs`, or Copilot `.instructions.md` `applyTo`.
- **Why it helps agents:** Rules "only load into context when Claude works with matching files, reducing noise and saving context space." [behavior]
- **Source:** [Claude Code memory](https://code.claude.com/docs/en/memory); [Cursor rules](https://cursor.com/docs/context/rules); [Copilot instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions).

### 1.7 Treat the file like code

- **What to do:** Review edits to the instruction file in PRs. Add a rule when the agent makes the same mistake twice or a review catches something it should have known. Revisit after model releases and delete workarounds that no longer matter. Cursor: do not paste a style guide; "Use a linter instead."
- **Why it helps agents:** Anthropic: "Treat CLAUDE.md like code: review it when things go wrong, prune it regularly, and test changes by observing whether Claude's behavior actually shifts." [recommendation] Codex: add rules "only after noticing repeated mistakes." [recommendation]
- **Source:** [Claude Code best practices](https://code.claude.com/docs/en/best-practices); [Claude Code large codebases](https://code.claude.com/docs/en/large-codebases); [Cursor rules](https://cursor.com/docs/context/rules); [Codex best practices](https://learn.chatgpt.com/guides/best-practices).

## 2. Repository layout and navigability

### 2.1 Predictable structure that follows ecosystem norms

- **What to do:** Use the conventional layout for your language and framework (standard folder names, one obvious entry point, tests next to or mirroring source). Name files by content, not `utils2.ts`.
- **Why it helps agents:** GitHub: "a logical project structure that follows accepted best practices in folder names and entity groupings will provide a more predictable environment for Copilot." [recommendation] Anthropic's skill guidance says "Name files descriptively" and "Organize for discovery" because the agent "navigates your skill directory like a filesystem." [recommendation]
- **Source:** [GitHub blog: onboarding your AI peer programmer](https://github.blog/ai-and-ml/github-copilot/onboarding-your-ai-peer-programmer-setting-up-github-copilot-coding-agent-for-success/); [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

### 2.2 Small files and bounded views

- **What to do:** Keep source files small enough that a 100-line window shows a coherent unit. Split large files along module boundaries. Keep reference docs focused and give long ones a table of contents.
- **Why it helps agents:** SWE-agent found that a viewer showing "at most 100 lines of the file at a time" outperformed both a 30-line window (14.3%) and the full file (12.7%) on SWE-bench Lite (18.0%). Their search tool also refuses to return more than 50 hits and asks for a narrower query. [evidence] Anthropic: reference files over 100 lines should carry a table of contents because the agent may only `head -100` them. [recommendation]
- **Source:** [Yang et al. 2024, SWE-agent](https://arxiv.org/html/2405.15793); [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

### 2.3 Keep generated, vendored, and build output out of view

- **What to do:** List `node_modules/`, `dist/`, `build/` in `.gitignore`. For checked-in generated or vendored code, add Claude Code `Read` deny rules (`Read(./**/dist/**)`, `Read(./vendor/**)`) in the committed `.claude/settings.json`, and state in the instruction file which directories are generated and the command that regenerates them.
- **Why it helps agents:** Claude Code's searches "respect `.gitignore` by default", and deny rules stop the agent from spending context on files it must not edit. [behavior]
- **Source:** [Claude Code large codebases](https://code.claude.com/docs/en/large-codebases).

### 2.4 Monorepo extras

- **What to do:** Per-package instruction files and skills (`packages/api/.claude/skills/`), `worktree.sparsePaths` plus `symlinkDirectories: ["node_modules"]` for cheap isolated checkouts, and `additionalDirectories` for sibling packages a task needs. Start the agent from the package directory when the task is scoped to it.
- **Why it helps agents:** Starting from a subdirectory loads "that directory's plus every ancestor's" instruction files and nothing from sibling packages. [behavior]
- **Source:** [Claude Code large codebases](https://code.claude.com/docs/en/large-codebases).

## 3. Documentation agents actually use

### 3.1 Commands first

- **What to do:** Put exact commands for bootstrap, build, test (whole suite and single test), lint, type-check, and run at the top of the instruction file or a linked README, with tool versions.
- **Why it helps agents:** This is the one content category every vendor lists, and the one agents follow. GitHub asks for "bootstrap, build, test, run, lint, and any other scripted step" with "the versions of any runtime or build tools used." [recommendation] In a study of 2,303 context files, test procedures were the most common content (75.9%). [evidence]
- **Source:** [Copilot instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions); [Agent READMEs study](https://arxiv.org/abs/2511.12884); [Claude Code best practices](https://code.claude.com/docs/en/best-practices).

### 3.2 Link, don't inline

- **What to do:** Keep API references, style guides, and long procedures in separate files and point to them with an explicit "read X when doing Y" line. Keep the pointer chain one level deep.
- **Why it helps agents:** Anthropic's context-engineering post recommends "lightweight identifiers (file paths, stored queries, web links, etc.)" that the agent loads "just in time". [recommendation] The skills spec: "Keep file references one level deep from SKILL.md. Avoid deeply nested reference chains." [recommendation] Note that Claude Code `@imports` load at launch and do not save context; use skills or plain links for on-demand material. [behavior]
- **Source:** [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents); [Agent Skills spec](https://agentskills.io/specification); [Claude Code memory](https://code.claude.com/docs/en/memory).

### 3.3 Examples over descriptions

- **What to do:** Show one canonical example per pattern (a reference component, a reference test, a commit message) and name it in the instructions ("`HotDogWidget.php` is a good example").
- **Why it helps agents:** Anthropic's prompting table shows pointing at an existing pattern as the fix for vague requests, and its skill guidance says "Examples convey the desired style and level of detail to Claude more clearly than descriptions alone." Cursor: "Provide concrete examples or referenced files." [recommendation]
- **Source:** [Claude Code best practices](https://code.claude.com/docs/en/best-practices); [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices); [Cursor rules](https://cursor.com/docs/context/rules).

### 3.4 Record decisions and rationale, not layout

- **What to do:** Keep short decision records ("never edit a merged migration; add a new one", "queries use the Knex builder, not raw SQL") and the reason. Use consistent terminology across docs.
- **Why it helps agents:** Claude Code's trim logic keeps "pitfalls, rationale, and conventions that differ from tool defaults" and cuts derivable structure. [behavior] Anthropic: "Choose one term and use it throughout"; mixed terms make instructions harder to follow. [recommendation] No vendor documents a specific ADR or glossary format as agent-read; this is an inference from the "non-derivable facts" rule.
- **Source:** [Claude Code memory](https://code.claude.com/docs/en/memory); [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

### 3.5 Write tasks with acceptance criteria

- **What to do:** Issues and prompts handed to agents should carry a problem statement, acceptance criteria, the files likely involved, error output, and what was already tried.
- **Why it helps agents:** GitHub: "An ideal task includes: A clear description of the problem to be solved or the work required. Complete acceptance criteria on what a good solution looks like." [recommendation] OpenAI rebuilt SWE-bench into Verified partly because "under-specified problem statements" made tasks unsolvable; a 2026 ablation concluded effort on "task decomposition, tooling, or example-driven prompting" pays more than generic context docs. [evidence]
- **Source:** [Copilot best results](https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results); [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/) (page returned 403 at fetch time; content confirmed via search snippet); [two-agent ablation](https://arxiv.org/html/2607.27250).

## 4. Tooling and feedback loops

### 4.1 One-command setup, reproducible environment

- **What to do:** Ship a single bootstrap command and encode it in the agent's environment config: `.github/workflows/copilot-setup-steps.yml` (job must be named `copilot-setup-steps`, on the default branch), a `.devcontainer/` for Claude Code and Cursor, and `.codex/config.toml` for Codex.
- **Why it helps agents:** GitHub: Copilot "can discover and install these dependencies itself via a process of trial and error, but this can be slow and unreliable." [recommendation] Codex: "Many quality issues are really setup issues, like the wrong working directory, missing write access, wrong model defaults, or missing tools." [recommendation] A dev container gives "an identical, isolated environment that every engineer on your team can run." [behavior]
- **Source:** [copilot-setup-steps](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment); [Codex best practices](https://learn.chatgpt.com/guides/best-practices); [Claude Code devcontainer](https://code.claude.com/docs/en/devcontainer).

### 4.2 One-command test, fast and deterministic

- **What to do:** Provide `make test` (or equivalent) that runs offline, plus a documented way to run a single test file. Keep tests hermetic and quick. Tell the agent to prefer single tests during iteration.
- **Why it helps agents:** Anthropic: "Give Claude a check it can run: tests, a build, a screenshot to compare. It's the difference between a session you watch and one you walk away from." Its example CLAUDE.md says "Prefer running single tests, and not the whole test suite, for performance." [recommendation] Anthropic's agent design post: "Code solutions are verifiable through automated tests; Agents can iterate on solutions using test results as feedback." [recommendation]
- **Source:** [Claude Code best practices](https://code.claude.com/docs/en/best-practices); [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

### 4.3 Linters, formatters, type checkers as the guardrail

- **What to do:** Configure a linter, formatter, and (where available) type checker with a single command each. Run the formatter and linter automatically after edits via a hook rather than asking in prose.
- **Why it helps agents:** SWE-agent's linter that rejects syntactically invalid edits was worth 3 points (18.0% vs 15.0%). [evidence] Anthropic: "Use hooks for actions that must happen every time with zero exceptions"; a `PostToolUse` hook on `Edit|Write` that runs the linter feeds results back as text the agent reads. [behavior] Cursor: "Agent already knows common style conventions"; enforce style with a linter, not a rule file. [recommendation]
- **Source:** [Yang et al. 2024](https://arxiv.org/html/2405.15793); [Claude Code hooks](https://code.claude.com/docs/en/hooks); [Claude Code features overview](https://code.claude.com/docs/en/features-overview); [Cursor rules](https://cursor.com/docs/context/rules).

### 4.4 Language-server access for typed code

- **What to do:** In Claude Code, enable a code-intelligence plugin (`typescript-lsp`, etc.) via `enabledPlugins` in the committed settings.
- **Why it helps agents:** "LSP returns only the references that point to the same symbol, so the filtering happens before Claude reads anything"; symbol lookups "often replace broad file reads, so net context use can go down." [behavior]
- **Source:** [Claude blog: large codebases](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start); [features overview](https://code.claude.com/docs/en/features-overview).

### 4.5 Actionable error output

- **What to do:** Make scripts and validators print specific, fixable messages ("Field 'signature_date' not found. Available fields: ...") rather than stack traces or opaque codes.
- **Why it helps agents:** Anthropic: error messages should "clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks." SWE-agent: "Environment feedback should be informative but concise." [recommendation]
- **Source:** [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents); [Yang et al. 2024](https://arxiv.org/html/2405.15793).

### 4.6 CI as the final gate, hooks as the local gate

- **What to do:** Keep CI green and fast; keep lint and format checks in CI rather than in review rules. Locally, a Claude Code `Stop` hook can block the turn until the test script passes (up to 8 consecutive blocks).
- **Why it helps agents:** Codex's review guidance: "reserve formatting and lint checks for CI." [recommendation] Anthropic: a Stop hook "runs your check as a script and blocks the turn from ending until it passes." [behavior]
- **Source:** [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md); [Claude Code best practices](https://code.claude.com/docs/en/best-practices).

### 4.7 Logs and observability the agent can read

#### 4.7.1 Make logs reachable

- **What to do:** Have dev servers and test runners write to a known path (for example `logs/dev.log`, `logs/test.log`) and name those paths, plus the commands to read them (`tail -n 100 logs/dev.log`, `grep -n ERROR logs/dev.log`), in `AGENTS.md`. For CI, point the agent at `gh run view <id> --log-failed`.
- **Why it helps agents:** Claude Code runs long processes such as "dev servers or watch builds" as background tasks and now reads their output by using `Read` "on the task's output file path" (the older `TaskOutput` tool is deprecated), so a stable log path is the interface. A command that hits its timeout "is moved to the background instead of stopping it." [behavior] Codex documents piping logs straight in: `npm test 2>&1 | codex exec "summarize failing tests and propose fix"`; Claude Code documents `cat build-error.txt | claude -p '...'` and tells users to give Claude "the command to reproduce the issue and get a stack trace." [behavior/recommendation] `gh run view --log-failed` shows "the log for any failed steps in a run or specific job" and `--exit-status` exits non-zero on failure, which is what an agent needs to branch on. [behavior] Copilot's coding agent runs in "its own ephemeral development environment, so it can run automated tests and linters"; its session logs are for humans and every commit links to them. [behavior] No vendor documents the agent automatically reading CI logs; the repo has to tell it how.
- **Source:** [Claude Code tools reference](https://code.claude.com/docs/en/tools-reference); [Claude Code non-interactive mode](https://code.claude.com/docs/en/headless); [Claude Code common workflows](https://code.claude.com/docs/en/common-workflows); [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode); [gh run view](https://cli.github.com/manual/gh_run_view); [Copilot session tracking](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions).

#### 4.7.2 Log format

- **What to do:** Emit one event per line with a timestamp, a severity, a short message, and key=value or JSON attributes including a request or trace ID. Keep the default level at INFO or above so a 100-line `tail` shows signal, and put debug detail behind a flag or a separate file.
- **Why it helps agents:** The OpenTelemetry log data model defines exactly these fields (`Timestamp`, `SeverityText`/`SeverityNumber`, `Body`, `Attributes`, `TraceId`, `SpanId`) and states that including `TraceId` and `SpanId` "allows to directly correlate logs and traces that correspond to the same execution context"; it contrasts "free-form text formats with no easily automatable and reliable way to parse structured data from them" with "formally structured formats (e.g. JSON files with well-defined schema)." [spec] Anthropic's tool guidance is the agent-side rationale: return "high signal information" with semantic fields, offer `concise` vs `detailed` response formats (72 vs 206 tokens in its example), and make errors "specific and actionable" rather than "opaque error codes or tracebacks." [recommendation] SWE-agent's design rule is "Environment feedback should be informative but concise." [recommendation] No vendor doc states outright that agents parse JSON logs better than prose; the case rests on `grep`/`jq` filterability and bounded windows.
- **Source:** [OpenTelemetry logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/); [OpenTelemetry logs overview](https://opentelemetry.io/docs/specs/otel/logs/); [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents); [Yang et al. 2024](https://arxiv.org/html/2405.15793).

#### 4.7.3 Token and context cost of logs

- **What to do:** Never `cat` a whole log into the conversation. Redirect verbose output to a file (`npm test > logs/test.log 2>&1`), then read only `tail -n 50`, `grep -n FAIL`, or a summary line. Write this rule into `AGENTS.md`. Raise `BASH_MAX_OUTPUT_LENGTH` only for commands that "routinely overflow", such as "a verbose build or a full test-suite log".
- **Why it helps agents:** Claude Code reads back at most 30,000 characters of a successful command "by default, up to a hard ceiling of 150,000"; past the inline limit the model gets "a file path plus preview from the start" and must read or search the file. A failing command is worse: "inline up to roughly 10,000 characters; past that, a head-and-tail excerpt of that size... with no file path", so the middle of a long failure log is simply lost. Piped stdin to `claude -p` is capped at 10 MB. [behavior] Codex sets a "token budget for storing individual tool/function outputs in history" via `tool_output_token_limit`. [behavior] SWE-agent keeps only the last 5 observations in full and collapses earlier ones "into a single line" to "reduce unnecessary context", and refuses search results above 50 hits. [design, ablated] Anthropic's context-engineering post: as tokens grow "the model's ability to accurately recall information from that context decreases." [recommendation]
- **Source:** [Claude Code tools reference](https://code.claude.com/docs/en/tools-reference); [Claude Code env vars](https://code.claude.com/docs/en/env-vars); [Claude Code non-interactive mode](https://code.claude.com/docs/en/headless); [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference); [Yang et al. 2024](https://arxiv.org/html/2405.15793); [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

#### 4.7.4 Agent-side logs as artifacts

- **What to do:** Treat the agent's own records as machine-local: Claude Code session transcripts under `~/.claude/projects/<project>/`, Codex `history.jsonl` and `$CODEX_HOME/log`, and Copilot session logs on github.com. If the team wants a durable record in the repo, have a hook or the agent append one line per decision to a gitignored or explicitly reviewed file, and export structured run output (`claude -p --output-format stream-json`, `codex exec --json`) to CI artifacts rather than to git.
- **Why it helps agents:** Claude Code deletes old transcripts after `cleanupPeriodDays`, hooks can append to any file (`echo ... >> ~/mcp-operations.log` is the documented example), and OpenTelemetry export gives `tool_result`, `api_request`, and `user_prompt` events with a `prompt.id` that "lets you tie all of those events back to the single prompt that triggered them." [behavior] Codex controls transcript retention with `history.persistence` and `history.max_bytes`; `codex exec --json` emits `thread.started`, `turn.completed`, `item.*` events as JSON Lines, and `--output-last-message` writes the final answer to a file. [behavior] Claude Code's `~/.claude` files "are never committed to any repository" and `.claude/settings.local.json` is auto-gitignored; no vendor recommends committing transcripts or telemetry. [behavior] Anthropic's practical alternative is a `Stop` hook that reviews the transcript and "propose[s] CLAUDE.md updates", which turns a log into a durable, reviewed instruction. [recommendation]
- **Source:** [Claude Code memory](https://code.claude.com/docs/en/memory); [Claude Code hooks](https://code.claude.com/docs/en/hooks); [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage); [Claude Code .claude directory](https://code.claude.com/docs/en/claude-directory); [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference); [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode); [Claude Code large codebases](https://code.claude.com/docs/en/large-codebases).

#### 4.7.5 Error output design

- **What to do:** Extend 4.5: scripts should print the failing command, the reason, and the next step on the last lines of output, and exit non-zero on failure. Avoid exit 1 for "no results" conditions in custom tools.
- **Why it helps agents:** Because failure output is head-and-tail truncated at ~10,000 characters, the actionable line must sit at the end. Claude Code treats exit 1 as a failure for every command except a documented benign set (`grep`, `rg`, `find`, `diff`, `test`, `git diff`, `git grep`), so a custom script that exits 1 for "nothing to do" reads as an error. [behavior]
- **Source:** [Claude Code tools reference](https://code.claude.com/docs/en/tools-reference); section 4.5 above.

#### 4.7.6 What is measured

- SWE-agent's ablations are the only controlled results on observation size: a 100-line view beat a full-file view by 5.3 points and a 30-line view by 3.7 points, and the paper collapses old observations to a line to reduce context. [evidence] That is evidence for bounded, windowed output, not for any specific log format.
- A 2026 study of 124 pull requests across 10 repositories found `AGENTS.md` presence associated with 28.64% lower median runtime and 16.58% fewer output tokens "while maintaining a comparable task completion behavior"; it does not isolate log-related instructions. [evidence]
- No published study isolates structured vs free-text logs, log level, or trace IDs as a factor in coding-agent success. See section 9.
- **Source:** [Yang et al. 2024](https://arxiv.org/html/2405.15793); [AGENTS.md efficiency study 2026](https://arxiv.org/abs/2601.20404).

## 5. Naming, module design, and code style

### 5.1 Deep modules with small interfaces

- **What to do:** Prefer a few modules that each hide a lot behind a small, well-named interface over many thin wrappers. Keep public surfaces small and documented at the boundary.
- **Why it helps agents:** Ousterhout's "deep modules" and "information hiding" are the core of *A Philosophy of Software Design*; the author's site frames the book around "separating what's important from what's not important" and notes the second edition expands "General-Purpose Modules are Deeper." The full argument is in the book, not on a reachable primary page. Anthropic's tool guidance is the agent-side analogue: consolidate functionality into "a few thoughtful tools" with "minimal overlap in functionality" because "more tools don't always lead to better outcomes." [recommendation]
- **Source:** [Ousterhout book page](https://web.stanford.edu/~ouster/cgi-bin/book.php); [CS 190 course page](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/index.php); [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents); [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

### 5.2 Names that carry meaning; no hidden state

- **What to do:** Use descriptive names for files, functions, and parameters; return semantic identifiers (`name`, `file_type`) rather than opaque IDs; make configuration explicit and documented instead of ambient globals or magic constants.
- **Why it helps agents:** Anthropic: good parameter names and descriptions "function like documentation"; "'name', 'image_url', and 'file_type' are much more likely to directly inform agents' downstream actions" than UUIDs; avoid "voodoo constants" because "If you don't know the right value, how will Claude determine it?" [recommendation]
- **Source:** [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents); [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents); [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

### 5.3 Poka-yoke the interface

- **What to do:** Design scripts and internal APIs so the easy call is the correct call: absolute paths, no formats that require counting lines, one obvious default with an escape hatch rather than many options.
- **Why it helps agents:** Anthropic changed its SWE-bench file tool "to always require absolute filepaths" after "the model would make mistakes with tools using relative filepaths after the agent had moved out of the root directory," and warns that "writing a diff requires knowing how many lines are changing in the chunk header before the new code is written." [evidence, vendor-internal] Skill guidance: "Provide a default (with escape hatch)" instead of "pypdf, or pdfplumber, or PyMuPDF, or..." [recommendation]
- **Source:** [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents); [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

### 5.4 Typed code and cross-file coordination

- **What to do:** Use static types where the language supports them and keep type checking in the feedback loop. Keep related changes close together so cross-file edits are small.
- **Why it helps agents:** SWE-bench's authors attribute failure to tasks that require "understanding and coordinating changes across multiple functions, classes, and even files simultaneously" and "extremely long contexts." [evidence] Anthropic recommends code-intelligence plugins for typed languages to get "automatic error detection after edits." [recommendation] No controlled study isolates typed vs untyped repos; treat this as inference.
- **Source:** [Jimenez et al. 2023, SWE-bench](https://arxiv.org/abs/2310.06770); [Claude Code best practices](https://code.claude.com/docs/en/best-practices).

## 6. Skills, commands, hooks, and MCP config checked into the repo

### 6.1 Skills in the shared format

- **What to do:** Put repeatable procedures (deploy, release, migration, review checklist) in `<dir>/SKILL.md` with `name` (= directory name, `a-z0-9-`, ≤64 chars) and `description` (≤1024 chars, what it does and when to use it). Keep SKILL.md under 500 lines and move depth to `references/`, `scripts/`, `assets/`. Place them under `.agents/skills/` (Codex, Cursor) and/or `.claude/skills/` (Claude Code; Cursor also reads it). Codex additionally reads `agents/openai.yaml` for UI and invocation policy.
- **Why it helps agents:** Progressive disclosure: "Metadata (~100 tokens)... loaded at startup for all skills; Instructions (< 5000 tokens recommended)... loaded when the skill is activated; Resources... loaded only when required." [behavior] Codex budgets the skills list at "2% of context window (max 8,000 characters)"; Claude Code truncates description+`when_to_use` at 1,536 characters, so lead with the trigger words. [behavior]
- **Source:** [Agent Skills spec](https://agentskills.io/specification); [Claude Code skills](https://code.claude.com/docs/en/skills); [Codex skills](https://learn.chatgpt.com/docs/build-skills); [Cursor skills](https://cursor.com/docs/context/skills).

### 6.2 Commands are skills now

- **What to do:** Write new slash workflows as skills; keep `disable-model-invocation: true` on skills with side effects so only a human triggers them.
- **Why it helps agents:** Claude Code: "Custom commands have been merged into skills"; `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`. Cursor 2.4 ships `/migrate-to-skills` to convert commands and dynamic rules. [behavior]
- **Source:** [Claude Code skills](https://code.claude.com/docs/en/skills); [Cursor skills](https://cursor.com/docs/context/skills).

### 6.3 Scripts for deterministic steps

- **What to do:** Ship small scripts for fragile or repeated operations (validate, migrate, regenerate) and tell the agent to run them, not re-derive them.
- **Why it helps agents:** Anthropic: pre-made scripts are "more reliable than generated code", "save tokens", and "ensure consistency"; "many applications require the deterministic reliability that only code can provide." Codex: "Favor instructions over scripts unless deterministic behavior is required." [recommendation]
- **Source:** [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices); [Anthropic: Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills); [Codex skills](https://learn.chatgpt.com/docs/build-skills).

### 6.4 Hooks for must-always-happen actions

- **What to do:** In the committed `.claude/settings.json`, add `PostToolUse` hooks (`Edit|Write`) for format/lint and `PreToolUse` hooks that exit 2 to block edits to protected paths or destructive commands. Keep hook scripts in `.claude/hooks/` and reference them with `${CLAUDE_PROJECT_DIR}`.
- **Why it helps agents:** "Exit 2 means a blocking error... Without valid JSON on stdout, Claude Code treats exit code 1 as a non-blocking error and proceeds with the action." Hooks have "Zero" context cost unless they return output. [behavior]
- **Source:** [Claude Code hooks](https://code.claude.com/docs/en/hooks); [features overview](https://code.claude.com/docs/en/features-overview).

### 6.5 MCP config at project scope

- **What to do:** Check in `.mcp.json` (Claude Code) or `mcp_servers.<id>` in `.codex/config.toml` (Codex) for servers every contributor needs. Prefer CLIs (`gh`, `aws`, `sentry-cli`) where one exists.
- **Why it helps agents:** Anthropic: "CLI tools are the most context-efficient way to interact with external services." MCP tool names load at start with schemas deferred. [behavior/recommendation]
- **Source:** [Claude Code best practices](https://code.claude.com/docs/en/best-practices); [Claude Code devcontainer](https://code.claude.com/docs/en/devcontainer); [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## 7. Permissions, sandboxing, and safety config

### 7.1 Commit a shared allow/deny list

- **What to do:** In `.claude/settings.json`: allow the safe, common commands (`Bash(npm run *)`, `Bash(git commit *)`), deny reads of secrets (`Read(./.env)`, `Read(./secrets/**)`) and of generated or vendored trees. Keep personal overrides in gitignored `.claude/settings.local.json`.
- **Why it helps agents:** "You can check permission settings into version control to share them with every developer in your organization." Rules "are evaluated in order: deny, then ask, then allow." Deny rules cover the built-in file tools and recognized Bash commands like `cat` and `grep`. [behavior]
- **Source:** [Claude Code permissions](https://code.claude.com/docs/en/permissions); [Claude Code settings](https://code.claude.com/docs/en/settings).

### 7.2 Sandbox by default

- **What to do:** Turn on Claude Code's Bash sandbox (`sandbox.enabled`, with `filesystem.denyRead`/`allowWrite` and `network.allowedDomains`). For Codex, keep the default `workspace-write` + `on-request` and enable `sandbox_workspace_write.network_access` only when a task needs it.
- **Why it helps agents:** Anthropic: "in our internal usage, we've found that sandboxing safely reduces permission prompts by 84%"; without both filesystem and network isolation "a compromised agent could exfiltrate sensitive files like SSH keys." [evidence, vendor-internal] Codex: network "defaults to disabled" in workspace-write and `.git` is "protected as read-only." [behavior]
- **Source:** [Anthropic sandboxing post](https://www.anthropic.com/engineering/claude-code-sandboxing); [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing); [Codex approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security); [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference).

### 7.3 Containers with an egress allowlist for unattended runs

- **What to do:** For `--dangerously-skip-permissions` or unattended batch runs, use a dev container as a non-root user with a default-deny firewall (Anthropic's `init-firewall.sh` reference) and short-lived tokens; never mount `~/.ssh` or cloud credential files.
- **Why it helps agents:** Anthropic warns dev containers "do not prevent a malicious project from exfiltrating anything accessible inside the container" when permissions are skipped, so pair the flag with network egress limits. [recommendation]
- **Source:** [Claude Code devcontainer](https://code.claude.com/docs/en/devcontainer).

### 7.4 Enforcement vs. guidance

- **What to do:** Encode "never" rules as deny rules or hooks; use the instruction file only for behavior you can tolerate being missed occasionally.
- **Why it helps agents:** Anthropic: "Settings rules are enforced by the client regardless of what Claude decides to do. CLAUDE.md instructions shape Claude's behavior but are not a hard enforcement layer." The model "can fail to follow a prompted rule" under long sessions, ambiguity, or prompt injection. [behavior/recommendation]
- **Source:** [Claude Code memory](https://code.claude.com/docs/en/memory); [Claude blog: steering Claude Code](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more).

## 8. What the evidence supports

| Claim | Evidence | Kind |
| --- | --- | --- |
| Edit-time linting guardrail improves resolution | SWE-agent: 18.0% with linter vs 15.0% without (SWE-bench Lite) | measured, published |
| Bounded file view beats full-file dumps | SWE-agent: 100-line window 18.0%, 30-line 14.3%, full file 12.7%; shell-only baseline 11.0% | measured, published |
| Search should cap results and ask for narrower queries | SWE-agent caps at 50 results | design + ablation |
| Instructions in context files are followed | Gloaguen et al.: "instructions in the context files are well followed by coding agents" | measured, published |
| Repository overviews do not raise task success | Gloaguen et al.: no general improvement; >20% higher inference cost | measured, published |
| Context files did not move correctness in a controlled ablation | Two-agent ablation: Claude 53.3% vs 55.6%, Codex 58.8% vs 52.9–56.9%, p=1.00/0.66 | measured, published (small n) |
| File size/position/architecture/contradictions: no detectable effect on adherence; adherence decays within a session | 1,650 Claude Code sessions, 16,050 observations | measured, published |
| Sandboxing reduces permission prompts | Anthropic internal: 84% | vendor-internal |
| Absolute paths reduce tool errors | Anthropic SWE-bench work | vendor-internal, qualitative |
| Small description edits yield large gains | Anthropic tool evals | vendor-internal |
| Underspecified tasks are a major failure source | OpenAI: SWE-bench Verified built to remove "under-specified problem statements"; GPT-4o 33.2% on Verified vs 16% on original | measured, vendor |
| AI can slow experienced developers on mature repos | METR RCT: +19% completion time, n=16 devs, 246 tasks | measured, published |

Sources: [SWE-agent](https://arxiv.org/html/2405.15793); [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988); [two-agent ablation](https://arxiv.org/html/2607.27250); [factorial adherence study](https://arxiv.org/abs/2605.10039); [Anthropic sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing); [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents); [Writing tools](https://www.anthropic.com/engineering/writing-tools-for-agents); [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/); [METR](https://arxiv.org/abs/2507.09089).

## 9. What the evidence does not support / open questions

- **"A rich CLAUDE.md/AGENTS.md makes agents better at tasks."** Not supported. Two independent 2026 studies found no general improvement in task success from context files, and one found a >20% cost increase. Context files reliably change *behavior* (conventions followed, more testing), not *correctness*. Use them to encode non-default practices and commands, not to boost pass rates. ([2602.11988](https://arxiv.org/abs/2602.11988), [2607.27250](https://arxiv.org/html/2607.27250))
- **"Shorter files are followed better."** Vendor claim (Anthropic: longer files "reduce adherence") that a factorial study did not reproduce for file size, position, or architecture. Short files are still justified by per-turn token cost. Open question: whether the adherence effect appears only past some length threshold. ([memory](https://code.claude.com/docs/en/memory), [2605.10039](https://arxiv.org/abs/2605.10039))
- **"Project layout / architecture overview sections help."** Recommended by GitHub and Codex docs; measured as not helpful; now actively trimmed by Claude Code's `/doctor`. ([Copilot](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions), [2602.11988](https://arxiv.org/abs/2602.11988), [memory](https://code.claude.com/docs/en/memory))
- **Deep modules, typed code, small files.** The SWE-agent window result supports bounded views on the *tool* side; there is no controlled study showing that restructuring a repository into smaller files or deeper modules raises agent success. Treat as well-reasoned inference.
- **Security and performance guidance is missing from most context files** (14.8% and 14.5% of 2,303 files); whether adding it changes agent output is untested. ([2511.12884](https://arxiv.org/abs/2511.12884))
- **Adherence decays within a session** (about 5.6% lower odds per generated function). Hooks and fresh contexts (`/clear`, subagents) are the documented mitigations; no study yet quantifies them. ([2605.10039](https://arxiv.org/abs/2605.10039), [best practices](https://code.claude.com/docs/en/best-practices))
- **Structured logs, log levels, and trace IDs.** Recommended by the OpenTelemetry spec for correlation and by Anthropic's tool guidance for token efficiency, but no study measures their effect on coding-agent success. SWE-agent's window ablation supports bounded output only. Context-file *efficiency* gains (28.64% runtime, 16.58% tokens) are measured, but the study does not attribute them to log instructions. ([OTel](https://opentelemetry.io/docs/specs/otel/logs/data-model/), [2405.15793](https://arxiv.org/html/2405.15793), [2601.20404](https://arxiv.org/abs/2601.20404))
- **Vendor-internal numbers** (84% fewer prompts; "dramatic" tool-description gains) are not independently reproducible.
- **METR's slowdown** was measured on repos the developers already knew deeply, with early-2025 tools; it does not say what happens on unfamiliar or greenfield code.
- **Sample sizes** in the ablation literature are small (15–32 tasks per agent in the two-agent study; 138 tasks in AGENTBENCH). Effects under ~10 percentage points are not detectable there.

## Sources

Fetched and used:

- https://agents.md
- https://agentskills.io/specification
- https://code.claude.com/docs/en/memory (redirect from https://docs.anthropic.com/en/docs/claude-code/memory)
- https://code.claude.com/docs/en/best-practices (redirect from https://www.anthropic.com/engineering/claude-code-best-practices)
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/permissions
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/features-overview
- https://code.claude.com/docs/en/large-codebases
- https://code.claude.com/docs/en/sandboxing
- https://code.claude.com/docs/en/devcontainer
- https://code.claude.com/docs/en/tools-reference
- https://code.claude.com/docs/en/env-vars
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/common-workflows
- https://code.claude.com/docs/en/claude-directory
- https://code.claude.com/docs/en/monitoring-usage
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- https://www.anthropic.com/engineering/writing-tools-for-agents
- https://www.anthropic.com/engineering/building-effective-agents
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- https://www.anthropic.com/engineering/claude-code-sandboxing
- https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start
- https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more
- https://learn.chatgpt.com/docs/agent-configuration/agents-md (redirect from https://developers.openai.com/codex/guides/agents-md)
- https://learn.chatgpt.com/docs/build-skills (redirect from https://developers.openai.com/codex/skills)
- https://learn.chatgpt.com/docs/security (redirect from https://developers.openai.com/codex/security)
- https://learn.chatgpt.com/docs/agent-approvals-security
- https://learn.chatgpt.com/docs/config-file/config-reference (redirect from https://developers.openai.com/codex/config-reference)
- https://learn.chatgpt.com/guides/best-practices
- https://learn.chatgpt.com/docs/codex/cli
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions
- https://cli.github.com/manual/gh_run_view
- https://opentelemetry.io/docs/specs/otel/logs/
- https://opentelemetry.io/docs/specs/otel/logs/data-model/
- https://arxiv.org/abs/2601.20404 (On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents, 2026)
- https://cursor.com/docs/context/rules
- https://cursor.com/docs/context/skills
- https://cursor.com/docs/agent/chat/commands (now serves the skills page)
- https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results
- https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment
- https://github.blog/ai-and-ml/github-copilot/onboarding-your-ai-peer-programmer-setting-up-github-copilot-coding-agent-for-success/
- https://geminicli.com/docs/cli/gemini-md/
- https://arxiv.org/abs/2405.15793 and https://arxiv.org/html/2405.15793 (SWE-agent, Yang et al. 2024)
- https://arxiv.org/abs/2310.06770 (SWE-bench, Jimenez et al. 2023)
- https://arxiv.org/abs/2602.11988 (Evaluating AGENTS.md, Gloaguen et al. 2026)
- https://arxiv.org/abs/2511.12884 (Agent READMEs, 2025)
- https://arxiv.org/html/2607.27250 (Do Context Files Help Coding Agents? two-agent ablation, 2026)
- https://arxiv.org/abs/2605.10039 (Instruction adherence factorial study, 2026)
- https://arxiv.org/abs/2507.09089 (METR RCT, 2025)
- https://web.stanford.edu/~ouster/cgi-bin/book.php and https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/index.php (Ousterhout)

Fetched but blocked (403/404), content taken from search snippets or not used:

- https://openai.com/index/introducing-swe-bench-verified/ (403; figures confirmed via search results)
- https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ (403; not used)
- https://learn.chatgpt.com/docs/cloud/environments (404; not used)
