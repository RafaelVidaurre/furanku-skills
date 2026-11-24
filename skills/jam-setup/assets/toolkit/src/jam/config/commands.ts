// `jam config …` and `jam setup`.
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Effect from "effect/Effect"
import { Output } from "../../kernel/cli.ts"
import { decode } from "../../kernel/decode.ts"
import { attempt, fail, type ToolError } from "../../kernel/errors.ts"
import { isRecord } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { described, flag, maybe, text } from "../cliSupport.ts"
import { CONFIG_FILE, LOCAL_FILE } from "../layout.ts"
import { Recipes } from "../recipes/Recipes.ts"
import type { Gate, Recipe } from "../recipes/schema.ts"
import { lines, pairs } from "../text.ts"
import { Toolkit } from "../Toolkit.ts"
import { Config } from "./Config.ts"
import { getAt, parseValue, removeAt, setAt } from "./edit.ts"
import { migrateConfig, migrateLocal, type MigrationDefaults } from "./migrate.ts"
import { Providers } from "../providers/Providers.ts"
import { JamConfig } from "./schema.ts"
import { rootsOnDisk } from "./spelling.ts"

const summary = (config: JamConfig): string =>
  pairs([
    ["toolkit", config.toolkit],
    ["scratch root", config.roots.scratch],
    ["delivered root", config.roots.delivered],
    ["style", config.style.document === null ? "not set" : `${config.style.document}${config.style.revision === undefined ? "" : ` (revision ${config.style.revision})`}`],
    ["budgets", Object.entries(config.budgets).map(([name, budget]) => `${name} (${budget.kind}, ${budget.triangles.max} tris)`).join(", ") || "none"],
    ["engine", config.engine.adapter ?? "none (glTF conventions)"],
    ["routes", Object.entries(config.routes).map(([route, provider]) => `${route}: ${provider}`).join(", ") || "none"],
    ["spend", Object.entries(config.spend).map(([provider, spend]) => `${provider}: per run ${spend.perRun ?? "no cap"}, total ${spend.total ?? "no cap"}${spend.standing === undefined ? "" : ", standing authorization"}`).join("; ") || "paid work disabled"],
    ["review mode", config.review.mode],
    ["project checks", Object.keys(config.checks).join(", ") || "none"]
  ])

const show = Command.make("show", { path: Argument.String("path").pipe(Argument.withDescription("Dotted field to print, e.g. spend or budgets.prop"), Argument.optional) }, ({ path }) =>
  Effect.gen(function*() {
    const config = yield* (yield* Config).load
    const at = maybe(path)
    if (at === undefined) return yield* (yield* Output).emit(config, summary(config))
    const value = yield* attempt("read the field", () => getAt(config, at), "invalid")
    if (value === undefined) return yield* fail("not_found", `${CONFIG_FILE} has nothing at ${at}`)
    yield* (yield* Output).emit(value, typeof value === "string" ? value : JSON.stringify(value, null, 2))
  })).pipe(described("Show the project configuration, or one field of it.", "jam config show spend"))

const check = Command.make("check", {}, () =>
  Effect.gen(function*() {
    const configs = yield* Config
    const state = yield* configs.state
    const local = yield* configs.local
    if (state.kind !== "ready") yield* configs.load
    yield* (yield* Output).emit({ valid: true, config: CONFIG_FILE, local: Object.keys(local).length > 0 ? LOCAL_FILE : null }, `${CONFIG_FILE} is valid`)
  })).pipe(described("Validate jam.config.json and jam.local.json; every problem is listed with its field.", "jam config check"))

/**
 * What a version 1 project looked like. Version 1 kept a provider's executable as a top-level key
 * of jam.local.json named by the provider's id; those ids are the providers reached through a
 * command line, so they come from the descriptors rather than a list kept here.
 */
