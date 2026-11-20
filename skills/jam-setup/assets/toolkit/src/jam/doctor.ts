// `jam doctor`: one report of everything the toolkit depends on, each line with a status and,
// when something is wrong, what to do about it. It changes nothing.
import * as Command from "effect/cli/Command"
import * as Effect from "effect/Effect"
import { Output } from "../kernel/cli.ts"
import type { ToolError } from "../kernel/errors.ts"
import { Executables } from "../kernel/Executable.ts"
import { Git } from "../kernel/Git.ts"
import { isRecord } from "../kernel/hash.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import { Checks } from "./checks/Checks.ts"
import { described } from "./cliSupport.ts"
import { Config } from "./config/Config.ts"
import { Engine } from "./engine/Engine.ts"
import { CONFIG_FILE, LOCAL_FILE, LOCAL_STATE_DIR } from "./layout.ts"
import { Providers } from "./providers/Providers.ts"
import { spendState } from "./providers/spend.ts"
import { resolveGuide } from "./recipes/guides.ts"
import { Recipes } from "./recipes/Recipes.ts"
import { recipeProblems } from "./recipes/resolve.ts"
import { listJobs } from "./runs/jobs.ts"
import { Runs } from "./runs/Runs.ts"
import { runKey } from "./runs/schema.ts"
import { lines, table } from "./text.ts"
import { Toolkit } from "./Toolkit.ts"

export interface DoctorLine {
  readonly check: string
  /** ok: works. info: nothing to do. warn: something optional is missing or needs attention. fail: jam cannot work properly. */
  readonly status: "ok" | "info" | "warn" | "fail"
  readonly detail: string
  readonly fix?: string
}

const MINIMUM_NODE = [22, 20] as const

/** Skills that shipped under another name, by old name. A project may still have the old ones installed or named in its recipes. */
export const RENAMED_SKILLS: ReadonlyMap<string, string> = new Map([
  ["jam-model", "jam-3d-model"],
  ["jam-retopo", "jam-3d-retopo"],
  ["jam-uv", "jam-3d-uv"],
  ["jam-texture", "jam-3d-texture"],
  ["jam-rig", "jam-3d-rig"]
])
const renamedTo = (name: string | undefined): string | undefined => name === undefined ? undefined : RENAMED_SKILLS.get(name)

const line = (check: string, status: DoctorLine["status"], detail: string, fix?: string): DoctorLine => ({ check, status, detail, ...(fix === undefined ? {} : { fix }) })

/** Run a section; a failure inside it becomes that section's own failing line. */
const section = <R>(check: string, body: Effect.Effect<ReadonlyArray<DoctorLine>, ToolError, R>): Effect.Effect<ReadonlyArray<DoctorLine>, never, R> =>
  body.pipe(Effect.catch((error) => Effect.succeed([line(check, "fail", error.message, error.fix)])))

