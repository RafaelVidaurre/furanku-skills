// A catalog opens where its units are: a scope without units is not shown, so a project whose
// units all live in one plugin's scope does not open on an empty default section.
import assert from "node:assert/strict"
import test from "node:test"
import { cleanup, makeProject } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, startServer, type TestServer } from "./server.ts"

const { shot } = screenshots(import.meta.url)

test("the page opens on the first scope that holds units and leaves empty scopes out of the navigation", async (t) => {
  const found = await browserOrSkip()
  if ("skip" in found) return t.skip(found.skip)
  const { browser } = found
  let server: TestServer | undefined
  let dir: string | undefined
  try {
    dir = await makeProject({
      extra: { types: { resource: { label: "Character model", scope: "material", roles: [], fields: [] } } },
      units: [{ id: "uncast", type: "resource", name: "Uncast model", attrs: {} }]
    })
    server = await startServer(dir)
    const page = await newPage(browser)
    await page.goto(server.url)
    await page.getByRole("listitem").filter({ hasText: "Uncast model" }).waitFor()
    assert.match(page.url(), /#\/material$|\/$/)
    assert.equal(await page.locator(".primary-nav").getByRole("link", { name: "Main", exact: true }).count(), 0)
    await shot(page, "opens-on-material")
    // An address naming the empty scope still works.
    await page.goto(server.url + "#/main")
    assert.equal(await page.getByText(/There is no page/).count(), 0)
    assert.deepEqual(page.errors, [])
  } finally {
    await browser.close()
    await server?.close()
    if (dir) cleanup(dir)
  }
})
