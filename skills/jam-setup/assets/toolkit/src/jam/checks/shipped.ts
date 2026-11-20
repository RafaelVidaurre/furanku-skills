// The checks the toolkit ships. Each is a small rule over one record; anything it needs from the
// outside world comes from a service captured when the registry is built.
import * as Effect from "effect/Effect"
import { decode } from "../../kernel/decode.ts"
import type { ToolError } from "../../kernel/errors.ts"
import { Git } from "../../kernel/Git.ts"
import { isRecord, isUnder, sha256 } from "../../kernel/hash.ts"
import { Process } from "../../kernel/Process.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { ClipSpec, runSpecs, SPEC_ROLE } from "../animation/clip.ts"
import type { Problem } from "../common.ts"
import { Config } from "../config/Config.ts"
import { Engine } from "../engine/Engine.ts"
import { InspectReceipt } from "../engine/schema.ts"
import { skeletonNamed } from "../rig/landmarks.ts"
import { closureOf } from "../runs/closure.ts"
import { UNRESOLVED } from "../runs/schema.ts"
import { Toolkit } from "../Toolkit.ts"
import { budgetOf, type Check, type CheckInput } from "./Checks.ts"

export const VIEWS = ["front", "left", "back", "right", "three-quarter"] as const
const VIEW_ROLE = "view"
const DEFORMATION = "deformation"
const CROP_SCRIPT = "scripts/crop_turnaround.py"

const noBudget = (input: CheckInput): Problem => {
  const { name } = budgetOf(input.context)
  return name === null
    ? { message: "this run has no budget, so the result cannot be judged against one", fix: `name one: "jam run set ${input.context.ref.run.id} --budget <name>" (budgets are listed by "jam config show")` }
    : { message: `budget ${name} is not defined in jam.config.json`, fix: `define budgets.${name}, or name another: "jam run set ${input.context.ref.run.id} --budget <name>"` }
}

const unmeasured = (input: CheckInput): Problem => ({
  message: `step ${input.step.id} has nothing measured: the record needs exactly one .glb file with role model`,
  fix: "record the runtime model as --file model=<file>.glb; for another format add --evidence measurement=<report.json> that binds the model's hash"
})

const budgetGeometry: Check = {
  id: "budget-geometry",
  // Materials belong to the surface, so they are judged with the textures: a bought model with two
  // materials can have its topology recorded before the texture step merges them.
  description: "Measured triangles are within the run's budget",
  when: "status",
  run: (input) =>
    Effect.sync(() => {
      const { budget } = budgetOf(input.context)
      if (budget === null) return [noBudget(input)]
      const metrics = input.record.metrics
      if (metrics?.triangles === undefined) return [unmeasured(input)]
      return metrics.triangles > budget.triangles.max
        ? [{ message: `${metrics.triangles} triangles is over the budget of ${budget.triangles.max}`, fix: `reduce the mesh (target ${budget.triangles.target})` }]
        : []
    })
}

const budgetTexture: Check = {
  id: "budget-texture",
  description: "Measured material count, texture sizes and texture memory are within the run's budget",
  when: "status",
  run: (input) =>
    Effect.sync(() => {
      const { budget } = budgetOf(input.context)
      if (budget === null) return [noBudget(input)]
      const metrics = input.record.metrics
      if (metrics?.textureMiB === undefined || metrics.textureDimensions === undefined || metrics.materials === undefined) return [unmeasured(input)]
      const problems: Array<Problem> = []
      if (metrics.materials > budget.maxMaterials) {
        problems.push({ message: `${metrics.materials} materials is over the budget of ${budget.maxMaterials}`, fix: "merge materials and bake them into one set of maps" })
      }
      const large = metrics.textureDimensions.filter(([width, height]) => width > budget.textureSize || height > budget.textureSize)
      if (large.length > 0) {
        problems.push({ message: `texture ${large.map((size) => size.join("x")).join(", ")} is over the budget of ${budget.textureSize} per side`, fix: "resize or re-bake the maps" })
      }
      if (metrics.textureMiB > budget.maxTextureMiB) {
        problems.push({ message: `${metrics.textureMiB.toFixed(2)} MiB of textures is over the budget of ${budget.maxTextureMiB} MiB`, fix: "use fewer or smaller maps" })
      }
      return problems
    })
}

