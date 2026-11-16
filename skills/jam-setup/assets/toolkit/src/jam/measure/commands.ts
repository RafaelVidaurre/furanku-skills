// `jam measure`, `jam crop`, `jam pack-glb`, and the `jam python` / `jam blender` launchers.
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Effect from "effect/Effect"
import { Output } from "../../kernel/cli.ts"
import { fail, type ToolError, toolError } from "../../kernel/errors.ts"
import { Executables } from "../../kernel/Executable.ts"
import { Process } from "../../kernel/Process.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { described, flag } from "../cliSupport.ts"
import { Config } from "../config/Config.ts"
import type { ToolName } from "../config/schema.ts"
import { LOCAL_FILE } from "../layout.ts"
import { pairs } from "../text.ts"
import { Toolkit } from "../Toolkit.ts"
import { Measure } from "./Measure.ts"

const TOOLKIT_PREFIX = "toolkit:"
const CROP_SCRIPT = "scripts/crop_turnaround.py"

const measure = Command.make("measure", { file: Argument.String("file").pipe(Argument.withDescription("Project path of a .glb, .png, .jpg or .webp file")) }, ({ file }) =>
  Effect.gen(function*() {
    const result = yield* (yield* Measure).file(file)
    yield* (yield* Output).emit({ path: file, ...result }, result.kind === "image"
      ? `${file}: ${result.size.join(" x ")} px`
      : pairs([
        ["triangles", result.triangles],
        ["materials", result.materials],
        ["vertices", result.exportedVertices],
        ["draw primitives", result.drawPrimitives],
        ["textures", result.textureDimensions.map((size) => size.join("x")).join(", ") || "none"],
        ["texture memory", `${result.textureMiB.toFixed(2)} MiB (${result.memoryBasis})`],
        ["ignored extensions", result.ignoredExtensions?.join(", ")]
      ]))
  })).pipe(described("Measure a file the way run records do: triangles, materials and texture memory of a GLB, or the pixel size of an image.", "jam measure final.glb"))

const packGlb = Command.make("pack-glb", {
  source: Argument.String("source").pipe(Argument.withDescription("Project path of a .gltf (or .glb) with external buffers or images")),
  destination: Argument.String("destination").pipe(Argument.withDescription("Project path of the .glb to write"))
}, (input) =>
  Effect.gen(function*() {
    yield* (yield* Measure).packGlb(input.source, input.destination)
    yield* (yield* Output).emit({ packed: input.destination, from: input.source }, `wrote ${input.destination}`)
  })).pipe(described("Embed a glTF's buffers and images into one self-contained GLB without changing geometry, materials, skeleton or animations.", "jam pack-glb download/scene.gltf model.glb"))

// A script the toolkit ships is named toolkit:<file>; anything else is passed as written.
const scriptPath = (toolkit: Toolkit["Service"], argument: string): string =>
  argument.startsWith(TOOLKIT_PREFIX) ? toolkit.path(`scripts/${argument.slice(TOOLKIT_PREFIX.length)}`) : argument

const launch = (tool: ToolName, args: ReadonlyArray<string>): Effect.Effect<void, ToolError, Config | Executables | ProjectFiles> =>
  Effect.gen(function*() {
    const executables = yield* Executables
    const command = yield* (yield* Config).tool(tool)
    const code = yield* executables.launch(command, args, { cwd: (yield* ProjectFiles).root }).pipe(
      Effect.mapError((error) => toolError(error.code, error.message, { fix: `set "${tool}" in ${LOCAL_FILE} to its path, or put it on PATH ("jam doctor" shows what was found)` }))
    )
    yield* executables.exitWith(code)
  })

const passthrough = Argument.String("args").pipe(Argument.withDescription("Script, then its arguments exactly as the script takes them; this command's own flags go before the script"), Argument.variadic())

const python = Command.make("python", { args: passthrough }, ({ args }) =>
  Effect.gen(function*() {
    const toolkit = yield* Toolkit
    const [script, ...rest] = args
    yield* launch("python", script === undefined ? [] : [scriptPath(toolkit, script), ...rest])
  })).pipe(described(
    "Run Python with this project's interpreter (jam.local.json, else PATH). No shell is involved, so one command line works in every terminal. toolkit:<file> names a script the toolkit ships.",
    "jam python tools/report.py --verbose out.json"
  ))

const blender = Command.make("blender", { factory: flag("factory-startup", "Ignore the user's Blender preferences and add-ons"), args: passthrough }, (input) =>
  Effect.gen(function*() {
    const toolkit = yield* Toolkit
    const [script, ...rest] = input.args
    if (script === undefined) return yield* fail("invalid", "name the script to run: jam blender [--factory-startup] <script.py> [args]")
    yield* launch("blender", ["--background", ...(input.factory ? ["--factory-startup"] : []), "--python-exit-code", "1", "--python", scriptPath(toolkit, script), ...(rest.length > 0 ? ["--", ...rest] : [])])
  })).pipe(described(
    "Run a script in headless Blender (jam.local.json, else PATH). Everything after the script reaches the script. toolkit:<file> names a script the toolkit ships.",
    "jam blender --factory-startup toolkit:fbx-to-glb.py source.fbx model.glb"
  ))

const crop = Command.make("crop", {
  sheet: Argument.String("sheet").pipe(Argument.withDescription("Project path of the turnaround sheet image")),
  layout: Argument.String("layout").pipe(Argument.withDescription("Project path of a JSON file: {\"front\": [x, y, width, height], \"left\": ..., \"back\": ..., \"right\": ..., \"three-quarter\": ...}")),
  output: Argument.String("output").pipe(Argument.withDescription("Project folder to create; it must not exist")),
  symmetric: flag("symmetric", "The subject's sides are identical, so left and right may show the same view")
}, (input) =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const toolkit = yield* Toolkit
    const command = yield* (yield* Config).tool("python")
    const result = yield* (yield* Process).run(command, [
      toolkit.path(CROP_SCRIPT),
      yield* files.resolve(input.sheet),
      yield* files.resolve(input.layout),
      yield* files.resolve(input.output),
      ...(input.symmetric ? ["--symmetric"] : [])
    ], { cwd: files.root, timeoutMs: 120_000 })
    if (result.code !== 0) {
      return yield* fail("invalid", result.stderr.trim().split("\n").at(-1) || `the crop tool exited ${result.code}`, { fix: `"jam doctor" says whether Python and its imaging packages are installed` })
    }
    const views = ["front", "left", "back", "right", "three-quarter"].map((view) => `--file view:${view}=${input.output}/${view}.png`).join(" ")
    yield* (yield* Output).emit(
      { output: input.output, report: `${input.output}/crops.json`, symmetric: input.symmetric, record: `${views} --evidence ${input.output}/crops.json${input.symmetric ? " --symmetric" : ""}` },
      `wrote five views and crops.json to ${input.output}\nlook at each view, then record them with:\n  ${views} --evidence ${input.output}/crops.json${input.symmetric ? " --symmetric" : ""}`
    )
  })).pipe(described(
    "Cut a turnaround sheet into its five views without resampling, on equal canvases, and check that left and right face opposite ways. Needs Python with Pillow.",
    "jam crop sheet.png layout.json views"
  ))

export const commands = [measure, crop, packGlb, python, blender]
