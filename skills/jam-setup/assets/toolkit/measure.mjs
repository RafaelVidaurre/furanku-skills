// Format decoding belongs to glTF Transform; this module applies project metrics.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO, ImageUtils } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
function mipBytes(width, height) {
  let bytes = 0;
  for (;;) { bytes += width * height * 4; if (width === 1 && height === 1) return bytes; width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); }
}
export async function measure(file) {
  const bytes = readFileSync(file), sha256 = sha(bytes);
  const extension = extname(file).toLowerCase();
  if (extension !== '.glb') {
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extension];
    requireValue(mime, 'measurement supports GLB, PNG, JPEG and WebP');
    const size = ImageUtils.getSize(bytes, mime);
    requireValue(size?.every((n) => Number.isSafeInteger(n) && n > 0), 'image dimensions could not be decoded');
    return { sha256, size };
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const raw = await io.binaryToJSON(new Uint8Array(bytes));
  requireValue(![...(raw.json.buffers ?? []), ...(raw.json.images ?? [])].some((row) => row.uri && !row.uri.startsWith('data:')), 'measurement requires a self-contained GLB; external resources are not loaded');
  // Unsupported geometry codecs/visibility semantics must never become zero-count success.
  const supported = (name) => name.startsWith('KHR_materials_') || ['KHR_texture_transform', 'KHR_mesh_quantization', 'EXT_texture_webp', 'KHR_lights_punctual', 'EXT_mesh_gpu_instancing'].includes(name);
  requireValue((raw.json.extensionsUsed ?? []).every(supported), 'GLB uses unsupported measurement extensions; stop this route and explicitly select a supported export or non-GLB DCC route');
  const document = await io.readJSON(raw);
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? (root.listScenes().length === 1 ? root.listScenes()[0] : null);
  requireValue(scene, 'GLB needs an unambiguous default scene');
  let triangles = 0, exportedVertices = 0, drawPrimitives = 0;
  const materials = new Set();
  scene.traverse((node) => {
    const mesh = node.getMesh(); if (!mesh) return;
    const instancing = node.getExtension('EXT_mesh_gpu_instancing');
    const instanceCounts = instancing ? instancing.listAttributes().map((attribute) => attribute.getCount()) : [1];
    requireValue(instanceCounts.length > 0 && instanceCounts.every((count) => Number.isSafeInteger(count) && count > 0 && count === instanceCounts[0]), 'invalid instancing attributes');
    const instances = instanceCounts[0];
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION');
      requireValue(positions, 'mesh primitive has no POSITION accessor');
      const count = (primitive.getIndices() ?? positions).getCount();
      const mode = primitive.getMode();
      requireValue([4, 5, 6].includes(mode), 'asset measurement requires triangle primitives');
      requireValue(mode !== 4 || count % 3 === 0, 'triangle list has incomplete indices');
      triangles += (mode === 4 ? count / 3 : Math.max(0, count - 2)) * instances;
      exportedVertices += positions.getCount() * instances;
      drawPrimitives += instances;
      materials.add(primitive.getMaterial() ?? 'implicit-default');
    }
  });
  const textureDimensions = root.listTextures().map((texture) => {
    const size = texture.getSize(); requireValue(size?.every((n) => Number.isSafeInteger(n) && n > 0), 'texture dimensions could not be decoded'); return size;
  });
  requireValue(triangles > 0, 'default scene has no triangles');
  return { sha256, triangles, exportedVertices, drawPrimitives, materials: materials.size, textureDimensions, textureMiB: textureDimensions.reduce((sum, [w, h]) => sum + mipBytes(w, h), 0) / 1048576, memoryBasis: 'RGBA8 full mip chain for all embedded images; conservative decoded estimate, not engine VRAM' };
}
if (process.argv[1]?.endsWith('measure.mjs')) {
  try { console.log(JSON.stringify(await Promise.all(process.argv.slice(2).map(measure)))); }
  catch (error) { console.error(`measurement failed: ${error.message}`); process.exitCode = 1; }
}
