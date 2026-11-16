// The one module that touches `effect/http` and the Node HTTP platform. The rest of the server is
// written against the small request and response model below, so a change in that (still
// unstable) API is a change to this file only.
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as HttpServer from "effect/http/HttpServer"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { createServer } from "node:http"
import { fail, isToolError, type ToolError, toolError } from "../../kernel/errors.ts"

/** A request as route handlers see it. */
export interface Request {
  readonly method: string
  /** The path as it was sent: still percent-encoded, without the query. */
  readonly rawPath: string
  readonly query: URLSearchParams
  /** A request header by lower-case name. */
  header(name: string): string | undefined
  /** The body parsed as JSON (an empty body is `{}`). Reading stops once `maxBytes` is exceeded. */
  json(maxBytes: number): Effect.Effect<unknown, ToolError>
}

export type Body =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "bytes"; readonly bytes: Uint8Array }
  /** Part of a file on disk, streamed. */
  | { readonly kind: "file"; readonly path: string; readonly offset: number; readonly length: number }

export interface Response {
  readonly status: number
  /** Lower-case header names, `content-type` among them. The platform adds `content-length`. */
  readonly headers: Readonly<Record<string, string>>
  readonly body: Body
}

/** Answers every request. Failing with a ToolError is an answer too: the error as JSON. */
export type Handler = (request: Request) => Effect.Effect<Response, ToolError>

/** How an unanswered failure is turned into a response (status codes, headers). */
export type ErrorResponse = (error: ToolError) => Response

const fromPlatform = (request: HttpServerRequest.HttpServerRequest): Request => {
  const mark = request.url.indexOf("?")
  return {
    method: request.method,
    rawPath: mark === -1 ? request.url : request.url.slice(0, mark),
    query: new URLSearchParams(mark === -1 ? "" : request.url.slice(mark + 1)),
    header: (name) => request.headers[name],
    json: (maxBytes) =>
      Effect.gen(function*() {
        const chunks: Array<Uint8Array> = []
        let size = 0
        yield* Stream.runForEach(request.stream, (chunk) => {
          size += chunk.length
          if (size > maxBytes) return fail("invalid", "request body too large")
          chunks.push(chunk)
          return Effect.void
        }).pipe(Effect.mapError((error) => (isToolError(error) ? error : toolError("invalid", "request body could not be read"))))
        if (size === 0) return {}
        return yield* Effect.try({
          try: () => JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
          catch: () => toolError("invalid", "request body is not valid JSON")
        })
      })
  }
}

const toPlatform = (response: Response) => {
  const { "content-type": contentType, ...headers } = response.headers
  const options = { status: response.status, headers, ...(contentType === undefined ? {} : { contentType }) }
  const body = response.body
  switch (body.kind) {
    case "empty":
      return Effect.succeed(HttpServerResponse.empty({ status: response.status, headers: response.headers }))
    case "text":
      return Effect.succeed(HttpServerResponse.text(body.text, options))
    case "bytes":
      return Effect.succeed(HttpServerResponse.uint8Array(body.bytes, options))
    case "file":
      return HttpServerResponse.file(body.path, { ...options, offset: body.offset, bytesToRead: body.length })
  }
}

/** The handler as the platform runs it: every failure and every defect becomes a response. */
const platformApp = (handler: Handler, onError: ErrorResponse) =>
  Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    const answered = yield* handler(fromPlatform(request)).pipe(
      Effect.catch((error) => Effect.succeed(onError(error))),
      Effect.catchCause((cause) => Effect.succeed(onError(toolError("internal", Cause.pretty(cause)))))
    )
    return yield* toPlatform(answered).pipe(
      // The file vanished between the lookup and the read.
      Effect.catch(() => toPlatform(onError(toolError("not_found", "not found"))).pipe(Effect.orDie))
    )
  })

export interface Listening {
  readonly port: number
}

export interface ListenOptions {
  /** 0 picks any free port. */
  readonly port: number
  readonly host: string
  /** How long requests may take to arrive in full, in milliseconds. */
  readonly requestTimeoutMs: number
}

/** Whether a failure to start listening was the port being taken. */
export const isPortTaken = (error: ToolError): boolean => /EADDRINUSE/.test(error.message)

/**
 * Listen and answer until the scope closes; closing it stops accepting, lets requests in flight
 * finish, and frees the port. `handler` is built once, with the bound port, before the first
 * request is answered.
 */
export const listen = <R>(
  options: ListenOptions,
  handler: (listening: Listening) => Effect.Effect<Handler, ToolError, R>,
  onError: ErrorResponse
): Layer.Layer<never, ToolError, Exclude<R, Scope.Scope>> => {
  const serving = Effect.gen(function*() {
    const server = yield* HttpServer.HttpServer
    const address = server.address
    if (address._tag === "UnixPathAddress") return yield* fail("internal", "the catalog server listens on a TCP port only")
    yield* HttpServer.serveEffect()(platformApp(yield* handler({ port: address.port }), onError))
  })
  const listener = NodeHttpServer.layer(() => createServer({ requestTimeout: options.requestTimeoutMs }), {
    port: options.port,
    host: options.host,
    gracefulShutdownTimeout: "2 seconds"
  }).pipe(
    Layer.catchTag("ServeError", (error) =>
      // The handler gives no server: its failure is the layer's.
      Layer.effectDiscard(fail("unavailable", `the catalog server could not listen on ${options.host}:${options.port}: ${String(error.cause)}`)) as never)
  ) as Layer.Layer<Layer.Success<ReturnType<typeof NodeHttpServer.layer>>, ToolError>
  return Layer.effectDiscard(serving).pipe(Layer.provide(listener)) as Layer.Layer<never, ToolError, Exclude<R, Scope.Scope>>
}
