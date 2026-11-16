// Measured facts about files: triangles, materials and texture memory of a GLB, pixel size of an
// image. Decoding belongs to glTF Transform; this module applies the project's counting rules.
// Unsupported codecs or primitives fail; they never become a zero count.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { asToolError, fail, isToolError, raise, type ToolError, toolError } from "../../kernel/errors.ts"
import { extensionOf, sha256 } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { prepareForMeasurement } from "./gltfExtensions.ts"

export interface ImageMeasurement {
  readonly kind: "image"
  readonly sha256: string
  readonly size: readonly [number, number]
}

export interface ModelMeasurement {
  readonly kind: "model"
  readonly sha256: string
  readonly triangles: number
  readonly exportedVertices: number
  readonly drawPrimitives: number
  readonly materials: number
  readonly textureDimensions: ReadonlyArray<readonly [number, number]>
  readonly textureMiB: number
  readonly memoryBasis: string
  readonly ignoredExtensions?: ReadonlyArray<string>
}

export type Measurement = ImageMeasurement | ModelMeasurement

const IMAGE_MIME: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }
const MEMORY_BASIS = "RGBA8 full mip chain for all embedded images; conservative decoded estimate, not engine VRAM"
const DEPENDENCY_FIX = "install the toolkit's packages: run any jam command without JAM_NO_INSTALL, or \"npm ci --ignore-scripts\" in the toolkit folder"

export const canMeasureModel = (path: string): boolean => extensionOf(path) === "glb"
export const canMeasureImage = (path: string): boolean => extensionOf(path) in IMAGE_MIME

const mipBytes = (width: number, height: number): number => {
  let bytes = 0
  for (let w = width, h = height;; w = Math.max(1, Math.floor(w / 2)), h = Math.max(1, Math.floor(h / 2))) {
    bytes += w * h * 4
    if (w === 1 && h === 1) return bytes
  }
}

const positiveInts = (size: ReadonlyArray<number> | null | undefined): size is [number, number] =>
  Array.isArray(size) && size.length === 2 && size.every((n) => Number.isSafeInteger(n) && n > 0)

const loadGltf = () =>
  Promise.all([import("@gltf-transform/core"), import("@gltf-transform/extensions")]).catch((cause) => {
    throw toolError("unavailable", `the glTF decoder is not installed (${(cause as Error).message}); no substitute measurement was made`, { fix: DEPENDENCY_FIX })
  })

const measureImage = async (bytes: Uint8Array, extension: string): Promise<ImageMeasurement> => {
  const [{ ImageUtils }] = await loadGltf()
  const size = ImageUtils.getSize(bytes, IMAGE_MIME[extension]!)
  if (!positiveInts(size)) return raise("malformed", "the image's dimensions could not be decoded")
  return { kind: "image", sha256: sha256(bytes), size: [size[0], size[1]] }
}

