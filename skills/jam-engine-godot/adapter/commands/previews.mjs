// previews --inventory <project path> --out <project path> [--full] [--no-engine] [--only <pattern>]... [--limit <n>]
//   -> {"index", "previews", "made", "reused", "failed", "waiting", "none"}
// Copies each imported PNG, JPEG, WebP, WAV and GLB into --out, and turns SpriteFrames (and the
// SpriteFrames of a scene's AnimatedSprite2D) into sprite sheets of their atlas images, with
// index.json beside them (docs/previews.md). Nothing needs the editor, so --no-engine changes
// nothing; --limit caps the files copied in one run, the rest count as waiting.
import { join } from 'node:path';
import { AdapterError, loadConfig, main, parseArgs, portable } from './godot/lib.mjs';
import { Previews, readInventory } from './godot/previews.mjs';

main((argv) => {
  const args = parseArgs(argv, { values: ['inventory', 'out', 'limit'], lists: ['only'], flags: ['full', 'no-engine'] });
  if (args.inventory === undefined || args.out === undefined) throw new AdapterError('previews needs --inventory <project path> and --out <project path>');
  const limit = args.limit === undefined ? undefined : Number(args.limit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 0)) throw new AdapterError(`--limit must be a whole number: ${args.limit}`);
  const cfg = loadConfig();
  const inventory = readInventory(join(cfg.project, ...portable(args.inventory, '--inventory').split('/')));
  return new Previews(cfg, inventory, portable(args.out, '--out'), { full: args.full === true, only: args.only, limit }).run();
});
