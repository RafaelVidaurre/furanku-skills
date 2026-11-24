import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSpriteFrames } from '../../lib/sprite-frames.mjs';

const SPRITES = 'characters/sprites.tres';
const ATLAS = 'art/poses/crop.tres';
const IMAGE = 'art/poses/sprites.png';

const spriteFrames = (external, animations) => `[gd_resource type="SpriteFrames" format=3]

${external}

[resource]
animations = ${animations}
`;

test('reads direct image frames and external atlas frames with their authored source and timing', async () => {
  const resources = {
    [SPRITES]: spriteFrames(
      `[ext_resource type="Texture2D" path="res://${IMAGE}" id="image"]
[ext_resource type="Texture2D" path="res://${ATLAS}" id="crop"]`,
      `[
        {"frames": [{"texture": ExtResource("image")}], "loop": true, "name": &"idle", "speed": 4.0},
        {"frames": [{"texture": ExtResource("crop"), "duration": 1.5}], "loop": false, "name": &"turn", "speed": 12.0}
      ]`
    ),
    [ATLAS]: `[gd_resource type="AtlasTexture" format=3]

[ext_resource type="Texture2D" path="res://${IMAGE}" id="atlas"]

[resource]
atlas = ExtResource("atlas")
region = Rect2(10, 20, 50, 30)
margin = Rect2(5, 8, 10, 20)
`
  };

  const { animations, problems } = await readSpriteFrames([SPRITES], {
    readText: async path => resources[path] ?? null,
    viewable: path => path === IMAGE,
    imageSize: () => [128, 64]
  });

  assert.deepEqual(problems, []);
  assert.deepEqual(animations, [
    {
      source: SPRITES, image: IMAGE, name: 'idle',
      sheet: { fps: 4, loop: true, frames: [{ region: [0, 0, 128, 64] }] }
    },
    {
      source: SPRITES, image: IMAGE, name: 'turn',
      sheet: { fps: 12, loop: false, frames: [{ region: [10, 20, 50, 30], offset: [5, 8], size: [60, 50], duration: 1.5 }] }
    }
  ]);
});

test('reports missing dependencies and excludes images outside the caller scope', async () => {
  const source = spriteFrames(
    `[ext_resource type="Texture2D" path="res://${ATLAS}" id="missing"]
[ext_resource type="Texture2D" path="res://${IMAGE}" id="outside"]`,
    `[
      {"frames": [{"texture": ExtResource("missing")}], "name": &"turn", "speed": 12.0},
      {"frames": [{"texture": ExtResource("outside")}], "name": &"idle", "speed": 4.0}
    ]`
  );
  const { animations, problems } = await readSpriteFrames([SPRITES], {
    readText: path => path === SPRITES ? source : null,
    viewable: () => false,
    imageSize: () => assert.fail('excluded images must not be probed')
  });

  assert.deepEqual(animations, []);
  assert.equal(problems.length, 2);
  assert.ok(problems.every(problem => problem.subject === SPRITES));
  assert.ok(problems[0].error.startsWith('turn: ') && problems[0].error.includes(ATLAS));
  assert.ok(problems[1].error.startsWith('idle: ') && problems[1].error.includes(IMAGE));
});
