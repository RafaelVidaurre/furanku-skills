// What is waiting on someone, in one list: reviews with undecided parts, open notes, parts whose
// content changed since their verdict, and problems. Built from the projection alone, so it costs
// no more than any other read.
import { shortRef } from "../../kernel/Ids.ts"
import type { Problem, Target } from "../model/types.ts"
import type { Projection } from "../Projection.ts"
import { targetRoute } from "../routes.ts"
import { noteView } from "./notes.ts"
import { reviewOf } from "./review.ts"
import { submissionView } from "./reviews.ts"

export interface CatalogProblem {
  /** Where it comes from: the project's configuration and plugins, its sources, or the records. */
  readonly origin: "project" | "sources" | "records"
  /** What it is about: a path or a unit id. */
  readonly subject: string
  readonly error: string
  readonly recovery: string | null
}

/** Everything that could not be used: plugin and configuration failures, source problems, bad records. */
export const problemsOf = (p: Projection): Array<CatalogProblem> => [
  ...p.plugins.problems.map((problem: Problem) => ({ origin: "project" as const, ...problem })),
  ...p.snapshot.problems.map((problem) => ({ origin: "sources" as const, ...problem })),
  ...p.records.problems.map((problem) => ({ origin: "records" as const, subject: problem.file, error: problem.error, recovery: problem.recovery ?? null })),
  ...p.recordProblems.map((problem) => ({ origin: "records" as const, ...problem }))
]

const first = <A>(list: ReadonlyArray<A>, limit: number): ReadonlyArray<A> => list.slice(0, limit)

export const inbox = (p: Projection, limit: number) => {
  const waiting = p.records.submission
    .map((submission) => submissionView(p, submission))
    .filter((submission) => submission.counts.waiting > 0)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((submission) => ({ submission: submission.id, ref: submission.ref, title: submission.title, by: submission.by, at: submission.at, waiting: submission.counts.waiting, items: submission.counts.items, route: submission.route }))
  const notes = p.records.note
    .filter((note) => !note.resolved)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((note) => {
      const view = noteView(p, note)
      return { id: note.id, target: note.target, targetName: view.targetName, targetExists: view.targetExists, partLabel: view.partLabel, body: note.body, by: note.by, at: note.at, ...(view.route === null ? {} : { route: view.route }) }
    })
  // Only targets that ever received a verdict can have changed since one.
  const decided = new Map<string, Target>()
  for (const decision of p.decisions) {
    const target = p.items.get(decision.item)!.item.target
    if (target === null) continue
    decided.set(`${target.kind}:${target.id}`, target)
  }
  const changed = [...decided.values()].flatMap((target) => {
    const parts = reviewOf(p, target).parts.filter((part) => part.changed)
    if (parts.length === 0) return []
    const name = target.kind === "unit" ? p.snapshot.unitsById.get(target.id)?.name : p.collectionsById.get(target.id)?.name
    const route = targetRoute(p, target)
    return [{
      target,
      ...(route === null ? {} : { route }),
      name: name ?? target.id,
      parts: parts.map((part) => ({ id: part.id, label: part.label, verdict: part.verdict, submission: part.decision?.submission ?? null, ref: part.decision ? shortRef(part.decision.submission) : null }))
    }]
  }).sort((a, b) => a.name.localeCompare(b.name))
  const problems = problemsOf(p)
  return {
    counts: { waiting: waiting.length, notes: notes.length, changed: changed.length, problems: problems.length },
    waiting: first(waiting, limit),
    notes: first(notes, limit),
    changed: first(changed, limit),
    problems: first(problems, limit)
  }
}
