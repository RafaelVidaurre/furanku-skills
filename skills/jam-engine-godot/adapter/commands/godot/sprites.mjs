// A SpriteFrames resource as the catalog's sprite sheets: each animation becomes one image and the
// frames cut from it (tools/jam/src/catalog/model/sheet.ts, the `frames` form).
//
//   AtlasTexture frame   region = its region; with a margin, offset = margin.position and
//                        size = region.size + margin.size, so a trimmed frame keeps its place
//   image frame          region = the whole image
//   frame duration       the frame's relative duration; fps = the animation's speed; loop = its loop
//
// An animation is shown only when one image holds all its frames; otherwise it is left out with the
// reason, as is a frame of any other texture type.
import { isRecord } from './lib.mjs';
import { readResourceText, rectOf, referenceId } from './text.mjs';

const MAX_FPS = 1000;
const MAX_DURATION = 1000;

const animationsOf = (props) => (Array.isArray(props?.animations) ? props.animations.filter(isRecord) : []);
const nameOf = (animation) => (typeof animation.name === 'string' && animation.name.trim() !== '' ? animation.name : 'default');

/** `walk:13, idle:8`: each animation's name and frame count, for the inventory. */
export const spriteFramesSummary = (props) =>
  animationsOf(props).map((animation) => `${nameOf(animation)}:${Array.isArray(animation.frames) ? animation.frames.length : 0}`).join(', ');

class Skip extends Error {}

/** An AtlasTexture's image, region and margin; `doc` is the file that holds it. */
function atlasFrame(props, doc, context) {
  if (referenceId(props.atlas, 'SubResource') !== null) throw new Skip('an AtlasTexture cut from another AtlasTexture');
  const ext = referenceId(props.atlas, 'ExtResource');
  const image = ext === null ? null : context.externalPath(doc.external.get(ext));
  if (image === null) throw new Skip('an AtlasTexture with no atlas image');
  return { image, region: rectOf(props.region), margin: rectOf(props.margin) };
}

function textureFrame(value, doc, context) {
  const sub = referenceId(value, 'SubResource');
  if (sub !== null) {
    const resource = doc.sub.get(sub);
    if (resource === undefined) throw new Skip(`a frame names a missing sub-resource ${sub}`);
    if (resource.type !== 'AtlasTexture') throw new Skip(`a ${resource.type} frame (only AtlasTexture and image frames are read)`);
    return atlasFrame(resource.props, doc, context);
  }
  const ext = referenceId(value, 'ExtResource');
  if (ext === null) throw new Skip('a frame with no texture');
  const path = context.externalPath(doc.external.get(ext));
  if (path === null) throw new Skip(`a frame names a missing external resource ${ext}`);
  if (/\.tres$/i.test(path)) {
    const text = context.readText(path);
    const other = text === null ? null : readResourceText(text);
    if (other?.header?.attrs?.type !== 'AtlasTexture' || other.resource === null) throw new Skip(`a frame of ${path}, which is not an AtlasTexture`);
    return atlasFrame(other.resource, other, context);
  }
  return { image: path, region: null, margin: null };
}

function sheetFrame(frame, duration, imageSize) {
  let region = frame.region?.map(Math.round) ?? null;
  if (region === null || region[2] < 1 || region[3] < 1) {
    if (imageSize === null) throw new Skip(`the size of ${frame.image} cannot be read`);
    region = [0, 0, imageSize[0], imageSize[1]];
  }
  if (region.some((n) => n < 0)) throw new Skip('a frame region starts outside its image');
  if (imageSize !== null && (region[0] + region[2] > imageSize[0] || region[1] + region[3] > imageSize[1])) {
    throw new Skip(`a frame region ${JSON.stringify(region)} reaches outside ${frame.image} (${imageSize[0]}x${imageSize[1]})`);
  }
  const out = { region };
  const margin = frame.margin?.map(Math.round) ?? null;
  if (margin !== null && margin.some((n) => n !== 0)) {
    if (margin.some((n) => n < 0) || margin[0] > margin[2] || margin[1] > margin[3]) throw new Skip(`a margin ${JSON.stringify(margin)} places the region outside its frame`);
    if (margin[0] !== 0 || margin[1] !== 0) out.offset = [margin[0], margin[1]];
    out.size = [region[2] + margin[2], region[3] + margin[3]];
  }
  if (duration !== 1) {
    if (!(typeof duration === 'number' && duration > 0 && duration <= MAX_DURATION)) throw new Skip(`a frame duration of ${duration}`);
    out.duration = duration;
  }
  return out;
}

/**
 * The animations of one SpriteFrames (`props`, the properties of its resource or sub_resource, in `doc`):
 * `{ animations: [{ name, image, sheet }], skipped: [{ name, why }] }`, where `image` is the res:// path
 * of the one image the frames are cut from.
 *
 * context.externalPath(ext) -> res:// path of an [ext_resource] (by uid first), or null
 * context.readText(resPath) -> the text of a .tres in the project, or null
 * context.imageSize(resPath) -> [width, height], or null
 * context.viewable(resPath) -> whether the catalog shows the image as it is
 */
export function spriteAnimations(props, doc, context) {
  const animations = [];
  const skipped = [];
  for (const animation of animationsOf(props)) {
    const name = nameOf(animation);
    try {
      const listed = Array.isArray(animation.frames) ? animation.frames : [];
      if (listed.length === 0) throw new Skip('no frames');
      // Godot 4 lists { duration, texture }; Godot 3 lists the textures themselves.
      const frames = listed.map((item) => (isRecord(item) && !('call' in item) ? { ...textureFrame(item.texture, doc, context), duration: item.duration ?? 1 } : { ...textureFrame(item, doc, context), duration: 1 }));
      const images = [...new Set(frames.map((frame) => frame.image))];
      if (images.length > 1) throw new Skip(`its frames come from ${images.length} images (${images.join(', ')}); one image must hold them all`);
      const [image] = images;
      if (!context.viewable(image)) throw new Skip(`its image ${image} is not one the catalog shows (PNG, JPEG or WebP)`);
      const size = context.imageSize(image);
      const speed = animation.speed ?? 5;
      if (!(typeof speed === 'number' && speed > 0 && speed <= MAX_FPS)) throw new Skip(`a speed of ${speed} frames per second`);
      const sheet = { fps: speed, loop: animation.loop !== false, frames: frames.map((frame) => sheetFrame(frame, frame.duration, size)) };
      animations.push({ name, image, sheet });
    } catch (error) {
      if (!(error instanceof Skip)) throw error;
      skipped.push({ name, why: error.message });
    }
  }
  return { animations, skipped };
}

/**
 * The SpriteFrames a scene's nodes use from its own sub-resources (an AnimatedSprite2D's
 * `sprite_frames = SubResource(...)`): `[{ node, props }]`, in node order.
 */
export function sceneSpriteFrames(doc) {
  const out = [];
  const seen = new Set();
  for (const node of doc.nodes) {
    const id = referenceId(node.props.sprite_frames, 'SubResource');
    const resource = id === null ? undefined : doc.sub.get(id);
    if (resource?.type !== 'SpriteFrames' || seen.has(id)) continue;
    seen.add(id);
    out.push({ node: typeof node.name === 'string' ? node.name : id, props: resource.props });
  }
  return out;
}
