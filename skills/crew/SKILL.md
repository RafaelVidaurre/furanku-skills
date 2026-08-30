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

Load the `model-routing` skill and follow its judgment rules. Use Crew's adapter to show only candidates the mechanism can launch; it derives launchability from the manifest and loads live quota:

```sh
python3 <crew-skill-dir>/scripts/assignment.py brief --repo <root> \
  [--manifest <mechanism-id-or-manifest>]
```

Judge the pick from that brief, then build one gate-checked packet per owner:

```sh
python3 <crew-skill-dir>/scripts/assignment.py packet --repo <root> \
  [--manifest <mechanism-id-or-manifest>] \
  --candidate <id> --reason "<concise task judgment>" --title "<outcome>" \
  --role captain|worker --reports-to user|commander|captain \
  --work-ref <adapter>:<ref> [--extra <key>=<value>] \
  [--launch-constraint "<verbatim constraint>" ...]
```

When the brief's activation rule applies, replace `--candidate` and `--reason` with `--exact-route <route-id> --route-basis "<verbatim principal request>"`. Crew validates that an activated route ID equals the assignment role or starts with `<role>.`; the role name alone never activates a route. Preserve the basis on quota-acceptance or fallback retries. Pass hard requirements directly as `--require-feature` or `--minimum-context`; `max` candidates may also need `--max-effort-basis` as model-routing specifies.

Omit `--manifest` when the active configured mechanism supplies one; pass a manifest for a session-specific or dynamically discovered harness profile. Pass an existing contract as `--work-ref` unchanged. Otherwise use `--request "<verbatim user request>"`; `packet` infers a configured work-record adapter, while `--work-record <adapter|none>` records a session override. When a later packet rebuild is likely, add `--decision-out <file>` to save the raw gate-check result; rebuild with `--decision-json <file>` instead of candidate or route arguments so the unchanged check is not rerun.

`packet` refuses missing mechanism extras and unlaunchable or unaccepted decisions. Re-judge a refused candidate within unchanged principal constraints. Preserve a refused exact route and satisfy it through a permitted launch surface or surface the conflict. Follow model-routing's `needs-acceptance` remedy, acceptance, and fallback rules without substituting another candidate.

Translate the packet through the selected mechanism's field mapping in Seams, apply any selected `launch_note`, and deliver its `spec` unchanged as part of that launch; packet field names do not imply same-named launch API parameters. A communication send or receipt is not dispatch evidence, and an unrelated existing session is not a launch target. If dispatch fails, distinguish an invalid invocation from a capability refusal: correct malformed or mis-mapped parameters and retry the same mechanism with the same gate-checked decision and unchanged constraints. Apply the refusal rules above only after a valid invocation demonstrates that the selected surface cannot honor the decision.

**Complete when:** the owner is launched with the intended role, principal, work pointer, and packet built from a gate-checked decision carrying its task judgment or principal route basis; launch evidence identifies the mechanism-created owner and coordination pointer, satisfies any principal-named mechanism, harness, or executable, and shows the selected agent capability, model, and effort were honored; any malformed dispatch is followed by a corrected retry on the same mechanism before a capability refusal or mechanism change; communication to the principal is live per the manifest; and the resources the assignment created are tracked by exact pointer.

## Retire an owner

The session that creates an assignment owns the lifecycle of the resources the mechanism created for it.

After repository policy declares the result integrated—for example, after its merge—or explicitly abandoned, follow the manifest's `retire` procedure. Limit retirement to assignment-created resources; preserve pre-existing or shared resources and anything that still backs active, queued, or unintegrated work. Report a retained resource by exact pointer and reason instead of leaving silent residue.

**Complete when:** each finished assignment's dedicated resources are retired per the manifest, or every retained resource has explicit remaining work or a cleanup blocker reported to the principal.
