import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { chmodSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { Executables } from "../../src/kernel/Executable.ts"
import { Providers } from "../../src/jam/providers/Providers.ts"
import { capProblem, committed, spendState } from "../../src/jam/providers/spend.ts"
import type { Job } from "../../src/jam/runs/schema.ts"
import { cli, jam, jamFailure, jamProject, write } from "./fixtures.ts"

const descriptor = (id: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id, label: `Provider ${id}`, unit: { id: "tokens", label: "test tokens", paid: true }, capabilities: { mesh: {} }, transports: [], ...extra })
const probe = (root: string, id: string) => jam(root, Effect.flatMap(Providers, (providers) => providers.probe(id)))
const NODE = process.execPath

describe("the provider registry", () => {
  it("ships descriptors as data and lets a project add or replace one; an unconfigured provider is simply disabled", async () => {
    const root = jamProject({ files: { "jam/providers/acme.json": descriptor("acme"), "jam/providers/meshy.json": descriptor("meshy", { label: "Our Meshy account" }) } })
    const entries = await jam(root, Effect.flatMap(Providers, (providers) => providers.list))
    assert.deepEqual(entries.map((entry) => [entry.descriptor.id, entry.source]), [["acme", "project"], ["agent-image", "shipped"], ["codex", "shipped"], ["elevenlabs", "shipped"], ["meshy", "project"], ["scenario", "shipped"], ["tripo", "shipped"]])
    const listed = cli(root, "provider", "list", "--json").json<{ providers: Array<{ id: string; label: string; routes: Array<string>; spend: { enabled: boolean; summary: string } }> }>().providers
    const byId = Object.fromEntries(listed.map((row) => [row.id, row]))
    assert.equal(byId["meshy"]!.label, "Our Meshy account")
    assert.deepEqual([byId["meshy"]!.spend.enabled, byId["meshy"]!.spend.summary], [true, "per run 10, total 25 test tokens"])
    assert.deepEqual([byId["acme"]!.spend.enabled, byId["acme"]!.spend.summary], [false, "paid work disabled (no spend entry)"])
    assert.deepEqual([byId["codex"]!.spend.enabled, byId["codex"]!.spend.summary], [true, "not billed per job (ChatGPT plan allowance)"])
    const unknown = await jamFailure(root, Effect.flatMap(Providers, (providers) => providers.get("ghost")))
    assert.match(unknown.fix!, /use one of: acme, .*jam\/providers\/ghost\.json/)
    write(root, "jam/providers/bad.json", JSON.stringify({ id: "bad", label: "Bad", unit: { id: "x", label: "x", paid: true }, capabilities: {}, transports: [{ kind: "cli" }], price: 3 }))
    const invalid = await jamFailure(root, Effect.flatMap(Providers, (providers) => providers.list))
    assert.match(invalid.message, /jam\/providers\/bad\.json: .*price: expected no excess property/)
    assert.match(invalid.message, /transports\[0\]: a cli transport needs command/)
  })

  it("the shipped descriptors state pacing and quote facts the provider documents give, and leave out what they do not", async () => {
    const entries = await jam(jamProject(), Effect.flatMap(Providers, (providers) => providers.list))
    const byId = Object.fromEntries(entries.map((entry) => [entry.descriptor.id, entry.descriptor]))
    assert.deepEqual(byId["scenario"]!.pacing?.concurrent, 1)
    assert.match(byId["scenario"]!.pacing!.retryAfter!, /429/)
    assert.equal(byId["scenario"]!.quote!.kind, "exact")
    assert.deepEqual(byId["tripo"]!.capabilities["mesh"]!.inputs, { min: 2, max: 4 })
    assert.equal(byId["meshy"]!.quote!.kind, "estimate")
    assert.equal(byId["elevenlabs"]!.pacing, undefined, "nothing is stated about its pacing, so nothing is claimed")
    assert.deepEqual([byId["codex"]!.unit.paid, byId["agent-image"]!.unit.paid], [false, false])
  })
})

