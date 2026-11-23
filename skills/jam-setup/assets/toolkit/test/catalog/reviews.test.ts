// Ported from the version 1 engine: submissions, decisions, the review projection, frozen
// evidence and before/after views.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { agent, cleanup, git, glb, hasGitLfs, human, human2, makeProject, open, png, read, rejects, standardProject, tmp, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const unit = (id: string) => ({ kind: "unit", id })
const outfit = { kind: "collection", id: "outfit/iron" }
const files = (dir: string, rel: string): Array<string> =>
  existsSync(join(dir, rel)) ? (readdirSync(join(dir, rel), { recursive: true }) as Array<string>).filter((f) => f.endsWith(".json")) : []
const parts = (r: Any) => Object.fromEntries(r.review.parts.map((p: Any) => [p.id, p.verdict]))

test("T09 several views per item; approve-with-exceptions is one decision; a later part-only verdict touches only that part", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  const sub = await run("review.submit", {
    title: "Outfit pass",
    items: [
      { target: unit("armor/helm"), views: [{ part: "model", caption: "Helm · front" }, { part: "model", caption: "Helm · side", camera: { position: [2, 1, 0], target: [0, 0, 0] } }, { part: "icon", caption: "Helm · icon" }] },
      { target: outfit }
    ]
  })
  const rv = await app.run("review.get", { submission: sub.submission.id })
  assert.equal(rv.items[0].views.length, 3)
  assert.deepEqual(rv.items[0].views.map((v: Any) => v.part), ["model", "model", "icon"])
  assert.ok(rv.items[0].views.every((v: Any) => /^vw_/.test(v.id)))
  const item = rv.items[1]
  assert.deepEqual(item.parts.map((p: Any) => p.id), ["member:armor/helm", "member:armor/boots", "preview"])
  await run("review.decide", { submission: rv.id, item: item.id, whole: "approved", exceptions: { "member:armor/boots": "changes" }, comment: "All good except boots" })
  const decisions = files(dir, `.catalog/reviews/${rv.id}/decisions`)
  assert.equal(decisions.length, 1, "compound approval is one atomic decision")
  assert.match(decisions[0]!, /^dc_[a-z0-9]+\.json$/)
  const decision = read(dir, `.catalog/reviews/${rv.id}/decisions/${decisions[0]}`)
  assert.deepEqual(decision.covers, { kind: "whole", parts: ["member:armor/helm", "member:armor/boots", "preview"] })
  assert.deepEqual(decision.exceptions, { "member:armor/boots": "changes" })
  assert.deepEqual(parts(await app.run("collection.get", { id: "outfit/iron" })), { "member:armor/helm": "approved", "member:armor/boots": "changes", preview: "approved" })
  await run("review.decide", { submission: rv.id, item: item.id, verdicts: { "member:armor/boots": "approved" } })
  assert.deepEqual(parts(await app.run("collection.get", { id: "outfit/iron" })), { "member:armor/helm": "approved", "member:armor/boots": "approved", preview: "approved" })
  // Collection-context verdicts do not cascade to the member units themselves.
  assert.equal((await app.run("unit.get", { id: "armor/boots" })).review.summary.state, "undecided")
  // Feedback-only observation on a part leaves verdicts unchanged.
  await run("note.create", { target: { kind: "submission", id: rv.id, item: item.id, part: "preview" }, body: "Lighting looks flat" })
  assert.equal((await app.run("review.get", { submission: rv.id })).items[1].summary.state, "approved")
  assert.equal((await app.run("review.get", { submission: rv.id })).observations.length, 1)
  await rejects(run("review.decide", { submission: rv.id, item: item.id, verdicts: { "member:armor/coat": "approved" } }), "invalid")
  await rejects(run("review.decide", { submission: rv.id, item: item.id, whole: "maybe" }), "invalid")
  cleanup(dir)
})

