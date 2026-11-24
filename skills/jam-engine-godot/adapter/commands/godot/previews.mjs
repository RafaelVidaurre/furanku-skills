// Previews of the Godot project's content for the catalog (schemas/engine-previews.schema.json): one
// viewable file per inventory entry, in one folder beside index.json. docs/previews.md says what each
// kind of file gets. Nothing here needs the editor: the previews are the project's own files, copied,
// and sprite sheets read from SpriteFrames resources.
//
// A copy is named by the source's path and version, so an image that is both its own entry and the
// atlas of animations is copied once, and a changed image gets a new name. Every run plans each
// entry again (it costs a text read); a planned entry equal to the previous one, whose files are all
// in the folder, is reused.
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { AdapterError, glob, readOwn, versionOf, writeJsonAtomic } from './lib.mjs';
import { imageSize } from './media.mjs';
import { readResourceText } from './text.mjs';
import { sceneSpriteFrames, spriteAnimations } from './sprites.mjs';

export const INDEX = 'index.json';
const PREVIEW_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp|glb|wav|mp4)$/;
const COPIED = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', glb: 'model', wav: 'audio' };
const HOW = {
  image: 'the imported image itself',
  model: 'the imported GLB itself',
  audio: 'the imported WAV itself',
  frames: 'SpriteFrames animations, cut from their atlas images',
  sceneFrames: "the animations of the scene's AnimatedSprite2D SpriteFrames, cut from their atlas images",
  atlas: "the AtlasTexture's region of its atlas image",
  video: 'the Ogg Theora video converted to H.264 MP4 by ffmpeg (browsers other than Firefox do not play Theora)'
};

/**
 * ffmpeg, when this machine has one: `JAM_FFMPEG`, else `ffmpeg` on the PATH. Null when none runs.
 * Asked once per run.
 */
let ffmpegFound;
export function findFfmpeg() {
  if (ffmpegFound !== undefined) return ffmpegFound;
  const command = process.env.JAM_FFMPEG || 'ffmpeg';
  const ran = spawnSync(command, ['-version'], { encoding: 'utf8', windowsHide: true });
  ffmpegFound = ran.status === 0 ? command : null;
  return ffmpegFound;
}

/** A video converted for the catalog: H.264 video and AAC sound in an MP4 that starts playing at once. Returns why it failed, or null. */
function convertVideo(ffmpeg, from, to) {
  const ran = spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', from, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', to], { encoding: 'utf8', windowsHide: true, timeout: 600000 });
  return ran.status === 0 ? null : (ran.stderr || ran.error?.message || `ffmpeg exited with ${ran.status}`).trim().split('\n').at(-1);
}
const NOT_SHOWN = {
  ogg: 'an Ogg Vorbis sound: the catalog plays WAV previews, and this adapter carries no decoder',
  mp3: 'an MP3 sound: the catalog plays WAV previews, and this adapter carries no decoder',
  gltf: 'a .gltf scene: the catalog shows self-contained GLB; export it as .glb to see it',
  fbx: 'an FBX scene: the catalog shows self-contained GLB; export it as .glb to see it',
  obj: 'an OBJ mesh: the catalog shows self-contained GLB; export it as .glb to see it',
  blend: 'a Blender file: the catalog shows self-contained GLB; export it as .glb to see it',
  dae: 'a Collada scene: the catalog shows self-contained GLB; export it as .glb to see it',
  svg: 'an SVG image: the catalog shows PNG, JPEG and WebP previews, and this adapter rasterizes nothing',
  bmp: 'a BMP image: the catalog shows PNG, JPEG and WebP previews, and this adapter converts nothing',
  tga: 'a TGA image: the catalog shows PNG, JPEG and WebP previews, and this adapter converts nothing',
  exr: 'an EXR image: the catalog shows PNG, JPEG and WebP previews, and this adapter converts nothing',
  hdr: 'an HDR image: the catalog shows PNG, JPEG and WebP previews, and this adapter converts nothing',
  dds: 'a DDS texture: the catalog shows PNG, JPEG and WebP previews, and this adapter converts nothing',
  ktx: 'a KTX texture: the catalog shows PNG, JPEG and WebP previews, and this adapter converts nothing',
  ktx2: 'a KTX2 texture: the catalog shows PNG, JPEG and WebP previews, and this adapter converts nothing'
};

const extensionOf = (path) => (path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '');
const mainOf = (entry) => entry.assets?.find((asset) => asset.id === entry.main);

export function readInventory(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new AdapterError(`cannot read the inventory ${path}: ${error.message}`, 'run jam engine inventory first');
  }
  if (value === null || typeof value !== 'object' || typeof value.files !== 'object' || !Array.isArray(value.roots)) {
    throw new AdapterError(`${path} is not an inventory`, 'run jam engine inventory --full');
  }
  return value;
}

