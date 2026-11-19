// Helpers for the catalog tests: real temporary Git repositories holding a manifest project, and
// the catalog opened on them through its public facade. Nothing reads the machine's own Git
// configuration.
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import { Document, NodeIO } from "@gltf-transform/core"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { devNull, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after } from "node:test"
import { crc32, deflateSync } from "node:zlib"
import { type ActionInfo, CatalogOutputCheck } from "../../src/catalog/Actions.ts"
import { Catalog, CatalogDiagnostics, type CatalogStats, type RunMeta } from "../../src/catalog/Catalog.ts"
import type { Setup } from "../../src/catalog/CatalogConfig.ts"
import { Git } from "../../src/kernel/Git.ts"
import { Ids } from "../../src/kernel/Ids.ts"
import { Process } from "../../src/kernel/Process.ts"
import { ProjectFiles } from "../../src/kernel/ProjectFiles.ts"

// Every git process, ours and the catalog's, ignores the developer's configuration. Git LFS
// filters normally come from that configuration, so they are supplied here instead.
const GIT_CONFIG: ReadonlyArray<readonly [string, string]> = [
  ["user.name", "Test"],
  ["user.email", "test@example.invalid"],
  ["commit.gpgsign", "false"],
  ["init.defaultBranch", "main"],
  ["filter.lfs.clean", "git-lfs clean -- %f"],
  ["filter.lfs.smudge", "git-lfs smudge -- %f"],
  ["filter.lfs.process", "git-lfs filter-process"],
  ["filter.lfs.required", "true"]
]
process.env["GIT_CONFIG_GLOBAL"] = devNull
process.env["GIT_CONFIG_NOSYSTEM"] = "1"
process.env["GIT_CONFIG_COUNT"] = String(GIT_CONFIG.length)
GIT_CONFIG.forEach(([key, value], index) => {
  process.env[`GIT_CONFIG_KEY_${index}`] = key
  process.env[`GIT_CONFIG_VALUE_${index}`] = value
})

export const human = { name: "Rae Tester", kind: "human" } as const
export const human2 = { name: "Sam Second", kind: "human" } as const
export const agent = { name: "checker", kind: "agent" } as const

export const tmp = (prefix = "cc-"): string => realpathSync(mkdtempSync(join(tmpdir(), prefix)))
export const git = (dir: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
export const hasGitLfs = (): boolean => {
  try {
    execFileSync("git", ["lfs", "version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export const write = (dir: string, rel: string, value: unknown): void => {
  const file = join(dir, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, value instanceof Uint8Array || typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const read = (dir: string, rel: string): any => JSON.parse(readFileSync(join(dir, rel), "utf8"))

/** A minimal valid RGBA PNG. */
export const png = (w = 4, h = 4, rgba: ReadonlyArray<number> = [200, 40, 40, 255]): Buffer => {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) raw.set(rgba, y * (w * 4 + 1) + 1 + x * 4)
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0)
  header.writeUInt32BE(h, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

/** A small self-contained GLB: quads, optionally with named animation clips. */
export const glb = async ({ clips = [], meshes = 1, size = 1 }: { size?: number; clips?: ReadonlyArray<string>; meshes?: number } = {}): Promise<Buffer> => {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const position = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, size, 0, 0, 0, size, 0, size, size, 0])).setBuffer(buffer)
  const uv = doc.createAccessor().setType("VEC2").setArray(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])).setBuffer(buffer)
  const index = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 1, 2, 2, 1, 3])).setBuffer(buffer)
  const material = doc.createMaterial("surface").setBaseColorFactor([0.8, 0.8, 0.8, 1]).setDoubleSided(true)
  const scene = doc.createScene()
  doc.getRoot().setDefaultScene(scene)
  const root = doc.createNode("root")
  scene.addChild(root)
  for (let i = 0; i < meshes; i++) {
    const primitive = doc.createPrimitive().setAttribute("POSITION", position).setAttribute("TEXCOORD_0", uv).setIndices(index).setMaterial(material)
    root.addChild(doc.createNode(`part${i}`).setMesh(doc.createMesh(`mesh${i}`).addPrimitive(primitive)).setTranslation([i * 1.2, 0, 0]))
  }
  for (const name of clips) {
    const input = doc.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer)
    const output = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 0, name.length * 0.1, 0])).setBuffer(buffer)
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation("LINEAR")
    doc.createAnimation(name).addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(root).setTargetPath("translation").setSampler(sampler))
  }
  return Buffer.from(await new NodeIO().writeBinary(doc))
}

