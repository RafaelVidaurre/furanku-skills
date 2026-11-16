// Fixtures for the jam tests: synthetic images and models (no provider is ever called), a
// configured temporary project, and ways to run operations and the real command line against it.
import { Document, NodeIO } from "@gltf-transform/core"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { crc32, deflateSync } from "node:zlib"
import type { ToolError } from "../../src/kernel/errors.ts"
import { type JamOptions, type JamServices, makeJamLayer } from "../../src/jam/layers.ts"
import type { Kernel } from "../../src/kernel/cli.ts"
import { Ids } from "../../src/kernel/Ids.ts"
import { type Captured, tempProject, testKernel, write } from "../support.ts"

export const TOOLKIT = fileURLToPath(new URL("../../", import.meta.url))

const chunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body) >>> 0, body.length + 4)
  return out
}

/** A PNG of one flat colour; different colours give different bytes. */
export const png = (width: number, height: number, [r, g, b]: readonly [number, number, number] = [200, 60, 60]): Buffer => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, index) => [r, g, b][index % 3]!)])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0))
  ])
}

export interface ModelOptions {
  readonly triangles?: number
  readonly materials?: number
  /** Side of a square embedded texture, in pixels. */
  readonly texture?: number
  readonly mode?: number
  readonly instances?: number
}

/** A self-contained GLB with the asked number of triangles. */
export const glb = async (options: ModelOptions = {}): Promise<Uint8Array> => {
  const { triangles = 1000, materials = 1, mode = 4, instances = 1 } = options
  const document = new Document()
  const buffer = document.createBuffer()
  const position = document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0])).setBuffer(buffer)
  const count = mode === 4 ? triangles * 3 : triangles + 2
  const mesh = document.createMesh()
  for (let index = 0; index < materials; index++) {
    const share = index === 0 ? count - (materials - 1) * 3 : 3
    const indices = document.createAccessor().setType("SCALAR").setArray(new Uint16Array(Array.from({ length: share }, (_, i) => i % 4))).setBuffer(buffer)
    const material = document.createMaterial(`m${index}`)
    if (options.texture !== undefined && index === 0) material.setBaseColorTexture(document.createTexture().setMimeType("image/png").setImage(png(options.texture, options.texture)))
    mesh.addPrimitive(document.createPrimitive().setMode(mode as 4).setAttribute("POSITION", position).setIndices(indices).setMaterial(material))
  }
  const scene = document.createScene()
  document.getRoot().setDefaultScene(scene)
  for (let index = 0; index < instances; index++) scene.addChild(document.createNode().setMesh(mesh))
  return new NodeIO().writeBinary(document)
}

export const PROP_BUDGET = { kind: "static", triangles: { target: 1000, max: 2000 }, textureSize: 1024, maxMaterials: 1, maxTextureMiB: 8 }
export const CHARACTER_BUDGET = { kind: "deforming", triangles: { target: 1000, max: 2000 }, textureSize: 1024, maxMaterials: 2, maxTextureMiB: 16, maxInfluences: 4, poses: "A-pose, crouch, arms overhead" }

export const CONFIG = {
  version: 2,
  toolkit: "tools/jam",
  roots: { scratch: "work/.scratch", delivered: "work/assets", scan: ["work"] },
  style: { document: "work/style.md", references: [] },
  budgets: { prop: PROP_BUDGET, character: CHARACTER_BUDGET },
  spend: { meshy: { perRun: 10, total: 25 } },
  review: { mode: "recipe" }
}

export interface JamProject {
  readonly git?: boolean
  /** Fields merged over CONFIG (shallow). */
  readonly config?: Readonly<Record<string, unknown>>
  readonly files?: Readonly<Record<string, string | Uint8Array>>
}

/** A temporary project with a version 2 configuration, a style document and a scratch root Git ignores. */
export const jamProject = (options: JamProject = {}): string =>
  tempProject({
    git: options.git ?? false,
    files: {
      "jam.config.json": JSON.stringify({ ...CONFIG, ...options.config }, null, 2),
      "work/style.md": "style",
      ".gitignore": "work/.scratch/\n",
      ...options.files
    }
  })

export const readJson = <A = Record<string, unknown>>(root: string, path: string): A => JSON.parse(readFileSync(join(root, ...path.split("/")), "utf8")) as A

// Each call builds its services anew, as each command does. Record ids must still differ between
// calls, so the real id source replaces the kernel's counting one.

/** Run an operation against a project with the jam services; rejects with the ToolError on failure. */
export const jam = <A, E>(root: string, effect: Effect.Effect<A, E, JamServices | Kernel>, options: JamOptions & { readonly captured?: Captured } = {}): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(Ids.layer), Effect.provide(Layer.provideMerge(makeJamLayer(options), testKernel(root, options.captured)))))

/** Run an operation that is expected to fail and return its ToolError. */
export const jamFailure = async <A>(root: string, effect: Effect.Effect<A, ToolError, JamServices | Kernel>, options: JamOptions = {}): Promise<ToolError> => {
  const exit = await Effect.runPromiseExit(Effect.scoped(effect).pipe(Effect.provide(Ids.layer), Effect.provide(Layer.provideMerge(makeJamLayer(options), testKernel(root)))))
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const error = Option.getOrUndefined(Exit.findErrorOption(exit))
  if (error === undefined) throw new Error(`expected a ToolError, got a defect: ${String(exit.cause)}`)
  return error
}

export interface CliResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
  /** The command's one JSON object (pass --json). */
  json<A = Record<string, unknown>>(): A
}

/** The real command line, as an agent would run it. Packages are never installed from a test. */
export const cli = (root: string, ...args: ReadonlyArray<string>): CliResult => {
  const env: NodeJS.ProcessEnv = { ...process.env, JAM_NO_INSTALL: "1" }
  delete env["JAM_ROOT"]
  delete env["JAM_JSON"]
  const result = spawnSync(process.execPath, [join(TOOLKIT, "jam.mjs"), ...args], { cwd: root, encoding: "utf8", env })
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    json: () => JSON.parse(result.stdout.trim() === "" ? result.stderr : result.stdout) as never
  }
}

/** Write the five turnaround views (distinct, equal canvases) and return their --file flags. */
export const turnaround = (root: string, dir: string): ReadonlyArray<string> =>
  ["front", "left", "back", "right", "three-quarter"].map((view, index) => {
    write(root, `${dir}/${view}.png`, png(8, 8, [index * 40, 90, 200 - index * 30]))
    return `view:${view}=${dir}/${view}.png`
  })

export { write }
