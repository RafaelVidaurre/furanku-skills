// references <res:// or uid:// id>...   ->   {"references": [{"id", "uses": [ids], "referencers": [ids]}]}
// What each file uses and what uses it, from the project's text (the inventory's references), read
// fresh: files unchanged since the last `jam engine inventory` are taken from it, nothing is written.
import { join } from 'node:path';
import { AdapterError, loadConfig, main } from './godot/lib.mjs';
import { readPrevious, scan } from './godot/inventory.mjs';

main((argv) => {
  if (argv.length === 0 || argv.some((id) => id.startsWith('-'))) throw new AdapterError('references needs one or more ids, such as res://characters/hero.tscn');
  const cfg = loadConfig();
  const previous = readPrevious(join(cfg.project, ...cfg.scratch.split('/'), '.engine', 'inventory.json'), cfg.id);
  const files = Object.values(scan(cfg, previous).inventory.files);
  const byUid = new Map(files.flatMap((file) => (file.assets?.[0]?.tags?.uid === undefined ? [] : [[file.assets[0].tags.uid, file.id]])));
  return {
    references: argv.map((given) => {
      const id = byUid.get(given) ?? given;
      const own = files.find((file) => file.id === id);
      return {
        id,
        uses: (own?.references ?? []).map((reference) => reference.to),
        referencers: files.filter((file) => (file.references ?? []).some((reference) => reference.to === id)).map((file) => file.id).sort()
      };
    })
  };
});