/** One run over an inventory: plans each entry, copies what it needs, and keeps the folder and its index in step. */
export class Previews {
  constructor(cfg, inventory, out, { full = false, only = [], limit } = {}) {
    this.cfg = cfg;
    this.inventory = inventory;
    this.out = out;
    this.dir = join(cfg.project, ...out.split('/'));
    this.previous = readOwn(join(this.dir, INDEX), cfg.id)?.files ?? {};
    this.full = full;
    this.only = only.map(glob);
    this.limit = limit;
    this.files = {};
    this.counts = { made: 0, reused: 0, failed: 0, waiting: 0, none: 0 };
    const root = inventory.roots.find((r) => r.id === cfg.scheme.replace('{path}', '')) ?? inventory.roots[0];
    this.prefix = root?.id ?? 'res://';
    this.base = root === undefined || root.path === '.' ? '' : `${root.path}/`;
    this.byUid = new Map();
    for (const entry of Object.values(inventory.files)) {
      const uid = mainOf(entry)?.tags?.uid;
      if (uid !== undefined) this.byUid.set(uid, entry.id);
    }
  }

  /** The project path of a res:// path, or null when it is outside the Godot project. */
  pathOf(id) {
    if (typeof id !== 'string' || !id.startsWith(this.prefix)) return null;
    const inside = id.slice(this.prefix.length);
    return inside === '' || inside.split('/').some((part) => part === '' || part === '.' || part === '..') ? null : `${this.base}${inside}`;
  }

  abs(path) {
    return join(this.cfg.project, ...path.split('/'));
  }

