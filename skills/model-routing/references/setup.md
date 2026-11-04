# Agent-guided routing setup

Read when setting up routing for a machine or project, or changing recovery preferences. Setup works with the native routing agent and existing configuration; it needs no gateway account or selector service.

1. Run `router.py setup --repo <root>` and read the returned `questions`, current `preferences`, and configuration layers. `status: ready` means inspection succeeded; `setup_complete` reports whether recovery preferences have explicit answers. Existing routing remains usable while setup is incomplete, with the effective policy shown in the result.
2. Ask only the returned unanswered questions. Present the default and consequence alongside each choice. Required answers cover behavior on a quota limit and behavior when the user does not reply. If continuation is chosen, offer the displayed response duration; accepting the ordinary duration is sufficient. Finish when each required answer is recorded and the chosen duration is clear. Use [message guidance](message-templates.md) for wording and [configuration](configuration.md) for the field definitions.
3. Select an explicit persistence scope with the user: `global`, `repo`, or `machine-repo`. Put the answered policy fields in a JSON object and generate a preview:

   ```sh
   python3 <skill-dir>/scripts/routing_setup.py preview --repo <root> \
     --scope <scope> --file <choices.json>
   ```

   `--role commander|captain|worker` targets that role; `--route <id>` targets recovery on an existing exact route in the chosen layer. Define a missing route through `config.py` first, so setup never copies a launch tuple into a new scope implicitly. Finish when the preview identifies the intended path, complete `before` and `after` documents, and the effective policy with field sources.
4. Show the preview and obtain approval to save those choices. Apply that exact preview document through `routing_setup.py apply --file <preview.json>`. A changed input requires a fresh preview and review. Finish when the result says `applied` or `unchanged` and its effective status matches the approved policy.

The router's `setup --setup-file <choices.json> --scope <scope>` and `setup --apply-setup <preview.json>` expose the same preview/apply flow. Inspection and preview perform no writes and read no live credentials. Apply locks all three persisted layers in canonical path order, revalidates the preview, then atomically replaces the target while retaining those locks through effective-policy inspection. Ordinary config writes and deletion share these locks. A competing writer is refused; locks owned by another process are preserved. Reapplying a completed preview leaves the config untouched. Other routes, preferences, candidate settings, quota account configuration, and role policies are preserved.

Optional customization stays in the existing configuration interface: inspect `config.py models` for allowed launch combinations and state, edit ordinary `preferences` for model or provider intent, and use candidate overrides for allowed models. [Accounts](accounts.md) covers quota-account selection. Recovery policy contains behavior and bounds, not model favorites or a second provider registry.