test("T10 two reviewers on different branches: merge in either order yields the same latest-wins projection; ties are deterministic; alternate resolver needs no decision changes", async () => {
  const dir = await standardProject()
  const base = await open(dir)
  const sub = await W(base)("review.submit", { items: [{ target: unit("armor/helm") }] })
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "submission")
  const rv = await base.run("review.get", { submission: sub.submission.id })
  const item = rv.items[0].id
  git(dir, "checkout", "-q", "-b", "reviewer-a")
  await W(await open(dir), human)("review.decide", { submission: rv.id, item, verdicts: { model: "approved" } })
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "a")
  git(dir, "checkout", "-q", "main")
  git(dir, "checkout", "-q", "-b", "reviewer-b")
  await new Promise((r) => setTimeout(r, 15))
  await W(await open(dir), human2)("review.decide", { submission: rv.id, item, verdicts: { model: "changes" } })
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "b")
  const projectionAfter = async (first: string, second: string) => {
    git(dir, "checkout", "-q", "-B", `m-${first}`, first)
    git(dir, "merge", "-q", "--no-edit", second)
    const app = await open(dir)
    const u = await app.run("unit.get", { id: "armor/helm" })
    return { model: u.review.parts.find((p: Any) => p.id === "model"), history: u.history.length }
  }
  const ab = await projectionAfter("reviewer-a", "reviewer-b")
  const ba = await projectionAfter("reviewer-b", "reviewer-a")
  assert.equal(ab.model.verdict, "changes")
  assert.equal(ba.model.verdict, "changes")
  assert.equal(ab.model.decision.by.name, human2.name)
  assert.equal(ab.history, 2)
  assert.equal(ba.history, 2)
  // Tie on recorded time: identity decides, reproducibly.
  const evDir = join(dir, ".catalog/reviews", rv.id, "decisions")
  const evs = readdirSync(evDir).map((f) => read(dir, `.catalog/reviews/${rv.id}/decisions/${f}`))
  for (const e of evs) writeFileSync(join(evDir, `${e.id}.json`), JSON.stringify({ ...e, at: "2026-01-01T00:00:00.000Z" }))
  const winner = evs.map((e) => e.id).sort().at(-1)
  for (let i = 0; i < 2; i++) assert.equal((await (await open(dir)).run("unit.get", { id: "armor/helm" })).review.parts.find((p: Any) => p.id === "model").decision.id, winner)
  // Alternate resolver from project configuration: most severe of each reviewer's latest.
  const before = readdirSync(evDir).map((f) => readFileSync(join(evDir, f), "utf8"))
  for (const e of evs) writeFileSync(join(evDir, `${e.id}.json`), JSON.stringify({ ...e, at: e.verdicts.model === "approved" ? "2026-02-01T00:00:00.000Z" : "2026-01-01T00:00:00.000Z" }))
  assert.equal((await (await open(dir)).run("unit.get", { id: "armor/helm" })).review.parts.find((p: Any) => p.id === "model").verdict, "approved", "latest wins by default")
  write(dir, "catalog.config.json", { version: 3, plugins: ["manifest"], review: { resolver: "strictest" } })
  assert.equal((await (await open(dir)).run("unit.get", { id: "armor/helm" })).review.parts.find((p: Any) => p.id === "model").verdict, "changes", "strictest resolver")
  assert.equal(before.length, readdirSync(evDir).length)
  cleanup(dir)
})

test("T11 content changes keep verdicts, show them as changed, create no decisions; new members inherit nothing", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  await run("collection.create", { id: "col/kit", name: "Kit", members: ["armor/helm"] })
  await run("review.decideCurrent", { target: unit("armor/helm"), whole: "approved" })
  await run("review.decideCurrent", { target: { kind: "collection", id: "col/kit" }, whole: "approved" })
  const subsBefore = files(dir, ".catalog/reviews").length
  write(dir, "art/helm.png", png(4, 4, [10, 10, 250, 255]))
  write(dir, "content/armor_helm.json", { ...read(dir, "content/armor_helm.json"), attrs: { slot: "Head", armor: 99 } })
  const u = await app.run("unit.get", { id: "armor/helm" })
  assert.equal(u.unit.attrs.armor, 99)
  const icon = u.review.parts.find((p: Any) => p.id === "icon")
  assert.equal(icon.verdict, "approved")
  assert.equal(icon.changed, true)
  assert.equal(u.review.parts.find((p: Any) => p.id === "model").changed, false)
  assert.equal(u.review.parts.find((p: Any) => p.id === "attributes").changed, true)
  assert.equal(files(dir, ".catalog/reviews").length, subsBefore, "no automatic review or invalidation")
  await run("collection.update", { id: "col/kit", add: ["armor/coat"] })
  const kit = await app.run("collection.get", { id: "col/kit" })
  assert.equal(kit.review.parts.find((p: Any) => p.id === "member:armor/coat").verdict, null, "new member undecided")
  assert.equal(kit.review.parts.find((p: Any) => p.id === "member:armor/helm").verdict, "approved")
  // Part identity: a newly linked visual role is a new, undecided part.
  write(dir, "art/clip.mp4", Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(16)]))
  write(dir, "content/armor_helm.json", { ...read(dir, "content/armor_helm.json"), links: [...read(dir, "content/armor_helm.json").links, { role: "clip", asset: "art/clip.mp4" }] })
  assert.equal((await app.run("unit.get", { id: "armor/helm" })).review.parts.find((p: Any) => p.id === "clip").verdict, null)
  cleanup(dir)
})

