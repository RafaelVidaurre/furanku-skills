// Whether a step's `when` condition holds for a run. A step whose condition does not hold is
// skipped automatically, so one recipe works with any engine adapter and with none.
import { digest } from "../../kernel/hash.ts"
import type { Budget } from "../config/schema.ts"
import type { Condition } from "./schema.ts"

export interface ConditionFacts {
  /** The engine adapter in force and the commands it provides; `problem` when it cannot be resolved. */
  readonly engine: {
    readonly id: string
    readonly chosen: boolean
    readonly commands: ReadonlySet<string>
    /** The kinds each command lists; a command that lists none is absent. */
    readonly kinds: ReadonlyMap<string, ReadonlyArray<string>>
    readonly problem?: string
  }
  readonly budgetName: string | null
  readonly budget: Budget | null
}

export interface ConditionState {
  /** The condition as text, e.g. `engine provides import`. */
  readonly when: string
  readonly met: boolean
  /** Why it does not hold. */
  readonly reason?: string
}

export const evaluateCondition = (condition: Condition, facts: ConditionFacts): ConditionState => {
  const parts: Array<string> = []
  const unmet: Array<string> = []
  if (condition.engine !== undefined) {
    parts.push(`engine provides ${condition.engine}${condition.kind === undefined ? "" : ` --kind ${condition.kind}`}`)
    if (facts.engine.commands.has(condition.engine) && condition.kind !== undefined && !(facts.engine.kinds.get(condition.engine) ?? []).includes(condition.kind)) {
      const listed = facts.engine.kinds.get(condition.engine)
      unmet.push(`engine adapter ${facts.engine.id}'s ${condition.engine} command ${listed === undefined ? "lists no kinds" : `takes ${listed.join(", ")}`}, not ${condition.kind}`)
    }
    if (!facts.engine.commands.has(condition.engine)) {
      unmet.push(
        facts.engine.problem !== undefined
          ? `the engine adapter could not be read (${facts.engine.problem})`
          : facts.engine.chosen
          ? `engine adapter ${facts.engine.id} has no ${condition.engine} command`
          : `no engine adapter is configured, so there is no ${condition.engine} command`
      )
    }
  }
  for (const [field, expected] of Object.entries(condition.budget ?? {})) {
    parts.push(`budget ${field} is ${JSON.stringify(expected)}`)
    const actual = (facts.budget as Record<string, unknown> | null)?.[field]
    if (facts.budget === null) unmet.push(facts.budgetName === null ? "the run has no budget" : `budget ${facts.budgetName} is not defined`)
    else if (digest(actual) !== digest(expected)) unmet.push(`budget ${facts.budgetName} has ${field} ${JSON.stringify(actual ?? null)}`)
  }
  return { when: parts.join(" and "), met: unmet.length === 0, ...(unmet.length === 0 ? {} : { reason: unmet.join("; ") }) }
}
