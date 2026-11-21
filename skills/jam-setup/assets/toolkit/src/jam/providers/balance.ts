// A provider's balance, read the way its descriptor says: a free call through its own program, whose
// JSON answer is picked apart by the paths the descriptor names. Nothing here knows any vendor.
import type { BalanceRead, Descriptor } from "./schema.ts"

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
  readonly detail: string
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
