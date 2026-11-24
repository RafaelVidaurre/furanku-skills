import { portable } from '../commands/godot/lib.mjs';
import { spriteAnimations } from '../commands/godot/sprites.mjs';
import { readResourceText } from '../commands/godot/text.mjs';

function externalPath(reference) {
  const path = reference?.path;
  if (typeof path !== 'string' || !path.startsWith('res://')) return null;
  try {
    return portable(path.slice('res://'.length), 'Godot resource path');
  } catch {
    return null;
  }
}

/**
 * Read animations from the selected Godot text resources and their external AtlasTexture files.
 * All input, callback and returned paths are relative to the directory holding project.godot.
 * Each result has a source (.tres), image, name and catalog sheet. Non-SpriteFrames resources
 * contribute no animations. Unavailable resources and unsupported animations report problems.
 *
 * @param {Iterable<string>} paths
 * @param {{
 *   readText: (path: string) => string | null | PromiseLike<string | null>,
 *   viewable: (path: string) => boolean,
 *   imageSize: (path: string) => readonly [number, number] | null
 * }} io
 */
export async function readSpriteFrames(paths, io) {
  const animations = [];
  const problems = [];
  const texts = new Map();

  async function readText(path) {
    if (!texts.has(path)) {
      try {
        texts.set(path, await io.readText(path));
      } catch (error) {
        problems.push({ subject: path, error: `Cannot read the Godot resource. ${String(error)}` });
        texts.set(path, undefined);
      }
    }
    return texts.get(path);
  }

  for (const source of new Set(paths)) {
    try {
      portable(source, 'SpriteFrames source');
    } catch (error) {
      problems.push({ subject: source, error: error.message });
      continue;
    }
    const text = await readText(source);
    if (text === undefined) continue;
    if (text === null) {
      problems.push({ subject: source, error: 'The Godot resource is unavailable' });
      continue;
    }
    const doc = readResourceText(text);
    const type = doc.header?.attrs?.type;
    if (type === undefined) {
      problems.push({ subject: source, error: 'Cannot read the Godot resource header' });
      continue;
    }
    if (type !== 'SpriteFrames') continue;
    if (!Array.isArray(doc.resource?.animations)) {
      problems.push({ subject: source, error: 'Cannot read the SpriteFrames animations' });
      continue;
    }

    for (const ext of doc.external.values()) {
      const path = externalPath(ext);
      if (path !== null && /\.tres$/i.test(path)) await readText(path);
    }
    const found = spriteAnimations(doc.resource, doc, {
      externalPath,
      readText: path => texts.get(path) ?? null,
      viewable: path => io.viewable(path),
      imageSize: path => io.imageSize(path)
    });
    for (const animation of found.animations) animations.push({ source, ...animation });
    for (const { name, why } of found.skipped) problems.push({ subject: source, error: `${name}: ${why}` });
  }

  return { animations, problems };
}
