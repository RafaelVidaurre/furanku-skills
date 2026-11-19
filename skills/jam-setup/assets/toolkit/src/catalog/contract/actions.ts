// Project actions in the catalog's registry, and the checks `doctor` runs.
import type * as Schema from "effect/Schema"
import type { ActionName, ActionOutput, InputArgs, OtherAction } from "../actionMap.ts"
import type { PluginContext, PluginResult } from "./context.ts"
import type { Actor } from "./review.ts"

/**
 * Pieces for action inputs, the ones built-in actions use: `optional(S)` is a field that may be
 * absent or `null` (JSON clients send `null` for "not given"); `Text` is a non-empty string.
 */
export { optional, Text } from "../action.ts"

/**
 * Runs a catalog action from inside a plugin. Writes keep the calling action's actor. A built-in
 * action's input and result are typed; any other name (another plugin's action) is not.
 */
export interface RunAction {
  <A extends ActionName>(action: A, ...args: InputArgs<A>): Promise<ActionOutput<A>>
  <N extends string>(action: OtherAction<N>, input?: unknown): Promise<unknown>
}

/** What a read action receives: from a read, `run` runs reads only. */
export interface ReadActionContext extends PluginContext {
  readonly run: RunAction
}

/** What a write action receives: the declared actor, its request id, and `run` for nested actions. */
export interface WriteActionContext extends PluginContext {
  readonly actor: Actor
  /** Nested writes get request ids derived from this one. */
  readonly requestId: string | null
  readonly run: RunAction
}

export type ActionContext = ReadActionContext | WriteActionContext

interface ActionFields<S extends Schema.Top, O extends Schema.Top> {
  /** `<plugin name>.<operation>`. */
  readonly name: string
  readonly description: string
  /** A `Schema.Struct`; published as JSON Schema and decoded before `run`. */
  readonly input: S
  /** What `run` returns, published as the action's `output`. A write's result may also carry `replayed: true`. */
  readonly output?: O
}

interface ReadAction<S extends Schema.Top, O extends Schema.Top> extends ActionFields<S, O> {
  readonly access: "read"
  run(input: S["Type"], context: ReadActionContext): PluginResult<O["Encoded"]>
}

interface WriteAction<S extends Schema.Top, O extends Schema.Top> extends ActionFields<S, O> {
  readonly access: "write"
  run(input: S["Type"], context: WriteActionContext): PluginResult<O["Encoded"]>
}

/**
 * An action the project adds to the catalog's registry. It is listed by `catalog actions`, takes
 * the same actor and request-id rules as built-in writes, and its input is decoded with `input`.
 * `access` says whether it only reads (`read`) or changes records or files (`write`, which needs
 * a declared actor).
 */
export type PluginAction<S extends Schema.Top = Schema.Top, O extends Schema.Top = Schema.Top> = ReadAction<S, O> | WriteAction<S, O>

/** Typed constructor for an action: `run` sees the decoded input, and the context its `access` gives. */
export function defineAction<S extends Schema.Top, O extends Schema.Top = Schema.Top>(action: ReadAction<S, O>): PluginAction
export function defineAction<S extends Schema.Top, O extends Schema.Top = Schema.Top>(action: WriteAction<S, O>): PluginAction
export function defineAction(action: unknown): PluginAction {
  return action as PluginAction
}

// ---- Checks

export interface CheckProblem {
  readonly message: string
  /** What the problem is about: a path, a unit id. */
  readonly subject?: string
  /** `info` is worth knowing (work waiting on a person) but does not make the check fail. */
  readonly severity?: "problem" | "info"
  /** A repair `doctor.fix` (`jam catalog doctor --fix`) may apply. Without `apply`, the label is advice for a person. */
  readonly fix?: { readonly label: string; apply?(): PluginResult<void> }
}

export interface CheckContext extends PluginContext {
  /** Read actions only, also while repairs are being applied. */
  readonly run: RunAction
}

export interface Check {
  readonly name: string
  readonly label?: string
  run(context: CheckContext): PluginResult<ReadonlyArray<CheckProblem>>
}

/** Declares a check. It returns its argument; it exists so a type error points at the wrong property. */
export const defineCheck = (check: Check): Check => check
