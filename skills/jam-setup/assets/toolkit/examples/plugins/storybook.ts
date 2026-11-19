// An example catalog plugin that uses every extension point. It catalogs a small story: scenes and
// the characters in them, read from two JSON files, with caption files as a media kind of its own.
//
// To use it in a project, copy this file (with storyboard.mjs and storybook.web.js) into the
// project, for example to catalog/storybook.ts, point the import below at the toolkit's stable
// entry (`../tools/jam/catalog-plugin.ts`), and list it in catalog.config.json:
//
//   { "version": 3,
//     "plugins": [{ "plugin": "./catalog/storybook.ts", "options": { "folder": "story" } }],
//     "review": { "resolver": "human-first" } }
//
// Project files it reads (all under the `folder` option, default "story"):
//   scenes.json      [{ "id", "title", "summary?", "characters": ["id"], "image?", "captions?" }]
//   characters.json  [{ "id", "name", "portrait?" }]
//   order.json       ["scene id", …]   the running order; the doctor check keeps it complete
import { type CheckProblem, defineAction, definePlugin, defineSource, defineType, Effect, optional, type PluginContext, Schema, type UnitInput } from "../../catalog-plugin.ts"

interface Scene {
  readonly id: string
  readonly title: string
  readonly summary?: string
  readonly characters?: ReadonlyArray<string>
  readonly image?: string
  readonly captions?: string
}
interface Character {
  readonly id: string
  readonly name: string
  readonly portrait?: string
}

const folder = (context: PluginContext): string => (typeof context.options["folder"] === "string" ? context.options["folder"] : "story")
const readList = async <A>(context: PluginContext, file: string): Promise<ReadonlyArray<A>> => {
  const path = `${folder(context)}/${file}`
  return (await context.files.exists(path)) ? ((await context.files.readJson(path)) as ReadonlyArray<A>) : []
}
const sceneUnit = (scene: Scene, file: string): UnitInput => ({
  id: `scene/${scene.id}`,
  type: "scene",
  name: scene.title,
  attrs: { summary: scene.summary ?? "", characters: (scene.characters ?? []).map((id) => `character/${id}`) },
  links: [
    ...(scene.image ? [{ role: "image", asset: scene.image }] : []),
    // `meta` carries per-link data the viewer may show; it is never part of a verdict.
    ...(scene.captions ? [{ role: "captions", asset: scene.captions, meta: { language: "en" } }] : [])
  ],
  sources: [file]
})

/** The start time, in seconds, of each cue in a WebVTT file. */
const cueStarts = (text: string): Array<number> =>
  [...text.matchAll(/^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3}) -->/gm)].map((m) => Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000)

