// The command line as typed. Commands read parsed flags; this is only for what the parser cannot
// tell them: where `--` stood, so everything after it can be passed on to another program verbatim.
import * as Context from "effect/Context"

export const Argv = Context.Reference<ReadonlyArray<string>>("jam/kernel/Argv", { defaultValue: () => process.argv.slice(2) })

/** The arguments after the first `--`, untouched. */
export const afterSeparator = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const at = argv.indexOf("--")
  return at === -1 ? [] : argv.slice(at + 1)
}
