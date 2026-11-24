// A script's constants, read from its text: what the inventory resolves paths with, and what a
// project's catalog plugin may import from the installed adapter.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scriptConstants } from '../../lib/gdscript.mjs';

const SOURCE = `extends Node2D

const FOLDER := "res://sprites/wolf/"
const USE_NEW := true
const WALK_TEXTURE_PATH := (
\tFOLDER
\t+ (
\t\t"walk-v2.png"
\t\tif USE_NEW
\t\telse "walk-v1.png"
\t)
)
const ICON := preload("res://ui/icon.png")  # the menu icon
const WALK_FRAME_COUNT := 8
const WALK_FRAME_SIZE := Vector2(320.0, 320.0)
const WALK_DURATION := WALK_FRAME_COUNT / 16.0
const FRAME_TIMES := [0.0, 0.05, -0.1]
const OFFSET: float = 2 - 5
const SPEED := Rules.BASE_SPEED * 2
const LOOP_A := LOOP_B
const LOOP_B := LOOP_A
`;

test('constants evaluate from literals and other constants of the file; anything else is null', () => {
  const constants = scriptConstants(SOURCE);
  assert.deepEqual(constants.names, ['FOLDER', 'USE_NEW', 'WALK_TEXTURE_PATH', 'ICON', 'WALK_FRAME_COUNT', 'WALK_FRAME_SIZE', 'WALK_DURATION', 'FRAME_TIMES', 'OFFSET', 'SPEED', 'LOOP_A', 'LOOP_B']);
  assert.equal(constants.value('WALK_TEXTURE_PATH'), 'res://sprites/wolf/walk-v2.png', 'concatenation and a condition another constant decides');
  assert.equal(constants.value('ICON'), 'res://ui/icon.png', 'a preload is its path; a trailing comment is not part of it');
  assert.deepEqual([constants.value('WALK_FRAME_COUNT'), constants.value('WALK_FRAME_SIZE'), constants.value('WALK_DURATION')], [8, [320, 320], 0.5]);
  assert.deepEqual([constants.value('FRAME_TIMES'), constants.value('OFFSET')], [[0, 0.05, -0.1], -3]);
  assert.deepEqual([constants.value('SPEED'), constants.value('LOOP_A'), constants.value('MISSING')], [null, null, null], "another script's constant, a cycle and an unknown name");
});

test('multiline dictionaries resolve constant keys and path values with their key types', () => {
  const constants = scriptConstants(`
const Sounds: Dictionary[Variant, Variant] = {
  &"draw": BowSound,
  # Comment punctuation cannot close the dictionary: } ] "
  5: preload(
    Folder + "impact.wav", # One resource path.
  ),
  "5": "literal key",
  CueKey: { "region": Rect2i(-2.5, 3, 16, 8), "enabled": true },
}
const CueKey: StringName = &"release"
const BowSound := preload("res://audio/draw.wav")
const Folder = 'res://audio/'
`);

  assert.deepEqual(constants.names, ['Sounds', 'CueKey', 'BowSound', 'Folder']);
  assert.deepEqual(constants.value('Sounds'), new Map([
    ['draw', 'res://audio/draw.wav'],
    [5, 'res://audio/impact.wav'],
    ['5', 'literal key'],
    ['release', new Map([['region', [-2, 3, 16, 8]], ['enabled', true]])]
  ]));
  assert.equal(constants.value('BOWSOUND'), null);
});

test('multiline source text and local declarations cannot shadow script constants', () => {
  const constants = scriptConstants(`
var source = """
const CELL := Rect2(0, 0, 1, 1)
const PHANTOM := "not a declaration"
"""
func example():
  const CELL := Rect2(0, 0, 2, 2)
const CELL: Rect2 = Rect2(
  -1.5, # Crop origin.
  2.0,
  32.0,
  24.0
)
`);

  assert.deepEqual(constants.names, ['CELL']);
  assert.deepEqual(constants.value('CELL'), [-1.5, 2, 32, 24]);
});

test('unsupported syntax cannot yield a plausible scalar or partial collection', () => {
  const constants = scriptConstants(`
const INVERTED := ~4
const LOOKUP := { "draw": "res://audio/draw.wav", "release": load("res://audio/release.wav") }
const EXTERNAL_KEYS := { Rules.ID: "res://audio/draw.wav" }
const BRANCH := 1 if true else Rules.MAX
const SEPARATOR := ["a" "b"]
const BAD_ESCAPE := "\\q"
const WRONG_ARITY := Rect2(1, 2, 3)
const AFTER := "res://still-readable.png"
`);

  for (const name of ['INVERTED', 'LOOKUP', 'EXTERNAL_KEYS', 'BRANCH', 'SEPARATOR', 'BAD_ESCAPE', 'WRONG_ARITY']) {
    assert.equal(constants.value(name), null, name);
  }
  assert.equal(constants.value('AFTER'), 'res://still-readable.png');
});