test("T12 comparison sides resolve independently: relinked, removed, changed and missing evidence never fall back to current", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  const s1 = await run("review.submit", { items: [{ target: unit("armor/helm") }, { target: unit("armor/boots") }, { target: unit("armor/coat") }] })
  const r1 = await app.run("review.get", { submission: s1.submission.id })
  const [helm, boots, coat] = r1.items
  // Identical complete evidence against current content.
  let c = await app.run("evidence.compare", { a: { submission: r1.id, item: helm.id, part: "model" }, b: "current" })
  assert.equal(c.identical, true)
  // Changed model bytes.
  write(dir, "art/helm.glb", await glb({ size: 3, clips: ["Idle", "Alert"] }))
  c = await app.run("evidence.compare", { a: { submission: r1.id, item: helm.id, part: "model" }, b: "current" })
  assert.equal(c.identical, false)
  assert.notEqual(c.rows[0].a.sha256, c.rows[0].b.sha256)
  assert.match(c.rows[0].a.url, /^\/media\/evidence\//)
  assert.match(c.rows[0].b.url, /^\/media\/asset\//)
  // The frozen side still yields the original bytes.
  const original = await app.evidenceMedia(r1.id, helm.id, "model", "")
  assert.equal(original.sha256, helm.parts.find((p: Any) => p.id === "model").evidence.sha256)
  // Relinked role: the current side resolves the new asset, never the frozen path.
  write(dir, "art/boots2.png", png(5, 5, [1, 1, 1, 255]))
  write(dir, "content/armor_boots.json", { ...read(dir, "content/armor_boots.json"), links: [{ role: "icon", asset: "art/boots2.png" }, { role: "model", asset: "art/boots.glb" }] })
  c = await app.run("evidence.compare", { a: { submission: r1.id, item: boots.id, part: "icon" }, b: "current" })
  assert.equal(c.rows[0].a.path, "art/boots.png")
  assert.equal(c.rows[0].b.path, "art/boots2.png")
  assert.equal(c.identical, false)
  // Removed entry: current side is missing; frozen side stays available.
  unlinkSync(join(dir, "content/armor_coat.json"))
  c = await app.run("evidence.compare", { a: { submission: r1.id, item: coat.id, part: "icon" }, b: "current" })
  assert.equal(c.rows[0].a.status, "ok")
  assert.equal(c.rows[0].b.status, "missing")
  assert.equal(c.identical, false)
  // Missing frozen bytes are never treated as equal to anything.
  const s2 = await run("review.submit", { items: [{ target: unit("armor/helm") }] })
  const r2 = await app.run("review.get", { submission: s2.submission.id })
  const ev = r2.items[0].parts.find((p: Any) => p.id === "model").leaves[0]
  assert.equal(ev.storage, "catalog", "dirty model is copied into catalog evidence")
  unlinkSync(join(dir, `.catalog/evidence/${ev.sha256.slice(0, 2)}/${ev.sha256}.glb`))
  c = await app.run("evidence.compare", { a: { submission: r2.id, item: r2.items[0].id, part: "model" }, b: "current" })
  assert.equal(c.rows[0].a.status, "missing")
  assert.equal(c.identical, false)
  const r2b = await app.run("review.get", { submission: r2.id })
  assert.equal(r2b.items[0].parts.find((p: Any) => p.id === "model").leaves[0].status, "missing")
  // Corrupted frozen bytes are explicit.
  const s3 = await run("review.submit", { items: [{ target: unit("armor/helm") }] })
  const r3 = await app.run("review.get", { submission: s3.submission.id })
  const l3 = r3.items[0].parts.find((p: Any) => p.id === "model").leaves[0]
  writeFileSync(join(dir, `.catalog/evidence/${l3.sha256.slice(0, 2)}/${l3.sha256}.glb`), "tampered")
  c = await app.run("evidence.compare", { a: { submission: r3.id, item: r3.items[0].id, part: "model" }, b: "current" })
  assert.equal(c.rows[0].a.status, "corrupt")
  // Two frozen sides with the same bytes are identical; the attributes diff is reported.
  const s4 = await run("review.submit", { items: [{ target: unit("armor/helm") }] })
  const r4 = await app.run("review.get", { submission: s4.submission.id })
  c = await app.run("evidence.compare", { a: { submission: r1.id, item: helm.id, part: "icon" }, b: { submission: r4.id, item: r4.items[0].id, part: "icon" } })
  assert.equal(c.identical, true)
  c = await app.run("evidence.compare", { a: { submission: r1.id, item: helm.id, part: "attributes" }, b: "current" })
  assert.equal(c.rows[0].a.kind, "attributes")
  assert.equal(c.identical, true)
  cleanup(dir)
})

test("T13 uncommitted work is captured as repository evidence and reopens exactly in a fresh clone; missing LFS data is a precise failure", async (t) => {
  // The Git LFS program is optional on a developer machine; the old suite assumed it.
  if (!hasGitLfs()) return t.skip("git-lfs is not installed")
  const dir = await makeProject({ assets: { "art/a.png": png(4, 4, [5, 5, 5, 255]), "art/m.glb": await glb() }, units: [{ id: "armor/a", type: "armor", name: "A", attrs: { armor: 1 }, links: [{ role: "icon", asset: "art/a.png" }, { role: "model", asset: "art/m.glb" }] }], commit: false })
  // Every git process here passes the hermetic configuration of helpers.ts through its environment.
  execFileSync("git", ["lfs", "install", "--local"], { cwd: dir, stdio: "ignore", env: { ...process.env } })
  execFileSync("git", ["lfs", "track", "*.glb"], { cwd: dir, stdio: "ignore", env: { ...process.env } })
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "initial")
  // Dirty definition and an untracked new asset.
  write(dir, "art/new.png", png(7, 7, [9, 200, 9, 255]))
  write(dir, "content/armor_a.json", { ...read(dir, "content/armor_a.json"), attrs: { armor: 2 }, links: [{ role: "icon", asset: "art/new.png" }, { role: "model", asset: "art/m.glb" }] })
  const app = await open(dir)
  const s = await W(app)("review.submit", { items: [{ target: unit("armor/a") }] })
  const rv = await app.run("review.get", { submission: s.submission.id })
  const leaf = (pid: string) => rv.items[0].parts.find((p: Any) => p.id === pid).leaves[0]
  assert.equal(leaf("icon").storage, "catalog")
  assert.equal(leaf("model").storage, "git")
  assert.equal(leaf("attributes").attrs.armor, 2)
  assert.equal(rv.checkout.dirty > 0, true)
  const iconSha = leaf("icon").sha256
  // Later source edits do not change the frozen evidence.
  write(dir, "art/new.png", png(7, 7, [255, 0, 0, 255]))
  write(dir, "content/armor_a.json", { ...read(dir, "content/armor_a.json"), attrs: { armor: 3 } })
  assert.equal((await app.evidenceMedia(rv.id, rv.items[0].id, "icon", "")).sha256, iconSha)
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "work + catalog records")
  // Fresh clone with LFS objects available locally.
  const clone = join(tmp("cc-clone-"), "c")
  execFileSync("git", ["clone", "-q", dir, clone], { env: { ...process.env } })
  const ca = await open(clone)
  const crv = await ca.run("review.get", { submission: rv.id })
  const cl = (pid: string) => crv.items[0].parts.find((p: Any) => p.id === pid).leaves[0]
  assert.equal(cl("icon").status, "ok")
  assert.equal(cl("icon").sha256, iconSha)
  assert.equal((await ca.evidenceMedia(rv.id, rv.items[0].id, "icon", "")).sha256, iconSha)
  assert.equal(cl("attributes").attrs.armor, 2)
  assert.equal(cl("model").status, "ok")
  // Clone without LFS data: the model evidence fails precisely; history stays readable.
  const bare = join(tmp("cc-nolfs-"), "c")
  execFileSync("git", ["clone", "-q", dir, bare], { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" } })
  // `rm -rf` in the old test; removed through Node so the test does not need that program.
  rmSync(join(bare, ".git/lfs"), { recursive: true, force: true })
  const na = await open(bare)
  const nrv = await na.run("review.get", { submission: rv.id })
  const model = nrv.items[0].parts.find((p: Any) => p.id === "model").leaves[0]
  assert.equal(model.status, "missing")
  assert.match(model.error, /LFS object/)
  assert.equal(nrv.items[0].parts.find((p: Any) => p.id === "icon").leaves[0].status, "ok")
  cleanup(dir, clone, bare)
})

test("Catalog Review reuses a waiting item with identical evidence, otherwise submits current content", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  const s = await run("review.submit", { items: [{ target: unit("armor/helm") }] })
  const r = await run("review.decideCurrent", { target: unit("armor/helm"), verdicts: { icon: "approved" } })
  assert.equal(r.createdSubmission, false)
  assert.equal(r.submission.id, s.submission.id)
  write(dir, "art/helm.png", png(4, 4, [0, 0, 0, 255]))
  const r2 = await run("review.decideCurrent", { target: unit("armor/helm"), verdicts: { icon: "changes" } }, "quick-1")
  assert.equal(r2.createdSubmission, true)
  const r3 = await run("review.decideCurrent", { target: unit("armor/helm"), verdicts: { icon: "changes" } }, "quick-1")
  assert.equal(r3.decision.id, r2.decision.id, "retry with the same request id records once")
  assert.equal((await app.run("review.list", { state: "all" })).total, 2)
  // Multi-role part identity: a different concept file is a different part.
  const u = await app.run("unit.get", { id: "armor/helm" })
  assert.ok(u.review.parts.some((p: Any) => p.id === "concept:art/sheet.png"))
  cleanup(dir)
})

