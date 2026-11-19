// Ported from the version 1 engine: which checkout the catalog describes, and that its own records
// stay with that checkout.
import assert from "node:assert/strict"
import { existsSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { cleanup, git, open, png, read, rejects, standardProject, tmp, W, write } from "./helpers.ts"

test("T01 two worktrees show their own content and uncommitted assets; writes stay in their worktree", async () => {
  const main = await standardProject()
  const wt = join(tmp("cc-wt-"), "feature")
  git(main, "worktree", "add", "-q", "-b", "feature", wt)
  // Different definitions and a new uncommitted asset + unit in the feature worktree.
  write(wt, "art/cape.png", png(6, 6, [1, 2, 3, 255]))
  write(wt, "content/armor_cape.json", { id: "armor/cape", type: "armor", name: "Cape", attrs: { slot: "Back" }, links: [{ role: "icon", asset: "art/cape.png" }] })
  write(wt, "content/armor_helm.json", { ...read(main, "content/armor_helm.json"), name: "Feature Helm" })
  const a = await open(main)
  const b = await open(wt)
  const ca = await a.run("summary", {})
  const cb = await b.run("summary", {})
  assert.equal(ca.checkout.branch, "main")
  assert.equal(cb.checkout.branch, "feature")
  assert.notEqual(ca.checkout.worktree, cb.checkout.worktree)
  // The count of uncommitted changes is in the `checkout` action, not the polled `summary`.
  assert.equal(cb.checkout.dirty, undefined)
  assert.ok((await b.run("checkout", {})).checkout.dirty >= 2)
  assert.equal((await a.run("unit.get", { id: "armor/helm" })).unit.name, "Iron Helm")
  assert.equal((await b.run("unit.get", { id: "armor/helm" })).unit.name, "Feature Helm")
  await rejects(a.run("unit.get", { id: "armor/cape" }), "not_found")
  const cape = await b.run("unit.get", { id: "armor/cape" })
  assert.equal(cape.links[0].asset.state, "ok")
  await W(b)("note.create", { target: { kind: "unit", id: "armor/cape" }, body: "Feature note" })
  assert.equal((await b.run("note.list", {})).total, 1)
  assert.equal((await a.run("note.list", {})).total, 0)
  assert.ok(!existsSync(join(main, ".catalog/notes")))
  cleanup(main, wt)
})

test("T02 a write prepared on one branch is refused after the checkout switches; nothing lands on the new branch", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const before = (await app.run("summary", {})).checkout.key
  git(dir, "checkout", "-q", "-b", "experiment")
  const err = await rejects(app.run("note.create", { target: { kind: "unit", id: "armor/helm" }, body: "Draft from main" }, { actor: { name: "A", kind: "human" }, checkoutKey: before }), "checkout_changed")
  assert.equal(err.details.checkout.branch, "experiment")
  assert.ok(!existsSync(join(dir, ".catalog/notes")))
  // Writing with the new checkout key works.
  const now = (await app.run("summary", {})).checkout.key
  await app.run("note.create", { target: { kind: "unit", id: "armor/helm" }, body: "On experiment" }, { actor: { name: "A", kind: "human" }, checkoutKey: now })
  cleanup(dir)
})

test("T03 refresh reflects edits; removed and malformed units become problems naming their file, not silent replacements", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const { note } = await W(app)("note.create", { target: { kind: "unit", id: "armor/coat" }, body: "About the coat" })
  write(dir, "content/armor_helm.json", { ...read(dir, "content/armor_helm.json"), attrs: { slot: "Head", armor: 12 } })
  assert.equal((await app.run("unit.get", { id: "armor/helm" })).unit.attrs.armor, 12)
  unlinkSync(join(dir, "content/armor_coat.json"))
  writeFileSync(join(dir, "content/armor_boots.json"), '{ "id": "armor/boots", broken')
  const search = await app.run("unit.search", {})
  assert.deepEqual(search.units.map((u: { id: string }) => u.id).sort(), ["armor/helm", "lore/origin"])
  const problems = (await app.run("problems", {})).problems
  assert.ok(problems.some((p: { origin: string; subject: string }) => p.origin === "sources" && p.subject === "content/armor_boots.json"), "malformed file named as the problem's subject")
  const orphan = (await app.run("note.list", {})).notes.find((n: { id: string }) => n.id === note.id)
  assert.equal(orphan.targetExists, false, "note on a removed unit stays identifiable, not retargeted")
  assert.equal(orphan.target.id, "armor/coat")
  // A broken manifest keeps the last good catalog and reports the source's failure.
  writeFileSync(join(dir, "catalog.manifest.json"), "{ oops")
  const after = await app.run("unit.search", {})
  assert.equal(after.total, 2)
  assert.ok((await app.run("problems", {})).problems.some((p: { error: string }) => /source manifest failed/.test(p.error)))
  cleanup(dir)
})

