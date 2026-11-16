// Ported from the version 1 engine: the manifest source, and that the catalog engine loads
// nothing of the jam code or of a browser or HTTP stack. The two jam-adapter tests of the original
// file wait for the package that ports the jam source.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { cleanup, open, standardProject, tmp, write } from "./helpers.ts"

const engine = (relative: string): string => new URL(`../../src/${relative}`, import.meta.url).href

test("T23 the generic core loads no game- or toolkit-specific modules with the manifest adapter", async () => {
  const dir = await standardProject()
  // The engine is opened the way `open()` in helpers.ts opens it, in a process of its own whose
  // module resolutions are recorded. The script lives outside the toolkit, so everything it loads
  // is named by absolute URL.
  const scratch = tmp("cc-load-")
  const script = `
    import { registerHooks } from 'node:module';
    const seen = [];
    registerHooks({ resolve(s, c, next) { const r = next(s, c); seen.push(r.url); return r; } });
    const Effect = await import(${JSON.stringify(import.meta.resolve("effect/Effect"))});
    const Layer = await import(${JSON.stringify(import.meta.resolve("effect/Layer"))});
    const ManagedRuntime = await import(${JSON.stringify(import.meta.resolve("effect/ManagedRuntime"))});
    const { Catalog } = await import(${JSON.stringify(engine("catalog/Catalog.ts"))});
    const { Git } = await import(${JSON.stringify(engine("kernel/Git.ts"))});
    const { Ids } = await import(${JSON.stringify(engine("kernel/Ids.ts"))});
    const { Process } = await import(${JSON.stringify(engine("kernel/Process.ts"))});
    const { ProjectFiles } = await import(${JSON.stringify(engine("kernel/ProjectFiles.ts"))});
    const kernel = Layer.mergeAll(Git.layerNoDeps, Ids.layer).pipe(Layer.provideMerge(Layer.mergeAll(ProjectFiles.layer(${JSON.stringify(dir)}), Process.layer)));
    const runtime = ManagedRuntime.make(Catalog.layerWith({}).pipe(Layer.provide(kernel), Layer.provide(Layer.empty)));
    const run = (action, input) => runtime.runPromise(Effect.flatMap(Catalog, (catalog) => catalog.run(action, input)));
    await run('catalog.search', { section: 'units' });
    await run('unit.get', { id: 'armor/helm' });
    await runtime.dispose();
    console.log(JSON.stringify(seen));`
  const file = join(scratch, "load.mjs")
  writeFileSync(file, script)
  try {
    const out = spawnSync(process.execPath, [file], { encoding: "utf8" })
    assert.equal(out.status, 0, out.stderr)
    const urls: Array<string> = JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "")
    // Was `/src/adapters/manifest.mjs`: the manifest adapter is now the built-in manifest plugin.
    assert.ok(urls.some((u) => u.includes("/src/catalog/plugins/manifest.ts")))
    // Was the jam tool folder and its adapter: the jam code now lives in src/jam.
    const loaded = (pattern: RegExp): Array<string> => [...new Set(urls.filter((u) => pattern.test(u)))]
    assert.deepEqual(loaded(/\/src\/jam\/|three|preact|playwright/i), [], "no jam or browser module is loaded")
    // New with this engine: its data commands load no HTTP module either.
    // effect/Schema itself imports its Cookie/Headers/UrlParams schemas from effect/http, so the
    // check names the server stack: Node's http, Effect's HTTP server and the platform bindings.
    assert.deepEqual(loaded(/^node:https?$|\/unstable\/http\/|platform-node/i), [], "no HTTP server module is loaded")
  } finally {
    cleanup(dir, scratch)
  }
})

test("Manifest adapter: project collections, aliases, explanations and per-file problems", async () => {
  const dir = await standardProject()
  write(dir, "content/bad.json", '{"id": 1}')
  write(dir, "content/dup.json", { id: "armor/helm", type: "armor", name: "Dup" })
  write(dir, "content/unknown.json", { id: "x/y", type: "vehicle", name: "Car" })
  const app = await open(dir)
  const problems: Array<string> = (await app.run("problems", {})).problems.map((p: { source: string; error: string }) => `${p.source}: ${p.error}`)
  assert.ok(problems.some((p) => /duplicate content id armor\/helm/.test(p)))
  assert.ok(problems.some((p) => /unknown type vehicle/.test(p)))
  assert.ok(problems.some((p) => /content\/bad\.json/.test(p)))
  assert.equal((await app.run("unit.get", { id: "armor/helm" })).unit.name, "Iron Helm")
  const col = await app.run("collection.get", { id: "outfit/iron" })
  // A collection defined by a source still reports the owner as "adapter".
  assert.equal(col.collection.owner, "adapter")
  assert.equal(col.preview.module, "assembled-mesh")
  assert.equal(col.preview.members.length, 2)
  cleanup(dir)
})
