// Which file extensions a media kind accepts, so a model recorded as an image is caught at once.
import { extensionOf } from "../../kernel/hash.ts"
import type { MediaKind } from "../recipes/schema.ts"

const EXTENSIONS: Readonly<Record<Exclude<MediaKind, "any">, ReadonlyArray<string>>> = {
  image: ["png", "jpg", "jpeg", "webp", "exr", "tga", "tif", "tiff", "psd", "bmp", "gif"],
  model: ["glb", "gltf", "fbx", "obj", "blend", "usd", "usda", "usdc", "usdz", "stl", "ply", "3mf"],
  audio: ["wav", "mp3", "ogg", "flac", "aif", "aiff", "m4a", "opus"],
  video: ["mp4", "webm", "mov", "mkv"],
  text: ["md", "txt", "json", "csv", "yaml", "yml"],
  data: ["json", "csv", "yaml", "yml", "bin"]
}

/** Why a path is not of a kind, or null when it is. */
export const kindProblem = (kind: MediaKind, path: string): string | null =>
  kind === "any" || EXTENSIONS[kind].includes(extensionOf(path))
    ? null
    : `${path} is not ${kind === "image" || kind === "audio" ? "an" : "a"} ${kind} file (expected ${EXTENSIONS[kind].map((ext) => `.${ext}`).join(", ")})`

/** The kind a path most plausibly is, for a recipe captured from a run. */
export const kindOf = (path: string): MediaKind => {
  const extension = extensionOf(path)
  for (const kind of ["image", "model", "audio", "video"] as const) if (EXTENSIONS[kind].includes(extension)) return kind
  return "any"
}
