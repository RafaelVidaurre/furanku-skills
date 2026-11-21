// `jam provider …`.
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { Output } from "../../kernel/cli.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { described, text } from "../cliSupport.ts"
import { Config } from "../config/Config.ts"
import { distinctRuns } from "../runs/jobs.ts"
import { Runs } from "../runs/Runs.ts"
import { lines, pairs, table } from "../text.ts"
import { balanceText } from "./balance.ts"
import { type Finding, type ProviderEntry, Providers } from "./Providers.ts"
import { committed, spendState } from "./spend.ts"

const finding = (value: Finding): string => `${value.state} (${value.detail})`

const capabilityFlag = text("capability", "Only providers that serve this route (image, mesh, motion, sound, voice, ...)")
const idsArg = Argument.String("id").pipe(Argument.withDescription("Provider ids (default: every provider the project knows)"), Argument.variadic())

/** The providers asked for: the ids named (each must exist), else all; then only those serving the capability. */
const chosen = (ids: ReadonlyArray<string>, capability: Option.Option<string>): Effect.Effect<ReadonlyArray<ProviderEntry>, ToolError, Providers> =>
  Effect.gen(function*() {
    const providers = yield* Providers
    const entries = yield* providers.list
    for (const id of ids) yield* providers.get(id)
    const named = ids.length === 0 ? entries : entries.filter((entry) => ids.includes(entry.descriptor.id))
    if (Option.isNone(capability)) return named
    const route = capability.value
    const serving = named.filter((entry) => route in entry.descriptor.capabilities)
    if (serving.length === 0) {
      const known = [...new Set(entries.flatMap((entry) => Object.keys(entry.descriptor.capabilities)))].sort()
      return yield* fail("not_found", `no ${ids.length === 0 ? "" : "named "}provider serves ${route}`, { fix: `capabilities the known providers serve: ${known.join(", ")}` })
    }
    return serving
  })

const list = Command.make("list", { capability: capabilityFlag }, ({ capability }) =>
  Effect.gen(function*() {
    const entries = yield* chosen([], capability)
    const state = yield* (yield* Config).state
    const config = state.kind === "ready" ? state.config : null
    // What the project's runs have committed so far; unknown outside a configured project.
    const jobs = config === null ? null : yield* (yield* Runs).scan.pipe(
      Effect.map((scan) => distinctRuns(scan.runs).flatMap((ref) => ref.run.jobs)),
      Effect.catch(() => Effect.succeed(null))
    )
    const rows = entries.map((entry) => {
      const { descriptor } = entry
      const spend = spendState(descriptor, config?.spend[descriptor.id])
      return {
        id: descriptor.id,
        label: descriptor.label,
        source: entry.source,
        unit: descriptor.unit,
        capabilities: Object.keys(descriptor.capabilities).sort(),
        modes: Object.fromEntries(Object.entries(descriptor.capabilities).flatMap(([route, capability]) => (capability.modes === undefined ? [] : [[route, capability.modes]]))),
        routes: Object.entries(config?.routes ?? {}).filter(([, provider]) => provider === descriptor.id).map(([route]) => route),
        transports: descriptor.transports.map((transport) => transport.kind),
        spend: { ...spend, used: spend.paid && jobs !== null ? committed(jobs, descriptor.id) : null }
      }
    })
    yield* (yield* Output).emit({ providers: rows }, table(
      ["provider", "serves", "routed", "reached by", "spending"],
      rows.map((row) => [
        row.id,
        row.capabilities.map((route) => (row.modes[route] === undefined ? route : `${route} (${row.modes[route]!.join(", ")})`)).join(", "),
        row.routes.join(", ") || "-",
        row.transports.join(", "),
        row.spend.used === null ? row.spend.summary : `${row.spend.summary}; ${row.spend.used} committed`
      ])
    ))
  })).pipe(described(
    "List the known providers: what each can serve and in which modes, which routes use it, how it is reached, whether paid work is enabled, and what the project's runs have committed to each (charges plus estimates still at risk).",
    "jam provider list --capability mesh"
  ))

const probe = Command.make("probe", { ids: idsArg }, ({ ids }) =>
  Effect.gen(function*() {
    const providers = yield* Providers
    const results = []
    for (const entry of yield* chosen(ids, Option.none())) {
      const { descriptor } = entry
      const result = yield* providers.probe(descriptor.id)
      results.push({
        json: { ...result, pacing: descriptor.pacing ?? null, quote: descriptor.quote ?? null, recovery: descriptor.recovery ?? null },
        text: lines(
          `${result.id}: ${result.label}`,
          pairs([["installed", finding(result.installed)], ["authenticated", finding(result.authenticated)], ["reachable", finding(result.reachable)]]),
          ...result.transports.map((transport) => `  via ${transport.kind} ${transport.target}: installed ${transport.installed.state}, authenticated ${transport.authenticated.state}, reachable ${transport.reachable.state}`),
          descriptor.quote === undefined ? null : `price: ${descriptor.quote.how}`,
          descriptor.pacing?.retryAfter === undefined ? null : `after a refusal: ${descriptor.pacing.retryAfter}`
        )
      })
    }
    yield* (yield* Output).emit(ids.length === 1 ? results[0]!.json : { providers: results.map((result) => result.json) }, results.map((result) => result.text).join("\n\n"))
  })).pipe(described(
    "Report, separately, whether a provider is installed, signed in and reachable. What the toolkit cannot see is reported as unknown with how to find out; it is never guessed. With one id --json prints that provider's object; otherwise { providers: [...] }.",
    "jam provider probe <provider>"
  ))

const balance = Command.make("balance", { ids: idsArg, capability: capabilityFlag }, ({ capability, ids }) =>
  Effect.gen(function*() {
    const providers = yield* Providers
    const rows = []
    for (const entry of yield* chosen(ids, capability)) rows.push(yield* providers.balance(entry.descriptor.id))
    yield* (yield* Output).emit({ providers: rows }, table(
      ["provider", "unit", "balance", "read"],
      rows.map((row) => [row.id, row.unit.label, row.state === "read" ? balanceText(row) : row.state, row.state === "read" ? row.via ?? "" : row.detail])
    ))
  })).pipe(described(
    "Read what is left on each provider's account through the provider's own free balance or usage call, as its descriptor declares; never a paid call. Prints the amount left in the provider's unit, the portions it reports apart and when the allowance renews; for a read only the agent's own tools can make, what to call; for a provider with no balance, why. A successful read also proves the account is signed in and the service answers.",
    "jam provider balance --capability mesh"
  ))

export const provider = Command.make("provider").pipe(
  Command.withDescription("Providers: generation services the project can use"),
  Command.withSubcommands([list, probe, balance])
)
