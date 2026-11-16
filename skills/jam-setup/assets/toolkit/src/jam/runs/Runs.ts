// Where run records live and how they change: one file per run, one writer at a time.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { decode } from "../../kernel/decode.ts"
import { attempt, fail, type ToolError, toolError } from "../../kernel/errors.ts"
import { isRecord, isUnder } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { parentOf } from "../../kernel/Stamps.ts"
import { Config } from "../config/Config.ts"
import type { JamConfig } from "../config/schema.ts"
import { LOCAL_STATE_DIR, RUN_FILE } from "../layout.ts"
import { Recipes } from "../recipes/Recipes.ts"
import type { ResolvedRecipe } from "../recipes/schema.ts"
import { Toolkit } from "../Toolkit.ts"
import { Run } from "./schema.ts"
import { fromV1, isV1Run, type LegacyRecipes } from "./v1.ts"

export interface RunRef {
  /** Project path of the run file. */
  readonly path: string
  /** Its folder. */
  readonly dir: string
  readonly run: Run
  readonly delivered: boolean
}

export interface RunScan {
  readonly runs: ReadonlyArray<RunRef>
  /** Run files that could not be read, with why. They never hide the readable ones. */
  readonly unreadable: ReadonlyArray<{ readonly path: string; readonly message: string }>
}

/** A run with everything an operation needs to judge it. */
export interface RunContext {
  readonly ref: RunRef
  readonly recipe: ResolvedRecipe
  readonly config: JamConfig
}

