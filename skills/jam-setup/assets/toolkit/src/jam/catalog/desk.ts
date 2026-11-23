// The review desk backed by the catalog. A step that needs a person's acceptance becomes a
// catalog submission of the subject's unit, and the person's verdict there decides the gate:
// there is one place a person approves anything. An agent's verdict in the catalog decides
// nothing here.
//
// What the unit cannot show as its own parts still reaches the reviewer as captures of the item:
// evidence outside the asset roots (a render the catalog's own viewer saved under
// .catalog/.local/captures, a file beside the run). Work the catalog does not list as a unit (a
// recipe that is not deliverable: tests, explorations) is submitted as work, with its files as
// captures. Only a step with nothing showable at all is refused.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { type ActionOutput, Catalog } from "../../catalog/Catalog.ts"
import type { Actor } from "../../catalog/plugin.ts"
import { fail } from "../../kernel/errors.ts"
import { Git } from "../../kernel/Git.ts"
import { extensionOf } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { budgetOf } from "../checks/Checks.ts"
import { type Relayed, requestIdOf, ReviewDesk, type ReviewRequest, type Verdict } from "../runs/ReviewDesk.ts"
import { reviewNote, words } from "./note.ts"
import { capturable, EVIDENCE_ROLE } from "./units.ts"

interface Linked {
  readonly id: string
  readonly route: string
  readonly url?: string | undefined
}
type Decided = ActionOutput<"review.get">
type DecidingDecision = NonNullable<Decided["items"][number]["parts"][number]["decision"]>

const VIEW_MAX = 50
const CAPTION_MAX = 300
const LABEL_MAX = 300
const TEXT = new Set(["md", "txt"])

