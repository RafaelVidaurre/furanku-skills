// inspect <asset id>   ->   {"id", "kind", "bounds", "pivot", "triangles", "vertices", "materials"}
// Reads the imported .glb itself: bounds from the POSITION accessors' min and max, counts from the accessors,
// material names in order. Node transforms are not applied, so bounds are right for a model whose nodes are not
// moved or scaled; this runtime uses meters, so no unit conversion is needed. Other files report id and kind only.
import { existsSync, readFileSync } from 'node:fs';
import { absolute, emit, fail, fileOf } from './lib.mjs';

const id = process.argv[2];
if (!id) fail('inspect needs an asset id', 'for example: inspect assets/static/barrel.glb');
const file = fileOf(id);
if (!existsSync(absolute(file))) fail(`no such asset: ${id}`);
const receipt = { id, kind: file.split('/').at(-2) };

if (file.endsWith('.glb')) {
  const bytes = readFileSync(absolute(file));
  if (bytes.readUInt32LE(0) !== 0x46546c67) fail(`${file} is not a binary glTF file`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  const accessors = gltf.accessors ?? [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let vertices = 0;
  for (const primitive of (gltf.meshes ?? []).flatMap((mesh) => mesh.primitives)) {
    const position = accessors[primitive.attributes?.POSITION];
    if (!position?.min || !position?.max) continue;
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], position.min[k]); max[k] = Math.max(max[k], position.max[k]); }
    vertices += position.count;
    if ((primitive.mode ?? 4) === 4) triangles += (primitive.indices === undefined ? position.count : accessors[primitive.indices].count) / 3;
  }
  if (vertices > 0) Object.assign(receipt, { bounds: { min, max }, pivot: [0, 0, 0], triangles, vertices });
  receipt.materials = (gltf.materials ?? []).map((material, i) => material.name ?? `material ${i}`);
  const skin = gltf.skins?.[0];
  if (skin) receipt.skeleton = { bones: skin.joints.map((joint) => gltf.nodes[joint].name ?? `joint ${joint}`) };
}
emit(receipt);
