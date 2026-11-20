# Authoring recipes

A recipe is one JSON file: shipped ones in `tools/jam/recipes/`, the project's in `jam/recipes/<id>.json`. Read the shipped file a project recipe extends: it is the only place that lists each step's output roles (`produces`), which project checks refer to. `tools/jam/schemas/recipe.schema.json` validates a recipe in an editor, `tools/jam/schemas/jam.config.schema.json` the `checks` entries, and `jam recipe check` validates every recipe.

## How recipes resolve

- `"extends": "builtin:<id>"` (or a project recipe's id) inherits the base's steps. The file then lists only what differs.
- Steps merge by `id`. A step object in the child replaces the fields it names and keeps the rest, so a list field such as `checks` or `needs` is written out in full. `guide` is the exception: the project's notes are added in front of the base recipe's, and `jam run next` prints both (`guide`, then `then`).
- `title` and `when` are inherited when left out; `jam recipe new --extends` leaves them out. A recipe that extends nothing must write both.
- A new step goes at the end, or after the step named in `"after"`. `"remove": true` drops an inherited step.
- Order on screen is the order steps are offered; `needs` is what must be accepted (or skipped) first. Re-point the `needs` of the steps around anything you add or remove.

`jam recipe show <id>` prints the resolved steps and which file each gate came from.

## Fields

Recipe: `id`, `title`, `when` (which requests it is for; `jam recipe list` prints it, and it is how work gets routed, so write it for someone choosing between recipes), `description`, `extends`, `budget` (the default budget of its runs), `roots` (`scratch`, `delivered`, when not the project's), `style` (runs are bound to the style revision), `deliverable` (`false` for exploration and tests), `steps`.

| Step field | Meaning |
| --- | --- |
| `id`, `title` | Stable id (`a-z0-9-`) and a name a person reads |
| `skill` | The skill that knows how to do the step |
| `guide` | Document and `#anchor` with this step's notes in this recipe: a project path, or `toolkit:<path>` |
| `needs` | Steps that must be accepted first |
| `produces` | Outputs: `role`, `kind` (`image`, `model`, `audio`, `video`, `text`, `data`, `any`), and `min`/`max` or fixed `keys` |
| `checks` | Named checks that must pass when the step is recorded |
| `review` | `human`, `agent` (default) or `none` |
| `reviewer` | Who decides a `human` gate, as a person or role (`"art lead"`). Status, `run next` and review requests name them |
| `paid`, `maxJobs` | The step may open provider jobs; the most it may open in one run |
| `optional` | The step may be skipped with a reason |
| `when` | The step applies only when this holds: `{"engine": "<command>"}` (the engine adapter provides that command), `{"engine": "import", "kind": "<kind>"}` (and lists that kind among the command's `kinds`) or `{"budget": {"kind": "deforming"}}` (the run's budget has those values). Otherwise it is skipped automatically |
| `run` | A jam subcommand that does the step unattended, as an array of arguments (`["engine", "import", "--kind", "static", "--run", "{id}"]`); `{id}`, `{run}` and `{dir}` are substituted |
| `after`, `remove` | Placement and removal in an extending recipe |

## Worked example: a studio's prop recipe

A studio wants two things the shipped `prop` recipe does not have. An artist paints over the generated concept before any views are drawn, and that paint-over needs the art lead's approval. And the studio has a script that checks collision shapes cover the model.

**1. Scaffold.** Keeping the id `prop` means "run the prop recipe" picks up the studio's version.

```
jam recipe new prop --extends builtin:prop
```

**2. Add the check** to `jam.config.json` first, since `jam recipe check` refuses a recipe that names a check the project does not have:

```
jam config set checks.collision-covers '{"run": ["node", "tools/checks/collision.mjs", "{file:model}"], "description": "Collision shapes cover the model"}'
```

The command runs from the project root and gets project-relative paths: `{file:<role>}` is the one file recorded with that output role, `{files:<role>}` all of them; `{run}`, `{id}`, `{step}` and `{dir}` are substituted too. It exits 0 and prints one JSON object: `{"problems": []}` when the step passes, or problems as `{"message": "...", "fix": "..."}`. A problem refuses the record, and its message and fix are shown to whoever recorded. It runs when the step is recorded; `"when": "status"` also runs it on every status read, so keep such a check fast. Name it in lowercase with hyphens.

```js
// tools/checks/collision.mjs
import { readFileSync } from 'node:fs';
const [model] = process.argv.slice(2);
const problems = [];
if (!hasCollisionShapes(readFileSync(model))) {
  problems.push({ message: `${model}: no collision shapes`, fix: 'add at least one convex shape and record again' });
}
console.log(JSON.stringify({ problems }));
```

`hasCollisionShapes` is the studio's own test.

**3. Edit `jam/recipes/prop.json`.**

```json
{
  "$schema": "../../tools/jam/schemas/recipe.schema.json",
  "version": 1,
  "id": "prop",
  "title": "Static prop (studio)",
  "when": "An object that does not deform: furniture, tools, set dressing, pickups, set pieces.",
  "extends": "builtin:prop",
  "steps": [
    {
      "id": "paint-over",
      "title": "Artist paint-over of the concept",
      "after": "concept",
      "needs": ["concept"],
      "guide": "docs/art/props.md#paint-over",
      "produces": [{ "role": "paint-over", "kind": "image", "max": 1 }],
      "review": "human",
      "reviewer": "art lead"
    },
    { "id": "turnaround", "needs": ["paint-over"], "guide": "docs/art/props.md#turnaround" },
    { "id": "mesh", "review": "human" },
    { "id": "collision", "checks": ["budget-geometry", "collision-covers"] }
  ]
}
```

What each entry does:

- `paint-over` is new: placed after `concept`, needing it, with one image as output and a human gate. It names no skill because a person does it.
- `turnaround` now needs `paint-over` instead of `concept`, and adds the studio's notes in front of the shipped ones.
- `mesh` keeps everything and changes only its gate.
- `collision` keeps its inherited check and adds the studio's; its output role `model` is what `{file:model}` receives. The shipped step applies only when the engine adapter provides `import`; that condition is inherited.

**4. Write the guide.** `docs/art/props.md` has one heading per anchor used: what is particular about this step in this recipe. How to do the operation in general stays in the skill.

```markdown
## paint-over
Paint over the accepted concept at its original size. Keep the silhouette; fix material
breaks and add the wear the brief asks for.

## turnaround
Draw the views from the paint-over, not from the generated concept.
```

**5. Check and look.**

```
jam recipe check
jam recipe show prop
```

`show` lists `concept > paint-over > turnaround > mesh > ...`, with `paint-over` and `mesh` gated `human [project:prop]`. The next `jam run start prop <id> ...` follows it. Runs already started read the recipe file live, so a step added in front of recorded work shows as `ready` in them too.

## Capture what was just improvised

When work was done that no recipe describes (an existing recipe followed with steps skipped, added by hand, or recorded together), turn the run into a recipe:

```
jam recipe capture <run id> --as <new id>
```

It writes `jam/recipes/<new id>.json` with the steps the run recorded, in order, each with the outputs, checks and gate the run actually had and the title, skill and guide of the recipe it ran under. Then make it a recipe someone else can follow:

1. Write its `when` line and title.
2. Read each gate: the captured gate is whoever happened to accept that step. Set the one you want.
3. Add a `guide` for every step whose notes exist only in your head or the conversation.
4. `jam recipe check <new id>`.

A step the run needed but the base recipe lacks cannot be recorded until a recipe has it: add the step to a project recipe first, then record.

## Keeping recipes true

- A recipe that no longer matches practice gets ignored, and the next run is improvised again: change it with the practice.
- `jam recipe set` works on a project recipe you edited by hand too; it rewrites the file's formatting.
- After a toolkit upgrade, run `jam recipe check`: a shipped base may have gained or renamed a step your recipe refers to.
- Prefer `extends` to copying a shipped recipe whole, so improvements to the base arrive.
- How a game splits a character into parts and stitches them, fits outfits over a body, or names its files is a set of steps and guides in that game's recipe.
