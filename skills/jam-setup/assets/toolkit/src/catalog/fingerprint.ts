// Deciding whether a source must be loaded again. Authored data can be replaced by sync tools
// that keep size and timestamps, so it is compared by bytes; media and everything else is
// compared by size and modification time, which stays cheap for large files.
import * as Effect from "effect/Effect"
import { sha256 } from "../kernel/hash.ts"
import type { ProjectFiles, WalkedFile } from "../kernel/ProjectFiles.ts"

const DATA = /\.(json|jsonl|yaml|yml|toml|ini|csv|tsv)$/i
const SKIPPED = new Set([".git", ".catalog", "node_modules"])
const skip = (path: string): boolean => SKIPPED.has(path.split("/").pop() ?? "")

/** A digest of the named files and folders (project-relative). A missing path is part of it. */
export const fingerprint = (files: ProjectFiles["Service"], inputs: ReadonlyArray<string>): Effect.Effect<string> =>
  Effect.gen(function*() {
    const one = (path: string): Effect.Effect<string> =>
      Effect.gen(function*() {
        const stat = yield* files.stat(path)
        if (stat === null || stat.kind !== "file") return `${path}:none`
        if (DATA.test(path)) return `${path}:${sha256(yield* files.readBytes(path))}`
        return `${path}:${stat.size}:${stat.mtimeMs}`
        // A path that leaves the project through a link is not an input; leaving it out keeps
        // the digest stable instead of failing the whole catalog.
      }).pipe(Effect.catch(() => Effect.succeed(`${path}:unreadable`)))
    const parts: Array<string> = []
    for (const raw of inputs) {
      // "." and "./x" name what "" and "x" do: the project, and a path inside it.
      const input = raw.replace(/^\.(?:\/|$)/, "").replace(/\/+$/, "")
      const stat = input === "" ? { kind: "directory" as const } : yield* files.stat(input).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (stat === undefined) continue
      if (stat === null) parts.push(`${input}:none`)
      else if (stat.kind === "directory") {
        // One lstat per file: the folder itself was confined above, and linked folders are not entered.
        const inside = yield* files.walkStats(input, { skip }).pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<WalkedFile>)))
        parts.push(...(yield* Effect.forEach(inside, (file) => (DATA.test(file.path) ? one(file.path) : Effect.succeed(`${file.path}:${file.size}:${file.mtimeMs}`)), { concurrency: 16 })))
      } else parts.push(yield* one(input))
    }
    return sha256(parts.join("\n"))
  })
