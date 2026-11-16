// Create the Hollowmere sample project: a separate Git repository with manifest content,
// procedural art, two art passes, catalog records made through the public actions, and some
// uncommitted work. For acceptance testing and demonstration only.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs"
import * as nodePath from "node:path"
import { Catalog } from "../../src/catalog/Catalog.ts"
import { launchBrowser } from "../../src/catalog/server/browser.ts"
import { attempt, attemptPromise, fail, type ToolError } from "../../src/kernel/errors.ts"
import { Git } from "../../src/kernel/Git.ts"
import { Ids } from "../../src/kernel/Ids.ts"
import { Process } from "../../src/kernel/Process.ts"
import { ProjectFiles } from "../../src/kernel/ProjectFiles.ts"
import type { RenderJob } from "./art.mjs"
import { assets, collections, type SampleAsset, type SampleUnit, schema, units } from "./data.ts"

export interface SampleSummary {
  /** The absolute folder of the new project. */
  readonly created: string
  readonly units: number
  readonly collections: number
  readonly assets: number
  readonly submissions: number
  readonly openNotes: number
  /** Whether the video clips were made (asked for, and ffmpeg is installed). */
  readonly videos: boolean
}

type Art = typeof import("./art.mjs")
type Browser = Parameters<Art["renderAssets"]>[2]
type Actor = { readonly name: string; readonly kind: "human" | "agent" }
type Target = { readonly kind: "unit" | "collection" | "asset"; readonly id: string }

const mika: Actor = { name: "Mika Sato", kind: "human" }
const ana: Actor = { name: "Ana Ruiz", kind: "human" }
const jules: Actor = { name: "Jules Okafor", kind: "human" }
const bot: Actor = { name: "art-check", kind: "agent" }

// The commits carry their own identity, so the machine's Git configuration is not needed.
const GIT_IDENTITY = ["-c", "user.name=Hollowmere Dev", "-c", "user.email=dev@hollowmere.invalid", "-c", "commit.gpgsign=false"]

const unit = (id: string): Target => ({ kind: "unit", id })
const collection = (id: string): Target => ({ kind: "collection", id })
const unitNamed = (id: string): SampleUnit => units.find((entry) => entry.id === id)!

/** The files one art pass draws: every asset first, then only the assets that have a later revision. */
const artPass = (media: ReadonlyArray<SampleAsset>, index: number): Array<RenderJob> =>
  media.flatMap((asset) => {
    const spec = asset.versions[index]
    return spec === undefined ? [] : [{ path: asset.id, spec }]
  })

/** The absolute form of the folder, refusing one that already holds something. */
const emptyFolder = (dir: string): Effect.Effect<string, ToolError> =>
  Effect.flatMap(
    attempt(`read ${dir}`, () => {
      const full = nodePath.resolve(dir)
      return { full, free: !existsSync(full) || (statSync(full).isDirectory() && readdirSync(full).length === 0) }
    }),
    ({ free, full }) =>
      free ? Effect.succeed(full) : fail("invalid", `${full} is not empty`, { fix: "name a folder that does not exist yet, or an empty one" })
  )

