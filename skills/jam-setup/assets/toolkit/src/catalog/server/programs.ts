// The programs behind the commands that serve: `serve` in the foreground and `capture`. This
// module loads the HTTP stack, so the command group imports it only when one of them runs.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import { Output } from "../../kernel/cli.ts"
import { attemptPromise, fail, type ToolError } from "../../kernel/errors.ts"
import type { Git } from "../../kernel/Git.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Catalog } from "../Catalog.ts"
import type { ServerState } from "../ServerState.ts"
import type { ViewerTarget } from "../viewerActions.ts"
import { callAction, health } from "./client.ts"
import { Renderer } from "./Renderer.ts"
import { CatalogServer, type ServeOptions } from "./Server.ts"

type Services = Catalog | ServerState | ProjectFiles | Git | Output

/** Serve until interrupted (Ctrl+C, a stop signal); the server is closed in order on the way out. */
export const serve = (options: ServeOptions): Effect.Effect<never, ToolError, Services> => {
  const announce = Layer.effectDiscard(Effect.gen(function*() {
    const server = yield* CatalogServer
    const output = yield* Output
    const checkout = yield* (yield* Catalog).context
    yield* output.emit(
      { url: server.url, port: server.port, pid: options.pid, project: checkout.name, branch: checkout.branch, recorded: server.recorded },
      `Catalog for ${checkout.name} (${checkout.branch ?? "detached"}) at ${server.url}`
    )
    if (options.record && !server.recorded) yield* output.note("another catalog server is already recorded for this checkout; this one is not (`jam catalog status` shows which)")
  }))
  return Layer.launch(announce.pipe(Layer.provide(CatalogServer.layer(options))))
}

export interface CaptureRequest {
  readonly target: ViewerTarget
  readonly size?: { readonly width: number; readonly height: number } | undefined
  readonly camera?: unknown
  readonly mode?: string | undefined
  /** An animation clip, shown paused at its first frame. */
  readonly animation?: string | undefined
  /** Copy the capture to this file (any path on this machine), from the checkout of the server that took it. */
  readonly out?: string | undefined
  /** A running server to capture through, instead of a temporary one. */
  readonly url?: string | undefined
}

const SESSION = "cli"

/**
 * One capture: open the target in a viewer session, apply the controls, capture the ready viewer.
 * Without `url` a temporary server and browser are started for this capture and closed after it.
 */
export const capture = (request: CaptureRequest, server: Omit<ServeOptions, "port" | "record">): Effect.Effect<unknown, ToolError, Services> =>
  Effect.gen(function*() {
    const controls = {
      ...(request.camera === undefined ? {} : { camera: request.camera }),
      ...(request.mode === undefined ? {} : { mode: request.mode }),
      ...(request.animation === undefined ? {} : { animation: { clip: request.animation, time: 0, playing: false } })
    }
    const steps = (run: (action: string, input: unknown) => Effect.Effect<unknown, ToolError>) =>
      Effect.gen(function*() {
        yield* run("viewer.open", { target: request.target, session: SESSION, ...(request.size === undefined ? {} : { size: request.size }) })
        if (Object.keys(controls).length > 0) yield* run("viewer.control", { session: SESSION, ...controls })
        return (yield* run("viewer.capture", { session: SESSION })) as { file: string } & Record<string, unknown>
      })
    const url = request.url
    // The capture is saved in the checkout of the server that took it: a running one (its health
    // answer names its folder), or a temporary one for this checkout.
    const { captured, root } = url !== undefined
      ? {
        captured: yield* steps((action, input) => callAction(url, action, { input })),
        root: request.out === undefined ? "" : (yield* health(url))?.root ?? (yield* fail("unavailable", `the catalog server at ${url} stopped answering; the capture was not copied`))
      }
      : {
        captured: yield* Effect.flatMap(Renderer, (renderer) => steps(renderer.run)).pipe(
          Effect.provide(CatalogServer.layer({ ...server, port: 0, record: false })),
          Effect.scoped
        ),
        root: (yield* ProjectFiles).root
      }
    if (request.out === undefined) return captured
    const out = nodePath.resolve(request.out)
    yield* attemptPromise(`write ${out}`, async () => {
      await fsp.mkdir(nodePath.dirname(out), { recursive: true })
      await fsp.copyFile(nodePath.join(root, ...captured.file.split("/")), out)
    }, "unavailable")
    return { ...captured, file: out }
  })
