// Helpers for the tests that need a running catalog server: the server and the catalog it serves
// share one engine, as in `jam catalog serve`, on a free loopback port that is never recorded.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { request } from "node:http"
import { ServerState } from "../../src/catalog/ServerState.ts"
import { launchBrowser } from "../../src/catalog/server/browser.ts"
import { Renderer } from "../../src/catalog/server/Renderer.ts"
import { CatalogServer, type ServeOptions } from "../../src/catalog/server/Server.ts"
import { type App, appOf, catalogLayer, type OpenOptions } from "./helpers.ts"

export interface TestServer {
  /** `http://127.0.0.1:<port>/` */
  readonly url: string
  readonly port: number
  /** The catalog this server serves (the same engine, not a second one). */
  readonly app: App
  /** Run a viewer action in the server's own renderer, as `/api/run/viewer.*` does. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewer(action: string, input?: unknown): Promise<any>
  close(): Promise<void>
}

export const startServer = async (root: string, options: OpenOptions & Partial<ServeOptions> = {}): Promise<TestServer> => {
  const serving = CatalogServer.layer({ port: options.port ?? 0, record: options.record ?? false, pid: process.pid, toolkit: options.toolkit ?? "test", browser: options.browser, allowOrigins: options.allowOrigins })
  const base = ServerState.layerNoDeps.pipe(Layer.provideMerge(catalogLayer(root, options)))
  const runtime = ManagedRuntime.make(serving.pipe(Layer.provideMerge(base)))
  const server = await runtime.runPromise(Effect.flatMap(CatalogServer, (running) => Effect.succeed(running))).catch(async (error) => {
    await runtime.dispose()
    throw error
  })
  const app = appOf(root, runtime as never)
  return {
    url: server.url,
    port: server.port,
    app,
    viewer: (action, input = {}) => app.effect(Effect.flatMap(Renderer, (renderer) => renderer.run(action, input)) as never),
    close: () => runtime.dispose()
  }
}

export interface RawResponse {
  readonly status: number
  readonly headers: Record<string, string | Array<string> | undefined>
  readonly body: Buffer
}

/** One HTTP request exactly as written: no client rewrites the path or adds headers. */
export const raw = (port: number, options: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Uint8Array } = {}): Promise<RawResponse> =>
  new Promise((done, failed) => {
    const sent = request({ host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path ?? "/", headers: { host: `127.0.0.1:${port}`, ...options.headers } }, (response) => {
      const chunks: Array<Buffer> = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => done({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }))
    })
    sent.on("error", failed)
    if (options.body !== undefined) sent.write(options.body)
    sent.end()
  })

/** Call an action as a non-browser client does. */
export const post = (port: number, action: string, payload: unknown, headers: Record<string, string> = {}): Promise<RawResponse> =>
  raw(port, { method: "POST", path: `/api/run/${action}`, headers: { "content-type": "application/json", "x-catalog-request": "1", ...headers }, body: JSON.stringify(payload) })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = (response: RawResponse): any => JSON.parse(response.body.toString())

/** A real browser for page tests, or null (with the reason) when none can be launched on this machine. */
export const browserOrSkip = async (): Promise<{ browser: Awaited<ReturnType<typeof launch>> } | { skip: string }> => {
  try {
    return { browser: await launch() }
  } catch (error) {
    return { skip: `no browser can be launched here: ${(error as Error).message}` }
  }
}
const launch = () => Effect.runPromise(launchBrowser())

// ── Page helpers for the browser tests ──────────────────────────────────────────────────────────
import { NodeIO } from "@gltf-transform/core"
import { mkdirSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Browser, BrowserContextOptions, Locator, Page } from "playwright"

declare global {
  interface Window {
    /** What the page gives agents and tests (web/controller.js). */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catalogViewer: any
  }
}

/** A page that records every uncaught error it raises. */
export type TestPage = Page & { readonly errors: Array<string> }
export const newPage = async (browser: Browser, options: BrowserContextOptions = {}): Promise<TestPage> => {
  const page = await browser.newPage(options)
  const errors: Array<string> = []
  page.on("pageerror", (error) => void errors.push(String(error)))
  return Object.assign(page, { errors })
}

/** Where one test file keeps its screenshots: `test-output/browser/<file name without .test.ts>/`. */
export const screenshots = (testFileUrl: string) => {
  const dir = join(fileURLToPath(new URL("../../test-output/browser/", import.meta.url)), basename(fileURLToPath(testFileUrl)).replace(/\.test\.ts$/u, ""))
  mkdirSync(dir, { recursive: true })
  return {
    dir,
    /** A screenshot of a page or of one element, as `<name>.png`. */
    shot: (target: Page | Locator, name: string): Promise<Buffer> => target.screenshot({ path: join(dir, `${name}.png`) }),
    /** Keep PNG bytes made elsewhere (a viewer capture) beside the screenshots. */
    save: (name: string, bytes: Uint8Array): void => writeFileSync(join(dir, `${name}.png`), bytes)
  }
}

/** A model with an embedded base colour texture (helpers.ts `glb` makes untextured ones). */
export const withTexture = async (model: Uint8Array, image: Uint8Array): Promise<Buffer> => {
  const io = new NodeIO()
  const doc = await io.readBinary(model)
  const texture = doc.createTexture("albedo").setImage(image).setMimeType("image/png")
  for (const material of doc.getRoot().listMaterials()) material.setBaseColorTexture(texture)
  return Buffer.from(await io.writeBinary(doc))
}

/** A unit type with several audio takes, as the audio and review layout tests use. */
export const soundType = {
  label: "Sound",
  thumb: "audio",
  fields: [{ key: "speaker", label: "Speaker" }, { key: "duration", label: "Duration", derived: true }],
  roles: [{ key: "audio", label: "Take", mediaKinds: ["audio"], many: true }]
}