/** A generated PCM tone, so audio tests need no recordings. */
export const tone = ({ amplitude = 0.25, channels = 1, duration = 1, frequency = 440, rate = 48000 } = {}): Buffer => {
  const frames = Math.round(duration * rate)
  const bytes = Buffer.alloc(44 + frames * channels * 2)
  bytes.write("RIFF")
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write("WAVEfmt ", 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(channels, 22)
  bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * channels * 2, 28)
  bytes.writeUInt16LE(channels * 2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write("data", 36)
  bytes.writeUInt32LE(bytes.length - 44, 40)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) bytes.writeInt16LE(Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * (frequency + c * 60) * i / rate)), 44 + (i * channels + c) * 2)
  }
  return bytes
}

export const TYPES = {
  armor: {
    label: "Armor",
    thumb: "icon",
    fields: [{ key: "slot", label: "Slot" }, { key: "armor", label: "Armor", kind: "number", help: "Damage absorbed per hit." }, { key: "parts", label: "Parts", kind: "refs" }],
    roles: [
      { key: "icon", label: "Icon", mediaKinds: ["image"], expected: true },
      { key: "model", label: "Model", mediaKinds: ["model"], expected: true },
      { key: "concept", label: "Concept", mediaKinds: ["image"], many: true },
      { key: "clip", label: "Clip", mediaKinds: ["video"] }
    ]
  },
  lore: { label: "Lore", fields: [{ key: "text", label: "Text" }], roles: [] }
}

export interface ProjectSpec {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly units?: ReadonlyArray<any>
  readonly assets?: Readonly<Record<string, Uint8Array | string>>
  readonly collections?: ReadonlyArray<unknown>
  /** Merged into the manifest (types, collectionKinds, …). */
  readonly extra?: Readonly<Record<string, unknown>>
  readonly commit?: boolean
}

/** A manifest project (configuration version 3, manifest version 2) with one file per unit, committed on main. */
export const makeProject = async ({ assets = {}, collections = [], commit = true, extra = {}, units = [] }: ProjectSpec = {}): Promise<string> => {
  const dir = tmp()
  git(dir, "init", "-q")
  write(dir, "catalog.config.json", { version: 3, plugins: ["manifest"], review: { resolver: "latest" } })
  write(dir, "catalog.manifest.json", {
    version: 2,
    project: "Testgame",
    assetRoots: ["art"],
    types: TYPES,
    collectionKinds: { outfit: { label: "Outfit", preview: { label: "Assembled", module: "assembled-mesh" } } },
    unitFiles: ["content"],
    collections,
    ...extra
  })
  for (const [rel, bytes] of Object.entries(assets)) write(dir, rel, bytes)
  for (const unit of units) write(dir, `content/${unit.id.replace(/\//g, "_")}.json`, unit)
  if (commit) {
    git(dir, "add", "-A")
    git(dir, "commit", "-q", "-m", "initial")
  }
  return dir
}

export const standardProject = async (spec: ProjectSpec = {}): Promise<string> =>
  makeProject({
    assets: {
      "art/helm.png": png(4, 4, [200, 0, 0, 255]),
      "art/helm.glb": await glb({ clips: ["Idle"] }),
      "art/boots.png": png(4, 4, [0, 200, 0, 255]),
      "art/boots.glb": await glb({ size: 2 }),
      "art/sheet.png": png(8, 4, [0, 0, 200, 255]),
      "art/coat.png": png(4, 4, [9, 9, 9, 255])
    },
    units: [
      { id: "armor/helm", type: "armor", name: "Iron Helm", attrs: { slot: "Head", armor: 10 }, links: [{ role: "icon", asset: "art/helm.png" }, { role: "model", asset: "art/helm.glb" }, { role: "concept", asset: "art/sheet.png" }], tags: ["tier:1"], category: "Gear/Heavy", aliases: ["casque"] },
      { id: "armor/boots", type: "armor", name: "Iron Boots", attrs: { slot: "Feet", armor: 6 }, links: [{ role: "icon", asset: "art/boots.png" }, { role: "model", asset: "art/boots.glb" }, { role: "concept", asset: "art/sheet.png" }] },
      { id: "armor/coat", type: "armor", name: "Wool Coat", attrs: { slot: "Body", armor: 3 }, links: [{ role: "icon", asset: "art/coat.png" }] },
      { id: "lore/origin", type: "lore", name: "Origin Story", attrs: { text: "Long ago the iron mines opened." }, links: [] }
    ],
    collections: [{ id: "outfit/iron", name: "Iron Outfit", kind: "outfit", members: [{ unit: "armor/helm" }, { unit: "armor/boots" }] }],
    ...spec
  })

