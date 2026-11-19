// Low-level access to the files under .catalog. Nothing here follows a symbolic link: a link
// planted in a checkout must not make the catalog read or write somewhere else. The kernel's
// `noFollow` covers single reads and writes; this adds the folder scan and the two-step write
// that lets several records change together.
import * as Effect from "effect/Effect"
import { randomUUID } from "node:crypto"
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import { asToolError, type ToolError } from "../../kernel/errors.ts"
import type { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { FORMAT_FILE, FORMAT_TEXT, GITIGNORE, LOCAL_DIR, LOCAL_GITIGNORE, RECORD_FOLDERS, RECORDS_DIR } from "./layout.ts"

/** Whether text still holds Git's conflict markers (`<<<<<<<`, `=======`, `>>>>>>>` at a line start). */
export const hasConflictMarkers = (text: string): boolean => /^(<{7}|={7}|>{7})( |$)/m.test(text)

export interface RecordProblem {
  readonly file: string
  readonly kind: string
  readonly error: string
  readonly recovery?: string
}

export interface ScannedFile {
  /** Path below .catalog, forward slashes. */
  readonly relative: string
  readonly full: string
  readonly size: number
  readonly mtimeMs: number
}

export interface Scan {
  readonly files: ReadonlyArray<ScannedFile>
  readonly problems: ReadonlyArray<RecordProblem>
}

const absent = (cause: unknown): boolean => (cause as { code?: string } | null)?.code === "ENOENT"
const linkIgnored = (file: string, what: string): RecordProblem => ({ file, kind: "records", error: "symbolic link ignored", recovery: `replace the link with a real ${what}` })

/** Every record file with its size and modification time. Reads no file contents. */
export const scanRecords = async (root: string): Promise<Scan> => {
  const base = nodePath.join(root, RECORDS_DIR)
  const files: Array<ScannedFile> = []
  const problems: Array<RecordProblem> = []
  try {
    if ((await fsp.lstat(base)).isSymbolicLink()) {
      return {
        files,
        problems: [{ file: RECORDS_DIR, kind: "records", error: `symbolic links are not followed inside ${RECORDS_DIR} (${RECORDS_DIR})`, recovery: `replace ${RECORDS_DIR} with a real directory inside the checkout` }]
      }
    }
  } catch (cause) {
    if (absent(cause)) return { files, problems }
    throw cause
  }
  const visit = async (full: string, relative: string): Promise<void> => {
    let entries
    try {
      entries = await fsp.readdir(full, { withFileTypes: true })
    } catch (cause) {
      if (absent(cause)) return
      throw cause
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const child = `${relative}/${entry.name}`
      const childFull = nodePath.join(full, entry.name)
      if (entry.isSymbolicLink()) problems.push(linkIgnored(`${RECORDS_DIR}/${child}`, "file"))
      else if (entry.isDirectory()) await visit(childFull, child)
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const stat = await fsp.lstat(childFull).catch(() => null)
        if (stat?.isFile()) files.push({ relative: child, full: childFull, size: stat.size, mtimeMs: stat.mtimeMs })
      }
    }
  }
  for (const folder of RECORD_FOLDERS) {
    const full = nodePath.join(base, folder)
    const stat = await fsp.lstat(full).catch(() => null)
    if (!stat) continue
    if (stat.isSymbolicLink()) problems.push(linkIgnored(`${RECORDS_DIR}/${folder}`, "directory or file"))
    else if (stat.isDirectory()) await visit(full, folder)
  }
  // The format marker is scanned like a record so a change to it is noticed; it is not one.
  const marker = nodePath.join(base, "format.json")
  const markerStat = await fsp.lstat(marker).catch(() => null)
  if (markerStat?.isSymbolicLink()) problems.push({ file: `${RECORDS_DIR}/format.json`, kind: "records", error: "symbolic link ignored", recovery: "replace the link with a real file" })
  else if (markerStat?.isFile()) files.push({ relative: "format.json", full: marker, size: markerStat.size, mtimeMs: markerStat.mtimeMs })
  const categories = nodePath.join(base, "categories.json")
  const stat = await fsp.lstat(categories).catch(() => null)
  if (stat?.isSymbolicLink()) problems.push({ file: `${RECORDS_DIR}/categories.json`, kind: "categories", error: "symbolic link ignored" })
  else if (stat?.isFile()) files.push({ relative: "categories.json", full: categories, size: stat.size, mtimeMs: stat.mtimeMs })
  return { files, problems }
}

export interface Staged {
  readonly temporary: string
  readonly full: string
}

/** Write the new bytes beside the target without replacing it yet. */
export const stage = (files: ProjectFiles["Service"], path: string, data: string | Uint8Array): Effect.Effect<Staged, ToolError> =>
  Effect.flatMap(files.resolve(path, { noFollow: true }), (full) =>
    Effect.tryPromise({
      try: async () => {
        await fsp.mkdir(nodePath.dirname(full), { recursive: true })
        const temporary = `${full}.${randomUUID()}.tmp`
        const handle = await fsp.open(temporary, "wx")
        try {
          await handle.writeFile(data)
          await handle.sync()
        } finally {
          await handle.close()
        }
        return { temporary, full }
      },
      catch: asToolError("unavailable", `write ${path}`)
    }))

export const commit = (staged: Staged): Effect.Effect<void, ToolError> =>
  Effect.tryPromise({
    try: () => fsp.rename(staged.temporary, staged.full),
    catch: asToolError("unavailable", `replace ${staged.full}`)
  }).pipe(Effect.tapError(() => discard(staged)))

export const discard = (staged: Staged): Effect.Effect<void> => Effect.promise(() => fsp.rm(staged.temporary, { force: true }))

/**
 * Make sure machine-local state is ignored by Git before the first file is written under
 * .catalog/.local: the ignore rule travels with the repository, the state does not.
 */
/**
 * Before a read writes machine-local state (caches, the server record): the local folder ignores
 * itself, so a read never leaves an untracked file in the checkout or touches a tracked one.
 */
export const ensureLocal = (files: ProjectFiles["Service"]): Effect.Effect<void, ToolError> =>
  Effect.gen(function*() {
    const ignore = `${LOCAL_DIR}/.gitignore`
    if ((yield* files.stat(ignore, { noFollow: true })) === null) yield* files.writeText(ignore, LOCAL_GITIGNORE, { noFollow: true })
  })

export const ensureBase = (files: ProjectFiles["Service"]): Effect.Effect<void, ToolError> =>
  Effect.gen(function*() {
    const ignore = `${RECORDS_DIR}/.gitignore`
    if ((yield* files.stat(ignore, { noFollow: true })) === null) yield* files.writeText(ignore, GITIGNORE, { noFollow: true })
  })

/** Before the first record is written: the marker naming the layout it is written in. */
export const ensureFormat = (files: ProjectFiles["Service"]): Effect.Effect<void, ToolError> =>
  Effect.gen(function*() {
    if ((yield* files.stat(FORMAT_FILE, { noFollow: true })) === null) yield* files.writeText(FORMAT_FILE, FORMAT_TEXT, { noFollow: true })
  })
