// Generating audio with a provider. The provider is named by a route (routes.sound, routes.voice)
// and described by its descriptor; an adapter module beside the descriptor (providers/<id>.audio.ts)
// knows how to drive its program. Adding a provider is that one module and its descriptor.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { pathToFileURL } from "node:url"
import { fail, type ToolError, toolError } from "../../kernel/errors.ts"
import { Executables } from "../../kernel/Executable.ts"
import { Ids } from "../../kernel/Ids.ts"
import { Process, type RunResult } from "../../kernel/Process.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Config } from "../config/Config.ts"
import { LOCAL_FILE, LOCAL_STATE_DIR, PROVIDERS_DIR } from "../layout.ts"
import { Providers } from "../providers/Providers.ts"
import type { Descriptor } from "../providers/schema.ts"
import { Toolkit } from "../Toolkit.ts"
import type { VoiceRef } from "./schema.ts"

export type Route = "sound" | "voice"

export interface Estimate {
  /** Expected charge in the provider's own unit. */
  readonly amount: number
  /** Where the number comes from, in words a person can check. */
  readonly basis: string
  readonly kind: "quote" | "list" | "estimate"
}

export interface SoundRequest {
  readonly prompt: string
  /** Seconds; absent lets the provider choose. */
  readonly duration?: number | undefined
  readonly loop: boolean
  /** Provider settings as the adapter names them. */
  readonly settings: Readonly<Record<string, unknown>>
}

export interface SpeechRequest {
  /** The words to speak, with the provider's delivery markup when the line has any. */
  readonly text: string
  readonly voice: VoiceRef
  readonly language: string
}

export interface VoiceInfo {
  readonly id: string
  readonly name: string
  readonly category?: string | undefined
  readonly description?: string | undefined
  readonly labels?: Readonly<Record<string, unknown>> | undefined
  /** A link to listen to the voice. Shown, never stored: it may expire. */
  readonly preview?: string | undefined
}

/**
 * What became of one paid call. ok: audio came back. refused: the provider answered and made
 * nothing (bad input, not signed in, a stated wait). lost: no answer was read, so it may have been
 * made and charged.
 */
export type CallOutcome =
  | { readonly status: "ok"; readonly audio: Uint8Array; readonly extension: string; readonly providerJob: string | null }
  | { readonly status: "refused"; readonly message: string }
  | { readonly status: "lost"; readonly message: string }

export type Generated = CallOutcome & {
  /** What the account was charged, when the provider's usage figure could be read before and after. */
  readonly charge?: number | null
}

/** What an adapter is given to reach its provider. */
export interface AdapterIo {
  /** Run the provider's program with these arguments. Fails only when it cannot start or is stopped. */
  run(args: ReadonlyArray<string>, options?: { readonly timeoutMs?: number }): Effect.Effect<RunResult, ToolError>
  /** A fresh file the program may write its result to (absolute path), and how to read it back. */
  readonly output: { readonly path: string; readonly read: Effect.Effect<Uint8Array | null, ToolError> }
}

export interface SoundAdapter {
  readonly model: string
  /** What is wrong with a request, in words that name the setting. */
  problems(request: SoundRequest): ReadonlyArray<string>
  estimate(request: SoundRequest): Estimate
  /** The request as it is sent, for the record: no credentials, no signed URLs. */
  describe(request: SoundRequest): Record<string, unknown>
  generate(io: AdapterIo, request: SoundRequest): Effect.Effect<CallOutcome, ToolError>
}

export interface VoiceAdapter {
  readonly model: string
  /** The words a performance speaks once its delivery markup is removed. */
  spokenWords(markup: string): string
  settingProblems(settings: Readonly<Record<string, unknown>>): ReadonlyArray<string>
  estimate(request: SpeechRequest): Estimate
  describe(request: SpeechRequest): Record<string, unknown>
  speak(io: AdapterIo, request: SpeechRequest): Effect.Effect<CallOutcome, ToolError>
  voices(io: AdapterIo, search: string | undefined): Effect.Effect<ReadonlyArray<VoiceInfo>, ToolError>
  voice(io: AdapterIo, id: string): Effect.Effect<VoiceInfo, ToolError>
  /** Where a person creates or browses voices. */
  readonly links?: Readonly<Record<string, string>>
}

/** The contract of an adapter module: `export const adapter: AudioAdapter`. */
export interface AudioAdapter {
  readonly sound?: SoundAdapter
  readonly voice?: VoiceAdapter
  /** What the account has used so far, in the provider's unit, and the rights its plan grants. Never fails. */
  account?(io: AdapterIo): Effect.Effect<{ readonly used: number | null; readonly license: string | null }>
}

