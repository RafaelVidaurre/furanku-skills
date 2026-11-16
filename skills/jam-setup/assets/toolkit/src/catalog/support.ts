// Small helpers shared inside the catalog engine. Nothing here is part of the plugin contract.
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { asToolError, type ErrorCode, type ToolError, toolError } from "../kernel/errors.ts"
import type { ProjectFiles } from "../kernel/ProjectFiles.ts"
import type { PluginContext, PluginFiles, PluginResult } from "./plugin.ts"

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function"

/**
 * Run a plugin function. Plugins are trusted project code, but their failures are still data:
 * whatever is thrown, rejected or failed becomes a ToolError naming what was being done.
 */
export const fromPlugin = <A>(what: string, call: () => PluginResult<A>, code: ErrorCode = "unavailable"): Effect.Effect<A, ToolError> =>
  Effect.suspend(() => {
    const result = call()
    if (Effect.isEffect(result)) return Effect.mapError(result as Effect.Effect<A, unknown>, asToolError(code, what))
    if (isPromiseLike(result)) return Effect.tryPromise({ try: () => result as PromiseLike<A>, catch: asToolError(code, what) })
    return Effect.succeed(result as A)
  }).pipe(Effect.catchDefect((defect) => Effect.fail(asToolError(code, what)(defect))))

/** Run an effect for promise-based plugin code; rejects with the ToolError itself. */
export const toPromise = async <A>(effect: Effect.Effect<A, ToolError>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  throw Option.getOrUndefined(Exit.findErrorOption(exit)) ?? toolError("internal", String(exit.cause))
}

export const pluginFiles = (files: ProjectFiles["Service"]): PluginFiles => ({
  exists: (path) => toPromise(files.exists(path)),
  readText: (path) => toPromise(files.readText(path)),
  readJson: (path) => toPromise(files.readJson(path)),
  readBytes: (path) => toPromise(files.readBytes(path)),
  walk: (path) => toPromise(files.walk(path))
})

export const pluginContext = (files: ProjectFiles["Service"], options: Readonly<Record<string, unknown>> = {}): PluginContext => ({
  root: files.root,
  options,
  files: pluginFiles(files)
})

export const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** Group values by a key, keeping first-seen order of keys and values. */
export const groupBy = <K, V>(values: Iterable<V>, key: (value: V) => K): Map<K, Array<V>> => {
  const out = new Map<K, Array<V>>()
  for (const value of values) {
    const k = key(value)
    const list = out.get(k)
    if (list) list.push(value)
    else out.set(k, [value])
  }
  return out
}

export const unique = <A>(values: Iterable<A>): Array<A> => [...new Set(values)]

/** Clamp a requested page to what exists. */
export const paginate = <A>(items: ReadonlyArray<A>, page: number | null | undefined, pageSize: number | null | undefined, fallback: number, max: number) => {
  const size = Math.min(max, Math.max(1, Math.trunc(pageSize ?? fallback) || 1))
  const pages = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(pages, Math.max(1, Math.trunc(page ?? 1) || 1))
  return { page: current, pages, pageSize: size, items: items.slice((current - 1) * size, current * size) }
}
