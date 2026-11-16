// The rules that make a local server safe to leave running: who may talk to it and what a
// response is allowed to do in a browser. Pure; the routes apply them.
import { createHash } from "node:crypto"
import type { ErrorCode, ToolError } from "../../kernel/errors.ts"
import { type AllowedOrigins, NO_ORIGINS } from "./origins.ts"
import type { Request, Response } from "./http.ts"

/** The server listens here and nowhere else: it is reachable from this machine only. */
export const LOOPBACK = "127.0.0.1"

/** Largest request body read, in bytes. */
export const MAX_BODY = 1 << 20

/** The names a browser on this machine can reach the server by. */
const hostsOf = (port: number): ReadonlyArray<string> => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]

/**
 * Why a request is refused before any route sees it, or null. A page on another site can make a
 * browser send requests here (and a hostile DNS name can point at 127.0.0.1), so the Host header
 * must name this server and an Origin, when sent, must be this server: its loopback address, or
 * an origin admitted exactly as given (scheme, host and port).
 */
export const refusal = (request: Request, port: number, allowed: AllowedOrigins = NO_ORIGINS): string | null => {
  const hosts = hostsOf(port)
  const host = request.header("host") ?? ""
  if (!hosts.includes(host) && !allowed.hosts.has(host)) return "unexpected Host header"
  const origin = request.header("origin")
  if (origin !== undefined && !hosts.some((loopback) => origin === `http://${loopback}`) && !allowed.origins.has(origin)) return "cross-origin requests are not allowed"
  return null
}

/**
 * Why a call of `/api/run` is refused, with its status, or null. A cross-site form can post, but
 * it can neither set a custom header nor send JSON, so both are required.
 */
export const runRefusal = (request: Request): { readonly status: number; readonly code: ErrorCode; readonly message: string } | null => {
  if (request.method !== "POST") return { status: 405, code: "invalid", message: "use POST" }
  if (!/^application\/json\b/.test(request.header("content-type") ?? "")) return { status: 415, code: "invalid", message: "content-type must be application/json" }
  if (request.header("x-catalog-request") !== "1") return { status: 403, code: "forbidden", message: "missing X-Catalog-Request header" }
  return null
}

/** Media is shown, never run: no scripts, no navigation, no requests of its own. */
export const MEDIA_CSP = "default-src 'none'; sandbox"
/** A script file is loaded by the page; opened on its own it can do nothing. */
export const SCRIPT_CSP = "default-src 'none'"

/**
 * The page's policy: scripts and styles from this server only (the import map is allowed by its
 * hash), media from this server or generated in the page, nothing framed, nothing posted away.
 */
export const pageCsp = (importMap: string): string =>
  // 'wasm-unsafe-eval' admits compiling WebAssembly only (a view's mesh decoder); evaluating JavaScript stays refused.
  `default-src 'none'; script-src 'self' 'sha256-${createHash("sha256").update(importMap).digest("base64")}' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

const STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  context_changed: 409,
  locked: 423,
  malformed: 422,
  unsupported: 422,
  unavailable: 503,
  internal: 500
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }

export const json = (status: number, value: unknown, headers: Readonly<Record<string, string>> = {}): Response => ({
  status,
  headers: { ...JSON_HEADERS, ...headers },
  body: { kind: "text", text: JSON.stringify(value) }
})

export const refused = (status: number, code: ErrorCode, message: string): Response => json(status, { error: { code, message } })

/** A failed action as its HTTP answer: the same code, message, fix and details the CLI prints. */
export const errorResponse = (error: ToolError): Response =>
  json(STATUS[error.code], { error: { code: error.code, message: error.message, ...(error.fix === undefined ? {} : { fix: error.fix }), details: error.details ?? null } })
