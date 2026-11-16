// import --kind <kind> <file>...   ->   {"assets": [{"id", "kind", "source", "sha256"}]}
// Copies each file to <contentRoot>/<kind>/<name> and writes <name>.source.json beside it, which is how this
// "engine" remembers where an asset came from. The id comes from the kind and the file's name, so importing the
// same file again replaces the content and returns the same id.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { absolute, contentRoot, emit, fail, idOf, portable, sha256 } from './lib.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--kind');
if (at < 0 || !args[at + 1]) fail('import needs --kind <kind>', 'for example: import --kind static Art/Assets/barrel/v1/model/barrel.glb');
const kind = args[at + 1];
const files = args.filter((_, i) => i !== at && i !== at + 1);
if (files.length === 0) fail('import needs at least one file');

const assets = files.map((given) => {
  const source = portable(given);
  if (!existsSync(absolute(source))) fail(`source not found in the project: ${source}`);
  const target = `${contentRoot}/${kind}/${basename(source)}`;
  mkdirSync(dirname(absolute(target)), { recursive: true });
  copyFileSync(absolute(source), absolute(target));
  const digest = sha256(absolute(target));
  writeFileSync(absolute(`${target}.source.json`), `${JSON.stringify({ source, sha256: digest }, null, 2)}\n`);
  return { id: idOf(target), kind, source, sha256: digest };
});
emit({ assets });
