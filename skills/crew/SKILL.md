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

Read the role contract for the role being performed:

- [Commander](references/commander.md)
- [Captain](references/captain.md)
- [Worker](references/worker.md)

## Resolve the seams

Before the session's first assignment—and for any request to view or change Crew's mechanism or tracker—read [Seams](references/seams.md) and resolve both seams:

```sh
python3 <crew-skill-dir>/scripts/assignment.py seams --repo <root>
```

Apply the precedence order in Seams to the output, then hold the session's mechanism manifest (from Seams' known-mechanism entries or the configuration) and work-record adapter. A seam change is written at the user-selected scope and confirmed by rerunning `seams`.

**Complete when:** the session holds one mechanism manifest and one work-record adapter with a stated source, or the work-record question has been put to the principal.

## Direct role

When the user gives the current session a role, adopt it immediately with `reports_to: user`. The current request is its initial contract. Do not create a work record, run a routing check, or create coordination state solely to establish the role.

**Complete when:** the current session has acknowledged its role, principal, and immediate outcome, and carries any session naming the mechanism's Seams entry requires.

## Spawn an owner

Load the `model-routing` skill and follow it: generate the brief, judge the pick, and gate-check it—passing the manifest's launchable agents as `--launchable-via`. Coordination role does not imply model strength. Run one check-and-packet pipeline per spawned owner; one owner's pick never determines another's:

```sh
python3 <model-routing-dir>/scripts/router.py check --repo <root> \
  --candidate <id> --reason "<the task judgment behind this pick>" \
  --launchable-via <manifest-launchable-agents> --quota-axi --compact |
python3 <crew-skill-dir>/scripts/assignment.py packet --decision-json - \
  --manifest <manifest> --title "<outcome>" \
  --role captain|worker --reports-to user|commander|captain \
  --work-ref <adapter>:<ref> [--extra <key>=<value>]
```

Pass an existing contract as `--work-ref` unchanged. When none exists, pass `--request "<verbatim user request>"` with `--work-record <adapter>` so the spawned owner establishes the first record—or `--work-record none` when the principal accepted running without one. `packet` refuses what the mechanism cannot honor—an unreachable launcher, a missing mechanism extra, an unlaunchable or unaccepted routing decision; answer a refusal by following its message, never by dispatching around it.

Launch the packet's launch tuple through the mechanism and deliver the packet's `spec` as the owner's assignment, following the mechanism's Seams entry for naming and delivery.

**Complete when:** the owner is launched with the intended role, principal, work pointer, and the packet built from a gate-checked decision, communication to the principal is live per the manifest, and the resources the assignment created are tracked by exact pointer.

## Retire an owner

The session that creates an assignment owns the lifecycle of the resources the mechanism created for it.

After repository policy declares the result integrated—for example, after its merge—or explicitly abandoned, follow the manifest's `retire` procedure. Limit retirement to assignment-created resources; preserve pre-existing or shared resources and anything that still backs active, queued, or unintegrated work. Report a retained resource by exact pointer and reason instead of leaving silent residue.

**Complete when:** each finished assignment's dedicated resources are retired per the manifest, or every retained resource has explicit remaining work or a cleanup blocker reported to the principal.
