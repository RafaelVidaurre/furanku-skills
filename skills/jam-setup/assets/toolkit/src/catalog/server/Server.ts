// A running catalog server: the page, the action API, media and the viewer sessions, on one
// loopback port. It is a scoped resource: closing its scope closes the viewer sessions and the
// browser, stops listening and removes its record. Loaded only by commands that serve.
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { existsSync } from "node:fs"
import * as nodePath from "node:path"
import { fileURLToPath } from "node:url"
import { type ToolError } from "../../kernel/errors.ts"
import { nowIso } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Catalog } from "../Catalog.ts"
import { ServerState } from "../ServerState.ts"
import { makeHandler } from "./app.ts"
import type { BrowserOptions } from "./browser.ts"
import { isPortTaken, listen } from "./http.ts"
import { PageAddress, Renderer } from "./Renderer.ts"
import { allowedOrigins } from "./origins.ts"
import { errorResponse, LOOPBACK } from "./security.ts"

/** The first port tried when none is asked for, and how many after it. */
export const FIRST_PORT = 4600
const PORTS_TRIED = 100

export interface ServeOptions {
  /** A port to listen on (0: any free one), or `auto`: the first free port from 4600 up. */
  readonly port: number | "auto"
  /**
   * Record this server as the checkout's (`.catalog/.local/server.json`), so later commands and
   * action results can link to it. A temporary server (one capture) is not recorded, and neither
   * is a second server beside a recorded one that is still running.
   */
  readonly record: boolean
  readonly pid: number
  /** The toolkit's version, so a newer toolkit can tell an older server apart. */
  readonly toolkit: string
  readonly browser?: BrowserOptions | undefined
  /** Exact origins admitted besides this machine's: a private HTTPS proxy in front of the server. */
  readonly allowOrigins?: ReadonlyArray<string> | undefined
}

const toolkitRoot = fileURLToPath(new URL("../../../", import.meta.url))

/** The nearest `node_modules` holding the browser packages: the toolkit's own, or a workspace root's. */
const browserModules = (): string => {
  for (let dir = toolkitRoot;;) {
    const modules = nodePath.join(dir, "node_modules")
    if (existsSync(nodePath.join(modules, "three"))) return modules
    const up = nodePath.dirname(dir)
    if (up === dir) return nodePath.join(toolkitRoot, "node_modules")
    dir = up
  }
}

export class CatalogServer extends Context.Service<CatalogServer, {
  /** `http://127.0.0.1:<port>/` */
  readonly url: string
  readonly port: number
  /** Whether this server is the one recorded for the checkout. */
  readonly recorded: boolean
}>()("jam/catalog/CatalogServer") {
  static readonly layerNoDeps = (options: ServeOptions): Layer.Layer<CatalogServer, ToolError, Catalog | Renderer | PageAddress | ServerState | ProjectFiles> =>
    Layer.effect(
      CatalogServer,
      Effect.gen(function*() {
        const scope = yield* Effect.scope
        const catalog = yield* Catalog
        const renderer = yield* Renderer
        const address = yield* PageAddress
        const state = yield* ServerState
        const root = (yield* ProjectFiles).root
        const allowOrigins = options.allowOrigins ?? []
        const config = { web: nodePath.join(toolkitRoot, "catalog", "web"), modules: browserModules(), identity: { pid: options.pid, toolkit: options.toolkit, root }, allowed: yield* allowedOrigins(allowOrigins) }
        const bound = yield* Deferred.make<number>()

        const listenOn = (port: number) =>
          Layer.buildWithScope(
            listen({ port, host: LOOPBACK, requestTimeoutMs: 120_000 }, (listening) =>
              Effect.gen(function*() {
                yield* Deferred.succeed(bound, listening.port)
                yield* Deferred.succeed(address, `http://${LOOPBACK}:${listening.port}`)
                return makeHandler(catalog, renderer, config, listening.port)
              }), errorResponse),
            scope
          )
        if (options.port === "auto") {
          // The first free port from 4600: a second checkout's server takes the next one.
          for (let port = FIRST_PORT;; port++) {
            const tried = yield* Effect.result(listenOn(port))
            if (tried._tag === "Success") break
            if (!isPortTaken(tried.failure) || port === FIRST_PORT + PORTS_TRIED - 1) return yield* Effect.fail(tried.failure)
          }
        } else yield* listenOn(options.port)

        const port = yield* Deferred.await(bound)
        const url = `http://${LOOPBACK}:${port}/`
        const record = options.record && (yield* state.known) === null
        if (record) {
          yield* state.write({ pid: options.pid, port, url, toolkit: options.toolkit, startedAt: yield* nowIso, allowOrigins: [...config.allowed.origins] })
          yield* Effect.addFinalizer(() => state.clear(options.pid))
        }
        return { url, port, recorded: record }
      })
    )

  /**
   * The server with its viewer sessions; needs the catalog it serves and the kernel. The
   * `Renderer` is given too, so code in the same process can run viewer actions without HTTP.
   */
  static readonly layer = (options: ServeOptions): Layer.Layer<CatalogServer | Renderer, ToolError, Catalog | ServerState | ProjectFiles> =>
    CatalogServer.layerNoDeps(options).pipe(Layer.provideMerge(Renderer.layer(options.browser)), Layer.provide(PageAddress.layer))
}
