import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { chmodSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { Executables } from "../../src/kernel/Executable.ts"
import { balanceText, readFailure } from "../../src/jam/providers/balance.ts"
import { Providers } from "../../src/jam/providers/Providers.ts"
import { openJob } from "../../src/jam/runs/jobs.ts"
import { capProblem, committed, spendState } from "../../src/jam/providers/spend.ts"
import type { Job } from "../../src/jam/runs/schema.ts"
import { cli, jam, jamFailure, jamProject, write } from "./fixtures.ts"
import { AGENT_MODE, start } from "./flow.ts"

const descriptor = (id: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id, label: `Provider ${id}`, unit: { id: "tokens", label: "test tokens", paid: true }, capabilities: { mesh: {} }, transports: [], ...extra })
const balance = (root: string, id: string) => jam(root, Effect.flatMap(Providers, (providers) => providers.balance(id)))
const probe = (root: string, id: string) => jam(root, Effect.flatMap(Providers, (providers) => providers.probe(id)))
const NODE = process.execPath

describe("the provider registry", () => {
  it("ships descriptors as data and lets a project add or replace one; an unconfigured provider is simply disabled", async () => {
    const root = jamProject({ files: { "jam/providers/acme.json": descriptor("acme"), "jam/providers/meshy.json": descriptor("meshy", { label: "Our Meshy account" }) } })
    const entries = await jam(root, Effect.flatMap(Providers, (providers) => providers.list))
    assert.deepEqual(entries.map((entry) => [entry.descriptor.id, entry.source]), [["acme", "project"], ["agent-image", "shipped"], ["codex", "shipped"], ["elevenlabs", "shipped"], ["meshy", "project"], ["motionbricks", "shipped"], ["scenario", "shipped"], ["tripo", "shipped"]])
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

describe("balances", () => {
  // A stand-in for a provider's program: prints the answer named by its first argument.
  const STUB = `const answers = {
    credits: { result: { balance: 12, monthly: 10, permanent: 2, resets: 1798156800000 } },
    plan: { used: 300, limit: 1000, renews: 1798156800 },
    nofigure: { result: {} }
  }
  const [what] = process.argv.slice(2)
  if (what === "signedout") { console.error("error: no credentials found"); process.exit(3) }
  // Programs that print their error as JSON on standard output only, over several lines.
  const fail = (error, code) => { console.log(JSON.stringify({ ok: false, error }, null, 2)); process.exit(code) }
  if (what === "jsonsignedout") fail({ code: "auth", message: "Invalid API key k3yAbCdEfGhIjKlMnOpQrStUv12345" }, 3)
  if (what === "unknowncmd") fail({ code: 400, reason: "validationError", message: "unrecognized subcommand 'credits'" }, 2)
  if (what === "busy") fail({ code: "server", message: "upstream timed out" }, 1)
  if (what === "notfound") process.exit(127)
  if (what === "okerror") { console.log(JSON.stringify({ error: { code: 401, message: "Access denied" } })); process.exit(0) }
  if (what === "--version") console.log("stub 0.1.0")
  else if (what === "text") console.log("Balance: 12")
  else console.log(JSON.stringify(answers[what]))`
  const cliRead = (args: Array<string>, read: Record<string, unknown> = { remaining: "result.balance" }) => ({ kind: "cli", command: NODE, balance: { args: ["stub.mjs", ...args], ...read } })

  it("reads what is left through the provider's own free call, by the paths its descriptor names, and says why when it cannot", async () => {
    const root = jamProject({
      files: {
        "stub.mjs": STUB,
        "jam/providers/credits.json": descriptor("credits", { transports: [cliRead(["credits"], { remaining: "result.balance", parts: { monthly: "result.monthly", permanent: "result.permanent", absent: "result.none" }, resets: "result.resets", resetsAs: "unix-ms" })] }),
        "jam/providers/plan.json": descriptor("plan", { transports: [cliRead(["plan"], { used: "used", limit: "limit", resets: "renews", resetsAs: "unix-s" })] }),
        "jam/providers/signedout.json": descriptor("signedout", { transports: [cliRead(["signedout"])] }),
        "jam/providers/text.json": descriptor("text", { transports: [cliRead(["text"])] }),
        "jam/providers/nofigure.json": descriptor("nofigure", { transports: [cliRead(["nofigure"])] }),
        "jam/providers/absent.json": descriptor("absent", { transports: [{ kind: "cli", command: "bin/not-there", balance: { args: ["balance"], remaining: "balance" } }] }),
        "jam/providers/session.json": descriptor("session", { transports: [cliRead(["signedout"]), { kind: "mcp", server: "acme", balance: { tool: "usage_get", note: "consumption only" } }] }),
        "jam/providers/either.json": descriptor("either", { transports: [{ kind: "mcp", server: "acme", balance: { tool: ["limit_get", "usage_get"] } }] }),
        "jam/providers/unread.json": descriptor("unread", { docs: "docs/acme.md" }),
        "jam/providers/included.json": descriptor("included", { unit: { id: "plan", label: "a plan the person pays for", paid: false } })
      }
    })
    const credits = await balance(root, "credits")
    assert.deepEqual([credits.state, credits.remaining, credits.parts, credits.resets], ["read", 12, { monthly: 10, permanent: 2 }, "2026-12-25T00:00:00.000Z"])
    assert.equal(balanceText(credits), "12 tokens left (monthly 10, permanent 2), renews 2026-12-25")
    assert.match(credits.detail, /free call that also proves the account is signed in and the service answers/)
    const plan = await balance(root, "plan")
    assert.deepEqual([plan.remaining, plan.used, plan.limit, plan.resets], [700, 300, 1000, "2026-12-25T00:00:00.000Z"])
    assert.equal(balanceText(plan), "700 tokens left of 1000, renews 2026-12-25")
    const signedOut = await balance(root, "signedout")
    assert.equal(signedOut.state, "failed")
    assert.deepEqual([signedOut.failure, credits.failure], ["not signed in", null])
    assert.match(signedOut.detail, /stub\.mjs signedout exit 3, not signed in: error: no credentials found$/)
    assert.match((await balance(root, "text")).detail, /ran, but it did not print JSON \(Balance: 12\)/)
    assert.match((await balance(root, "nofigure")).detail, /no number at result\.balance/)
    assert.match((await balance(root, "absent")).detail, /is not installed \(ENOENT\)/)
    const session = await balance(root, "session")
    assert.deepEqual([session.state, session.via], ["session", "usage_get on MCP server acme"])
    assert.match(session.detail, /^read in the agent session: call usage_get on MCP server acme; consumption only; unread: .*signedout exit 3/)
    const either = await balance(root, "either")
    assert.deepEqual([either.state, either.via], ["session", "limit_get or usage_get on MCP server acme"])
    assert.match(either.detail, /call the first of limit_get, usage_get that this session lists for MCP server acme/)
    assert.match((await balance(root, "unread")).detail, /^no balance read: the descriptor names none; .*\(docs\/acme\.md\)/)
    assert.deepEqual([(await balance(root, "included")).state, (await balance(root, "included")).detail], ["none", "no balance: not billed per job (a plan the person pays for)"])

    const shown = cli(root, "provider", "balance", "credits", "included", "--json").json<{ providers: Array<{ id: string; state: string }> }>().providers
    assert.deepEqual(shown.map((row) => [row.id, row.state]), [["credits", "read"], ["included", "none"]])
    assert.match(cli(root, "provider", "balance", "credits").stdout, /credits {2,}test tokens {2,}12 tokens left \(monthly 10, permanent 2\), renews 2026-12-25 {2,}.*stub\.mjs credits/)
    assert.match(cli(root, "provider", "balance", "ghost").stderr, /provider ghost is not known/)
  })

  it("a failed read says why from the program's own answer: its JSON error, a command it does not know, a launcher that is missing; never a key", async () => {
    const reads = ["jsonsignedout", "unknowncmd", "busy", "notfound", "okerror"]
    const root = jamProject({
      files: {
        "stub.mjs": STUB,
        ...Object.fromEntries(reads.map((what) => [`jam/providers/${what}.json`, descriptor(what, { transports: [{ ...cliRead([what]), probe: ["stub.mjs", "--version"] }] })]))
      }
    })
    const read = Object.fromEntries(await Promise.all(reads.map(async (what) => [what, await balance(root, what)] as const)))
    assert.deepEqual(reads.map((what) => read[what]!.failure), ["not signed in", "outdated", "unanswered", "not installed", "not signed in"])
    assert.match(read["jsonsignedout"]!.detail, /exit 3, not signed in: auth: Invalid API key \[redacted\]$/)
    assert.doesNotMatch(JSON.stringify(read), /k3yAbCdEf/)
    assert.match(read["unknowncmd"]!.detail, /is not a read this .* knows \(version stub 0\.1\.0: 400: validationError: unrecognized subcommand 'credits'\); it may be older than this read needs: update it/)
    assert.match(read["busy"]!.detail, /exit 1: server: upstream timed out; the program did not say why, so the service may not have answered/)
    assert.match(read["notfound"]!.detail, /is not installed \(exit 127, command not found\)/)
    assert.match(read["okerror"]!.detail, /ran, but its answer has no number at result\.balance.* \(it reported 401: Access denied\)/)
    // cmd.exe's exit for a command it cannot find, as a Windows npm launcher gives it.
    assert.equal(readFailure({ error: "exit 9009", output: "'meshy' is not recognized as an internal or external command", stdout: "" }).failure, "not installed")
    assert.equal(readFailure({ error: "ENOENT", output: null, stdout: "" }).failure, "not installed")
  })

  it("a descriptor's balance read is checked: a program's read names its arguments and a figure, a server's names its tool", async () => {
    const bad = (transport: Record<string, unknown>) => {
      const root = jamProject({ files: { "jam/providers/bad.json": descriptor("bad", { transports: [transport] }) } })
      return jamFailure(root, Effect.flatMap(Providers, (providers) => providers.list)).then((error) => error.message)
    }
    assert.match(await bad({ kind: "cli", command: "x", balance: { remaining: "balance" } }), /a cli balance read needs args/)
    assert.match(await bad({ kind: "cli", command: "x", balance: { args: ["balance"], used: "used" } }), /names remaining, or used and limit/)
    assert.match(await bad({ kind: "mcp", server: "x", balance: { note: "n" } }), /an mcp balance read needs tool/)
    assert.match(await bad({ kind: "skill", name: "x", balance: { tool: "t" } }), /reached through a cli or mcp transport/)
  })

  it("the shipped providers read their balances with their own programs' documented free calls, and those without one say why", { skip: process.platform === "win32" }, async () => {
    // Each stand-in answers only the exact free read its descriptor declares, in the shape that program prints.
    const program = (expected: string, answer: unknown) => `#!/bin/sh\nif [ "$*" = "${expected}" ]; then echo '${JSON.stringify(answer)}'; else echo "unexpected: $*" >&2; exit 9; fi\n`
    const root = jamProject({
      config: { routes: { mesh: "meshy" } },
      files: {
        "bin/meshy": program("balance --format json --no-update-check", { ok: true, result: { balance: 812, monthly_credits: 800, permanent_credits: 12, monthly_resets_at: 1798156800000 } }),
        "bin/tripo": program("balance --json", { balance: 40, frozen: 5 }),
        "bin/elevenlabs": program("user subscription get --format json", { tier: "creator", character_count: 4000, character_limit: 30000, next_character_count_reset_unix: 1798156800 }),
        "jam.local.json": JSON.stringify({ providers: { meshy: "bin/meshy", tripo: "bin/tripo", elevenlabs: "bin/elevenlabs" } })
      }
    })
    for (const name of ["meshy", "tripo", "elevenlabs"]) chmodSync(join(root, "bin", name), 0o755)
    const rows = cli(root, "provider", "balance", "--json").json<{ providers: Array<{ id: string; state: string; remaining: number | null; parts: Record<string, number>; resets: string | null; detail: string }> }>().providers
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
    assert.deepEqual([byId["meshy"]!.remaining, byId["meshy"]!.parts, byId["meshy"]!.resets], [812, { monthly: 800, permanent: 12 }, "2026-12-25T00:00:00.000Z"])
    assert.deepEqual([byId["tripo"]!.remaining, byId["tripo"]!.parts], [40, { "held by running tasks": 5 }])
    assert.deepEqual([byId["elevenlabs"]!.remaining, byId["elevenlabs"]!.resets], [26000, "2026-12-25T00:00:00.000Z"])
    assert.deepEqual([byId["scenario"]!.state, (byId["scenario"] as unknown as { via: string }).via], ["session", "consumption_limit_get or usage on MCP server scenario"])
    for (const id of ["agent-image", "codex", "motionbricks"]) assert.match(byId[id]!.detail, /^no balance: not billed per job \(/, id)
    const mesh = cli(root, "provider", "balance", "--capability", "mesh", "--json").json<{ providers: Array<{ id: string }> }>().providers
    assert.deepEqual(mesh.map((row) => row.id), ["meshy", "scenario", "tripo"])
  })
})

describe("listing for a capability", () => {
  it("filters by capability, refuses one no provider serves, and shows what the project's runs have committed to each paid provider", async () => {
    const root = jamProject({ config: { ...AGENT_MODE, routes: { mesh: "tripo" } }, files: { "work/requests/r.json": "{}" } })
    await start(root, "asset", "barrel", { budget: "prop" })
    await jam(root, openJob({ run: "barrel", step: "concept", provider: "meshy", operation: "text to image", estimate: 7, request: "work/requests/r.json", price: "estimate", priceSource: "dry run", authorized: "Sam: yes" }))
    const listed = cli(root, "provider", "list", "--capability", "mesh", "--json").json<{ providers: Array<{ id: string; routes: Array<string>; spend: { used: number | null } }> }>().providers
    assert.deepEqual(listed.map((row) => [row.id, row.routes, row.spend.used]), [["meshy", [], 7], ["scenario", [], 0], ["tripo", ["mesh"], 0]])
    assert.match(cli(root, "provider", "list", "--capability", "mesh").stdout, /meshy .*per run 10, total 25 Meshy credits; 7 committed/)
    assert.equal(cli(root, "provider", "list", "--capability", "image", "--json").json<{ providers: Array<{ id: string; spend: { used: number | null } }> }>().providers.find((row) => row.id === "codex")!.spend.used, null)
    const refused = cli(root, "provider", "list", "--capability", "teleport")
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /no provider serves teleport\n.*fix: capabilities the known providers serve: image, mesh, motion, sound, voice/)
  })

  it("probes several providers at once; one id keeps its own object unless --each asks for the list", () => {
    const root = jamProject()
    const many = cli(root, "provider", "probe", "agent-image", "motionbricks", "--json").json<{ providers: Array<{ id: string }> }>().providers
    assert.deepEqual(many.map((row) => row.id), ["agent-image", "motionbricks"])
    assert.equal(cli(root, "provider", "probe", "agent-image", "--json").json<{ id: string }>().id, "agent-image")
    for (const ids of [["agent-image"], ["agent-image", "motionbricks"]]) {
      assert.deepEqual(cli(root, "provider", "probe", "--each", ...ids, "--json").json<{ providers: Array<{ id: string }> }>().providers.map((row) => row.id), ids)
    }
  })
})
