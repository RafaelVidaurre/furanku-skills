// Embed a downloaded glTF's buffers and images without changing its geometry,
// materials, skeleton or animations. Uses the catalog's maintained glTF decoder.
import { NodeIO } from './node_modules/@gltf-transform/core/dist/index.js';
import { ALL_EXTENSIONS } from './node_modules/@gltf-transform/extensions/dist/index.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function packGLB(source, destination) {
  if (!source || !destination || !destination.endsWith('.glb')) {
    throw new Error('Usage: node tools/jam/pack-glb.mjs source.gltf destination.glb');
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(source);
  mkdirSync(dirname(destination), { recursive: true });
  await io.write(destination, document);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await packGLB(...process.argv.slice(2));
}
