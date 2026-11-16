// Recipes the toolkit ships and the project's own. A project recipe with the same id shadows a
// shipped one; `extends` inherits steps from a base.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { decode } from "../../kernel/decode.ts"
import { attempt, fail, type ToolError } from "../../kernel/errors.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { BUILTIN_PREFIX, RECIPES_DIR } from "../layout.ts"
import { Toolkit } from "../Toolkit.ts"
import { type Loaded, resolveChain } from "./resolve.ts"
import { Recipe, type ResolvedRecipe } from "./schema.ts"

export interface RecipeEntry {
  readonly id: string
  readonly title: string
  readonly source: "shipped" | "project"
  /** Project path, or the path inside the toolkit for a shipped recipe. */
  readonly path: string
  readonly extends: string | null
  /** A project recipe that replaces a shipped one of the same id. */
  readonly shadows: boolean
}

export class Recipes extends Context.Service<Recipes, {
  /** Every recipe a run could name, project recipes first. A file that cannot be read is an error. */
  readonly list: Effect.Effect<ReadonlyArray<RecipeEntry>, ToolError>
  /** Ids of the recipes the toolkit ships. */
  readonly shipped: Effect.Effect<ReadonlyArray<string>, ToolError>
  /** Resolve `<id>` (project first, then shipped) or `builtin:<id>`. */
  get(reference: string): Effect.Effect<ResolvedRecipe, ToolError>
  /** The project's own file for an id, as written, or null. */
  authored(id: string): Effect.Effect<Recipe | null, ToolError>
  /** Validate a recipe and write it to the project. Returns its path. */
  write(recipe: unknown): Effect.Effect<string, ToolError>
  projectPath(id: string): string
}>()("jam/Recipes") {
  static readonly layerNoDeps: Layer.Layer<Recipes, never, ProjectFiles | Toolkit> = Layer.effect(
    Recipes,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const toolkit = yield* Toolkit
      const projectPath = (id: string): string => `${RECIPES_DIR}/${id}.json`
      const shippedPath = (id: string): string => `recipes/${id}.json`

      const decodeAt = (what: string, id: string) => (raw: unknown): Effect.Effect<Recipe, ToolError> =>
        Effect.flatMap(decode(Recipe, { what, fix: `see schemas/recipe.schema.json in the toolkit; "jam recipe check" validates every recipe` })(raw), (recipe) =>
          recipe.id === id ? Effect.succeed(recipe) : fail("invalid", `${what}: id is ${recipe.id}, expected ${id} to match the file name`, { fix: "rename the file or change its id" }))

      const idsIn = (names: ReadonlyArray<string>): ReadonlyArray<string> =>
        names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length))
      const shipped = Effect.map(toolkit.list("recipes"), idsIn)
      const project = Effect.map(files.list(RECIPES_DIR), (entries) => idsIn(entries.filter((entry) => entry.kind === "file").map((entry) => entry.name)))

      const readShipped = (id: string): Effect.Effect<Recipe, ToolError> =>
        Effect.flatMap(toolkit.readJson(shippedPath(id)), decodeAt(`shipped recipe ${id}`, id))
      const readProject = (id: string): Effect.Effect<Recipe, ToolError> =>
        Effect.flatMap(files.readJson(projectPath(id)), decodeAt(projectPath(id), id))

      const load = (reference: string, from: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<Loaded>, ToolError> =>
        Effect.gen(function*() {
          const builtin = reference.startsWith(BUILTIN_PREFIX)
          const id = builtin ? reference.slice(BUILTIN_PREFIX.length) : reference
          const inProject = !builtin && (yield* project).includes(id)
          if (!inProject && !(yield* shipped).includes(id)) {
            const known = [...new Set([...(yield* project), ...(yield* shipped)])].sort()
            return yield* fail("not_found", `recipe ${reference} does not exist${from.length > 0 ? ` (extended by ${from.at(-1)})` : ""}`, {
              fix: `use one of: ${known.join(", ")}; or create it with "jam recipe new ${id}"`
            })
          }
          const label = `${inProject ? "project" : "builtin"}:${id}`
          if (from.includes(label)) {
            return yield* fail("invalid", `recipes extend each other in a cycle: ${[...from, label].join(" -> ")}`, {
              fix: `a project recipe that replaces a shipped one extends "${BUILTIN_PREFIX}${id}", not "${id}"`
            })
          }
          const recipe = yield* (inProject ? readProject(id) : readShipped(id))
          const base = recipe.extends === undefined ? [] : yield* load(recipe.extends, [...from, label])
          return [...base, { label, recipe }]
        })

      const entry = (id: string, source: RecipeEntry["source"], recipe: Recipe, shadows: boolean): RecipeEntry => ({
        id,
        title: recipe.title ?? id,
        source,
        path: source === "project" ? projectPath(id) : shippedPath(id),
        extends: recipe.extends ?? null,
        shadows
      })

      return {
        shipped,
        projectPath,
        list: Effect.gen(function*() {
          const own = yield* project
          const built = yield* shipped
          const out: Array<RecipeEntry> = []
          for (const id of own) out.push(entry(id, "project", yield* readProject(id), built.includes(id)))
          for (const id of built) if (!own.includes(id)) out.push(entry(id, "shipped", yield* readShipped(id), false))
          return out
        }),
        get: (reference) => Effect.flatMap(load(reference, []), (chain) => attempt(`resolve recipe ${reference}`, () => resolveChain(chain))),
        authored: (id) => Effect.flatMap(project, (own) => (own.includes(id) ? readProject(id) : Effect.succeed(null))),
        write: (raw) =>
          Effect.gen(function*() {
            const recipe = yield* decode(Recipe, { what: "recipe" })(raw)
            yield* files.writeJson(projectPath(recipe.id), raw)
            return projectPath(recipe.id)
          })
      }
    })
  )
}
