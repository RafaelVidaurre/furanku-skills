# Recovery and setup messages

Read when presenting a setup overview, proposed edit, or quota recovery. Canonical templates live in [`message-templates.json`](message-templates.json).

Fill `setup_overview` from the setup result and the current configuration helpers, not from remembered defaults. Use these sections:

- **Behavior table:** when quota runs out, response window, behavior without a reply, maximum quota wait, and replacement limit. Include a source column distinguishing a shipped default from an explicit setting, even when their values match. Use readable durations such as “10 minutes” and consequences such as “Stop this assignment.”
- **Quota:** freshness and reserve from the effective account policy; explain that reserve is honored only when a ready equivalent exists. Flag per-account exceptions with safe labels, without dumping identities or profile paths. Configured policy is not evidence of live allowance or installed provider tools.
- **Models and roles:** summarize active model/effort preferences, restrictions, and named routes; show “No model preference configured” only when that is true. Present Captain/Worker differences explicitly. A role's recovery policy does not assign it a model. Use `config.py models` or `report` without quota probes when merged candidate or route state is needed; expand a long list only on request.
- **Overrides:** label global as “All projects,” repo as “This project (shared),” and machine-repo as “This project on this machine.” Show applicable role/route exceptions and which scope wins. Resolve a selected role/route through `setup --role ... --exact-route ...` when needed; general policy alone is not the whole setup. Preserve conflicts or uncertainty in natural-language preferences instead of inventing one effective winner.

The template's closing question offers **Keep current setup**, **Change settings**, or **Review overrides** through the available question interface. Replace it with the concrete change preview if the user already specified an edit. `questions` lists missing onboarding answers, not the set of editable fields. Defaults displayed during review are not user answers. Fill `setup_change_preview` with only changed rows and their effective consequences; if a narrower override masks the proposed edit, make that visible before saving.

Keep the overview in the active conversation. When a notification channel is required, follow its privacy rules and send only a safe question, not the setup overview or private configuration. Complete when the user can understand what applies and choose whether to change it without reading configuration syntax.

For a recovery question, include the affected task, what exhausted quota, the eligible alternative or bounded wait, the response deadline, and the configured consequence of silence. The stated consequence must match the resolved `on_no_reply` policy. Finish when the user can tell what will happen both with and without a reply.

For a recovery result, report the replacement that actually started, the bounded wait that actually began, or the reason work stopped. A launch proposal is distinct from a successful launch. Finish when the message describes the observed state and any remaining user action.
