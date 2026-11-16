// Catalog command group: `jam catalog …`. The data commands are here; the commands that involve a
// server are in server/commands.ts. Nothing of the HTTP server or the browser is loaded until a
// command that serves runs.
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Layer from "effect/Layer"
import type { CommandGroup } from "../cli/main.ts"
import { Output } from "../kernel/cli.ts"
import { Detached } from "../kernel/Detached.ts"
import { fail, type ToolError, toolError } from "../kernel/errors.ts"
import type { ActionInfo } from "./Actions.ts"
import { Catalog, type RunMeta } from "./Catalog.ts"
import { callAction } from "./server/client.ts"
import { serverCommands } from "./server/commands.ts"
import { ServerState } from "./ServerState.ts"
import { isViewerAction, viewerActionInfo } from "./viewerActions.ts"

const columns = (rows: ReadonlyArray<ReadonlyArray<string>>): string => {
  const widths = rows.reduce<Array<number>>((max, row) => row.map((cell, index) => Math.max(max[index] ?? 0, cell.length)), [])
  return rows.map((row) => row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join("  ").trimEnd()).join("\n")
}
const short = (text: string, max = 72): string => {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const actorFlags = {
  actorKind: Flag.String("actor-kind").pipe(Flag.withDescription("Who is acting: human or agent (required for writes; default $CATALOG_ACTOR_KIND)"), Flag.optional),
  actorName: Flag.String("actor-name").pipe(Flag.withDescription("The actor's name (default $CATALOG_ACTOR_NAME, or the Git user for a human)"), Flag.optional),
  requestId: Flag.String("request-id").pipe(Flag.withDescription("Makes a write repeatable: the same id and input records once"), Flag.optional)
}

/** The actor a command declares. Attribution is a declaration; an agent must say it is one. */
const metaOf = (flags: { readonly actorKind: Option.Option<string>; readonly actorName: Option.Option<string>; readonly requestId: Option.Option<string> }): Effect.Effect<RunMeta, never, Catalog> =>
  Effect.gen(function*() {
    const kind = Option.getOrUndefined(flags.actorKind) ?? process.env["CATALOG_ACTOR_KIND"]
    const named = Option.getOrUndefined(flags.actorName) ?? process.env["CATALOG_ACTOR_NAME"]
    const name = named ?? (kind === "human" ? (yield* (yield* Catalog).defaultActor).name : undefined)
    const requestId = Option.getOrUndefined(flags.requestId)
    return { ...(kind === undefined ? {} : { actor: { kind, name } }), ...(requestId === undefined ? {} : { requestId }) }
  })

const readStdin: Effect.Effect<string, ToolError> = Effect.tryPromise({
  try: async () => {
    const chunks: Array<Buffer> = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString("utf8")
  },
  catch: (cause) => toolError("invalid", `could not read the input from standard input: ${String(cause)}`)
})

const parseInput = (given: Option.Option<string>): Effect.Effect<unknown, ToolError> =>
  Effect.gen(function*() {
    if (Option.isNone(given)) return {}
    const text = given.value === "-" ? yield* readStdin : given.value
    return yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) => toolError("invalid", `--input is not valid JSON: ${(cause as Error).message}`, { fix: "pass one JSON object, or --input - to read it from standard input" })
    })
  })

const actions = Command.make("actions", {}, () =>
  Effect.gen(function*() {
    // Viewer actions run in a server (`jam catalog open`); they are listed with the rest.
    const list = [...(yield* (yield* Catalog).discover), ...viewerActionInfo()]
    yield* (yield* Output).emit({ actions: list }, () => columns(list.map((action: ActionInfo) => [action.name, action.kind, short(action.description)])))
  })).pipe(Command.withDescription("List every action with its input schema (--json for the schemas)"))

