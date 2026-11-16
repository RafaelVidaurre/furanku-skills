// Media is hashed when something needs the digest, never to open a project or draw a list. The
// version 2 core hashed every asset on first load to put a digest in each URL: seconds to minutes
// on a real project before the first answer. These tests state the rule as counts of files read
// in full, on files large enough that reading them by accident would also be slow.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { closeSync, ftruncateSync, openSync, readFileSync, writeSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { type App, cleanup, makeProject, open, png, W } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const unit = (id: string) => ({ kind: "unit", id })
const COUNT = 60
const SIZE = 16 * 1024 * 1024

/** A valid PNG head followed by zeros up to `size`: a sparse file, large to read and free to create. */
const large = (dir: string, path: string, seed: number, size = SIZE): void => {
  const file = openSync(join(dir, path), "w")
  writeSync(file, png(4, 4, [seed % 256, (seed * 7) % 256, 9, 255]))
  ftruncateSync(file, size)
  closeSync(file)
}

const hashedBy = async (app: App, action: () => Promise<unknown>): Promise<number> => {
  const before = (await app.stats()).filesHashed
  await action()
  return (await app.stats()).filesHashed - before
}

const bigProject = async (): Promise<string> => {
  const names = Array.from({ length: COUNT }, (_, i) => `art/big-${String(i).padStart(2, "0")}.png`)
  const dir = await makeProject({
    assets: Object.fromEntries(names.map((name) => [name, ""])),
    units: names.map((name, i) => ({ id: `armor/big-${i}`, type: "armor", name: `Big ${i}`, attrs: { slot: "Head" }, links: [{ role: "icon", asset: name }] })),
    collections: [{ id: "outfit/big", name: "Big Outfit", kind: "outfit", members: [{ unit: "armor/big-0" }, { unit: "armor/big-1" }] }],
    commit: false
  })
  names.forEach((name, i) => large(dir, name, i))
  return dir
}

test(`opening a project with ${COUNT} files of 16 MiB and listing it hashes zero files`, async () => {
  const dir = await bigProject()
  const app = await open(dir)
  const started = Date.now()
  const reads = await hashedBy(app, async () => {
    const context = await app.run("context", {})
    assert.equal(context.counts.assets, COUNT)
    const units = await app.run("catalog.search", { pageSize: 200 })
    assert.equal(units.total, COUNT)
    // Every card can show its picture: the file is known to be an image and has an address.
    for (const item of units.items) {
      assert.deepEqual([item.thumb.state, item.thumb.kind, item.thumb.mime, item.thumb.size, item.thumb.sha256], ["ok", "image", "image/png", SIZE, null])
      assert.match(item.thumb.url, /^\/media\/asset\/art%2Fbig-\d\d\.png\?v=[0-9a-f]{16}$/)
      assert.equal(item.thumb.url.split("?v=")[1], item.thumb.version)
    }
    assert.equal(new Set(units.items.map((item: Any) => item.thumb.version)).size, COUNT, "each file has its own version")
    const files = await app.run("catalog.search", { section: "assets", pageSize: 200, filters: { state: ["ok"] } })
    assert.equal(files.total, COUNT)
    await app.run("catalog.search", { section: "collections" })
    await app.run("catalog.search", { q: "big 7", filters: { visual: ["icon"], review: ["none"] } })
    await app.run("schema", {})
    await app.run("problems", {})
    await app.run("inbox", {})
    await app.run("reviews.list", {})
    await app.run("notes.list", {})
    await app.run("organization.list", {})
    await app.run("doctor", {})
    // Serving a file is by its version too.
    assert.equal((await app.assetFile("art/big-03.png")).size, SIZE)
  })
  assert.equal(reads, 0, "no file was read in full")
  // The point of the rule, as a time a person would notice: about a gibibyte was not read.
  assert.ok(Date.now() - started < 20_000, `opening and listing took ${Date.now() - started} ms`)
  // A second process starts from the cached sniffing results and still hashes nothing.
  const restarted = await open(dir)
  assert.equal(await hashedBy(restarted, () => restarted.run("catalog.search", { pageSize: 200 })), 0)
  cleanup(dir)
})