/**
 * A deforming asset carries evidence of its skinning and poses. When that evidence includes a rig
 * report (a JSON file with `passed`), the report decides: it must pass, be about the model this
 * record holds (same SHA-256), and keep influences within the budget. Other evidence (a pose sheet
 * from another tool) is accepted as shown.
 */
const deformationEvidence = (files: ProjectFiles["Service"]): Check => ({
  id: "deformation-evidence",
  description: "A deforming asset carries evidence of its skeleton, skinning and poses; a rig report among it must pass for this model",
  when: "status",
  run: (input) =>
    Effect.gen(function*() {
      const { budget } = budgetOf(input.context)
      if (budget === null) return [noBudget(input)]
      if (budget.kind !== "deforming") return []
      const shown = [...input.record.files.filter((file) => file.role === DEFORMATION), ...input.record.evidence.filter((file) => file.label === DEFORMATION)]
      if (shown.length === 0) {
        return [{
          message: `a deforming asset needs deformation evidence (at most ${budget.maxInfluences ?? "?"} influences per vertex; poses: ${budget.poses ?? "unspecified"})`,
          fix: `add it to the record: --file ${DEFORMATION}=<pose sheet or clip> or --evidence ${DEFORMATION}=<file>`
        }]
      }
      const models = input.record.files.filter((file) => file.role === "model").map((file) => file.sha256)
      const problems: Array<Problem> = []
      for (const file of shown.filter((entry) => entry.path.toLowerCase().endsWith(".json"))) {
        const report = yield* files.readJson(file.path).pipe(Effect.catch(() => Effect.succeed(null)))
        if (!isRecord(report) || typeof report["passed"] !== "boolean") continue
        if (report["passed"] !== true) problems.push({ message: `${file.path}: the rig failed its own deformation check`, fix: "fix the weights or landmarks and bind again; the report names the regions that failed" })
        const outputs = Array.isArray(report["outputs"]) ? report["outputs"].filter(isRecord) : []
        const about = outputs.filter((output) => output["role"] === "model").map((output) => output["sha256"])
        if (models.length > 0 && about.length > 0 && !about.some((hash) => models.includes(hash as string))) {
          problems.push({ message: `${file.path} is about another model than the one recorded`, fix: "record the model the report was written for, or bind again and record its new report" })
        }
        const glb = isRecord(report["glb"]) ? report["glb"] : {}
        const most = typeof glb["maxInfluences"] === "number" ? glb["maxInfluences"] : null
        if (most !== null && budget.maxInfluences !== undefined && most > budget.maxInfluences) {
          problems.push({ message: `${file.path}: up to ${most} influences per vertex; the budget allows ${budget.maxInfluences}`, fix: `bind again with --max-influences ${budget.maxInfluences}` })
        }
        if (Array.isArray(glb["problems"]) && glb["problems"].length > 0) {
          problems.push({ message: `${file.path}: the exported model has problems: ${glb["problems"].map(String).join("; ")}` })
        }
      }
      return problems
    })
})

const SPEC = SPEC_ROLE
const CLIP = "clip"

/** A clip spec decodes against its schema and names a rig and a skeleton map that exist. Its key-pose file is made later, by the keyposes step. */
const clipSpec = (files: ProjectFiles["Service"]): Check => ({
  id: "clip-spec",
  description: "The clip spec is valid and names a project rig and skeleton map that exist",
  when: "status",
  run: (input) =>
    Effect.gen(function*() {
      const specs = input.record.files.filter((file) => file.role === SPEC)
      if (specs.length !== 1) return [{ message: `the step needs exactly one clip spec; the record has ${specs.length}`, fix: `record it as --file ${SPEC}=<clip.json> (schemas/animation-clip.schema.json in the toolkit)` }]
      const path = specs[0]!.path
      const raw = yield* files.readJson(path).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (raw === undefined) return [{ message: `${path} is not readable JSON` }]
      const decoded = yield* Effect.result(decode(ClipSpec, { what: path })(raw))
      if (decoded._tag === "Failure") return [{ message: decoded.failure.message, fix: "see schemas/animation-clip.schema.json in the toolkit" }]
      const spec = decoded.success
      const problems: Array<Problem> = []
      for (const [field, named] of [["rig.model", spec.rig.model], ["rig.map", spec.rig.map]] as const) {
        if (!(yield* files.exists(named).pipe(Effect.catch(() => Effect.succeed(false))))) problems.push({ message: `${path}: ${field} ${named} does not exist` })
      }
      return problems
    })
})

