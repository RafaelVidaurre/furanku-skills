---
name: human-playtest
description: Record audio and video while a person speaks feedback about an app, website, prototype or game, with timestamped screenshots. Use to capture a feedback session, control an ongoing recording, or extract and organize feedback from supplied evidence.
---

# Human playtest

Let the user interact and speak freely while you record quietly. Return feedback
organized by topic, supported by quotes, timestamps and visual evidence.

- To **record or control a session**, use [capture.md](references/capture.md).
- To **read or save preferences**, use [configuration.md](references/configuration.md).
- To **extract and organize feedback**, use [review.md](references/review.md).

## Recording

Resolve the target from the request, context or saved settings, then verify its
current window/display ID. Ask only if the target is still unclear. Never widen
a window capture to the desktop when that window is unavailable.

Honor an explicit or saved screenshot interval. Otherwise offer **0.25 seconds**
(default, four images per second), **0.5 seconds** (half the images), or **1 second**
(lighter storage, less detail). Positive custom intervals work through `--interval`.

Defaults are microphone audio, H.264 video, live PNG screenshots, and soft caps
of **60 minutes / 2 GiB**. Configuration resolves per field: built-in defaults →
machine-global → matching path scopes, most specific last → invocation flags.
Project preferences stay in the machine configuration, outside project files.

Before capture, state the retention plan: the default deliverable is one portable
feedback report with selected screenshots. Raw recordings and transcripts are
working material. Honor an existing retention choice; source deletion requires
the user's authorization for that session, not merely a request to record.

Announce readiness only after `start` confirms capture output. Keep the returned
session ID/path for `status`, `limits` and `stop`. During recording, stay quiet
except for direct questions, capture errors or cap warnings. Muting a voice chat
does not necessarily mute the microphone being recorded.

After `stop`, confirm finalization and inspect the saved media. Report missing
coverage or missed screenshot intervals that affect the feedback.

## Feedback

Keep raw media and transcripts intact during review; keep corrections separate. Use media times,
not transcript arrival times. Distinguish the user's intent from uncertainty in
the evidence and from how specific their proposed solution is.

Consolidate repeated concerns, retain distinct concerns, positive feedback and
withdrawals, and omit vague placeholders. Collecting feedback authorizes notes,
not product changes or tracker issues.
After verifying the final report and its evidence, apply the agreed source
cleanup. If deletion was not authorized, ask before removing recordings.
