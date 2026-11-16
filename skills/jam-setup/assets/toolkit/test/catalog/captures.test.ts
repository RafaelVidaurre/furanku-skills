// Captures and work items. A capture is evidence rendered outside the catalog (a game engine's
// screenshot, a clip, a model at a commit): a file of the checkout, a before/after pair, or a file
// at a commit. Each is its own part of its item and never content. An item without a target is
// work that is not catalog content; it holds captures, text, or both.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { unlinkSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { cleanup, git, glb, human, open, png, read, rejects, standardProject, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const project = async () => {
  const dir = await standardProject()
  write(dir, "captures/before.png", png(6, 4, [10, 10, 10, 255]))
  write(dir, "captures/after.png", png(6, 4, [250, 250, 250, 255]))
  write(dir, "captures/clip.png", png(2, 2, [1, 2, 3, 255]))
  write(dir, "captures/notes.txt", "not media")
  write(dir, "art/prop.glb", await glb({ size: 1 }))
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "prop v1")
  const v1 = git(dir, "rev-parse", "HEAD").trim()
  write(dir, "art/prop.glb", await glb({ size: 3 }))
  git(dir, "commit", "-q", "-am", "prop v2")
  const v2 = git(dir, "rev-parse", "HEAD").trim()
  return { dir, v1, v2 }
}

test("a unit item carries a pair, a file and a committed model as captures of their own; the unit's content is unaffected", async () => {
  const { dir, v1 } = await project()
  // Uncommitted work is frozen into the catalog's store; committed files are referenced as Git blobs.
  write(dir, "captures/fresh.png", png(3, 3, [5, 6, 7, 255]))
  const app = await open(dir)
  const run = W(app)
  const { submission } = await run("review.submit", {
    items: [{
      target: { kind: "unit", id: "armor/helm" },
      parts: ["icon"],
      text: "The helm in game, after the visor fix.",
      captures: [
        { label: "Helm in game", renderer: "Unreal", before: "captures/before.png", after: "captures/after.png", labels: ["Today", "Fixed"] },
        { label: "Close-up", caption: "Native pixels", file: "captures/fresh.png", renderer: "Unreal" },
        { label: "Source model", before: { revision: v1, path: "art/prop.glb" }, after: { revision: "HEAD", path: "art/prop.glb" } }
      ]
    }]
  })
  const item = (await app.run("review.get", { submission: submission.id })).items[0]
  assert.equal(item.text, "The helm in game, after the visor fix.")
  assert.deepEqual(item.parts.map((part: Any) => part.id), ["capture:1", "capture:2", "capture:3", "icon"])
  assert.deepEqual([item.parts[0].pairLabels, item.parts[0].renderer, item.parts[1].renderer, item.parts[2].renderer ?? null], [["Today", "Fixed"], "Unreal", "Unreal", null])
  assert.deepEqual(item.parts[0].leaves.map((leaf: Any) => [leaf.key, leaf.label, leaf.status, leaf.storage, leaf.renderer]), [
    ["before", "Helm in game · Today", "ok", "git", "Unreal"],
    ["after", "Helm in game · Fixed", "ok", "git", "Unreal"]
  ])
  assert.deepEqual(item.parts[1].leaves.map((leaf: Any) => [leaf.key, leaf.kind, leaf.storage]), [["", "image", "catalog"]])
  // A file at a commit is referenced as that commit's blob, whatever revision named it.
  assert.deepEqual(item.parts[2].leaves.map((leaf: Any) => [leaf.key, leaf.kind, leaf.storage]), [["before", "model", "git"], ["after", "model", "git"]])
  const record = read(dir, `.catalog/reviews/${submission.id}/submission.json`).items[0]
  assert.equal(record.parts[2].evidence.pair.before.ref.git.commit, v1)
  assert.equal(record.parts[2].evidence.pair.after.ref.git.commit, git(dir, "rev-parse", "HEAD").trim())
  assert.deepEqual(item.views.map((view: Any) => [view.part, view.caption]), [["capture:1", "Helm in game"], ["capture:2", "Native pixels"], ["capture:3", "Source model"], ["icon", "Iron Helm · Icon"]])
  const after = await app.evidenceMedia(submission.id, item.id, "capture:1", "after")
  assert.equal(after.mime, "image/png")

  await run("review.decide", { submission: submission.id, item: item.id, whole: "approved", exceptions: { "capture:2": "changes" } })
  const helm = await app.run("unit.get", { id: "armor/helm" })
  assert.equal(helm.review.parts.find((part: Any) => part.id === "icon").verdict, "approved")
  assert.ok(!helm.review.parts.some((part: Any) => part.id.startsWith("capture:")), "captures are item evidence, not content parts")
  assert.deepEqual(helm.history[0].changedParts, [], "a capture never reads as content that changed")
  assert.equal((await app.run("inbox", {})).counts.changed, 0)
  await rejects(app.run("evidence.compare", { a: { submission: submission.id, item: item.id, part: "capture:1" } }), "invalid")
  // Two frozen captures compare like any frozen evidence.
  const compared = await app.run("evidence.compare", { a: { submission: submission.id, item: item.id, part: "capture:1" }, b: { submission: submission.id, item: item.id, part: "capture:1" } })
  assert.deepEqual(compared.rows.map((row: Any) => [row.key, row.identical]), [["before", true], ["after", true]])
  // Only content parts: the item is submitted for its captures.
  const only = await run("review.submit", { items: [{ target: { kind: "unit", id: "armor/boots" }, parts: [], captures: [{ label: "Boots in game", file: "captures/clip.png" }] }] })
  assert.deepEqual(only.submission.items[0].summary.total, 1)
  await rejects(run("review.submit", { items: [{ target: { kind: "unit", id: "armor/boots" }, parts: [] }] }), "invalid")
  cleanup(dir)
})

