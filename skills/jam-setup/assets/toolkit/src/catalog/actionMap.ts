// The types of every built-in and viewer action: the input a caller sends and the result it gets,
// derived from the definitions the registry decodes and publishes (`builtinActions`,
// `VIEWER_ACTIONS`), so adding an action is one edit. `Catalog.run` and a plugin's `RunAction` are
// typed by it, so code calling a known action needs no cast. Types only: nothing here runs.
import type * as Schema from "effect/Schema"
import type { builtinActions } from "./builtinActions.ts"
import type { VIEWER_ACTIONS } from "./viewerActions.ts"

/** One action's input (as sent, before decoding) and result. */
interface Typed<I extends Schema.Top, O extends Schema.Top> {
  readonly input: I["Encoded"]
  readonly output: O["Type"]
}

type Definition = (typeof builtinActions)[number] | (typeof VIEWER_ACTIONS)[number]

export type ActionMap = { readonly [D in Definition as D["name"]]: Typed<D["input"], D["output"]> }

export type ActionName = keyof ActionMap

// Every definition must keep its literal name: a name widened to `string` would type every call
// loosely, so it fails the typecheck here.
type Holds<T extends true> = T
export type NamesAreLiteral = Holds<string extends ActionName ? false : true>

export type ActionInput<A extends ActionName> = ActionMap[A]["input"]
export type ActionOutput<A extends ActionName> = ActionMap[A]["output"]

/**
 * The arguments after a known action's name: its input (optional when it may be empty), then
 * whatever else the caller takes.
 */
export type InputArgs<A extends ActionName, Rest extends ReadonlyArray<unknown> = []> = {} extends ActionInput<A>
  ? [input?: ActionInput<A>, ...Rest]
  : [input: ActionInput<A>, ...Rest]

/** A name that is not a known action: run untyped, as a plugin action is. */
export type OtherAction<N extends string> = N extends ActionName ? never : N
