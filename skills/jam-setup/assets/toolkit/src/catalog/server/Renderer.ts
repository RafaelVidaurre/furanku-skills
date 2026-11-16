// Viewer sessions for agents: the real catalog page, driven in a headless browser. An agent reads
// the same viewer state a person sees, applies the same controls, and captures rendered pixels.
// Nothing is captured unless the page shows exactly what was asked for and its viewer is ready.
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"
import type { Browser, Page } from "playwright"
import { decode } from "../../kernel/decode.ts"
import { type ErrorCode, fail, type ToolError, toolError } from "../../kernel/errors.ts"
import { sha256 } from "../../kernel/hash.ts"
import { nowIso } from "../../kernel/Ids.ts"
import { Catalog } from "../Catalog.ts"
import { assetRoute, collectionRoute, reviewRoute, unitRoute } from "../routes.ts"
import { VIEWER_ACTIONS, type ViewerOpen, type ViewerTarget } from "../viewerActions.ts"
import { type BrowserOptions, launchBrowser } from "./browser.ts"

/** Where the page is served: known once the server listens (`http://127.0.0.1:<port>`, no trailing slash). */
export class PageAddress extends Context.Service<PageAddress, Deferred.Deferred<string>>()("jam/catalog/PageAddress") {
  static readonly layer: Layer.Layer<PageAddress> = Layer.effect(PageAddress, Deferred.make<string>())
}

/** What the page reports through `window.catalogViewer` (see web/controller.js). */
interface ViewerState {
  readonly route: string
  readonly selection: {
    readonly kind?: string
    readonly id?: string
    readonly part?: string
    readonly view?: string
    readonly submission?: string
    readonly item?: string
    readonly asset?: { readonly sha256?: string | null } | null
    readonly unavailable?: boolean
    readonly error?: string
  } | null
  readonly viewer: {
    readonly kind?: string | null
    readonly status?: string
    readonly error?: string | null
    readonly source?: { readonly part?: string; readonly view?: string; readonly sha256?: string | null } & Record<string, unknown>
  } | null
}
interface PageGlobal {
  readonly location: { hash: string }
  readonly catalogViewer: {
    readonly booted?: boolean
    settled(timeout: number): Promise<boolean>
    state(): ViewerState
    control(command: unknown): unknown
    /** How the active viewer's media kind describes a capture of it. */
    capture(): { readonly renderer: string; readonly blocked: string | null }
  }
}

interface Session {
  readonly page: Page
  readonly errors: Array<string>
  target: Record<string, unknown> | null
}

type Input = Readonly<Record<string, unknown>>
const SETTLE_MS = 20_000
const sessionOf = (input: Input): string => (typeof input["session"] === "string" ? input["session"] : "default")

const query = (target: ViewerTarget): string => {
  const params = new URLSearchParams()
  if (target.part) params.set("part", target.part)
  if (target.view) params.set("view", target.view)
  if (target.compare) params.set("cmp", target.compare)
  const text = params.toString()
  return text === "" ? "" : `?${text}`
}

/** The rendered viewer must show exactly the requested selection and its loaded bytes. */
const identityProblem = (target: Record<string, unknown> | null, state: ViewerState): string | null => {
  if (!target) return null
  const selection = state.selection ?? {}
  const source = state.viewer?.source ?? {}
  if (target["compare"]) return state.viewer?.kind === "compare" ? null : "view (no comparison is open)"
  if (target["kind"] === "unit") {
    if (selection.kind !== "unit" || selection.id !== target["id"]) return "content unit"
    if (target["part"] && (selection.part !== target["part"] || source.part !== target["part"])) return "part"
    if (source.sha256 && selection.asset?.sha256 && source.sha256 !== selection.asset.sha256) return "asset version"
  }
  if (target["kind"] === "submission") {
    if (selection.submission !== target["id"] || selection.item !== target["item"]) return "submission item"
    if (target["view"] && (selection.view !== target["view"] || source.view !== target["view"])) return "evidence view"
  }
  if (target["kind"] === "collection" && selection.kind === "collection" && selection.id !== target["id"]) return "collection"
  if (target["kind"] === "asset" && selection.id !== target["id"]) return "asset"
  return null
}

