// The one error type every toolkit operation fails with. A code for programs, a message for
// people, and an optional fix that says what to do next.
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Runtime from "effect/Runtime"

export type ErrorCode =
  | "invalid" // the input is wrong; the message names the field and the expected form
  | "not_found"
  | "conflict" // a concurrent or repeated change; the caller should re-read and retry
  | "checkout_changed" // the checkout moved under a pending write
  | "locked"
  | "unsupported"
  | "malformed" // a stored file cannot be read as what it should be
  | "forbidden" // outside the project or outside a declared root
  | "unavailable" // a tool, provider or server is not reachable
  | "internal"

export class ToolError extends Data.TaggedError("ToolError")<{
  readonly code: ErrorCode
  readonly message: string
  readonly fix?: string | undefined
  readonly details?: unknown
}> {
  // The CLI prints the error itself (plain or JSON); the runtime only sets the exit status.
  readonly [Runtime.errorReported] = false
  get [Runtime.errorExitCode](): number {
    return this.code === "invalid" ? 2 : 1
  }
  toJSON(): { code: ErrorCode; message: string; fix?: string; details?: unknown } {
    return {
      code: this.code,
      message: this.message,
      ...(this.fix === undefined ? {} : { fix: this.fix }),
      ...(this.details === undefined ? {} : { details: this.details })
    }
  }
}

export interface ErrorExtra {
  readonly fix?: string | undefined
  readonly details?: unknown
}

export const toolError = (code: ErrorCode, message: string, extra: ErrorExtra = {}): ToolError =>
  new ToolError({ code, message, fix: extra.fix, details: extra.details })

export const fail = (code: ErrorCode, message: string, extra?: ErrorExtra): Effect.Effect<never, ToolError> =>
  Effect.fail(toolError(code, message, extra))

/** Fail unless the condition holds. */
export const ensure = (condition: unknown, code: ErrorCode, message: string, extra?: ErrorExtra): Effect.Effect<void, ToolError> =>
  condition ? Effect.void : fail(code, message, extra)

/** For pure code that cannot return an Effect: throw, and convert at the boundary with `attempt`. */
export const raise = (code: ErrorCode, message: string, extra?: ErrorExtra): never => {
  throw toolError(code, message, extra)
}

export const isToolError = (value: unknown): value is ToolError => value instanceof ToolError

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** Convert anything thrown into a ToolError, keeping one that is already a ToolError. */
export const asToolError = (code: ErrorCode, what: string) => (cause: unknown): ToolError =>
  isToolError(cause) ? cause : toolError(code, `${what}: ${describe(cause)}`)

/** Run synchronous code that may throw (including `raise`). */
export const attempt = <A>(what: string, run: () => A, code: ErrorCode = "internal"): Effect.Effect<A, ToolError> =>
  Effect.try({ try: run, catch: asToolError(code, what) })

/** Run promise-returning code that may reject. */
export const attemptPromise = <A>(
  what: string,
  run: (signal: AbortSignal) => PromiseLike<A>,
  code: ErrorCode = "internal"
): Effect.Effect<A, ToolError> => Effect.tryPromise({ try: run, catch: asToolError(code, what) })