/** The run's clip spec. */
const runSpec = (input: CheckInput): { readonly path: string; readonly sha256: string } | Problem => {
  const specs = runSpecs(input.context.ref.run)
  if (specs.length === 1) return { path: specs[0]!.path, sha256: specs[0]!.sha256 }
  return {
    message: specs.length === 0 ? "the run records no clip spec, so the clip report cannot be tied to one" : `the run records ${specs.length} clip specs; a clip is checked against one`,
    fix: `record the clip spec as --file ${SPEC}=<clip.json> on the step that defines it`
  }
}

const stampOf = (value: unknown): string | undefined => (isRecord(value) && typeof value["sha256"] === "string" ? value["sha256"] : undefined)

/**
 * A clip is judged by its clip report (jam-3d-animate's clip check writes it). The report must pass,
 * be about the clip this record holds, the run's clip spec and the rig and map that spec names now,
 * judge (not only measure), find exactly one animation in the clip (checks.animations), and leave no
 * threshold unmeasured, and nothing it left to a person (unjudged), unless the record's note says how that one was judged.
 */
const clipReport = (files: ProjectFiles["Service"]): Check => ({
  id: "clip-report",
  description: "A clip report among the step's evidence passed, measured on the clip this record holds, against the run's clip spec and its rig",
  when: "status",
  run: (input) =>
    Effect.gen(function*() {
      const clips = input.record.files.filter((file) => file.role === CLIP).map((file) => file.sha256)
      const candidates = [...input.record.files.filter((file) => file.role !== CLIP), ...input.record.evidence].filter((file) => file.path.toLowerCase().endsWith(".json"))
      const reports: Array<{ readonly path: string; readonly report: Record<string, unknown> }> = []
      for (const file of candidates) {
        const report = yield* files.readJson(file.path).pipe(Effect.catch(() => Effect.succeed(null)))
        if (isRecord(report) && "passed" in report && stampOf(report["clip"]) !== undefined) reports.push({ path: file.path, report })
      }
      if (reports.length === 0) {
        return [{ message: "the step needs a clip report: a JSON file with passed and the clip it measured ({path, sha256}) as clip", fix: `add it as --file evidence=<clip-report.json>, beside --file ${CLIP}=<clip.glb>` }]
      }
      const spec = runSpec(input)
      if ("message" in spec) return [spec]
      // What the spec names now: a report measured against an older rig or map is about another rig.
      const named = yield* files.readJson(spec.path).pipe(Effect.catch(() => Effect.succeed(null)))
      const rig = isRecord(named) && isRecord(named["rig"]) ? named["rig"] : {}
      const hashes: Record<string, string | null> = {}
      for (const part of ["model", "map"] as const) {
        const path = rig[part]
        hashes[part] = typeof path !== "string" ? null : yield* files.readBytes(path).pipe(Effect.map(sha256), Effect.catch(() => Effect.succeed(null)))
      }
      const problems: Array<Problem> = []
      for (const { path, report } of reports) {
        if (report["measureOnly"] === true) {
          problems.push({ message: `${path} only measured the clip (--measure-only) and judged nothing`, fix: "run the clip check against the clip spec's thresholds and record that report" })
        } else if (report["passed"] !== true) {
          const failures = Array.isArray(report["failures"]) ? report["failures"].map(String) : []
          problems.push({ message: `${path}: the clip failed its check${failures.length === 0 ? "" : `: ${failures.join("; ")}`}`, fix: "fix the motion, retarget or contacts and check again; the report names what failed" })
        }
        if (clips.length > 0 && !clips.includes(stampOf(report["clip"])!)) {
          problems.push({ message: `${path} measured another clip than the one recorded`, fix: "record the clip the report was written for, or check the recorded clip again" })
        }
        if (stampOf(report["spec"]) !== spec.sha256) {
          problems.push({ message: `${path} was measured against another clip spec than the run's ${spec.path}`, fix: `check the clip again with ${spec.path}` })
        }
        const reportRig = isRecord(report["rig"]) ? report["rig"] : {}
        for (const part of ["model", "map"] as const) {
          if (hashes[part] === null) problems.push({ message: `${spec.path}: rig.${part} cannot be read, so the report cannot be tied to it` })
          else if (stampOf(reportRig[part]) !== hashes[part]) problems.push({ message: `${path} was measured on another rig ${part} than the one ${spec.path} names now`, fix: "check the clip again on the current rig" })
        }
        const checks = isRecord(report["checks"]) ? report["checks"] : {}
        const animations = isRecord(checks["animations"]) ? checks["animations"] : null
        if (animations?.["passed"] !== true) {
          const names = Array.isArray(animations?.["names"]) ? (animations["names"] as Array<unknown>).map(String) : null
          problems.push({
            message: `${path}: a delivered clip holds exactly one animation; ${names === null ? "the report does not say the clip holds one (checks.animations)" : `the clip holds ${names.length} (${names.join(", ")})`}`,
            fix: "write the clip with only the checked animation, then check it again"
          })
        }
        const unmeasured = Array.isArray(report["unmeasured"]) ? report["unmeasured"].map(String) : []
        const unsaid = unmeasured.filter((name) => !input.record.note.includes(name))
        if (unsaid.length > 0) {
          problems.push({ message: `${path}: the check could not measure ${unsaid.join(", ")}`, fix: `say in the record's --note how ${unsaid.length === 1 ? "it was" : "each was"} judged, naming ${unsaid.join(", ")} (the report and its sheet say why it was not measured)` })
        }
        const unjudged = Array.isArray(report["unjudged"]) ? report["unjudged"].map(String) : []
        const unanswered = unjudged.filter((name) => !input.record.note.includes(name))
        if (unanswered.length > 0) {
          problems.push({ message: `${path}: the check measured ${unanswered.join(", ")} but leaves ${unanswered.length === 1 ? "it" : "them"} to a person to judge`, fix: `say in the record's --note how ${unanswered.length === 1 ? "it was" : "each was"} judged from the sheet and video, naming ${unanswered.join(", ")} (the report lists what to look at)` })
        }
      }
      return problems
    })
})

