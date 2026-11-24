// Test support: small Godot projects in temporary folders, media files built byte by byte, the
// adapter's commands run as the toolkit runs them, and the toolkit's published JSON Schemas checked
// with the subset of JSON Schema they use.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

export const ADAPTER = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLKIT = join(ADAPTER, '..', '..', 'jam-setup', 'assets', 'toolkit');
export const SHEET_MODULE = join(TOOLKIT, 'src', 'catalog', 'model', 'sheet.ts');

/** A project folder holding `files` (path -> text or bytes); its jam.config.json pins the scratch root. */
const made = [];
process.on('exit', () => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

export function project(files, config = { roots: { scratch: 'Art/.scratch' } }) {
  const dir = mkdtempSync(join(tmpdir(), 'jam-engine-godot-'));
  made.push(dir);
  write(dir, { 'jam.config.json': JSON.stringify(config), ...files });
  return dir;
}

export function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, ...path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

/** Runs a command as the toolkit does: from the project root, with the adapter's environment. */
export function run(dir, command, ...args) {
  return runWith({}, dir, command, ...args);
}

/** `run` with more environment variables, such as the ffmpeg to use (`JAM_FFMPEG`). */
export function runWith(env, dir, command, ...args) {
  const done = spawnSync(process.execPath, [join(ADAPTER, 'commands', `${command}.mjs`), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, JAM_PROJECT_ROOT: dir, JAM_ADAPTER_DIR: ADAPTER, JAM_ENGINE_SETTINGS: '{}', ...env }
  });
  const lines = done.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `one JSON object on standard output, got: ${done.stdout}\n${done.stderr}`);
  return { status: done.status, receipt: JSON.parse(lines[0]), stderr: done.stderr };
}

export const readJson = (dir, path) => JSON.parse(readFileSync(join(dir, ...path.split('/')), 'utf8'));

/** A real RGBA PNG of the given size, one colour. */
export function png(width, height) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0x80)]);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

/** A 16-bit PCM WAV of `seconds` of silence. */
export function wav(seconds, sampleRate = 8000, channels = 1) {
  const data = Buffer.alloc(Math.round(seconds * sampleRate) * channels * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'latin1');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * channels * 2, 28);
  head.writeUInt16LE(channels * 2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** A GLB holding one empty mesh. */
export function glb() {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [] }] }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}

/** The .import Godot writes beside an imported file. */
export function importFile(path, { importer = 'texture', type = 'CompressedTexture2D', uid, params = 'compress/mode=0\nmipmaps/generate=false\nprocess/fix_alpha_border=true\n', valid } = {}) {
  return `[remap]\n\nimporter="${importer}"\ntype="${type}"\n${uid ? `uid="${uid}"\n` : ''}${valid === false ? 'valid=false\n' : ''}path="res://.godot/imported/${path.split('/').pop()}-0.ctex"\nmetadata={\n"vram_texture": false\n}\n\n[deps]\n\nsource_file="res://${path}"\n\n[params]\n\n${params}`;
}

// ---- JSON Schema, the subset the toolkit's published schemas use
export const schema = (name) => JSON.parse(readFileSync(join(TOOLKIT, 'schemas', `${name}.schema.json`), 'utf8'));

const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value);

/** The problems of `value` against `root` (a published schema), as `path: message` strings. */
export function validate(root, value, { ignoreExcess = false } = {}) {
  const problems = [];
  const check = (node, value, at) => {
    if (node === true || node === undefined) return;
    if (node.$ref !== undefined) return check(node.$ref.replace('#/$defs/', '').split('/').reduce((n, key) => n[key], root.$defs), value, at);
    if (node.anyOf !== undefined) {
      if (!node.anyOf.some((option) => {
        const before = problems.length;
        check(option, value, at);
        const ok = problems.length === before;
        problems.length = before;
        return ok;
      })) problems.push(`${at}: matches none of anyOf`);
      return;
    }
    if (node.type !== undefined) {
      const types = Array.isArray(node.type) ? node.type : [node.type];
      const actual = typeOf(value);
      if (!types.some((type) => type === actual || (type === 'number' && actual === 'integer'))) return problems.push(`${at}: expected ${types.join('|')}, got ${actual}`);
    }
    if (node.enum !== undefined && !node.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) problems.push(`${at}: not one of ${JSON.stringify(node.enum)}`);
    if (typeof value === 'string') {
      if (node.pattern !== undefined && !new RegExp(node.pattern, 'u').test(value)) problems.push(`${at}: does not match ${node.pattern}`);
      if (node.maxLength !== undefined && value.length > node.maxLength) problems.push(`${at}: longer than ${node.maxLength}`);
      if (node.minLength !== undefined && value.length < node.minLength) problems.push(`${at}: shorter than ${node.minLength}`);
    }
    if (typeof value === 'number') {
      if (node.minimum !== undefined && value < node.minimum) problems.push(`${at}: below ${node.minimum}`);
      if (node.maximum !== undefined && value > node.maximum) problems.push(`${at}: above ${node.maximum}`);
      if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) problems.push(`${at}: not above ${node.exclusiveMinimum}`);
    }
    if (Array.isArray(value)) {
      if (node.minItems !== undefined && value.length < node.minItems) problems.push(`${at}: fewer than ${node.minItems} items`);
      node.prefixItems?.forEach((item, index) => index < value.length && check(item, value[index], `${at}[${index}]`));
      if (node.items !== undefined) value.forEach((item, index) => index >= (node.prefixItems?.length ?? 0) && check(node.items, item, `${at}[${index}]`));
    }
    if (typeOf(value) === 'object') {
      for (const key of node.required ?? []) if (!(key in value)) problems.push(`${at}.${key}: missing`);
      for (const [key, item] of Object.entries(value)) {
        const own = node.properties?.[key];
        const patterns = Object.entries(node.patternProperties ?? {}).filter(([pattern]) => new RegExp(pattern, 'u').test(key));
        if (own !== undefined) check(own, item, `${at}.${key}`);
        for (const [, sub] of patterns) check(sub, item, `${at}.${key}`);
        if (own === undefined && patterns.length === 0) {
          if (node.additionalProperties === false && !ignoreExcess) problems.push(`${at}.${key}: not allowed`);
          else if (typeof node.additionalProperties === 'object') check(node.additionalProperties, item, `${at}.${key}`);
        }
      }
    }
  };
  check(root, value, '$');
  return problems;
}

/** As the toolkit checks: an inventory or index strictly; a receipt ignoring fields beyond its schema. */
export function assertValid(name, value, options) {
  assert.deepEqual(validate(schema(name), value, options), [], `valid against ${name}.schema.json`);
}
