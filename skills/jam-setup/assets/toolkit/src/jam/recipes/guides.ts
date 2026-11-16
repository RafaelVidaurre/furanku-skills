// A step's guide: a document, optionally with an anchor, in the project or shipped with the toolkit.
import * as Effect from "effect/Effect"
import * as nodePath from "node:path"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Toolkit } from "../Toolkit.ts"

const TOOLKIT_PREFIX = "toolkit:"

export interface ResolvedGuide {
  /** As written in the recipe. */
  readonly reference: string
  /** Where to read it: a project path, or an absolute path when the toolkit is outside the project. */
  readonly path: string
  readonly anchor: string | null
  /** What is wrong with the reference, or null when the file and the anchor exist. */
  readonly problem: string | null
}

/** The anchor a Markdown heading gets: lower case, punctuation dropped, spaces to hyphens. */
export const headingAnchor = (heading: string): string =>
  heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-")

const anchorsIn = (text: string): ReadonlySet<string> => {
  const out = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) out.add(headingAnchor(heading[1]!))
    for (const explicit of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(explicit[1]!)
  }
  return out
}

export const resolveGuide = (reference: string): Effect.Effect<ResolvedGuide, never, ProjectFiles | Toolkit> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const toolkit = yield* Toolkit
    const shipped = reference.startsWith(TOOLKIT_PREFIX)
    const [file = "", anchor = null] = (shipped ? reference.slice(TOOLKIT_PREFIX.length) : reference).split("#") as [string, string | undefined]
    const absolute = toolkit.path(file)
    const inProject = nodePath.relative(files.root, absolute).split(nodePath.sep).join("/")
    const path = shipped ? (inProject.startsWith("..") || nodePath.isAbsolute(inProject) ? absolute : inProject) : file
    const text = yield* (shipped ? toolkit.readText(file) : files.readText(file)).pipe(Effect.catch(() => Effect.succeed(null)))
    const problem = text === null
      ? `${path} does not exist`
      : anchor !== null && !anchorsIn(text).has(anchor)
      ? `${path} has no heading for #${anchor}`
      : null
    return { reference, path, anchor, problem }
  })
