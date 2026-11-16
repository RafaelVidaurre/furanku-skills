// references <asset id>...   ->   {"references": [{"id", "referencers": [project files]}]}
// This runtime's game data is JSON beside the assets folder; a file refers to an asset by holding its id as text.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { absolute, contentRoot, emit, fail, fileOf, project } from './lib.mjs';

const ids = process.argv.slice(2);
if (ids.length === 0) fail('references needs at least one asset id');
ids.forEach(fileOf);
const dataRoot = dirname(absolute(contentRoot));
const dataFiles = readdirSync(dataRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.source.json'))
  .map((entry) => join(entry.parentPath, entry.name));
emit({
  references: ids.map((id) => ({
    id,
    referencers: dataFiles.filter((file) => readFileSync(file, 'utf8').includes(id)).map((file) => relative(project, file).split(sep).join('/')).sort(),
  })),
});