  /** The copy of a project file in the folder: named by its path and current version. */
  copyName(path) {
    const listed = this.inventory.files[path];
    const info = listed === undefined ? statSync(this.abs(path)) : null;
    const version = listed === undefined ? `${info.size}:${info.mtimeMs}` : versionOf(listed);
    const name = path.slice(path.lastIndexOf('/') + 1);
    const ext = extensionOf(name);
    const stem = name.slice(0, name.length - ext.length - 1).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 60) || 'preview';
    const key = createHash('sha256').update(`${path}\0${version}`).digest('hex').slice(0, 12);
    return { name: `${stem}-${key}.${ext}`, source: path };
  }

  context() {
    return {
      externalPath: (ext) => {
        if (ext === undefined) return null;
        const byUid = typeof ext.uid === 'string' ? this.byUid.get(ext.uid) : undefined;
        return byUid ?? (typeof ext.path === 'string' ? ext.path : null);
      },
      readText: (id) => {
        const path = this.pathOf(id);
        try {
          return path === null ? null : readFileSync(this.abs(path), 'utf8');
        } catch {
          return null;
        }
      },
      imageSize: (id) => {
        const path = this.pathOf(id);
        return path === null || !existsSync(this.abs(path)) ? null : imageSize(this.abs(path));
      },
      viewable: (id) => {
        const path = this.pathOf(id);
        return path !== null && COPIED[extensionOf(path)] === 'image' && existsSync(this.abs(path));
      }
    };
  }

  /**
   * The sprite-sheet entry of one or more SpriteFrames: its animations, each a part of its own. It
   * names no main file, so no animation is shown twice; the catalog's thumbnail is the first one's first frame.
   */
  sheets(version, sets, how) {
    const shown = [];
    const skipped = [];
    for (const { prefix, props, doc } of sets) {
      const found = spriteAnimations(props, doc, this.context());
      shown.push(...found.animations.map((animation) => ({ ...animation, name: `${prefix}${animation.name}` })));
      skipped.push(...found.skipped.map((skip) => `${prefix}${skip.name} (${skip.why})`));
    }
    if (shown.length === 0) return { entry: { version, failed: skipped.length === 0 ? 'it holds no animations' : `no animation can be shown: ${skipped.join('; ')}` }, copies: [] };
    const copies = new Map(shown.map((animation) => [animation.image, this.copyName(this.pathOf(animation.image))]));
    const animations = shown.map((animation) => ({ name: animation.name, file: copies.get(animation.image).name, source: this.pathOf(animation.image), sheet: animation.sheet }));
    // The images the frames are cut from: the catalog marks the animations outdated when one changes.
    const inputs = Object.fromEntries([...copies.keys()].map((image) => this.pathOf(image)).filter((path) => this.inventory.files[path] !== undefined).sort().map((path) => [path, versionOf(this.inventory.files[path])]));
    return {
      entry: {
        version,
        ...(Object.keys(inputs).length === 0 ? {} : { inputs }),
        animations,
        how: skipped.length === 0 ? how : `${how}; left out: ${skipped.join('; ')}`
      },
      copies: [...copies.values()]
    };
  }

  /** What one inventory entry gets: `{ entry, copies }`, or null when its kind has no preview. */
  plan(path, entry) {
    const version = versionOf(entry);
    const main = mainOf(entry);
    const ext = extensionOf(path);
    if (main?.tags?.importer !== undefined) {
      const kind = COPIED[ext];
      if (kind !== undefined) {
        const copy = this.copyName(path);
        return { entry: { version, file: copy.name, kind, how: HOW[kind] }, copies: [copy] };
      }
      return NOT_SHOWN[ext] === undefined ? null : { entry: { version, failed: NOT_SHOWN[ext] }, copies: [] };
    }
    if (main?.class === 'VideoStreamTheora') {
      const ffmpeg = findFfmpeg();
      if (ffmpeg === null) return { entry: { version, failed: 'an Ogg Theora video, which most browsers do not play: install ffmpeg (or set JAM_FFMPEG to it) and run the previews again to convert it' }, copies: [] };
      const copy = this.copyName(path);
      return { entry: { version, file: copy.name.replace(/\.ogv$/, '.mp4'), kind: 'video', how: HOW.video }, copies: [{ ...copy, name: copy.name.replace(/\.ogv$/, '.mp4'), convert: ffmpeg }] };
    }
    if (ext !== 'tres' && ext !== 'tscn') return null;
    const doc = readResourceText(readFileSync(this.abs(path), 'utf8'));
    if (ext === 'tscn') {
      const sets = sceneSpriteFrames(doc);
      if (sets.length === 0) return null;
      return this.sheets(version, sets.map((set) => ({ prefix: sets.length > 1 ? `${set.node}/` : '', props: set.props, doc })), HOW.sceneFrames);
    }
    const type = doc.header?.attrs?.type;
    if (type === 'SpriteFrames' && doc.resource !== null) return this.sheets(version, [{ prefix: '', props: doc.resource, doc }], HOW.frames);
    if (type === 'AtlasTexture' && doc.resource !== null) {
      const single = { animations: [{ name: 'region', speed: 1, loop: false, frames: [{ duration: 1, texture: { call: 'SubResource', args: ['$self'] } }] }] };
      const own = { ...doc, sub: new Map([...doc.sub, ['$self', { type: 'AtlasTexture', props: doc.resource }]]) };
      const made = this.sheets(version, [{ prefix: '', props: single, doc: own }], HOW.atlas);
      if (made.entry.animations === undefined) return made;
      const [region] = made.entry.animations;
      return { entry: { version, ...(made.entry.inputs === undefined ? {} : { inputs: made.entry.inputs }), file: region.file, sheet: region.sheet, kind: 'image', how: made.entry.how }, copies: made.copies };
    }
    return null;
  }

  run() {
    mkdirSync(this.dir, { recursive: true });
    let made = 0;
    for (const path of Object.keys(this.inventory.files).sort()) {
      const entry = this.inventory.files[path];
      if (entry.unread !== undefined || entry.main === undefined) continue;
      const old = this.previous[path];
      if (this.only.length > 0 && !this.only.some((pattern) => pattern.test(path))) {
        if (old !== undefined) this.files[path] = old;
        continue;
      }
      let planned;
      try {
        planned = this.plan(path, entry);
      } catch (error) {
        planned = { entry: { version: versionOf(entry), failed: `cannot read it: ${error.message}` }, copies: [] };
      }
      if (planned === null) {
        this.counts.none++;
        continue;
      }
      const present = planned.copies.every((copy) => existsSync(join(this.dir, copy.name)));
      if (!this.full && old !== undefined && present && isDeepStrictEqual(old, planned.entry)) {
        this.files[path] = old;
        this.counts[old.failed !== undefined ? 'failed' : 'reused']++;
        continue;
      }
      if (planned.copies.length > 0 && this.limit !== undefined && made >= this.limit) {
        this.counts.waiting++;
        if (old !== undefined) this.files[path] = old;
        continue;
      }
      let failure = null;
      for (const copy of planned.copies) {
        const target = join(this.dir, copy.name);
        if (!this.full && existsSync(target)) continue;
        if (copy.convert === undefined) copyFileSync(this.abs(copy.source), target, constants.COPYFILE_FICLONE);
        else failure = convertVideo(copy.convert, this.abs(copy.source), target) ?? failure;
      }
      if (failure !== null) planned = { entry: { version: planned.entry.version, failed: `ffmpeg could not convert it: ${failure}` }, copies: [] };
      this.files[path] = planned.entry;
      if (planned.entry.failed !== undefined) this.counts.failed++;
      else {
        this.counts.made++;
        if (planned.copies.length > 0) made++;
      }
    }
    this.save();
    return this.receipt();
  }

  /** Writes the index and removes preview files it no longer names. */
  save() {
    writeJsonAtomic(join(this.dir, INDEX), { format: 1, adapter: this.cfg.id, generatedAt: new Date().toISOString(), files: this.files });
    const named = new Set(Object.values(this.files).flatMap((entry) => [entry.file, ...(entry.animations ?? []).map((animation) => animation.file)]).filter((name) => name !== undefined));
    for (const name of readdirSync(this.dir)) {
      if (PREVIEW_FILE.test(name) && !named.has(name)) rmSync(join(this.dir, name), { force: true });
    }
  }

  receipt() {
    return {
      index: `${this.out}/${INDEX}`,
      previews: Object.values(this.files).filter((entry) => entry.file !== undefined || (entry.animations ?? []).length > 0).length,
      ...this.counts
    };
  }
}
