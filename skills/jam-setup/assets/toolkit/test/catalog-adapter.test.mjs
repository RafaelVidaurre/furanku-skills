import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import projectAdapter from '../catalog-adapter.mjs';

test('sourced placeholders coexist with Jam assets and refresh without inventing Jam acceptance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jam-catalog-'));
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), JSON.stringify(value)); };
  try {
    write('Art/catalog.json', { version: 1, assetRoots: ['Art/Placeholders'], types: { placeholder: { label: 'Placeholder' } }, units: [{ id: 'placeholder/chair', type: 'placeholder', name: 'Chair', tags: ['placeholder'] }] });
    const adapter = projectAdapter({ root });
    let loaded = await adapter.load();
    assert.deepEqual(loaded.units.map((unit) => unit.id), ['placeholder/chair']);
    assert.equal(loaded.units[0].attrs, undefined);
    write('Art/Assets/table/v1/run.json', { version: 1, id: 'table', created: '2026-11-12T00:00:00Z', stages: {} });
    loaded = await adapter.load();
    assert.deepEqual(loaded.units.map((unit) => unit.id), ['table', 'placeholder/chair']);
    assert.ok(loaded.schema.types['jam-asset']);
    assert.ok(loaded.schema.types.placeholder);
    assert.ok(adapter.sources().includes('Art/catalog.json'));
    assert.equal(loaded.problems.length, 0);
    // A fresh external-content checkout must not resolve the Jam toolkit or
    // its optional format-measurement packages, even with an unconfigured run.
    const script = `
      import { registerHooks } from 'node:module';
      registerHooks({ resolve(s, c, next) {
        const result = next(s, c);
        if (result.url === ${JSON.stringify(new URL('../core.mjs', import.meta.url).href)}) throw new Error('external catalog loaded the Jam toolkit');
        return result;
      } });
      const { default: factory } = await import(${JSON.stringify(new URL('../catalog-adapter.mjs', import.meta.url).href)});
      const loaded = await factory({ root: ${JSON.stringify(root)} }).load();
      if (loaded.problems.length || loaded.units.length !== 2) throw new Error(JSON.stringify(loaded.problems));
    `;
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
