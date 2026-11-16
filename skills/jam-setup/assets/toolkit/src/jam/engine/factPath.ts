// Addressing one fact. Some keys contain dots (landmark names such as upper-leg.l), so a path is
// given as separate segments; a single dotted argument still works when it can only mean one thing.
import { raise } from "../../kernel/errors.ts"
import { isRecord } from "../../kernel/hash.ts"

const every = (node: unknown, tokens: ReadonlyArray<string>): ReadonlyArray<unknown> => {
  if (tokens.length === 0) return [node]
  if (!isRecord(node)) return []
  const found: Array<unknown> = []
  for (let count = 1; count <= tokens.length; count++) {
    const key = tokens.slice(0, count).join(".")
    if (key in node) found.push(...every(node[key], tokens.slice(count)))
  }
  return found
}

/** The value at a path, or undefined. Throws when one dotted argument could mean several facts. */
export const factAt = (facts: unknown, path: ReadonlyArray<string>): unknown => {
  if (path.length === 1) {
    const found = every(facts, path[0]!.split("."))
    if (found.length > 1) raise("invalid", `${path[0]} could mean several facts`, { fix: "give the path as separate arguments, one per key" })
    return found[0]
  }
  return path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), facts)
}
