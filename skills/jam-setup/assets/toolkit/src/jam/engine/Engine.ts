// The engine host: resolves the project's adapter, merges its facts with the project's overrides,
// and runs adapter commands under one contract (argv in, one JSON receipt out).
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Schema from "effect/Schema"
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import { decode } from "../../kernel/decode.ts"
import { asToolError, fail, type ToolError } from "../../kernel/errors.ts"
import { Executables } from "../../kernel/Executable.ts"
import { isRecord } from "../../kernel/hash.ts"
import { Process } from "../../kernel/Process.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Config } from "../config/Config.ts"
import { ENGINES_DIR } from "../layout.ts"
import { Toolkit } from "../Toolkit.ts"
import { headingAnchor } from "../recipes/guides.ts"
import { Adapter, type AdapterCommand, type Facts, Handoff, HANDOFF_EXIT, RECEIPTS, type ResolvedFacts, type Verb, VERBS } from "./schema.ts"

const ADAPTER_FILE = "adapter.json"
const DEFAULT_PRESET = "gltf"
const CORE_FACTS = ["unitsPerMeter", "up", "forward", "handedness"] as const

export interface ResolvedAdapter {
  readonly id: string
  readonly label: string
  /** project: a folder under jam/engines. preset: facts the toolkit ships. default: no engine chosen. */
  readonly source: "project" | "preset" | "default"
  /** Project path of the adapter folder, for a project adapter. */
  readonly dir: string | null
  readonly adapter: Adapter
  readonly facts: ResolvedFacts
  /** Names of the commands the adapter runs itself. */
  readonly provides: ReadonlyArray<string>
}

/** A guidance document of the adapter, or the section of it that covers one topic. */
export interface Guide {
  readonly topic: string
  /** Where to read it: a project path, or an absolute path for a preset outside the project. */
  readonly path: string
  readonly text: string
}

/**
 * What became of a command. ran: the adapter did it and printed its receipt. manual: the adapter
 * has no such command, so it is done by hand following the guide. handoff: the adapter could not
 * reach the engine from here and says what to do; nothing was done.
 */
export type EngineOutcome =
  | { readonly status: "ran"; readonly command: string; readonly adapter: string; readonly receipt: Record<string, unknown> }
  | { readonly status: "manual"; readonly command: string; readonly adapter: string; readonly guide: Guide | null; readonly next: string }
  | { readonly status: "handoff"; readonly command: string; readonly adapter: string; readonly reason: string; readonly steps: ReadonlyArray<unknown>; readonly resume: string }

const merge = (base: unknown, over: unknown): unknown => {
  if (!isRecord(base) || !isRecord(over)) return over === undefined ? base : over
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(over)) out[key] = merge(base[key], value)
  return out
}

