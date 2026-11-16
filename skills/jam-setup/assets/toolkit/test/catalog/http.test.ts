// The catalog over HTTP: the same actions as the CLI, and the rules that make a local server safe
// to leave running. T15/T21 and T22 are ported from the version 1 engine's http.test.mjs; the
// media checks that the audio and corrections tests made over HTTP (and that the engine tests now
// make through the facade) are made here against the real routes. The rest is new with the
// rebuilt server: every media route is tried for traversal, declared browser modules are the only
// project code served, and nothing is served from .git, the configuration or machine-local state.
//
// `serve --detach` became `jam catalog open`; its test is in server-lifecycle.test.ts.
import assert from "node:assert/strict"
import { readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { definePlugin } from "../../src/catalog/plugin.ts"
import { cleanup, git, makeProject, png, read, standardProject, tmp, tone, W, write } from "./helpers.ts"
import { json, post, raw, startServer } from "./server.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const unit = (id: string) => ({ kind: "unit", id })
const asset = (id: string): string => `/media/asset/${encodeURIComponent(id)}`
const bot = { name: "bot", kind: "agent" }

test("T15/T21 HTTP actions: discovery, browser identity, same validation, and a retried request recorded once", async () => {
  const dir = await standardProject()
  const s = await startServer(dir)
  try {
    const listed: Array<Any> = json(await raw(s.port, { path: "/api/actions" })).actions
    const actions = listed.map((a) => a.name)
    for (const a of ["catalog.search", "note.create", "review.submit", "review.decide", "evidence.compare", "viewer.open", "viewer.capture", "viewer.control"]) assert.ok(actions.includes(a), a)
    // Viewer actions are told apart from the actions that run anywhere, and publish their inputs too.
    assert.equal(listed.find((a) => a.name === "viewer.open").kind, "viewer")
    assert.ok(listed.find((a) => a.name === "viewer.open").input.properties.target)
    // A non-browser client must declare its actor.
    assert.equal((await post(s.port, "note.create", { input: { target: unit("armor/helm"), body: "x" } })).status, 400)
    const body = { input: { target: unit("armor/helm"), body: "Lost response" }, actor: bot, requestId: "retry-1" }
    const a = json(await post(s.port, "note.create", body))
    const b = json(await post(s.port, "note.create", body))
    assert.equal(a.note.id, b.note.id)
    assert.equal(b.replayed, true)
    const web = json(await post(s.port, "note.create", { input: { target: unit("armor/boots"), body: "From browser" } }, { "x-catalog-client": "web" }))
    assert.equal(web.note.by.kind, "human")
    const bad = await post(s.port, "organize.set", { input: { target: unit("armor/helm"), tags: ["Bad Tag"] }, actor: bot })
    assert.equal(bad.status, 400)
    assert.equal(json(bad).error.code, "invalid")
    assert.equal(json(await post(s.port, "notes.list", { input: {} })).total, 2)
    // New: every failure code has its status, and the body is the error the CLI would print.
    const missing = await post(s.port, "unit.get", { input: { id: "armor/none" } })
    assert.deepEqual([missing.status, json(missing).error.code], [404, "not_found"])
    const unknown = await post(s.port, "no.such.action", { input: {} })
    assert.deepEqual([unknown.status, json(unknown).error.code], [404, "not_found"])
    assert.match(json(unknown).error.fix, /jam catalog actions/)
    // New: the request body itself is checked; a misspelt field is refused, not ignored.
    const typo = await post(s.port, "note.create", { input: { target: unit("armor/helm"), body: "x" }, actor: bot, requestID: "lost" })
    assert.equal(typo.status, 400)
    assert.match(json(typo).error.message, /requestID/)
    assert.equal(json(await post(s.port, "notes.list", { input: {} })).total, 2, "nothing was recorded by the refused request")
    // New: a server says who it is, so a command can tell it from another process on that port.
    const health = json(await raw(s.port, { path: "/api/health" }))
    assert.deepEqual([health.ok, health.pid, health.root], [true, process.pid, dir])
  } finally {
    await s.close()
    cleanup(dir)
  }
})

test("T22 security: loopback host/origin checks, write headers, body limits, traversal and symlink escapes, unsafe media", async () => {
  const dir = await standardProject()
  const outside = tmp("cc-secret-")
  writeFileSync(join(outside, "secret.png"), png(2, 2))
  symlinkSync(join(outside, "secret.png"), join(dir, "art/escape.png"))
  write(dir, "art/fake.png", Buffer.from("<html><script>alert(1)</script></html>"))
  write(dir, "content/armor_x.json", { id: "armor/x", type: "armor", name: "X", attrs: {}, links: [{ role: "icon", asset: "art/escape.png" }, { role: "concept", asset: "art/fake.png" }] })
  write(dir, "content/armor_y.json", { id: "armor/y", type: "armor", name: "Y", attrs: {}, links: [{ role: "icon", asset: "../outside.png" }, { role: "concept", asset: "catalog.config.json" }] })
  write(dir, "content/armor_z.json", { id: "armor/z", type: "armor", name: "Z", attrs: {}, links: [{ role: "icon", asset: ".git/HEAD" }] })
  const s = await startServer(dir)
  const app = s.app
  try {
    assert.equal((await raw(s.port, { path: "/api/actions", headers: { host: "evil.example:80" } })).status, 403, "DNS rebinding host")
    assert.equal((await post(s.port, "notes.list", { input: {} }, { origin: "http://evil.example" })).status, 403, "cross-origin write")
    assert.equal((await raw(s.port, { method: "POST", path: "/api/run/note.create", headers: { "content-type": "application/json" }, body: "{}" })).status, 403, "missing request header")
    assert.equal((await raw(s.port, { method: "POST", path: "/api/run/notes.list", headers: { "content-type": "text/plain", "x-catalog-request": "1" }, body: "{}" })).status, 415)
    assert.equal((await raw(s.port, { method: "POST", path: "/api/run/notes.list", headers: { "content-type": "application/json", "x-catalog-request": "1" }, body: "x".repeat(1_100_000) })).status, 400)
    for (const p of ["/../package.json", "/vendor/three/../../package.json", "/vendor/three/../../../../../../etc/passwd", "/media/asset/..%2F..%2Fpackage.json", "/media/asset/.git%2Fconfig", "/.catalog/.gitignore", "/media/evidence/x/y/z"]) {
      assert.ok([400, 403, 404].includes((await raw(s.port, { path: p })).status), p)
    }
    const x = await app.run("unit.get", { id: "armor/x" })
    assert.equal(x.links.find((l: Any) => l.role === "icon"), undefined, "symlink escaping the project is not catalogued")
    assert.equal(x.links.find((l: Any) => l.role === "concept").asset.state, "invalid", "bytes are not an image")
    assert.equal((await raw(s.port, { path: asset("art/escape.png") })).status, 404)
    assert.match((await app.run("problems", {})).problems.map((p: Any) => p.error).join("\n"), /symlink escapes/)
    assert.match((await app.run("problems", {})).problems.map((p: Any) => p.error).join("\n"), /repository metadata/)
    assert.equal((await raw(s.port, { path: asset("art/fake.png") })).status, 503)
    const problems = (await app.run("problems", {})).problems.map((p: Any) => p.error).join("\n")
    assert.match(problems, /outside the declared asset roots|inside the project/)
    const okMedia = await raw(s.port, { path: asset("art/helm.png") })
    assert.equal(okMedia.status, 200)
    assert.equal(okMedia.headers["content-type"], "image/png")
    assert.equal(okMedia.headers["x-content-type-options"], "nosniff")
    assert.match(String(okMedia.headers["content-security-policy"]), /sandbox/)
    const range = await raw(s.port, { path: asset("art/helm.glb"), headers: { range: "bytes=0-3" } })
    assert.equal(range.status, 206)
    assert.equal(range.body.toString(), "glTF")
    const page = await raw(s.port, { path: "/" })
    assert.match(String(page.headers["content-security-policy"]), /script-src 'self' 'sha256-/)
    // Note text is stored as data, never markup.
    const n = json(await post(s.port, "note.create", { input: { target: unit("armor/helm"), body: "<img src=x onerror=alert(1)>" }, actor: { name: "a", kind: "agent" } }))
    assert.equal(n.note.body, "<img src=x onerror=alert(1)>")
  } finally {
    await s.close()
    cleanup(dir, outside)
  }
})

test("who may talk to the server: the Host must name it, an Origin must be it, and a write needs the header and JSON", async () => {
  const dir = await standardProject()
  const s = await startServer(dir)
  try {
    const call = (headers: Record<string, string>, path = "/api/actions") => raw(s.port, { path, headers }).then((r) => r.status)
    // Every name this machine reaches the server by is accepted; no other host is, on any route.
    for (const host of [`127.0.0.1:${s.port}`, `localhost:${s.port}`, `[::1]:${s.port}`]) assert.equal(await call({ host }), 200, host)
    for (const host of ["evil.example", `evil.example:${s.port}`, `127.0.0.1:${s.port + 1}`, "127.0.0.1", `127.0.0.1.evil.example:${s.port}`]) {
      for (const path of ["/", "/api/actions", "/app.js", asset("art/helm.png"), "/vendor/three/three.module.js"]) assert.equal(await call({ host }, path), 403, `${host} ${path}`)
    }
    const refusedHost = await raw(s.port, { path: "/api/actions", headers: { host: "evil.example" } })
    assert.equal(json(refusedHost).error.code, "forbidden")
    // An Origin header is sent by browsers on cross-site requests: only the server's own passes.
    assert.equal(await call({ origin: `http://127.0.0.1:${s.port}` }), 200)
    assert.equal(await call({ origin: `http://localhost:${s.port}` }), 200)
    for (const origin of ["http://evil.example", `https://127.0.0.1:${s.port}`, `http://127.0.0.1:${s.port + 1}`, "null"]) {
      assert.equal(await call({ origin }), 403, origin)
      assert.equal(await call({ origin }, asset("art/helm.png")), 403, `${origin} media`)
      assert.equal((await post(s.port, "notes.list", { input: {} }, { origin })).status, 403, `${origin} action`)
    }
    // A cross-site form can POST, but it cannot set a header or send JSON: reads through /api/run need both too.
    const run = (headers: Record<string, string>, method = "POST") => raw(s.port, { method, path: "/api/run/notes.list", headers, body: method === "POST" ? "{}" : undefined } as never).then((r) => r.status)
    assert.equal(await run({ "content-type": "application/json", "x-catalog-request": "1" }), 200)
    assert.equal(await run({ "content-type": "application/json" }), 403)
    assert.equal(await run({ "content-type": "application/json", "x-catalog-request": "0" }), 403)
    assert.equal(await run({ "content-type": "application/x-www-form-urlencoded", "x-catalog-request": "1" }), 415)
    assert.equal(await run({ "content-type": "text/plain", "x-catalog-request": "1" }), 415)
    assert.equal(await run({ "x-catalog-request": "1" }), 415)
    assert.equal(await run({ "content-type": "application/json", "x-catalog-request": "1" }, "GET"), 405)
    // The body limit is one mebibyte: just under passes validation, just over is refused unread.
    const sized = (bytes: number) => raw(s.port, { method: "POST", path: "/api/run/notes.list", headers: { "content-type": "application/json", "x-catalog-request": "1" }, body: JSON.stringify({ input: { q: "x".repeat(bytes) } }) })
    assert.equal((await sized(1_000_000)).status, 200)
    const over = await sized(1_048_576)
    assert.equal(over.status, 400)
    assert.match(json(over).error.message, /too large/)
    const malformed = await raw(s.port, { method: "POST", path: "/api/run/notes.list", headers: { "content-type": "application/json", "x-catalog-request": "1" }, body: "{ nope" })
    assert.deepEqual([malformed.status, json(malformed).error.message], [400, "request body is not valid JSON"])
    // Only reads on the routes that hand out files.
    for (const path of ["/", "/app.js", asset("art/helm.png"), "/vendor/three/three.module.js", "/media/evidence/a/b/c", "/media/before/a/b/c", "/project/preview/x", "/project/kind/x", "/api/actions", "/api/health"]) {
      assert.ok([404, 405].includes((await raw(s.port, { method: "POST", path, headers: { "content-type": "application/json" }, body: "{}" })).status), `POST ${path}`)
    }
    assert.equal((await raw(s.port, { method: "DELETE", path: "/app.js" })).status, 405)
  } finally {
    await s.close()
    cleanup(dir)
  }
})

test("traversal on every route that serves files: nothing outside the web folder, the browser packages and the asset roots", async () => {
  const dir = await standardProject()
  write(dir, "secret.txt", "TOP-SECRET")
  write(dir, "art/../outside.png", png(2, 2))
  write(dir, ".catalog/.local/private.png", png(2, 2))
  const s = await startServer(dir)
  try {
    const run = W(s.app)
    const submitted = await run("review.submit", { items: [{ target: unit("armor/helm"), parts: ["icon"], views: [{ part: "icon", caption: "Icon", before: { path: "art/boots.png" } }] }] })
    const review = await s.app.run("review.get", { submission: submitted.submission.id })
    const item = review.items[0]
    const good = [review.items[0].parts[0].leaves[0].url, item.views[0].before.url, asset("art/helm.png"), "/app.js", "/vendor/three/three.module.js"]
    for (const path of good) assert.equal((await raw(s.port, { path })).status, 200, path)

    const up = ["..", "../..", "%2e%2e", "..%2f..", "%2e%2e%2f%2e%2e", "..%5c..", "%252e%252e", "....//"]
    const targets = ["secret.txt", "catalog.config.json", "catalog.manifest.json", ".git/config", ".git/HEAD", ".catalog/.gitignore", ".catalog/.local/private.png", "package.json"]
    const prefixes = ["/", "/vendor/", "/vendor/three/", "/vendor/three-addons/", "/media/asset/", "/media/asset/art/", "/media/evidence/", `/media/evidence/${review.id}/${item.id}/`, "/media/before/", `/media/before/${review.id}/${item.id}/`, "/project/preview/", "/project/kind/"]
    const tried: Array<string> = []
    for (const prefix of prefixes) {
      for (const dots of up) {
        for (const target of targets) tried.push(`${prefix}${dots}/${target}`, `${prefix}${dots}%2F${encodeURIComponent(target)}`)
      }
      for (const target of targets) tried.push(`${prefix}${target}`, `${prefix}${encodeURIComponent(target)}`, `${prefix}/${target}`, `${prefix}%00${target}`)
      tried.push(`${prefix}${encodeURIComponent(join(dir, "secret.txt"))}`, `${prefix}file:%2F%2F${encodeURIComponent(join(dir, "secret.txt"))}`)
    }
    for (const path of tried) {
      const answer = await raw(s.port, { path })
      assert.ok([400, 403, 404].includes(answer.status), `${path} answered ${answer.status}`)
      const text = answer.body.toString("latin1")
      assert.ok(!text.includes("TOP-SECRET") && !text.includes("[core]") && !text.includes("ref: refs/") && !text.includes('"adapter"'), `${path} leaked a file`)
    }
    assert.ok(tried.length > 1500, "the matrix was built")
    // Files under the asset roots that are not media, and machine-local state, are no assets either.
    assert.equal((await raw(s.port, { path: asset(".catalog/.local/private.png") })).status, 404)
    assert.equal((await raw(s.port, { path: asset("outside.png") })).status, 404)
    // The page's own folder serves its files and nothing else: no listing, no dotfiles, no other types.
    for (const path of ["/kinds/", "/kinds", "/.gitignore", "/app.css.map", "/app.js/", "/index.html/x"]) assert.equal((await raw(s.port, { path })).status, 404, path)
    // Only script files of the allowed package folders.
    for (const path of ["/vendor/", "/vendor/playwright/index.mjs", "/vendor/three/../package.json", "/vendor/preact/../package.json", "/vendor/effect/Effect.js", "/vendor/three/three.module.js.map"]) {
      assert.equal((await raw(s.port, { path })).status, 404, path)
    }
    // An evidence address is three identifiers; anything else is not an address.
    for (const path of [`/media/evidence/${review.id}`, `/media/evidence/${review.id}/${item.id}`, `/media/evidence/${review.id}/${item.id}/icon/extra`, `/media/before/${review.id}/${item.id}`, `/media/before/${review.id}/${item.id}/nope`]) {
      assert.equal((await raw(s.port, { path })).status, 404, path)
    }
  } finally {
    await s.close()
    cleanup(dir)
  }
})

test("media answers: types from bytes, no sniffing, sandboxed, ranges, and caching by version", async () => {
  const take = tone({ duration: 0.25 })
  const dir = await makeProject({
    assets: { "art/voice.wav": take, "art/older.wav": tone({ duration: 0.25, frequency: 220 }), "art/disguised.png": tone({ duration: 0.1 }) },
    extra: { types: { sound: { label: "Sound", thumb: "audio", fields: [], roles: [{ key: "audio", label: "Take", kinds: ["audio"], many: true }] } } },
    units: [{ id: "sound/hello", type: "sound", name: "Hello", attrs: {}, links: [{ role: "audio", asset: "art/voice.wav" }] }]
  })
  const s = await startServer(dir)
  try {
    const detail = await s.app.run("unit.get", { id: "sound/hello" })
    const url: string = detail.links[0].asset.url
    assert.match(url, /^\/media\/asset\/art%2Fvoice\.wav\?v=[0-9a-f]{16}$/)
    // From audio.test.mjs: the asset is served as what its bytes are, sandboxed, with ranges.
    const response = await raw(s.port, { path: url })
    assert.equal(response.status, 200)
    assert.equal(response.headers["content-type"], "audio/wav")
    assert.equal(response.headers["x-content-type-options"], "nosniff")
    assert.match(String(response.headers["content-security-policy"]), /sandbox/)
    assert.deepEqual(response.body, take)
    const range = await raw(s.port, { path: url, headers: { range: "bytes=0-11" } })
    assert.equal(range.status, 206)
    assert.deepEqual(range.body, take.subarray(0, 12))
    assert.equal(range.headers["content-range"], `bytes 0-11/${take.length}`)
    // New: the other forms of a range, and one that cannot be satisfied.
    const suffix = await raw(s.port, { path: url, headers: { range: "bytes=-4" } })
    assert.deepEqual([suffix.status, suffix.body], [206, take.subarray(take.length - 4)])
    const open = await raw(s.port, { path: url, headers: { range: `bytes=${take.length - 2}-` } })
    assert.deepEqual([open.status, open.headers["content-range"]], [206, `bytes ${take.length - 2}-${take.length - 1}/${take.length}`])
    const past = await raw(s.port, { path: url, headers: { range: `bytes=${take.length}-` } })
    assert.deepEqual([past.status, past.headers["content-range"]], [416, `bytes */${take.length}`])
    const head = await raw(s.port, { method: "HEAD", path: url })
    assert.deepEqual([head.status, head.body.length, head.headers["content-length"], head.headers["content-type"]], [200, 0, String(take.length), "audio/wav"])
    // The address carries the file's version: that answer may be kept for good; any other may not.
    assert.match(String(response.headers["cache-control"]), /immutable/)
    assert.equal((await raw(s.port, { path: asset("art/voice.wav") })).headers["cache-control"], "no-cache")
    assert.equal((await raw(s.port, { path: `${asset("art/voice.wav")}?v=0000000000000000` })).headers["cache-control"], "no-cache")
    // A file whose bytes are not what its name says is never served as its name.
    const disguised = await raw(s.port, { path: asset("art/disguised.png") })
    assert.notEqual(disguised.status, 200)
    // Frozen evidence and a view's before side are served the same way, by their identifiers.
    const submitted = await W(s.app)("review.submit", { items: [{ target: unit("sound/hello"), views: [{ part: "audio:art/voice.wav", caption: "Take", before: { path: "art/older.wav" } }] }] })
    const item = (await s.app.run("review.get", { submission: submitted.submission.id })).items[0]
    const frozen = await raw(s.port, { path: item.parts.find((p: Any) => p.leaves[0].kind === "audio").leaves[0].url })
    assert.deepEqual([frozen.status, frozen.headers["content-type"], frozen.headers["x-content-type-options"]], [200, "audio/wav", "nosniff"])
    assert.match(String(frozen.headers["content-security-policy"]), /sandbox/)
    assert.match(String(frozen.headers["cache-control"]), /immutable/)
    assert.deepEqual(frozen.body, take)
    const before = await raw(s.port, { path: item.views[0].before.url })
    assert.deepEqual([before.status, before.headers["content-type"]], [200, "audio/wav"])
    const frozenRange = await raw(s.port, { path: item.views[0].before.url, headers: { range: "bytes=8-11" } })
    assert.deepEqual([frozenRange.status, frozenRange.body.toString()], [206, "WAVE"])
  } finally {
    await s.close()
    cleanup(dir)
  }
})

test("S1 over HTTP: evidence linked out of .catalog is not served, and an invalid record serves nothing", async () => {
  const dir = await standardProject()
  write(dir, "art/helm.png", png(4, 4, [1, 2, 3, 255])) // dirty: stored as catalog evidence
  const s = await startServer(dir)
  const outside = tmp("cc-outside-")
  try {
    const submitted = await W(s.app)("review.submit", { items: [{ target: unit("armor/helm"), parts: ["icon"] }] })
    const leaf = (await s.app.run("review.get", { submission: submitted.submission.id })).items[0].parts[0].leaves[0]
    assert.equal((await raw(s.port, { path: leaf.url })).status, 200)
    writeFileSync(join(outside, "secret.png"), Buffer.concat([png(2, 2), Buffer.from("SECRET")]))
    const blob = join(dir, `.catalog/evidence/${leaf.sha256.slice(0, 2)}/${leaf.sha256}.png`)
    unlinkSync(blob)
    symlinkSync(join(outside, "secret.png"), blob)
    const linked = await raw(s.port, { path: leaf.url })
    assert.notEqual(linked.status, 200)
    assert.ok(!linked.body.toString("latin1").includes("SECRET"))
    // Tampered bytes under the right name are refused too: every read verifies the digest.
    unlinkSync(blob)
    writeFileSync(blob, Buffer.concat([png(2, 2), Buffer.from("SECRET")]))
    const tampered = await raw(s.port, { path: leaf.url })
    assert.notEqual(tampered.status, 200)
    assert.ok(!tampered.body.toString("latin1").includes("SECRET"))
    // A reference without its digest makes the record invalid: the same address serves nothing.
    writeFileSync(blob, png(4, 4, [1, 2, 3, 255]))
    assert.equal((await raw(s.port, { path: leaf.url })).status, 200, "the intact blob is served again")
    const file = join(dir, `.catalog/reviews/${submitted.submission.id}/submission.json`)
    const record = JSON.parse(readFileSync(file, "utf8"))
    delete record.items[0].parts[0].evidence.sha256
    writeFileSync(file, JSON.stringify(record))
    assert.notEqual((await raw(s.port, { path: leaf.url })).status, 200)
  } finally {
    await s.close()
    cleanup(dir, outside)
  }
})

test("P1 over HTTP: a running server follows the checkout, and a write prepared on another branch is refused", async () => {
  const dir = await standardProject()
  const s = await startServer(dir)
  const call = async (action: string, input: unknown, extra: Record<string, unknown> = {}) => post(s.port, action, { input, ...extra })
  try {
    const main = json(await call("context", {}))
    assert.deepEqual([main.context.branch, main.project, main.resolver], ["main", "Testgame", "latest"])
    // An alternate branch: a different manifest file, units and resolver.
    git(dir, "checkout", "-q", "-b", "alternate")
    write(dir, "alternate.json", { ...read(dir, "catalog.manifest.json"), project: "Alternate", unitFiles: ["alt"] })
    write(dir, "alt/one.json", { id: "armor/helm", type: "armor", name: "Alt Helm", attrs: { slot: "Head" }, links: [{ role: "icon", asset: "art/helm.png" }] })
    write(dir, "catalog.config.json", { version: 1, adapter: "manifest", options: { manifest: "alternate.json" }, review: { resolver: "strictest" } })
    git(dir, "add", "-A")
    git(dir, "commit", "-q", "-m", "alternate")
    const moved = json(await call("context", {}))
    assert.deepEqual([moved.context.branch, moved.project, moved.resolver], ["alternate", "Alternate", "strictest"])
    assert.notEqual(moved.version, main.version, "the page fetches the schema again")
    assert.deepEqual(json(await call("catalog.search", { section: "units" })).items.map((u: Any) => u.name), ["Alt Helm"])
    // What a page still open on main tries to save: refused, with the checkout it is on now.
    const stale = await call("note.create", { target: unit("armor/helm"), body: "Written on main" }, { actor: bot, context: main.context.key })
    assert.equal(stale.status, 409)
    assert.deepEqual([json(stale).error.code, json(stale).error.details.context.branch], ["context_changed", "alternate"])
    assert.equal(json(await call("notes.list", {})).total, 0)
    assert.equal((await call("note.create", { target: unit("armor/helm"), body: "Written here" }, { actor: bot, context: moved.context.key })).status, 200)
    git(dir, "add", "-A")
    git(dir, "commit", "-q", "-m", "note on alternate")
    git(dir, "checkout", "-q", "main")
    const back = json(await call("context", {}))
    assert.deepEqual([back.project, back.resolver, back.version], ["Testgame", "latest", main.version])
  } finally {
    await s.close()
    cleanup(dir)
  }
})

test("project code for the page is served only when declared: preview modules and media kind modules, by name", async () => {
  const dir = await standardProject()
  write(dir, "catalog/previews/lineup.mjs", "export default (ctx) => ctx.html`<p>lineup</p>`\n")
  write(dir, "catalog/previews/undeclared.mjs", "export default () => 'UNDECLARED'\n")
  write(dir, "catalog/secret.mjs", "export const token = 'UNDECLARED'\n")
  write(dir, "catalog/notes.txt", "UNDECLARED")
  const beside = tmp("cc-plugin-")
  writeFileSync(join(beside, "text-kind.js"), "export default (catalog) => catalog.registerMediaKind('text', { viewer: () => null })\n")
  writeFileSync(join(beside, "other.js"), "export const token = 'UNDECLARED'\n")
  const text = definePlugin({
    name: "text",
    // A browser module beside the plugin itself, outside the project: declared by its file URL.
    mediaKinds: [{ id: "text", label: "Text", extensions: ["txt"], sniff: () => null, web: new URL(`file://${join(beside, "text-kind.js")}`).href }],
    previews: { lineup: "catalog/previews/lineup.mjs", gone: "catalog/previews/gone.mjs", notScript: "catalog/notes.txt" }
  })
  write(dir, "catalog.config.json", { version: 2, plugins: ["manifest", "text"] })
  const s = await startServer(dir, { plugins: { text } })
  try {
    // P3 from corrections.test.mjs: a declared module is served as a script; an unknown name is not found.
    const lineup = await raw(s.port, { path: "/project/preview/lineup" })
    assert.equal(lineup.status, 200)
    assert.match(lineup.body.toString(), /lineup/)
    assert.match(String(lineup.headers["content-type"]), /^text\/javascript/)
    assert.equal(lineup.headers["x-content-type-options"], "nosniff")
    assert.equal(lineup.headers["content-security-policy"], "default-src 'none'")
    assert.equal((await raw(s.port, { path: "/project/preview/nope" })).status, 404)
    // The address is a declared name, never a path: files beside a declared module stay unreachable.
    for (const name of ["undeclared", "undeclared.mjs", "catalog/previews/undeclared.mjs", "catalog%2Fpreviews%2Fundeclared.mjs", "..%2Fsecret.mjs", "lineup/../undeclared", "lineup%2F..%2Fundeclared", "constructor", "__proto__", "toString", "gone", "notScript", ""]) {
      const answer = await raw(s.port, { path: `/project/preview/${name}` })
      assert.equal(answer.status, 404, `preview ${name}`)
      assert.ok(!answer.body.toString().includes("UNDECLARED"))
    }
    // A pinned revision is served only while it is the current one.
    const schema = await s.app.run("schema", {})
    const kindUrl: string = schema.mediaKinds.text.web
    assert.match(kindUrl, /^\/project\/kind\/text\?v=[0-9a-f]{16}$/)
    const module = await raw(s.port, { path: kindUrl })
    assert.equal(module.status, 200)
    assert.match(module.body.toString(), /registerMediaKind\('text'/)
    assert.equal((await raw(s.port, { path: "/project/kind/text?v=0000000000000000" })).status, 409)
    assert.equal((await raw(s.port, { path: "/project/preview/lineup?v=0000000000000000" })).status, 409)
    // Kinds that declare no module, and files beside the declared one, are not served.
    for (const name of ["image", "model", "audio", "nope", "other", "other.js", "text%2F..%2Fother.js", "text/other.js", encodeURIComponent(join(beside, "other.js")), "constructor"]) {
      const answer = await raw(s.port, { path: `/project/kind/${name}` })
      assert.equal(answer.status, 404, `kind ${name}`)
      assert.ok(!answer.body.toString().includes("UNDECLARED"))
    }
    assert.equal(schema.mediaKinds.image.web, null)
    // An edit to the declared module moves the schema version, so pages load the new revision.
    writeFileSync(join(beside, "text-kind.js"), "export default (catalog) => catalog.registerMediaKind('text', { viewer: () => 'v2' })\n")
    const edited = await s.app.run("schema", {})
    assert.notEqual(edited.version, schema.version)
    assert.notEqual(edited.mediaKinds.text.web, kindUrl)
    assert.equal((await s.app.run("context", {})).version, edited.version)
    assert.equal((await raw(s.port, { path: kindUrl })).status, 409)
    // A declared module whose file is missing is reported, and offered to no one.
    unlinkSync(join(beside, "text-kind.js"))
    const missing = (await s.app.run("schema", {})).mediaKinds.text
    assert.equal(missing.web, null)
    assert.match(missing.webError, /missing/)
    assert.equal((await raw(s.port, { path: "/project/kind/text" })).status, 404)
  } finally {
    await s.close()
    cleanup(dir, beside)
  }
})

test("Server binds to loopback only and frees its port when closed", async () => {
  const dir = await standardProject()
  const s = await startServer(dir)
  try {
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
    // Nothing answers on this machine's other addresses.
    const { networkInterfaces } = await import("node:os")
    const others = Object.values(networkInterfaces()).flatMap((list) => list ?? []).filter((entry) => entry.family === "IPv4" && !entry.internal).map((entry) => entry.address)
    for (const address of others) {
      await assert.rejects(fetch(`http://${address}:${s.port}/api/health`, { signal: AbortSignal.timeout(1500) }), `nothing listens on ${address}`)
    }
    // A second server cannot take the same port, and says so.
    await assert.rejects(startServer(dir, { port: s.port }), /could not listen on 127\.0\.0\.1:\d+.*EADDRINUSE/s)
  } finally {
    await s.close()
  }
  await assert.rejects(fetch(s.url), "closing the server stops it listening")
  cleanup(dir)
})
