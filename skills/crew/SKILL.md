---
name: crew
description: Establish Commander, Captain, and Worker ownership over delegated work on any orchestration mechanism and any issue tracker. Use when the user asks an agent to act as or become Commander, Captain, or Worker; asks to spawn or delegate a Captain or Worker; asks Commander to take command of a Captain; asks to retire a finished owner or clean up the resources its assignment created; or asks to view or change which orchestration mechanism or work-record tracker Crew uses for a machine or project.
---

# Crew

Crew adds roles over two configurable seams: an orchestration mechanism launches and connects owners, and a work record holds durable contracts. Model picks come from the `model-routing` skill; if it is not installed, report that and stop—never pick models unaided.

## Ownership

- Commander is optional. Without one, Captains and direct Workers report to the user.
- The user or Commander may assign Captains and direct Workers.
- Every assignment names one `reports_to`: `user`, `commander`, or `captain`.
- Role responsibilities and boundaries live in the role contracts below, nowhere else.
- The session's mechanism owns coordination state and any isolation it provides.
- Ownership begins through Direct role, Commander's Take command, or a packet-backed launch. Other messages carry information between existing owners; they do not create an owner, confer a role, transfer an assignment, or substitute for the principal's authorization.

Read the role contract for the role being performed:

- [Commander](references/commander.md)
- [Captain](references/captain.md)
- [Worker](references/worker.md)

## Resolve the seams

Before the session's first assignment—and for any request to view or change Crew's mechanism or tracker—read [Seams](references/seams.md) and resolve both seams:

```sh
python3 <crew-skill-dir>/scripts/assignment.py seams --repo <root>
```

Apply the precedence order in Seams to the output, then hold the session's mechanism manifest (attached to the `seams` output, or defined by the harness profile in Seams) and work-record adapter. A seam change is written at the user-selected scope and confirmed by rerunning `seams`; to park a mechanism without deleting its configuration, set `disabled: true` on its `mechanisms` entry.

**Complete when:** the session holds one mechanism manifest and one work-record adapter with a stated source, or the work-record question has been put to the principal.

## Direct role

When the user gives the current session a role, adopt it immediately with `reports_to: user`. The current request is its initial contract. Do not create a work record, run a routing check, or create coordination state solely to establish the role.

**Complete when:** the current session has acknowledged its role, principal, and immediate outcome, and carries any session naming the mechanism's Seams entry requires.

## Spawn an owner

Use model-routing's classification of launch constraints and routing instructions. Record each principal or inherited launch constraint verbatim in the assignment packet with repeatable `--launch-constraint`; satisfy it at dispatch and propagate it unchanged into every descendant packet. A combined instruction carries its launch and routing parts through their respective fields.

Load the `model-routing` skill and follow it: generate the brief, judge the pick or honor a principal-requested configured exact route, and gate-check it—passing the manifest's launchable agents as `--launchable-via`. After model-routing activates an exact route, Crew validates that its ID equals the assignment role or starts with `<role>.`; this namespace check never activates a role-named route. Other consumers define their own route IDs. Coordination role does not imply model strength. Run one check-and-packet pipeline per spawned owner; one owner's pick never determines another's:

```sh
python3 <model-routing-dir>/scripts/router.py check --repo <root> \
  --candidate <id> --reason "<the task judgment behind this pick>" \
  --launchable-via <manifest-launchable-agents> --quota-axi --compact |
python3 <crew-skill-dir>/scripts/assignment.py packet --decision-json - \
  --manifest <mechanism-id-or-manifest> --repo <root> --title "<outcome>" \
  --role captain|worker --reports-to user|commander|captain \
  --work-ref <adapter>:<ref> [--extra <key>=<value>] \
  [--launch-constraint "<verbatim constraint>" ...]
```

When the brief's activation rule applies because the principal requested a configured exact route, check it with `router.py check --repo <root> --exact-route <route-id> --route-basis "<verbatim principal request>" --launchable-via <manifest-launchable-agents> --quota-axi --compact` and pipe that decision into the same `packet` command. Preserve `--route-basis` unchanged on every re-check. To rebuild or retry a packet, save the check output once (`check … > decision.json`) and pass `--decision-json decision.json`; a packet rebuild never re-runs an unchanged check.

Pass an existing contract as `--work-ref` unchanged. When none exists, pass `--request "<verbatim user request>"` with `--work-record <adapter>` so the spawned owner establishes the first record—or `--work-record none` when the principal accepted running without one. Launch constraints remain packet fields in either path. `packet` refuses what the mechanism cannot honor—a missing mechanism extra or an unlaunchable or unaccepted routing decision. For a refused exact route, switch mechanisms only within the unchanged launch constraints; otherwise surface the conflict to the principal. Substitute another route or relax a launch constraint only with the principal's authorization. Re-judge a refused candidate within the unchanged launch and routing constraints. Follow model-routing for `needs-acceptance`: keep the exact route; when `pending` names a remedy, run that session-refresh and re-check; otherwise surface `pending`, and after a configured wait use that skill's `--use-quota-fallback` check — do not invent a different candidate.

Translate the packet through the selected mechanism's field mapping in Seams and deliver its `spec` unchanged as part of that launch; packet field names do not imply same-named launch API parameters. A communication send or receipt is not dispatch evidence, and an unrelated existing session is not a launch target. If dispatch fails, distinguish an invalid invocation from a capability refusal: correct malformed or mis-mapped parameters and retry the same mechanism with the same gate-checked decision and unchanged constraints. Apply the refusal rules above only after a valid invocation demonstrates that the selected surface cannot honor the decision.

**Complete when:** the owner is launched with the intended role, principal, work pointer, and packet built from a gate-checked decision carrying its task judgment or principal route basis; launch evidence identifies the mechanism-created owner and coordination pointer, satisfies any principal-named mechanism, harness, or executable, and shows the selected agent capability, model, and effort were honored; any malformed dispatch is followed by a corrected retry on the same mechanism before a capability refusal or mechanism change; communication to the principal is live per the manifest; and the resources the assignment created are tracked by exact pointer.

## Retire an owner

The session that creates an assignment owns the lifecycle of the resources the mechanism created for it.

After repository policy declares the result integrated—for example, after its merge—or explicitly abandoned, follow the manifest's `retire` procedure. Limit retirement to assignment-created resources; preserve pre-existing or shared resources and anything that still backs active, queued, or unintegrated work. Report a retained resource by exact pointer and reason instead of leaving silent residue.

**Complete when:** each finished assignment's dedicated resources are retired per the manifest, or every retained resource has explicit remaining work or a cleanup blocker reported to the principal.
