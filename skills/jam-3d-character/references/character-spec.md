# Character spec (`character.json`)

Everything the character scripts need to know about one body lives in its `character.json`; no script carries a character's names, colours, sizes or proportions. Every script that needs such a fact takes `--character <character.json>` among its arguments after `--`. Outfits pass their **body's** spec. Validate a spec with `node tools/jam/jam.mjs python <S>/charspec.py <character.json>`.

Write it at the start of a new body, in the run folder, from the brief and the accepted concept and turnaround; refine the colours once the generated texture exists; deliver it in the body's revision folder (its README names it beside the joints, modelled and rigged files). [`assets/character.example.json`](../assets/character.example.json) is a one-mesh spec for the first body built with these scripts (a 1.83 m adult in a T-shirt, trousers and shoes); [`assets/character.parts.example.json`](../assets/character.parts.example.json) is the same body with swappable head, hair, body and hands. Their `hsv` windows were read off that body's texture.

## Fields

| Field | Meaning |
| --- | --- |
| `version` | `1` |
| `name` | PascalCase asset name, used for maps (`T_<name>_<Part>_*`), materials and Unreal assets |
| `heightMeters` | Final standing height: the rig stands at it, Meshy's rigging is run with it, and every length in the scripts (millimetres of the real character) is converted to model units through it |
| `parts` | Blender object name per part role: `body` (required: the character mesh, body and clothing; on its own, the whole character), and for swappable parts `head`, `hair` and `hands` (split off the body at the wrists after rigging). A role set to `null` or left out does not exist: a one-mesh character has `body` alone; `hair: null` for a bald, helmeted or painted-hair head |
| `classes` | Materials the scripts tell apart by the generated base colour: `rgb` reference colour (0–255, the colour the bake corrects toward), `roughness`, `metallic` (0–1, default 0; 1 for metal), `part` (which part role the class belongs to), optional `hsv` window (`hue` [from, to] degrees, wrapping through 0 when from > to; `saturation` and `value` [min, max] in 0–1). Classes say nothing about anatomy: head, limbs, hands and feet come from the joints, so a helmet and gloves of the same colour, a robe or a one-colour creature need no special classes |
| `roles` | Which class plays each structural role: `skin` (bare skin on head, arms and legs, the scalp colour, the reference for texture cleanup), `hair` (finds the hair part; required with a hair part), `neckline` (the garment whose top border becomes the head/body border, with swappable parts), `footwear` (the footwear class). `null` when the character has none |
| `maxInfluences` | Bone influences per vertex (1–8, default 4): take it from the project profile's `maxInfluences` |
| `repair` | Opt-in texture repairs, both off by default: `hairline` (pale outline or stray colour along the hair class's border; needs `roles.hair`), `skinDarkSpots` (dark projection specks on bare skin; needs `roles.skin`). Turn one on only after seeing that defect; the bake reports every repaired texel and saves before/after images |
| `hairMinHeightShare` | Hair is searched above this share of the height (default 0.8) |
| `neckHeightShare` | With a separate head but no neckline garment (a bare neck and chest), the head/body border is cut at this share of the height |
| `textureSizes` | Map size per part role (defaults: head 1024, hair 1024, body 2048, hands 1024) |
| `hands.fingers` | `5` for separate, posable fingers; `0` for mittens (the hand is weighted to `hand_*` alone and the finger repair step is skipped) |
| `hands.cleanSide` | `left` or `right` when one generated hand is clean and is mirrored onto the other; `none` to keep both as generated |
| `hands.fanDegrees` | Turn of each finger about its root in the finger repair step (positive toward the thumb) |

## How colours are read

A colour belongs to the first class whose `hsv` window holds it; otherwise to the class whose `rgb` is nearest, measured mostly by hue and saturation and only a quarter by brightness, so a garment in shadow stays in its class. Where a script needs one class's window and the class has none (outfit hat-hair and hair-colour tests), it uses a window around `rgb`: hue within 20°, saturation and value within 0.25.

## Choosing the colours

Sample each class's `rgb` from a clean, evenly lit area of the generated base-colour texture (or the accepted turnaround when no texture exists yet). Add an `hsv` window when two classes are close in colour (blond hair against tanned skin, dark hair against dark shoes) or when one class varies widely (a patterned shirt). Check the result with `node tools/jam/jam.mjs blender <S>/blender/preview_classes.py` before baking (body.md step 6): a class that took faces from its neighbour needs its colour resampled or its window tightened. Names of classes are free; only `roles` and `part` carry meaning to the scripts. Where windows overlap, the first class in spec order wins, so list the narrower class first.
