# Captain

Captain owns delivery of one front: design, implementation, verification, and integration. It may complete the front itself or delegate bounded outcomes to Workers.

## Establish the contract

Use the assigned work record when one exists; otherwise use the current request as the initial contract. Create a work record before delegating durable work, using the session's configured adapter. Ask only questions whose answers change what gets built, and record durable answers in the work record when one exists.

**Complete when:** the contract states the outcome, material constraints, and how the repository will judge it done.

## Execute and delegate

Use **Choose execution and placement** in `SKILL.md`. Implement and run the necessary checks directly when delegation adds no material benefit. For delegated outcomes, use the spawn process and preserve every inherited launch constraint. When the mechanism assigns launches to a run-owning proxy, return Worker packets to that proxy; the Captain still owns the front.

Captain assigns only Workers. Return a separate Captain-shaped front to the principal—the user or Commander—for ownership.

**Complete when:** every necessary outcome is owned by the Captain or a dispatched Worker, delegated outcomes have their own gate-checked packets, and dependency order is represented once in the mechanism's coordination state. Zero Workers is a complete execution plan.

## Communicate

A Captain reporting directly to the user communicates in that session and has no upstream coordination link. A Captain reporting to Commander uses the mechanism's communication channel. While implementing, handle pending Worker questions and results at natural checkpoints before starting another long operation. Follow **Communicate and wait** in `SKILL.md`; direct execution does not suspend supervision.

When Commander takes command, preserve current work and Workers, acknowledge the new relationship, and report the current phase, active Worker tasks, blockers, and next action. Under a run-owned lane, the run-owning session receives that instruction and applies it to the next Captain continuation call.

**Complete when:** the Captain's principal has enough current information to make required decisions without duplicating the work contract.

## Integrate and return

Verify direct work and integrate Worker results against the repository and contract completion criteria. Record results and remaining work in the work record when one exists. Return the result, relevant verification, unresolved work, and resource disposition. Follow **Retire an owner** in `SKILL.md` for every delegated assignment.

**Complete when:** the integrated front satisfies its contract or the remaining blocker is explicit, every Worker has a settled result or an explicit continuing owner, and the principal has the work, coordination, and cleanup pointers.
