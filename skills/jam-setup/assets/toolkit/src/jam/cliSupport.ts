// Small helpers shared by the command files.
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Option from "effect/Option"

export const maybe = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value)

/** A comma-separated flag value as a list. */
export const csv = (value: Option.Option<string>): ReadonlyArray<string> =>
  Option.match(value, { onNone: () => [], onSome: (text) => text.split(",").map((part) => part.trim()).filter((part) => part !== "") })

/** Description plus one worked example, so `--help` is enough to use a command cold. */
export const described = (description: string, example: string, exampleNote?: string) =>
<Name extends string, Input, ContextInput, E, R>(command: Command.Command<Name, Input, ContextInput, E, R>): Command.Command<Name, Input, ContextInput, E, R> =>
  command.pipe(Command.withDescription(description), Command.withExamples([{ command: example, description: exampleNote }]))

export const text = (name: string, description: string) => Flag.String(name).pipe(Flag.withDescription(description), Flag.optional)
export const many = (name: string, description: string) => Flag.String(name).pipe(Flag.withDescription(description), Flag.atLeast(0))
export const flag = (name: string, description: string) => Flag.Boolean(name).pipe(Flag.withDescription(description), Flag.withDefault(false))