/** Everything the sample is made of, written into the project the services are opened on. */
const build = (art: Art, browser: Browser, videos: boolean): Effect.Effect<SampleSummary, ToolError, Catalog | ProjectFiles | Process> =>
  Effect.gen(function*() {
    const catalog = yield* Catalog
    const files = yield* ProjectFiles
    const proc = yield* Process
    const root = files.root
    const git = (...args: ReadonlyArray<string>) => proc.text("git", [...GIT_IDENTITY, ...args], { cwd: root })
    // Without clips the project has no video media at all: a part whose file was never made
    // cannot be submitted for review, and neither can a collection with such a member.
    const media = videos ? assets : assets.filter((asset) => asset.kind !== "video")
    const drawn = new Set(media.map((asset) => asset.id))
    const unitFile = (entry: SampleUnit, attrs: SampleUnit["attrs"] = entry.attrs) =>
      files.writeJson(`content/${entry.type}/${entry.id.split("/").pop()}.json`, {
        id: entry.id,
        type: entry.type,
        name: entry.name,
        attrs,
        links: entry.links.filter((link) => drawn.has(link.asset)),
        tags: entry.tags,
        category: entry.category
      })

    // ---- Project files (what a real project would already version)
    yield* files.writeJson("catalog.config.json", {
      version: 2,
      plugins: ["manifest"],
      options: { manifest: { file: "catalog.manifest.json" } },
      review: { resolver: "latest" }
    })
    yield* files.writeJson("catalog.manifest.json", {
      version: 1,
      project: schema.project,
      assetRoots: ["art"],
      types: schema.types,
      collectionKinds: schema.collectionKinds,
      assets: media.map((asset) => ({
        id: asset.id,
        path: asset.id,
        kind: asset.kind,
        ...(asset.tags ? { tags: asset.tags } : {}),
        ...(asset.category ? { category: asset.category } : {})
      })),
      unitFiles: ["content"],
      collections: collections.filter((entry) => entry.kind === "armor-set")
    })
    // The helm starts weaker; art pass 2 brings it to its final armor.
    for (const entry of units) yield* unitFile(entry, entry.id === "gear/ironclad-helm" ? { ...entry.attrs, armor: 16 } : entry.attrs)
    yield* files.writeText(".gitattributes", "*.png binary\n*.glb binary\n*.mp4 binary\n")

    const render = (pass: number) => attemptPromise(`draw the sample art (pass ${pass + 1})`, () => art.renderAssets(artPass(media, pass), root, browser, { videos }))

    yield* render(0)
    yield* git("init", "-q", "-b", "main")
    yield* git("add", "-A")
    yield* git("commit", "-q", "-m", "Initial content")

    // ---- Catalog work through the public actions
    let requests = 0
    const act = (actor: Actor, name: string, input: unknown) => catalog.run(name, input, { actor, requestId: `sample-${++requests}` })
    /** Submit for review; gives the submission id and the ids of its items, in order. */
    const submit = (actor: Actor, input: unknown) =>
      Effect.gen(function*() {
        const { submission } = (yield* act(actor, "review.submit", input)) as { readonly submission: { readonly id: string } }
        const review = (yield* catalog.run("review.get", { submission: submission.id })) as { readonly id: string; readonly items: ReadonlyArray<{ readonly id: string }> }
        return { id: review.id, items: review.items.map((item) => item.id) }
      })
    const decide = (actor: Actor, review: { readonly id: string; readonly items: ReadonlyArray<string> }, decision: Record<string, unknown>) =>
      act(actor, "review.decide", { submission: review.id, item: review.items[0], ...decision })
    const note = (actor: Actor, target: Target & { readonly part?: string }, body: string) =>
      Effect.map(act(actor, "note.create", { target, body }), (created) => (created as { readonly note: { readonly id: string } }).note.id)

    for (const entry of collections.filter((candidate) => candidate.kind !== "armor-set")) {
      yield* act(entry.kind ? jules : mika, "collection.create", {
        id: entry.id,
        name: entry.name,
        ...(entry.kind === undefined ? {} : { kind: entry.kind }),
        category: entry.category,
        tags: entry.tags,
        members: entry.members.map((member) => ({ ...member }))
      })
    }
    yield* act(mika, "category.create", { path: "Milestones/Beta" })
    yield* act(ana, "organize.bulk", { targets: ["gear/ironclad-greaves", "gear/ashen-sabatons", "creature/stone-warden"].map(unit), addTags: ["needs-art"] })

    const helm = yield* submit(mika, { title: "Ironclad Helm first pass", items: [{ target: unit("gear/ironclad-helm") }] })
    yield* decide(mika, helm, { whole: "approved" })

    const ironclad = yield* submit(mika, { title: "Ironclad Set", items: [{ target: collection("set/ironclad") }] })
    yield* decide(mika, ironclad, { whole: "approved", exceptions: { "member:gear/ironclad-greaves": "changes" }, comment: "Greaves are too bulky next to the cuirass." })

    const mire = yield* submit(jules, { title: "Mire creatures", items: [{ target: unit("creature/mire-lurker") }, { target: unit("creature/bog-toad") }, { target: collection("enc/mire-ambush") }] })
    yield* decide(bot, mire, { verdicts: { portrait: "approved", model: "approved" }, comment: "Portrait 512×512 and model within the creature budget." })
    yield* decide(jules, mire, { verdicts: { portrait: "changes" }, comment: "Eyes need to read from across the swamp." })

    const ember = yield* submit(ana, { title: "Ember Burst", items: [{ target: unit("ability/ember-burst") }] })
    // The effect clip has a story of its own (changes asked, retimed, approved); it needs the clip.
    yield* decide(ana, ember, videos ? { whole: "approved", exceptions: { vfx: "changes" }, comment: "Burst is too slow for an 8 s cooldown." } : { whole: "approved" })
    const effectNote = videos ? yield* note(ana, { ...unit("ability/ember-burst"), part: "vfx" }, "Needs a faster start.") : null

    const rations = yield* submit(jules, { title: "Rations", items: [{ target: unit("consumable/trail-ration") }, { target: unit("consumable/stale-ration") }] })
    yield* decide(jules, rations, { whole: "approved" })

    const wayfarer = yield* submit(ana, { title: "Wayfarer Set", items: [{ target: collection("set/wayfarer") }] })
    yield* decide(ana, wayfarer, { verdicts: { "member:gear/wayfarer-hood": "approved" } })

    yield* note(ana, { kind: "asset", id: "art/concepts/ironclad_sheet.png" }, "Sheet still shows the old rivet pattern on the gauntlets.")
    yield* note(jules, collection("enc/lurker-den"), "Four lurkers plus the matriarch overwhelms a tier 2 player.")
    yield* note(mika, unit("creature/stone-warden"), "Model is scheduled after the highlands blockout.")
    yield* note(bot, unit("consumable/stale-ration"), "Shares its icon with Trail Ration. Players may not tell them apart in the inventory.")

    // ---- Art pass 2 (second commit)
    yield* render(1)
    yield* unitFile(unitNamed("gear/ironclad-helm"))
    yield* git("add", "-A", "--", "art", "content")
    yield* git("commit", "-q", "-m", "Art pass 2: helm crest, slimmer greaves, faster ember burst")

    const crest = yield* submit(ana, {
      title: "Helm crest",
      items: [{
        target: unit("gear/ironclad-helm"),
        parts: ["model"],
        views: [
          { part: "model", caption: "Ironclad Helm · crest, front" },
          { part: "model", caption: "Ironclad Helm · crest, side", camera: { position: [0.9, 1.75, 0], target: [0, 1.62, 0] } }
        ]
      }]
    })
    yield* decide(ana, crest, { verdicts: { model: "changes" }, comment: "Crest breaks the silhouette at gameplay distance. Try a lower fin." })
    if (effectNote !== null) {
      const retime = yield* submit(mika, { title: "Ember Burst retime", items: [{ target: unit("ability/ember-burst"), parts: ["vfx"] }], supersedes: ember.id })
      yield* decide(mika, retime, { verdicts: { vfx: "approved" } })
      yield* act(mika, "note.resolve", { id: effectNote, explanation: "Retimed in art pass 2." })
    }
    yield* note(mika, { ...unit("gear/ironclad-greaves"), part: "icon" }, "No icon yet. Placeholder from the cuirass is fine for now.")
    yield* git("add", "-A", "--", ".catalog")
    yield* git("commit", "-q", "-m", "Catalog review records")

    // ---- Uncommitted work
    const frost = unitNamed("ability/frost-lance")
    yield* unitFile(frost, { ...frost.attrs, damage: 35 })
    yield* act(jules, "review.submit", { title: "Frost Lance balance", items: [{ target: unit("ability/frost-lance") }] })
    yield* note(jules, unit("ability/frost-lance"), "Damage bump needs a matching effect pass.")

    const { counts } = (yield* catalog.run("context", {})) as { readonly counts: Omit<SampleSummary, "created" | "videos"> }
    return { created: root, units: counts.units, collections: counts.collections, assets: counts.assets, submissions: counts.submissions, openNotes: counts.openNotes, videos }
  })