describe("probing", () => {
  it("reports installed, authenticated and reachable separately, and says unknown where the toolkit cannot see", async () => {
    const root = jamProject({
      files: {
        ".mcp.json": JSON.stringify({ mcpServers: { "listed-server": {} } }),
        ".agents/skills/acme-skill/SKILL.md": "---\nname: acme-skill\n---\n",
        "tool.mjs": `const [flag] = process.argv.slice(2); if (flag === "--version") console.log("acme 3.1.4"); else if (flag === "whoami") { console.error("not signed in"); process.exit(1) } else if (flag === "ping") console.log("pong")`,
        "jam.local.json": JSON.stringify({ providers: { missing: "bin/not-there" } }),
        "jam/providers/working.json": descriptor("working", { transports: [{ kind: "cli", command: NODE, probe: ["tool.mjs", "--version"], auth: ["tool.mjs", "whoami"], reach: ["tool.mjs", "ping"] }] }),
        "jam/providers/bare.json": descriptor("bare", { transports: [{ kind: "cli", command: NODE }] }),
        "jam/providers/missing.json": descriptor("missing", { transports: [{ kind: "cli", command: "anything" }] }),
        "jam/providers/harness.json": descriptor("harness", { transports: [{ kind: "mcp", server: "listed-server" }, { kind: "mcp", server: "elsewhere" }, { kind: "skill", name: "acme-skill" }, { kind: "skill", name: "absent-skill" }, { kind: "browser" }] })
      }
    })
    const working = await probe(root, "working")
    assert.deepEqual([working.installed.state, working.authenticated.state, working.reachable.state], ["yes", "no", "yes"])
    assert.match(working.installed.detail, /acme 3\.1\.4/)
    assert.match(working.authenticated.detail, /not signed in/)
    const bare = await probe(root, "bare")
    assert.deepEqual([bare.installed.state, bare.authenticated.state, bare.reachable.state], ["yes", "unknown", "unknown"])
    assert.match(bare.authenticated.detail, /names no sign-in check; .*free authenticated call in the agent session/)
    const missing = await probe(root, "missing")
    assert.deepEqual([missing.installed.state, missing.authenticated.state], ["no", "unknown"])
    assert.match(missing.installed.detail, new RegExp(`${join(root, "bin/not-there").replaceAll("/", "\\/")} did not run \\(ENOENT\\)`), "this machine's path for the provider is used")
    const harness = await probe(root, "harness")
    assert.deepEqual(harness.transports.map((transport) => [transport.kind, transport.target, transport.installed.state]), [
      ["mcp", "listed-server", "yes"], ["mcp", "elsewhere", "unknown"], ["skill", "acme-skill", "yes"], ["skill", "absent-skill", "unknown"], ["browser", "the provider's site", "unknown"]
    ])
    assert.equal(harness.authenticated.state, "unknown")
    const text = cli(root, "provider", "probe", "working").stdout
    assert.match(text, /installed {6}yes .*\nauthenticated {2}no .*\nreachable {6}yes/)
  })

  it("probes a Windows npm launcher through cmd.exe with a fixed command line, and refuses a path cmd.exe would interpret", async () => {
    const windows = Executables.layerFor("win32")
    const refused = await Effect.runPromise(Effect.flatMap(Executables, (executables) => executables.probe("C:\\tools\\a&b\\meshy.cmd", ["--version"], { npmLauncher: true })).pipe(Effect.provide(windows)))
    assert.deepEqual([refused.installed, refused.error], [false, "the executable path or its probe arguments contain characters cmd.exe would interpret"])
    const injected = await Effect.runPromise(Effect.flatMap(Executables, (executables) => executables.probe("meshy.cmd", ["--version; calc"], { npmLauncher: true })).pipe(Effect.provide(windows)))
    assert.equal(injected.installed, false)
    assert.equal((await Effect.runPromise(Effect.flatMap(Executables, (executables) => Effect.succeed(executables.defaultPython)).pipe(Effect.provide(windows)))), "python")
    // A launcher in a folder with spaces works where the platform runs it directly.
    if (process.platform !== "win32") {
      const root = jamProject({ files: { "my tools/launcher": `#!/bin/sh\necho "launcher 1.0"\n` } })
      chmodSync(join(root, "my tools/launcher"), 0o755)
      const probed = await Effect.runPromise(Effect.flatMap(Executables, (executables) => executables.probe(join(root, "my tools/launcher"), ["--version"], { npmLauncher: true })).pipe(Effect.provide(Executables.layer)))
      assert.deepEqual([probed.installed, probed.output], [true, "launcher 1.0"])
    }
  })
})

describe("spend rules", () => {
  const paid = JSON.parse(descriptor("acme")) as Parameters<typeof spendState>[0]
  const job = (state: Job["state"], estimate: number, actual?: number): Job => ({ id: "j", step: "s", provider: "acme", operation: "o", request: { path: "r", sha256: "h" }, estimate, unit: "tokens", price: { kind: "estimate", source: "s", date: "d" }, authorization: "a", state, created: "c", history: [], ...(actual === undefined ? {} : { actual }) })

  it("absent or zero means disabled; null means no cap; what is committed is actual charges plus estimates still at risk", () => {
    assert.equal(spendState(paid, undefined).enabled, false)
    assert.equal(spendState(paid, { perRun: 0, total: null }).enabled, false)
    assert.equal(spendState(paid, { perRun: 5, total: 0 }).enabled, false)
    assert.deepEqual([spendState(paid, { perRun: null, total: null }).enabled, spendState(paid, { perRun: null, total: null }).summary], [true, "per run no cap, total no cap test tokens"])
    assert.equal(spendState(paid, { perRun: 1, total: null, standing: "Sam: within one token" }).standing, "Sam: within one token")
    const jobs = [job("open", 5), job("lost", 3), job("submitted", 2), job("succeeded", 10, 12), job("failed", 4, 1), job("cancelled", 6, 0), job("not-submitted", 9, 0)]
    assert.equal(committed(jobs, "acme"), 5 + 3 + 2 + 12 + 1 + 0 + 0)
    assert.equal(committed(jobs, "other"), 0)
    const ask = (spend: Parameters<typeof capProblem>[0]["spend"], estimate: number, all = jobs) => capProblem({ descriptor: paid, spend, estimate, runJobs: jobs, allJobs: all })?.message ?? null
    assert.equal(ask({ perRun: 30, total: null }, 7), null)
    assert.match(ask({ perRun: 30, total: null }, 8)!, /would take the run to 31 test tokens, over the per-run cap of 30/)
    assert.match(ask({ perRun: null, total: 50 }, 5, [...jobs, ...jobs])!, /would take all runs to 51 test tokens, over the total cap of 50/)
    assert.equal(ask({ perRun: null, total: null }, 1e9), null)
    assert.equal(capProblem({ descriptor: { ...paid, unit: { ...paid.unit, paid: false } }, spend: undefined, estimate: 5, runJobs: [], allJobs: [] }), null)
  })
})
