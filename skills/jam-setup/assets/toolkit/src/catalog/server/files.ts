// Answers that carry bytes: media, scripts and the page's own files. Byte ranges are honoured so
// audio and video can seek; every answer says what it is and forbids the browser from guessing.
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import type { Request, Response } from "./http.ts"

const RANGE = /^bytes=(\d*)-(\d*)$/

/** The part of `size` bytes a Range header asks for; `unsatisfiable` when it lies outside. */
export const rangeOf = (header: string | undefined, size: number): { readonly start: number; readonly end: number } | "unsatisfiable" | null => {
  const match = RANGE.exec(header ?? "")
  if (!match || size === 0 || (match[1] === "" && match[2] === "")) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  return start > end || start >= size ? "unsatisfiable" : { start, end }
}

type Slice = (offset: number, length: number) => Response["body"]

const ranged = (request: Request, size: number, headers: Readonly<Record<string, string>>, slice: Slice): Response => {
  const base = { "x-content-type-options": "nosniff", "accept-ranges": "bytes", ...headers }
  const range = rangeOf(request.header("range"), size)
  if (range === "unsatisfiable") return { status: 416, headers: { "content-range": `bytes */${size}` }, body: { kind: "empty" } }
  // A HEAD request gets the same answer; the platform sends its headers without the body.
  if (range !== null) {
    const length = range.end - range.start + 1
    return { status: 206, headers: { ...base, "content-range": `bytes ${range.start}-${range.end}/${size}` }, body: slice(range.start, length) }
  }
  return { status: 200, headers: base, body: slice(0, size) }
}

/** A file on disk, streamed; `size` is its size as just measured. The platform adds its ETag and Last-Modified. */
export const fileResponse = (request: Request, path: string, size: number, headers: Readonly<Record<string, string>>): Response =>
  ranged(request, size, headers, (offset, length) => ({ kind: "file", path, offset, length }))

export const bytesResponse = (request: Request, bytes: Uint8Array, headers: Readonly<Record<string, string>>): Response =>
  ranged(request, bytes.length, headers, (offset, length) => ({ kind: "bytes", bytes: bytes.subarray(offset, offset + length) }))

const within = (base: string, target: string): boolean => {
  const relative = nodePath.relative(base, target)
  return relative !== "" && !relative.startsWith(`..${nodePath.sep}`) && relative !== ".." && !nodePath.isAbsolute(relative)
}

/**
 * The regular file at `relative` under `base`, or null. The path is judged twice: as written, and
 * after symbolic links are resolved, so nothing outside the folder is reachable through it.
 */
export const confined = async (base: string, relative: string): Promise<{ readonly path: string; readonly size: number } | null> => {
  // A file is named by its exact path: no trailing separator, no empty name.
  if (relative === "" || /[\\/]$/.test(relative)) return null
  try {
    const path = nodePath.resolve(base, `.${nodePath.sep}${relative}`)
    if (!within(base, path)) return null
    const [realBase, real] = await Promise.all([fsp.realpath(base), fsp.realpath(path)])
    if (!within(realBase, real)) return null
    const stat = await fsp.stat(real)
    return stat.isFile() ? { path: real, size: stat.size } : null
  } catch {
    // Missing, unreadable, or not a path at all (a NUL byte): nothing to serve.
    return null
  }
}
