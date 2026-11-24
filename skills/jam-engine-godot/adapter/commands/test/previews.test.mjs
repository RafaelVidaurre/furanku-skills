import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { godotProject } from './fixture.mjs';
import { assertValid, png, readJson, run, SHEET_MODULE, write } from './support.mjs';

const INVENTORY = 'Art/.scratch/.engine/inventory.json';
const OUT = 'Art/.scratch/.engine/previews';
const { isSheet } = await import(SHEET_MODULE);

function previews(dir, ...more) {
  const inventory = run(dir, 'inventory', '--out', INVENTORY, ...(existsSync(join(dir, INVENTORY)) ? ['--previous', INVENTORY] : []));
  assert.equal(inventory.status, 0, inventory.stderr);
  const done = run(dir, 'previews', '--inventory', INVENTORY, '--out', OUT, ...more);
  assert.equal(done.status, 0, done.stderr);
  assertValid('engine-previews-receipt', done.receipt);
  const index = readJson(dir, `${OUT}/index.json`);
  assertValid('engine-previews', index);
  return { receipt: done.receipt, index, files: index.files };
}

const shown = (dir) => readdirSync(join(dir, OUT)).filter((name) => name !== 'index.json').sort();

test('imported images, WAV sounds and GLB models are copied; SpriteFrames become sprite sheets of their atlas', () => {
  const dir = godotProject();
  const { receipt, index, files } = previews(dir);
  assert.equal(index.adapter, 'godot');
  // Shown: walk.png, idle.png, jump.wav, crate.glb, hero_frames.tres, hero.tscn, icon.tres. Failed: theme.ogg.
  // None: the scripts, sword.tres and the unread bad.png (which has no entry at all).
  assert.deepEqual(receipt, { index: `${OUT}/index.json`, previews: 7, made: 7, reused: 0, failed: 1, waiting: 0, none: 4 });

  const inventory = readJson(dir, INVENTORY);
  const walk = files['sprites/hero/walk.png'];
  assert.deepEqual({ ...walk, file: undefined }, { version: `${inventory.files['sprites/hero/walk.png'].size}:${inventory.files['sprites/hero/walk.png'].mtimeMs}`, file: undefined, kind: 'image', how: 'the imported image itself' });
  assert.deepEqual(readFileSync(join(dir, OUT, walk.file)), readFileSync(join(dir, 'sprites/hero/walk.png')));
  assert.equal(files['sfx/jump.wav'].kind, 'audio');
  assert.equal(files['models/crate.glb'].kind, 'model');
  assert.match(files['music/theme.ogg'].failed, /Ogg Vorbis.*WAV/);
  assert.equal(files['music/theme.ogg'].file, undefined);

  const frames = files['sprites/hero/hero_frames.tres'];
  assert.equal(frames.version, `${inventory.files['sprites/hero/hero_frames.tres'].size}:${inventory.files['sprites/hero/hero_frames.tres'].mtimeMs}`);
  assert.deepEqual(frames.animations.map((animation) => animation.name), ['walk', 'idle']);
  const [walkAnimation, idle] = frames.animations;
  // The atlas is copied once: its own entry and the animation cut from it name the same file.
  assert.equal(walkAnimation.file, walk.file);
  assert.deepEqual(walkAnimation.sheet, { fps: 12, loop: true, frames: [{ region: [0, 0, 30, 32], offset: [1, 0], size: [32, 32] }, { region: [32, 0, 32, 32] }] });
  assert.equal(idle.file, files['sprites/hero/idle.png'].file);
  assert.deepEqual([walkAnimation.source, idle.source], ['sprites/hero/walk.png', 'sprites/hero/idle.png'], 'each animation names the project image it is cut from');
  assert.deepEqual(idle.sheet, { fps: 4, loop: false, frames: [{ region: [0, 0, 16, 16], duration: 2 }] });
  assert.deepEqual([frames.file, frames.sheet, frames.kind], [undefined, undefined, undefined], 'each animation is shown once, as itself');
  assert.match(frames.how, /left out: mixed \(its frames come from 2 images/);
  for (const animation of frames.animations) assert.ok(isSheet(animation.sheet), `the catalog takes the ${animation.name} sheet as it is`);

  assert.deepEqual(files['sprites/hero/hero.tscn'].animations, [{ name: 'default', file: walk.file, source: 'sprites/hero/walk.png', sheet: { fps: 5, loop: true, frames: [{ region: [32, 0, 32, 32] }] } }]);
  const atlasVersion = (path) => `${inventory.files[path].size}:${inventory.files[path].mtimeMs}`;
  assert.deepEqual(files['ui/icon.tres'], { version: files['ui/icon.tres'].version, inputs: { 'sprites/hero/walk.png': atlasVersion('sprites/hero/walk.png') }, file: walk.file, sheet: { fps: 1, loop: false, frames: [{ region: [0, 0, 16, 16] }] }, kind: 'image', how: "the AtlasTexture's region of its atlas image" });
  assert.deepEqual(frames.inputs, { 'sprites/hero/idle.png': atlasVersion('sprites/hero/idle.png'), 'sprites/hero/walk.png': atlasVersion('sprites/hero/walk.png') }, 'the images its animations are cut from, so the catalog sees when one changes');
  assert.equal(shown(dir).length, 4, 'walk.png, idle.png, jump.wav and crate.glb, each copied once');
});

test('a second run reuses what did not change; a changed atlas is copied again and the old copy removed', () => {
  const dir = godotProject();
  const first = previews(dir);
  const again = previews(dir);
  assert.deepEqual(again.receipt, { index: `${OUT}/index.json`, previews: 7, made: 0, reused: 7, failed: 1, waiting: 0, none: 4 });
  assert.deepEqual(again.files, first.files);

  write(dir, { 'sprites/hero/walk.png': png(64, 64) });
  const changed = previews(dir);
  // walk.png's own entry, and the three that cut frames from it, though their own files did not change.
  assert.equal(changed.receipt.made, 4);
  const file = changed.files['sprites/hero/walk.png'].file;
  assert.notEqual(file, first.files['sprites/hero/walk.png'].file);
  assert.equal(changed.files['sprites/hero/hero_frames.tres'].animations[0].file, file);
  assert.ok(!shown(dir).includes(first.files['sprites/hero/walk.png'].file), 'the old copy is removed');
  assert.equal(shown(dir).length, 4);

  assert.equal(previews(dir, '--full').receipt.made, 7, '--full makes everything again');
});

test('--only keeps the other entries as they were; --limit leaves the rest waiting', () => {
  const dir = godotProject();
  const only = previews(dir, '--only', 'sprites/**');
  assert.deepEqual(Object.keys(only.files).sort(), ['sprites/hero/hero.tscn', 'sprites/hero/hero_frames.tres', 'sprites/hero/idle.png', 'sprites/hero/walk.png']);
  const rest = previews(dir, '--only', 'sfx/*.wav');
  assert.deepEqual(Object.keys(rest.files).sort(), ['sfx/jump.wav', 'sprites/hero/hero.tscn', 'sprites/hero/hero_frames.tres', 'sprites/hero/idle.png', 'sprites/hero/walk.png']);

  const fresh = godotProject();
  const limited = previews(fresh, '--limit', '2');
  assert.equal(limited.receipt.made, 2);
  assert.equal(limited.receipt.waiting, 5);
  assert.equal(previews(fresh).receipt.waiting, 0);
  assert.equal(run(fresh, 'previews', '--inventory', INVENTORY, '--out', OUT, '--limit', 'some').status, 1);
});

test('an animation whose frames cannot be shown is left out with the reason; none at all is a failure', () => {
  const frames = (animations, extra = '') => `[gd_resource type="SpriteFrames" format=3]\n\n[ext_resource type="Texture2D" path="res://sprites/hero/walk.png" id="1"]\n${extra}\n[resource]\nanimations = ${animations}\n`;
  const atlas = (region) => `[sub_resource type="AtlasTexture" id="a"]\natlas = ExtResource("1")\nregion = Rect2(${region})\n`;
  const dir = godotProject({
    'bad/outside.tres': frames('[{"frames": [{"duration": 1.0, "texture": SubResource("a")}], "loop": true, "name": &"run", "speed": 5.0}]', atlas('40, 0, 32, 32')),
    'bad/still.tres': frames('[{"frames": [{"duration": 1.0, "texture": ExtResource("1")}], "loop": true, "name": &"still", "speed": 0.0}]'),
    'bad/empty.tres': frames('[{"frames": [], "loop": true, "name": &"default", "speed": 5.0}]'),
    'bad/gradient.tres': frames('[{"frames": [{"duration": 1.0, "texture": SubResource("g")}], "loop": true, "name": &"glow", "speed": 5.0}]', '[sub_resource type="GradientTexture2D" id="g"]\n'),
    // Godot 3's text format lists the textures themselves.
    'old/frames.tres': '[gd_resource type="SpriteFrames" load_steps=2 format=2]\n\n[ext_resource path="res://sprites/hero/idle.png" type="Texture" id=1]\n\n[resource]\nanimations = [ {\n"frames": [ ExtResource( 1 ), ExtResource( 1 ) ],\n"loop": true,\n"name": "default",\n"speed": 8.0\n} ]\n'
  });
  const { files } = previews(dir);
  assert.match(files['bad/outside.tres'].failed, /no animation can be shown: run \(a frame region \[40,0,32,32\] reaches outside .*walk\.png \(64x32\)\)/);
  assert.match(files['bad/still.tres'].failed, /still \(a speed of 0 frames per second\)/);
  assert.match(files['bad/empty.tres'].failed, /default \(no frames\)/);
  assert.match(files['bad/gradient.tres'].failed, /a GradientTexture2D frame/);
  assert.deepEqual(files['old/frames.tres'].animations[0].sheet, { fps: 8, loop: true, frames: [{ region: [0, 0, 16, 16] }, { region: [0, 0, 16, 16] }] });
});

// An Ogg page holding a Theora header: what Godot loads as VideoStreamTheora, with no .import.
const theora = () => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(22), Buffer.from([1, 42]), Buffer.from('\x80theora\x03\x02\x01', 'latin1'), Buffer.alloc(35)]);
// A stand-in ffmpeg: answers -version, and "converts" by copying its input to its last argument.
const FAKE_FFMPEG = `#!/usr/bin/env node
const { copyFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== '-version') copyFileSync(args[args.indexOf('-i') + 1], args.at(-1));
`;

