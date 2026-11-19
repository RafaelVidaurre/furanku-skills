// The two actions that answer "what needs attention": `inbox` for work waiting on someone, and
// `doctor` for what keeps the catalog from being trusted.
import assert from "node:assert/strict"
import { unlinkSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { definePlugin } from "../../src/catalog/plugin.ts"
import { agent, cleanup, git, open, png, read, rejects, standardProject, W, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const unit = (id: string) => ({ kind: "unit", id })
const LFS_POINTER = "version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 12345\n"

test("inbox: waiting reviews, open notes, parts changed since their verdict and problems, in one read", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  const empty = await app.run("inbox", {})
  assert.deepEqual(empty.counts, { waiting: 0, notes: 0, changed: 0, problems: 0 })
  // Two submissions: one fully decided, one with a part still waiting.
  await run("review.decideCurrent", { target: unit("armor/helm"), whole: "approved" })
  const waiting = await run("review.submit", { title: "Boots pass", items: [{ target: unit("armor/boots") }, { target: unit("armor/coat") }] })
  const review = await app.run("review.get", { submission: waiting.submission.id })
  await run("review.decide", { submission: review.id, item: review.items[0].id, whole: "approved" })
  // Notes: one open, one dealt with.
  const open1 = await W(app, agent)("note.create", { target: { ...unit("armor/helm"), part: "model" }, body: "Visor reads thin" })
  const done = await run("note.create", { target: unit("armor/coat"), body: "Fixed already" })
  await run("note.resolve", { id: done.note.id })
  // The helm's icon changes after its approval; a broken unit file is a problem.
  write(dir, "art/helm.png", png(4, 4, [9, 9, 9, 255]))
  write(dir, "content/broken.json", "{ nope")
  const before = await app.stats()
  const inbox = await app.run("inbox", {})
  const after = await app.stats()
  assert.deepEqual(inbox.counts, { waiting: 1, notes: 1, changed: 1, problems: 1 })
  assert.deepEqual(inbox.waiting.map((w: Any) => [w.submission, w.ref, w.title, w.waiting, w.items, w.route]), [[review.id, review.ref, "Boots pass", 1, 2, `#/reviews/s/${review.id}`]])
  assert.deepEqual(inbox.notes.map((n: Any) => [n.id, n.targetName, n.partLabel, n.body, n.by.kind]), [[open1.note.id, "Iron Helm", "Model", "Visor reads thin", "agent"]])
  assert.deepEqual(inbox.changed.map((c: Any) => [c.target, c.name, c.parts.map((p: Any) => [p.id, p.verdict])]), [[unit("armor/helm"), "Iron Helm", [["icon", "approved"]]]])
  assert.deepEqual(inbox.problems.map((p: Any) => [p.origin, p.subject]), [["sources", "content/broken.json"]])
  // One fast list: a single projection and a single pass over the record folders.
  assert.equal(after.projections - before.projections, 1)
  assert.equal(after.recordScans - before.recordScans, 1)
  // Lists are bounded; counts are not.
  for (let i = 0; i < 4; i++) await run("note.create", { target: unit("armor/boots"), body: `Note ${i}` })
  const limited = await app.run("inbox", { limit: 2 })
  assert.equal(limited.counts.notes, 5)
  assert.equal(limited.notes.length, 2)
  cleanup(dir)
})

test("doctor: Git LFS pointers, unreadable media, unlinked files and waiting reviews are found; nothing is changed without fix", async () => {
  const dir = await standardProject()
  // A model that is still an LFS pointer, an image with wrong bytes, a missing file, and media no unit links.
  write(dir, "art/boots.glb", LFS_POINTER)
  write(dir, "art/coat.png", "these are not image bytes")
  unlinkSync(join(dir, "art/helm.glb"))
  write(dir, "art/forgotten.png", png(2, 2))
  write(dir, "art/.scratch/draft.png", png(2, 2))
  write(dir, "art/notes.txt", "not media")
  write(dir, ".gitignore", "art/ignored.png\n")
  write(dir, "art/ignored.png", png(2, 2))
  const app = await open(dir)
  await W(app)("review.submit", { title: "Lore pass", items: [{ target: unit("lore/origin") }] })
  const report = await app.run("doctor", {})
  const problems = (name: string): Array<Any> => report.checks.find((check: Any) => check.name === name).problems
  assert.deepEqual(report.checks.map((check: Any) => check.name), ["catalog-problems", "lfs-pointers", "unreadable-media", "unlinked-files", "waiting-reviews"])
  assert.deepEqual(problems("lfs-pointers").map((p: Any) => [p.subject, p.fixable]), [["art/boots.glb", true]])
  assert.match(problems("lfs-pointers")[0].message, /Git LFS pointer/)
  // The pointer is reported once, as a pointer, not again as unreadable media.
  assert.deepEqual(problems("unreadable-media").map((p: Any) => p.subject).sort(), ["art/coat.png", "art/helm.glb"])
  assert.deepEqual(problems("unlinked-files").map((p: Any) => [p.subject, p.severity]), [["art/forgotten.png", "info"]], "hidden folders, ignored files and non-media are left out")
  assert.equal(problems("waiting-reviews").length, 1)
  assert.match(problems("waiting-reviews")[0].message, /"Lore pass" has 1 of 1 items waiting/)
  assert.equal(report.ok, false)
  assert.deepEqual(report.summary, { problems: 3, info: 2, fixable: 1, fixed: 0 })
  assert.equal(read(dir, "content/armor_boots.json").id, "armor/boots")
  assert.equal(git(dir, "status", "--porcelain", "--", "content").trim(), "", "doctor without fix changes no project file")
  cleanup(dir)
})

test("doctor: a clean project is ok; checks from plugins run with the catalog's actions; a failing check is reported", async () => {
  const dir = await standardProject()
  const seen: Array<string> = []
  const audit = definePlugin({
    name: "audit",
    checks: [
      {
        name: "untagged",
        label: "Units without a tag",
        // A check asks the catalog like any client; from a check, only reads are allowed.
        run: async (context) => {
          const search = (await context.run("unit.search", { pageSize: 200 })) as { units: ReadonlyArray<{ id: string; tags: ReadonlyArray<string> }> }
          await context.run("note.create", { target: { kind: "unit", id: "armor/helm" }, body: "from a check" }).catch((error: { code: string }) => seen.push(error.code))
          return search.units.filter((item) => item.tags.length === 0).map((item) => ({ subject: item.id, message: `${item.id} has no tag`, severity: "info" as const }))
        }
      },
      { name: "explodes", run: () => { throw new Error("check blew up") } }
    ]
  })
  write(dir, "catalog.config.json", { version: 3, plugins: ["manifest", "audit"] })
  const unknown = await rejects((await open(dir)).run("doctor", {}))
  assert.match(unknown.message, /audit/, "a plugin the composition root does not provide is a configuration error")
  const app = await open(dir, { plugins: { audit } })
  const report = await app.run("doctor", {})
  const check = (name: string): Any => report.checks.find((c: Any) => c.name === name)
  assert.deepEqual(check("untagged").problems.map((p: Any) => p.subject).sort(), ["armor/boots", "armor/coat", "lore/origin"])
  assert.equal(check("untagged").plugin, "audit")
  assert.deepEqual(seen, ["forbidden"], "a check cannot write through the catalog")
  assert.equal((await app.run("note.list", {})).total, 0)
  assert.match(check("explodes").problems[0].message, /check blew up/)
  assert.equal(report.ok, false, "a check that cannot run is a problem, not a pass")
  // Without the plugin's checks the standard project has nothing to fix.
  write(dir, "catalog.config.json", { version: 3, plugins: ["manifest"] })
  const plain = await app.run("doctor", {})
  assert.deepEqual([plain.ok, plain.summary.problems], [true, 0])
  cleanup(dir)
})
