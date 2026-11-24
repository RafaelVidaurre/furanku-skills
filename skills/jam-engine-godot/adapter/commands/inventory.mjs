// inventory --out <project path> [--previous <project path>] [--engine]
//   -> {"inventory", "files", "assets", "read", "reused", "removed", "unread"}
// Reads every content file of the Godot project from its text (scenes, resources, .import settings,
// scripts) without the editor, and writes the inventory to --out. Entries of --previous whose file,
// .import and .uid are unchanged in size and modification time are reused. --engine is accepted and
// changes nothing: no file needs the editor to be read (docs/inventory.md).
import { join } from 'node:path';
import { AdapterError, loadConfig, main, parseArgs, portable, writeJsonAtomic } from './godot/lib.mjs';
import { readPrevious, scan } from './godot/inventory.mjs';

main((argv) => {
  const args = parseArgs(argv, { values: ['out', 'previous'], flags: ['engine'] });
  if (args.out === undefined) throw new AdapterError('inventory needs --out <project path>');
  const out = portable(args.out, '--out');
  const cfg = loadConfig();
  const previous = args.previous === undefined ? null : readPrevious(join(cfg.project, ...portable(args.previous, '--previous').split('/')), cfg.id);
  const { inventory, counts } = scan(cfg, previous);
  writeJsonAtomic(join(cfg.project, ...out.split('/')), inventory);
  const files = Object.values(inventory.files);
  return { inventory: out, files: files.length, assets: files.reduce((sum, file) => sum + (file.assets?.length ?? 0), 0), ...counts };
});
