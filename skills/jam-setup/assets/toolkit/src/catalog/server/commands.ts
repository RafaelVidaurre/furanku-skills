// The commands that involve a server: `open`, `stop`, `status`, `serve`, `capture`, and `example`
// (whose art is rendered in a browser). Defining them is cheap; the HTTP stack, the browser driver
// and the sample generator are imported only by the command that needs them.
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { readFileSync } from "node:fs"
import { Output } from "../../kernel/cli.ts"
import { fail, type ToolError, toolError } from "../../kernel/errors.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import type { ViewerTarget } from "../viewerActions.ts"
import { type Launch, openServer, serverStatus, stopServer } from "./control.ts"
import { allowedOrigins } from "./origins.ts"

const toolkit = (): string => (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version

/** This process, as a server reports itself. Read at the command edge, like every other ambient value. */
const identity = () => ({ pid: process.pid, toolkit: toolkit(), browser: { channel: process.env["CATALOG_BROWSER_CHANNEL"] } })

/** Set by `open` on the server it starts, so the record says who owns that server. */
const STARTED_BY = "JAM_CATALOG_STARTED_BY"

/** The same toolkit, started again as `catalog serve` for a project: how `open` launches the server. */
const launchFor = (root: string, allowOrigins: ReadonlyArray<string>): Launch => ({
  command: process.execPath,
  env: { [STARTED_BY]: "open" },
  args: [...process.execArgv, process.argv[1] ?? "", "catalog", "serve", "--root", root, "--port", "auto", ...allowOrigins.flatMap((origin) => ["--allow-origin", origin])],
  toolkit: toolkit(),
  allowOrigins
})

// Opt-in: a private HTTPS proxy in front of the loopback server (a person reviewing from a phone).
const allowOrigin = Flag.String("allow-origin").pipe(
  Flag.withDescription("Also admit this exact origin and its host, for a private HTTPS proxy in front of the server (repeatable)"),
  Flag.atLeast(0)
)
const originsOf = (given: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, ToolError> => Effect.map(allowedOrigins(given), (allowed) => [...allowed.origins])

const open = Command.make("open", { allowOrigin }, (flags) =>
  Effect.gen(function*() {
    const output = yield* Output
    const opened = yield* openServer(launchFor((yield* ProjectFiles).root, yield* originsOf(flags.allowOrigin)))
    yield* output.emit(opened, opened.url)
    yield* output.note(opened.started
      ? `started the catalog server (process ${opened.pid}); it keeps running after this command. Stop it with: jam catalog stop`
      : `the catalog server was already running (process ${opened.pid}${opened.startedBy === "serve" ? ", started with jam catalog serve" : ""})${opened.allowOrigins.length > 0 ? `; it also admits ${opened.allowOrigins.join(", ")}` : ""}`)
  })).pipe(Command.withDescription("Print the address of this checkout's catalog, starting its server when none is running"))

const stop = Command.make("stop", {}, () =>
  Effect.gen(function*() {
    const stopped = yield* stopServer
    yield* (yield* Output).emit(stopped, stopped.stopped ? `stopped the catalog server at ${stopped.url} (process ${stopped.pid})` : `nothing to stop: ${stopped.reason}`)
  })).pipe(Command.withDescription("Stop this checkout's catalog server"))

const status = Command.make("status", {}, () =>
  Effect.gen(function*() {
    const found = yield* serverStatus
    const current = toolkit()
    yield* (yield* Output).emit({ ...found, current: found.toolkit === null ? null : found.toolkit === current }, () =>
      found.running
        ? `running at ${found.url} (process ${found.pid}, since ${found.startedAt}${found.toolkit === current ? "" : found.startedBy === "serve" ? `, toolkit ${found.toolkit}; restart it where it was started to run ${current}` : `, toolkit ${found.toolkit}; jam catalog open replaces it with ${current}`})`
        : found.reason === null
        ? "not running. Start it with: jam catalog open"
        : `not running: the recorded server at ${found.url} is gone (${found.reason}). Start one with: jam catalog open`)
  })).pipe(Command.withDescription("Whether this checkout's catalog server is running, and where"))

const portOf = (given: Option.Option<string>): Effect.Effect<number | "auto", ToolError> => {
  const text = Option.getOrElse(given, () => "auto")
  if (text === "auto") return Effect.succeed("auto")
  const port = Number(text)
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? Effect.succeed(port) : fail("invalid", `--port must be a port number or auto, not ${text}`)
}

const serve = Command.make(
  "serve",
  { port: Flag.String("port").pipe(Flag.withDescription("Port to listen on (default: the first free port from 4600; 0: any free port)"), Flag.optional), allowOrigin },
  (flags) =>
    Effect.gen(function*() {
      const port = yield* portOf(flags.port)
      const allowOrigins = yield* originsOf(flags.allowOrigin)
      const { serve: program } = yield* Effect.promise(() => import("./programs.ts"))
      return yield* program({ ...identity(), port, record: true, allowOrigins, startedBy: process.env[STARTED_BY] === "open" ? "open" : "serve" })
    })
).pipe(Command.withDescription("Serve the catalog in the foreground until interrupted (127.0.0.1 only)"))

const TARGET = /^(unit|collection|asset|submission):(.+)$/
const targetOf = (text: string, part: Option.Option<string>, view: Option.Option<string>): Effect.Effect<ViewerTarget, ToolError> => {
  const match = TARGET.exec(text)
  if (!match) return fail("invalid", "--target must be unit:<id>, collection:<id>, asset:<id> or submission:<id>/<item>")
  const kind = match[1] as ViewerTarget["kind"]
  const rest = match[2]!
  const [id = "", item] = kind === "submission" ? rest.split("/") : [rest]
  return Effect.succeed({ kind, id, ...(item === undefined ? {} : { item }), ...(Option.isSome(part) ? { part: part.value } : {}), ...(Option.isSome(view) ? { view: view.value } : {}) })
}
const sizeOf = (given: Option.Option<string>): Effect.Effect<{ width: number; height: number } | undefined, ToolError> => {
  if (Option.isNone(given)) return Effect.succeed(undefined)
  const match = /^(\d+)x(\d+)$/.exec(given.value)
  return match ? Effect.succeed({ width: Number(match[1]), height: Number(match[2]) }) : fail("invalid", `--size must be <width>x<height>, for example 1280x860, not ${given.value}`)
}
const cameraOf = (given: Option.Option<string>): Effect.Effect<unknown, ToolError> =>
  Option.isNone(given) ? Effect.succeed(undefined) : Effect.try({
    try: () => JSON.parse(given.value) as unknown,
    catch: (cause) => toolError("invalid", `--camera is not valid JSON: ${(cause as Error).message}`, { fix: 'pass {"position":[x,y,z],"target":[x,y,z]}' })
  })

const capture = Command.make(
  "capture",
  {
    target: Flag.String("target").pipe(Flag.withDescription("What to capture: unit:<id>, collection:<id>, asset:<id> or submission:<id>/<item>")),
    part: Flag.String("part").pipe(Flag.withDescription("A part of the target (a role, or role:key)"), Flag.optional),
    view: Flag.String("view").pipe(Flag.withDescription("A view of a submission item"), Flag.optional),
    camera: Flag.String("camera").pipe(Flag.withDescription('Camera of a model as JSON: {"position":[x,y,z],"target":[x,y,z]}'), Flag.optional),
    mode: Flag.String("mode").pipe(Flag.withDescription("Surface of a model: textured, clay or wireframe"), Flag.optional),
    animation: Flag.String("animation").pipe(Flag.withDescription("An animation clip of a model, shown at its first frame"), Flag.optional),
    frame: Flag.Int("frame").pipe(Flag.withDescription("A frame of a sprite-sheet animation (from 0), shown paused"), Flag.optional),
    out: Flag.String("out").pipe(Flag.withDescription("Also write the PNG to this file"), Flag.optional),
    size: Flag.String("size").pipe(Flag.withDescription("Page size as <width>x<height> (default 1280x860)"), Flag.optional),
    url: Flag.String("url").pipe(Flag.withDescription("Capture through this running catalog server instead of a temporary one"), Flag.optional)
  },
  (flags) =>
    Effect.gen(function*() {
      const request = {
        target: yield* targetOf(flags.target, flags.part, flags.view),
        size: yield* sizeOf(flags.size),
        camera: yield* cameraOf(flags.camera),
        mode: Option.getOrUndefined(flags.mode),
        animation: Option.getOrUndefined(flags.animation),
        frame: Option.getOrUndefined(flags.frame),
        out: Option.getOrUndefined(flags.out),
        url: Option.getOrUndefined(flags.url)
      }
      const { capture: program } = yield* Effect.promise(() => import("./programs.ts"))
      // A capture's result is data for a program; it has no shorter text form.
      yield* (yield* Output).emit(yield* program(request, identity()))
    })
).pipe(Command.withDescription("Capture a unit, collection, asset or submission item as PNG through the catalog's own viewers"))

const example = Command.make(
  "example",
  {
    dir: Argument.String("dir").pipe(Argument.withDescription("An empty or new folder for the sample project")),
    noVideo: Flag.Boolean("no-video").pipe(Flag.withDescription("Leave out the video clips (they need ffmpeg)"), Flag.withDefault(false))
  },
  ({ dir, noVideo }) =>
    Effect.gen(function*() {
      const output = yield* Output
      // Progress is for a person waiting; a program gets the one JSON result (or the one error).
      if (!output.json) yield* output.note("creating the Hollowmere sample project (renders its art in a headless browser)...")
      const { createSample } = yield* Effect.promise(() => import("../../../examples/hollowmere/create.ts"))
      const summary = yield* createSample(dir, { videos: !noVideo })
      yield* output.emit(
        { ...summary, open: `jam catalog open --root ${summary.created}` },
        () => `Created Hollowmere in ${summary.created}: ${summary.units} units, ${summary.collections} collections, ${summary.assets} media files, ${summary.submissions} reviews, ${summary.openNotes} open notes${summary.videos ? "" : " (no video clips)"}.\nOpen it with: jam catalog open --root ${summary.created}`
      )
    })
).pipe(Command.withDescription("Create the Hollowmere sample project in an empty folder, for trying the catalog"))

export const serverCommands = [open, stop, status, serve, capture, example] as const