test("work items hold captures or a decision text; every input is checked before anything is written", async () => {
  const { dir, v1 } = await project()
  const app = await open(dir)
  const run = W(app)
  const refused: ReadonlyArray<readonly [Any, string]> = [
    [{ title: "x", captures: [{ label: "a", file: "../outside.png" }] }, "invalid"],
    [{ title: "x", captures: [{ label: "a", file: "captures/notes.txt" }] }, "invalid"],
    [{ title: "x", captures: [{ label: "a", file: ".git/HEAD" }] }, "forbidden"],
    [{ title: "x", captures: [{ label: "a", before: "captures/before.png", after: "captures/before.png" }] }, "invalid"],
    [{ title: "x", captures: [{ label: "a", before: "captures/before.png", after: { revision: v1, path: "art/prop.glb" } }] }, "invalid"],
    [{ title: "x", captures: [{ label: "a", before: "captures/before.png" }] }, "invalid"],
    [{ title: "x", captures: [{ label: "a", file: { revision: v1, path: "art/missing.glb" } }] }, "not_found"],
    [{ title: "x", captures: [{ label: "a", file: { revision: "--output=x", path: "art/prop.glb" } }] }, "invalid"],
    [{ title: "x", captures: [{ label: "a", file: { revision: "0".repeat(40), path: "art/prop.glb" } }] }, "not_found"],
    [{ title: "x", captures: [{ label: "a", file: "captures/clip.png", colour: "red" }] }, "invalid"],
    [{ title: "x", captures: [{ label: "", file: "captures/clip.png" }] }, "invalid"],
    [{ captures: [{ label: "a", file: "captures/clip.png" }] }, "invalid"],
    [{ title: "x" }, "invalid"],
    [{ title: "x", text: "y", parts: ["icon"] }, "invalid"]
  ]
  for (const [item, code] of refused) await rejects(run("review.submit", { items: [{ title: "ok", text: "fine" }, item] }), code)
  assert.equal((await app.run("reviews.list", {})).total, 0, "a refused submission writes nothing")

  // What the catalog's own viewer captured is a capture too; it lives under .catalog/.local.
  write(dir, ".catalog/.local/captures/shot.png", png(5, 5, [9, 99, 9, 255]))
  const { submission } = await run("review.submit", {
    title: "Night pass",
    items: [
      { title: "Torches flicker less?", text: "Halve the pulse." },
      { title: "Torchlight", text: "Warm floors return.", captures: [{ label: "Whole frame", renderer: "Unreal", before: "captures/before.png", after: ".catalog/.local/captures/shot.png" }] }
    ]
  })
  const review = await app.run("review.get", { submission: submission.id })
  assert.deepEqual(review.items.map((item: Any) => [item.target, item.targetExists, item.text, item.parts.map((part: Any) => part.id)]), [
    [null, null, "Halve the pulse.", ["decision"]],
    [null, null, "Warm floors return.", ["capture:1"]]
  ])
  assert.deepEqual(review.items[0].views, [], "a decision has nothing to show but its text")
  await run("review.decide", { submission: submission.id, item: review.items[0].id, whole: "rejected", partNotes: { decision: "Keep the pulse" } })
  assert.equal((await app.run("reviews.list", { state: "rejected" })).total, 1)
  assert.equal((await app.run("problems", {})).problems.length, 0)
  await rejects(app.run("evidence.compare", { a: { submission: submission.id, item: review.items[0].id, part: "decision" } }), "invalid")
  // Frozen capture bytes are evidence: when they are removed, that is reported and never replaced.
  const record = read(dir, `.catalog/reviews/${submission.id}/submission.json`)
  unlinkSync(join(dir, record.items[1].parts[0].evidence.pair.after.ref.store))
  const after = (await app.run("review.get", { submission: submission.id })).items[1].parts[0].leaves[1]
  assert.equal(after.status, "missing")
  cleanup(dir)
})

