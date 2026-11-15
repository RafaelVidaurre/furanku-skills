import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measure } from '../measure.mjs';
import { modelBytes } from './fixtures.mjs';

test('measure counts rendered instances, strip/fan triangles and embedded image memory', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'jam measurement ')); t.after(() => rmSync(root,{recursive:true,force:true}));
  for (const mode of [4,5,6]) {
    const file = join(root,`${mode}.glb`); writeFileSync(file, await modelBytes({mode, count: mode === 4 ? 6 : 4, instances: 3, texture: true}));
    const result = await measure(file);
    assert.equal(result.triangles, 6); assert.equal(result.materials, 1);
    assert.equal(result.drawPrimitives, 3); assert.deepEqual(result.textureDimensions, [[1,1]]);
    assert.equal(result.textureMiB, 4/1048576);
  }
});
test('measure refuses non-triangle assets rather than undercounting them', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'jam measurement ')); t.after(() => rmSync(root,{recursive:true,force:true}));
  const file=join(root,'points.glb');writeFileSync(file,await modelBytes({mode:0}));
  await assert.rejects(measure(file), /triangle primitives/);
});
