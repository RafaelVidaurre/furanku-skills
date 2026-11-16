// Which glTF extensions measurement understands. Format policy, independent of who exported the file.
import { raise } from "../../kernel/errors.ts"
import { isRecord } from "../../kernel/hash.ts"

const SUPPORTED = new Set(["KHR_texture_transform", "KHR_mesh_quantization", "EXT_texture_webp", "KHR_lights_punctual", "EXT_mesh_gpu_instancing"])
const supported = (name: string): boolean => name.startsWith("KHR_materials_") || SUPPORTED.has(name)

// Polygon-reconstruction metadata over ordinary triangles: it adds no data and no rendering
// semantics, only an ordering convention, so rendered triangle counts are unaffected.
// https://github.com/zellski/glTF/tree/spec/fb-ngon-encoding/extensions/2.0/Vendor/FB_ngon_encoding
const NGON = "FB_ngon_encoding"

interface GltfJson {
  extensionsUsed?: Array<string>
  extensionsRequired?: Array<string>
  meshes?: Array<{ primitives?: Array<{ mode?: number; extensions?: Record<string, unknown> }> }>
}

/**
 * Check a glTF document's extensions and remove understood, optional metadata from the in-memory
 * copy the decoder reads. The file and its hash are untouched. Returns the names it left out.
 */
export const prepareForMeasurement = (json: GltfJson): ReadonlyArray<string> => {
  const required = json.extensionsRequired ?? []
  const used = json.extensionsUsed ?? []
  const unsupported = [...new Set([...used, ...required])].filter((name) => !supported(name) && name !== NGON)
  if (unsupported.length > 0) {
    raise("unsupported", `the model uses extensions measurement does not understand: ${unsupported.join(", ")}`, {
      fix: "re-export without them (no mesh compression), or measure in the DCC and attach a measurement report"
    })
  }
  if (required.includes(NGON)) {
    raise("unsupported", `the model requires ${NGON}; measurement counts rendered triangles only and cannot honour a required polygon encoding`, {
      fix: "re-export with the extension optional or absent"
    })
  }
  if (!used.includes(NGON)) return []
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const marker = primitive.extensions?.[NGON]
      if (marker === undefined) continue
      if (!isRecord(marker) || Object.keys(marker).length > 0 || (primitive.mode ?? 4) !== 4) {
        raise("unsupported", `the model carries an invalid ${NGON} marker`, { fix: "re-export the model; the marker must be an empty object on a triangle list" })
      }
      delete primitive.extensions![NGON]
    }
  }
  json.extensionsUsed = used.filter((name) => name !== NGON)
  return [NGON]
}
