// Named checks a recipe step can require. A check looks at one record in its run and returns
// problems; no problems means it passed.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { Executables } from "../../kernel/Executable.ts"
import { isRecord } from "../../kernel/hash.ts"
import { Process } from "../../kernel/Process.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import type { Problem } from "../common.ts"
import { Config } from "../config/Config.ts"
import type { Budget, CommandCheck } from "../config/schema.ts"
import type { ResolvedStep } from "../recipes/schema.ts"
import type { RunContext } from "../runs/Runs.ts"
import type { StepRecord } from "../runs/schema.ts"

export interface CheckInput {
  /** The run as it will be with `record` as the step's latest record. */
  readonly context: RunContext
  readonly step: ResolvedStep
  readonly record: StepRecord
}

export interface Check {
  readonly id: string
  readonly description: string
  /** record: runs once, when the step is recorded. status: also every time status is read (must be cheap). */
  readonly when: "record" | "status"
  /** Absent for a named check whose implementation another part of the toolkit supplies. */
  readonly run?: (input: CheckInput) => Effect.Effect<ReadonlyArray<Problem>, ToolError>
}

export interface CheckInfo {
  readonly id: string
  readonly description: string
  readonly when: "record" | "status"
  readonly source: "shipped" | "project"
  readonly implemented: boolean
}

/** Checks contributed by other parts of the toolkit (audio, the catalog). An id that is already declared is replaced. */
export const ExtraChecks = Context.Reference<ReadonlyArray<Check>>("jam/ExtraChecks", { defaultValue: () => [] })

export const budgetOf = (context: RunContext): { readonly name: string | null; readonly budget: Budget | null } => {
  const name = context.ref.run.budget
  return { name, budget: name === null ? null : context.config.budgets[name] ?? null }
}

const substitute = (argv: ReadonlyArray<string>, input: CheckInput): ReadonlyArray<string> | Problem => {
  const out: Array<string> = []
  const paths = (role: string): ReadonlyArray<string> => input.record.files.filter((file) => file.role === role).map((file) => file.path)
  for (const token of argv) {
    const many = /^\{files:([a-z0-9-]+)\}$/.exec(token)
    if (many) {
      out.push(...paths(many[1]!))
      continue
    }
    let problem: Problem | undefined
    const replaced = token
      .replaceAll(/\{file:([a-z0-9-]+)\}/g, (_, role: string) => {
        const found = paths(role)
        if (found.length !== 1) problem = { message: `the check needs exactly one file with role ${role}; the record has ${found.length}` }
        return found[0] ?? ""
      })
      .replaceAll("{run}", input.context.ref.path)
      .replaceAll("{dir}", input.context.ref.dir)
      .replaceAll("{id}", input.context.ref.run.id)
      .replaceAll("{step}", input.step.id)
    if (problem !== undefined) return problem
    out.push(replaced)
  }
  return out
}

export class Checks extends Context.Service<Checks, {
  readonly list: Effect.Effect<ReadonlyArray<CheckInfo>, ToolError>
  /** Run one check. An unknown id fails; a failing check returns problems. */
  run(id: string, input: CheckInput): Effect.Effect<ReadonlyArray<Problem>, ToolError>
  /** When a check runs; unknown ids count as record-time. */
  when(id: string): Effect.Effect<"record" | "status", ToolError>
}>()("jam/Checks") {
  /** The registry over a set of shipped checks, plus `ExtraChecks` and the project's command checks. */
  static readonly layerOf = <E, R>(shipped: Effect.Effect<ReadonlyArray<Check>, E, R>): Layer.Layer<Checks, E, R | Config | Process | ProjectFiles | Executables> =>
    Layer.effect(
      Checks,
      Effect.gen(function*() {
        const configs = yield* Config
        const proc = yield* Process
        const files = yield* ProjectFiles
        const executables = yield* Executables
        const extra = yield* ExtraChecks
        const builtin = new Map<string, Check>()
        for (const check of [...(yield* shipped), ...extra]) builtin.set(check.id, check)

        const project = Effect.map(configs.state, (state) => (state.kind === "ready" ? state.config.checks : {}))

        const runCommand = (id: string, check: CommandCheck, input: CheckInput): Effect.Effect<ReadonlyArray<Problem>, ToolError> =>
          Effect.gen(function*() {
            const argv = substitute(check.run, input)
            if (!Array.isArray(argv)) return [argv as Problem]
            const [first = "", ...rest] = argv as ReadonlyArray<string>
            const program = first === "node" ? executables.node : first === "python" || first === "blender" ? yield* configs.tool(first) : first
            const result = yield* proc.run(program, rest, { cwd: files.root, timeoutMs: 300_000 })
            const output = Buffer.from(result.stdout).toString("utf8").trim()
            if (result.code !== 0) {
              return [{ message: `check ${id} could not run (exit ${result.code}): ${(result.stderr.trim() || output).split("\n").slice(-3).join(" ")}`, fix: `fix the command under checks.${id} in jam.config.json` }]
            }
            let parsed: unknown
            try {
              parsed = JSON.parse(output)
            } catch {
              parsed = null
            }
            if (!isRecord(parsed) || !Array.isArray(parsed["problems"])) {
              return [{ message: `check ${id} must print {"problems": [...]}; it printed: ${output.slice(0, 120) || "(nothing)"}`, fix: `fix the command under checks.${id} in jam.config.json` }]
            }
            return parsed["problems"].map((problem): Problem =>
              isRecord(problem) && typeof problem["message"] === "string"
                ? { message: problem["message"], ...(typeof problem["fix"] === "string" ? { fix: problem["fix"] } : {}) }
                : { message: String(problem) })
          })

        return {
          list: Effect.map(project, (commands) => [
            ...[...builtin.values()].filter((check) => !(check.id in commands)).map((check): CheckInfo => ({
              id: check.id,
              description: check.description,
              when: check.when,
              source: "shipped",
              implemented: check.run !== undefined
            })),
            ...Object.entries(commands).map(([id, check]): CheckInfo => ({
              id,
              description: check.description ?? check.run.join(" "),
              when: check.when ?? "record",
              source: "project",
              implemented: true
            }))
          ]),
          when: (id) => Effect.map(project, (commands) => commands[id]?.when ?? (id in commands ? "record" : builtin.get(id)?.when ?? "record")),
          run: (id, input) =>
            Effect.gen(function*() {
              const command = (yield* project)[id]
              if (command !== undefined) return yield* runCommand(id, command, input)
              const check = builtin.get(id)
              if (check === undefined) {
                return yield* fail("not_found", `check ${id} does not exist`, { fix: `"jam recipe check" lists the recipes that name it; define it under "checks" in jam.config.json or remove it from the step` })
              }
              if (check.run === undefined) {
                return [{ message: `check ${id} has no implementation in this toolkit`, fix: "it is supplied by a part of the toolkit that is not installed here (audio tools); remove it from the step or install that part" }]
              }
              return yield* check.run(input)
            })
        }
      })
    )
}
