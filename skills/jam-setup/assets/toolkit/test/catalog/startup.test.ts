// Data commands stay fast because they load little: the HTTP stack and the browser driver are
// imported only by a command that serves. Stated as which modules a command loads, so a stray
// static import fails here on any machine instead of showing up as a slow CLI.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { type AddressInfo, createServer } from "node:net"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { cleanup, standardProject, tmp } from "./helpers.ts"

const CLI = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
const TRACE = fileURLToPath(new URL("./trace-imports.ts", import.meta.url))
const AMBIENT = ["CATALOG_ACTOR_KIND", "CATALOG_ACTOR_NAME", "JAM_ROOT", "JAM_JSON"]

/** The modules one command loaded, as URLs. */
const loadedBy = (dir: string, ...args: ReadonlyArray<string>): { readonly status: number | null; readonly modules: ReadonlyArray<string>; readonly stderr: string } => {
  const out = tmp("cc-trace-")
  const file = join(out, "imports.txt")
  const result = spawnSync(process.execPath, ["--import", TRACE, CLI, "catalog", ...args, "--root", dir], {
    encoding: "utf8",
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !AMBIENT.includes(key))), TRACE_IMPORTS: file },
    timeout: 120_000
  })
  const modules = [...new Set(readFileSync(file, "utf8").split("\n").filter(Boolean))]
  cleanup(out)
  return { status: result.status, modules, stderr: result.stderr }
}

// (Node's platform services load three small header and URL helpers from effect/http on their own.)
const HTTP = /\/effect\/dist\/http\/Http(Server|Router|Effect|Platform|StaticServer|Middleware|IncomingMessage)|\/platform-node\/dist\/NodeHttp|\/src\/catalog\/server\/(http|app|Server|Renderer|programs|files|security)\.ts$/
const BROWSER = /\/playwright(-core)?\//
const SAMPLE = /\/examples\/hollowmere\/|\/three\//

test("data commands and the server's own bookkeeping load neither the HTTP stack nor a browser driver", async () => {
  const dir = await standardProject()
  const commands: ReadonlyArray<ReadonlyArray<string>> = [
    ["actions"],
    ["run", "catalog.search", "--input", '{"q":"helm"}'],
    ["run", "unit.get", "--input", '{"id":"armor/helm"}'],
    ["todo"],
    ["doctor"],
    ["status"],
    ["stop"]
  ]
  for (const command of commands) {
    const { modules, status, stderr } = loadedBy(dir, ...command)
    assert.equal(status, 0, `${command.join(" ")}: ${stderr}`)
    assert.ok(modules.some((url) => url.endsWith("/src/catalog/Catalog.ts")), "the trace saw the command load")
    for (const [what, pattern] of [["the HTTP stack", HTTP], ["the browser driver", BROWSER], ["the sample generator", SAMPLE]] as const) {
      assert.deepEqual(modules.filter((url) => pattern.test(url)), [], `catalog ${command[0]} loaded ${what}`)
    }
  }
  // The barrel would bring in all of Effect: only deep imports are used.
  const everything = loadedBy(dir, "actions").modules
  assert.deepEqual(everything.filter((url) => /\/effect\/dist\/index\.js$/.test(url)), [])
  cleanup(dir)
})

test("a command that serves loads the HTTP stack when it runs, and still no browser until a viewer is opened", async () => {
  const dir = await standardProject()
  // A port that is taken: the server is built and fails at once, with nothing left running.
  const holder = createServer()
  await new Promise<void>((listening) => holder.listen(0, "127.0.0.1", listening))
  const { modules, status } = loadedBy(dir, "serve", "--port", String((holder.address() as AddressInfo).port))
  await new Promise((closed) => holder.close(closed))
  assert.equal(status, 1)
  assert.ok(modules.some((url) => /\/effect\/dist\/http\/HttpServer\.js$/.test(url)), "serve loaded the HTTP stack")
  assert.ok(modules.some((url) => url.endsWith("/src/catalog/server/Server.ts")))
  assert.deepEqual(modules.filter((url) => BROWSER.test(url)), [], "the browser driver is imported with the first viewer.open")
  cleanup(dir)
})
