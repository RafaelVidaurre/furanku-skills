// The Godot project's content as the toolkit's engine inventory (schemas/engine-inventory.schema.json),
// read from the files themselves. docs/inventory.md says what each kind of file gives.
//
// Godot's own rules decide what is content: every file under the folder holding project.godot,
// except hidden files and folders (.godot/ among them), folders holding a .gdignore, and folders
// holding another project.godot. An entry is a file Godot loads as a resource: one it imported
// (it has a <file>.import beside it), a text scene or resource, a script or shader, or a binary
// resource. A file with none of these meanings (notes, tool data) is not an entry.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { binaryResourceClass, imageSize, soundInfo } from './media.mjs';
import { projectPath, readOwn } from './lib.mjs';
import { parseGodotText, readResourceText, referenceId } from './text.mjs';
import { spriteFramesSummary } from './sprites.mjs';
import { scriptConstants } from '../../lib/gdscript.mjs';

const TEXT_RESOURCES = new Set(['tscn', 'tres']);
const SCRIPTS = { gd: 'GDScript', cs: 'CSharpScript', gdshader: 'Shader', gdshaderinc: 'ShaderInclude' };
const BINARY_RESOURCES = new Set(['res', 'scn', 'material', 'mesh', 'anim', 'occ', 'lmbake']);
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'webp']);
const SOUNDS = new Set(['wav', 'ogg']);
// Godot loads Ogg Theora video straight from the file, with no import.
const VIDEOS = { ogv: 'VideoStreamTheora' };

// Import settings worth filtering on, by importer. Texture compression modes are named as the import dock names them.
const IMPORT_TAGS = {
  texture: ['compress/mode', 'mipmaps/generate', 'process/fix_alpha_border', 'process/premult_alpha', 'process/size_limit'],
  wav: ['force/mono', 'force/max_rate', 'edit/loop_mode', 'compress/mode'],
  oggvorbisstr: ['loop', 'loop_offset'],
  mp3: ['loop', 'loop_offset'],
  scene: ['nodes/root_type', 'meshes/generate_lods', 'animation/import']
};
const TEXTURE_COMPRESSION = ['Lossless', 'Lossy', 'VRAM Compressed', 'VRAM Uncompressed', 'Basis Universal'];

const extensionOf = (name) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
const round = (value, places) => String(Math.round(value * 10 ** places) / 10 ** places);

