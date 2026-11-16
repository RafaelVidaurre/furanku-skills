// The Hollowmere sample project: generated for real (art rendered in a browser, commits made with
// Git), then read back through a fresh catalog the way a person opening it would see it.
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import assert from "node:assert/strict"
import { test } from "node:test"
import { createSample } from "../../examples/hollowmere/create.ts"
import { launchBrowser } from "../../src/catalog/server/browser.ts"
import { cleanup, existsSync, git, join, open, tmp } from "./helpers.ts"

/** Whether a headless browser starts on this machine; asked only after the sample failed. */
const browserStarts = (): Promise<boolean> =>
  Effect.runPromise(launchBrowser().pipe(
    Effect.flatMap((browser) => Effect.promise(() => browser.close())),
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false))
  ))

test("the sample project is a reviewable catalog with history, waiting work and no problems", async (t) => {
  const parent = tmp("cc-sample-")
  t.after(() => cleanup(parent))
  const dir = join(parent, "hollowmere")

  const exit = await Effect.runPromiseExit(createSample(dir, { videos: false }))
  if (Exit.isFailure(exit)) {
    if (!(await browserStarts())) {
      t.skip("no headless browser can be started here; install one with `npx playwright install chromium` to run this test")
      return
    }
    throw Option.getOrUndefined(Exit.findErrorOption(exit)) ?? new Error(`defect: ${String(exit.cause)}`)
  }
  // Without clips the project has no video media: 4 assets fewer than the full sample, and no
  // "Ember Burst retime" review, which is about the effect clip.
  const summary = exit.value
  assert.deepEqual(summary, { created: dir, units: 36, collections: 16, assets: 55, submissions: 8, openNotes: 6, videos: false })

  // A folder that already holds something is refused, by name.
  const again = await Effect.runPromiseExit(createSample(dir, { videos: false }))
  const refused = Exit.isFailure(again) ? Option.getOrUndefined(Exit.findErrorOption(again)) : undefined
  assert.equal(refused?.code, "invalid")
  assert.ok(refused?.message.includes(dir))

  // History: three commits, then work that is not committed yet.
  assert.deepEqual(git(dir, "log", "--format=%s").trim().split("\n"), [
    "Catalog review records",
    "Art pass 2: helm crest, slimmer greaves, faster ember burst",
    "Initial content"
  ])
  assert.ok(existsSync(join(dir, "art", "gear", "ironclad", "helm.glb")))
  assert.ok(!existsSync(join(dir, "art", "fx", "ember_burst.mp4")), "videos were not asked for")

  const app = await open(dir)
  const checkout = await app.run("checkout")
  assert.equal(checkout.context.git, true)
  assert.equal(checkout.context.branch, "main")
  assert.ok(checkout.context.dirty > 0, "the frost lance edit is uncommitted")

  const reviews = await app.run("reviews.list", { pageSize: 50 })
  assert.deepEqual(reviews.items.map((item: { title: string }) => item.title).sort(), [
    "Ember Burst",
    "Frost Lance balance",
    "Helm crest",
    "Ironclad Helm first pass",
    "Ironclad Set",
    "Mire creatures",
    "Rations",
    "Wayfarer Set"
  ])

  const inbox = await app.run("inbox")
  assert.deepEqual(inbox.waiting.map((entry: { title: string }) => entry.title).sort(), ["Frost Lance balance", "Mire creatures", "Rations", "Wayfarer Set"])
  assert.equal(inbox.counts.notes, 6)
  assert.ok(inbox.notes.some((entry: { target: { id: string; part?: string } }) => entry.target.id === "gear/ironclad-greaves" && entry.target.part === "icon"))
  // Art pass 2 redrew media that already had verdicts. The helm's icon and attributes were approved
  // before it; its model is not listed, because "Helm crest" judged the new model after the pass.
  const changed = new Map<string, Array<string>>(
    inbox.changed.map((entry: { target: { id: string }; parts: ReadonlyArray<{ id: string }> }) => [entry.target.id, entry.parts.map((part) => part.id).sort()])
  )
  assert.deepEqual([...changed.keys()].sort(), ["creature/mire-lurker", "gear/ironclad-helm", "set/ironclad"])
  assert.deepEqual(changed.get("gear/ironclad-helm"), ["attributes", "icon"])

  assert.deepEqual((await app.run("problems")).problems, [])
})
