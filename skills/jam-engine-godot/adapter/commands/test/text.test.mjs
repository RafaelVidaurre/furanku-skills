import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGodotText, readResourceText } from '../godot/text.mjs';

test('values parse to JSON, constructors to { call, args }, and a value may span lines', () => {
  const [section] = parseGodotText(`[resource]
text = "say \\"hi\\"\\n\\u00e9"
name = &"walk"
path = ^"../Sprite"
n = -1.5e+02
flags = [true, false, null, inf, -inf]
rect = Rect2(1, 2, 3.5, 4)
frames = [{
"duration": 1.0,
"texture": SubResource("AtlasTexture_a")
}]
typed = Array[StringName]([&"a", &"b"])
map = Dictionary[String, int]({"x": 1})
strings = PackedStringArray("a", "b")
event = Object(InputEventKey,"resource_local_to_scene":false,"keycode":65)
metadata/speed = 140.0
0:0/0 = 0
`).slice(-1);
  const p = section.props;
  assert.equal(p.text, 'say "hi"\né');
  assert.deepEqual([p.name, p.path, p.n], ['walk', '../Sprite', -150]);
  assert.deepEqual(p.flags, [true, false, null, Infinity, -Infinity]);
  assert.deepEqual(p.rect, { call: 'Rect2', args: [1, 2, 3.5, 4] });
  assert.deepEqual(p.frames, [{ duration: 1, texture: { call: 'SubResource', args: ['AtlasTexture_a'] } }]);
  assert.deepEqual([p.typed, p.map], [['a', 'b'], { x: 1 }]);
  assert.deepEqual(p.strings, { call: 'PackedStringArray', args: ['a', 'b'] });
  assert.deepEqual(p.event.args, [{ call: 'InputEventKey', args: [] }, { key: 'resource_local_to_scene', value: false }, { key: 'keycode', value: 65 }]);
  assert.deepEqual([p['metadata/speed'], p['0:0/0']], [140, 0]);
});

test('a property that does not parse is kept raw and the rest of the file is still read', () => {
  const sections = parseGodotText('[remap]\n\nimporter="texture"\nodd = @@@ nonsense\ntype="CompressedTexture2D"\n; a comment\n[deps]\nsource_file="res://a.png"\n');
  assert.deepEqual(sections.map((section) => section.tag), ['remap', 'deps']);
  assert.deepEqual(sections[0].props, { importer: 'texture', odd: { raw: '@@@ nonsense' }, type: 'CompressedTexture2D' });
  assert.equal(sections[1].props.source_file, 'res://a.png');
});

test('a scene reads as its header, external and sub resources, and nodes', () => {
  const doc = readResourceText(`[gd_scene load_steps=2 format=3 uid="uid://abc"]

[ext_resource type="PackedScene" uid="uid://base" path="res://base.tscn" id="1_base"]

[sub_resource type="CircleShape2D" id="CircleShape2D_1"]
radius = 4.0

[node name="Root" instance=ExtResource("1_base")]

[node name="Shape" type="CollisionShape2D" parent="." groups=["hit"]]
shape = SubResource("CircleShape2D_1")
`);
  assert.deepEqual(doc.header.attrs, { load_steps: 2, format: 3, uid: 'uid://abc' });
  assert.deepEqual(doc.external.get('1_base'), { type: 'PackedScene', path: 'res://base.tscn', uid: 'uid://base' });
  assert.equal(doc.sub.get('CircleShape2D_1').props.radius, 4);
  assert.deepEqual(doc.nodes.map((node) => [node.name, node.type, node.parent]), [['Root', undefined, undefined], ['Shape', 'CollisionShape2D', '.']]);
  assert.deepEqual(doc.nodes[0].instance, { call: 'ExtResource', args: ['1_base'] });
  assert.deepEqual(doc.nodes[1].groups, ['hit']);
});