const unique = <A>(values: Iterable<A>): Array<A> => [...new Set(values)]
const stem = (path: string): string => (path.split("/").at(-1) ?? path).replace(/\.[^.]+$/, "")
const evidenceLabel = (entry: { readonly label?: string | undefined; readonly path: string }): string => words(entry.label ?? stem(entry.path))
const caption = (text: string): string => text.slice(0, CAPTION_MAX)
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
          // A subject the catalog does not list (work that is not content) is reviewed as work.
          const detail = yield* catalog.run("unit.get", { id: run.id }).pipe(
            Effect.catch((error) => (error.code === "not_found" ? Effect.succeed(null) : Effect.fail(error)))
          )
          const pathOf = (asset: string | undefined): string | undefined => detail?.links.find((link) => link.asset.id === asset)?.asset.path
          const shown = (detail?.review.parts ?? []).filter((part) => part.reviewable && part.asset !== undefined)
          const produced = shown.filter((part) => part.role !== EVIDENCE_ROLE && record.files.some((file) => file.role === part.role && file.path === pathOf(part.asset)))
          const evidence = shown.flatMap((part) => {
            const entry = part.role === EVIDENCE_ROLE ? record.evidence.find((file) => file.path === pathOf(part.asset)) : undefined
            return entry === undefined ? [] : [{ part, label: evidenceLabel(entry) }]
          })
          // Whatever the unit does not show is shown as a capture of the item, never left out.
          // Evidence the unit links is its part (or reference material the project leaves out of reviews).
          const linked = new Set((detail?.links ?? []).map((link) => link.asset.path))
          const capture = (label: string, shownAs: string, file: string, shows?: string) => ({ label: label.slice(0, LABEL_MAX), caption: caption(shownAs), file, ...(shows === undefined ? {} : { shows }) })
          // Work's own files are what is decided, each shown by its capture; evidence beside them
          // shows the work and is never decided itself.
          const made = detail === null
            ? record.files.filter((file) => capturable(file.path)).map((file, index) => capture(`${words(file.role)} · ${stem(file.path)}`, `${step.title}: ${words(file.role)} · ${stem(file.path)}`, file.path, `file-${index + 1}`))
            : []
          const supporting = record.evidence.filter((entry) => capturable(entry.path) && !linked.has(entry.path)).map((entry) => capture(evidenceLabel(entry), `Evidence: ${evidenceLabel(entry)}`, entry.path))
          const captures = [...made, ...supporting].slice(0, VIEW_MAX)
          if (produced.length + evidence.length + captures.length === 0) {
            return yield* fail("unsupported", `nothing of step ${step.id} can be shown in the catalog: ${detail === null ? "it records" : `${run.id} links`} no images, video, audio or GLB models`, {
              fix: `attach such evidence when recording (--evidence <path>), or ${relay}`
            })
          }
          const views = [
            ...produced.map((part) => ({ part: part.id, caption: caption(`${step.title}: ${part.label}`) })),
            ...evidence.map(({ label, part }) => ({ part: part.id, caption: caption(`Evidence: ${label}`) })),
            ...captures.map((capture, index) => ({ part: `capture:${index + 1}`, caption: capture.caption }))
          ].slice(0, VIEW_MAX)
          const brief = TEXT.has(extensionOf(run.brief.path)) ? yield* files.readText(run.brief.path).pipe(Effect.catch(() => Effect.succeed(null))) : null
          const budget = budgetOf(context)
          const title = `${run.id} · ${step.title}`
          const decided = [...produced.map((part) => part.label), ...made.map((file) => file.label)]
          const labels = [...evidence.map((entry) => entry.label), ...supporting.map((entry) => entry.label)]
          // Work with no files of its own is decided as a whole; a unit decides its linked evidence.
          const asked = decided.length > 0 ? decided : detail === null ? [title] : evidence.map((entry) => entry.label)
          const { ask, brief: note } = reviewNote({
            run,
            recipeTitle: context.recipe.title,
            step,
            record,
            budget: budget.name === null || budget.budget === null ? null : { name: budget.name, budget: budget.budget },
            brief,
            parts: asked,
            evidence: labels.filter((label) => !asked.includes(label))
          })
          const decide = made.map((file) => ({ id: file.shows!, label: file.label }))
          const item = detail === null
            ? { title, ...(decide.length > 0 ? { decide } : {}), captures, views }
            : { target: { kind: "unit" as const, id: run.id }, parts: [...produced, ...evidence.map((entry) => entry.part)].map((part) => part.id), ...(captures.length > 0 ? { captures } : {}), views }
          const result = yield* catalog.run(
            "review.submit",
            { title, ask, brief: note, items: [item] },
            // The record's id is the request: submitting it again returns the first submission.
            { actor, requestId: requestIdOf(record) }
          )
          // Who the review waits for is what the recipe says (a person or a role); nothing is guessed.
          return request(result.submission, result.hint, step.reviewer ?? null)
        })

      const outcome = (review: Decided): Verdict | null => {
        const parts = review.items.flatMap((item) => item.parts).filter((part) => part.reviewable)
        // Only a person's verdict counts, for approval and for sending work back alike: given in the
        // catalog, or relayed by an agent with the person's own words (and recorded as a relay).
        const personOf = (decision: DecidingDecision): string | null =>
          decision.by.kind === "human" ? decision.by.name : decision.relay?.by ?? null
        const human = parts.flatMap((part) => (part.decision !== null && personOf(part.decision) !== null && part.verdict !== null ? [{ ...part, verdict: part.verdict, decision: part.decision }] : []))
        const relayOf = (decisions: ReadonlyArray<(typeof human)[number]["decision"]>): { relay?: Relayed } => {
          const relays = decisions.flatMap((decision) => (decision.relay === undefined ? [] : [decision.relay]))
          return relays.length === 0 ? {} : { relay: { channel: unique(relays.map((r) => r.channel)).join("; "), words: unique(relays.map((r) => r.words)).join(" ") } }
        }
        const back = human.filter((part) => part.verdict === "changes" || part.verdict === "rejected")
        if (back.length > 0) {
          const decisions = unique(back.map((part) => part.decision.id)).map((id) => back.find((part) => part.decision.id === id)!.decision)
          // Open notes on the items travel back too: a note on a view names the view it is about.
          const items = new Set(review.items.map((item) => item.id))
          const noted = review.observations.filter((note) => !note.resolved && note.target.item != null && items.has(note.target.item))
          const said = [
            ...unique(decisions.map((decision) => decision.comment.trim()).filter((comment) => comment !== "")),
            ...back.flatMap((part) => {
              const comment = part.decision.partComments[part.id]?.trim() ?? ""
              return comment === "" ? [] : [`${part.label}: ${comment}`]
            }),
            ...noted.map((note) => `${note.viewLabel ?? note.partLabel ?? "Note"}: ${note.body.trim()}`)
          ]
          return {
            state: "returned",
            by: names(unique(decisions.map((decision) => personOf(decision)!))),
            ...relayOf(decisions),
            reason: said.length > 0 ? said.join(" ") : `${back.some((part) => part.verdict === "rejected") ? "rejected" : "changes requested"}: ${back.map((part) => part.label).join(", ")}`,
            rejected: back.every((part) => part.verdict === "rejected")
          }
        }
        if (parts.length === 0 || human.length < parts.length || human.some((part) => part.verdict !== "approved")) return null
        const comments = unique(human.map((part) => part.decision.comment.trim()).filter((comment) => comment !== ""))
        return {
          state: "accepted",
          by: names(unique(human.map((part) => personOf(part.decision)!))),
          ...relayOf(human.map((part) => part.decision)),
          ...(comments.length > 0 ? { comment: comments.join(" ") } : {})
        }
      }

      const verdict: ReviewDesk["Service"]["verdict"] = (submission) =>
        Effect.gen(function*() {
          // The list answers "has anyone decided anything" without reading frozen evidence.
          const list = yield* catalog.run("review.list", { q: submission.slice(-6), pageSize: 200 })
          const found = list.submissions.find((candidate) => candidate.id === submission)
          if (found === undefined) return yield* fail("not_found", `review ${submission} is not in this checkout's catalog`)
          const touched = found.items.some((item) => item.summary.approved + item.summary.changes + item.summary.rejected > 0)
          const decided = touched ? outcome(yield* catalog.run("review.get", { submission })) : null
          return decided ?? { state: "pending", request: request(found, list.hint, null) }
        })

      return { submit, verdict }
    })
  )