test("T04 renames, member reordering and multiple memberships keep identities, notes and review targets", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  await run("collection.create", { id: "col/kit-a", name: "Kit A", members: ["armor/helm", "armor/coat"] })
  await run("collection.create", { id: "col/kit-b", name: "Kit B", members: ["armor/helm"] })
  const { note } = await run("note.create", { target: { kind: "unit", id: "armor/helm" }, body: "Keep me" })
  const sub = await run("review.submit", { items: [{ target: { kind: "unit", id: "armor/helm" } }] })
  const rv = await app.run("review.get", { submission: sub.submission.id })
  await run("review.decide", { submission: rv.id, item: rv.items[0].id, whole: "approved" })
  // Rename the display label in the project definition; reorder and rename the catalog collection.
  write(dir, "content/armor_helm.json", { ...read(dir, "content/armor_helm.json"), name: "Steel Helm" })
  const kit = await app.run("collection.get", { id: "col/kit-a" })
  await run("collection.update", { id: "col/kit-a", name: "Kit Alpha", members: ["armor/coat", "armor/helm"], expectedRevision: kit.collection.revision })
  const u = await app.run("unit.get", { id: "armor/helm" })
  assert.equal(u.unit.name, "Steel Helm")
  assert.deepEqual(u.memberships.map((m: { id: string }) => m.id).sort(), ["col/kit-a", "col/kit-b", "outfit/iron"])
  assert.equal(u.notes[0].id, note.id)
  assert.equal(u.review.summary.state, "approved")
  const kitA = await app.run("collection.get", { id: "col/kit-a" })
  assert.deepEqual(kitA.members.map((m: { id: string }) => m.id), ["armor/coat", "armor/helm"])
  assert.equal(kitA.collection.name, "Kit Alpha")
  // Counts do not duplicate definitions.
  assert.equal((await app.run("unit.search", {})).total, 4)
  // Stale revision is refused.
  await rejects(run("collection.update", { id: "col/kit-a", name: "Old view", expectedRevision: kit.collection.revision }), "conflict")
  // Source-owned collections are not editable through the catalog.
  await rejects(run("collection.update", { id: "outfit/iron", name: "x" }), "forbidden")
  cleanup(dir)
})

test("Organization: categories and tags on units, assets and collections; bulk edits; rename/merge; project tags read-only", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  await run("organization.set", { target: { kind: "collection", id: "outfit/iron" }, category: "Sets/Outfits", tags: ["starter"] })
  await run("organization.set", { target: { kind: "asset", id: "art/sheet.png" }, category: "Concepts", tags: ["wip"] })
  await run("organization.setMany", { targets: [{ kind: "unit", id: "armor/helm" }, { kind: "unit", id: "armor/boots" }], addTags: ["alpha"], category: "Gear/Heavy" })
  await run("collection.create", { name: "Promo", category: "Marketing", tags: ["alpha"] })
  const cols = await app.run("collection.search", { filters: { cat: ["Sets"] } })
  assert.deepEqual(cols.collections.map((c: { id: string }) => c.id), ["outfit/iron"])
  const alpha = await app.run("collection.search", { filters: { tag: ["alpha"] } })
  assert.deepEqual(alpha.collections.map((c: { name: string }) => c.name), ["Promo"])
  const helm = await app.run("unit.get", { id: "armor/helm" })
  assert.deepEqual(helm.organization.projectTags, ["tier:1"])
  assert.deepEqual(helm.tags.sort(), ["alpha", "tier:1"])
  // Merge alpha into starter; project-owned tier:1 cannot be renamed by the catalog.
  await run("tag.rename", { from: "alpha", to: "starter" })
  assert.equal((await app.run("unit.search", { filters: { tag: ["alpha"] } })).total, 0)
  assert.equal((await app.run("unit.search", { filters: { tag: ["starter"] } })).total, 2)
  await run("tag.rename", { from: "tier:1", to: "tier:one" })
  assert.deepEqual((await app.run("unit.get", { id: "armor/helm" })).organization.projectTags, ["tier:1"])
  await run("category.rename", { from: "Sets", to: "Kits" })
  assert.equal((await app.run("collection.get", { id: "outfit/iron" })).organization.category, "Kits/Outfits")
  await rejects(run("organization.set", { target: { kind: "unit", id: "armor/helm" }, tags: ["Bad Tag!"] }), "invalid")
  const org = await app.run("organization.list", {})
  assert.ok(org.categories.some((c: { path: string; collections: number }) => c.path === "Kits/Outfits" && c.collections === 1))
  cleanup(dir)
})

test("reading the catalog leaves the checkout's Git status as it was: machine-local state ignores itself", async () => {
  const dir = await standardProject()
  // The project has never used the catalog: nothing under .catalog is committed.
  git(dir, "rm", "-r", "-q", "--cached", "--ignore-unmatch", ".catalog")
  git(dir, "commit", "-q", "--allow-empty", "-m", "no catalog records yet")
  const before = git(dir, "status", "--porcelain=v1", "--untracked-files=all")
  const app = await open(dir)
  for (const action of ["summary", "unit.search", "inbox", "doctor"]) await app.run(action, {})
  await app.run("unit.get", { id: "armor/helm" })
  assert.equal(git(dir, "status", "--porcelain=v1", "--untracked-files=all"), before)
  assert.equal(existsSync(join(dir, ".catalog/.gitignore")), false, "a read writes no tracked-candidate file")
  cleanup(dir)
})
