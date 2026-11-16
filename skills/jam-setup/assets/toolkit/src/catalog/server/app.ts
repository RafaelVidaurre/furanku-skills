// The routes of the catalog server. The page and HTTP agents call the same actions as the CLI;
// media, evidence and declared project modules are the only files it hands out, each through the
// catalog's own confinement.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { readFileSync } from "node:fs"
import * as nodePath from "node:path"
import { decode } from "../../kernel/decode.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import type { Catalog } from "../Catalog.ts"
import { isViewerAction, viewerActionInfo } from "../viewerActions.ts"
import { bytesResponse, confined, fileResponse } from "./files.ts"
import type { Handler, Request, Response } from "./http.ts"
import type { Renderer } from "./Renderer.ts"
import { json, MAX_BODY, MEDIA_CSP, pageCsp, refusal, refused, runRefusal, SCRIPT_CSP } from "./security.ts"

/** Where the page's own files and its browser packages are, and who this server is. */
export interface AppConfig {
  /** The folder holding index.html and the page's modules. */
  readonly web: string
  /** The `node_modules` folder holding the browser packages. */
  readonly modules: string
  /** Reported by `/api/health`, so a command can tell this server from another process. */
  readonly identity: { readonly pid: number; readonly toolkit: string; readonly root: string }
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
}
const SCRIPT = TYPES[".js"]!

// The browser packages the page imports, each confined to one folder of its package.
const VENDOR: ReadonlyArray<readonly [prefix: string, folder: string]> = [
  ["preact/", "preact/dist"],
  ["preact-hooks/", "preact/hooks/dist"],
  ["htm/", "htm/dist"],
  ["marked/", "marked/lib"],
  ["dompurify/", "dompurify/dist"],
  ["three/", "three/build"],
  ["three-addons/", "three/examples/jsm"]
]

const IMMUTABLE = "private, max-age=31536000, immutable"
const NOT_FOUND = refused(404, "not_found", "not found")
const reading = (request: Request): boolean => request.method === "GET" || request.method === "HEAD"

const RunBody = Schema.Struct({
  input: Schema.optionalKey(Schema.Unknown),
  actor: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: Schema.optionalKey(Schema.Unknown), kind: Schema.optionalKey(Schema.Unknown) }))),
  requestId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  context: Schema.optionalKey(Schema.NullOr(Schema.String))
})

const decoded = (text: string): Effect.Effect<string, ToolError> =>
  Effect.try({ try: () => decodeURIComponent(text), catch: () => null }).pipe(Effect.catch(() => fail("invalid", "bad path")))

