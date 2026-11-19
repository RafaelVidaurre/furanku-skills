// What every plugin function receives and may return.
import type * as Effect from "effect/Effect"

/** Throw `toolError(code, message, { fix })` from a plugin function to fail with a specific error code. */
export { type ErrorCode, ToolError, toolError } from "../../kernel/errors.ts"

/** What a plugin function may return. An Effect must need no services; its failure is reported. */
export type PluginResult<A> = A | PromiseLike<A> | Effect.Effect<A, unknown, never>

/** Confined reads of project files: project-relative forward-slash paths, never outside the project. */
export interface PluginFiles {
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  readJson(path: string): Promise<unknown>
  readBytes(path: string): Promise<Uint8Array>
  /** Every file under a folder, sorted, as project-relative paths. A missing folder is empty. */
  walk(path: string): Promise<ReadonlyArray<string>>
}

export interface PluginContext {
  /** Absolute project root. */
  readonly root: string
  /** The `options` of this plugin's entry in catalog.config.json (empty when absent). */
  readonly options: Readonly<Record<string, unknown>>
  readonly files: PluginFiles
}
