// `jam provider …`.
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Effect from "effect/Effect"
import { Output } from "../../kernel/cli.ts"
import { described } from "../cliSupport.ts"
import { Config } from "../config/Config.ts"
import { lines, pairs, table } from "../text.ts"
import { type Finding, Providers } from "./Providers.ts"
import { spendState } from "./spend.ts"

const finding = (value: Finding): string => `${value.state} (${value.detail})`

const list = Command.make("list", {}, () =>
  Effect.gen(function*() {
    const entries = yield* (yield* Providers).list
    const state = yield* (yield* Config).state
    const config = state.kind === "ready" ? state.config : null
    const rows = entries.map((entry) => {
      const { descriptor } = entry
      return {
        id: descriptor.id,
        label: descriptor.label,
        source: entry.source,
        unit: descriptor.unit,
        capabilities: Object.keys(descriptor.capabilities),
        routes: Object.entries(config?.routes ?? {}).filter(([, provider]) => provider === descriptor.id).map(([route]) => route),
        transports: descriptor.transports.map((transport) => transport.kind),
        spend: spendState(descriptor, config?.spend[descriptor.id])
      }
    })
    yield* (yield* Output).emit({ providers: rows }, table(
      ["provider", "serves", "routed", "reached by", "spending"],
      rows.map((row) => [row.id, row.capabilities.join(", "), row.routes.join(", ") || "-", row.transports.join(", "), row.spend.summary])
    ))
  })).pipe(described("List the known providers: what each can serve, which routes use it, how it is reached, and whether paid work is enabled.", "jam provider list"))

const probe = Command.make("probe", { id: Argument.String("id").pipe(Argument.withDescription("Provider id")) }, ({ id }) =>
  Effect.gen(function*() {
    const providers = yield* Providers
    const descriptor = yield* providers.get(id)
    const result = yield* providers.probe(id)
    yield* (yield* Output).emit({ ...result, pacing: descriptor.pacing ?? null, quote: descriptor.quote ?? null, recovery: descriptor.recovery ?? null }, lines(
      `${result.id}: ${result.label}`,
      pairs([["installed", finding(result.installed)], ["authenticated", finding(result.authenticated)], ["reachable", finding(result.reachable)]]),
      ...result.transports.map((transport) => `  via ${transport.kind} ${transport.target}: installed ${transport.installed.state}, authenticated ${transport.authenticated.state}, reachable ${transport.reachable.state}`),
      descriptor.quote === undefined ? null : `price: ${descriptor.quote.how}`,
      descriptor.pacing?.retryAfter === undefined ? null : `after a refusal: ${descriptor.pacing.retryAfter}`
    ))
  })).pipe(described(
    "Report, separately, whether a provider is installed, signed in and reachable. What the toolkit cannot see is reported as unknown with how to find out; it is never guessed.",
    "jam provider probe <provider>"
  ))

export const provider = Command.make("provider").pipe(
  Command.withDescription("Providers: generation services the project can use"),
  Command.withSubcommands([list, probe])
)
