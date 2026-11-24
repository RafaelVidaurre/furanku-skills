// Content folders as the project already spells them. A folder named `Art` where the project keeps
// `art/` is the same folder on a case-insensitive file system and a second one on any other, so a
// configured path takes the spelling of a folder that exists, segment by segment. Plain Node, no
// services: the installer imports this module before the toolkit's packages are installed.
import { readdirSync } from "node:fs"
import { join } from "node:path"

const names = (dir: string): ReadonlyArray<string> => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * `path` (project-relative, forward slashes) with each segment that exists in another letter case
 * spelled as it exists. Segments that do not exist yet are kept as given.
 */
export const spelledOnDisk = (root: string, path: string): string => {
  const out: Array<string> = []
  for (const segment of path.split("/")) {
    const here = names(join(root, ...out))
    const found = here.includes(segment) ? segment : here.find((name) => name.toLowerCase() === segment.toLowerCase())
    out.push(found ?? segment)
  }
  return out.join("/")
}

/**
 * Every content root of a configuration (`scratch`, `delivered`, `scan`), spelled as the project
 * spells its existing folders. Anything that is not a path is left for the schema to refuse.
 */
export const rootsOnDisk = (root: string, roots: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const path = (value: unknown): unknown => (typeof value === "string" && value !== "" ? spelledOnDisk(root, value) : value)
  return {
    ...roots,
    scratch: path(roots["scratch"]),
    delivered: path(roots["delivered"]),
    ...(Array.isArray(roots["scan"]) ? { scan: roots["scan"].map(path) } : {})
  }
}
