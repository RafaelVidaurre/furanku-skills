// Ported from the version 1 engine's test/evidence.mjs. A script, not a test: it captures the
// catalog page on the Hollowmere sample project at desktop and narrow widths, for visual review.
//
//   node src/cli/main.ts catalog example <project-root>      (once, to make the sample)
//   node test/catalog/screens.ts <project-root> [out-dir]    (default out-dir: test-output/screens)
//
// Changed: the "Needs attention" page, which the rebuilt page added, is captured too.
import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { browserOrSkip, newPage, startServer } from "./server.ts"

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const [root, outArg] = process.argv.slice(2)
if (!root) {
  console.error("usage: node test/catalog/screens.ts <project-root> [out-dir]")
  process.exit(2)
}
const out = resolve(outArg ?? fileURLToPath(new URL("../../test-output/screens", import.meta.url)))
mkdirSync(out, { recursive: true })

const server = await startServer(resolve(root))
const errors: Array<string> = []
let captured = 0
let failure: unknown
try {
  const found = await browserOrSkip()
  if ("skip" in found) throw new Error(found.skip)
  const { browser } = found
  try {
    const { app } = server
    const subs: Array<Any> = (await app.run("review.list", { state: "all" })).submissions
    const review = async (title: string): Promise<Any> => {
      const sub = subs.find((s) => s.title === title)
      if (!sub) throw new Error(`no review titled "${title}" in ${root}: this script captures the Hollowmere sample project (jam catalog example <dir>)`)
      return app.run("review.get", { submission: sub.id })
    }
    const set = await review("Ironclad Set")
    const helm = await review("Ironclad Helm first pass")
    const crest = await review("Helm crest")
    // A comparison in the address is the JSON evidence.compare takes; absent b is current content.
    const compare = (part: string) => `cmp=${encodeURIComponent(JSON.stringify({ a: { submission: helm.id, item: helm.items[0].id, part } }))}`
    const views: ReadonlyArray<readonly [name: string, hash: string]> = [
      ["01-main-grid", "#/main"],
      ["02-unit-multi-media", "#/main/u/gear%2Fironclad-helm?part=model"],
      ["03-asset-shared", "#/assets/a/art%2Fconcepts%2Fironclad_sheet.png"],
      ["04-collection-preview", "#/collections/c/set%2Fironclad"],
      ["05-member-context", "#/collections/c/set%2Fironclad/gear%2Fironclad-greaves"],
      ["06-review-queue", "#/reviews"],
      ["07-submission-item", `#/reviews/s/${set.id}/${set.items[0].id}`],
      ["08-compare-3d", `#/main/u/gear%2Fironclad-helm?${compare("model")}`],
      ["09-compare-image", `#/main/u/gear%2Fironclad-helm?${compare("icon")}`],
      ["10-compare-attributes", `#/main/u/gear%2Fironclad-helm?${compare("attributes")}`],
      ["11-notes", "#/notes"],
      ["12-organization", "#/organization"],
      ["13-textured-animated-model", "#/main/u/creature%2Fmire-lurker?part=model"],
      ["14-evidence-views", `#/reviews/s/${crest.id}/${crest.items[0].id}?view=${crest.items[0].views[1].id}`],
      ["15-missing-filter", "#/main?f.role=missing%253Aicon%2Cmissing%253Amodel"],
      ["16-needs-attention", "#/inbox"]
    ]
    for (const [width, height, suffix] of [[1440, 900, ""], [390, 844, "-narrow"]] as const) {
      const p = await newPage(browser, { viewport: { width, height } })
      for (const [name, hash] of views) {
        await p.goto(`${server.url}${hash}`)
        await p.evaluate(() => window.catalogViewer?.settled(15000))
        await p.waitForTimeout(700)
        await p.screenshot({ path: join(out, `${name}${suffix}.png`) })
        captured++
      }
      errors.push(...p.errors.map((error) => `${suffix}: ${error}`))
      await p.close()
    }
  } finally {
    await browser.close()
  }
} catch (error) {
  failure = error
} finally {
  await server.close()
}
if (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure))
  process.exit(1)
}
console.log(JSON.stringify({ out, views: captured, pageErrors: errors }, null, 2))
