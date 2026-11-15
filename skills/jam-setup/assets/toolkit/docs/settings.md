# Project spending and review settings

Use this procedure for conversational requests such as “No cap for Scenario,” “Disable turnaround approval project-wide,” or “Enable human review for textures.” Read the current policy with `node tools/jam/jam.mjs settings`. Apply clear user requests directly; ask only when the provider, stage or project-versus-current-asset scope is unclear. A request to add an option to the toolkit does not select that option for the project.

## Spending

Ask separately for each billing provider. Name **Meshy credits** and **Scenario credits (Compute Units, CU)**; these are independent currencies, with no implied conversion. For a Scenario-hosted Meshy model, Scenario is the billing provider. Offer all three choices for each provider: **Paid generation disabled**, **Custom per-run limit**, and **No cap**. Ask for an amount only for a custom limit. Do not combine amounts into “100 credits / 100 CU” presets or invent recommended amounts without cost/context evidence.

```sh
node tools/jam/jam.mjs settings --provider meshy --limit 100
node tools/jam/jam.mjs settings --provider scenario --limit none
node tools/jam/jam.mjs settings --provider meshy --limit 0
```

These are examples, not approved settings. `none` stores JSON `null`: explicitly no toolkit cap for that provider. Zero disables paid generation; a positive number caps spending per run. A missing limit is invalid. Provider/account limits still apply. Uncapped work still requires task authorization, known cost estimates, ledger records and duplicate-job reconciliation under [contracts](contracts.md#paid-operation-ledger). No cap does not authorize unrelated generation or automatic purchases/top-ups.

## Human checkpoints

```sh
node tools/jam/jam.mjs settings --stage turnaround --review agent
node tools/jam/jam.mjs settings --stage texture --review human
node tools/jam/jam.mjs settings --stage turnaround --review inherit
node tools/jam/jam.mjs settings --stage all --review agent
```

Review policy is per pipeline: add `--profile <name>` to change it only for runs of that asset profile (for example `node tools/jam/jam.mjs settings --profile prop --stage all --review agent`). It is stored under `review.profiles.<name>` and overrides the project policy for that pipeline; other pipelines keep theirs. Most specific wins: a run's own human stages, then its pipeline, then the project. Use the project-wide form only when the user asks for a change across every pipeline.

`agent` disables the human checkpoint while retaining agent review and artifact validation. `human` enables it. `inherit` removes that stage's override and restores the project default. `all` replaces the default and clears all stage overrides; use it only when the user requests a project-wide change for all stages. Stages are listed by `settings`.

Commands preserve unrelated configuration, validate the result and write atomically under a lock. Their output lists the effective project policy. Existing candidate review records are preserved; enabling human review can require a new human decision for an agent-accepted candidate on the next status check. Disabling a checkpoint never accepts an unreviewed candidate automatically.

A run's `humanStages` can impose stricter requirements. For an active asset, inspect that list and run `status` after changing project policy; explain any human checkpoint still required by the run. A project change does not silently remove those overrides. If the human explicitly changes only a current-run preference, edit only that run's `humanStages` while it has one owner and rerun `status`; removing an entry restores project policy, so it cannot waive a project-required human gate. If their requested run-only relaxation conflicts with project policy, explain the conflict and ask whether to change the project policy.

Complete when the requested setting is persisted and the reply names the provider or stages affected, project/run scope, and any surviving run override. Include the user's actual instruction and available conversation reference in the change summary, and in the commit message when committing the changed configuration or versioned run. This records the authority for lowering a human requirement without rewriting artifact approvals. The settings command does not authenticate the user or store consent itself.
