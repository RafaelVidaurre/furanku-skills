# Style exploration

Finding a game's look through pictures: a short brief, rounds of images that each answer one question, and the person's choices recorded as they are made. Image rules shared with other skills are in [images.md](images.md); how to word questions is in [interaction.md](interaction.md).

The person contributes however they like: an attachment, a sentence, a game they admire, or "show me possibilities". Pictures come before definitions.

## The brief

Establish these from the project's notes, the conversation and any references before the first gameplay image. Ask only for what is missing, the game first.

- **Game:** what the player does. A sentence is enough.
- **Presentation:** 2D, 3D or a defined mix. A camera label, a style label or an engine does not settle it.
- **Camera rig:** the gameplay camera in physical terms: projection, position relative to the player (distance and height), pitch, field of view, where the player sits on screen, and the player's height as a share of the image with an upper limit. A label such as "third-person" only starts this. Propose a rig taken from real games of the genre and have it confirmed:

  > **Third-person, following the character. Shall I use this camera for every gameplay image?**
  >
  > - Camera about 3.5 to 4 m behind and 2 m above the player, tilted slightly down, 75° field of view.
  > - Player centred, full body, about a quarter of the image height, walking away from the camera; most of the frame shows the level.
  >
  > Closer or farther is fine. A screenshot of a game whose camera you like works too.

  Reuse the confirmed rig word for word in every gameplay prompt until the person changes it.
- **Subject:** a representative situation from this game: the player or units, their surroundings, an activity. Derive it from what is known; ask when choosing it would invent the game's setting.
- **Visual intent:** what the person means by their references or labels, and what they exclude. A label such as "anime" or "stylized" is enough to propose a comparison; ask what it means only when the answer would change that comparison.

Inspect every supplied reference: one may fix the camera, another the shapes, another the mood. A role the person gave ("use this camera") is an answer. Something you merely observe in an image is not yet a preference. Keep what the person decided, what you observed and what you propose apart, in the brief and in what you say.

Ready when you can say what the next pictures will help decide, what stays fixed and what varies.

## A round

1. **State the question** the round answers. Before a direction is chosen, compare visibly different overall treatments of the same scene: shapes and proportions, surfaces and shading, palette. After one is chosen, narrow to what is still open. Describe each option in observable terms; a style name alone does not define one.
2. **Read what was asked for.** Competing treatments, complementary situations in one style, and character or outfit studies are different assignments. A study keeps the framing the person asked for and does not inherit the gameplay camera; say what it can and cannot establish.
3. **Start a run** for the round so that the images, prompts, any paid job and the person's choice are on record: `jam run start image <round id> --brief <the round's brief>`. The brief holds the fixed choices with who decided them, what this round varies, the route and the count.
4. **Generate** as [images.md](images.md#a-round) and [style-images.md](style-images.md) say. Whether to start without asking is [task-intent.md](task-intent.md): a requested round runs; a round you are proposing is summarized in a few grouped lines and offered as "start" or "ask me more first".
5. **Inspect, then show** the originals with captions, and say plainly what each can and cannot establish.
6. **Record:** `jam run record <round id> concept --file <image> ... --evidence prompts=<file> --note "<the question and what varies>" --tool "<tool>"` (or `--job` for a paid result).

Routine details of composition are yours to choose; they are exploration, not new requirements of the game. Leave out invented jokes and story beats that would become the subject of the picture. Translate the game's mechanics into what is visible: a grid-based map is regular spacing, not drawn grid lines, unless lines were asked for.

Done when the person has seen every image of the round and the run holds them.

## Converge

Explain the differences that matter, recommend one direction with a reason tied to the game, and ask what to keep or change. The person may refine one, combine named parts, ask for fresh directions, add references or settle.

- "Refine B" keeps B's chosen qualities and explores narrower variations. It does not approve B as final.
- When the options were unhelpful, change the comparison, not the adjectives: find whether the trouble was off-brief content, options too alike, unreadable at gameplay size, or the wrong thing varied.
- A failed image does not redefine what the person likes. Keep model failures apart from their taste.

Record their decision in their words: `jam run review <round id> concept --accept --relay "<where they answered>: <their words>"`. Carry the still-valid choices and exclusions into the next round's brief.

Choosing a direction starts the library, it does not finish the style: continue with [style-library.md](style-library.md).