/** The request handler for one catalog, listening on `port`. */
export const makeHandler = (catalog: Catalog["Service"], renderer: Renderer["Service"], config: AppConfig, port: number): Handler => {
  const indexHtml = readFileSync(nodePath.join(config.web, "index.html"), "utf8")
  const importMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? ""
  const page: Response = {
    status: 200,
    headers: { "content-type": TYPES[".html"]!, "content-security-policy": pageCsp(importMap), "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-cache" },
    body: { kind: "text", text: indexHtml }
  }

  const run = (request: Request, name: string): Effect.Effect<Response, ToolError> =>
    Effect.gen(function*() {
      const no = runRefusal(request)
      if (no !== null) return refused(no.status, no.code, no.message)
      const body = yield* decode(RunBody, { what: "request body" })(yield* request.json(MAX_BODY))
      if (isViewerAction(name)) return json(200, yield* renderer.run(name, body.input ?? {}))
      // The page acts as the local Git user, a person. Every other client declares who it is.
      const actor = body.actor ?? (request.header("x-catalog-client") === "web" ? yield* catalog.defaultActor : undefined)
      return json(200, yield* catalog.run(name, body.input ?? {}, { actor, requestId: body.requestId ?? undefined, context: body.context ?? undefined }))
    })

  const script = (request: Request, module: { readonly bytes: Uint8Array; readonly sha256: string }): Response => {
    // A pinned request must get exactly that revision.
    const wanted = request.query.get("v")
    if (wanted && !module.sha256.startsWith(wanted)) return refused(409, "conflict", `module revision ${wanted} is not available (current ${module.sha256.slice(0, 16)})`)
    return bytesResponse(request, module.bytes, { "content-type": SCRIPT, etag: `"${module.sha256}"`, "cache-control": "no-cache", "content-security-policy": SCRIPT_CSP })
  }

  const frozen = (request: Request, media: { readonly bytes: Uint8Array; readonly mime: string | undefined; readonly sha256: string }): Response =>
    bytesResponse(request, media.bytes, { "content-type": media.mime ?? "application/octet-stream", etag: `"${media.sha256}"`, "cache-control": IMMUTABLE, "content-security-policy": MEDIA_CSP })

  /** The three identifiers of an evidence address, each one path segment. */
  const three = (rest: string): Effect.Effect<readonly [string, string, string] | null, ToolError> =>
    Effect.gen(function*() {
      const segments = rest.split("/")
      if (segments.length !== 3) return null
      const [a, b, c] = yield* Effect.forEach(segments, decoded)
      return [a!, b!, c!] as const
    })

  const staticFile = (request: Request, base: string, relative: string, allowed: (extension: string) => string | undefined): Effect.Effect<Response> =>
    Effect.gen(function*() {
      const type = allowed(nodePath.extname(relative))
      const file = type === undefined ? null : yield* Effect.promise(() => confined(base, relative))
      if (type === undefined || file === null) return NOT_FOUND
      return fileResponse(request, file.path, file.size, { "content-type": type, "cache-control": "no-cache", "content-security-policy": SCRIPT_CSP })
    })

  return (request) =>
    Effect.gen(function*() {
      const no = refusal(request, port)
      if (no !== null) return refused(403, "forbidden", no)
      const path = yield* decoded(request.rawPath)
      const under = (prefix: string): string | null => (request.rawPath.startsWith(prefix) ? request.rawPath.slice(prefix.length) : null)

      if (path === "/api/actions" && request.method === "GET") return json(200, { actions: [...(yield* catalog.discover), ...viewerActionInfo()] })
      if (path === "/api/health" && request.method === "GET") return json(200, { ok: true, ...config.identity })
      if (path.startsWith("/api/run/")) return yield* run(request, path.slice("/api/run/".length))

      // Everything else is a file: read-only.
      if (!reading(request)) return refused(405, "invalid", "use GET")

      if (path.startsWith("/media/asset/")) {
        const asset = yield* catalog.assetFile(path.slice("/media/asset/".length))
        // The address carries the file's version: that exact answer never changes.
        const pinned = request.query.get("v") === asset.version
        return fileResponse(request, asset.file, asset.size, { "content-type": asset.mime, "cache-control": pinned ? IMMUTABLE : "no-cache", "content-security-policy": MEDIA_CSP })
      }
      const evidence = under("/media/evidence/")
      if (evidence !== null) {
        const ids = yield* three(evidence)
        return ids === null ? NOT_FOUND : frozen(request, yield* catalog.evidenceMedia(ids[0], ids[1], ids[2], request.query.get("leaf") ?? ""))
      }
      const before = under("/media/before/")
      if (before !== null) {
        const ids = yield* three(before)
        return ids === null ? NOT_FOUND : frozen(request, yield* catalog.beforeMedia(ids[0], ids[1], ids[2]))
      }
      // Trusted project code for the page, by declared name only: no path is ever taken from the address.
      const preview = under("/project/preview/")
      if (preview !== null) return script(request, yield* catalog.previewModule(yield* decoded(preview)))
      const kind = under("/project/kind/")
      if (kind !== null) return script(request, yield* catalog.kindModule(yield* decoded(kind)))

      if (path.startsWith("/vendor/")) {
        const rest = path.slice("/vendor/".length)
        const entry = VENDOR.find(([prefix]) => rest.startsWith(prefix))
        if (!entry) return NOT_FOUND
        return yield* staticFile(request, nodePath.join(config.modules, entry[1]), rest.slice(entry[0].length), (extension) => (extension === ".js" || extension === ".mjs" ? SCRIPT : undefined))
      }
      if (path === "/" || path === "/index.html") return page
      return yield* staticFile(request, config.web, path.slice(1), (extension) => TYPES[extension])
    })
}
