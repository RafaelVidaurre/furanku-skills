// Project configuration and this machine's tool paths.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { decode } from "../../kernel/decode.ts"
import { attempt, fail, type ToolError } from "../../kernel/errors.ts"
import { commandPath, Executables } from "../../kernel/Executable.ts"
import { isRecord } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { CONFIG_FILE, LOCAL_FILE } from "../layout.ts"
import { JamConfig, LocalConfig, type ToolName } from "./schema.ts"

const SETUP_FIX = `create it with "jam setup --from <choices.json>" ("jam setup" prints the choices), or run the jam-setup installer`

export type ConfigState =
  | { readonly kind: "missing" }
  /** A version 1 file, as written; `jam config migrate` upgrades it. */
  | { readonly kind: "v1"; readonly raw: Record<string, unknown> }
  | { readonly kind: "ready"; readonly config: JamConfig }

export class Config extends Context.Service<Config, {
  /** What is on disk. Fails only when the file exists and cannot be read as either version. */
  readonly state: Effect.Effect<ConfigState, ToolError>
  /** The version 2 configuration; fails with what to do when it is missing or still version 1. */
  readonly load: Effect.Effect<JamConfig, ToolError>
  /** Validate and write. */
  save(config: unknown): Effect.Effect<JamConfig, ToolError>
  /** Change the stored JSON under a lock; the result is validated before it replaces the file. */
  update(change: (raw: Record<string, unknown>) => Record<string, unknown>): Effect.Effect<JamConfig, ToolError>
  readonly local: Effect.Effect<LocalConfig, ToolError>
  saveLocal(local: unknown): Effect.Effect<LocalConfig, ToolError>
  /** The executable to run for a tool: this machine's choice, else its usual name on PATH. */
  tool(name: ToolName): Effect.Effect<string, ToolError>
  /** The executable of a provider's CLI: this machine's choice, else the descriptor's command. */
  providerCommand(provider: string, fallback: string): Effect.Effect<string, ToolError>
}>()("jam/Config") {
  static readonly layerNoDeps: Layer.Layer<Config, never, ProjectFiles | Executables> = Layer.effect(
    Config,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const executables = yield* Executables
      const decodeConfig = decode(JamConfig, { what: CONFIG_FILE, fix: `correct the named fields; "jam config check" lists them again` })
      const decodeLocal = decode(LocalConfig, { what: LOCAL_FILE, fix: "correct the named fields; this file only holds paths of programs on this machine" })

      const readRaw = (path: string): Effect.Effect<unknown | null, ToolError> =>
        Effect.flatMap(files.exists(path), (exists) => (exists ? files.readJson(path) : Effect.succeed(null)))

      const state: Effect.Effect<ConfigState, ToolError> = Effect.gen(function*() {
        const raw = yield* readRaw(CONFIG_FILE)
        if (raw === null) return { kind: "missing" }
        if (isRecord(raw) && raw["version"] === 1) return { kind: "v1", raw }
        return { kind: "ready", config: yield* decodeConfig(raw) }
      })

      const load: Effect.Effect<JamConfig, ToolError> = Effect.flatMap(state, (current) =>
        current.kind === "ready"
          ? Effect.succeed(current.config)
          : current.kind === "missing"
          ? fail("not_found", `${CONFIG_FILE} is missing: this project is not set up for jam`, { fix: SETUP_FIX })
          : fail("unsupported", `${CONFIG_FILE} is version 1`, { fix: `run "jam config migrate" to upgrade it (add --dry-run to preview)` }))

      const save = (config: unknown): Effect.Effect<JamConfig, ToolError> =>
        Effect.tap(decodeConfig(config), () => files.writeJson(CONFIG_FILE, config))

      const local: Effect.Effect<LocalConfig, ToolError> = Effect.flatMap(readRaw(LOCAL_FILE), (raw) => decodeLocal(raw ?? {}))

      const fallbacks: Record<ToolName, string> = { python: executables.defaultPython, blender: "blender", ffmpeg: "ffmpeg" }

      return {
        state,
        load,
        save,
        update: (change) =>
          Effect.scoped(Effect.gen(function*() {
            yield* files.lock(`${CONFIG_FILE}.lock`)
            const raw = yield* readRaw(CONFIG_FILE)
            if (!isRecord(raw)) return yield* fail("not_found", `${CONFIG_FILE} is missing`, { fix: SETUP_FIX })
            if (raw["version"] === 1) return yield* fail("unsupported", `${CONFIG_FILE} is version 1`, { fix: `run "jam config migrate" first` })
            return yield* save(yield* attempt("change the configuration", () => change(raw), "invalid"))
          })),
        local,
        saveLocal: (value) => Effect.tap(decodeLocal(value), () => files.writeJson(LOCAL_FILE, value)),
        tool: (name) => Effect.map(local, (paths) => (paths[name] === undefined ? fallbacks[name] : commandPath(files.root, paths[name]))),
        providerCommand: (provider, fallback) =>
          Effect.map(local, (paths) => {
            const chosen = paths.providers?.[provider]
            return chosen === undefined ? fallback : commandPath(files.root, chosen)
          })
      }
    })
  )
}