// An earlier catalog wrote these records (items without a target, captures with a
// renderer, a decision part); they travel in Git and must keep reading as they were written.
test("records written by the trial catalog decode: work items, capture pairs and a decision", async () => {
  const dir = await standardProject()
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  const store = (bytes: Uint8Array, extension: string) => {
    const digest = sha(bytes)
    const path = `.catalog/evidence/${digest.slice(0, 2)}/${digest}.${extension}`
    write(dir, path, bytes)
    return { digest, path }
  }
  const leaf = (bytes: Uint8Array, asset: string, name: string) => {
    const { digest, path } = store(bytes, "png")
    return { kind: "image", digest, sha256: digest, size: bytes.length, mime: "image/png", asset, path: name, ref: { store: path }, renderer: "Unreal" }
  }
  const definition = (value: unknown) => {
    const { digest, path } = store(Buffer.from(JSON.stringify(value)), "json")
    return { sha256: digest, ref: { store: path } }
  }
  const before = png(6, 4, [10, 10, 10, 255])
  const after = png(6, 4, [250, 250, 250, 255])
  const text = { text: "Halve the pulse." }
  write(dir, ".catalog/reviews/sub_0trial0001/submission.json", {
    id: "sub_0trial0001",
    title: "Night pass",
    by: { name: "trial agent", kind: "agent" },
    at: "2026-11-10T12:00:00.000Z",
    context: { branch: "main", head: "a".repeat(40), dirty: 2 },
    supersedes: null,
    note: null,
    items: [
      {
        id: "it_0trial0001",
        target: null,
        title: "Torchlight",
        text: "Warm floors return.",
        kind: "work",
        definition: definition({ title: "Torchlight", text: "Warm floors return.", captures: [{ part: "capture:1", label: "Whole frame", renderer: "Unreal" }] }),
        parts: [{
          id: "capture:1",
          label: "Whole frame",
          renderer: "Unreal",
          evidence: { digest: createHash("sha256").update(JSON.stringify({ after: sha(after), before: sha(before) })).digest("hex"), pair: { before: leaf(before, "capture:1/before", "before.png"), after: leaf(after, "capture:1/after", "after.png") }, labels: ["Before", "After"], renderer: "Unreal" }
        }],
        views: [{ id: "vw_0trial0001", part: "capture:1", leaf: null, caption: "Whole frame", camera: null, state: null }]
      },
      {
        id: "it_0trial0002",
        target: null,
        title: "Torches flicker less?",
        text: "Halve the pulse.",
        kind: "work",
        definition: definition({ title: "Torches flicker less?", ...text, captures: [] }),
        parts: [{ id: "decision", label: "Decision", evidence: { kind: "attributes", attrs: text, digest: createHash("sha256").update(JSON.stringify(text)).digest("hex") } }],
        views: []
      },
      {
        id: "it_0trial0003",
        target: { kind: "unit", id: "armor/helm" },
        title: "Iron Helm",
        kind: "unit",
        definition: definition({ id: "armor/helm" }),
        parts: [{ id: "capture:1", label: "In game", evidence: leaf(after, "capture:1", "after.png") }],
        views: [{ id: "vw_0trial0002", part: "capture:1", leaf: null, caption: "In game", camera: null, state: null }]
      }
    ]
  })
  write(dir, ".catalog/reviews/sub_0trial0001/verdicts/vd_0trial0001.json", {
    id: "vd_0trial0001", submission: "sub_0trial0001", item: "it_0trial0002", by: human, at: "2026-11-10T13:00:00.000Z",
    scope: { kind: "whole", parts: ["decision"] }, verdict: "rejected", exceptions: {}
  })
  const app = await open(dir)
  assert.deepEqual((await app.run("problems", {})).problems, [])
  const review = await app.run("review.get", { submission: "sub_0trial0001" })
  assert.deepEqual(review.items.map((item: Any) => [item.target?.id ?? null, item.text, item.state, item.parts.map((part: Any) => `${part.id}:${part.leaves.map((l: Any) => l.status).join("/")}`)]), [
    [null, "Warm floors return.", "undecided", ["capture:1:ok/ok"]],
    [null, "Halve the pulse.", "rejected", ["decision:ok"]],
    ["armor/helm", null, "undecided", ["capture:1:ok"]]
  ])
  assert.deepEqual(review.items[0].parts[0].pairLabels, ["Before", "After"])
  assert.equal((await app.evidenceMedia("sub_0trial0001", "it_0trial0001", "capture:1", "before")).sha256, sha(before))
  // A unit item of captures only: it is waiting on the unit, and nothing of the unit changed.
  const helm = await app.run("unit.get", { id: "armor/helm" })
  assert.deepEqual([helm.waiting.length, helm.review.parts.every((part: Any) => !part.id.startsWith("capture:"))], [1, true])
  cleanup(dir)
})
