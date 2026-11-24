// A submission after it is made: its submitter (or a person) corrects its words and framing
// until someone decides, or withdraws it; and an item whose parts are options is decided by
// picking one of them, or none.
import assert from "node:assert/strict"
import { test } from "node:test"
import { agent, cleanup, human, open, read, rejects, standardProject, W, write } from "./helpers.ts"
import { png } from "./helpers.ts"

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const unit = (id: string) => ({ kind: "unit", id })
const other = { name: "someone-else", kind: "agent" } as const

test("its submitter corrects a submission's words and framing until someone decides; frozen evidence never changes", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const byAgent = W(app, agent)
  const { submission } = await byAgent("review.submit", { title: "Helm pas", ask: "Ready?", brief: "Old brief", items: [{ target: unit("armor/helm"), text: "typo here" }, { target: unit("armor/boots") }] })
  const [helm, boots] = submission.items
  const views = (await app.run("review.get", { submission: submission.id })).items[0].views
  const fixed = await byAgent("review.update", {
    submission: submission.id,
    title: "Helm pass",
    ask: "Is the helm ready to rig?",
    limits: "No LODs yet.",
    brief: "",
    items: [{ id: helm.id, text: "Visor narrowed.", views: [{ id: views[0].id, caption: "Front, close", camera: { position: [0, 1, 3], target: [0, 1, 0] } }] }]
  })
  assert.deepEqual([fixed.submission.title, fixed.submission.ask, fixed.submission.brief, fixed.submission.limits], ["Helm pass", "Is the helm ready to rig?", null, "No LODs yet."])
  const record = read(dir, `.catalog/reviews/${submission.id}/submission.json`)
  assert.deepEqual([record.revision, record.editedBy.name, record.items[0].text, record.items[0].views[0].caption, record.items[0].views[0].camera.position], [2, "checker", "Visor narrowed.", "Front, close", [0, 1, 3]])
  assert.deepEqual(record.items[0].parts.map((part: Any) => part.evidence.digest), (await app.run("review.get", { submission: submission.id })).items[0].parts.map((part: Any) => part.evidence.digest))
  // Only its submitter or a person.
  await rejects(W(app, other)("review.update", { submission: submission.id, title: "Mine now" }), "forbidden")
  await W(app, human)("review.update", { submission: submission.id, items: [{ id: boots.id, title: "Iron boots" }] })
  // Once an item is decided, what was shown for it is fixed; so are the words for every item.
  await W(app, human)("review.decide", { submission: submission.id, item: helm.id, whole: "approved" })
  await rejects(byAgent("review.update", { submission: submission.id, items: [{ id: helm.id, text: "Changed after the verdict" }] }), "conflict")
  await rejects(byAgent("review.update", { submission: submission.id, brief: "New brief" }), "conflict")
  await byAgent("review.update", { submission: submission.id, items: [{ id: boots.id, text: "Still undecided" }] })
  await rejects(byAgent("review.update", { submission: submission.id, ask: "Two\nlines" }), "invalid")
  await rejects(byAgent("review.update", { submission: submission.id, items: [{ id: boots.id, views: [{ id: "vw_missing", caption: "x" }] }] }), "not_found")
  cleanup(dir)
})

test("a withdrawn submission leaves every queue, stays readable with its decisions, and takes no more edits", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const byAgent = W(app, agent)
  const { submission } = await byAgent("review.submit", { items: [{ target: unit("armor/helm") }, { target: unit("armor/boots") }] })
  await W(app, human)("review.decide", { submission: submission.id, item: submission.items[0].id, whole: "changes", comment: "Visor too wide" })
  await rejects(W(app, other)("review.withdraw", { submission: submission.id, reason: "x" }), "forbidden")
  const out = await byAgent("review.withdraw", { submission: submission.id, reason: "Submitted the wrong boots" })
  assert.deepEqual([out.submission.withdrawn.reason, out.submission.counts.waiting], ["Submitted the wrong boots", 0])
  assert.equal((await app.run("review.list", { state: "waiting" })).total, 0)
  assert.equal((await app.run("inbox", {})).waiting.length, 0)
  assert.deepEqual((await app.run("unit.get", { id: "armor/boots" })).waiting, [])
  const kept = await app.run("review.get", { submission: submission.id })
  assert.deepEqual([kept.withdrawn.by.name, kept.decisions.length], ["checker", 1])
  await rejects(byAgent("review.update", { submission: submission.id, title: "x" }), "conflict")
  await rejects(byAgent("review.withdraw", { submission: submission.id, reason: "again" }), "conflict")
  cleanup(dir)
})

test("an item of options is decided by a pick: one option as it is or with changes, or none of them with what would work", async () => {
  const dir = await standardProject()
  write(dir, "captures/a.png", png(4, 4, [200, 40, 40, 255]))
  write(dir, "captures/b.png", png(4, 4, [40, 40, 200, 255]))
  const app = await open(dir)
  const run = W(app)
  await rejects(run("review.submit", { items: [{ title: "One", choose: "one", decide: [{ id: "a", label: "A" }], captures: [{ label: "A", file: "captures/a.png" }] }] }), "invalid")
  const { submission } = await run("review.submit", {
    items: [{
      title: "Tidestone sentinel",
      choose: "one",
      decide: [{ id: "a", label: "A: Drowned warden" }, { id: "b", label: "B: Abyssal idol" }],
      captures: [{ label: "A", file: "captures/a.png", shows: "a" }, { label: "B", file: "captures/b.png", shows: "b" }]
    }]
  })
  const item = submission.items[0]
  assert.equal(item.choose, "one")
  assert.equal(item.summary.total, 1, "the item reads as one decision")
  const decide = (input: Record<string, unknown>) => run("review.decide", { submission: submission.id, item: item.id, ...input })
  await rejects(decide({ whole: "approved" }), "invalid")
  await rejects(decide({ pick: "item:c" }), "invalid")
  await rejects(decide({ pick: "none" }), "invalid")
  await rejects(decide({ pick: "item:b", pickVerdict: "changes" }), "invalid")
  const picked = await decide({ pick: "item:b" })
  assert.deepEqual([picked.decision.pick, picked.decision.verdicts, picked.item.state], [{ option: "item:b" }, { "item:a": "rejected", "item:b": "approved" }, "approved"])
  const changed = await decide({ pick: "item:a", pickVerdict: "changes", comment: "Less cute" })
  assert.equal(changed.item.state, "changes")
  const none = await decide({ pick: "none", comment: "Neither: something older and broken" })
  assert.deepEqual([none.decision.pick, none.item.state], [{ option: null }, "rejected"])
  // Editing a pick keeps it a pick.
  const edited = await run("review.decision.edit", { id: none.decision.id, pick: "item:a", expectedRevision: none.decision.revision })
  assert.deepEqual([edited.decision.pick, edited.item.state], [{ option: "item:a" }, "approved"])
  // An item of parts takes no pick.
  const plain = (await run("review.submit", { items: [{ target: unit("armor/helm") }] })).submission
  await rejects(run("review.decide", { submission: plain.id, item: plain.items[0].id, pick: "icon" }), "invalid")
  assert.equal((await app.run("problems", {})).problems.length, 0)
  cleanup(dir)
})