test("Queue counts distinguish waiting, approved, changes and rejected", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  const s = await run("review.submit", { brief: "Four units for the **first pass**.", items: [{ target: unit("armor/helm") }, { target: unit("armor/boots") }, { target: unit("armor/coat") }, { target: unit("lore/origin") }] })
  const rv = await app.run("review.get", { submission: s.submission.id })
  // The brief and the checkout the submission was made from are recorded with it.
  assert.deepEqual([rv.brief, rv.checkout.branch], ["Four units for the **first pass**.", "main"])
  assert.equal(read(dir, `.catalog/reviews/${rv.id}/submission.json`).brief, "Four units for the **first pass**.")
  await rejects(run("review.submit", { note: "old name", items: [{ target: unit("armor/helm") }] }), "invalid")
  assert.deepEqual([rv.ask, rv.changes, rv.limits], [null, null, null], "a brief alone leaves the other submission fields empty")
  await run("review.decide", { submission: rv.id, item: rv.items[0].id, whole: "approved" })
  await run("review.decide", { submission: rv.id, item: rv.items[1].id, whole: "rejected" })
  await run("review.decide", { submission: rv.id, item: rv.items[2].id, whole: "changes" })
  const v = await app.run("review.get", { submission: rv.id })
  assert.deepEqual(v.counts, { items: 4, waiting: 1, approved: 1, changes: 1, rejected: 1 })
  assert.deepEqual(v.items.map((i: Any) => i.state), ["approved", "rejected", "changes", "undecided"])
  assert.equal((await app.run("review.list", { state: "rejected" })).total, 1)
  assert.equal((await app.run("review.list", { state: "waiting" })).total, 1)
  // The list names its entities and pages them like every other list.
  const listed = await app.run("review.list", { pageSize: 10 })
  assert.deepEqual(listed.submissions.map((submission: Any) => [submission.id, submission.counts.items]), [[rv.id, 4]])
  assert.deepEqual([listed.total, listed.page, listed.pages, listed.pageSize, "items" in listed], [1, 1, 1, 10, false])
  assert.deepEqual(listed.counts, { all: 1, waiting: 1, changes: 1, rejected: 1, approved: 0 })
  // The metadata-only unit has an attributes part only.
  assert.deepEqual(v.items[3].parts.map((p: Any) => p.id), ["attributes"])
  cleanup(dir)
})

test("A submission says once, for every item, what is asked, what changed and its known limits", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  const framed = await run("review.submit", { title: "Helm pass", ask: "Is the helm ready to rig?", changes: "Visor **narrowed**.", limits: "No LODs yet.", items: [{ target: unit("armor/helm") }] })
  assert.deepEqual([framed.submission.ask, framed.submission.changes, framed.submission.limits], ["Is the helm ready to rig?", "Visor **narrowed**.", "No LODs yet."])
  assert.equal(read(dir, `.catalog/reviews/${framed.submission.id}/submission.json`).ask, "Is the helm ready to rig?")
  // The ask is one sentence; background belongs in the brief.
  await rejects(run("review.submit", { ask: "Is it ready?\nIt was made from the old rig.", items: [{ target: unit("armor/helm") }] }), "invalid")
  await rejects(run("review.submit", { ask: "x".repeat(301), items: [{ target: unit("armor/helm") }] }), "invalid")
  cleanup(dir)
})

