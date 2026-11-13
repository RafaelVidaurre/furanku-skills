"""charspec: the shipped example specs validate, and the scripts' structural rules hold."""
import copy
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import charspec  # noqa: E402

ASSETS = os.path.join(HERE, "..", "assets")


def example(name):
    with open(os.path.join(ASSETS, name), encoding="utf-8") as f:
        return json.load(f)


@pytest.mark.parametrize("name", ["character.example.json", "character.parts.example.json"])
def test_examples_validate(name):
    spec = charspec.Character(example(name))
    assert spec.part("body")


def test_single_mesh_needs_only_a_body():
    spec = charspec.Character({"version": 1, "name": "Golem", "heightMeters": 2.4, "parts": {"body": "Golem"},
                               "classes": {"stone": {"rgb": [120, 120, 120], "roughness": 0.9, "part": "body"}}})
    assert spec.present_parts() == ["Golem"] and spec.part("hair") is None and spec.fingers == 5


@pytest.mark.parametrize("change, message", [
    (lambda d: d["parts"].pop("body"), "parts.body"),
    (lambda d: d.update(name="not-pascal"), "PascalCase"),
    (lambda d: d["roles"].update(hair=None), "parts.hair needs roles.hair"),
    (lambda d: d["hands"].update(fingers=4), "hands.fingers"),
    (lambda d: d["classes"]["skin"].update(region="head"), "region was removed"),
    (lambda d: d["classes"]["skin"].update(metallic=2), "metallic must be 0-1"),
    (lambda d: d.update(maxInfluences=12), "maxInfluences"),
    (lambda d: d.update(repair={"everything": True}), "repair keys"),
])
def test_invalid_specs_are_refused(change, message):
    data = copy.deepcopy(example("character.parts.example.json"))
    change(data)
    with pytest.raises(charspec.SpecError, match=message):
        charspec.Character(data)


def test_explicit_window_wins_and_missing_window_is_derived():
    spec = charspec.Character(example("character.parts.example.json"))
    hair = spec.role_class("hair")
    assert spec.window(hair) == spec.classes[hair]["hsv"]
    r, g, b = (x / 255 for x in spec.classes[hair]["rgb"])
    assert spec.matches(hair, (r, g, b))


def test_defaults_are_conservative():
    spec = charspec.Character({"version": 1, "name": "Golem", "heightMeters": 2.4, "parts": {"body": "Golem"},
                               "classes": {"stone": {"rgb": [120, 120, 120], "roughness": 0.9, "part": "body"}}})
    assert spec.max_influences == 4 and spec.repair == {"hairline": False, "skinDarkSpots": False}
    assert spec.metallic("stone") == 0.0


def two_classes(red_window, blue_window=None):
    classes = {"red": {"rgb": [255, 0, 0], "roughness": 0.5, "part": "body", "hsv": red_window},
               "blue": {"rgb": [0, 0, 255], "roughness": 0.5, "part": "body"}}
    if blue_window:
        classes["blue"]["hsv"] = blue_window
    if red_window is None:
        del classes["red"]["hsv"]
    return charspec.Character({"version": 1, "name": "Probe", "heightMeters": 1.8, "parts": {"body": "Probe"}, "classes": classes})


def all_views(spec, rgb):
    """The class of one colour as every helper reports it: classify, belongs, label_map and class_mask."""
    import numpy as np
    px = np.array([[rgb]], dtype=np.float32)
    labels, names = spec.label_map(px)
    views = {"classify": spec.classify(rgb), "label_map": names[int(labels[0, 0])]}
    views["belongs"] = next(n for n in spec.classes if spec.belongs(n, rgb))
    views["class_mask"] = next(n for n in spec.classes if spec.class_mask(px, n)[0, 0])
    return views


def test_outside_every_window_falls_back_to_nearest_reference_everywhere():
    spec = two_classes({"value": [0.9, 1]})
    views = all_views(spec, (0.8, 0.0, 0.0))   # dark red: outside red's window, nearest to red
    assert set(views.values()) == {"red"}, views


def test_overlapping_windows_go_to_the_first_class_everywhere():
    spec = two_classes({"value": [0.0, 1.0]}, {"value": [0.0, 1.0]})
    views = all_views(spec, (0.1, 0.1, 0.9))   # blue, but red's window comes first and holds it
    assert set(views.values()) == {"red"}, views
    assert int(spec.class_mask(__import__("numpy").array([[(0.1, 0.1, 0.9)]]), "blue").sum()) == 0


def test_label_map_and_classify_agree_on_random_colours():
    import numpy as np
    spec = charspec.Character(example("character.example.json"))
    px = np.random.RandomState(7).rand(60, 60, 3).astype(np.float64)
    labels, names = spec.label_map(px)
    for y in range(0, 60, 3):
        for x in range(0, 60, 3):
            assert names[labels[y, x]] == spec.classify(tuple(px[y, x]))


def test_hair_role_without_a_hair_part_is_painted_hair():
    data = copy.deepcopy(example("character.example.json"))
    spec = charspec.Character(data)
    assert spec.part("hair") is None and spec.role_class("hair") == "hair" and spec.repair["hairline"]
