// What the catalog's `jam` plugin asks of the run ledger: the runs as catalog content, the files
// that content depends on, measurements, and the doctor checks. The plugin itself (plugin.ts) is
// a thin description; this service is where it meets the jam services.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { CheckProblem, ProblemInput, SourceOutput } from "../../catalog/plugin.ts"
import type { ToolError } from "../../kernel/errors.ts"
import { Git } from "../../kernel/Git.ts"
import { isUnder } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Stamps } from "../../kernel/Stamps.ts"
import { Checks } from "../checks/Checks.ts"
import { Config } from "../config/Config.ts"
import type { JamConfig } from "../config/schema.ts"
import { Engine } from "../engine/Engine.ts"
import { CONFIG_FILE, ENGINES_DIR, RECIPES_DIR } from "../layout.ts"
import { canMeasureImage, canMeasureModel, Measure } from "../measure/Measure.ts"
import { Recipes } from "../recipes/Recipes.ts"
import type { ResolvedRecipe } from "../recipes/schema.ts"
import { closurePaths } from "../runs/closure.ts"
import { type RunRef, Runs, type RunScan } from "../runs/Runs.ts"
import { computeStatus } from "../runs/status.ts"
import { runCheck } from "./checks.ts"
import type { CheckName } from "./plugin.ts"
import { type Attempt, byCurrency, sourceOutput, type Subject } from "./units.ts"

/** The project's runs, read once: every subject that is content, and what could not be read. */
export interface Survey {
  readonly config: JamConfig
  readonly scan: RunScan
  /** Subjects whose recipe is deliverable. Tests and explorations are work, not content. */
  readonly subjects: ReadonlyArray<Subject>
  readonly problems: ReadonlyArray<ProblemInput>
}

