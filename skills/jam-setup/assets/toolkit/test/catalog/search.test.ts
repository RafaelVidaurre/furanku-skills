// Ported from the version 1 engine: search ranking, facets and pages, the states of media, and
// assets shared between units.
import assert from "node:assert/strict"
import { test } from "node:test"
import { cleanup, makeProject, open, png, rejects, standardProject, W, write } from "./helpers.ts"

interface Entry {
  readonly id: string
}
interface Facet {
  readonly value: string
  readonly count: number
}

test("T05 ranking: exact id/name first, prefixes and aliases, transposed words and typos, member-only facts", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const s = (q: string, extra: Record<string, unknown> = {}) => app.run("unit.search", { q, ...extra })
  assert.equal((await s("armor/helm")).units[0].id, "armor/helm")
  assert.equal((await s("Iron Boots")).units[0].id, "armor/boots")
  const iron: Array<string> = (await s("iron")).units.map((u: Entry) => u.id)
  assert.deepEqual(iron.slice(0, 2).sort(), ["armor/boots", "armor/helm"], "name prefixes rank above attribute text")
  assert.equal(iron.at(-1), "lore/origin")
  assert.equal((await s("casque")).units[0].id, "armor/helm", "alias")
  assert.equal((await s("helm iron")).units[0].id, "armor/helm", "transposed word order")
  assert.equal((await s("iorn helm")).units[0].id, "armor/helm", "transposed letters")
  assert.equal((await s("hlem")).units[0]?.id, "armor/helm", "typo tolerance")
  assert.equal((await s("mines")).units[0].id, "lore/origin", "attribute text is searchable")
  assert.equal((await s("zzzz")).total, 0)
  // Member-only fact: the collection matches because a member does, and says which.
  const cols = await app.run("collection.search", { q: "boots" })
  assert.equal(cols.collections[0].id, "outfit/iron")
  assert.equal(cols.collections[0].match.member.id, "armor/boots")
  cleanup(dir)
})

test("T05 facets: counts apply the other filters; filters combine; pages are bounded and reset by the caller", async () => {
  const units = Array.from({ length: 130 }, (_, i) => ({ id: `lore/entry-${String(i).padStart(3, "0")}`, type: "lore", name: `Entry ${i}`, attrs: { text: i % 2 ? "odd" : "even" }, links: [], tags: [i % 3 ? "common" : "rare"], category: i < 65 ? "Book/One" : "Book/Two" }))
  const dir = await makeProject({ units })
  const app = await open(dir)
  const r = await app.run("unit.search", { filters: { tag: ["rare"] }, pageSize: 50 })
  assert.equal(r.total, 44)
  assert.equal(r.units.length, 44)
  assert.equal(r.all, 130)
  // Tag facet counts ignore the tag filter itself, category counts apply it.
  assert.deepEqual(Object.fromEntries(r.facets.tag.values.map((v: Facet) => [v.value, v.count])), { common: 86, rare: 44 })
  assert.equal(r.facets.cat.values.find((v: Facet) => v.value === "Book").count, 44)
  const both = await app.run("unit.search", { filters: { tag: ["rare"], cat: ["Book/Two"] } })
  assert.equal(both.total, both.units.length)
  assert.ok(both.units.every((u: { category: string; tags: ReadonlyArray<string> }) => u.category === "Book/Two" && u.tags.includes("rare")))
  const p1 = await app.run("unit.search", { pageSize: 60, page: 1 })
  const p3 = await app.run("unit.search", { pageSize: 60, page: 3 })
  assert.equal(p1.pages, 3)
  assert.equal(p1.units.length, 60)
  assert.equal(p3.units.length, 10)
  assert.equal(p1.ids.length, 130, "full ordered id list for previous/next navigation")
  const huge = await app.run("unit.search", { pageSize: 10000 })
  assert.equal(huge.units.length, Math.min(130, 200))
  assert.equal(huge.pageSize, 200)
  const beyond = await app.run("unit.search", { page: 99 })
  assert.equal(beyond.page, beyond.pages, "out-of-range pages clamp")
  cleanup(dir)
})

test("attribute filters count a shared list member once per unit", async () => {
  const dir = await makeProject({
    extra: { types: { item: { fields: [{ key: "audience", label: "Audience", filter: true }] } } },
    units: [
      { id: "map", type: "item", attrs: { audience: ["players", "editors", "players"] } },
      { id: "rule", type: "item", attrs: { audience: "editors" } }
    ]
  })
  try {
    const result = await (await open(dir)).run("unit.search", { filters: { "attr.audience": ["players"] } })
    assert.deepEqual(result.ids, ["map"])
    assert.deepEqual(Object.fromEntries(result.facets["attr.audience"].values.map((v: Facet) => [v.value, v.count])), { players: 1, editors: 2 })
  } finally {
    cleanup(dir)
  }
})

