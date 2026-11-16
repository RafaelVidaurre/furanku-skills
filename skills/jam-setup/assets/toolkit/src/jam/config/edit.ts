// Editing one value of a JSON document by dotted path, for `jam config set`.
import { raise } from "../../kernel/errors.ts"
import { isRecord } from "../../kernel/hash.ts"

/** `"null"` and `"none"` are null; other JSON literals are themselves; anything else is a string. */
export const parseValue = (text: string): unknown => {
  if (text === "none") return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const segments = (path: string): ReadonlyArray<string> => {
  const parts = path.split(".")
  if (path === "" || parts.some((part) => part === "")) raise("invalid", `path ${JSON.stringify(path)}: expected dotted field names such as review.mode`)
  if (parts.some((part) => part === "__proto__" || part === "constructor" || part === "prototype")) raise("invalid", `path ${JSON.stringify(path)}: not a settable field`)
  return parts
}

/** A copy of `document` with the value at `path` replaced; missing objects on the way are created. */
export const setAt = (document: unknown, path: string, value: unknown): Record<string, unknown> => {
  const parts = segments(path)
  const assign = (node: unknown, index: number): Record<string, unknown> => {
    const key = parts[index]!
    if (node !== undefined && !isRecord(node)) raise("invalid", `path ${path}: ${parts.slice(0, index).join(".")} is not an object`)
    const base = (node ?? {}) as Record<string, unknown>
    return { ...base, [key]: index === parts.length - 1 ? value : assign(base[key], index + 1) }
  }
  return assign(document, 0)
}

/** A copy of `document` without the value at `path`. */
export const removeAt = (document: unknown, path: string): Record<string, unknown> => {
  const parts = segments(path)
  const drop = (node: unknown, index: number): Record<string, unknown> => {
    if (!isRecord(node)) return raise("invalid", `path ${path}: ${parts.slice(0, index).join(".") || "the document"} is not an object`)
    const key = parts[index]!
    if (!(key in node)) return raise("not_found", `path ${path}: nothing is set there`)
    const { [key]: child, ...rest } = node
    return index === parts.length - 1 ? rest : { ...rest, [key]: drop(child, index + 1) }
  }
  return drop(document, 0)
}

export const getAt = (document: unknown, path: string): unknown =>
  segments(path).reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), document)
