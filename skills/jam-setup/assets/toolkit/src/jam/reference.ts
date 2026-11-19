// The published contract of the toolkit, generated from its own definitions: JSON Schemas for
// every authored file, and the command reference from the command tree that `--help` prints.
import * as Command from "effect/cli/Command"
import * as CommandSpec from "effect/cli/CommandSpec"
import * as Option from "effect/Option"
import { publishedSchemas } from "../catalog/published.ts"
import { AudioUnit, LinesFile, SpeakersFile } from "./audio/schema.ts"
import { JamConfig, LocalConfig } from "./config/schema.ts"
import { Adapter, EngineInventory, EnginePreviews, Handoff, RECEIPTS } from "./engine/schema.ts"
import { Descriptor } from "./providers/schema.ts"
import { type Published, renderSchema } from "./published.ts"
import { Recipe } from "./recipes/schema.ts"
import { LandmarkFile } from "./rig/landmarks.ts"
import { Run } from "./runs/schema.ts"

export const PUBLISHED: ReadonlyArray<Published> = [
  { file: "jam.config.schema.json", schema: JamConfig },
  { file: "jam.local.schema.json", schema: LocalConfig },
  { file: "recipe.schema.json", schema: Recipe },
  { file: "provider.schema.json", schema: Descriptor },
  { file: "engine-adapter.schema.json", schema: Adapter },
  ...Object.entries(RECEIPTS).map(([command, schema]) => ({ file: `engine-${command}-receipt.schema.json`, schema })),
  { file: "engine-handoff.schema.json", schema: Handoff },
  { file: "engine-inventory.schema.json", schema: EngineInventory },
  { file: "engine-previews.schema.json", schema: EnginePreviews },
  { file: "landmarks.schema.json", schema: LandmarkFile },
  { file: "run.schema.json", schema: Run },
  { file: "audio-unit.schema.json", schema: AudioUnit },
  { file: "audio-lines.schema.json", schema: LinesFile },
  { file: "audio-speakers.schema.json", schema: SpeakersFile },
  ...publishedSchemas
]

/** Every generated file, by its path inside the toolkit. */
export const renderSchemas = (): ReadonlyArray<{ readonly path: string; readonly text: string }> =>
  PUBLISHED.map((entry) => ({ path: `schemas/${entry.file}`, text: renderSchema(entry) }))

export const REFERENCE_PATH = "docs/cli.md"

const HEADER = `# jam command reference

Generated from the command definitions by \`jam schemas write\`; do not edit by hand. Every command also prints this with \`--help\`.

Run commands as \`node <toolkit>/jam.mjs <command>\` from anywhere inside the project (the toolkit folder is \`toolkit\` in \`jam.config.json\`, by default \`tools/jam\`). Paths are project-relative with forward slashes.

Every command accepts:

| Flag | Meaning |
|---|---|
| \`--root <folder>\` | Project folder (default: the nearest folder with \`jam.config.json\`, else the Git checkout) |
| \`--json\` | Print one JSON object on standard output instead of text |
| \`--help\` | Describe the command, its flags and one example |

A failure prints \`error:\` with the field and expected form and, when there is one, \`fix:\` with what to do; with \`--json\` it is \`{"error": {"code", "message", "fix"}}\` on standard error. The exit code is 2 for wrong input and 1 for anything else.

## Starting in the middle of a recipe

A run normally starts at its recipe's first step. When the work begins from an existing file (a bought mesh to retexture, a scan to retopologize), start with \`jam run start <recipe> <id> --from <step>\`: the steps before \`<step>\` are not needed, \`jam run next\` begins at \`<step>\`, and recording that step requires \`--source <origin> --source-evidence <path>\` so the record says where the work came from. Recording any step with \`--source\` and \`--source-evidence\` while the steps it needs are unmet has the same effect for that step.

When one operation produced the results of several steps, record them in one call: \`jam run record <id> topology uv texture --file model=<file> ...\`. One record is written per step, sharing the files; each step's checks and gate apply on their own, and nothing is written unless every step passes.

## Steps that depend on the engine

A recipe step may carry a condition (\`when\`), such as "the engine adapter provides \`import\`". When the condition does not hold the step is skipped automatically, with the reason on record, and later steps treat it as satisfied. \`jam run status\` and \`jam recipe show\` print each condition and whether it holds. A run therefore finishes with any engine adapter and with none.
`

const flagLine = (flag: CommandSpec.Flag): string => {
  const value = flag.typeName === "boolean" ? "" : ` <${flag.metavar ?? flag.typeName}>`
  const repeat = flag.variadic !== undefined ? " (repeatable)" : ""
  return `| \`--${flag.name}${value}\`${repeat} | ${flag.required ? "**Required.** " : ""}${(flag.description ?? "").replaceAll("|", "\\|")} |`
}

const usage = (spec: CommandSpec.Spec): string =>
  [
    ...spec.path,
    ...spec.arguments.map((argument) => {
      const name = argument.variadic !== undefined ? `${argument.name}...` : argument.name
      return argument.required ? `<${name}>` : `[<${name}>]`
    }),
    ...(spec.flags.some((flag) => flag.scope._tag === "Local") ? ["[flags]"] : [])
  ].join(" ")

const section = (root: Command.Command.Any, path: ReadonlyArray<string>, out: Array<string>): void => {
  const spec = Option.getOrUndefined(CommandSpec.resolve(root, path))
  if (spec === undefined || spec.unlisted) return
  const listed = spec.subcommands.filter((sub) => !sub.unlisted)
  if (path.length > 1) {
    out.push("", `${"#".repeat(Math.min(path.length, 3))} ${path.slice(1).join(" ")}`, "", spec.description ?? "")
    if (listed.length === 0) {
      out.push("", "```", usage(spec), "```")
      const described = spec.arguments.filter((argument) => argument.description !== undefined)
      if (described.length > 0) out.push("", "| Argument | Meaning |", "|---|---|", ...described.map((argument) => `| \`${argument.name}\` | ${(argument.description ?? "").replaceAll("|", "\\|")} |`))
      const flags = spec.flags.filter((flag) => flag.scope._tag === "Local" && !flag.hidden)
      if (flags.length > 0) out.push("", "| Flag | Meaning |", "|---|---|", ...flags.map(flagLine))
      for (const example of spec.examples) out.push("", "Example:", "", "```", example.command, "```")
    }
  }
  for (const sub of listed) section(root, [...path, sub.name], out)
}

/** The command reference for a set of top-level commands, as Markdown. */
export const renderReference = (commands: ReadonlyArray<Command.Command.Any>): string => {
  const root = Command.make("jam").pipe(Command.withSubcommands(commands as [Command.Command.Any]))
  const out: Array<string> = [HEADER, "## Commands"]
  const spec = Option.getOrUndefined(CommandSpec.resolve(root, ["jam"]))
  out.push("", "| Command | What it is for |", "|---|---|", ...(spec?.subcommands ?? []).filter((sub) => !sub.unlisted).map((sub) => `| \`jam ${sub.name}\` | ${(sub.description ?? "").split(". ")[0]!.replace(/\.$/, "")} |`))
  section(root, ["jam"], out)
  return `${out.join("\n")}\n`
}
