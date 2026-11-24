// A small 2D Godot 4 project covering what the adapter reads: imported images, sounds and a model,
// SpriteFrames (atlas frames with margins, whole-image frames, an animation split across images), a
// scene with an AnimatedSprite2D, a script resource, an AtlasTexture, and the folders Godot skips.
import { glb, importFile, png, project, wav } from './support.mjs';

const SPRITE_FRAMES = `[gd_resource type="SpriteFrames" load_steps=6 format=3 uid="uid://heroframes"]

[ext_resource type="Texture2D" uid="uid://walkpng" path="res://old/place/walk.png" id="1_walk"]
[ext_resource type="Texture2D" path="res://sprites/hero/idle.png" id="2_idle"]

[sub_resource type="AtlasTexture" id="AtlasTexture_a"]
atlas = ExtResource("1_walk")
region = Rect2(0, 0, 30, 32)
margin = Rect2(1, 0, 2, 0)

[sub_resource type="AtlasTexture" id="AtlasTexture_b"]
atlas = ExtResource("1_walk")
region = Rect2(32, 0, 32, 32)

[resource]
animations = [{
"frames": [{
"duration": 1.0,
"texture": SubResource("AtlasTexture_a")
}, {
"duration": 1.0,
"texture": SubResource("AtlasTexture_b")
}],
"loop": true,
"name": &"walk",
"speed": 12.0
}, {
"frames": [{
"duration": 2.0,
"texture": ExtResource("2_idle")
}],
"loop": false,
"name": &"idle",
"speed": 4.0
}, {
"frames": [{
"duration": 1.0,
"texture": ExtResource("2_idle")
}, {
"duration": 1.0,
"texture": SubResource("AtlasTexture_b")
}],
"loop": true,
"name": &"mixed",
"speed": 5.0
}]
`;

const SCENE = `[gd_scene load_steps=5 format=3 uid="uid://heroscene"]

[ext_resource type="Script" uid="uid://herogd" path="res://scripts/hero.gd" id="1_script"]
[ext_resource type="Texture2D" uid="uid://walkpng" path="res://sprites/hero/walk.png" id="2_walk"]

[sub_resource type="AtlasTexture" id="AtlasTexture_x"]
atlas = ExtResource("2_walk")
region = Rect2(32, 0, 32, 32)

[sub_resource type="SpriteFrames" id="SpriteFrames_x"]
animations = [{
"frames": [{
"duration": 1.0,
"texture": SubResource("AtlasTexture_x")
}],
"loop": true,
"name": &"default",
"speed": 5.0
}]

[node name="Hero" type="CharacterBody2D" groups=["players", "saved"]]
script = ExtResource("1_script")

[node name="Sprite" type="AnimatedSprite2D" parent="."]
sprite_frames = SubResource("SpriteFrames_x")
animation = &"default"

[node name="Label" type="Label" parent="." groups=["ui"]]
text = "Hero \\"one\\""
`;

const SCRIPT = `class_name Hero
extends CharacterBody2D

const JUMP := preload("res://sfx/jump.wav")
const ICON_PATH := "res://ui/icon.tres"
const WALK_PATH := "res://sprites/hero/" + "walk.png"
var level_path := "res://levels/%s.tscn"

func _ready() -> void:
\tvar theme = load("res://music/theme.ogg")
\tvar folder = load("res://levels/")
`;

const ITEM = `[gd_resource type="Resource" script_class="Item" load_steps=2 format=3 uid="uid://sword"]

[ext_resource type="Script" path="res://scripts/item.gd" id="1_item"]

[resource]
script = ExtResource("1_item")
display_name = "Sword"
damage = 7
`;

const ICON = `[gd_resource type="AtlasTexture" load_steps=2 format=3]

[ext_resource type="Texture2D" uid="uid://walkpng" path="res://sprites/hero/walk.png" id="1"]

[resource]
atlas = ExtResource("1")
region = Rect2(0, 0, 16, 16)
`;

export const FILES = {
  'project.godot': 'config_version=5\n\n[application]\n\nconfig/name="Fixture"\nconfig/features=PackedStringArray("4.3")\n',
  'sprites/hero/walk.png': png(64, 32),
  'sprites/hero/walk.png.import': importFile('sprites/hero/walk.png', { uid: 'uid://walkpng' }),
  'sprites/hero/idle.png': png(16, 16),
  'sprites/hero/idle.png.import': importFile('sprites/hero/idle.png', { uid: 'uid://idlepng' }),
  'sprites/hero/hero_frames.tres': SPRITE_FRAMES,
  'sprites/hero/hero.tscn': SCENE,
  'scripts/hero.gd': SCRIPT,
  'scripts/hero.gd.uid': 'uid://herogd\n',
  'scripts/item.gd': 'class_name Item\nextends Resource\n\n@export var display_name: String\n@export var damage: int\n',
  'items/sword.tres': ITEM,
  'ui/icon.tres': ICON,
  'sfx/jump.wav': wav(0.5),
  'sfx/jump.wav.import': importFile('sfx/jump.wav', { importer: 'wav', type: 'AudioStreamWAV', uid: 'uid://jumpwav', params: 'force/mono=false\nedit/loop_mode=0\ncompress/mode=2\n' }),
  'music/theme.ogg': Buffer.from('not really vorbis'),
  'music/theme.ogg.import': importFile('music/theme.ogg', { importer: 'oggvorbisstr', type: 'AudioStreamOggVorbis', params: 'loop=true\nloop_offset=0.0\n' }),
  'models/crate.glb': glb(),
  'models/crate.glb.import': importFile('models/crate.glb', { importer: 'scene', type: 'PackedScene', params: 'nodes/root_type=""\n' }),
  'broken/bad.png': png(2, 2),
  'broken/bad.png.import': importFile('broken/bad.png', { valid: false }),
  'raw/data.png': png(2, 2),
  'raw/data.png.import': importFile('raw/data.png', { importer: 'skip', type: '' }),
  'addons/tool/plugin.gd': '@tool\nextends EditorPlugin\n',
  'notes/readme.md': '# not content\n',
  '.hidden/secret.tscn': SCENE,
  'ignored/.gdignore': '',
  'ignored/scene.tscn': SCENE,
  'nested/project.godot': 'config_version=5\n',
  'nested/other.tscn': SCENE
};

export const godotProject = (extra = {}, config) => project({ ...FILES, ...extra }, config);
