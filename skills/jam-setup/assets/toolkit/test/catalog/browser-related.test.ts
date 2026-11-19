// A unit's page shows the relations plugins declare, in both directions, so "Used by" and
// "Made from" are visible; a relation an attribute already lists is not shown twice.
import assert from "node:assert/strict"
import test from "node:test"
import { cleanup, git, tmp, write } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, startServer, type TestServer } from "./server.ts"

const { shot } = screenshots(import.meta.url)

const PLUGIN = `export default {
  name: "rel",
  sources: [{ name: "kit", inputs: () => [], load: () => ({
    types: { piece: { label: "Piece", fields: [{ key: "parts", label: "Parts", kind: "refs" }, { key: "built", label: "Built from", kind: "refs" }, { key: "made", label: "Made", kind: "refs", derived: true }] } },
    units: [
      { id: "cart", type: "piece", name: "Cart", attrs: { parts: ["wheel"], built: ["plank"] } },
      { id: "kiln", type: "piece", name: "Kiln", attrs: { made: ["plank"] } },
      { id: "wheel", type: "piece", name: "Wheel", attrs: {} },
      { id: "plank", type: "piece", name: "Plank", attrs: {} }
    ]
  }) }],
  relations: [
    { name: "parts", label: "Parts", inverseLabel: "Part of", from: (u) => u.attrs.parts ?? [] },
    { name: "built", label: "Built from", inverseLabel: "Used to build", from: (u) => u.attrs.built ?? [] },
    { name: "made", label: "Made", inverseLabel: "Made in", from: (u) => u.attrs.made ?? [] }
  ]
}
`

test("relations show in both directions on a unit's page, without repeating an attribute", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  let server: TestServer | undefined
  const dir = tmp("cc-related-")
  try {
    git(dir, "init", "-q")
    write(dir, "catalog.config.json", { version: 3, plugins: ["./catalog/rel.mjs"] })
    write(dir, "catalog/rel.mjs", PLUGIN)
    server = await startServer(dir)
    const page = await newPage(browser)
    await page.goto(server.url + "#/main/u/wheel")
    const related = page.getByRole("region", { name: "Related" })
    await related.getByRole("link", { name: "Cart" }).waitFor()
    assert.match(await related.innerText(), /PART OF|Part of/)
    await shot(page, "inverse")
    await page.goto(server.url + "#/main/u/cart")
    await page.locator("h1").filter({ hasText: "Cart" }).waitFor()
    // Both outgoing relations are already attributes of the details: no Related block.
    assert.equal(await page.getByRole("region", { name: "Related" }).count(), 0)
    // A derived attribute the Related block shows is not listed again under Technical details.
    await page.goto(server.url + "#/main/u/kiln")
    await page.getByRole("region", { name: "Related" }).getByRole("link", { name: "Plank" }).waitFor()
    assert.equal(await page.locator("details.disclosure").filter({ hasText: "Technical details" }).count(), 0)
    assert.deepEqual(page.errors, [])
  } finally {
    await browser.close()
    await server?.close()
    cleanup(dir)
  }
})