export interface ResolvedProvider {
  readonly id: string
  readonly descriptor: Descriptor
  readonly adapter: AudioAdapter
  /** The program the adapter drives. */
  readonly command: string
}

/** Where adapter modules live in the toolkit: beside the descriptors, as `<provider id>.audio.ts`. */
const ADAPTERS_DIR = "providers"
const ADAPTER_SUFFIX = ".audio.ts"

const ROUTE_FIX = (route: Route, able: ReadonlyArray<string>): string =>
  `choose one: jam config set routes.${route} <provider>${able.length > 0 ? ` (providers that serve ${route}: ${able.join(", ")})` : ""}`

export class AudioProvider extends Context.Service<AudioProvider, {
  /** The provider serving a route, or the named one, with its adapter loaded. */
  resolve(route: Route, provider?: string): Effect.Effect<ResolvedProvider, ToolError>
  /** Why the provider's program cannot be used on this machine, or null when it runs. */
  ready(provider: ResolvedProvider): Effect.Effect<string | null>
  sound(provider: ResolvedProvider): Effect.Effect<SoundAdapter, ToolError>
  voice(provider: ResolvedProvider): Effect.Effect<VoiceAdapter, ToolError>
  generateSound(provider: ResolvedProvider, request: SoundRequest): Effect.Effect<Generated, ToolError>
  speak(provider: ResolvedProvider, request: SpeechRequest): Effect.Effect<Generated, ToolError>
  voices(provider: ResolvedProvider, search?: string): Effect.Effect<ReadonlyArray<VoiceInfo>, ToolError>
  voiceInfo(provider: ResolvedProvider, id: string): Effect.Effect<VoiceInfo, ToolError>
  /** The rights the account's plan grants over what it generates, when the provider says. */
  license(provider: ResolvedProvider): Effect.Effect<string | null>
}>()("jam/audio/AudioProvider") {
  static readonly layerNoDeps: Layer.Layer<AudioProvider, never, Config | Providers | Process | ProjectFiles | Executables | Ids | Toolkit> = Layer.effect(
    AudioProvider,
    Effect.gen(function*() {
      const configs = yield* Config
      const providers = yield* Providers
      const proc = yield* Process
      const files = yield* ProjectFiles
      const executables = yield* Executables
      const ids = yield* Ids
      const toolkit = yield* Toolkit

      // A project adds or replaces an adapter beside its own descriptor (jam/providers/<id>.audio.ts
      // or .mjs); otherwise the toolkit's is used. Adapters are trusted project code, like catalog plugins.
      const load = (id: string): Effect.Effect<AudioAdapter, ToolError> =>
        Effect.gen(function*() {
          const candidates = [".audio.ts", ".audio.mjs", ".audio.js"].map((suffix) => `${PROVIDERS_DIR}/${id}${suffix}`)
          let file: string | undefined
          for (const candidate of candidates) {
            if (yield* files.exists(candidate)) {
              file = yield* files.resolve(candidate)
              break
            }
          }
          const shipped = toolkit.path(`${ADAPTERS_DIR}/${id}${ADAPTER_SUFFIX}`)
          const target = file ?? shipped
          const module = yield* Effect.tryPromise({
            try: () => import(pathToFileURL(target).href) as Promise<{ adapter?: AudioAdapter }>,
            catch: (cause) =>
              file === undefined && (cause as { code?: string }).code === "ERR_MODULE_NOT_FOUND"
                ? toolError("unsupported", `provider ${id} has no audio adapter`, {
                  fix: `write one as ${PROVIDERS_DIR}/${id}.audio.ts (the contract is AudioAdapter in the toolkit's src/jam/audio/AudioProvider.ts; the toolkit's ${ADAPTERS_DIR}/*${ADAPTER_SUFFIX} files are complete examples), or route audio to a provider that has one`
                })
                : toolError("internal", `the audio adapter for ${id} could not be loaded: ${(cause as Error).message}`)
          })
          return module.adapter === undefined ? yield* fail("internal", `audio adapter ${id} does not export "adapter"`) : module.adapter
        })

      const resolve = (route: Route, named?: string): Effect.Effect<ResolvedProvider, ToolError> =>
        Effect.gen(function*() {
          const config = yield* configs.load
          const able = (yield* providers.list).filter((entry) => route in entry.descriptor.capabilities).map((entry) => entry.descriptor.id)
          const id = named ?? config.routes[route]
          if (id === undefined) return yield* fail("not_found", `no provider is routed for ${route} (routes.${route} in jam.config.json)`, { fix: ROUTE_FIX(route, able) })
          const descriptor = yield* providers.get(id)
          if (!(route in descriptor.capabilities)) return yield* fail("unsupported", `provider ${id} does not serve ${route}`, { fix: ROUTE_FIX(route, able) })
          const transport = descriptor.transports.find((candidate) => candidate.kind === "cli")
          if (transport?.command === undefined) return yield* fail("unsupported", `provider ${id} names no program to drive (a cli transport in its descriptor)`)
          const adapter = yield* load(id)
          return { id, descriptor, adapter, command: yield* configs.providerCommand(id, transport.command) }
        })

      const io = (provider: ResolvedProvider): Effect.Effect<AdapterIo, ToolError> =>
        Effect.gen(function*() {
          const config = yield* configs.load
          const scratch = `${config.roots.scratch}/${LOCAL_STATE_DIR}/audio/${yield* ids.uuid}`
          yield* files.makeDirectory(`${config.roots.scratch}/${LOCAL_STATE_DIR}/audio`)
          const script = /\.[cm]?js$/i.test(provider.command)
          if (executables.platform === "win32" && /\.(cmd|bat)$/i.test(provider.command)) {
            return yield* fail("unsupported", `${provider.command} is a command script, which cannot be given arbitrary text safely`, {
              fix: `set providers.${provider.id} in ${LOCAL_FILE} to the provider's executable, or to its JavaScript entry file`
            })
          }
          return {
            run: (args, options) => proc.run(script ? executables.node : provider.command, script ? [provider.command, ...args] : args, { cwd: files.root, timeoutMs: options?.timeoutMs ?? 120_000 }),
            output: {
              path: yield* files.resolve(scratch),
              read: Effect.gen(function*() {
                if ((yield* files.stat(scratch))?.kind !== "file") return null
                const bytes = yield* files.readBytes(scratch)
                yield* files.remove(scratch)
                return bytes
              })
            }
          }
        })

      const account = (provider: ResolvedProvider) =>
        provider.adapter.account === undefined
          ? Effect.succeed({ used: null, license: null })
          : Effect.flatMap(io(provider), (handle) => provider.adapter.account!(handle)).pipe(Effect.catch(() => Effect.succeed({ used: null, license: null })))

      // The charge is what the account's own usage figure moved by; nothing else running on the
      // account at that moment is assumed, so a figure that cannot be read gives no charge.
      const charged = (provider: ResolvedProvider, call: (handle: AdapterIo) => Effect.Effect<CallOutcome, ToolError>): Effect.Effect<Generated, ToolError> =>
        Effect.gen(function*() {
          const before = (yield* account(provider)).used
          const handle = yield* io(provider)
          const outcome = yield* call(handle).pipe(
            Effect.catch((error) => Effect.succeed<CallOutcome>({ status: "lost", message: error.message }))
          )
          if (outcome.status !== "ok") return outcome
          const after = before === null ? null : (yield* account(provider)).used
          return { ...outcome, charge: before !== null && after !== null && after >= before ? after - before : null }
        })

      const part = <K extends Route>(provider: ResolvedProvider, route: K): Effect.Effect<NonNullable<AudioAdapter[K]>, ToolError> => {
        const found = provider.adapter[route]
        return found === undefined ? fail("unsupported", `the audio adapter of ${provider.id} does not serve ${route}`) : Effect.succeed(found as NonNullable<AudioAdapter[K]>)
      }

      return {
        resolve,
        ready: (provider) =>
          Effect.flatMap(io(provider), (handle) => handle.run(provider.descriptor.transports.find((transport) => transport.kind === "cli")?.probe ?? ["--version"], { timeoutMs: 30_000 })).pipe(
            Effect.map((result) => (result.code === 0 ? null : `${provider.command} exited ${result.code}: ${(result.stderr.trim() || Buffer.from(result.stdout).toString("utf8").trim()).split("\n").at(-1) ?? ""}`)),
            Effect.catch((error) => Effect.succeed(error.message))
          ),
        sound: (provider) => part(provider, "sound"),
        voice: (provider) => part(provider, "voice"),
        generateSound: (provider, request) => Effect.flatMap(part(provider, "sound"), (sound) => charged(provider, (handle) => sound.generate(handle, request))),
        speak: (provider, request) => Effect.flatMap(part(provider, "voice"), (voice) => charged(provider, (handle) => voice.speak(handle, request))),
        voices: (provider, search) => Effect.gen(function*() {
          return yield* (yield* part(provider, "voice")).voices(yield* io(provider), search)
        }),
        voiceInfo: (provider, id) => Effect.gen(function*() {
          return yield* (yield* part(provider, "voice")).voice(yield* io(provider), id)
        }),
        license: (provider) => Effect.map(account(provider), (found) => found.license)
      }
    })
  )
}
