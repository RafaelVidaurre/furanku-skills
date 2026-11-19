// Several sources describe one project: their outputs are merged in plugin order, then plugins may
// reshape the result before it is validated. Pure; problems are returned, never thrown.
import { canonical } from "../../kernel/hash.ts"
import type { CollectionInput, EnrichPatch, MergedSources, ProblemInput, SourceOutput, UnitInput } from "../plugin.ts"
import { retiredKeys, retiredMessage } from "./retired.ts"

export interface Merged {
  readonly sources: MergedSources
  readonly problems: ReadonlyArray<ProblemInput>
}

/** One problem per key a plugin still writes under its old name (the key itself is not read). */
const retiredProblems = (output: unknown, subject: string): Array<ProblemInput> =>
  retiredKeys(output).map((key) => ({ subject, error: retiredMessage(key), recovery: `rename it; docs/catalog-migration.md lists every renamed key` }))

/** Later sources add to earlier ones. A key defined twice differently keeps its first definition. */
export const mergeSources = (outputs: ReadonlyArray<{ readonly source: string; readonly output: SourceOutput }>): Merged => {
  const problems: Array<ProblemInput> = []
  const types: Record<string, NonNullable<SourceOutput["types"]>[string]> = {}
  const collectionKinds: Record<string, NonNullable<SourceOutput["collectionKinds"]>[string]> = {}
  const owner = new Map<string, string>()
  const define = <V>(what: string, into: Record<string, V>, source: string, entries: Readonly<Record<string, V>> | undefined): void => {
    for (const [key, value] of Object.entries(entries ?? {})) {
      const existing = into[key]
      if (existing === undefined) {
        into[key] = value
        owner.set(`${what}:${key}`, source)
      } else if (canonical(existing) !== canonical(value)) {
        problems.push({ subject: source, error: `${what} ${key} is already defined differently by source ${owner.get(`${what}:${key}`)}`, recovery: "define it once, or reshape it in a plugin's enrich step" })
      }
    }
  }
  const assetRoots: Array<string> = []
  const collections: Array<CollectionInput> = []
  const collectionIds = new Set<string>()
  let project: string | null = null
  let declaredRoots = false
  for (const { output, source } of outputs) {
    problems.push(...retiredProblems(output, source))
    project ??= output.project ?? null
    define("type", types, source, output.types)
    define("collection kind", collectionKinds, source, output.collectionKinds)
    if (output.assetRoots) {
      declaredRoots = true
      for (const root of output.assetRoots) if (!assetRoots.includes(root)) assetRoots.push(root)
    }
    for (const collection of output.collections ?? []) {
      if (typeof collection?.id === "string" && collectionIds.has(collection.id)) {
        problems.push({ subject: source, error: `duplicate collection id ${collection.id}` })
        continue
      }
      if (typeof collection?.id === "string") collectionIds.add(collection.id)
      collections.push(collection)
    }
    for (const problem of output.problems ?? []) problems.push({ ...problem, subject: problem.subject ?? source })
  }
  return {
    sources: {
      project,
      types,
      collectionKinds,
      // A project that names no root may keep media anywhere inside it.
      assetRoots: declaredRoots ? assetRoots : [""],
      assets: outputs.flatMap(({ output }) => output.assets ?? []),
      units: outputs.flatMap(({ output }) => output.units ?? []),
      collections
    },
    problems
  }
}

/** Apply one plugin's patch. Unit patches replace the fields they name; `null` removes a unit. */
export const applyPatch = (sources: MergedSources, patch: EnrichPatch | void, plugin: string): Merged => {
  if (!patch) return { sources, problems: [] }
  const edits = patch.units ?? {}
  const units: Array<UnitInput> = []
  for (const unit of sources.units) {
    const edit = Object.hasOwn(edits, unit.id) ? edits[unit.id] : undefined
    if (edit === null) continue
    units.push(edit === undefined ? unit : { ...unit, ...edit, id: unit.id })
  }
  return {
    sources: {
      ...sources,
      types: { ...sources.types, ...patch.types },
      collectionKinds: { ...sources.collectionKinds, ...patch.collectionKinds },
      units,
      assets: [...sources.assets, ...(patch.assets ?? [])],
      collections: [...sources.collections, ...(patch.collections ?? [])]
    },
    problems: [...retiredProblems(patch, `plugin ${plugin}`), ...(patch.problems ?? [])]
  }
}