const defaultsOf = (toolkit: Toolkit["Service"]): Effect.Effect<MigrationDefaults, ToolError, Providers> =>
  Effect.gen(function*() {
    const raw = (yield* toolkit.readJson("defaults/migration-v1.json")) as Omit<MigrationDefaults, "localProviderKeys">
    const providers = yield* (yield* Providers).list
    const localProviderKeys = providers.filter((entry) => entry.descriptor.transports.some((transport) => transport.kind === "cli")).map((entry) => entry.descriptor.id)
    return { ...raw, localProviderKeys }
  })

const migrate = Command.make("migrate", { dryRun: flag("dry-run", "Print what would be written and change nothing") }, ({ dryRun }) =>
  Effect.gen(function*() {
    const configs = yield* Config
    const recipes = yield* Recipes
    const files = yield* ProjectFiles
    const toolkit = yield* Toolkit
    const output = yield* Output
    const state = yield* configs.state
    if (state.kind === "missing") yield* configs.load
    if (state.kind !== "v1") return yield* output.emit({ migrated: false, reason: "already version 2" }, `${CONFIG_FILE} is already version 2`)
    const defaults = yield* defaultsOf(toolkit)
    const shippedIds = yield* recipes.shipped
    const reviews = new Map<string, Gate>()
    for (const id of shippedIds) {
      for (const step of (yield* recipes.get(`builtin:${id}`)).steps) reviews.set(`${id}/${step.id}`, step.review)
    }
    const result = migrateConfig(state.raw, defaults, { ids: new Set(shippedIds), review: (recipe, step) => reviews.get(`${recipe}/${step}`) })
    const config = yield* decode(JamConfig, { what: `the migrated ${CONFIG_FILE}`, code: "internal" })(result.config)
    const written: Array<string> = []
    const kept: Array<string> = []
    const localRaw = (yield* files.exists(LOCAL_FILE)) ? yield* files.readJson(LOCAL_FILE) : null
    const local = isRecord(localRaw) ? migrateLocal(localRaw, defaults) : null
    if (!dryRun) {
      yield* configs.save(result.config)
      for (const recipe of result.recipes) {
        // A recipe the project already wrote is the project's; it is never replaced.
        if (yield* files.exists(recipes.projectPath(recipe.id))) kept.push(recipes.projectPath(recipe.id))
        else written.push(yield* recipes.write(recipe))
      }
      if (local?.changed) yield* configs.saveLocal(local.local)
    }
    const planned = result.recipes.map((recipe: Recipe) => recipes.projectPath(recipe.id))
    yield* output.emit(
      { migrated: !dryRun, config, recipes: dryRun ? planned : written, kept, local: local?.changed ?? false, notes: result.notes },
      lines(
        dryRun ? `would upgrade ${CONFIG_FILE} to version 2 (nothing written)` : `${CONFIG_FILE} is now version 2`,
        ...(dryRun ? planned : written).map((path) => `${dryRun ? "would write" : "wrote"} ${path}`),
        ...kept.map((path) => `kept ${path} (already in the project)`),
        local?.changed ? `${dryRun ? "would move" : "moved"} provider executables in ${LOCAL_FILE} under "providers"` : null,
        ...result.notes.map((note) => `note: ${note}`)
      )
    )
  })).pipe(described(
    "Upgrade a version 1 jam.config.json: profiles become budgets, the review policy becomes recipes under jam/recipes/, spending limits become per-run caps. Version 1 runs stay readable.",
    "jam config migrate --dry-run"
  ))