const run = Command.make(
  "run",
  {
    action: Argument.String("action").pipe(Argument.withDescription("An action name from `jam catalog actions`")),
    input: Flag.String("input").pipe(Flag.withDescription("The input as one JSON object, or - to read it from standard input"), Flag.optional),
    url: Flag.String("url").pipe(Flag.withDescription("Run the action on this catalog server (viewer.* actions default to this checkout's running server)"), Flag.optional),
    ...actorFlags
  },
  (flags) =>
    Effect.gen(function*() {
      const catalog = yield* Catalog
      const input = yield* parseInput(flags.input)
      const meta = yield* metaOf(flags)
      // Viewer actions drive a page in a server's browser, so they go to the server; any action
      // goes there when its address is given.
      const viewer = isViewerAction(flags.action)
      const url = Option.getOrUndefined(flags.url) ?? (viewer ? (yield* catalog.server)?.url : undefined)
      if (viewer && url === undefined) {
        return yield* fail("unavailable", `${flags.action} needs a running catalog server and none is recorded for this checkout`, { fix: "start one with `jam catalog open`, or pass --url" })
      }
      const result = url === undefined ? yield* catalog.run(flags.action, input, meta) : yield* callAction(url, flags.action, { input, actor: meta.actor, requestId: meta.requestId })
      // An action's result is data for a program; it has no shorter text form.
      yield* (yield* Output).emit(result)
    })
).pipe(Command.withDescription("Run one catalog action and print its result as JSON"))

interface Linked {
  readonly route?: string
  readonly url?: string
}
interface Inbox {
  readonly counts: { readonly waiting: number; readonly notes: number; readonly changed: number; readonly problems: number }
  readonly waiting: ReadonlyArray<Linked & { readonly ref: string; readonly title: string; readonly waiting: number; readonly items: number; readonly by: { readonly name: string } }>
  readonly notes: ReadonlyArray<Linked & { readonly targetName: string; readonly partLabel: string | null; readonly body: string; readonly by: { readonly name: string } }>
  readonly changed: ReadonlyArray<Linked & { readonly name: string; readonly target: { readonly kind: string; readonly id: string }; readonly parts: ReadonlyArray<{ readonly label: string; readonly verdict: string | null }> }>
  readonly problems: ReadonlyArray<{ readonly source: string; readonly error: string }>
  readonly hint?: string
}

/** Where to open an entry: the full address while a server runs, else the route the hint explains. */
const where = (entry: Linked): string => entry.url ?? entry.route ?? ""

const todoText = (inbox: Inbox): string => {
  const { counts } = inbox
  if (counts.waiting + counts.notes + counts.changed + counts.problems === 0) return "Nothing is waiting: no undecided reviews, open notes, changed verdicts or problems."
  const section = (title: string, total: number, rows: ReadonlyArray<ReadonlyArray<string>>): Array<string> =>
    total === 0 ? [] : [`${title} (${total})`, columns(rows.map((row) => ["", ...row])), ...(rows.length < total ? [`  … ${total - rows.length} more`] : []), ""]
  return [
    // A review waits on whoever decides it; the submitter is only who asked.
    ...section("Reviews waiting for a verdict", counts.waiting, inbox.waiting.map((review) => [review.ref, short(review.title, 48), `${review.waiting} of ${review.items} items undecided`, `asked by ${review.by.name}`, where(review)])),
    ...section("Open notes", counts.notes, inbox.notes.map((note) => [short(`${note.targetName}${note.partLabel ? ` · ${note.partLabel}` : ""}`, 36), short(note.body, 60), `from ${note.by.name}`, where(note)])),
    ...section("Changed since their verdict", counts.changed, inbox.changed.map((entry) => [`${entry.target.kind} ${entry.target.id}`, entry.parts.map((part) => `${part.label} (${part.verdict})`).join(", "), where(entry)])),
    ...section("Problems", counts.problems, inbox.problems.map((problem) => [short(problem.source, 40), short(problem.error, 80)])),
    ...(inbox.hint === undefined ? [] : [inbox.hint])
  ].join("\n").trimEnd()
}