/** Files Godot treats as content, as paths inside the Godot project, each with its sidecars. */
export function contentFiles(root) {
  const out = [];
  const walk = (inside) => {
    let entries;
    try {
      entries = readdirSync(inside === '' ? root : join(root, ...inside.split('/')), { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    if (inside !== '' && (names.has('.gdignore') || names.has('project.godot'))) return;
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = inside === '' ? entry.name : `${inside}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile() || entry.name.endsWith('.import') || entry.name.endsWith('.uid')) continue;
      const ext = extensionOf(entry.name);
      const imported = names.has(`${entry.name}.import`);
      const kind = imported ? 'imported' : TEXT_RESOURCES.has(ext) ? 'text' : ext in SCRIPTS ? 'script' : BINARY_RESOURCES.has(ext) ? 'binary' : ext in VIDEOS ? 'video' : null;
      if (kind === null) continue;
      const sidecars = [imported ? `${path}.import` : null, names.has(`${entry.name}.uid`) ? `${path}.uid` : null].filter((side) => side !== null);
      out.push({ path, ext, kind, sidecars });
    }
  };
  walk('');
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function importTags(importer, params) {
  const tags = {};
  for (const key of IMPORT_TAGS[importer] ?? []) {
    if (!(key in params)) continue;
    const value = params[key];
    tags[key] = importer === 'texture' && key === 'compress/mode' && typeof value === 'number' ? TEXTURE_COMPRESSION[value] ?? String(value) : text(value);
  }
  return tags;
}

function mediaTags(full, ext) {
  if (IMAGES.has(ext)) {
    const size = imageSize(full);
    return size === null ? {} : { width: String(size[0]), height: String(size[1]) };
  }
  if (SOUNDS.has(ext)) {
    const info = soundInfo(full);
    return info === null ? {} : { channels: String(info.channels), sampleRate: String(info.sampleRate), ...(info.seconds === undefined ? {} : { seconds: round(info.seconds, 3) }) };
  }
  return {};
}

function readImported(full, file, importText) {
  const sections = parseGodotText(importText);
  const remap = sections.find((section) => section.tag === 'remap')?.props ?? {};
  const params = sections.find((section) => section.tag === 'params')?.props ?? {};
  const importer = typeof remap.importer === 'string' ? remap.importer : null;
  if (importer === 'skip') return null;
  if (remap.valid === false) return { unread: 'Godot could not import it (valid=false in its .import): open the project in the editor to see why' };
  const cls = typeof remap.type === 'string' ? remap.type : importer === 'keep' ? 'File' : null;
  if (cls === null) return { unread: 'its .import names no resource type: open the project in the editor so it imports the file' };
  return {
    class: cls,
    uid: typeof remap.uid === 'string' ? remap.uid : undefined,
    tags: { ...(importer === null ? {} : { importer }), ...importTags(importer, params), ...mediaTags(full, file.ext) },
    references: []
  };
}

function readText(source) {
  const doc = readResourceText(source);
  if (doc.header === null) return { unread: 'not a Godot text scene or resource (no [gd_scene] or [gd_resource] header)' };
  const scene = doc.header.tag === 'gd_scene';
  const type = typeof doc.header.attrs.type === 'string' ? doc.header.attrs.type : 'Resource';
  const scriptClass = typeof doc.header.attrs.script_class === 'string' ? doc.header.attrs.script_class : null;
  const tags = {};
  if (scriptClass !== null) tags.baseType = type;
  const references = [...doc.external.values()].map((ext) => ({ path: typeof ext.path === 'string' ? ext.path : undefined, uid: typeof ext.uid === 'string' ? ext.uid : undefined, kind: 'hard' }));
  const names = [];
  if (scene) {
    const root = doc.nodes.find((node) => node.parent === undefined);
    if (root !== undefined) {
      if (typeof root.name === 'string') tags.rootName = root.name;
      if (typeof root.type === 'string') tags.rootType = root.type;
      const base = referenceId(root.instance, 'ExtResource');
      const inherited = base === null ? undefined : doc.external.get(base)?.path;
      if (typeof inherited === 'string') tags.inherits = inherited;
    }
    tags.nodes = String(doc.nodes.length);
    const groups = [...new Set(doc.nodes.flatMap((node) => (Array.isArray(node.groups) ? node.groups.filter((group) => typeof group === 'string') : [])))].sort();
    if (groups.length > 0) names.push({ on: 'groups', values: groups });
  }
  if (type === 'SpriteFrames' && doc.resource !== null) {
    const summary = spriteFramesSummary(doc.resource);
    if (summary !== '') tags.animations = summary;
  }
  return {
    class: scene ? 'PackedScene' : scriptClass ?? type,
    uid: typeof doc.header.attrs.uid === 'string' ? doc.header.attrs.uid : undefined,
    tags,
    references,
    names
  };
}

const LOADS = /\b(preload|load)\s*\(\s*"((?:res|uid):\/\/[^"]+)"/g;
const PATHS = /"((?:res|uid):\/\/[^"]+)"/g;

function readScript(file, source) {
  const tags = {};
  const references = [];
  if (file.ext === 'gd') {
    const className = /^\s*class_name\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(source);
    if (className !== null) tags.className = className[1];
    const base = /^\s*extends\s+("?)([^"\s#]+)\1/m.exec(source);
    if (base !== null) {
      tags.extends = base[2];
      if (base[1] === '"') references.push({ path: base[2], kind: 'hard' });
    }
    // A folder or a format string ("res://units/%s.png") names no one file.
    const names = (target) => !target.endsWith('/') && !/[%{]/.test(target);
    const loaded = new Set();
    for (const match of source.matchAll(LOADS)) {
      const target = match[2];
      if (!names(target)) continue;
      loaded.add(target);
      references.push({ ...(target.startsWith('uid://') ? { uid: target } : { path: target }), kind: match[1] === 'preload' ? 'hard' : 'soft' });
    }
    // Any other whole path in a string (`const WALK_PATH := "res://…"`, loaded by name later), and
    // any constant that builds one from pieces ("res://units/" + "walk.png"), is a soft reference too.
    const constants = scriptConstants(source);
    const built = constants.names.map((name) => constants.value(name)).filter((value) => typeof value === 'string');
    for (const target of [...[...source.matchAll(PATHS)].map((match) => match[1]), ...built.filter((value) => /^(?:res|uid):\/\//.test(value))]) {
      if (!names(target) || loaded.has(target)) continue;
      loaded.add(target);
      references.push({ ...(target.startsWith('uid://') ? { uid: target } : { path: target }), kind: 'soft' });
    }
  } else if (file.ext === 'gdshader' || file.ext === 'gdshaderinc') {
    for (const match of source.matchAll(/^\s*#include\s+"(res:\/\/[^"]+)"/gm)) references.push({ path: match[1], kind: 'hard' });
  }
  return { class: SCRIPTS[file.ext], tags, references };
}

/** One file read: its class, uid, tags, references still to resolve, and searchable names; or why it is unread. */
function readFile(root, file) {
  const full = join(root, ...file.path.split('/'));
  try {
    if (file.kind === 'imported') return readImported(full, file, readFileSync(`${full}.import`, 'utf8'));
    if (file.kind === 'text') return readText(readFileSync(full, 'utf8'));
    if (file.kind === 'video') return { class: VIDEOS[file.ext], tags: {}, references: [], uid: file.sidecars.some((side) => side.endsWith('.uid')) ? readFileSync(`${full}.uid`, 'utf8').trim() : undefined };
    if (file.kind === 'binary') {
      const found = binaryResourceClass(full);
      return found.unread !== undefined ? found : { class: file.ext === 'scn' ? 'PackedScene' : found.class, tags: { format: 'binary' }, references: [] };
    }
    const read = readScript(file, readFileSync(full, 'utf8'));
    return { ...read, uid: file.sidecars.some((side) => side.endsWith('.uid')) ? readFileSync(`${full}.uid`, 'utf8').trim() : undefined };
  } catch (error) {
    return { unread: `cannot read it: ${error.message}` };
  }
}

function stamp(root, file) {
  let size = 0;
  let mtimeMs = 0;
  for (const [index, path] of [file.path, ...file.sidecars].entries()) {
    const info = statSync(join(root, ...path.split('/')));
    if (index === 0) size = info.size;
    mtimeMs = Math.max(mtimeMs, info.mtimeMs);
  }
  return { size, mtimeMs };
}

/**
 * Every content file, read or taken from `previous` when its size and modification time (the newest of
 * the file and its .import and .uid) are unchanged. Returns the inventory and the run's counts.
 */
export function scan(cfg, previous) {
  const root = cfg.godot === '.' ? cfg.project : join(cfg.project, ...cfg.godot.split('/'));
  const idOf = (inside) => cfg.scheme.replace('{path}', inside);
  const old = previous?.files ?? {};
  const counts = { read: 0, reused: 0, removed: 0, unread: 0 };
  const files = {};
  const pending = [];
  for (const file of contentFiles(root)) {
    const key = projectPath(cfg.godot, file.path);
    let current;
    try {
      current = stamp(root, file);
    } catch {
      continue;
    }
    const before = old[key];
    if (before !== undefined && before.size === current.size && before.mtimeMs === current.mtimeMs) {
      files[key] = before;
      counts.reused++;
      if (before.unread !== undefined) counts.unread++;
      continue;
    }
    const read = readFile(root, file);
    // An import Godot skips is not content; it is looked at again each run, which costs one small read.
    if (read === null) continue;
    counts.read++;
    const id = idOf(file.path);
    if (read.unread !== undefined) {
      files[key] = { id, ...current, unread: read.unread };
      counts.unread++;
      continue;
    }
    const tags = { ...(read.uid === undefined ? {} : { uid: read.uid }), ...read.tags };
    files[key] = { id, ...current, main: id, assets: [{ id, class: read.class, ...(Object.keys(tags).length === 0 ? {} : { tags }) }] };
    if (read.names !== undefined && read.names.length > 0) files[key].names = read.names;
    pending.push([key, read.references]);
  }
  // A reference names its file by uid first, as Godot resolves it, then by path; the uids are known only once every file is.
  const byUid = new Map();
  for (const entry of Object.values(files)) {
    const uid = entry.assets?.[0]?.tags?.uid;
    if (uid !== undefined) byUid.set(uid, entry.id);
  }
  for (const [key, references] of pending) {
    const seen = new Map();
    for (const reference of references) {
      const to = (reference.uid !== undefined ? byUid.get(reference.uid) : undefined) ?? reference.path ?? reference.uid;
      if (to === undefined || to === files[key].id) continue;
      if (seen.get(to) !== 'hard') seen.set(to, reference.kind);
    }
    if (seen.size > 0) files[key].references = [...seen].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([to, kind]) => ({ to, kind }));
  }
  counts.removed = Object.keys(old).filter((key) => !(key in files)).length;
  return {
    inventory: {
      format: 1,
      adapter: cfg.id,
      generatedAt: new Date().toISOString(),
      roots: [{ id: idOf(''), path: cfg.godot }],
      files
    },
    counts
  };
}

/** The previous inventory this adapter wrote, or null. */
export const readPrevious = (path, adapterId) => (path === undefined ? null : readOwn(path, adapterId));