const set = Command.make("set", {
  path: Argument.String("path").pipe(Argument.withDescription("Dotted field, e.g. review.mode or spend.<provider>.perRun")),
  value: Argument.String("value").pipe(Argument.withDescription("New value: text, a number, true/false, none (no value), or JSON for an object"), Argument.optional),
  remove: flag("remove", "Remove the field instead of setting it")
}, (input) =>
  Effect.gen(function*() {
    const value = maybe(input.value)
    if (input.remove === (value !== undefined)) return yield* fail("invalid", "give a value, or --remove to delete the field (one of them)")
    const config = yield* (yield* Config).update((raw) => (input.remove ? removeAt(raw, input.path) : setAt(raw, input.path, parseValue(value!))))
    const now = input.remove ? undefined : getAt(config, input.path)
    yield* (yield* Output).emit({ path: input.path, value: now ?? null, removed: input.remove }, input.remove ? `removed ${input.path}` : `${input.path} = ${JSON.stringify(now)}`)
  })).pipe(described(
    "Change one field of jam.config.json. The whole file is validated before it is written, so a wrong value changes nothing.",
    "jam config set review.mode agent"
  ))

export const config = Command.make("config").pipe(
  Command.withDescription("Project configuration (jam.config.json)"),
  Command.withSubcommands([show, check, migrate, set])
)

const merge = (base: unknown, over: unknown): unknown => {
  if (!isRecord(base) || !isRecord(over)) return over === undefined ? base : over
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(over)) out[key] = merge(base[key], value)
  return out
}

export const setup = Command.make("setup", {
  from: text("from", "JSON file with the decided choices: any fields of jam.config.json"),
  defaults: Flag.Boolean("defaults").pipe(Flag.withDescription("Write the toolkit's defaults as they are; change single fields afterwards with jam config set"), Flag.withDefault(false))
}, ({ defaults, from }) =>
  Effect.gen(function*() {
    const configs = yield* Config
    const files = yield* ProjectFiles
    const toolkit = yield* Toolkit
    const output = yield* Output
    const shipped = yield* toolkit.readJson("defaults/config.json")
    // The toolkit knows where it is installed; the choices need not repeat it.
    const installedAt = yield* files.relative(toolkit.dir).pipe(Effect.catch(() => Effect.succeed(null)))
    const located = installedAt === null || !isRecord(shipped) ? shipped : { ...shipped, toolkit: installedAt }
    // Default folders the project already has in another letter case keep the project's spelling.
    const onDisk = (config: unknown): unknown =>
      isRecord(config) && isRecord(config["roots"]) ? { ...config, roots: rootsOnDisk(files.root, config["roots"]) } : config
    const template = onDisk(located)
    const source = maybe(from)
    if (source !== undefined && defaults) return yield* fail("invalid", "give --from <file> or --defaults, not both")
    if (source === undefined && !defaults) {
      return yield* output.emit(
        { configured: (yield* configs.state).kind !== "missing", template, schema: toolkit.path("schemas/jam.config.schema.json") },
        lines(
          "Decide these with the person, write the ones that differ to a JSON file, then: jam setup --from <file>  (or take them as they are: jam setup --defaults)",
          JSON.stringify(template, null, 2),
          `every field is described in ${toolkit.path("schemas/jam.config.schema.json")}`
        )
      )
    }
    if ((yield* configs.state).kind !== "missing") {
      return yield* fail("conflict", `${CONFIG_FILE} already exists; setup never replaces it`, { fix: `change single fields with "jam config set <path> <value>"` })
    }
    const choices = source === undefined ? {} : yield* files.readJson(source)
    if (!isRecord(choices)) return yield* fail("invalid", `${source}: expected a JSON object with fields of ${CONFIG_FILE}`)
    if (choices["version"] === 1) return yield* fail("unsupported", `${source} is a version 1 configuration`, { fix: `save it as ${CONFIG_FILE} and run "jam config migrate"` })
    const config = yield* configs.save(onDisk(merge(template, choices)))
    yield* output.emit({ configured: true, config }, lines(`wrote ${CONFIG_FILE}`, summary(config), "next: jam doctor"))
  })).pipe(described(
    "Create jam.config.json from decided choices merged over the toolkit's defaults, or from the defaults alone. With neither flag it prints the defaults to decide on. It never authenticates, spends, or replaces an existing file.",
    "jam setup --from choices.json"
  ))