const todo = Command.make("todo", {}, () =>
  Effect.gen(function*() {
    const inbox = (yield* (yield* Catalog).run("inbox", {})) as Inbox
    yield* (yield* Output).emit(inbox, () => todoText(inbox))
  })).pipe(Command.withDescription("What is waiting on someone: reviews, open notes, changed verdicts, problems"))

interface DoctorReport {
  readonly ok: boolean
  readonly summary: { readonly problems: number; readonly info: number; readonly fixable: number; readonly fixed: number }
  readonly checks: ReadonlyArray<{ readonly label: string; readonly problems: ReadonlyArray<{ readonly message: string; readonly severity: string; readonly fix: string | null; readonly fixable: boolean }> }>
}

const doctorText = (report: DoctorReport, fix: boolean): string => {
  const lines: Array<string> = []
  for (const check of report.checks) {
    if (check.problems.length === 0) continue
    lines.push(`${check.label} (${check.problems.length})`)
    for (const problem of check.problems) {
      lines.push(`  ${problem.severity === "info" ? "-" : "!"} ${problem.message}`)
      if (problem.fix) lines.push(`      fix: ${problem.fix}${problem.fixable && !fix ? " (jam catalog doctor --fix)" : ""}`)
    }
    lines.push("")
  }
  const { summary } = report
  lines.push(report.ok && summary.info === 0 ? "No problems found." : `${summary.problems} to fix, ${summary.info} for information${summary.fixed ? `, ${summary.fixed} fixed` : ""}.`)
  return lines.join("\n")
}

const doctor = Command.make(
  "doctor",
  { fix: Flag.Boolean("fix").pipe(Flag.withDescription("Apply the repairs that checks offer"), Flag.withDefault(false)), ...actorFlags },
  (flags) =>
    Effect.gen(function*() {
      const catalog = yield* Catalog
      const { fix } = flags
      // Checking only reads. Repairs change project files, so they are a write with an actor:
      // the person at this terminal unless the command says otherwise.
      const declared = yield* metaOf(flags)
      const report = (fix
        ? yield* catalog.run("doctor.fix", {}, declared.actor ? declared : { ...declared, actor: yield* catalog.defaultActor })
        : yield* catalog.run("doctor", {})) as DoctorReport
      yield* (yield* Output).emit(report, () => doctorText(report, fix))
      // The report is the result; the exit status says whether anything is left to fix.
      if (!report.ok) yield* Effect.sync(() => void (process.exitCode = 1))
    })
).pipe(Command.withDescription("Check media, Git LFS files, unlinked files, waiting reviews and plugin checks"))

const unlock = Command.make(
  "unlock",
  { lock: Argument.String("lock").pipe(Argument.withDescription("The lock's name or file (see `jam catalog run locks.list`)")), ...actorFlags },
  (flags) =>
    Effect.gen(function*() {
      const catalog = yield* Catalog
      const declared = yield* metaOf(flags)
      // Removing a stale lock is a person's decision at their own terminal unless said otherwise.
      const meta = declared.actor ? declared : { ...declared, actor: yield* catalog.defaultActor }
      const result = (yield* catalog.run("unlock", { lock: flags.lock }, meta)) as { readonly removed: string }
      yield* (yield* Output).emit(result, `removed lock ${result.removed}`)
    })
).pipe(Command.withDescription("Remove a record lock whose owning process has exited on this machine"))

const catalog = Command.make("catalog").pipe(
  Command.withDescription("Browse, organise and review project content"),
  Command.withSubcommands([actions, run, todo, doctor, unlock, ...serverCommands])
)

export const group: CommandGroup = {
  commands: [catalog],
  // One server record for the engine (links in results) and for the commands that manage the server.
  layer: Layer.mergeAll(Catalog.layer, ServerState.layerNoDeps, Detached.layer)
}
