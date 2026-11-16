# Gameplay images that read as the game

For style rounds and library shots that show the game in play. The goal of each is a picture the person would believe is a screenshot of their game. The words "gameplay screenshot" do not produce one; a physical camera, a populated level and real-time rendering cues do. Rules for every image round are in [images.md](images.md); a study with its own framing (a character facing the camera, a material close-up) follows the person's request instead and is labelled a study.

## Build the prompt in this order

1. **Frame.** One full-screen gameplay screenshot of a game in play, in the agreed presentation and aspect ratio. No interface, labels or text; an interface is a separate decision and never repairs a wrong camera.
2. **Camera rig**, copied from the brief in physical terms. Third-person reads like: camera about 3.5 to 4 m behind and 2 m above the player, slight downward pitch, about 75° field of view, player horizontally centred, full body with feet in the lower third, about 25% of image height and never over 30%, most of the frame showing the level. Overhead gives projection, height or pitch, and unit size (each unit about 5% of image width). The rig, aspect ratio and actor scale stay fixed across style options; only a camera comparison varies them.
3. **Player and activity.** The player doing the game's common verb, for a third-person walker usually mid-stride away from the camera with a neutral face, the destination readable at this size.
4. **A level in play.** Modular architecture, plenty of props and set dressing, and where the game has them several characters going about their own business, with walkable space and the world continuing past every edge. For a bounded arena or board, its real playable limits. A sparse stage with a few posed figures reads as a diorama.
5. **How a real-time engine draws it.** Game-ready models with limited polygons and simplified silhouettes, hair and cloth modelled into the mesh, simple skin shading; modular environment pieces, tiling textures, less detail in the distance; one directional key light, crisp shadows, flat ambient, screen-space ambient occlusion, neutral exposure, everything in focus.
6. **The option's treatment**, as visible properties: silhouette and proportions, surfaces, shading, palette, detail density. Everything above stays identical between options.
7. **A few exclusions** for failures you have seen.

Those numbers are one game's rig. Every game's come from its own confirmed camera.

## What the evidence showed

- **Image models enlarge the player.** Distance words ("usual gameplay distance", "small") gave players at 76 to 88% of image height. A physical rig with a field of view, a "never over" limit and "most of the frame shows the level" gave 41 to 58%, which was accepted. Ask for the low end of the agreed range and judge against the range.
- **Film and painting words pull toward film stills**: "cinematic", "painterly", "feature-animation", "studio lighting", "atmospheric". Express a treatment as model, material and lighting properties.
- **Production terms are read literally.** "Low-poly" from a game team usually means limited-polygon, smoothly shaded game models. Prompting "visible flat polygon facets" produced faceted art the person rejected as far too geometric. Translate the term into its result in a shipped game; ask when two readings would give different pictures.
- **Words that get drawn**: grid, tile, miniature, board, hero shot. Describe the intended result instead.
- **Props and busy characters** were what made a frame read as a level.

An approved third-person prompt, abridged, as a shape to follow:

> Generate exactly one landscape 16:9 image: a credible real-time third-person 3D gameplay screenshot in a populated market level, no HUD. Input image 1 is IDENTITY ONLY: preserve the face shape, hair and build; ignore the clothes, smile, pose, setting, framing and glossy rendering. The player walks away up the street mid-stride with his back to the camera, never looking at it. Horizontally centre his full body at approximately 25% of frame height, never over 30%, feet in the lower third. Camera approximately 3.5 to 4 metres behind him, 2 metres above ground, slight downward pitch, 75-degree field of view, showing extensive level ahead and around him. Houses, stalls, carts, barrels, crates, and several townsfolk shopping and walking. Game-ready models with limited polygons, simplified silhouettes, solid sculpted hair, modelled cloth and simple skin shading. Modular environment geometry and tiling textures. Daylight directional lighting, crisp shadow maps, flat ambient and screen-space ambient occlusion, neutral exposure, everything in focus. No text, UI, photorealism, posing, illustration, cinematic lighting, depth of field, bloom or film grading.

## Inspect a gameplay image

Besides the checks in [images.md](images.md#inspect-before-showing):

- **Measure** the player's height as a share of image height (feet to top of head) and its horizontal position, and write both against the rig's range in the round's evidence.
- **Ask whether a player would believe it**: camera height and pitch, a populated level, real-time rather than film rendering, a readable play space and activity.
- A handsome diorama, poster or close-up that misses the frame cannot establish gameplay readability. Say so when showing it.

Judge by the decision the round serves: wrong actor scale invalidates a readability test; incidental set dressing does not, unless it changes the premise or steals the picture.

## When the camera keeps failing

After two misses of the same scale or camera requirement, change the strategy before spending more: cut competing detail from the prompt, describe how much foreground and surrounding space is visible, or attach a reference for camera and layout only. No strategy is guaranteed; when the model still misses, report the limit and keep the useful treatment findings apart from it.