const measureModel = async (bytes: Uint8Array): Promise<ModelMeasurement> => {
  const [{ NodeIO }, { ALL_EXTENSIONS }] = await loadGltf()
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const raw = await io.binaryToJSON(bytes)
  const external = [...(raw.json.buffers ?? []), ...(raw.json.images ?? [])].some((row) => row.uri !== undefined && !row.uri.startsWith("data:"))
  if (external) raise("unsupported", "measurement needs a self-contained GLB; this one points at external files", { fix: `pack it first: "jam pack-glb <source.gltf> <packed.glb>"` })
  const ignored = prepareForMeasurement(raw.json)
  const document = await io.readJSON(raw)
  const root = document.getRoot()
  const scene = root.getDefaultScene() ?? (root.listScenes().length === 1 ? root.listScenes()[0]! : null)
  if (scene === null) return raise("malformed", "the GLB has no unambiguous default scene")
  let triangles = 0
  let exportedVertices = 0
  let drawPrimitives = 0
  const materials = new Set<unknown>()
  scene.traverse((node) => {
    const mesh = node.getMesh()
    if (!mesh) return
    const instancing = node.getExtension("EXT_mesh_gpu_instancing") as { listAttributes(): Array<{ getCount(): number }> } | null
    const counts = instancing ? instancing.listAttributes().map((attribute) => attribute.getCount()) : [1]
    const instances = counts[0]
    if (instances === undefined || !counts.every((count) => Number.isSafeInteger(count) && count > 0 && count === instances)) {
      return raise("malformed", "the GLB has invalid instancing attributes")
    }
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")
      if (!positions) return raise("malformed", "a mesh primitive has no POSITION accessor")
      const count = (primitive.getIndices() ?? positions).getCount()
      const mode = primitive.getMode() as number
      if (![4, 5, 6].includes(mode)) raise("unsupported", "measurement needs triangle primitives; this model has points or lines", { fix: "export triangles only" })
      if (mode === 4 && count % 3 !== 0) raise("malformed", "a triangle list has incomplete indices")
      triangles += (mode === 4 ? count / 3 : Math.max(0, count - 2)) * instances
      exportedVertices += positions.getCount() * instances
      drawPrimitives += instances
      materials.add(primitive.getMaterial() ?? "implicit-default")
    }
  })
  const textureDimensions = root.listTextures().map((texture): readonly [number, number] => {
    const size = texture.getSize()
    if (!positiveInts(size)) return raise("malformed", "an embedded texture's dimensions could not be decoded")
    return [size[0], size[1]]
  })
  if (triangles === 0) raise("malformed", "the GLB's default scene has no triangles")
  return {
    kind: "model",
    sha256: sha256(bytes),
    triangles,
    exportedVertices,
    drawPrimitives,
    materials: materials.size,
    textureDimensions,
    textureMiB: textureDimensions.reduce((sum, [w, h]) => sum + mipBytes(w, h), 0) / 1048576,
    memoryBasis: MEMORY_BASIS,
    ...(ignored.length > 0 ? { ignoredExtensions: ignored } : {})
  }
}

export class Measure extends Context.Service<Measure, {
  /** Measure a GLB or an image (PNG, JPEG, WebP). */
  file(path: string): Effect.Effect<Measurement, ToolError>
  /** Embed a glTF's buffers and images into one GLB without changing its content. */
  packGlb(source: string, destination: string): Effect.Effect<void, ToolError>
}>()("jam/Measure") {
  static readonly layerNoDeps: Layer.Layer<Measure, never, ProjectFiles> = Layer.effect(
    Measure,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const wrap = (path: string) => (cause: unknown): ToolError =>
        isToolError(cause) ? toolError(cause.code, `${path}: ${cause.message}`, { fix: cause.fix }) : asToolError("malformed", `measure ${path}`)(cause)
      return {
        file: (path) =>
          Effect.gen(function*() {
            const extension = extensionOf(path)
            if (extension !== "glb" && !(extension in IMAGE_MIME)) {
              return yield* fail("unsupported", `${path}: measurement supports GLB, PNG, JPEG and WebP`, {
                fix: "export a GLB, or measure in the DCC and attach the report as evidence labelled measurement"
              })
            }
            const bytes = yield* files.readBytes(path)
            return yield* Effect.tryPromise({
              try: (): Promise<Measurement> => (extension === "glb" ? measureModel(bytes) : measureImage(bytes, extension)),
              catch: wrap(path)
            })
          }),
        packGlb: (source, destination) =>
          Effect.gen(function*() {
            if (extensionOf(destination) !== "glb") return yield* fail("invalid", `destination ${destination}: expected a .glb path`)
            const from = yield* files.resolve(source)
            const to = yield* files.resolve(destination)
            yield* files.makeDirectory(destination.split("/").slice(0, -1).join("/") || ".").pipe(Effect.catch(() => Effect.void))
            yield* Effect.tryPromise({
              try: async () => {
                const [{ NodeIO }, { ALL_EXTENSIONS }] = await loadGltf()
                const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
                await io.write(to, await io.read(from))
              },
              catch: wrap(source)
            })
          })
      }
    })
  )
}
