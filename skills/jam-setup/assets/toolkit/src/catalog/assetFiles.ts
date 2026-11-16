// Media files are served and frozen only from the project's declared asset roots, judged after
// symbolic links are resolved. The kernel confines paths to the project; this adds confinement to
// a sub-folder, with the directory lookups shared across the many files of one pass.
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import { type ToolError, toolError } from "../kernel/errors.ts"
import { isUnder, portableProblem } from "../kernel/hash.ts"

export interface ConfinedFile {
  readonly full: string
  /** Null when nothing exists at the path. */
  readonly stat: { readonly isFile: boolean; readonly size: number; readonly mtimeMs: number } | null
}

export interface AssetFiles {
  /** The file at a project path, or the reason it may not be used as media. */
  locate(path: string): Promise<ConfinedFile | ToolError>
}

const missing = (cause: unknown): boolean => (cause as { code?: string } | null)?.code === "ENOENT"
const inside = (base: string, target: string): boolean => {
  const rel = nodePath.relative(base, target)
  return rel === "" || (!rel.startsWith(`..${nodePath.sep}`) && rel !== ".." && !nodePath.isAbsolute(rel))
}

/**
 * Confinement for one pass over the project (`root` is the resolved project root). Real paths of
 * folders are remembered for the life of the returned value, so make a new one per action.
 */
export const assetFiles = (root: string, assetRoots: ReadonlyArray<string>): AssetFiles => {
  const realDirs = new Map<string, Promise<string | null>>()
  // The real path of a folder, or of its nearest existing ancestor joined with the missing rest.
  const realDir = (dir: string): Promise<string | null> => {
    let known = realDirs.get(dir)
    if (!known) {
      known = fsp.realpath(dir).catch(async (cause) => {
        if (!missing(cause)) return null
        const up = nodePath.dirname(dir)
        if (up === dir) return null
        const parent = await realDir(up)
        return parent === null ? null : nodePath.join(parent, nodePath.basename(dir))
      })
      realDirs.set(dir, known)
    }
    return known
  }
  const realFile = async (full: string): Promise<{ real: string | null; stat: ConfinedFile["stat"] }> => {
    const dir = await realDir(nodePath.dirname(full))
    if (dir === null) return { real: null, stat: null }
    const direct = nodePath.join(dir, nodePath.basename(full))
    try {
      const link = await fsp.lstat(direct)
      if (!link.isSymbolicLink()) return { real: direct, stat: { isFile: link.isFile(), size: link.size, mtimeMs: link.mtimeMs } }
      const real = await fsp.realpath(direct)
      const target = await fsp.stat(real)
      return { real, stat: { isFile: target.isFile(), size: target.size, mtimeMs: target.mtimeMs } }
    } catch (cause) {
      // Missing, or a dangling link: nothing to read either way.
      return missing(cause) ? { real: direct, stat: null } : { real: null, stat: null }
    }
  }
  const realRoots = new Map<string, Promise<string | null>>()
  const realRoot = (assetRoot: string): Promise<string | null> => {
    let known = realRoots.get(assetRoot)
    if (!known) {
      known = fsp.realpath(assetRoot === "" ? root : nodePath.join(root, ...assetRoot.split("/"))).catch(() => null)
      realRoots.set(assetRoot, known)
    }
    return known
  }
  const locate = async (path: string): Promise<ConfinedFile | ToolError> => {
    const problem = portableProblem(path)
    if (problem) return toolError("forbidden", problem)
    const full = nodePath.join(root, ...path.split("/"))
    const { real, stat } = await realFile(full)
    if (real === null || !inside(root, real)) return toolError("forbidden", "symlink escapes the project")
    for (const assetRoot of assetRoots) {
      if (!isUnder(assetRoot, path)) continue
      const realBase = await realRoot(assetRoot)
      if (realBase !== null && inside(realBase, real)) return { full, stat }
    }
    return toolError("forbidden", `path is outside the declared asset roots: ${path}`)
  }
  return { locate }
}
