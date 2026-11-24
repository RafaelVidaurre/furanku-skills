import assert from 'node:assert/strict';
import { readFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { godotProject } from './fixture.mjs';
import { ADAPTER, assertValid, project, readJson, run, write } from './support.mjs';

const OUT = 'Art/.scratch/.engine/inventory.json';
const inventory = (dir, ...more) => run(dir, 'inventory', '--out', OUT, ...more);

test('the inventory lists what Godot loads, with classes, uids, tags and references, and validates', () => {
  const dir = godotProject();
  const done = inventory(dir);
  assert.equal(done.status, 0, done.stderr);
  assertValid('engine-inventory-receipt', done.receipt);
  const written = readJson(dir, OUT);
  assertValid('engine-inventory', written);
  assert.deepEqual(written.roots, [{ id: 'res://', path: '.' }]);
  assert.deepEqual(Object.keys(written.files).sort(), [
    'addons/tool/plugin.gd', 'broken/bad.png', 'items/sword.tres', 'models/crate.glb', 'music/theme.ogg', 'scripts/hero.gd', 'scripts/item.gd',
    'sfx/jump.wav', 'sprites/hero/hero.tscn', 'sprites/hero/hero_frames.tres', 'sprites/hero/idle.png', 'sprites/hero/walk.png', 'ui/icon.tres'
  ], 'hidden, .gdignore and nested-project folders, skipped imports and files Godot does not load are left out');
  assert.deepEqual(done.receipt, { inventory: OUT, files: 13, assets: 12, read: 13, reused: 0, removed: 0, unread: 1 });

  const main = (path) => written.files[path].assets[0];
  assert.deepEqual(main('sprites/hero/walk.png'), {
    id: 'res://sprites/hero/walk.png',
    class: 'CompressedTexture2D',
    tags: { uid: 'uid://walkpng', importer: 'texture', 'compress/mode': 'Lossless', 'mipmaps/generate': 'false', 'process/fix_alpha_border': 'true', width: '64', height: '32' }
  });
  assert.deepEqual(main('sfx/jump.wav').tags, { uid: 'uid://jumpwav', importer: 'wav', 'force/mono': 'false', 'edit/loop_mode': '0', 'compress/mode': '2', channels: '1', sampleRate: '8000', seconds: '0.5' });
  assert.equal(main('models/crate.glb').class, 'PackedScene');
  assert.deepEqual(main('sprites/hero/hero_frames.tres'), { id: 'res://sprites/hero/hero_frames.tres', class: 'SpriteFrames', tags: { uid: 'uid://heroframes', animations: 'walk:2, idle:1, mixed:2' } });
  assert.deepEqual(main('sprites/hero/hero.tscn').tags, { uid: 'uid://heroscene', rootName: 'Hero', rootType: 'CharacterBody2D', nodes: '3' });
  assert.deepEqual(written.files['sprites/hero/hero.tscn'].names, [{ on: 'groups', values: ['players', 'saved', 'ui'] }]);
  assert.deepEqual(main('items/sword.tres'), { id: 'res://items/sword.tres', class: 'Item', tags: { uid: 'uid://sword', baseType: 'Resource' } });
  assert.deepEqual(main('scripts/hero.gd').tags, { uid: 'uid://herogd', className: 'Hero', extends: 'CharacterBody2D' });
  assert.equal(written.files['sprites/hero/walk.png'].main, 'res://sprites/hero/walk.png');
  assert.match(written.files['broken/bad.png'].unread, /valid=false/);
  assert.equal(written.files['broken/bad.png'].assets, undefined);

  // A reference names its file by uid first, as Godot does: the stale path in hero_frames.tres still finds walk.png.
  assert.deepEqual(written.files['sprites/hero/hero_frames.tres'].references, [
    { to: 'res://sprites/hero/idle.png', kind: 'hard' },
    { to: 'res://sprites/hero/walk.png', kind: 'hard' }
  ]);
  assert.deepEqual(written.files['sprites/hero/hero.tscn'].references, [
    { to: 'res://scripts/hero.gd', kind: 'hard' },
    { to: 'res://sprites/hero/walk.png', kind: 'hard' }
  ]);
  // preload is needed to load the script, load is on demand, and so is a path a constant names;
  // folders and format strings name no file.
  assert.deepEqual(written.files['scripts/hero.gd'].references, [
    { to: 'res://music/theme.ogg', kind: 'soft' },
    { to: 'res://sfx/jump.wav', kind: 'hard' },
    { to: 'res://sprites/hero/walk.png', kind: 'soft' },
    { to: 'res://ui/icon.tres', kind: 'soft' }
  ]);
});

test('a second run reads only the files whose size or modification time changed, a .import or .uid included', () => {
  const dir = godotProject();
  inventory(dir);
  assert.deepEqual(inventory(dir, '--previous', OUT).receipt, { inventory: OUT, files: 13, assets: 12, read: 0, reused: 13, removed: 0, unread: 1 });

  write(dir, { 'scripts/hero.gd': 'class_name Hero\nextends Node2D\n' });
  const later = new Date(Date.now() + 5000);
  utimesSync(join(dir, 'sprites/hero/walk.png.import'), later, later);
  rmSync(join(dir, 'ui/icon.tres'));
  const again = inventory(dir, '--previous', OUT);
  assert.deepEqual(again.receipt, { inventory: OUT, files: 12, assets: 11, read: 2, reused: 10, removed: 1, unread: 1 });
  const written = readJson(dir, OUT);
  assert.equal(written.files['scripts/hero.gd'].assets[0].tags.extends, 'Node2D');
  assert.equal(written.files['sprites/hero/walk.png'].mtimeMs, later.getTime(), 'the newest of the file and its sidecars');
  assertValid('engine-inventory', written);

  // Without --previous (the toolkit's --full) every file is read again.
  assert.equal(inventory(dir).receipt.read, 12);
});

test('a Godot project in a subfolder is found through the assetId fact, and a missing one is named with the fix', () => {
  const nested = Object.fromEntries(Object.entries({ 'project.godot': 'config_version=5\n', 'art/tree.png': 'x', 'art/tree.png.import': '[remap]\n\nimporter="texture"\ntype="CompressedTexture2D"\n' }).map(([path, text]) => [`game/${path}`, text]));
  const missing = run(project(nested), 'inventory', '--out', OUT);
  assert.equal(missing.status, 1);
  assert.match(missing.receipt.error.message, /no project\.godot in the project root/);
  assert.match(missing.receipt.error.fix, /"game\/\{path\}"/);

  const dir = project(nested, { roots: { scratch: 'Art/.scratch' }, engine: { facts: { assetId: { from: 'game/{path}' } } } });
  const done = run(dir, 'inventory', '--out', OUT);
  assert.equal(done.status, 0, done.stderr);
  const written = readJson(dir, OUT);
  assert.deepEqual(written.roots, [{ id: 'res://', path: 'game' }]);
  assert.equal(written.files['game/art/tree.png'].id, 'res://art/tree.png');
});

test('arguments are checked and failures print one JSON object', () => {
  const dir = godotProject();
  assert.match(run(dir, 'inventory').receipt.error.message, /--out/);
  assert.match(run(dir, 'inventory', '--out', '/tmp/x.json').receipt.error.message, /project-relative/);
  assert.match(run(dir, 'inventory', '--out', OUT, '--bogus').receipt.error.message, /unknown option --bogus/);
  assert.equal(inventory(dir, '--engine').status, 0, '--engine is accepted: nothing needs the editor');
});

test('references lists what a file uses and what uses it, by res:// or uid://', () => {
  const dir = godotProject();
  const done = run(dir, 'references', 'res://sprites/hero/walk.png', 'uid://herogd');
  assert.equal(done.status, 0, done.stderr);
  // The toolkit reads a receipt ignoring fields beyond its schema; `uses` and `referencers` are the contract's (jam-engine references/contract.md).
  assertValid('engine-references-receipt', done.receipt);
  assert.deepEqual(done.receipt.references, [
    { id: 'res://sprites/hero/walk.png', uses: [], referencers: ['res://scripts/hero.gd', 'res://sprites/hero/hero.tscn', 'res://sprites/hero/hero_frames.tres', 'res://ui/icon.tres'] },
    { id: 'res://scripts/hero.gd', uses: ['res://music/theme.ogg', 'res://sfx/jump.wav', 'res://sprites/hero/walk.png', 'res://ui/icon.tres'], referencers: ['res://sprites/hero/hero.tscn'] }
  ]);
});

test('adapter.json validates, names files that exist, and states the preset facts', () => {
  const adapter = JSON.parse(readFileSync(join(ADAPTER, 'adapter.json'), 'utf8'));
  assertValid('engine-adapter', adapter);
  for (const guide of Object.values(adapter.docs)) assert.doesNotThrow(() => readFileSync(join(ADAPTER, guide)), guide);
  for (const command of Object.values(adapter.commands).filter((c) => c !== null)) assert.doesNotThrow(() => readFileSync(join(ADAPTER, command.run[1])), command.run[1]);
  assert.deepEqual(Object.entries(adapter.commands).filter(([, c]) => c !== null).map(([verb]) => verb).sort(), ['inventory', 'previews', 'references']);
  const preset = JSON.parse(readFileSync(join(ADAPTER, '..', '..', 'jam-setup', 'assets', 'toolkit', 'engines', 'godot.json'), 'utf8'));
  assert.deepEqual(adapter.facts, preset.facts, 'the toolkit preset is the source of the conventions');
  assert.deepEqual(adapter.sources, preset.sources);
});
