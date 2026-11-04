# Quota recovery using the existing orchestrator

Read when a launch fails or an assignment stops on a confirmed usage limit, or when considering a below-reserve account. The orchestrator owns attempts, failure observations, questions, waiting, and replacements. Model-routing returns a decision; it starts no processes, sends no messages, and keeps no duplicate lifecycle database.

## Below-reserve selection

The default reserve is 5%. A ready account for the same model above its reserve is preferred. When none exists, a fresh, attributed account with positive allowance remains eligible below reserve. Actual exhaustion, unknown allowance, identity mismatch, and unavailable launch surfaces remain distinct failures.

For an equivalent model, judge the particular job: required features/context, quality evidence, model/effort, allowed providers, spending constraints, and the mechanism's launch capabilities. Reuse the current brief; no extra model call or benchmark scan is required. Pass `--alternative <candidate>` and `--equivalence-reason '<task-specific judgment>'` to the original `check` (Crew `packet` passes these through). The original requirements also gate the alternative. `alternative-available` exits 2 and carries the original decision and the checked alternative; select the latter only under the user's preferences. If no ready equivalent qualifies, the reserve alone does not block the original positive allowance.

Use `--require-original` when the principal requires the original model/effort. A preference permits substitution; a requirement does not. An explicit-only model needs its own principal request and is not an automatic substitute. Keep spending/provider restrictions in the existing preferences and candidate configuration; an equivalent's raw benchmark score alone is insufficient.

**Complete when:** the selected launch preserves task requirements and any honored reserve has a ready equivalent, or the actual blocking reason is reported.

## Interpret an observed failure

1. Read the mechanism's supported status/event or documented failed-start recovery. For Orca, follow Crew's version-matched Orca guide; for a native harness, use its task/agent result. A quiet screen, missing response, startup timeout, HTTP 429 without usage-limit attribution, or a crashed process does not establish quota exhaustion. Unknown causes stay with the mechanism's diagnostic procedure.
2. Preserve the work, current contract, and child ownership. Settle the exact failed attempt through its mechanism before replacement; retain unresolved resources. For a Captain, keep its existing Workers and pending decisions rather than respawning the Crew.
3. Store the following small observation with the existing assignment record, using the real event pointer and the packet's `routing_decision` (or original router decision). This is input to a pure recovery decision, not a new tracker:

   ```json
   {
     "attempt": "mechanism:attempt-id",
     "evidence": "mechanism:failure-event-id",
     "observed_at": "2026-01-01T12:00:00Z",
     "phase": "interrupted",
     "cause": "quota_exhausted",
     "settled": true,
     "replacement_count": 0,
     "decision": {"...": "original routing decision, unchanged"}
   }
   ```

   `phase` is `before_start` or `interrupted`. Other supported causes (`rate_limited`, `auth_required`, `start_failed`, `unknown`) return `inspect`; use the mechanism's bounded backoff or readiness path. Include `resets_at` only when the provider reported it. `replacement_count` comes from the existing assignment's replacement history, not a counter reset for each invocation.
4. Run `router.py recover --repo <root> --event-file <observation.json> --codexbar`, optionally with a judged `--alternative` and `--equivalence-reason`. The original launch/feature/context requirements are carried forward. Recovery gates the saved tuple even if its named route has changed; replacements retain their originating role/route policy context. The command forces fresh quota and invalidates the exhausted binding and matching account aliases. If it reports `refresh_required`, use `--refresh-quota` on subsequent checks until invalidation succeeds. Account identity remains checked independently of quota freshness.

**Complete when:** the observation identifies the attempt, cause and evidence, and the returned next action is held by the assignment's existing owner. Exit 2 means a recovery action is available, not a launched replacement.

## Execute the returned action

| Action | Existing owner does |
| --- | --- |
| `inspect` | Use mechanism diagnostics; report uncertain causes explicitly. |
| `settle_attempt` | Preserve work and settle the prior attempt before retrying. |
| `resume` | Use the embedded `decision` in a new Crew packet or native launch; verify actual start through the mechanism. |
| `choose_alternative` | Judge a different equivalent and repeat recovery within the remaining attempt budget; if none exists, keep this assignment blocked. |
| `ask` | Present the supplied choices/message through the available question mechanism, including the no-reply consequence. |
| `await_answer` | Wait on the existing question/wake; keep independent work moving. |
| `wait` | Use the mechanism's scheduled wake or wait until `until`. |
| `recheck` | Force fresh quota and gate the original tuple after the reported reset; time passing is not fresh allowance. |
| `stop` | Preserve the affected assignment and stop its automatic recovery. |

Persist the existing question ID and its actual presentation time in `question: {"id": "...", "asked_at": "..."}` on the observation. On a reply, record `answer: "continue"|"wait"|"stop"` there. Re-running recovery uses that original time; it does not restart the window. Stop versus continue after the response window is a setup preference; the default window is 600 seconds. An explicit answer wins over the no-reply policy. Unknown quota still requires its separate acceptance; unattended continuation never manufactures quota or permission to change a required model.

Reuse the existing orchestrator/notification question. When Notifai is enabled, follow its installed skill; otherwise use the harness's question facility. Keep private paths, account identities, credentials, and provider logs out of outward messages. Templates live in [message-templates.json](message-templates.json). Fill only the context needed for the decision and show a concrete candidate when one is available.

Use event-driven waits or a supported scheduled wake instead of short polling loops. If the mechanism cannot wake on a reply/deadline, state that limitation and retain the pending action for its next invocation; do not promise automatic continuation. Record recovery execution in the original mechanism before another decision, so retries or late replies cannot launch a second owner. A late reply after replacement applies at the next safe checkpoint; report what already happened.

Ask once for assignments sharing the same affected allowance and effective recovery policy when the question mechanism supports grouping. A failure to deliver a question is not a presented question and does not start its timeout.

**Complete when:** the mechanism confirms the replacement started, or the affected assignment has a recorded stop/wait/question with its next wake or explicit wake limitation. A routing decision alone is not runtime acceptance.