test("Part comments stay with their decided part through recording, reload, history and retries; comments on undecided or unknown parts are refused", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  const s = await run("review.submit", { items: [{ target: unit("armor/helm") }] })
  const rv = await app.run("review.get", { submission: s.submission.id })
  const item = rv.items[0].id
  const decisionFiles = () => files(dir, `.catalog/reviews/${rv.id}/decisions`)
  // Unknown part, undecided part and non-text comments are refused before any record is written.
  await rejects(run("review.decide", { submission: rv.id, item, verdicts: { icon: "changes" }, partComments: { "concept:nope": "x" } }), "invalid")
  await rejects(run("review.decide", { submission: rv.id, item, verdicts: { icon: "changes" }, partComments: { model: "Not decided here" } }), "invalid")
  await rejects(run("review.decide", { submission: rv.id, item, verdicts: { icon: "changes" }, partComments: { icon: 5 } }), "invalid")
  await rejects(run("review.decideCurrent", { target: unit("armor/boots"), verdicts: { icon: "changes" }, partComments: { model: "x" } }), "invalid")
  assert.equal(decisionFiles().length, 0)
  assert.equal((await app.run("review.list", { state: "all" })).total, 1, "an invalid quick review creates no submission")

  // Whole approval with a change and a rejection, two distinct part comments, a blank one and an overall comment.
  await run("review.decide", { submission: rv.id, item, whole: "approved", exceptions: { icon: "changes", model: "rejected" }, comment: "Overall close", partComments: { icon: "  Outline too thin  ", model: "Wrong silhouette", attributes: "   " } }, "pn-1")
  const recorded = read(dir, `.catalog/reviews/${rv.id}/decisions/${decisionFiles()[0]}`)
  assert.deepEqual(recorded.partComments, { icon: "Outline too thin", model: "Wrong silhouette" })
  assert.equal(recorded.comment, "Overall close")
  // Retrying the request records once; reusing its id with other comments is a conflict.
  await run("review.decide", { submission: rv.id, item, whole: "approved", exceptions: { icon: "changes", model: "rejected" }, comment: "Overall close", partComments: { icon: "  Outline too thin  ", model: "Wrong silhouette", attributes: "   " } }, "pn-1")
  await rejects(run("review.decide", { submission: rv.id, item, whole: "approved", exceptions: { icon: "changes", model: "rejected" }, partComments: { icon: "Other" } }, "pn-1"), "conflict")
  assert.equal(decisionFiles().length, 1)
  // A later part-only approval with its own comment; a decision without comments stays readable.
  await run("review.decide", { submission: rv.id, item, verdicts: { icon: "approved" }, partComments: { icon: "Fixed outline" } })
  await run("review.decide", { submission: rv.id, item, verdicts: { attributes: "approved" } })

  const fresh = await open(dir)
  const u = await fresh.run("unit.get", { id: "armor/helm" })
  const part = (id: string) => u.review.parts.find((p: Any) => p.id === id)
  assert.equal(part("icon").decision.partComments.icon, "Fixed outline", "the decision that decides the part carries its current comment")
  assert.equal(part("model").decision.partComments.model, "Wrong silhouette")
  assert.equal(part("attributes").decision.partComments.attributes, undefined)
  assert.deepEqual(u.history.map((e: Any) => e.partComments), [{}, { icon: "Fixed outline" }, { icon: "Outline too thin", model: "Wrong silhouette" }])
  assert.deepEqual(u.history[2].verdicts, { icon: "changes", model: "rejected", "concept:art/sheet.png": "approved", attributes: "approved" })
  assert.equal(u.history[2].comment, "Overall close", "the overall comment stays separate from part comments")
  const asset = await fresh.run("asset.get", { id: "art/helm.glb" })
  assert.deepEqual(asset.verdicts.map((v: Any) => [v.verdict, v.partComment, /^dc_/.test(v.decision)]), [["rejected", "Wrong silhouette", true]])
  assert.equal((await fresh.run("problems", {})).problems.length, 0)

  // A record whose comment addresses a part it does not decide is excluded as a problem.
  const bad = read(dir, `.catalog/reviews/${rv.id}/decisions/${decisionFiles().find((f) => read(dir, `.catalog/reviews/${rv.id}/decisions/${f}`).verdicts?.attributes)}`)
  write(dir, `.catalog/reviews/${rv.id}/decisions/${bad.id}.json`, { ...bad, partComments: { model: "Stray" } })
  assert.match((await (await open(dir)).run("problems", {})).problems.map((p: Any) => p.error).join("\n"), /part comments are invalid/)
  cleanup(dir)
})

