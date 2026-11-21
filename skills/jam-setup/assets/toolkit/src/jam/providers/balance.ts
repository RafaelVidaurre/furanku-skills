// A provider's balance, read the way its descriptor says: a free call through its own program, whose
// JSON answer is picked apart by the paths the descriptor names. Nothing here knows any vendor.
import { isRecord } from "../../kernel/hash.ts"
import type { BalanceRead, Descriptor } from "./schema.ts"

/** Why a balance read gave no figure, as far as the program's own answer shows. */
export type Failure = "not installed" | "outdated" | "not signed in" | "unanswered" | "unreadable"

export interface Balance {
  readonly id: string
  readonly label: string
  readonly unit: Descriptor["unit"]
  /**
   * read: the toolkit read it now. session: the agent reads it with a tool of its own session.
   * failed: the read was tried and gave no figure. none: the provider has no balance to read.
   */
  readonly state: "read" | "session" | "failed" | "none"
  /** What is left to spend, in the provider's unit. */
  readonly remaining: number | null
  readonly used: number | null
  readonly limit: number | null
  /** Named portions the provider reports apart (monthly, permanent, held by running jobs, ...). */
  readonly parts: Readonly<Record<string, number>>
  /** When the period's allowance renews (ISO 8601). */
  readonly resets: string | null
  /** The call that was made or is to be made. */
  readonly via: string | null
  /** failed only: why. unanswered covers every failure the program's answer does not explain. */
  readonly failure: Failure | null
  readonly detail: string
}

// Long runs of key-like characters with letters and digits in them: never echo what may be a credential.
const SECRET = /[A-Za-z0-9_-]{24,}/g
const redact = (text: string): string =>
  text.replace(SECRET, (run) => (/[0-9]/.test(run) && /[A-Za-z]/.test(run) ? "[redacted]" : run)).slice(0, 200)

/** The error a program reports in its JSON answer ({ error: "..." } or { error: { code, reason, message } }), if any. */
export const reportedError = (stdout: string): string | null => {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  const error = isRecord(raw) ? raw["error"] : undefined
  if (typeof error === "string" && error !== "") return redact(error)
  if (!isRecord(error)) return null
  const parts = [error["code"], error["reason"], error["message"]].filter((part) => (typeof part === "string" && part !== "") || typeof part === "number")
  return parts.length === 0 ? null : redact(parts.join(": "))
}

// The exits a shell gives a command it cannot find: POSIX sh 127, cmd.exe (an npm launcher on Windows) 9009.
const NOT_FOUND_EXITS = new Set(["exit 127", "exit 9009"])
const OUTDATED = /unknown (sub)?command|unrecogni[sz]ed (sub)?command|no such (sub)?command|invalid choice|unknown option|unrecogni[sz]ed (option|argument)|unexpected argument/i
const SIGNED_OUT = /\bauth|credential|sign(ed)?[ -]?in|log(ged)?[ -]?in|unauthori[sz]ed|unauthenticated|forbidden|api[ _-]?key|\b40[13]\b/i

/**
 * Why a balance read that did not exit 0 failed, from how it ended and what it printed: the program's JSON error when
 * it gives one, else its first line. `error` and `output` are the probe's (`ENOENT`, `exit 3`, first line printed).
 */
export const readFailure = (result: { readonly error: string | null; readonly output: string | null; readonly stdout: string }): { failure: Failure; said: string | null } => {
  const said = reportedError(result.stdout) ?? (result.output === null ? null : redact(result.output))
  const ran = result.error?.startsWith("exit ") === true
  if (!ran || NOT_FOUND_EXITS.has(result.error ?? "")) return { failure: "not installed", said }
  const text = `${said ?? ""}\n${result.output ?? ""}`
  if (OUTDATED.test(text)) return { failure: "outdated", said }
  if (SIGNED_OUT.test(text)) return { failure: "not signed in", said }
  return { failure: "unanswered", said }
}

const at = (raw: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined), raw)

const number = (raw: unknown, path: string | undefined): number | null => {
  if (path === undefined) return null
  const value = at(raw, path)
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const when = (raw: unknown, read: BalanceRead): string | null => {
  if (read.resets === undefined) return null
  const value = at(raw, read.resets)
  const format = read.resetsAs ?? "iso"
  const date = format === "iso"
    ? (typeof value === "string" ? new Date(value) : null)
    : typeof value === "number" && Number.isFinite(value)
    ? new Date(format === "unix-ms" ? value : value * 1000)
    : null
  return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

/** The figures in a balance read's JSON answer, or why there are none. */
export const parseBalance = (read: BalanceRead, stdout: string): { remaining: number; used: number | null; limit: number | null; parts: Record<string, number>; resets: string | null } | { problem: string } => {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return { problem: `it did not print JSON (${stdout.trim().slice(0, 120) || "no output"})` }
  }
  const used = number(raw, read.used)
  const limit = number(raw, read.limit)
  const remaining = read.remaining !== undefined ? number(raw, read.remaining) : used !== null && limit !== null ? limit - used : null
  if (remaining === null) {
    return { problem: `its answer has no number at ${read.remaining ?? `${read.limit} and ${read.used}`}; the program's output may have changed` }
  }
  const parts: Record<string, number> = {}
  for (const [name, path] of Object.entries(read.parts ?? {})) {
    const value = number(raw, path)
    if (value !== null) parts[name] = value
  }
  return { remaining, used, limit, parts, resets: when(raw, read) }
}

/** The balance column in words: what is left, its portions, when it renews; or why there is none. */
export const balanceText = (balance: Balance): string => {
  if (balance.state !== "read") return balance.detail
  const parts = Object.entries(balance.parts).map(([name, value]) => `${name} ${value}`)
  return [
    `${balance.remaining} ${balance.unit.id} left`,
    balance.limit === null ? null : `of ${balance.limit}`,
    parts.length === 0 ? null : `(${parts.join(", ")})`,
    balance.resets === null ? null : `, renews ${balance.resets.slice(0, 10)}`
  ].filter((part) => part !== null).join(" ").replace(" ,", ",")
}
