// Ported from the version 1 engine's browser-preview-integrity.test.mjs. Preview integrity in real
// Chromium: every declared preview input must be present, and a frozen preview runs only the exact
// project module revision it was submitted with.
//
// Changed: the agent's viewer actions run through the server's own renderer (`server.viewer`), as
// `/api/run/viewer.*` does; the original posted them over HTTP.
import assert from "node:assert/strict"
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import type { Browser } from "playwright"
import { type App, cleanup, git, glb, human, makeProject, W, write } from "./helpers.ts"
import { browserOrSkip, newPage, screenshots, startServer, type TestServer } from "./server.ts"

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const { shot } = screenshots(import.meta.url)
const LINEUP = fileURLToPath(new URL("../../examples/previews/lineup.mjs", import.meta.url))
let dir: string
let app: App
let server: TestServer
let browser: Browser
let base: string
let found: Awaited<ReturnType<typeof browserOrSkip>>
const col = (id: string) => ({ kind: "collection", id })
const api = (name: string, input: unknown): Promise<Any> => server.viewer(name, input)
/** The viewer state and stage text a person sees at an address; `picture` keeps a screenshot of it. */
const viewState = async (hash: string, picture?: string): Promise<{ st: Any; text: string }> => {
  const p = await newPage(browser, { viewport: { width: 1280, height: 860 } })
  await p.goto(`${base}${hash}`)
  await p.evaluate(() => window.catalogViewer.settled(15000))
  const st = await p.evaluate(() => window.catalogViewer.state())
  const text = (await p.textContent(".stage-view")) ?? ""
  if (picture) await shot(p, picture)
  await p.close()
  assert.deepEqual(p.errors, [])
  return { st, text }
}
const captureRefused = async (target: unknown): Promise<void> => {
  const o = await api("viewer.open", { target, session: "pi" }).catch((e) => e)
  const c = await api("viewer.capture", { session: "pi" }).catch((e) => e)
  await api("viewer.close", { session: "pi" })
  assert.equal(c.code, "unavailable", `capture refused (open: ${o.code ?? "ok"})`)
}

before(async () => {
  found = await browserOrSkip()
  if ("skip" in found) return
  browser = found.browser
  dir = await makeProject({
    assets: { "art/a.glb": await glb(), "art/b.glb": await glb({ size: 2 }), "art/stand.glb": await glb({ size: 3 }), "art/body.glb": await glb({ size: 4 }) },
    units: [
      { id: "armor/a", type: "armor", name: "A", attrs: {}, links: [{ role: "model", asset: "art/a.glb" }] },
      { id: "armor/b", type: "armor", name: "B", attrs: {}, links: [{ role: "model", asset: "art/b.glb" }] }
    ],
    collections: [
      { id: "set/ab", name: "Set AB", kind: "outfitbase", members: [{ unit: "armor/a" }, { unit: "armor/b" }] },
      { id: "row/ab", name: "Row AB", kind: "lineup", members: [{ unit: "armor/a" }, { unit: "armor/b" }] }
    ],
    extra: {
      collectionKinds: {
        outfitbase: { label: "Outfit", preview: { label: "Assembled", module: "assembled-mesh", base: "art/body.glb" } },
        lineup: { label: "Lineup", preview: { label: "Lineup", module: "lineup", base: "art/stand.glb", config: { spacing: 2 } } }
      }
    },
    commit: false
  })
  mkdirSync(join(dir, "previews"), { recursive: true })
  copyFileSync(LINEUP, join(dir, "previews/lineup.mjs"))
  write(dir, "catalog.config.json", { version: 1, adapter: "manifest", previewModules: { lineup: "./previews/lineup.mjs" } })
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "initial")
  server = await startServer(dir)
  app = server.app
  base = server.url
})
after(async () => {
  await browser?.close()
  await server?.close()
  if (dir) cleanup(dir)
})

