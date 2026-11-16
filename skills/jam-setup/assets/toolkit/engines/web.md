# A web runtime by hand (facts-only preset)

This preset states the glTF 2.0 specification's conventions, which three.js loads directly, and runs nothing. Each fact's source is listed in `web.json` under `facts.extra.sources`.

## Import

1. Deliver `.glb` (three.js recommends glTF): meters, +Y up, front toward +Z, right-handed.
2. Textures follow glTF: the normal map has +Y (green) up; occlusion, roughness and metalness are read from red, green and blue, so one packed ORM texture serves all three.
3. Serve the file from the site's static assets and load it with the runtime's glTF loader. There is no asset id beyond its URL.

Done when the model shows in the page at the size you delivered and you have recorded its path with a still as the step's evidence.

## Inspect

Read the bounds from the file (the POSITION accessors' `min` and `max`, with node transforms applied), or measure the loaded scene's bounding box in the runtime.

## Left out of the facts

- `contentRoot`, `assetId`, `collision`, `audio`, `naming`, `binaries`: neither the glTF specification nor the three.js documentation sets them; a project states its own under `engine.facts`.
- three.js states meters only for VR ("One Unit = One Meter"); elsewhere it says "world units". The 1 unit per meter here is glTF's.
