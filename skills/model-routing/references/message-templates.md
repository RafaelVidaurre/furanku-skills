# Recovery and setup messages

Read when presenting a setup choice or reporting quota recovery. The canonical recovery text lives in [`message-templates.json`](message-templates.json); use its matching template rather than maintaining another copy in a caller.

For setup, ask only fields returned in `questions` by `router.py setup`. Present one coherent decision at a time: quote its prompt, display its choices or duration and default, then record the answer in the choices JSON. A default shown during inspection is not a user answer. When approving continuation, show the response duration in the final preview even when the user accepts the ordinary value.

For a recovery question, include the affected task, what exhausted quota, the eligible alternative or bounded wait, the response deadline, and the configured consequence of silence. The stated consequence must match the resolved `on_no_reply` policy. Finish when the user can tell what will happen both with and without a reply.

For a recovery result, report the replacement that actually started, the bounded wait that actually began, or the reason work stopped. A launch proposal is distinct from a successful launch. Finish when the message describes the observed state and any remaining user action.
