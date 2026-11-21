// The provider registry: descriptors the toolkit ships and those the project adds, and a probe
// that says what is installed, signed in and reachable without guessing any of the three.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { decode } from "../../kernel/decode.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { Executables } from "../../kernel/Executable.ts"
import { isRecord } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Config } from "../config/Config.ts"
import { PROVIDERS_DIR } from "../layout.ts"
import { Toolkit } from "../Toolkit.ts"
import { type Balance, parseBalance } from "./balance.ts"
import { Descriptor, type Transport } from "./schema.ts"

export interface ProviderEntry {
  readonly descriptor: Descriptor
  readonly source: "shipped" | "project"
  readonly path: string
}

export interface Finding {
  readonly state: "yes" | "no" | "unknown"
  readonly detail: string
}

export interface TransportProbe {
  readonly kind: Transport["kind"]
  readonly target: string
  readonly installed: Finding
  readonly authenticated: Finding
  readonly reachable: Finding
}

export interface ProviderProbe {
  readonly id: string
  readonly label: string
  readonly installed: Finding
  readonly authenticated: Finding
  readonly reachable: Finding
  readonly transports: ReadonlyArray<TransportProbe>
}

const HARNESS = "configured in the agent harness, which the toolkit cannot see; call one of its free tools in the agent session"
const SESSION = "the toolkit holds no credentials and makes no network calls; a free authenticated call in the agent session proves it"
const unknown = (detail: string): Finding => ({ state: "unknown", detail })

// The strongest thing known across transports: one that works is enough; "no" needs every one to say no.
const overall = (findings: ReadonlyArray<Finding>): Finding =>
  findings.find((finding) => finding.state === "yes") ??
    (findings.length > 0 && findings.every((finding) => finding.state === "no")
      ? { state: "no", detail: findings.map((finding) => finding.detail).join("; ") }
      : unknown(findings.find((finding) => finding.state === "unknown")?.detail ?? "the descriptor names no transport"))