test("T06 metadata-only entries, expected-but-missing art and undecodable files are distinct states", async () => {
  const dir = await standardProject({})
  write(dir, "art/broken.png", Buffer.from("this is not a png"))
  write(dir, "art/notes.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  write(dir, "content/armor_broken.json", { id: "armor/broken", type: "armor", name: "Broken Gloves", attrs: { slot: "Hands" }, links: [{ role: "icon", asset: "art/broken.png" }, { role: "concept", asset: "art/notes.svg" }, { role: "model", asset: "art/gone.glb" }] })
  const app = await open(dir)
  const lore = await app.run("unit.get", { id: "lore/origin" })
  assert.equal(lore.links.length, 0)
  assert.equal(lore.missing.length, 0)
  assert.equal(lore.unit.attrs.text, "Long ago the iron mines opened.")
  const coat = await app.run("unit.get", { id: "armor/coat" })
  assert.deepEqual(coat.missing.map((r: { key: string }) => r.key), ["model"], "only the expected role is reported missing")
  const broken = await app.run("unit.get", { id: "armor/broken" })
  const state = Object.fromEntries(broken.links.map((l: { role: string; asset: { state: string } }) => [l.role, l.asset.state]))
  assert.deepEqual(state, { icon: "invalid", model: "missing", concept: "unsupported" })
  assert.equal(broken.unit.attrs.slot, "Hands", "attributes stay usable")
  const missingFacet = await app.run("unit.search", { filters: { role: ["missing:model"] } })
  assert.deepEqual(missingFacet.units.map((u: Entry) => u.id), ["armor/coat"])
  const errors = await app.run("unit.search", { filters: { role: ["error"] } })
  assert.deepEqual(errors.units.map((u: Entry) => u.id), ["armor/broken"])
  const assets = await app.run("asset.search", { filters: { state: ["invalid", "missing", "unsupported"] } })
  assert.deepEqual(assets.assets.map((a: Entry) => a.id).sort(), ["art/broken.png", "art/gone.glb", "art/notes.svg"])
  cleanup(dir)
})

test("Shared assets are single entities with usage, versions and verdicts across content units", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const run = W(app)
  const sheet = await app.run("asset.get", { id: "art/sheet.png" })
  assert.deepEqual(sheet.usage.map((u: { unit: string }) => u.unit).sort(), ["armor/boots", "armor/helm"])
  assert.ok(sheet.usage.every((u: { part: string }) => u.part === "concept:art/sheet.png"))
  const helm = await app.run("unit.get", { id: "armor/helm" })
  assert.deepEqual(helm.links.find((l: { role: string }) => l.role === "concept").alsoUsedBy.map((x: { unit: string }) => x.unit), ["armor/boots"])
  await run("review.decideCurrent", { target: { kind: "unit", id: "armor/helm" }, whole: "approved" })
  // No propagation to the other unit sharing the asset.
  assert.equal((await app.run("unit.get", { id: "armor/boots" })).review.parts.find((p: Entry) => p.id === "concept:art/sheet.png").verdict, null)
  write(dir, "art/sheet.png", png(8, 4, [255, 255, 255, 255]))
  const after = await app.run("asset.get", { id: "art/sheet.png" })
  assert.equal(after.versions.length, 2)
  assert.equal(after.versions[0].current, true)
  assert.equal(after.verdicts.length, 1)
  assert.equal(after.verdicts[0].verdict, "approved")
  const facet = await app.run("asset.search", { filters: { use: ["shared"] } })
  assert.deepEqual(facet.assets.map((a: Entry) => a.id), ["art/sheet.png"])
  cleanup(dir)
})

test("three searches: each names its entities and pages them in the list envelope, with its own facets", async () => {
  const dir = await standardProject()
  const app = await open(dir)
  const envelope = ["total", "page", "pages", "pageSize", "all", "q", "filters", "facets", "ids"]
  const units = await app.run("unit.search", { q: "iron", pageSize: 1 })
  assert.deepEqual([units.units.length, units.total, units.page, units.pages, units.pageSize, units.scope], [1, 3, 1, 3, 1, null])
  for (const field of envelope) assert.ok(field in units, `unit.search ${field}`)
  assert.equal("items" in units || "section" in units, false)
  assert.deepEqual(Object.keys(units.facets).sort(), ["cat", "in", "notes", "review", "role", "tag", "type"])
  const collections = await app.run("collection.search", {})
  assert.deepEqual(collections.collections.map((c: Entry) => c.id), ["outfit/iron"])
  assert.deepEqual([collections.total, collections.pageSize, collections.scope], [1, 60, null])
  assert.deepEqual(Object.keys(collections.facets).sort(), ["cat", "contains", "kind", "notes", "review", "tag"])
  // Scopes split units; a collection matches a scope through a member in it.
  assert.equal((await app.run("collection.search", { scope: "main" })).total, 1)
  const assets = await app.run("asset.search", { filters: { kind: ["model"] } })
  assert.deepEqual(assets.assets.map((a: Entry) => a.id).sort(), ["art/boots.glb", "art/helm.glb"])
  assert.equal("scope" in assets, false, "assets are not split by scope")
  assert.deepEqual(Object.keys(assets.facets).sort(), ["cat", "kind", "notes", "role", "state", "tag", "use"])
  // Each search takes only its own inputs: no section, and no scope for assets.
  await rejects(app.run("unit.search", { section: "units" }), "invalid")
  await rejects(app.run("asset.search", { scope: "main" }), "invalid")
  await rejects(app.run("unit.search", { filters: { kind: ["model"] } }), "invalid")
  cleanup(dir)
})
