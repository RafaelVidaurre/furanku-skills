// The review desk backed by the catalog. A step that needs a person's acceptance becomes a
// catalog submission of the subject's unit, and the person's verdict there decides the gate:
// there is one place a person approves anything. An agent's verdict in the catalog decides
// nothing here.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Catalog } from "../../catalog/Catalog.ts"
import type { Actor } from "../../catalog/plugin.ts"
import { fail, toolError } from "../../kernel/errors.ts"
import { Git } from "../../kernel/Git.ts"
import { extensionOf } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { budgetOf } from "../checks/Checks.ts"
import { type Relayed, requestIdOf, ReviewDesk, type ReviewRequest, type Verdict } from "../runs/ReviewDesk.ts"
import { reviewNote, words } from "./note.ts"
import { EVIDENCE_ROLE } from "./units.ts"

// The parts of catalog results this module reads.
interface UnitDetail {
  readonly links: ReadonlyArray<{ readonly asset: { readonly id: string; readonly path: string } }>
  readonly review: { readonly parts: ReadonlyArray<{ readonly id: string; readonly label: string; readonly role?: string; readonly asset?: string; readonly reviewable: boolean }> }
}
interface Linked {
  readonly id: string
  readonly route: string
  readonly url?: string
}
interface Submitted {
  readonly submission: Linked
  readonly hint?: string
}
interface Listed {
  readonly items: ReadonlyArray<Linked & { readonly items: ReadonlyArray<{ readonly summary: { readonly approved: number; readonly changes: number; readonly rejected: number } }> }>
  readonly hint?: string
}
interface Decided {
  readonly items: ReadonlyArray<{
    readonly parts: ReadonlyArray<{
      readonly id: string
      readonly label: string
      readonly reviewable: boolean
      readonly verdict: string | null
      readonly event: {
        readonly id: string
        readonly by: Actor
        readonly comment: string
        readonly partNotes: Readonly<Record<string, string>>
        readonly relay?: { readonly by: string; readonly channel: string; readonly words: string }
      } | null
    }>
  }>
}

const VIEW_MAX = 50
const CAPTION_MAX = 300
const TEXT = new Set(["md", "txt"])

const unique = <A>(values: Iterable<A>): Array<A> => [...new Set(values)]
const names = (people: ReadonlyArray<string>): string => (people.length <= 1 ? people[0] ?? "" : `${people.slice(0, -1).join(", ")} and ${people.at(-1)}`)

const request = (submission: Linked, hint: string | undefined, reviewer: string | null): ReviewRequest => ({
  submission: submission.id,
  route: submission.route,
  ...(submission.url === undefined ? (hint === undefined ? {} : { hint }) : { url: submission.url }),
  ...(reviewer === null ? {} : { reviewer })
})