/**
 * Create the sample project in `dir`, which must not exist yet or be empty (a relative path is
 * taken from the current folder). Video clips need ffmpeg: they are left out when `videos` is
 * false or ffmpeg is not installed, and the summary says which. The project gets a catalog of its
 * own, opened and closed here; nothing of the caller's project is read or changed.
 */
export const createSample = (dir: string, options: { readonly videos: boolean }): Effect.Effect<SampleSummary, ToolError> =>
  Effect.gen(function*() {
    const full = yield* emptyFolder(dir)
    const art = yield* attemptPromise("load the sample art generator", () => import("./art.mjs"), "unavailable")
    const videos = options.videos && art.hasFfmpeg()
    // What the sample cannot be made without is checked before the folder is touched.
    const browser = yield* Effect.acquireRelease(launchBrowser(), (opened) => Effect.promise(() => opened.close().catch(() => undefined)))
    yield* Process.use((proc) => proc.text("git", ["--version"])).pipe(Effect.provide(Process.layer))
    const root = yield* attempt(`create ${full}`, () => {
      mkdirSync(full, { recursive: true })
      return realpathSync(full)
    })
    const kernel = Layer.mergeAll(Git.layerNoDeps, Ids.layer).pipe(Layer.provideMerge(Layer.mergeAll(ProjectFiles.layer(root), Process.layer)))
    // A runtime of its own: built in the caller's, the catalog layer would be the caller's catalog.
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => ManagedRuntime.make(Catalog.layer.pipe(Layer.provideMerge(kernel)))),
      (runtime) => Effect.flatMap(runtime.contextEffect, (context) => Effect.provideContext(build(art, browser, videos), context)),
      (runtime) => runtime.disposeEffect
    )
  }).pipe(Effect.scoped)
