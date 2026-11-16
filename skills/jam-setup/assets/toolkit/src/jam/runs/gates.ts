// Who must accept a step. The recipe is the policy; the project's review mode can only lower it
// and a run's own `--human` list can only raise it.
import type { ReviewMode } from "../config/schema.ts"
import type { Gate } from "../recipes/schema.ts"

export interface GateInfo {
  /** What is required right now. */
  readonly required: Gate
  /** What the recipe asks for. */
  readonly recipe: Gate
  /** Why `required` differs from `recipe`, when it does. */
  readonly because?: string
}

const RANK: Record<Gate, number> = { none: 0, agent: 1, human: 2 }

export const gateFor = (mode: ReviewMode, recipe: Gate, tightened: boolean): GateInfo => {
  if (tightened) return recipe === "human" ? { required: "human", recipe } : { required: "human", recipe, because: "this run was started with --human for this step" }
  if (mode === "none" && recipe !== "none") return { required: "none", recipe, because: `review.mode is "none" in jam.config.json` }
  if (mode === "agent" && RANK[recipe] > RANK.agent) return { required: "agent", recipe, because: `review.mode is "agent" in jam.config.json` }
  return { required: recipe, recipe }
}