export class Runs extends Context.Service<Runs, {
  /** The folders that may hold run files: the project's roots and every recipe's own, none inside another. */
  readonly roots: Effect.Effect<ReadonlyArray<string>, ToolError>
  /** The path of every run file under the given folders, unread. */
  filesIn(roots: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, ToolError>
  /** Every run file under the configured roots. */
  readonly scan: Effect.Effect<RunScan, ToolError>
  /** The newest run of a subject; `<id>:<n>` names one attempt. */
  find(reference: string): Effect.Effect<RunRef, ToolError>
  /** A run with its recipe and the project configuration. */
  open(reference: string): Effect.Effect<RunContext, ToolError>
  read(path: string): Effect.Effect<RunRef, ToolError>
  /** The folder a new attempt for a subject would use, and its number. */
  nextAttempt(id: string, scratch: string): Effect.Effect<{ readonly n: number; readonly dir: string }, ToolError>
  /** Write a new run file. Fails when the folder already holds one. */
  create(dir: string, run: Run): Effect.Effect<RunRef, ToolError>
  /** Change a run under its lock. The change sees the file as it is now and returns the next state. */
  mutate<A, R>(path: string, change: (run: Run) => Effect.Effect<readonly [Run, A], ToolError, R>): Effect.Effect<A, ToolError, R>
  /** Hold the project-wide job ledger lock, so two runs cannot both reserve the same request. */
  readonly ledgerLock: Effect.Effect<void, ToolError, Scope.Scope>
  /** The lock file of a run, for reporting and recovery. */
  lockPath(path: string): string
}>()("jam/Runs") {
  static readonly layerNoDeps: Layer.Layer<Runs, never, ProjectFiles | Config | Recipes | Toolkit> = Layer.effect(
    Runs,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const configs = yield* Config
      const recipes = yield* Recipes
      const toolkit = yield* Toolkit
      const decodeRun = (path: string) => decode(Run, { what: path, code: "malformed", fix: "run files are written by the tool; restore this one from Git or start a new run" })

      const legacy: Effect.Effect<LegacyRecipes, ToolError> = Effect.gen(function*() {
        const defaults = yield* toolkit.readJson("defaults/migration-v1.json")
        const names = (isRecord(defaults) && isRecord(defaults["recipes"]) ? defaults["recipes"] : {}) as Record<string, string>
        const own = new Set((yield* recipes.list).filter((entry) => entry.source === "project").map((entry) => entry.id))
        return {
          // The migration writes one recipe per version 1 profile, carrying that profile's review policy.
          production: (profile) => (profile !== null && own.has(profile) ? profile : names["legacy"] ?? ""),
          exploration: names["exploration"] ?? "",
          providerTest: names["providerTest"] ?? "",
          providerTestStep: names["providerTestStep"] ?? ""
        }
      })

      // Roots named by the project and by any recipe, without ones nested inside another.
      const roots = (config: JamConfig): Effect.Effect<ReadonlyArray<string>, ToolError> =>
        Effect.gen(function*() {
          const named = [config.roots.scratch, config.roots.delivered, ...config.roots.scan]
          for (const entry of yield* recipes.list) {
            const recipe = yield* recipes.get(entry.id).pipe(Effect.catch(() => Effect.succeed(null)))
            if (recipe?.roots.scratch !== undefined) named.push(recipe.roots.scratch)
            if (recipe?.roots.delivered !== undefined) named.push(recipe.roots.delivered)
          }
          const unique = [...new Set(named)]
          return unique.filter((root) => !unique.some((other) => other !== root && isUnder(other, root)))
        })

      const deliveredRoots = (config: JamConfig): Effect.Effect<ReadonlyArray<string>, ToolError> =>
        Effect.gen(function*() {
          const out = [config.roots.delivered]
          for (const entry of yield* recipes.list) {
            const recipe = yield* recipes.get(entry.id).pipe(Effect.catch(() => Effect.succeed(null)))
            if (recipe?.roots.delivered !== undefined) out.push(recipe.roots.delivered)
          }
          return out
        })

      // A version 1 run never had the steps a recipe added since (collision, rig, import), so they
      // read as skipped; recording one later replaces the skip.
      const withoutNewSteps = (run: Run): Effect.Effect<Run, ToolError> =>
        Effect.gen(function*() {
          const recipe = yield* recipes.get(run.recipe).pipe(Effect.catch(() => Effect.succeed(null)))
          const defaults = yield* toolkit.readJson("defaults/migration-v1.json")
          const stages = isRecord(defaults) && Array.isArray(defaults["stages"]) ? (defaults["stages"] as ReadonlyArray<string>) : []
          const steps = { ...run.steps }
          const recorded = (id: string): boolean => (steps[id]?.records.length ?? 0) > 0
          // Every step a recorded step depends on, directly or through others.
          const neededByRecorded = new Set<string>()
          const byId = new Map((recipe?.steps ?? []).map((step) => [step.id, step]))
          const visit = (id: string): void => {
            for (const need of byId.get(id)?.needs ?? []) {
              if (neededByRecorded.has(need)) continue
              neededByRecorded.add(need)
              visit(need)
            }
          }
          // Work that entered from outside (imported) already explains the steps before it.
          const entered = (id: string): boolean => steps[id]?.records.some((record) => record.entry === "imported" || (record.provenance?.kind === "imported" && Object.keys(record.dependencies).length === 0)) ?? false
          for (const step of recipe?.steps ?? []) if (recorded(step.id) && !entered(step.id)) visit(step.id)
          for (const step of recipe?.steps ?? []) {
            if (steps[step.id] !== undefined && recorded(step.id)) continue
            if (!stages.includes(step.id)) {
              steps[step.id] = { records: [], skip: { reason: "this run was started with toolkit version 1, which had no such step", at: run.created } }
            } else if (neededByRecorded.has(step.id)) {
              // Version 1 let a later stage depend on an earlier one directly, so work it went past
              // was never asked for; it is not asked for now either.
              steps[step.id] = { records: [], skip: { reason: "this version 1 run went past this step without it", at: run.created } }
            }
          }
          return { ...run, steps }
        })

      const parse = (path: string, raw: unknown, mapping: LegacyRecipes, delivered: ReadonlyArray<string>): Effect.Effect<RunRef, ToolError> =>
        Effect.gen(function*() {
          const current = isV1Run(raw) ? yield* withoutNewSteps(yield* attempt(`read ${path}`, () => fromV1(raw, path, mapping), "malformed")) : raw
          const run = yield* decodeRun(path)(current)
          return { path, dir: parentOf(path), run, delivered: delivered.some((root) => isUnder(root, path)) }
        })

      const read = (path: string): Effect.Effect<RunRef, ToolError> =>
        Effect.gen(function*() {
          const config = yield* configs.load
          return yield* parse(path, yield* files.readJson(path), yield* legacy, yield* deliveredRoots(config))
        })

      const filesIn = (under: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, ToolError> =>
        Effect.gen(function*() {
          const found: Array<string> = []
          for (const root of under) {
            found.push(...(yield* files.walk(root, {
              skip: (path, kind) => {
                const name = path.split("/").at(-1) ?? ""
                return kind === "directory" ? name === "node_modules" || name === ".git" || name === LOCAL_STATE_DIR : name !== RUN_FILE
              }
            })))
          }
          return found
        })

      const scan: Effect.Effect<RunScan, ToolError> = Effect.gen(function*() {
        const config = yield* configs.load
        const mapping = yield* legacy
        const delivered = yield* deliveredRoots(config)
        const runs: Array<RunRef> = []
        const unreadable: Array<{ path: string; message: string }> = []
        for (const path of yield* filesIn(yield* roots(config))) {
          const result = yield* Effect.result(Effect.flatMap(files.readJson(path), (raw) => parse(path, raw, mapping, delivered)))
          if (result._tag === "Success") runs.push(result.success)
          else unreadable.push({ path, message: result.failure.message })
        }
        return { runs, unreadable }
      })

      const find = (reference: string): Effect.Effect<RunRef, ToolError> =>
        Effect.gen(function*() {
          const [id = "", attemptText] = reference.split(":")
          const wanted = attemptText === undefined ? null : Number.parseInt(attemptText, 10)
          if (wanted !== null && !(Number.isSafeInteger(wanted) && wanted > 0)) {
            return yield* fail("invalid", `run ${JSON.stringify(reference)}: expected <id> or <id>:<attempt number>`)
          }
          const { runs, unreadable } = yield* scan
          const matches = runs.filter((ref) => ref.run.id === id && (wanted === null || ref.run.n === wanted))
          if (matches.length === 0) {
            const known = [...new Set(runs.map((ref) => ref.run.id))].sort()
            const broken = unreadable.length > 0 ? ` ${unreadable.length} run file(s) could not be read ("jam doctor" lists them).` : ""
            return yield* fail("not_found", `no run for ${JSON.stringify(reference)}.${broken}`, {
              fix: known.length > 0
                ? `known subjects: ${known.slice(0, 12).join(", ")}${known.length > 12 ? ", ..." : ""}; or start one with "jam run start <recipe> ${id} --brief <file>"`
                : `start one with "jam run start <recipe> ${id} --brief <file>"`
            })
          }
          // Newest attempt first; the delivered copy of an attempt stands for it.
          return matches.sort((a, b) => b.run.n - a.run.n || Number(b.delivered) - Number(a.delivered))[0]!
        })

      const lockPath = (path: string): string => `${path}.lock`

      return {
        roots: Effect.flatMap(configs.load, roots),
        filesIn,
        scan,
        find,
        read,
        lockPath,
        open: (reference) =>
          Effect.gen(function*() {
            const ref = yield* find(reference)
            return { ref, recipe: yield* recipes.get(ref.run.recipe), config: yield* configs.load }
          }),
        nextAttempt: (id, scratch) =>
          Effect.gen(function*() {
            const { runs } = yield* scan
            let n = Math.max(0, ...runs.filter((ref) => ref.run.id === id).map((ref) => ref.run.n)) + 1
            // A folder left behind by a run that was never written still takes its number.
            while (yield* files.exists(`${scratch}/${id}/${n}/${RUN_FILE}`)) n++
            return { n, dir: `${scratch}/${id}/${n}` }
          }),
        create: (dir, run) =>
          Effect.gen(function*() {
            const path = `${dir}/${RUN_FILE}`
            if (yield* files.exists(path)) return yield* fail("conflict", `${path} already exists`, { fix: "choose another --dir, or continue that run" })
            const checked = yield* decodeRun(path)(run)
            yield* files.writeJson(path, checked)
            return yield* read(path)
          }),
        mutate: (path, change) =>
          Effect.scoped(Effect.gen(function*() {
            yield* files.lock(lockPath(path)).pipe(Effect.mapError((error) =>
              error.code === "locked"
                ? toolError("locked", `${path} is being written by another command`, { fix: `wait for it; if it crashed, "jam run unlock <id>" removes the lock once its process is verified gone` })
                : error))
            const current = yield* read(path)
            const [next, result] = yield* change(current.run)
            yield* files.writeJson(path, yield* decodeRun(path)(next))
            return result
          })),
        ledgerLock: Effect.flatMap(configs.load, (config) => files.lock(`${config.roots.scratch}/${LOCAL_STATE_DIR}/jobs.lock`))
      }
    })
  )
}