export default definePlugin({
  name: "storybook",

  // Two top-level groups instead of the default main/material split.
  scopes: [
    { id: "story", label: "Story", description: "Scenes in running order" },
    { id: "cast", label: "Cast", description: "Characters that appear in scenes" }
  ],

  // Each source is reloaded only when one of its own inputs changed.
  sources: [
    defineSource({
      name: "scenes",
      inputs: (context) => [`${folder(context)}/scenes.json`],
      load: async (context) => ({
        project: "Storybook",
        assetRoots: [folder(context)],
        types: {
          scene: defineType({
            label: "Scene",
            scope: "story",
            fields: [{ key: "summary", label: "Summary" }, { key: "characters", label: "Characters", kind: "refs" }, { key: "position", label: "Position", derived: true }],
            roles: [{ key: "image", label: "Image", mediaKinds: ["image"], expected: true }, { key: "captions", label: "Captions", mediaKinds: ["captions"] }],
            // Browser modules mounted per scene: an inspector in its media strip and a sidebar section.
            inspectors: [{ key: "beats", label: "Beats", module: "storybook", export: "beats", help: "The scene's cast; highlight one" }],
            panels: [{ key: "placement", label: "Running order", module: "storybook", export: "placement" }]
          })
        },
        units: (await readList<Scene>(context, "scenes.json")).map((scene) => sceneUnit(scene, `${folder(context)}/scenes.json`))
      })
    }),
    defineSource({
      name: "characters",
      inputs: (context) => [`${folder(context)}/characters.json`],
      load: async (context) => ({
        types: { character: { label: "Character", scope: "cast", fields: [], roles: [{ key: "portrait", label: "Portrait", mediaKinds: ["image"] }] } },
        units: (await readList<Character>(context, "characters.json")).map((character): UnitInput => ({
          id: `character/${character.id}`,
          type: "character",
          name: character.name,
          links: character.portrait ? [{ role: "portrait", asset: character.portrait }] : [],
          sources: [`${folder(context)}/characters.json`]
        }))
      })
    })
  ],

  // After the sources merge: file every unit under a category and number the scenes. `position`
  // is a derived field, so reordering scenes does not mark their verdicts as changed.
  enrich: (merged) => ({
    units: Object.fromEntries(merged.units.map((unit, index) => [unit.id, {
      category: unit.type === "scene" ? "Story/Scenes" : "Story/Cast",
      ...(unit.type === "scene" ? { attrs: { ...unit.attrs, position: index + 1 } } : {})
    }]))
  }),

  // One direction is declared; `unit.get` of a character lists the scenes it appears in.
  relations: [{
    name: "cast",
    label: "Characters",
    inverseLabel: "Appears in",
    from: (unit) => (unit.type === "scene" && Array.isArray(unit.attrs["characters"]) ? (unit.attrs["characters"] as ReadonlyArray<string>) : [])
  }],

  // A media kind is recognised by its first bytes, never by its extension.
  mediaKinds: [{
    id: "captions",
    label: "Captions",
    extensions: ["vtt"],
    sniff: (head) => (Buffer.from(head.subarray(0, 6)).toString("latin1") === "WEBVTT" ? "text/vtt" : null)
  }],

  // Measured once per file version and cached by the file's SHA-256. This one returns an Effect.
  probes: [{
    name: "captions",
    version: "1",
    mediaKinds: ["captions"],
    fields: [{ key: "cues", label: "Cues" }, { key: "lastCue", label: "Last cue starts", unit: "s" }],
    measure: (file, context) =>
      Effect.map(Effect.promise(() => context.files.readText(file.path)), (text) => {
        const starts = cueStarts(text)
        return { cues: starts.length, lastCue: starts.at(-1) ?? 0 }
      })
  }],

  // `jam catalog doctor` runs these; a fix with `apply` runs only with --fix.
  checks: [{
    name: "running-order",
    label: "Scenes missing from the running order",
    run: async (context): Promise<ReadonlyArray<CheckProblem>> => {
      const path = `${folder(context)}/order.json`
      const order = await readList<string>(context, "order.json")
      const scenes = await readList<Scene>(context, "scenes.json")
      return scenes.filter((scene) => !order.includes(scene.id)).map((scene) => ({
        subject: scene.id,
        message: `scene ${scene.id} is not in ${path}`,
        fix: {
          label: `append it to ${path}`,
          // Each fix reads the file again, so several fixes in one run add to each other.
          apply: async () => {
            const { writeFile } = await import("node:fs/promises")
            const current = await readList<string>(context, "order.json")
            await writeFile(`${context.root}/${path}`, `${JSON.stringify([...current, scene.id], null, 2)}\n`)
          }
        }
      }))
    }
  }],

  // Project actions join the same registry as built-in ones: listed by `jam catalog actions`,
  // inputs checked against their schema, writes attributed and repeatable by request id.
  actions: [
    defineAction({
      name: "storybook.outline",
      access: "read",
      description: "Scenes in running order with their characters; optionally only those a character appears in",
      input: Schema.Struct({ character: optional(Schema.String) }),
      // Published as the action's output; the tests decode every result against it.
      output: Schema.Struct({ scenes: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String, characters: Schema.Array(Schema.String) })) }),
      run: async (input, context) => {
        const order = await readList<string>(context, "order.json")
        const scenes = await readList<Scene>(context, "scenes.json")
        const position = (scene: Scene): number => (order.includes(scene.id) ? order.indexOf(scene.id) : order.length)
        return {
          scenes: [...scenes]
            .filter((scene) => input.character == null || (scene.characters ?? []).includes(input.character))
            .sort((a, b) => position(a) - position(b))
            .map((scene) => ({ id: scene.id, title: scene.title, characters: scene.characters ?? [] }))
        }
      }
    }),
    defineAction({
      name: "storybook.flag",
      access: "write",
      description: "Leave a note on a scene for whoever edits it next",
      input: Schema.Struct({ scene: Schema.String, reason: Schema.String }),
      // A write goes through the catalog's own actions, so the note is a normal catalog record. Its
      // context has the declared actor (a read's has none).
      run: (input, context) => context.run("note.create", { target: { kind: "unit", id: `scene/${input.scene}` }, body: `Flagged by ${context.actor.name}: ${input.reason}` })
    })
  ],

  // Selected with "review": { "resolver": "human-first" }: an agent's verdict never overrides a person's.
  resolvers: {
    "human-first": (decisions) => decisions.findLast((decision) => decision.by.kind === "human") ?? decisions.at(-1) ?? null
  },

  // Browser modules for the page, in one namespace: a collection preview a collection kind can name
  // (`preview.module`), a project file; and the module of the scene type's inspectors and panels,
  // which ships beside this plugin wherever it is installed, so it is declared as a file: URL.
  browserModules: {
    storyboard: "catalog/storyboard.mjs",
    storybook: new URL("./storybook.web.js", import.meta.url).href
  }
})