test("Before/after views: a view compares its evidence with a frozen project file or earlier evidence of the same kind", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app, agent)
  // `shasum` in the old test; computed in process because that program is not on every system.
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")
  const old = png(4, 4, [10, 10, 10, 255])
  write(dir, "art/scratch/helm-icon-v1.png", old) // a render of the earlier version, not a catalog asset
  const s1 = await run("review.submit", {
    items: [{
      target: unit("armor/helm"),
      views: [
        { part: "icon", caption: "Icon, same framing", before: { path: "art/scratch/helm-icon-v1.png", label: "v1" }, afterLabel: "v2" },
        { part: "model", caption: "Model" }
      ]
    }]
  })
  const rv = await app.run("review.get", { submission: s1.submission.id })
  const [cmp, plain] = rv.items[0].views
  assert.equal(cmp.afterLabel, "v2")
  assert.deepEqual({ ...cmp.before, url: !!cmp.before.url }, { label: "v1", from: null, kind: "image", path: "art/scratch/helm-icon-v1.png", sha256: sha(old), storage: "catalog", status: "ok", url: true })
  assert.equal(plain.before, undefined)
  // The before side is frozen: changing or deleting the file later does not change what reviewers see.
  write(dir, "art/scratch/helm-icon-v1.png", png(4, 4, [99, 99, 99, 255]))
  assert.equal((await app.beforeMedia(rv.id, rv.items[0].id, cmp.id)).sha256, sha(old))

  // Earlier frozen evidence as the before side: the helm model of the first submission, labelled by default.
  write(dir, "art/helm.glb", await glb({ size: 3 }))
  const s2 = await run("review.submit", { items: [{ target: unit("armor/helm"), parts: ["model"], views: [{ part: "model", caption: "Bigger helm", before: { submission: rv.id, item: rv.items[0].id, part: "model" } }] }] })
  const v2 = (await app.run("review.get", { submission: s2.submission.id })).items[0].views[0]
  assert.deepEqual(v2.before.from, { submission: rv.id, item: rv.items[0].id, part: "model" })
  assert.equal(v2.before.label, "Before")
  assert.equal(v2.afterLabel, "After")
  assert.equal(v2.before.sha256, rv.items[0].parts.find((p: Any) => p.id === "model").evidence.sha256)

  // A collection member view compares its named leaf.
  const s3 = await run("review.submit", { items: [{ target: { kind: "collection", id: "outfit/iron" }, parts: ["member:armor/helm"], views: [{ part: "member:armor/helm", leaf: "armor/helm/icon", caption: "Helm icon in the outfit", before: { path: "art/boots.png" } }] }] })
  assert.equal((await app.run("review.get", { submission: s3.submission.id })).items[0].views[0].before.status, "ok")

  // Every refusal leaves no record.
  const count = (await app.run("review.list", { state: "all" })).total
  const helm = (view: unknown) => run("review.submit", { items: [{ target: unit("armor/helm"), views: [view] }] })
  await rejects(helm({ part: "model", before: { path: "art/helm.png" } }), "invalid") // image before a model
  await rejects(helm({ part: "icon", before: { path: "content/armor_helm.json" } }), "forbidden") // outside the asset roots
  await rejects(helm({ part: "icon", before: { path: "art/missing.png" } }), "invalid")
  await rejects(helm({ part: "attributes", before: { path: "art/helm.png" } }), "invalid")
  await rejects(helm({ part: "icon", before: { path: "art/helm.png", submission: rv.id, item: rv.items[0].id, part: "icon" } }), "invalid")
  await rejects(helm({ part: "icon", afterLabel: "After" }), "invalid")
  await rejects(helm({ part: "icon", before: { submission: rv.id, item: rv.items[0].id, part: "attributes" } }), "invalid")
  await rejects(run("review.submit", { items: [{ target: { kind: "collection", id: "outfit/iron" }, views: [{ part: "member:armor/helm", before: { path: "art/boots.png" } }] }] }), "invalid") // no leaf named
  assert.equal((await app.run("review.list", { state: "all" })).total, count)

  // The record survives a fresh open (schema validation) unchanged.
  const again = await open(dir)
  assert.equal((await again.run("review.get", { submission: rv.id })).items[0].views[0].before.sha256, sha(old))
  assert.equal((await again.run("summary", {})).problems, 0, "the before record passes validation")
  cleanup(dir)
})