/** The desk for one project. `agent` is the name submissions are made under. */
export const catalogDesk = (agent: string): Layer.Layer<ReviewDesk, never, Catalog | Git | ProjectFiles> =>
  Layer.effect(
    ReviewDesk,
    Effect.gen(function*() {
      const catalog = yield* Catalog
      const files = yield* ProjectFiles
      const actor: Actor = { name: agent, kind: "agent" }

      const submit: ReviewDesk["Service"]["submit"] = (context, step, record) =>
        Effect.gen(function*() {
          const { run } = context.ref
          const relay = `record the person's answer instead: jam run review ${run.id} ${step.id} --accept --relay "<where they answered>: <their words>"`
          const detail = (yield* catalog.run("unit.get", { id: run.id }).pipe(
            Effect.mapError((error) =>
              error.code !== "not_found" ? error : toolError("unavailable", `${run.id} is not listed in the catalog, so ${step.id} cannot be reviewed there`, {
                fix: context.recipe.deliverable
                  ? `list "jam" under "plugins" in catalog.config.json (the jam-setup installer does), or ${relay}`
                  : `recipe ${context.recipe.id} is not deliverable, and only deliverable work is catalog content; ${relay}`
              }))
          )) as UnitDetail
          const pathOf = (asset: string | undefined): string | undefined => detail.links.find((link) => link.asset.id === asset)?.asset.path
          const shown = detail.review.parts.filter((part) => part.reviewable && part.asset !== undefined)
          const produced = shown.filter((part) => part.role !== EVIDENCE_ROLE && record.files.some((file) => file.role === part.role && file.path === pathOf(part.asset)))
          const evidence = shown.flatMap((part) => {
            const entry = part.role === EVIDENCE_ROLE ? record.evidence.find((file) => file.path === pathOf(part.asset)) : undefined
            return entry === undefined ? [] : [{ part, label: words(entry.label ?? (entry.path.split("/").at(-1) ?? entry.path).replace(/\.[^.]+$/, "")) }]
          })
          if (produced.length + evidence.length === 0) {
            return yield* fail("unsupported", `nothing of step ${step.id} can be shown in the catalog: ${run.id} links none of the files this record names`, {
              fix: `the catalog shows images, video, audio and GLB models of a subject's newest run; attach such evidence when recording (--evidence <path>), or ${relay}`
            })
          }
          const views = [
            ...produced.map((part) => ({ part: part.id, caption: `${step.title}: ${part.label}` })),
            ...evidence.map(({ label, part }) => ({ part: part.id, caption: `Evidence: ${label}` }))
          ].slice(0, VIEW_MAX).map((view) => ({ ...view, caption: view.caption.slice(0, CAPTION_MAX) }))
          const brief = TEXT.has(extensionOf(run.brief.path)) ? yield* files.readText(run.brief.path).pipe(Effect.catch(() => Effect.succeed(null))) : null
          const budget = budgetOf(context)
          const labels = evidence.map((entry) => entry.label)
          const note = reviewNote({
            run,
            recipeTitle: context.recipe.title,
            step,
            record,
            budget: budget.name === null || budget.budget === null ? null : { name: budget.name, budget: budget.budget },
            brief,
            parts: produced.length > 0 ? produced.map((part) => part.label) : labels,
            evidence: produced.length > 0 ? labels : []
          })
          const result = (yield* catalog.run(
            "review.submit",
            { title: `${run.id} · ${step.title}`, note, items: [{ target: { kind: "unit", id: run.id }, parts: [...produced, ...evidence.map((entry) => entry.part)].map((part) => part.id), views }] },
            // The record's id is the request: submitting it again returns the first submission.
            { actor, requestId: requestIdOf(record) }
          )) as Submitted
          // Who the review waits for is what the recipe says (a person or a role); nothing is guessed.
          return request(result.submission, result.hint, step.reviewer ?? null)
        })

      const decision = (review: Decided): Verdict | null => {
        const parts = review.items.flatMap((item) => item.parts).filter((part) => part.reviewable)
        // Only a person's verdict counts, for approval and for sending work back alike: given in the
        // catalog, or relayed by an agent with the person's own words (and recorded as a relay).
        const personOf = (event: NonNullable<Decided["items"][number]["parts"][number]["event"]>): string | null =>
          event.by.kind === "human" ? event.by.name : event.relay?.by ?? null
        const human = parts.flatMap((part) => (part.event !== null && personOf(part.event) !== null && part.verdict !== null ? [{ ...part, verdict: part.verdict, event: part.event }] : []))
        const relayOf = (events: ReadonlyArray<(typeof human)[number]["event"]>): { relay?: Relayed } => {
          const relays = events.flatMap((event) => (event.relay === undefined ? [] : [event.relay]))
          return relays.length === 0 ? {} : { relay: { channel: unique(relays.map((r) => r.channel)).join("; "), words: unique(relays.map((r) => r.words)).join(" ") } }
        }
        const back = human.filter((part) => part.verdict === "changes" || part.verdict === "rejected")
        if (back.length > 0) {
          const events = unique(back.map((part) => part.event.id)).map((id) => back.find((part) => part.event.id === id)!.event)
          const said = [
            ...unique(events.map((event) => event.comment.trim()).filter((comment) => comment !== "")),
            ...back.flatMap((part) => {
              const note = part.event.partNotes[part.id]?.trim() ?? ""
              return note === "" ? [] : [`${part.label}: ${note}`]
            })
          ]
          return {
            state: "returned",
            by: names(unique(events.map((event) => personOf(event)!))),
            ...relayOf(events),
            reason: said.length > 0 ? said.join(" ") : `${back.some((part) => part.verdict === "rejected") ? "rejected" : "changes requested"}: ${back.map((part) => part.label).join(", ")}`,
            rejected: back.every((part) => part.verdict === "rejected")
          }
        }
        if (parts.length === 0 || human.length < parts.length || human.some((part) => part.verdict !== "approved")) return null
        const comments = unique(human.map((part) => part.event.comment.trim()).filter((comment) => comment !== ""))
        return {
          state: "accepted",
          by: names(unique(human.map((part) => personOf(part.event)!))),
          ...relayOf(human.map((part) => part.event)),
          ...(comments.length > 0 ? { comment: comments.join(" ") } : {})
        }
      }

      const verdict: ReviewDesk["Service"]["verdict"] = (submission) =>
        Effect.gen(function*() {
          // The list answers "has anyone decided anything" without reading frozen evidence.
          const list = (yield* catalog.run("reviews.list", { q: submission.slice(-6), pageSize: 200 })) as Listed
          const found = list.items.find((candidate) => candidate.id === submission)
          if (found === undefined) return yield* fail("not_found", `review ${submission} is not in this checkout's catalog`)
          const touched = found.items.some((item) => item.summary.approved + item.summary.changes + item.summary.rejected > 0)
          const decided = touched ? decision((yield* catalog.run("review.get", { submission })) as Decided) : null
          return decided ?? { state: "pending", request: request(found, list.hint, null) }
        })

      return { submit, verdict }
    })
  )