export class Providers extends Context.Service<Providers, {
  /** Every descriptor; a project descriptor replaces a shipped one of the same id. */
  readonly list: Effect.Effect<ReadonlyArray<ProviderEntry>, ToolError>
  get(id: string): Effect.Effect<Descriptor, ToolError>
  probe(id: string): Effect.Effect<ProviderProbe, ToolError>
  /** What is left on the provider's account, by its own free read; never a paid call. Fails only for an unknown id. */
  balance(id: string): Effect.Effect<Balance, ToolError>
}>()("jam/Providers") {
  static readonly layerNoDeps: Layer.Layer<Providers, never, ProjectFiles | Toolkit | Config | Executables> = Layer.effect(
    Providers,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const toolkit = yield* Toolkit
      const configs = yield* Config
      const executables = yield* Executables

      const decodeAt = (what: string, id: string) => (raw: unknown): Effect.Effect<Descriptor, ToolError> =>
        Effect.flatMap(decode(Descriptor, { what, fix: "see schemas/provider.schema.json in the toolkit" })(raw), (descriptor) =>
          descriptor.id === id ? Effect.succeed(descriptor) : fail("invalid", `${what}: id is ${descriptor.id}, expected ${id} to match the file name`))
      const idOf = (name: string): string | null => (name.endsWith(".json") ? name.slice(0, -".json".length) : null)

      const list: Effect.Effect<ReadonlyArray<ProviderEntry>, ToolError> = Effect.gen(function*() {
        const byId = new Map<string, ProviderEntry>()
        for (const name of yield* toolkit.list("providers")) {
          const id = idOf(name)
          if (id === null) continue
          const path = `providers/${name}`
          byId.set(id, { descriptor: yield* Effect.flatMap(toolkit.readJson(path), decodeAt(`shipped provider ${id}`, id)), source: "shipped", path })
        }
        for (const entry of yield* files.list(PROVIDERS_DIR)) {
          const id = entry.kind === "file" ? idOf(entry.name) : null
          if (id === null) continue
          const path = `${PROVIDERS_DIR}/${entry.name}`
          byId.set(id, { descriptor: yield* Effect.flatMap(files.readJson(path), decodeAt(path, id)), source: "project", path })
        }
        return [...byId.values()].sort((a, b) => (a.descriptor.id < b.descriptor.id ? -1 : 1))
      })

      const get = (id: string): Effect.Effect<Descriptor, ToolError> =>
        Effect.flatMap(list, (entries) => {
          const found = entries.find((entry) => entry.descriptor.id === id)
          return found
            ? Effect.succeed(found.descriptor)
            : fail("not_found", `provider ${id} is not known`, {
              fix: `use one of: ${entries.map((entry) => entry.descriptor.id).join(", ")}; or describe it in ${PROVIDERS_DIR}/${id}.json`
            })
        })

      // Where agent harnesses keep project-level configuration is shipped data, not knowledge of this module.
      const harness: Effect.Effect<{ mcpConfigFiles: ReadonlyArray<string>; skillFolders: ReadonlyArray<string> }> = toolkit.readJson("defaults/harness.json").pipe(
        Effect.map((raw) => {
          const names = (key: string): ReadonlyArray<string> => (isRecord(raw) && Array.isArray(raw[key]) ? raw[key].filter((item): item is string => typeof item === "string") : [])
          return { mcpConfigFiles: names("mcpConfigFiles"), skillFolders: names("skillFolders") }
        }),
        Effect.catch(() => Effect.succeed({ mcpConfigFiles: [], skillFolders: [] }))
      )

      const harnessServers: Effect.Effect<ReadonlyMap<string, string>> = Effect.gen(function*() {
        const found = new Map<string, string>()
        for (const file of (yield* harness).mcpConfigFiles) {
          const raw = yield* files.readJson(file).pipe(Effect.catch(() => Effect.succeed(null)))
          if (isRecord(raw) && isRecord(raw["mcpServers"])) for (const server of Object.keys(raw["mcpServers"])) found.set(server, file)
        }
        return found
      })

      const skillInstalled = (name: string): Effect.Effect<boolean> =>
        Effect.gen(function*() {
          for (const folder of (yield* harness).skillFolders) {
            if (yield* files.exists(`${folder}/${name}/SKILL.md`).pipe(Effect.catch(() => Effect.succeed(false)))) return true
          }
          return false
        })

      const probeTransport = (id: string, transport: Transport): Effect.Effect<TransportProbe, ToolError> =>
        Effect.gen(function*() {
          if (transport.kind === "cli") {
            const command = yield* configs.providerCommand(id, transport.command ?? id)
            const options = { npmLauncher: transport.npmLauncher, cwd: files.root }
            const version = yield* executables.probe(command, transport.probe ?? ["--version"], options)
            const installed: Finding = version.installed
              ? { state: "yes", detail: `${command}: ${version.output ?? "runs"}` }
              : { state: "no", detail: `${command} did not run (${version.error ?? "unknown error"})` }
            const ask = (args: ReadonlyArray<string> | undefined, yes: string, no: string, absent: string): Effect.Effect<Finding> =>
              !version.installed
                ? Effect.succeed(unknown("not installed"))
                : args === undefined
                ? Effect.succeed(unknown(absent))
                : Effect.map(executables.probe(command, args, { ...options, timeoutMs: 30_000 }), (result): Finding =>
                  result.installed ? { state: "yes", detail: `${yes} (${command} ${args.join(" ")})` } : { state: "no", detail: `${no} (${command} ${args.join(" ")}: ${result.output ?? result.error ?? "failed"})` })
            return {
              kind: "cli",
              target: command,
              installed,
              authenticated: yield* ask(transport.auth, "signed in", "not signed in", `the descriptor names no sign-in check; ${SESSION}`),
              reachable: yield* ask(transport.reach, "the service answered", "the service did not answer", SESSION)
            }
          }
          if (transport.kind === "mcp") {
            const server = transport.server ?? id
            const listed = (yield* harnessServers).get(server)
            return {
              kind: "mcp",
              target: server,
              installed: listed !== undefined ? { state: "yes", detail: `server ${server} is listed in ${listed}` } : unknown(`MCP server ${server} is ${HARNESS}`),
              authenticated: unknown(SESSION),
              reachable: unknown(SESSION)
            }
          }
          if (transport.kind === "skill") {
            const name = transport.name ?? id
            const present = yield* skillInstalled(name)
            return {
              kind: "skill",
              target: name,
              installed: present ? { state: "yes", detail: `skill ${name} is installed in this project` } : unknown(`skill ${name} is not in this project's skill folders; it may be installed for the user`),
              authenticated: unknown(SESSION),
              reachable: unknown(SESSION)
            }
          }
          const target = transport.kind === "browser" ? "the provider's site" : "the agent's own tools"
          return { kind: transport.kind, target, installed: unknown(`used through ${target}`), authenticated: unknown(SESSION), reachable: unknown(SESSION) }
        })

      const balance = (id: string): Effect.Effect<Balance, ToolError> =>
        Effect.gen(function*() {
          const descriptor = yield* get(id)
          const base = { id, label: descriptor.label, unit: descriptor.unit, remaining: null, used: null, limit: null, parts: {}, resets: null }
          const reads = descriptor.transports.filter((transport) => transport.balance !== undefined)
          if (reads.length === 0) {
            return {
              ...base,
              state: "none",
              via: null,
              detail: descriptor.unit.paid
                ? `no balance read: the descriptor names none; read it with the provider's own tool${descriptor.docs === undefined ? "" : ` (${descriptor.docs})`}`
                : `no balance: not billed per job (${descriptor.unit.label})`
            } satisfies Balance
          }
          const found: Array<Balance> = []
          for (const transport of reads) {
            const read = transport.balance!
            if (transport.kind === "mcp") {
              const via = `${read.tool} on MCP server ${transport.server}`
              found.push({ ...base, state: "session", via, detail: `read in the agent session: call ${via}${read.note === undefined ? "" : `; ${read.note}`}` })
              continue
            }
            const command = yield* configs.providerCommand(id, transport.command ?? id)
            const args = read.args ?? []
            const via = `${command} ${args.join(" ")}`
            const result = yield* executables.probe(command, args, { npmLauncher: transport.npmLauncher, cwd: files.root, timeoutMs: 30_000 })
            if (!result.installed) {
              const ran = result.error?.startsWith("exit ") === true
              found.push({ ...base, state: "failed", via, detail: ran ? `unread: ${via} ${result.error} (${(result.output ?? "no output").slice(0, 160)}); not signed in, or the service did not answer` : `unread: ${command} is not installed (${result.error ?? "did not run"})` })
              continue
            }
            const parsed = parseBalance(read, result.stdout)
            if ("problem" in parsed) {
              found.push({ ...base, state: "failed", via, detail: `unread: ${via} ran, but ${parsed.problem}` })
              continue
            }
            return { ...base, ...parsed, state: "read", via, detail: `read now with ${via}, a free call that also proves the account is signed in and the service answers${read.note === undefined ? "" : `; ${read.note}`}` } satisfies Balance
          }
          // Nothing was read here: the agent's own read when there is one, with every failure beside it.
          const chosen = found.find((entry) => entry.state === "session") ?? found[0]!
          const others = found.filter((entry) => entry !== chosen).map((entry) => entry.detail)
          return others.length === 0 ? chosen : { ...chosen, detail: [chosen.detail, ...others].join("; ") }
        })

      return {
        list,
        get,
        balance,
        probe: (id) =>
          Effect.gen(function*() {
            const descriptor = yield* get(id)
            const transports: Array<TransportProbe> = []
            for (const transport of descriptor.transports) transports.push(yield* probeTransport(id, transport))
            return {
              id,
              label: descriptor.label,
              installed: overall(transports.map((probe) => probe.installed)),
              authenticated: overall(transports.map((probe) => probe.authenticated)),
              reachable: overall(transports.map((probe) => probe.reachable)),
              transports
            }
          })
      }
    })
  )
}