export const shippedChecks: Effect.Effect<ReadonlyArray<Check>, never, Git | Engine | Config | Process | Toolkit | ProjectFiles> = Effect.gen(function*() {
  const git = yield* Git
  const engine = yield* Engine
  const configs = yield* Config
  const proc = yield* Process
  const toolkit = yield* Toolkit
  const files = yield* ProjectFiles

  // The crop tool's report, when the record carries one that matches the recorded side views.
  const reportedFacing = (input: CheckInput, left: string, right: string): Effect.Effect<{ asDrawn: number; mirrored: number } | "symmetric" | null, ToolError> =>
    Effect.gen(function*() {
      for (const evidence of input.record.evidence.filter((file) => file.path.endsWith(".json"))) {
        const report = yield* files.readJson(evidence.path).pipe(Effect.catch(() => Effect.succeed(null)))
        if (!isRecord(report) || !isRecord(report["views"])) continue
        const views = report["views"] as Record<string, { sha256?: unknown }>
        if (views["left"]?.sha256 !== left || views["right"]?.sha256 !== right) continue
        if (report["symmetric"] === true) return "symmetric"
        const facing = report["sideFacing"]
        if (isRecord(facing) && typeof facing["asDrawn"] === "number" && typeof facing["mirrored"] === "number") {
          return { asDrawn: facing["asDrawn"], mirrored: facing["mirrored"] }
        }
      }
      return null
    })

  const measuredFacing = (left: string, right: string): Effect.Effect<{ asDrawn: number; mirrored: number } | Problem, ToolError> =>
    Effect.gen(function*() {
      const python = yield* configs.tool("python")
      const result = yield* proc.run(python, [toolkit.path(CROP_SCRIPT), "--facing", yield* files.resolve(left), yield* files.resolve(right)], { timeoutMs: 60_000 }).pipe(
        Effect.catch((error) => Effect.succeed({ code: 127, stdout: new Uint8Array(), stderr: error.message }))
      )
      const parsed = yield* Effect.try({ try: () => JSON.parse(Buffer.from(result.stdout).toString("utf8")) as unknown, catch: () => null }).pipe(
        Effect.catch(() => Effect.succeed(null))
      )
      if (result.code === 0 && isRecord(parsed) && typeof parsed["asDrawn"] === "number" && typeof parsed["mirrored"] === "number") {
        return { asDrawn: parsed["asDrawn"], mirrored: parsed["mirrored"] }
      }
      return {
        message: `the left and right views could not be compared (${result.stderr.trim().split("\n").at(-1) || `exit ${result.code}`})`,
        fix: `install the imaging packages ("jam doctor" says how), or crop with "jam crop" and add its crops.json as --evidence, or record with --symmetric for a subject whose sides are identical`
      }
    })

  const turnaroundViews: Check = {
    id: "turnaround-views",
    description: "Five distinct views on equal canvases, with left and right facing opposite ways",
    when: "record",
    run: (input) =>
      Effect.gen(function*() {
        const views = new Map(input.record.files.filter((file) => file.role === VIEW_ROLE && file.key !== undefined).map((file) => [file.key!, file]))
        const absent = VIEWS.filter((view) => !views.has(view))
        if (absent.length > 0) {
          return [{ message: `the turnaround lacks the ${absent.join(", ")} view${absent.length === 1 ? "" : "s"}`, fix: `record each as --file ${VIEW_ROLE}:<name>=<image>` }]
        }
        const shown = VIEWS.map((view) => views.get(view)!)
        const problems: Array<Problem> = []
        const sizes = new Set(shown.map((file) => (file.size === undefined ? "unknown" : file.size.join("x"))))
        if (sizes.has("unknown")) problems.push({ message: "a view's pixel size could not be measured", fix: "use PNG, JPEG or WebP views" })
        else if (sizes.size !== 1) problems.push({ message: `the views have different canvases (${[...sizes].join(", ")})`, fix: "crop every view to the same width and height" })
        const symmetric = input.record.symmetric === true
        if (!symmetric) {
          if (new Set(shown.map((file) => file.path)).size !== VIEWS.length || new Set(shown.map((file) => file.sha256)).size !== VIEWS.length) {
            problems.push({ message: "two views are the same image", fix: "give each view its own image; for a subject whose sides are identical, record with --symmetric" })
          } else {
            const left = views.get("left")!
            const right = views.get("right")!
            const reported = yield* reportedFacing(input, left.sha256, right.sha256)
            const facing = reported === "symmetric" ? null : reported ?? (yield* measuredFacing(left.path, right.path))
            if (facing !== null && "message" in facing) problems.push(facing)
            else if (facing !== null && facing.asDrawn >= facing.mirrored) {
              problems.push({
                message: `the left and right views face the same way (silhouette overlap as drawn ${facing.asDrawn}, mirrored ${facing.mirrored})`,
                fix: "regenerate one side to face the other way; for a subject whose sides are identical, record with --symmetric"
              })
            }
          }
        }
        return problems
      })
  }

  const deliveryClosure: Check = {
    id: "delivery-closure",
    description: "Every file the run depends on can be delivered: jobs are settled and nothing would be Git-ignored",
    when: "status",
    run: (input) =>
      Effect.gen(function*() {
        const { context } = input
        const problems: Array<Problem> = []
        const open = context.ref.run.jobs.filter((job) => UNRESOLVED.includes(job.state))
        if (open.length > 0) {
          problems.push({ message: `provider job${open.length === 1 ? "" : "s"} ${open.map((job) => job.id).join(", ")} ${open.length === 1 ? "is" : "are"} not settled`, fix: `settle each with "jam job done|failed|cancelled ${context.ref.run.id} <job>"` })
        }
        const closure = closureOf(context)
        if (context.ref.delivered) {
          const outside = closure.entries.filter((entry) => !isUnder(closure.dir, entry.from))
          if (outside.length > 0) {
            problems.push({ message: `the delivered run depends on files outside ${closure.dir}: ${outside.map((entry) => entry.from).join(", ")}`, fix: "copy them in and record the step again" })
          }
        }
        const ignored = yield* git.ignored([closure.runFile, ...closure.entries.map((entry) => entry.to)])
        if (ignored.length > 0) {
          problems.push({ message: `Git would ignore delivered file${ignored.length === 1 ? "" : "s"} ${ignored.join(", ")}`, fix: "change .gitignore so the delivered root is tracked, or rename the files" })
        }
        return problems
      })
  }

  const engineInspect: Check = {
    id: "engine-inspect",
    description: "The imported engine asset matches the budget and the engine's conventions",
    when: "record",
    run: (input) =>
      Effect.gen(function*() {
        const assets = input.record.engineAssets ?? []
        if (assets.length === 0) {
          return [{ message: `step ${input.step.id} records no engine asset`, fix: `import with "jam engine import --run ${input.context.ref.run.id}", or record by hand with --engine-asset <engine id>` }]
        }
        const { budget } = budgetOf(input.context)
        const facts = (yield* engine.resolved).facts
        const problems: Array<Problem> = []
        for (const asset of assets) {
          const outcome = yield* engine.run("inspect", [asset.id])
          if (outcome.status !== "ran") {
            // Not inspected by the adapter: what was checked by hand must be on the record.
            const why = outcome.status === "manual" ? outcome.next : `the adapter could not reach the engine (${outcome.reason})`
            if (input.record.evidence.length === 0) problems.push({ message: `${asset.id} was not inspected: ${why}`, fix: "add what you checked in the engine as --evidence" })
            continue
          }
          const receipt = yield* decode(InspectReceipt, { what: `inspect receipt for ${asset.id}`, code: "malformed", strict: false })(outcome.receipt)
          if (receipt.bounds !== undefined) {
            const extent = receipt.bounds.max.map((max, axis) => max - receipt.bounds!.min[axis]!)
            if (extent.some((length) => !(length >= 0)) || extent.every((length) => length === 0)) {
              problems.push({ message: `${asset.id} has empty or inverted bounds (${extent.join(" x ")} m)`, fix: "check the import scale and axes against \"jam engine facts\"" })
            }
          }
          if (budget !== null && receipt.materials !== undefined && receipt.materials.length > budget.maxMaterials) {
            problems.push({ message: `${asset.id} has ${receipt.materials.length} material slots, over the budget of ${budget.maxMaterials}`, fix: "merge materials before import" })
          }
          if (budget !== null && receipt.triangles !== undefined && receipt.triangles > budget.triangles.max) {
            problems.push({ message: `${asset.id} has ${receipt.triangles} triangles in the engine, over the budget of ${budget.triangles.max}` })
          }
          const profile = budget?.skeleton === undefined ? undefined : skeletonNamed(budget.skeleton, input.context.config.skeletons, facts.skeletons)
          if (budget?.kind === "deforming" && profile !== undefined) {
            const wanted = Object.values(profile.bones).filter((bone): bone is string => typeof bone === "string")
            if (receipt.skeleton === undefined) problems.push({ message: `${asset.id} has no skeleton; the budget expects ${budget.skeleton}`, fix: "import it as a skinned asset" })
            else if (receipt.skeleton.bones !== undefined) {
              const absent = wanted.filter((bone) => !receipt.skeleton!.bones!.includes(bone))
              if (absent.length > 0) {
                problems.push({ message: `${asset.id} lacks bones of skeleton ${budget.skeleton}: ${absent.slice(0, 8).join(", ")}${absent.length > 8 ? ", ..." : ""}`, fix: "conform the rig to that skeleton before import" })
              }
            }
          }
        }
        return problems
      })
  }

  return [
    turnaroundViews,
    budgetGeometry,
    budgetTexture,
    deformationEvidence(files),
    clipSpec(files),
    clipReport(files),
    deliveryClosure,
    engineInspect,
    { id: "loudness", description: "Processed audio meets the loudness target (supplied by the audio tools)", when: "record" },
    { id: "transcript-match", description: "A voiced line says its text (supplied by the audio tools)", when: "record" }
  ]
})