describe("preview dependency integrity", () => {
  it("a frozen built-in preview whose base evidence is missing is an explicit error and cannot be captured", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    write(dir, "art/body.glb", await glb({ size: 4.5 })) // dirty: the base is stored as catalog evidence
    const s = await W(app, human)("review.submit", { items: [{ target: col("set/ab"), parts: ["preview"] }] })
    const rv = await app.run("review.get", { submission: s.submission.id })
    const item = rv.items[0]
    const baseLeaf = item.parts[0].leaves.find((l: Any) => l.key === "base")
    assert.equal(baseLeaf.storage, "catalog")
    const target = { kind: "submission", id: rv.id, item: item.id, view: item.views[0].id }
    let v = await viewState(`#/reviews/s/${rv.id}/${item.id}`, "frozen-preview-with-base")
    assert.equal(v.st.viewer.status, "ready")
    assert.equal(v.st.viewer.files.ghosts.length, 1)
    unlinkSync(join(dir, `.catalog/evidence/${baseLeaf.sha256.slice(0, 2)}/${baseLeaf.sha256}.glb`))
    v = await viewState(`#/reviews/s/${rv.id}/${item.id}`, "frozen-preview-base-evidence-missing")
    assert.equal(v.st.viewer.status, "error")
    assert.match(v.text, /Preview inputs unavailable: base/)
    await captureRefused(target)
  })

  it("a current preview whose declared base file is missing is an explicit error; submission is refused", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    let v = await viewState("#/collections/c/set%2Fab", "collection-assembled-preview")
    assert.equal(v.st.viewer.status, "ready")
    unlinkSync(join(dir, "art/body.glb"))
    v = await viewState("#/collections/c/set%2Fab", "collection-preview-base-missing")
    assert.equal(v.st.viewer.status, "error")
    assert.match(v.text, /base/)
    await captureRefused({ kind: "collection", id: "set/ab" })
    const r = await W(app, human)("review.submit", { items: [{ target: col("set/ab"), parts: ["preview"] }] }).catch((e) => e)
    assert.equal(r.code, "invalid")
    git(dir, "checkout", "--", "art/body.glb")
  })

  it("a frozen preview runs only its submitted module revision; a changed module is reported and refused, and marks the verdict changed", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const s = await W(app, human)("review.submit", { items: [{ target: col("row/ab"), parts: ["preview"] }] })
    const rv = await app.run("review.get", { submission: s.submission.id })
    const item = rv.items[0]
    await W(app, human)("review.decide", { submission: rv.id, item: item.id, whole: "approved" })
    const pinned = item.preview.moduleUrl
    assert.match(pinned, /\?v=[0-9a-f]{16}$/)
    let v = await viewState(`#/reviews/s/${rv.id}/${item.id}`, "frozen-lineup-preview")
    assert.equal(v.st.viewer.status, "ready")
    assert.equal(v.st.viewer.source.spacing, 2)
    let proj = (await app.run("collection.get", { id: "row/ab" })).review.parts.find((p: Any) => p.id === "preview")
    assert.equal(proj.verdict, "approved")
    assert.equal(proj.changed, false)
    // Edit the module source (v2).
    const src = readFileSync(join(dir, "previews/lineup.mjs"), "utf8")
    writeFileSync(join(dir, "previews/lineup.mjs"), src.replace("source=${{ ...ctx.source, spacing }}", "source=${{ ...ctx.source, spacing, revision: 2 }}"))
    const r = await fetch(`${base}${pinned.slice(1)}`)
    assert.equal(r.status, 409, "the server refuses to serve another revision for a pinned request")
    const changed = await app.run("review.get", { submission: rv.id })
    assert.equal(changed.items[0].preview.moduleChanged, true)
    assert.equal(changed.items[0].preview.moduleUrl, null)
    v = await viewState(`#/reviews/s/${rv.id}/${item.id}`, "frozen-lineup-module-changed")
    assert.equal(v.st.viewer.status, "error")
    assert.match(v.text, /changed since this submission/)
    await captureRefused({ kind: "submission", id: rv.id, item: item.id, view: item.views[0].id })
    // The current collection runs the new revision; the verdict stays, marked changed.
    v = await viewState("#/collections/c/row%2Fab", "collection-lineup-preview")
    assert.equal(v.st.viewer.status, "ready")
    assert.equal(v.st.viewer.source.revision, 2)
    proj = (await app.run("collection.get", { id: "row/ab" })).review.parts.find((p: Any) => p.id === "preview")
    assert.equal(proj.verdict, "approved")
    assert.equal(proj.changed, true, "module change shows as changed evidence")
    // Restoring the submitted revision makes the frozen preview renderable again.
    writeFileSync(join(dir, "previews/lineup.mjs"), src)
    v = await viewState(`#/reviews/s/${rv.id}/${item.id}`)
    assert.equal(v.st.viewer.status, "ready")
    assert.equal(v.st.viewer.source.revision, undefined)
  })

  it("a removed project module file is unavailable for current and frozen previews", async (t) => {
    if ("skip" in found) return t.skip(found.skip)
    const s = await W(app, human)("review.submit", { items: [{ target: col("row/ab"), parts: ["preview"] }] })
    const rv = await app.run("review.get", { submission: s.submission.id })
    unlinkSync(join(dir, "previews/lineup.mjs"))
    let v = await viewState(`#/reviews/s/${rv.id}/${rv.items[0].id}`)
    assert.equal(v.st.viewer.status, "error")
    assert.match(v.text, /not available in this checkout/)
    v = await viewState("#/collections/c/row%2Fab", "collection-preview-module-missing")
    assert.equal(v.st.viewer.status, "error")
    assert.match(v.text, /declared but its file is missing/)
    await captureRefused({ kind: "collection", id: "row/ab" })
    // Comparison rows still resolve each declared input independently.
    const c = await app.run("evidence.compare", { a: { submission: rv.id, item: rv.items[0].id, part: "preview" }, b: "current" })
    assert.deepEqual(c.rows.map((x: Any) => x.key).sort(), ["armor/a/model", "armor/b/model", "base"])
    assert.ok(c.rows.every((x: Any) => x.a.status === "ok"))
    git(dir, "checkout", "--", "previews/lineup.mjs")
  })
})