export class Engine extends Context.Service<Engine, {
  readonly resolved: Effect.Effect<ResolvedAdapter, ToolError>
  /** Presets the toolkit ships and adapters installed in the project. */
  readonly available: Effect.Effect<ReadonlyArray<{ readonly id: string; readonly source: "project" | "preset" }>, ToolError>
  /**
   * Run a command through the adapter, or say how to do it by hand when the adapter has none.
   * `resume` is the jam command to repeat after a handoff, when the adapter names none.
   */
  run(command: string, args: ReadonlyArray<string>, resume?: string): Effect.Effect<EngineOutcome, ToolError>
  /** The topics the adapter has guidance on. */
  readonly topics: Effect.Effect<ReadonlyArray<string>, ToolError>
  /** The adapter's guidance on a topic. */
  doc(topic: string): Effect.Effect<Guide, ToolError>
  /** Copy an adapter folder (anywhere on this machine) into the project and select it. */
  install(folder: string): Effect.Effect<{ readonly id: string; readonly dir: string; readonly files: number }, ToolError>
}>()("jam/Engine") {
  static readonly layerNoDeps: Layer.Layer<Engine, never, ProjectFiles | Toolkit | Config | Process | Executables> = Layer.effect(
    Engine,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const toolkit = yield* Toolkit
      const configs = yield* Config
      const proc = yield* Process
      const executables = yield* Executables
      const decodeAdapter = (what: string) => decode(Adapter, { what, fix: "see schemas/engine-adapter.schema.json in the toolkit" })
      const projectDir = (id: string): string => `${ENGINES_DIR}/${id}`

      const presets = Effect.map(toolkit.list("engines"), (names) =>
        names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length)))
      const installed = Effect.gen(function*() {
        const out: Array<string> = []
        for (const entry of yield* files.list(ENGINES_DIR)) {
          if (entry.kind === "directory" && (yield* files.exists(`${projectDir(entry.name)}/${ADAPTER_FILE}`))) out.push(entry.name)
        }
        return out
      })

      const resolved: Effect.Effect<ResolvedAdapter, ToolError> = Effect.gen(function*() {
        const config = yield* configs.load
        const id = config.engine.adapter
        let source: ResolvedAdapter["source"]
        let dir: string | null = null
        let adapter: Adapter
        if (id === null) {
          source = "default"
          adapter = yield* Effect.flatMap(toolkit.readJson(`engines/${DEFAULT_PRESET}.json`), decodeAdapter(`shipped preset ${DEFAULT_PRESET}`))
        } else if (yield* files.exists(`${projectDir(id)}/${ADAPTER_FILE}`)) {
          source = "project"
          dir = projectDir(id)
          adapter = yield* Effect.flatMap(files.readJson(`${dir}/${ADAPTER_FILE}`), decodeAdapter(`${dir}/${ADAPTER_FILE}`))
        } else if ((yield* presets).includes(id)) {
          source = "preset"
          adapter = yield* Effect.flatMap(toolkit.readJson(`engines/${id}.json`), decodeAdapter(`shipped preset ${id}`))
        } else {
          return yield* fail("not_found", `engine adapter ${id} (engine.adapter in jam.config.json) is neither in ${ENGINES_DIR}/ nor a shipped preset`, {
            fix: `install it with "jam engine install <folder>", or choose a preset: ${(yield* presets).filter((name) => name !== DEFAULT_PRESET).join(", ")}`
          })
        }
        const facts = merge(adapter.facts, config.engine.facts) as Facts
        const absent = CORE_FACTS.filter((key) => facts[key] === undefined)
        if (absent.length > 0) {
          return yield* fail("invalid", `engine adapter ${adapter.id} does not state ${absent.join(", ")}`, {
            fix: `add ${absent.length === 1 ? "it" : "them"} to the adapter's facts, or under engine.facts in jam.config.json`
          })
        }
        const provides = Object.entries(adapter.commands ?? {}).filter(([, command]) => command !== null).map(([name]) => name)
        return { id: adapter.id, label: adapter.label, source, dir, adapter, facts: facts as ResolvedFacts, provides }
      })

      // A preset's documents sit beside its file in the toolkit; a project adapter's in its folder.
      const readDocument = (current: ResolvedAdapter, relative: string): Effect.Effect<{ path: string; text: string } | null> =>
        (current.dir !== null
          ? Effect.map(files.readText(`${current.dir}/${relative}`), (text) => ({ path: `${current.dir}/${relative}`, text }))
          : Effect.gen(function*() {
            const text = yield* toolkit.readText(`engines/${relative}`)
            const inProject = yield* files.relative(toolkit.path(`engines/${relative}`)).pipe(Effect.catch(() => Effect.succeed(null)))
            return { path: inProject ?? toolkit.path(`engines/${relative}`), text }
          })).pipe(Effect.catch(() => Effect.succeed(null)))

      // The part of a document under the heading for a topic, or null when it has no such heading.
      const sectionOf = (text: string, anchor: string): string | null => {
        const lines = text.split(/\r?\n/)
        const level = (line: string): number => /^(#{1,6})\s/.exec(line)?.[1]?.length ?? 0
        const start = lines.findIndex((line) => level(line) > 0 && headingAnchor(line.replace(/^#+\s+/, "").replace(/\s+#+\s*$/, "")) === anchor)
        if (start === -1) return null
        const depth = level(lines[start]!)
        const rest = lines.slice(start + 1)
        const end = rest.findIndex((line) => level(line) > 0 && level(line) <= depth)
        return [lines[start]!, ...(end === -1 ? rest : rest.slice(0, end))].join("\n").trimEnd()
      }

      const ownGuide = (current: ResolvedAdapter): string | null => (current.dir === null ? `${current.id}.md` : null)

      const guideFor = (current: ResolvedAdapter, topic: string): Effect.Effect<Guide | null> =>
        Effect.gen(function*() {
          const [relative = "", anchor = topic] = (current.adapter.docs?.[topic] ?? ownGuide(current) ?? "").split("#")
          const document = relative === "" ? null : yield* readDocument(current, relative)
          if (document === null) return null
          const section = sectionOf(document.text, anchor)
          // A topic the adapter lists gets its whole document when no heading narrows it; a topic it does not list must be a heading.
          if (section === null && current.adapter.docs?.[topic] === undefined) return null
          return { topic, path: document.path, text: section ?? document.text.trimEnd() }
        })

      const topics: Effect.Effect<ReadonlyArray<string>, ToolError> = Effect.gen(function*() {
        const current = yield* resolved
        const listed = Object.keys(current.adapter.docs ?? {})
        const own = ownGuide(current)
        const document = own === null ? null : yield* readDocument(current, own)
        const headings = document === null ? [] : document.text.split(/\r?\n/).filter((line) => /^##\s/.test(line)).map((line) => headingAnchor(line.replace(/^#+\s+/, "")))
        return [...new Set([...listed, ...headings])]
      })

      // `python`, `blender` and `node` are this machine's; a path that exists in the adapter folder
      // is the adapter's script; placeholders name the three folders a script may need.
      const argvOf = (current: ResolvedAdapter, command: AdapterCommand): Effect.Effect<ReadonlyArray<string>, ToolError> =>
        Effect.gen(function*() {
          const adapterDir = current.dir === null ? "" : yield* files.resolve(current.dir)
          const out: Array<string> = []
          for (const [index, token] of command.run.entries()) {
            const substituted = token.replaceAll("{adapter}", adapterDir).replaceAll("{project}", files.root).replaceAll("{toolkit}", toolkit.dir)
            if (index === 0 && (substituted === "python" || substituted === "blender")) out.push(yield* configs.tool(substituted))
            else if (index === 0 && substituted === "node") out.push(executables.node)
            else if (current.dir !== null && substituted === token && !nodePath.isAbsolute(token) && /^[\w./-]+$/.test(token) && token.includes(".")) {
              const candidate = `${current.dir}/${token}`
              const local = yield* files.exists(candidate).pipe(Effect.catch(() => Effect.succeed(false)))
              out.push(local ? yield* files.resolve(candidate) : token)
            } else out.push(substituted)
          }
          return out
        })

      const run = (name: string, args: ReadonlyArray<string>, resume?: string): Effect.Effect<EngineOutcome, ToolError> =>
        Effect.gen(function*() {
          const current = yield* resolved
          const command = current.adapter.commands?.[name] ?? null
          if (command === null) {
            const guide = yield* guideFor(current, name)
            return {
              status: "manual",
              command: name,
              adapter: current.id,
              guide,
              next: guide !== null
                ? `adapter ${current.id} has no ${name} command: do it by hand following ${guide.path}, then record the step with what you produced as evidence`
                : current.source === "project"
                ? `adapter ${current.id} has no ${name} command and no ${name} guide: do it in the engine by hand and record the step with evidence`
                : `${current.id} is facts only: do the ${name} in the engine by hand and record the step with evidence, or install a full adapter with "jam engine install <folder>"`
            }
          }
          const [program = "", ...fixed] = yield* argvOf(current, command)
          const local = yield* configs.local
          const result = yield* proc.run(program, [...fixed, ...args], {
            cwd: files.root,
            timeoutMs: (command.timeoutSeconds ?? 600) * 1000,
            env: {
              JAM_PROJECT_ROOT: files.root,
              JAM_TOOLKIT_DIR: toolkit.dir,
              JAM_ADAPTER_DIR: current.dir === null ? "" : yield* files.resolve(current.dir),
              JAM_ENGINE_SETTINGS: JSON.stringify(local.engine ?? {})
            }
          })
          const output = Buffer.from(result.stdout).toString("utf8").trim()
          const printed = yield* Effect.try({ try: () => JSON.parse(output) as unknown, catch: () => null }).pipe(Effect.catch(() => Effect.succeed(null)))
          const told = isRecord(printed) && isRecord(printed["error"]) ? printed["error"] : {}
          if (result.code === HANDOFF_EXIT && isRecord(printed) && isRecord(printed["handoff"])) {
            const { handoff } = yield* decode(Handoff, { what: `handoff of adapter ${current.id} ${name}`, code: "malformed", strict: false })(printed)
            return {
              status: "handoff",
              command: name,
              adapter: current.id,
              reason: handoff.reason ?? (typeof told["message"] === "string" ? told["message"] : `adapter ${current.id} could not reach the engine`),
              steps: handoff.steps,
              resume: handoff.resume ?? resume ?? `jam engine ${VERBS.includes(name as Verb) ? name : `run ${name}`}${args.length > 0 ? ` ${args.join(" ")}` : ""}`
            }
          }
          if (result.code !== 0) {
            const detail = typeof told["message"] === "string" ? told["message"] : (result.stderr.trim() || output).split("\n").slice(-6).join("\n")
            return yield* fail("unavailable", `engine ${name} failed (adapter ${current.id}, exit ${result.code}): ${detail}`, {
              fix: typeof told["fix"] === "string"
                ? told["fix"]
                : `check how this machine reaches the engine ("engine" in jam.local.json) and the adapter's guides ("jam engine docs <topic>")`
            })
          }
          if (!isRecord(printed)) {
            return yield* fail("malformed", `adapter ${current.id} ${name} must print one JSON object; it printed: ${output.slice(0, 200) || "(nothing)"}`)
          }
          const schema = (RECEIPTS as Record<string, Schema.Top | undefined>)[name]
          if (schema !== undefined) yield* decode(schema as typeof Handoff, { what: `${name} receipt of adapter ${current.id}`, code: "malformed", strict: false, fix: `see schemas/engine-${name}-receipt.schema.json in the toolkit` })(printed)
          return { status: "ran", command: name, adapter: current.id, receipt: printed }
        })

      const copyIn = (from: string, to: string): Effect.Effect<number, ToolError> =>
        Effect.gen(function*() {
          const listed = yield* Effect.tryPromise({
            try: () => fsp.readdir(from, { recursive: true, withFileTypes: true }),
            catch: asToolError("unavailable", `read ${from}`)
          })
          let count = 0
          for (const entry of listed) {
            if (!entry.isFile()) continue
            const full = nodePath.join(entry.parentPath, entry.name)
            const relative = nodePath.relative(from, full).split(nodePath.sep).join("/")
            if (relative.split("/").some((part) => part === "node_modules" || part === "__pycache__" || part === ".git")) continue
            const bytes = yield* Effect.tryPromise({ try: () => fsp.readFile(full), catch: asToolError("unavailable", `read ${full}`) })
            yield* files.writeBytes(`${to}/${relative}`, bytes)
            count++
          }
          return count
        })

      return {
        resolved,
        available: Effect.gen(function*() {
          const own = yield* installed
          return [
            ...own.map((id) => ({ id, source: "project" as const })),
            ...(yield* presets).filter((id) => id !== DEFAULT_PRESET && !own.includes(id)).map((id) => ({ id, source: "preset" as const }))
          ]
        }),
        run,
        topics,
        doc: (topic) =>
          Effect.gen(function*() {
            const current = yield* resolved
            const guide = yield* guideFor(current, topic)
            if (guide !== null) return guide
            const known = yield* topics
            return yield* fail("not_found", `adapter ${current.id} has no guidance on ${topic}`, {
              fix: known.length > 0
                ? `topics: ${known.join(", ")}`
                : current.dir === null ? `${current.id} has no guide; install a full adapter with "jam engine install <folder>"` : `add it under "docs" in ${current.dir}/${ADAPTER_FILE}`
            })
          }),
        install: (folder) =>
          Effect.gen(function*() {
            const from = nodePath.resolve(files.root, folder)
            const raw = yield* Effect.tryPromise({
              try: async () => JSON.parse(await fsp.readFile(nodePath.join(from, ADAPTER_FILE), "utf8")) as unknown,
              catch: () => asToolError("not_found", "")(new Error(`${folder} has no readable ${ADAPTER_FILE}; an adapter folder holds ${ADAPTER_FILE}, commands/ and docs/`))
            })
            const adapter = yield* decodeAdapter(`${folder}/${ADAPTER_FILE}`)(raw)
            for (const [topic, guide] of Object.entries(adapter.docs ?? {})) {
              const file = guide.split("#")[0] ?? guide
              if (!(yield* Effect.promise(() => fsp.access(nodePath.join(from, file)).then(() => true, () => false)))) {
                return yield* fail("invalid", `${folder}/${ADAPTER_FILE}: docs.${topic} points at ${file}, which is not in the folder`)
              }
            }
            const dir = projectDir(adapter.id)
            const inPlace = nodePath.resolve(files.root, dir) === from
            const count = inPlace ? 0 : yield* copyIn(from, dir)
            yield* configs.update((config) => ({ ...config, engine: { ...(isRecord(config["engine"]) ? config["engine"] : { facts: {} }), adapter: adapter.id } }))
            return { id: adapter.id, dir, files: count }
          })
      }
    })
  )
}