/** The catalog of one project, as promises. A failed action rejects with its ToolError (`code`, `message`, `details`). */
export interface App {
  readonly root: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(action: string, input?: unknown, meta?: RunMeta): Promise<any>
  discover(): Promise<ReadonlyArray<ActionInfo>>
  stats(): Promise<CatalogStats>
  /** Run any effect against this catalog's services. */
  effect<A, E>(effect: Effect.Effect<A, E, Catalog | CatalogDiagnostics>): Promise<A>
  evidenceMedia(submission: string, item: string, part: string, leaf?: string): Promise<{ bytes: Uint8Array; mime: string | undefined; sha256: string }>
  beforeMedia(submission: string, item: string, view: string): Promise<{ bytes: Uint8Array; mime: string | undefined; sha256: string }>
  assetFile(id: string): Promise<{ file: string; mime: string; version: string; size: number }>
  browserModule(name: string): Promise<{ file: string; bytes: Uint8Array; sha256: string }>
}

export interface OpenOptions extends Partial<Setup> {
  /** Replace the kernel's Process (to observe which programs run). */
  readonly process?: Layer.Layer<Process>
  /** Replace the id source (for example `Ids.layerTest`). */
  readonly ids?: Layer.Layer<Ids>
  /** Extra services for the running catalog, such as a TestClock. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly extra?: Layer.Layer<any>
}

/** Every result, of the catalog and of a server's viewer sessions, is decoded against its declared output. */
const outputsChecked = Layer.succeed(CatalogOutputCheck, true)

/** The kernel of a test project and its catalog, as one layer. */
export const catalogLayer = (root: string, options: OpenOptions = {}) => {
  const kernel = Layer.mergeAll(Git.layerNoDeps, options.ids ?? Ids.layer).pipe(Layer.provideMerge(Layer.mergeAll(ProjectFiles.layer(root), options.process ?? Process.layer)))
  return Catalog.layerWith(options).pipe(Layer.provideMerge(kernel), Layer.provideMerge(options.extra ?? Layer.empty), Layer.provideMerge(outputsChecked))
}

/** Open the catalog of a project: a fresh engine, as a second process or a restart would have. */
export const open = async (root: string, options: OpenOptions = {}): Promise<App> => {
  const runtime = ManagedRuntime.make(catalogLayer(root, options))
  after(() => runtime.dispose())
  return appOf(root, runtime)
}

/** The promise-based test surface over a runtime that provides a catalog. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const appOf = (root: string, runtime: ManagedRuntime.ManagedRuntime<Catalog | CatalogDiagnostics, any>): App => {
  const effect = async <A, E>(body: Effect.Effect<A, E, Catalog | CatalogDiagnostics>): Promise<A> => {
    const exit = await runtime.runPromiseExit(body)
    if (Exit.isSuccess(exit)) return exit.value
    throw Option.getOrUndefined(Exit.findErrorOption(exit)) ?? new Error(`defect: ${String(exit.cause)}`)
  }
  const use = <A, E>(body: (catalog: Catalog["Service"]) => Effect.Effect<A, E>): Promise<A> => effect(Effect.flatMap(Catalog, body))
  return {
    root,
    run: (action, input, meta) => use((catalog) => catalog.run(action, input, meta)),
    discover: () => use((catalog) => catalog.discover),
    stats: () => effect(Effect.flatMap(CatalogDiagnostics, (diagnostics) => diagnostics.stats)),
    effect,
    evidenceMedia: (submission, item, part, leaf) => use((catalog) => catalog.evidenceMedia(submission, item, part, leaf)),
    beforeMedia: (submission, item, view) => use((catalog) => catalog.beforeMedia(submission, item, view)),
    assetFile: (id) => use((catalog) => catalog.assetFile(id)),
    browserModule: (name) => use((catalog) => catalog.browserModule(name))
  }
}

/** Run write actions as one actor: `W(app)("note.create", input, requestId?)`. */
export const W = (app: App, actor: { readonly name: string; readonly kind: string } = human) =>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(name: string, input?: unknown, requestId?: string): Promise<any> => app.run(name, input, { actor, ...(requestId === undefined ? {} : { requestId }) })

/** Await a rejection and return its error; with `code`, require that ToolError code. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const rejects = async (promise: Promise<unknown>, code?: string): Promise<any> => {
  try {
    await promise
  } catch (error) {
    const found = (error as { code?: string }).code
    if (code && found !== code) throw new Error(`expected ${code}, got ${found}: ${(error as Error).message}`)
    return error
  }
  throw new Error(`expected rejection${code ? ` (${code})` : ""}`)
}

export const cleanup = (...dirs: ReadonlyArray<string>): void => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
}

export { existsSync, join, readFileSync }
