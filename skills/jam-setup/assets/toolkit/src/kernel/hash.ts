// Pure hashing and path rules. No I/O.
import { createHash } from "node:crypto"

export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex")

/** Stable JSON: sorted keys and no undefined members, so a digest does not depend on property order. */
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

export const digest = (value: unknown): string => sha256(canonical(value))

export const isNonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

/**
 * A portable project path: relative, forward slashes, normalized, never leaving the project.
 * Returns the reason it is not portable, or null when it is.
 */
export const portableProblem = (path: unknown): string | null => {
  if (!isNonEmpty(path)) return "a path is required"
  if (path.includes("\\") || /^[A-Za-z]:/.test(path) || path.startsWith("/") || path.includes("\0")) {
    return "use a project-relative path with forward slashes"
  }
  const parts = path.split("/")
  if (parts.some((part) => part === "" || part === "." || part === "..")) return "use a normalized project-relative path"
  return null
}

export const isPortable = (path: unknown): path is string => portableProblem(path) === null

/** True when `path` is `root` or lies under it (both portable). The empty root contains everything. */
export const isUnder = (root: string, path: string): boolean => root === "" || path === root || path.startsWith(`${root}/`)

export const extensionOf = (path: string): string => {
  const match = /\.([a-z0-9]+)$/i.exec(path)
  return match?.[1]?.toLowerCase() ?? ""
}