test("review.remove retires submissions with their decisions and notes, keeps what others depend on, and frees only unshared evidence", async () => {
  const dir = await standardProject({ commit: false })
  const app = await open(dir)
  const run = W(app)
  const evidenceFiles = (): Array<string> => (existsSync(join(dir, ".catalog/evidence")) ? readdirSync(join(dir, ".catalog/evidence"), { recursive: true }).map(String).filter((name) => name.includes(".")) : [])
  const first = (await run("review.submit", { items: [{ target: unit("armor/helm"), parts: ["model"] }] })).submission
  const firstReview = await app.run("review.get", { submission: first.id })
  await run("review.decide", { submission: first.id, item: firstReview.items[0].id, whole: "changes" })
  await run("note.create", { target: { kind: "submission", id: first.id }, body: "Rim reads thin" })
  // A later round shows the first one's frozen model as its before side, and supersedes it.
  const second = (await run("review.submit", {
    supersedes: first.id,
    items: [{ target: unit("armor/helm"), parts: ["model"], views: [{ part: "model", caption: "Thicker rim", before: { submission: first.id, item: firstReview.items[0].id, part: "model" } }] }]
  })).submission
  const third = (await run("review.submit", { items: [{ target: unit("armor/boots"), parts: ["icon"] }] })).submission
  const stored = evidenceFiles()
  assert.ok(stored.length > 0, "uncommitted files were frozen into the evidence store")

  // A dry run says exactly what would go, and changes nothing.
  const plan = await run("review.remove", { submissions: [third.id], reason: "obsolete", dryRun: true })
  assert.deepEqual([plan.removed, plan.submissions.map((s: { id: string }) => s.id), plan.decisions, plan.notes], [false, [third.id], [], []])
  assert.ok(plan.evidence.length > 0)
  assert.deepEqual(evidenceFiles(), stored)
  // What stays may not lose what it depends on.
  const refused = await rejects(run("review.remove", { submissions: [first.id], reason: "archived" }), "conflict")
  assert.match(refused.message, new RegExp(`${second.id} depends on ${first.id}`))
  // Removing the later round alone keeps the first round's evidence, which the first still uses.
  await run("review.remove", { submissions: [second.id], reason: "archived" })
  assert.equal((await app.run("review.list", { state: "all" })).total, 2)
  // Removing the first takes its decision, its note and the evidence nothing else uses.
  const gone = await run("review.remove", { submissions: [first.id, third.id], reason: "archived" }, "cleanup-1")
  assert.equal(gone.removed, true)
  assert.equal(gone.decisions.length, 1)
  assert.equal(gone.notes.length, 1)
  assert.equal((await app.run("review.list", { state: "all" })).total, 0)
  assert.equal((await app.run("note.list", { state: "all" })).total, 0)
  assert.deepEqual(evidenceFiles(), [], "no evidence is left that no record uses")
  assert.equal((await app.run("problems", {})).problems.length, 0)
  // The same request again replays; an unknown id is named.
  assert.equal((await run("review.remove", { submissions: [first.id, third.id], reason: "archived" }, "cleanup-1")).replayed, true)
  await rejects(run("review.remove", { submissions: [first.id], reason: "again" }), "not_found")
  cleanup(dir)
})

test("review.remove with the dry run's plan refuses when an owner decision arrived after archiving, and returns what it removed", async () => {
  const dir = await standardProject({ commit: false })
  const app = await open(dir)
  const run = W(app)
  const submission = (await run("review.submit", { items: [{ target: unit("armor/helm"), parts: ["model"] }] })).submission
  const item = (await app.run("review.get", { submission: submission.id })).items[0].id
  await run("review.decide", { submission: submission.id, item, whole: "changes" })
  const plan = await run("review.remove", { submissions: [submission.id], reason: "archived", dryRun: true })
  // The owner decides again between the archive and the removal.
  await run("review.decide", { submission: submission.id, item, whole: "approved", comment: "Good now" })
  const stale = await rejects(run("review.remove", { submissions: [submission.id], reason: "archived", expectedPlan: plan.plan }), "conflict")
  assert.notEqual(stale.details.plan, plan.plan)
  assert.equal((await app.run("review.list", { state: "all" })).total, 1, "nothing was removed")
  // A note edited after the plan is a change as well.
  const note = (await run("note.create", { target: { kind: "submission", id: submission.id }, body: "Rim" })).note
  const fresh = await run("review.remove", { submissions: [submission.id], reason: "archived", dryRun: true })
  await run("note.edit", { id: note.id, body: "Rim reads thin", expectedRevision: note.revision })
  await rejects(run("review.remove", { submissions: [submission.id], reason: "archived", expectedPlan: fresh.plan }), "conflict")
  // With a current plan it goes, and hands back every record it removed.
  const current = await run("review.remove", { submissions: [submission.id], reason: "archived", dryRun: true })
  const gone = await run("review.remove", { submissions: [submission.id], reason: "archived", expectedPlan: current.plan })
  assert.equal(gone.removed, true)
  assert.deepEqual([gone.records.submissions.length, gone.records.decisions.length, gone.records.notes.length], [1, 2, 1])
  assert.equal(gone.records.notes[0].body, "Rim reads thin")
  assert.ok(gone.records.decisions.some((decision: { comment?: string }) => decision.comment === "Good now"))
  cleanup(dir)
})

test("a decision under a missing submission, or naming an item its submission lacks, is a record problem and decides nothing", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  const approved = await run("review.decideCurrent", { target: unit("armor/helm"), whole: "approved" })
  const other = await run("review.submit", { items: [{ target: unit("armor/boots") }] })
  const sub = approved.submission.id as string
  const decision = read(dir, `.catalog/reviews/${sub}/decisions/${approved.decision.id}.json`)
  // A merge brought a decision on a submission another branch removed, and a hand edit pointed one at another submission's item.
  const orphan = { ...decision, id: "dc_orphan1", submission: "sub_gone1", verdict: "rejected", exceptions: {} }
  const foreign = { ...decision, id: "dc_foreign1", item: other.submission.items[0].id, verdict: "rejected", exceptions: {} }
  write(dir, `.catalog/reviews/sub_gone1/decisions/dc_orphan1.json`, orphan)
  write(dir, `.catalog/reviews/${sub}/decisions/dc_foreign1.json`, foreign)

  const expected = [
    { origin: "records", subject: ".catalog/reviews/sub_gone1/decisions/dc_orphan1.json", error: "decision belongs to submission sub_gone1, which does not exist", recovery: "remove this file, or restore the submission it belongs to" },
    { origin: "records", subject: `.catalog/reviews/${sub}/decisions/dc_foreign1.json`, error: `decision names item ${foreign.item}, which submission ${sub} does not have`, recovery: "remove this file, or restore the submission it belongs to" }
  ]
  const sorted = (list: ReadonlyArray<Any>) => [...list].sort((a, b) => a.subject.localeCompare(b.subject))
  assert.deepEqual(sorted((await app.run("problems", {})).problems), sorted(expected))
  assert.deepEqual(sorted((await app.run("inbox", {})).problems), sorted(expected))
  const helm = await app.run("unit.get", { id: "armor/helm" })
  assert.ok(helm.review.parts.every((part: Any) => part.verdict === "approved"), "the stray decisions decide nothing")
  assert.ok((await app.run("unit.get", { id: "armor/boots" })).review.parts.every((part: Any) => part.verdict === null))
  cleanup(dir)
})