export const diagnose: Effect.Effect<ReadonlyArray<DoctorLine>, never, Toolkit | Executables | Config | Recipes | Checks | Providers | Engine | Runs | Git | ProjectFiles> = Effect.gen(function*() {
  const toolkit = yield* Toolkit
  const executables = yield* Executables
  const configs = yield* Config
  const files = yield* ProjectFiles
  const git = yield* Git
  const runs = yield* Runs
  const out: Array<DoctorLine> = []
  const add = (found: ReadonlyArray<DoctorLine>): void => void out.push(...found)

  add(yield* section("toolkit", Effect.map(toolkit.version, (version) => [line("toolkit", "ok", `version ${version} at ${toolkit.dir}`)])))

  const node = yield* executables.probe(executables.node, ["--version"])
  const [major = 0, minor = 0] = (node.output ?? "").replace(/^v/, "").split(".").map(Number)
  add([major > MINIMUM_NODE[0] || (major === MINIMUM_NODE[0] && minor >= MINIMUM_NODE[1])
    ? line("node", "ok", `${node.output}`)
    : line("node", "fail", `${node.output ?? "unknown version"}; ${MINIMUM_NODE.join(".")} or newer is needed`, "install a current Node.js and open a new terminal")])

  add(yield* section("packages", Effect.gen(function*() {
    const manifest = yield* toolkit.readJson("package.json")
    const wanted = Object.entries(isRecord(manifest) && isRecord(manifest["dependencies"]) ? manifest["dependencies"] : {})
    const absent: Array<string> = []
    for (const [name, version] of wanted) {
      const installed = yield* toolkit.readJson(`node_modules/${name}/package.json`).pipe(Effect.catch(() => Effect.succeed(null)))
      if (!isRecord(installed) || installed["version"] !== version) absent.push(`${name}@${String(version)}`)
    }
    return [absent.length === 0
      ? line("packages", "ok", `${wanted.length} npm packages installed (measurement and the catalog need them)`)
      : line("packages", "fail", `not installed: ${absent.join(", ")}; models cannot be measured without them`, `run "npm ci --ignore-scripts" in ${toolkit.dir}`)]
  })))

  add(yield* section("python", Effect.gen(function*() {
    const python = yield* configs.tool("python")
    const version = yield* executables.probe(python, ["--version"])
    if (!version.installed) {
      return [line("python", "warn", `${python} did not run (${version.error}); turnaround cropping and the side-view check need it`, `install Python 3.10 or newer, or set "python" in ${LOCAL_FILE}`)]
    }
    const imaging = yield* executables.probe(python, ["-c", "import PIL, numpy; print('imaging packages present')"])
    return [
      line("python", "ok", `${python}: ${version.output}`),
      imaging.installed
        ? line("python imaging", "ok", "Pillow and numpy import")
        : line("python imaging", "warn", "Pillow or numpy is missing; turnaround cropping and the side-view check cannot run", `${python} -m pip install -r ${toolkit.path("requirements.txt")} (or rerun the installer, which makes a private environment)`)
    ]
  })))

  for (const [tool, args, purpose] of [["blender", ["--version"], "local mesh steps and format conversion"], ["ffmpeg", ["-version"], "audio processing"]] as const) {
    add(yield* section(tool, Effect.gen(function*() {
      const command = yield* configs.tool(tool)
      const probe = yield* executables.probe(command, args, { timeoutMs: 30_000 })
      return [probe.installed
        ? line(tool, "ok", `${command}: ${probe.output}`)
        : line(tool, "warn", `${command} did not run (${probe.error}); needed only for ${purpose}`, `install it, or set "${tool}" in ${LOCAL_FILE} to its path`)]
    })))
  }

  const checkout = yield* git.checkout
  const lfs = checkout.git ? yield* git.text(["lfs", "version"]) : null
  add([
    checkout.git
      ? line("git", "ok", `branch ${checkout.branch ?? `detached at ${checkout.head?.slice(0, 12)}`}`)
      : line("git", "warn", "not a Git checkout; delivery cannot verify that delivered files are tracked", "run git init when the project should be versioned"),
    ...(checkout.git ? [lfs !== null ? line("git lfs", "ok", lfs.split("\n")[0] ?? "installed") : line("git lfs", "warn", "git-lfs is not installed; delivered binaries would go into ordinary Git history", "install git-lfs, run git lfs install, then rerun the installer")] : [])
  ])

  const state = yield* Effect.result(configs.state)
  const ready = state._tag === "Success" && state.success.kind === "ready" ? state.success.config : null
  add([
    state._tag === "Failure"
      ? line("configuration", "fail", state.failure.message, state.failure.fix)
      : state.success.kind === "missing"
      ? line("configuration", "fail", `${CONFIG_FILE} is missing`, `"jam setup" prints the choices to decide; then "jam setup --from <choices.json>"`)
      : state.success.kind === "v1"
      ? line("configuration", "fail", `${CONFIG_FILE} is version 1`, `run "jam config migrate" (add --dry-run to preview)`)
      : line("configuration", "ok", `${CONFIG_FILE} is valid; review mode ${state.success.config.review.mode}`)
  ])
  add(yield* section("machine paths", Effect.map(configs.local, (local) => [line("machine paths", "ok", Object.keys(local).length === 0 ? `no ${LOCAL_FILE}; tools are found on PATH` : `${LOCAL_FILE} is valid`)])))

  add(yield* section("recipes", Effect.gen(function*() {
    const recipes = yield* Recipes
    const known = new Set((yield* (yield* Checks).list).map((check) => check.id))
    const entries = yield* recipes.list
    const problems: Array<string> = []
    for (const entry of entries) {
      const resolved = yield* Effect.result(recipes.get(entry.id))
      if (resolved._tag === "Failure") {
        problems.push(resolved.failure.message)
        continue
      }
      const guides = new Map<string, string | null>()
      for (const step of resolved.success.steps) for (const reference of [...(step.guide === undefined ? [] : [step.guide]), ...step.baseGuides]) guides.set(reference, (yield* resolveGuide(reference)).problem)
      problems.push(...recipeProblems(resolved.success, { checks: known, guides }).map((problem) => problem.message))
    }
    return [problems.length === 0
      ? line("recipes", "ok", `${entries.length} recipes valid (${entries.filter((entry) => entry.source === "project").length} from the project)`)
      : line("recipes", "fail", `${problems.length} problem${problems.length === 1 ? "" : "s"}: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "; ..." : ""}`, `"jam recipe check" lists every problem with its fix`)]
  })))

  add(yield* section("skill names", Effect.gen(function*() {
    // Agents install a project's skills under a hidden folder of the project root (<folder>/skills/<name>).
    // Skills installed for the user, outside the project, are not looked at: where they live depends on the agent.
    const found: Array<string> = []
    const replacements = new Set<string>()
    const scanned: Array<string> = []
    for (const folder of yield* files.list("")) {
      if (!folder.name.startsWith(".") || folder.name === ".git") continue
      const installed = yield* files.list(`${folder.name}/skills`).pipe(Effect.catch(() => Effect.succeed(null)))
      if (installed === null) continue
      scanned.push(`${folder.name}/skills`)
      for (const skill of installed) {
        const now = renamedTo(skill.name)
        if (now === undefined) continue
        found.push(`${folder.name}/skills/${skill.name} is now ${now}`)
        replacements.add(now)
      }
    }
    const recipes = yield* Recipes
    const named: Array<string> = []
    for (const entry of (yield* recipes.list).filter((recipe) => recipe.source === "project")) {
      const authored = yield* recipes.authored(entry.id).pipe(Effect.catch(() => Effect.succeed(null)))
      for (const step of authored?.steps ?? []) {
        const now = renamedTo(step.skill)
        if (now !== undefined) named.push(`${entry.path} step ${step.id} names ${step.skill}, now ${now}`)
      }
    }
    const where = `looked in ${scanned.length === 0 ? "no project skill folder" : scanned.join(", ")} and the project's recipes, not in skills installed for your user outside the project`
    if (found.length === 0 && named.length === 0) return [line("skill names", "ok", `no skill installed or named in a project recipe under a retired name (${where})`)]
    const fixes = [
      ...(replacements.size === 0 ? [] : [`install ${[...replacements].join(", ")} with "npx skills add rafaelvidaurre/furanku-skills --skill <name>" and remove the old folders`]),
      ...(named.length === 0 ? [] : ["change the \"skill\" of those steps to the new name"])
    ]
    return [line("skill names", "warn", `renamed skills: ${[...found, ...named].join("; ")} (${where})`, `${fixes.join("; ")}; remove old names from your user's skills too (${toolkit.path("docs/setup.md")}#renamed-skills)`)]
  })))

  add(yield* section("providers", Effect.gen(function*() {
    const providers = yield* Providers
    const routed = new Set(Object.values(ready?.routes ?? {}))
    const found: Array<DoctorLine> = []
    for (const entry of yield* providers.list) {
      const id = entry.descriptor.id
      const probe = yield* providers.probe(id)
      const detail = `installed ${probe.installed.state}, authenticated ${probe.authenticated.state}, reachable ${probe.reachable.state}; ${spendState(entry.descriptor, ready?.spend[id]).summary}${routed.has(id) ? "; routed" : ""}`
      found.push(probe.installed.state === "no" && routed.has(id)
        ? line(`provider ${id}`, "warn", `${detail} (${probe.installed.detail})`, `install or sign in to it following the jam-setup skill; "jam provider probe ${id}" has the detail`)
        : line(`provider ${id}`, probe.installed.state === "yes" ? "ok" : "info", detail))
    }
    return found
  })))

  if (ready !== null) {
    add(yield* section("engine", Effect.map((yield* Engine).resolved, (adapter) => {
      const provided = adapter.provides
      return [line("engine", adapter.source === "default" ? "info" : "ok",
        `${adapter.id} (${adapter.source === "project" ? adapter.dir : adapter.source === "preset" ? "facts-only preset" : "no engine chosen"}); ${provided.length > 0 ? `runs ${provided.join(", ")}` : "engine steps are skipped or done by hand"}`)]
    })))

    add(yield* section("jobs", Effect.map(listJobs({ open: true }), (jobs) => [jobs.length === 0
      ? line("jobs", "ok", "no unsettled provider jobs")
      : line("jobs", "warn", `${jobs.length} unsettled: ${jobs.slice(0, 6).map((job) => `${job.run} ${job.job} (${job.state})`).join(", ")}${jobs.length > 6 ? ", ..." : ""}`, `find out what became of each and settle it: jam job submitted|done|failed|cancelled <run> <job> ...`)])))

    add(yield* section("locks", Effect.gen(function*() {
      const scan = yield* runs.scan
      const found: Array<DoctorLine> = scan.unreadable.map((file) => line("run file", "fail", `${file.path}: ${file.message}`, "restore it from Git; run files are written only by the tool"))
      const locks: Array<readonly [string, string]> = [
        ...scan.runs.map((ref) => [runs.lockPath(ref.path), `jam run unlock ${runKey(ref.run)}`] as const),
        [`${ready.roots.scratch}/${LOCAL_STATE_DIR}/jobs.lock`, "delete that file once no jam command is running"],
        [`${CONFIG_FILE}.lock`, "delete that file once no jam command is running"]
      ]
      for (const [path, remedy] of locks) {
        const holder = yield* files.lockHolder(path)
        if (holder === null) continue
        const here = holder.host === executables.host
        const alive = here && holder.pid > 0 && (yield* executables.alive(holder.pid))
        found.push(alive
          ? line("lock", "info", `${path} is held by running process ${holder.pid}`)
          : line("lock", "warn", here ? `${path} was left by process ${holder.pid}, which is gone (${holder.at})` : `${path} is held from another machine (${holder.host}); it cannot be verified here`, remedy))
      }
      return found.length > 0 ? found : [line("locks", "ok", "no locks held, every run file readable")]
    })))
  }
  return out
})

export const doctor = Command.make("doctor", {}, () =>
  Effect.gen(function*() {
    const report = yield* diagnose
    const failing = report.filter((entry) => entry.status === "fail").length
    const warning = report.filter((entry) => entry.status === "warn").length
    yield* (yield* Output).emit({ ok: failing === 0, failing, warning, lines: report }, lines(
      table(["", "check", "detail"], report.map((entry) => [entry.status.toUpperCase(), entry.check, entry.detail])),
      ...report.filter((entry) => entry.fix !== undefined).map((entry) => `fix (${entry.check}): ${entry.fix}`),
      failing === 0 ? (warning === 0 ? "everything jam needs is in place" : `usable; ${warning} warning${warning === 1 ? "" : "s"}`) : `${failing} problem${failing === 1 ? "" : "s"} to fix`
    ))
  })).pipe(described(
    "Report everything the toolkit depends on: Node, npm packages, Python imaging packages, Blender, ffmpeg, Git and LFS, configuration, recipes, skills installed under a retired name, providers, the engine adapter, unsettled jobs and stale locks. Each line has a status and a fix. Nothing is changed.",
    "jam doctor"
  ))
