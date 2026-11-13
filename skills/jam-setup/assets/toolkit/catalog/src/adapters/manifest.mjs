// Generic repository manifest adapter. A project describes its content types, visual roles,
// assets and units in JSON files it already versions. See README "Manifest adapter".
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { portablePath } from '../core/util.mjs';

export default function manifestAdapter({ root, options = {} }) {
  const manifestPath = options.manifest ?? 'catalog.manifest.json';
  let unitDirs = [];

  function readJson(rel) {
    const file = portablePath(root, rel);
    const text = readFileSync(file, 'utf8');
    if (/^(<{7}|>{7})( |$)/m.test(text)) throw new Error('unresolved Git merge conflict');
    return JSON.parse(text);
  }
  function walk(rel, out) {
    const full = portablePath(root, rel);
    if (!existsSync(full)) return out;
    for (const e of readdirSync(full).sort()) {
      if (e.startsWith('.')) continue;
      const r = `${rel}/${e}`;
      if (statSync(join(full, e)).isDirectory()) walk(r, out);
      else if (e.endsWith('.json')) out.push(r);
    }
    return out;
  }

  return {
    name: 'manifest',
    sources: () => [manifestPath, ...unitDirs],
    async load() {
      const problems = [];
      if (!existsSync(join(root, manifestPath))) {
        return { problems: [{ source: manifestPath, error: 'manifest not found', recovery: `create ${manifestPath} or choose another adapter in catalog.config.json` }] };
      }
      let m;
      try { m = readJson(manifestPath); } catch (e) { throw new Error(`${manifestPath}: ${e.message}`); }
      if (m.version !== 1) throw new Error(`${manifestPath}: unsupported manifest version`);
      unitDirs = (m.unitFiles ?? []).filter((d) => typeof d === 'string');
      const units = (m.units ?? []).map((u) => ({ ...u, sources: [manifestPath] }));
      for (const dir of unitDirs) {
        for (const file of walk(dir, [])) {
          try {
            const doc = readJson(file);
            for (const u of Array.isArray(doc.units) ? doc.units : [doc]) units.push({ ...u, sources: [file] });
          } catch (e) { problems.push({ source: file, error: e.message, recovery: 'fix this file; its entries are skipped until it parses' }); }
        }
      }
      return {
        project: m.project ?? null,
        schema: { types: m.types ?? {}, collectionKinds: m.collectionKinds ?? {} },
        assetRoots: m.assetRoots ?? [''],
        assets: m.assets ?? [],
        units,
        collections: m.collections ?? [],
        problems,
      };
    },
  };
}