test('an Ogg Theora video is listed and converted to MP4 with ffmpeg; without ffmpeg it says how to get a preview', async () => {
  const { chmodSync, writeFileSync } = await import('node:fs');
  const dir = godotProject();
  write(dir, { 'clips/intro.ogv': theora() });
  const fake = join(dir, 'fake-ffmpeg.js');
  writeFileSync(fake, FAKE_FFMPEG);
  chmodSync(fake, 0o755);

  const { runWith } = await import('./support.mjs');
  const inventory = runWith({ JAM_FFMPEG: fake }, dir, 'inventory', '--out', INVENTORY);
  assert.equal(inventory.status, 0, inventory.stderr);
  const listed = readJson(dir, INVENTORY).files['clips/intro.ogv'];
  assert.equal(listed.assets[0].class, 'VideoStreamTheora');

  const made = runWith({ JAM_FFMPEG: fake }, dir, 'previews', '--inventory', INVENTORY, '--out', OUT);
  assert.equal(made.status, 0, made.stderr);
  const entry = readJson(dir, `${OUT}/index.json`).files['clips/intro.ogv'];
  assert.deepEqual([entry.kind, entry.file.endsWith('.mp4'), existsSync(join(dir, OUT, entry.file))], ['video', true, true]);
  assert.match(entry.how, /converted to H\.264 MP4 by ffmpeg/);

  const none = runWith({ JAM_FFMPEG: join(dir, 'no-such-ffmpeg') }, dir, 'previews', '--inventory', INVENTORY, '--out', OUT, '--full');
  assert.equal(none.status, 0, none.stderr);
  assert.match(readJson(dir, `${OUT}/index.json`).files['clips/intro.ogv'].failed, /install ffmpeg \(or set JAM_FFMPEG to it\)/);
});
