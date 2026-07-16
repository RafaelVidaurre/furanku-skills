---
name: product-memory
description: Discover, preserve, and reconcile product requirements using verbatim user evidence, traceable specifications, explicit decision records, open questions, hypotheses, risks, and validation experiments. Use for product ideation, requirements discovery, PRDs/specs developed across conversations, multi-session or multi-agent product work, decision tracking, scope reconciliation, or when important requirements and rationale must not be lost.
license: MIT
metadata:
  author: rafaelvidaurre
---

# Product Memory

Maintain two linked truths: what the user actually said and the current product interpretation. Never promote an inference or recommendation into a user decision.

## Select the operating mode

- **Initialize:** Set up durable product-memory artifacts in a repository that lacks them.
- **Discover:** Clarify outcomes, users, constraints, boundaries, and acceptance criteria.
- **Capture:** Preserve a substantive conversation and distill its implications.
- **Reconcile:** Resolve contradictions, changed direction, or stale requirements without erasing history.

These modes can occur in the same turn.

## Initialize product memory

1. Read the repository's instruction files and existing product documentation.
2. Reuse equivalent existing artifacts instead of creating a parallel system.
3. When no equivalent exists, run:

   ```bash
   python3 <skill-dir>/scripts/init_product_memory.py --root <repository-root>
   ```

   Resolve `<skill-dir>` to the directory containing this skill's `SKILL.md`.

4. Review generated templates and adapt paths or terminology to the project.
5. Add a concise instruction to the repository's canonical `AGENTS.md` requiring agents to follow `docs/product-memory/protocol.md`, read the relevant specification and decisions before substantive product work, and follow source links when exact intent matters. Merge carefully; never overwrite existing instructions.
6. If equivalent agent-instruction filenames are required, preserve the project's canonical-file and symlink convention.

The initializer never overwrites existing files. If the project already has partial artifacts, integrate them manually.

**Complete when:** `docs/product-memory/` contains the required artifacts (or an explicit project-equivalent path), `AGENTS.md` points agents at the protocol, and dry initialization reports only skips for existing files.

## Discover requirements

Work from concrete stories before feature lists. Ask one to three high-leverage questions at a time, choosing among:

- What changed in the user's life or work if the product succeeds?
- Who experiences the problem, and what happened immediately before using the product?
- What should feel valuable within the first session?
- What outcome matters more than the proposed implementation?
- What would feel unsafe, exhausting, deceptive, or out of character?
- Which constraints are fixed, and which are assumptions?
- What distinguishes the long-term vision, the next release, and the demonstration scope?
- What observable behavior proves the requirement is satisfied?

Push back on incoherent scope, hidden conflicts, unsafe agency, weak differentiation, or unsupported assumptions. State the tradeoff and offer a constructive alternative. Preserve disagreement as disagreement.

**Complete when:** the next material uncertainty is either answered, recorded as `Q-###`/`H-###`/`K-###`, or deferred with an explicit reason.

## Maintain the evidence model

Use permanent IDs:

- `U-###`: verbatim user evidence
- `R-###`: requirement
- `D-###`: decision
- `Q-###`: open question
- `H-###`: hypothesis
- `K-###`: risk
- `X-###`: experiment or validation

Never reuse an ID. Find the highest existing number before assigning the next one.

Use evidence labels:

- `user-stated`: directly stated by the user
- `agreed`: explicitly accepted by both sides
- `inferred`: interpretation requiring validation
- `external`: learned from a cited outside source

Use lifecycle states where relevant:

- `proposed`, `decided`, `validated`, `deferred`, `rejected`, `superseded`

## Capture every substantive turn

After a user statement that can change intent, behavior, scope, priority, constraints, evaluation, or rationale:

1. Append it verbatim to a dated file under `docs/product-memory/conversations/`.
2. Preserve wording and mark omissions explicitly. Put contextual explanation outside the quote.
3. Assign one or more `U-###` IDs at meaningful boundaries.
4. Distill new or changed requirements into `spec.md`, citing the source IDs.
5. Add unresolved interpretations to `discovery.md` as questions or hypotheses.
6. Add a `D-###` only when the user explicitly decides or clearly agrees. Record rejected and superseded directions when they affect future interpretation.

Do not record pleasantries. Do record short confirmations when their context turns a proposal into a decision; include the confirmed proposal in the surrounding context.

**Complete when:** every material statement has a `U-###`, every new requirement or decision cites evidence, and open uncertainty is visible in `discovery.md` or the decision log.

## Distill without corrupting intent

- Keep raw evidence append-only. Annotate corrections instead of rewriting quotes.
- Cite every material requirement and decision back to evidence.
- Mark agent synthesis as `inferred` until validated.
- Separate examples from committed scope.
- Separate desired outcomes from suggested implementations.
- Preserve rationale and consequences, not only the chosen option.
- When exact words and distilled documents conflict, exact words win until reconciled with the user.
- Mark replaced items `superseded` and link both directions; never silently delete history.

## Validate integrity

Run after substantive updates:

```bash
python3 <skill-dir>/scripts/check_product_memory.py --root <repository-root>
```

Fix duplicate ID definitions, missing required artifacts, and unknown ID references. If the repository uses adapted paths, pass `--path <relative-memory-path>`.

Before finishing, confirm:

- New material user intent is captured verbatim.
- Requirements and decisions cite evidence.
- No proposal was promoted to a decision without agreement.
- Contradictions and uncertainty remain visible.
- The current product interpretation can be reconstructed from the specification, decisions, and their evidence links.

**Complete when:** the checker exits 0 (or reports only intentional project-path adaptations already passed via `--path`), and the finishing confirmations above hold.