test("a part is changed against the evidence the decision that decided it saw; a newer undecided submission does not reset it and waits meanwhile", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  await run("review.decideCurrent", { target: unit("armor/helm"), whole: "approved" })
  write(dir, "art/helm.png", png(4, 4, [10, 10, 250, 255]))
  const icon = async () => (await app.run("unit.get", { id: "armor/helm" })).review.parts.find((p: Any) => p.id === "icon")
  assert.deepEqual([(await icon()).verdict, (await icon()).changed], ["approved", true])

  // A newer submission freezes the new bytes, but until it is decided the old verdict decides the part.
  const newer = await run("review.submit", { items: [{ target: unit("armor/helm"), parts: ["icon"] }] })
  assert.deepEqual([(await icon()).verdict, (await icon()).changed], ["approved", true])
  const inbox = await app.run("inbox", {})
  assert.ok(inbox.waiting.some((entry: Any) => entry.submission === newer.submission.id), "the newer submission waits")
  assert.ok(inbox.changed.some((entry: Any) => JSON.stringify(entry).includes("armor/helm")), "the part is listed as changed")

  await run("review.decide", { submission: newer.submission.id, item: newer.submission.items[0].id, whole: "approved" })
  assert.deepEqual([(await icon()).verdict, (await icon()).changed], ["approved", false])
  cleanup(dir)
})

test("review.decideCurrent takes a unit or a collection; another kind is invalid input", async () => {
  const dir = await standardProject()
  const run = W(await open(dir))
  await rejects(run("review.decideCurrent", { target: { kind: "asset", id: "art/helm.png" }, whole: "approved" }), "invalid")
  cleanup(dir)
})

test("a recorded decision can be edited in place or deleted; an agent changes only decisions it recorded", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const person = W(app, human)
  const bot = W(app, agent)
  const s = await person("review.submit", { items: [{ target: unit("armor/helm") }] })
  const rv = await app.run("review.get", { submission: s.submission.id })
  const item = rv.items[0].id
  const decisionFiles = () => files(dir, `.catalog/reviews/${rv.id}/decisions`)
  const verdictOf = async (part: string) => (await app.run("unit.get", { id: "armor/helm" })).review.parts.find((p: Any) => p.id === part).verdict

  const first = (await person("review.decide", { submission: rv.id, item, whole: "approved", comment: "Fine" })).decision
  assert.equal(first.revision, 1)
  const later = (await person("review.decide", { submission: rv.id, item, verdicts: { icon: "changes" } })).decision

  // Editing replaces what the decision says, keeps its id, author and place in the order.
  const edited = await person("review.decision.edit", { id: first.id, expectedRevision: 1, whole: "rejected", exceptions: { model: "changes" }, partComments: { model: "Silhouette" } }, "edit-1")
  assert.equal(edited.decision.id, first.id)
  assert.equal(edited.decision.revision, 2)
  assert.deepEqual(edited.decision.by, human)
  assert.equal(edited.decision.at, first.at)
  assert.deepEqual(edited.decision.editedBy, human)
  assert.equal(edited.decision.comment, "", "a comment left out of the edit is cleared")
  assert.equal(await verdictOf("model"), "changes")
  assert.equal(await verdictOf("icon"), "changes", "the later decision still wins its part")
  assert.equal(decisionFiles().length, 2, "an edit writes no new decision")
  // A retry of the same edit is one change; a stale revision is a conflict.
  assert.equal((await person("review.decision.edit", { id: first.id, expectedRevision: 1, whole: "rejected", exceptions: { model: "changes" }, partComments: { model: "Silhouette" } }, "edit-1")).replayed, true)
  await rejects(person("review.decision.edit", { id: first.id, expectedRevision: 1, whole: "approved" }), "conflict")
  await rejects(person("review.decision.edit", { id: first.id, whole: "maybe" }), "invalid")

  // An agent may not change a person's decision, but may change its own.
  await rejects(bot("review.decision.edit", { id: first.id, whole: "approved" }), "forbidden")
  await rejects(bot("review.decision.delete", { id: later.id }), "forbidden")
  const own = (await bot("review.decide", { submission: rv.id, item, verdicts: { attributes: "approved" } })).decision
  assert.equal((await bot("review.decision.edit", { id: own.id, verdicts: { attributes: "changes" } })).decision.verdicts.attributes, "changes")

  // Deleting a decision returns its parts to what the remaining decisions say.
  const gone = await person("review.decision.delete", { id: later.id, expectedRevision: 1 })
  assert.equal(gone.deleted, later.id)
  assert.equal(await verdictOf("icon"), "rejected", "icon falls back to the edited whole decision")
  await person("review.decision.delete", { id: own.id })
  await person("review.decision.delete", { id: first.id })
  assert.equal(decisionFiles().length, 0)
  assert.equal((await app.run("review.get", { submission: rv.id })).items[0].summary.undecided > 0, true)
  await rejects(person("review.decision.delete", { id: first.id }), "not_found")
  assert.equal((await (await open(dir)).run("problems", {})).problems.length, 0)
  cleanup(dir)
})