test("the digest is computed where it is needed, once per version of a file: detail, freezing, comparing, a verdict to check", async () => {
  const dir = await bigProject()
  const app = await open(dir)
  const run = W(app)
  const sha = (path: string): string => createHash("sha256").update(readFileSync(join(dir, path))).digest("hex")
  // Detail: the files of that one unit.
  let detail: Any
  assert.equal(await hashedBy(app, async () => { detail = await app.run("unit.get", { id: "armor/big-0" }) }), 1)
  assert.equal(detail.links[0].asset.sha256, sha("art/big-00.png"))
  assert.equal(await hashedBy(app, () => app.run("unit.get", { id: "armor/big-0" })), 0, "known at this size and time")
  // The list keeps the address it had; it now also knows the digest it was told to compute.
  const listed = (await app.run("catalog.search", { q: "Big 0" })).items.find((item: Any) => item.id === "armor/big-0")
  assert.equal(listed.thumb.url, detail.links[0].asset.url)
  assert.equal(listed.thumb.sha256, detail.links[0].asset.sha256)
  // One asset's page.
  assert.equal(await hashedBy(app, () => app.run("asset.get", { id: "art/big-05.png" })), 1)
  // Freezing: exactly what is submitted.
  let submitted: Any
  assert.equal(await hashedBy(app, async () => { submitted = await run("review.submit", { items: [{ target: unit("armor/big-10") }, { target: unit("armor/big-11") }] }) }), 2)
  const review = await app.run("review.get", { submission: submitted.submission.id })
  assert.equal(review.items[0].parts.find((p: Any) => p.id === "icon").evidence.sha256, sha("art/big-10.png"))
  // A waiting review asks nothing of lists.
  assert.equal(await hashedBy(app, () => app.run("catalog.search", { pageSize: 200 })), 0)
  // A verdict: "changed since" compares digests, so decided parts are the files a list may hash.
  await run("review.decide", { submission: review.id, item: review.items[0].id, whole: "approved" })
  assert.equal(await hashedBy(app, () => app.run("catalog.search", { pageSize: 200 })), 0, "the decided file is already hashed")
  large(dir, "art/big-10.png", 200)
  large(dir, "art/big-20.png", 201)
  let after: Any
  assert.equal(await hashedBy(app, async () => { after = await app.run("catalog.search", { pageSize: 200, filters: { review: ["changed"] } }) }), 1, "only the changed file that has a verdict is read")
  assert.deepEqual(after.ids, ["armor/big-10"])
  assert.deepEqual((await app.run("inbox", {})).changed.map((entry: Any) => entry.target.id), ["armor/big-10"])
  // Reviewing current content compares it with what waits, then freezes it.
  assert.equal(await hashedBy(app, () => run("review.decideCurrent", { target: unit("armor/big-30"), whole: "approved" })), 1)
  // Comparing frozen evidence with the current file.
  const compared = await app.run("evidence.compare", { a: { submission: review.id, item: review.items[1].id, part: "icon" } })
  assert.deepEqual([compared.identical, compared.rows[0].b.sha256], [true, sha("art/big-11.png")])
  // A collection's preview names its inputs by digest; its member cards do not.
  assert.equal(await hashedBy(app, () => app.run("collection.get", { id: "outfit/big" })), 0, "the built-in preview shows models; these members have none")
  // A new process knows every digest computed so far.
  const restarted = await open(dir)
  assert.equal(await hashedBy(restarted, async () => {
    await restarted.run("unit.get", { id: "armor/big-0" })
    await restarted.run("asset.get", { id: "art/big-05.png" })
    await restarted.run("inbox", {})
  }), 0)
  assert.equal((await restarted.run("unit.get", { id: "armor/big-0" })).links[0].asset.sha256, sha("art/big-00.png"))
  cleanup(dir)
})
