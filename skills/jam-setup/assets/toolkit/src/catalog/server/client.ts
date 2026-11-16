// Talking to a running catalog server from a command: the same actions, over HTTP.
import * as Effect from "effect/Effect"
import { type ErrorCode, type ToolError, toolError } from "../../kernel/errors.ts"

export interface Health {
  readonly ok: boolean
  readonly pid: number
  readonly toolkit: string
  readonly root: string
}

const unreachable = (url: string, cause: unknown): ToolError =>
  toolError("unavailable", `no catalog server answers at ${url} (${cause instanceof Error ? cause.message : String(cause)})`, { fix: "start one with `jam catalog open`" })

/** Who answers at this address, or null when nothing does (or it is not a catalog server). */
export const health = (url: string, timeoutMs = 2000): Effect.Effect<Health | null> =>
  Effect.tryPromise(async () => {
    const response = await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(timeoutMs) })
    const body = (await response.json()) as Partial<Health>
    return response.ok && body.ok === true && typeof body.pid === "number" && typeof body.root === "string" ? (body as Health) : null
  }).pipe(Effect.catch(() => Effect.succeed(null)))

/** Run an action on a server. A failure comes back as the same ToolError the action failed with. */
export const callAction = (url: string, action: string, body: { readonly input?: unknown; readonly actor?: unknown; readonly requestId?: string | undefined }): Effect.Effect<unknown, ToolError> =>
  Effect.gen(function*() {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(new URL(`/api/run/${action}`, url), {
          method: "POST",
          headers: { "content-type": "application/json", "x-catalog-request": "1" },
          body: JSON.stringify({ input: body.input ?? {}, ...(body.actor === undefined ? {} : { actor: body.actor }), ...(body.requestId === undefined ? {} : { requestId: body.requestId }) })
        }),
      catch: (cause) => unreachable(url, cause)
    })
    const answer = (yield* Effect.tryPromise({ try: () => response.json() as Promise<unknown>, catch: (cause) => unreachable(url, cause) })) as {
      readonly error?: { readonly code?: ErrorCode; readonly message?: string; readonly fix?: string; readonly details?: unknown }
    }
    if (response.ok) return answer
    const error = answer.error ?? {}
    return yield* Effect.fail(toolError(error.code ?? "unavailable", error.message ?? `HTTP ${response.status}`, { fix: error.fix, details: error.details ?? undefined }))
  })
