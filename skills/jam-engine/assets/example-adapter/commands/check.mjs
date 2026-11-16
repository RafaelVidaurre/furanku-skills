// check   ->   {"problems": [{"message", "fix"?}]}
// Every imported asset has its source record, and the bytes still match it. Exits 0 whether or not it found problems.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { absolute, contentRoot, emit, idOf, project, sha256 } from './lib.mjs';

const problems = [];
const root = absolute(contentRoot);
const files = existsSync(root) ? readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && !entry.name.endsWith('.source.json')) : [];
for (const entry of files) {
  const full = join(entry.parentPath, entry.name);
  const id = idOf(relative(project, full).split(sep).join('/'));
  if (!existsSync(`${full}.source.json`)) {
    problems.push({ message: `${id} has no source record`, fix: 'import it with "jam engine import" instead of copying it in' });
    continue;
  }
  const record = JSON.parse(readFileSync(`${full}.source.json`, 'utf8'));
  if (sha256(full) !== record.sha256) problems.push({ message: `${id} no longer matches its source ${record.source}`, fix: `import ${record.source} again` });
}
emit({ problems });
