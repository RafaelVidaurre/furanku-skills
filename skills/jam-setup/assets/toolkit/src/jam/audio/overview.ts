// What audio work in a project runs on, in one answer: format, loudness targets, the providers
// behind the sound and voice routes with their guides and caps, where files live, and whether the
// transcript check can run.
import * as Effect from "effect/Effect"
import * as nodePath from "node:path"
import type { ToolError } from "../../kernel/errors.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Config } from "../config/Config.ts"
import type { Engine } from "../engine/Engine.ts"
import { Providers } from "../providers/Providers.ts"
import { spendState } from "../providers/spend.ts"
import { Toolkit } from "../Toolkit.ts"
import { Aligner, type Availability } from "./Aligner.ts"
import type { Route } from "./AudioProvider.ts"
import type { AudioConfig } from "./schema.ts"
import { audioSettings, type AudioSettings } from "./targets.ts"

export interface RouteInfo {
  readonly route: Route
  readonly provider: string | null
  /** Where the provider's own guidance is: prompting, settings, prices, what a refusal means. */
  readonly guide: string | null
  readonly spending: string | null
  /** The person's standing authorization for this provider, when one is set. */
  readonly standing: string | null
}

export interface Overview extends AudioSettings {
  readonly routes: ReadonlyArray<RouteInfo>
  readonly roots: AudioConfig["roots"]
  readonly lines: ReadonlyArray<string>
  readonly speakers: string
  readonly transcriptCheck: Availability
}

export const overview: Effect.Effect<Overview, ToolError, Config | Engine | Providers | Toolkit | ProjectFiles | Aligner> = Effect.gen(function*() {
  const config = yield* (yield* Config).load
  const toolkit = yield* Toolkit
  const files = yield* ProjectFiles
  const entries = yield* (yield* Providers).list
  const routes: Array<RouteInfo> = []
  for (const route of ["sound", "voice"] as const) {
    const entry = entries.find((candidate) => candidate.descriptor.id === config.routes[route])
    if (entry === undefined) {
      routes.push({ route, provider: config.routes[route] ?? null, guide: null, spending: null, standing: null })
      continue
    }
    const docs = entry.descriptor.docs
    const shipped = docs === undefined ? null : nodePath.relative(files.root, toolkit.path(docs)).split(nodePath.sep).join("/")
    const state = spendState(entry.descriptor, config.spend[entry.descriptor.id])
    routes.push({
      route,
      provider: entry.descriptor.id,
      guide: docs === undefined ? null : entry.source === "project" ? docs : shipped!.startsWith("..") ? toolkit.path(docs) : shipped,
      spending: state.summary,
      standing: state.standing
    })
  }
  return { ...(yield* audioSettings), routes, roots: config.audio.roots, lines: config.audio.lines, speakers: config.audio.speakers, transcriptCheck: yield* (yield* Aligner).availability }
})
