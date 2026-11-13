// Synthetic assets used by the local tool tests; no provider generation.
import { Document, NodeIO } from '@gltf-transform/core';
export async function modelBytes({ instances = 1, mode = 4, count = 3, texture = false } = {}) {
  const d = new Document(), buffer = d.createBuffer();
  const position = d.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,1,0,1,1,0])).setBuffer(buffer);
  const indices = d.createAccessor().setType('SCALAR').setArray(new Uint16Array(Array.from({length: count}, (_,i) => i % 4))).setBuffer(buffer);
  const material = d.createMaterial();
  if (texture) material.setBaseColorTexture(d.createTexture().setMimeType('image/png').setImage(PNG));
  const mesh = d.createMesh().addPrimitive(d.createPrimitive().setMode(mode).setAttribute('POSITION', position).setIndices(indices).setMaterial(material));
  const scene = d.createScene(); d.getRoot().setDefaultScene(scene);
  for (let i = 0; i < instances; i++) scene.addChild(d.createNode().setMesh(mesh));
  return new NodeIO().writeBinary(d);
}
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
export const PROFILE = { platforms: ['Windows'], renderer: 'deferred', camera: 'third person', cameraDistanceMeters: 3, screenCoveragePercent: 10, expectedInstances: 20, maxTextureMiB: 8, assetKind: 'static', units: 'meters', up: '+Z', forward: '-Y', pivot: 'bottom', materialWorkflow: 'pbr', targetTriangles: 1000, maxTriangles: 2000, textureSize: 1024, maxMaterials: 1 };