export class Renderer extends Context.Service<Renderer, {
  /** Run one viewer action (`viewer.open`, `.state`, `.control`, `.capture`, `.close`). */
  run(action: string, input: unknown): Effect.Effect<unknown, ToolError>
}>()("jam/catalog/Renderer") {
  /** Sessions live until the layer's scope closes; the browser starts with the first `viewer.open`. */
  static readonly layer = (options: BrowserOptions = {}): Layer.Layer<Renderer, never, Catalog | PageAddress> =>
    Layer.effect(
      Renderer,
      Effect.gen(function*() {
        const catalog = yield* Catalog
        const address = yield* PageAddress
        const sessions = new Map<string, Session>()
        // One action at a time: a page is a single thread of navigation and state.
        const turn = yield* Semaphore.make(1)
        let browser: Browser | null = null

        const onPage = <A>(what: string, run: () => Promise<A>, code: ErrorCode = "unavailable"): Effect.Effect<A, ToolError> =>
          Effect.tryPromise({ try: run, catch: (cause) => toolError(code, `${what}: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`) })

        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            for (const session of sessions.values()) await session.page.close().catch(() => undefined)
            sessions.clear()
            await browser?.close().catch(() => undefined)
            browser = null
          }))

        const existing = (name: string): Effect.Effect<Session, ToolError> => {
          const session = sessions.get(name)
          return session ? Effect.succeed(session) : fail("not_found", `no viewer session ${name}; call viewer.open first`)
        }
        const opened = (name: string): Effect.Effect<Session, ToolError> =>
          Effect.gen(function*() {
            const known = sessions.get(name)
            if (known) return known
            browser ??= yield* launchBrowser(options)
            const live = browser
            const page = yield* onPage("could not open a browser page", () => live.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }))
            const session: Session = { page, errors: [], target: null }
            page.on("pageerror", (error) => void session.errors.push(String(error)))
            sessions.set(name, session)
            return session
          })

        const stateOf = (page: Page): Effect.Effect<ViewerState, ToolError> =>
          onPage("could not read the viewer", () => page.evaluate(() => (globalThis as unknown as PageGlobal).catalogViewer.state()))
        /** Wait until the page has rendered the current address and its viewer stopped loading. */
        const settled = (page: Page): Effect.Effect<ViewerState, ToolError> =>
          Effect.gen(function*() {
            yield* onPage("the catalog page did not start", () => page.waitForFunction(() => (globalThis as unknown as PageGlobal).catalogViewer?.booted === true, null, { timeout: SETTLE_MS }))
            yield* onPage("the viewer did not settle", () => page.evaluate((timeout) => (globalThis as unknown as PageGlobal).catalogViewer.settled(timeout), SETTLE_MS))
            return yield* stateOf(page)
          })

        const routeFor = (target: ViewerTarget): Effect.Effect<string, ToolError> =>
          Effect.gen(function*() {
            if (target.kind === "submission") {
              if (!target.item) return yield* fail("invalid", "submission targets need an item")
              return `${reviewRoute(target.id, target.item)}${query(target)}`
            }
            if (target.kind === "collection") return `${collectionRoute(target.id)}${target.member ? `/${encodeURIComponent(target.member)}` : ""}${query(target)}`
            if (target.kind === "asset") return `${assetRoute(target.id)}${query(target)}`
            // A unit is shown under its scope; one the catalog does not know is opened anyway, so
            // the page can say it is not available.
            const schema = (yield* catalog.run("schema", {})) as { readonly scopes: ReadonlyArray<{ readonly id: string }>; readonly unitScopes: Readonly<Record<string, string>> }
            return `${unitRoute(schema.unitScopes[target.id] ?? schema.scopes[0]?.id ?? "content", target.id)}${query(target)}`
          })

        const open = (input: typeof ViewerOpen.Type, name: string) =>
          Effect.gen(function*() {
            const route = yield* routeFor(input.target)
            const base = yield* Deferred.await(address)
            const session = yield* opened(name)
            const { page } = session
            const size = input.size
            if (size) yield* onPage("could not size the page", () => page.setViewportSize(size))
            // The same page is reused across targets: only its address changes.
            if (page.url().startsWith(base)) yield* onPage("could not navigate", () => page.evaluate((hash) => { (globalThis as unknown as PageGlobal).location.hash = hash }, route))
            else yield* onPage("could not load the catalog page", () => page.goto(`${base}/?agent=1${route}`))
            const state = yield* settled(page)
            session.target = { ...input.target }
            if (state.selection?.unavailable) return yield* fail("not_found", state.selection.error ?? "the requested selection is not available", { details: { state } })
            return { session: name, state, pageErrors: session.errors.splice(0) }
          })

        const control = (input: Input, name: string) =>
          Effect.gen(function*() {
            const session = yield* existing(name)
            const { session: _session, ...command } = input
            const outcome = (yield* onPage("the control could not be applied", () => session.page.evaluate((cmd) => (globalThis as unknown as PageGlobal).catalogViewer.control(cmd), command as never))) as
              | { readonly error?: string; readonly code?: ErrorCode; readonly details?: unknown }
              | null
              | undefined
            if (outcome?.error) return yield* fail(outcome.code ?? "unsupported", outcome.error, { details: outcome.details })
            if (command["select"] && typeof command["select"] === "object" && session.target) Object.assign(session.target, command["select"])
            return { session: name, state: yield* settled(session.page), pageErrors: session.errors.splice(0) }
          })

        const capture = (name: string) =>
          Effect.gen(function*() {
            const session = yield* existing(name)
            const { page } = session
            const state = yield* settled(page)
            if (state.selection?.unavailable) return yield* fail("unavailable", `the selection is not available (${state.selection.error}); nothing was captured`, { details: { state } })
            const mismatch = identityProblem(session.target, state)
            if (mismatch !== null) {
              return yield* fail("conflict", `viewer shows a different ${mismatch} than requested; nothing was captured`, { details: { requested: session.target, selection: state.selection, source: state.viewer?.source ?? {} } })
            }
            const unready = (reason: string) => fail("unavailable", `viewer is not showing ready media (${reason}); nothing was captured`, { details: { state } })
            if (state.viewer?.status !== "ready") return yield* unready(`${state.viewer?.status ?? "nothing selected"}${state.viewer?.error ? `: ${state.viewer.error}` : ""}`)
            // The media kind that is showing says what a capture of it is, and may still refuse one.
            const described = yield* onPage("could not describe the capture", () => page.evaluate(() => (globalThis as unknown as PageGlobal).catalogViewer.capture()))
            if (described.blocked !== null) return yield* unready(described.blocked)
            const shot = yield* onPage("the capture failed", async () => {
              const element = page.locator('[data-viewer-root][data-active="true"]').last()
              const png = await element.screenshot({ type: "png", animations: "disabled" })
              return { png, box: await element.boundingBox() }
            })
            const digest = sha256(shot.png)
            const stamp = (yield* nowIso).replace(/[:.]/g, "-")
            const file = yield* catalog.writeLocal(`captures/${stamp}-${digest.slice(0, 8)}.png`, shot.png)
            return {
              session: name,
              file,
              sha256: digest,
              width: Math.round(shot.box?.width ?? 0),
              height: Math.round(shot.box?.height ?? 0),
              shows: state.viewer.source,
              // A catalog render of the loaded media, not a screenshot of the running project.
              renderer: `${described.renderer}, headless Chromium`,
              state
            }
          })

        const close = (name: string) =>
          Effect.gen(function*() {
            const session = sessions.get(name)
            if (session) {
              sessions.delete(name)
              yield* Effect.promise(() => session.page.close().catch(() => undefined))
            }
            return { closed: name }
          })

        const run = (action: string, input: unknown): Effect.Effect<unknown, ToolError> =>
          Effect.gen(function*() {
            const definition = VIEWER_ACTIONS.find((candidate) => candidate.name === action)
            if (!definition) return yield* fail("not_found", `unknown viewer action ${action}`)
            const decoded = (yield* (decode(definition.input, { what: `input of ${action}` })(input ?? {}) as Effect.Effect<unknown, ToolError>)) as Input
            const name = sessionOf(decoded)
            if (action === "viewer.open") return yield* open(decoded as unknown as typeof ViewerOpen.Type, name)
            if (action === "viewer.close") return yield* close(name)
            if (action === "viewer.state") return { session: name, state: yield* stateOf((yield* existing(name)).page) }
            if (action === "viewer.control") return yield* control(decoded, name)
            return yield* capture(name)
          })

        return { run: (action, input) => turn.withPermit(run(action, input)) }
      })
    )
}