export class RunCatalog extends Context.Service<RunCatalog, {
  /**
   * The project files `load` depends on: the configuration, the project's recipes and engine
   * adapters, every run file, and the files the current runs recorded (their change is what
   * makes a step stale). Nothing else under the content roots reloads the catalog.
   */
  readonly inputs: Effect.Effect<ReadonlyArray<string>>
  /** The runs as types, units and problems. A run that cannot be read is one problem; the rest load. */
  readonly load: Effect.Effect<SourceOutput>
  /** Measured facts of one media file, by its project path. */
  measure(path: string): Effect.Effect<Readonly<Record<string, unknown>>, ToolError>
  check(name: CheckName): Effect.Effect<ReadonlyArray<CheckProblem>, ToolError>
}>()("jam/catalog/RunCatalog") {
  static readonly layerNoDeps: Layer.Layer<RunCatalog, never, Runs | Recipes | Config | Stamps | Checks | Engine | Measure | Git | ProjectFiles> = Layer.effect(
    RunCatalog,
    Effect.gen(function*() {
      const services = yield* Effect.context<Runs | Recipes | Config | Stamps | Checks | Engine | Git | ProjectFiles>()
      const runs = yield* Runs
      const recipes = yield* Recipes
      const configs = yield* Config
      const measure = yield* Measure
      // What the last load found: the files the runs stand on, and the folders runs live in. Both
      // follow from files that are inputs themselves (the run files, the configuration, the
      // recipes), so they hold for as long as the catalog does not load again.
      let recorded: ReadonlyArray<string> = []
      let folders: ReadonlyArray<string> | null = null

      const survey = (config: JamConfig): Effect.Effect<Survey, ToolError> =>
        Effect.gen(function*() {
          const scan = yield* runs.scan
          const problems: Array<ProblemInput> = scan.unreadable.map((file) => ({
            source: file.path,
            error: file.message,
            recovery: "run files are written by the tool: restore this one from Git, or remove its folder when the attempt is not needed"
          }))
          const known = new Map<string, ResolvedRecipe | null>()
          const attempts = new Map<string, Array<Attempt>>()
          for (const ref of scan.runs) {
            if (!known.has(ref.run.recipe)) {
              const recipe = yield* Effect.result(recipes.get(ref.run.recipe))
              known.set(ref.run.recipe, recipe._tag === "Success" ? recipe.success : null)
              if (recipe._tag === "Failure") {
                problems.push({ source: ref.path, error: recipe.failure.message, recovery: recipe.failure.fix ?? `restore recipe ${ref.run.recipe}; runs that use it are left out until then` })
              }
            }
            const recipe = known.get(ref.run.recipe)
            if (recipe == null || !recipe.deliverable) continue
            attempts.set(ref.run.id, [...(attempts.get(ref.run.id) ?? []), { ref, recipe }])
          }
          const subjects: Array<Subject> = []
          for (const [id, list] of attempts) {
            const ordered = list.sort((a, b) => byCurrency(a.ref, b.ref))
            const current = ordered[0]!
            const status = yield* computeStatus({ ref: current.ref, recipe: current.recipe, config }).pipe(
              Effect.catch((error) => Effect.succeed({ error: error.message })),
              Effect.provideContext(services)
            )
            subjects.push({ id, attempts: ordered, status })
          }
          return { config, scan, subjects: subjects.sort((a, b) => a.id.localeCompare(b.id)), problems }
        })

      const rootsOf = (found: Survey): ReadonlyArray<string> => {
        const named = [found.config.roots.scratch, found.config.roots.delivered, ...found.config.roots.scan]
        for (const subject of found.subjects) {
          for (const { recipe } of subject.attempts) named.push(...Object.values(recipe.roots))
        }
        const unique = [...new Set(named)]
        return unique.filter((root) => !unique.some((other) => other !== root && isUnder(other, root)))
      }

      const standsOn = (ref: RunRef): ReadonlyArray<string> => closurePaths(ref.run)

      const load: Effect.Effect<SourceOutput> = Effect.gen(function*() {
        const state = yield* configs.state
        // Not a jam project: nothing to list and nothing wrong.
        if (state.kind === "missing") return {}
        if (state.kind === "v1") {
          return { problems: [{ source: CONFIG_FILE, error: `${CONFIG_FILE} is version 1, so its runs are not listed`, recovery: `run "jam config migrate"` }] }
        }
        const found = yield* survey(state.config)
        recorded = [...new Set(found.subjects.flatMap((subject) => standsOn(subject.attempts[0]!.ref)))].sort()
        folders = yield* runs.roots
        return sourceOutput({ subjects: found.subjects, roots: rootsOf(found), problems: found.problems })
      }).pipe(
        Effect.catch((error) => {
          recorded = []
          folders = null
          return Effect.succeed<SourceOutput>({ problems: [{ source: CONFIG_FILE, error: error.message, recovery: error.fix ?? null }] })
        })
      )

      // Asked before every action, so it only lists folders: no recipe or run file is read here.
      const inputs: Effect.Effect<ReadonlyArray<string>> = Effect.gen(function*() {
        const files = yield* Effect.flatMap(folders === null ? runs.roots : Effect.succeed(folders), runs.filesIn).pipe(
          Effect.catch(() => Effect.succeed<ReadonlyArray<string>>([]))
        )
        return [CONFIG_FILE, RECIPES_DIR, ENGINES_DIR, ...files, ...recorded]
      })

      return {
        inputs,
        load,
        measure: (path) =>
          Effect.gen(function*() {
            if (!canMeasureModel(path) && !canMeasureImage(path)) return {}
            const found = yield* measure.file(path)
            if (found.kind === "image") return { width: found.size[0], height: found.size[1] }
            return {
              triangles: found.triangles,
              materials: found.materials,
              textureMiB: Math.round(found.textureMiB * 100) / 100,
              textures: found.textureDimensions.map(([width, height]) => `${width}×${height}`),
              vertices: found.exportedVertices,
              drawPrimitives: found.drawPrimitives
            }
          }),
        check: (name) =>
          Effect.gen(function*() {
            const state = yield* configs.state
            if (state.kind !== "ready") return []
            return yield* runCheck(name, yield* survey(state.config))
          }).pipe(Effect.provideContext(services))
      }
    })
  )
}
