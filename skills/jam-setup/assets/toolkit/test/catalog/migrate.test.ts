// `jam catalog migrate` on a project made by the toolkit before format 2 (fixtures/migrate-format-1,
// generated through the public actions of 8c4197d; fixtures/migrate-format-1.answers.json holds what
// that toolkit answered for it). The migrated project must read the same: the same units, the same
// review status per part, the same notes on the same targets.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync } from "node:fs"
import { join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { validatePlan } from "../../src/catalog/migrate/apply.ts"
import { manifestPathOf, planMigration, type SourceFile } from "../../src/catalog/migrate/plan.ts"
import { fileKey } from "../../src/catalog/records/layout.ts"
import * as Effect from "effect/Effect"
import { cleanup, existsSync, git, open, read, tmp, write } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url))
const CLI = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
const AMBIENT = ["CATALOG_ACTOR_KIND", "CATALOG_ACTOR_NAME", "JAM_ROOT", "JAM_JSON"]
const ANSWERS: Any = JSON.parse(readFileSync(join(FIXTURES, "migrate-format-1.answers.json"), "utf8"))

/** A committed copy of a fixture project. */
const project = (name = "migrate-format-1", commit = true): string => {
  const dir = tmp("migrate-")
  cpSync(join(FIXTURES, name), dir, { recursive: true })
  if (commit) {
    git(dir, "init", "-q")
    git(dir, "add", "-A")
    git(dir, "commit", "-q", "-m", "format 1")
  }
  return dir
}

const migrate = (dir: string, ...args: ReadonlyArray<string>) => {
  const result = spawnSync(process.execPath, [CLI, "catalog", "migrate", ...args, "--json", "--root", dir], {
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !AMBIENT.includes(key)))
  })
  return { status: result.status, report: result.status === 0 ? JSON.parse(result.stdout) : null, error: result.status === 0 ? null : result.stderr }
}

/** Every file under the project (Git's own folder left out) with a digest of its bytes. */
const tree = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const visit = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name)
      if (name === ".git") continue
      if (statSync(full).isDirectory()) visit(full)
      else out[relative(dir, full)] = createHash("sha256").update(readFileSync(full)).digest("hex")
    }
  }
  visit(dir)
  return out
}
/** Every folder under the project (Git's own left out). */
const folders = (dir: string): Array<string> => {
  const out: Array<string> = []
  const visit = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name)
      if (name === ".git" || !statSync(full).isDirectory()) continue
      out.push(relative(dir, full))
      visit(full)
    }
  }
  visit(dir)
  return out.sort()
}
const catalogFiles = (dir: string): Array<string> => Object.keys(tree(dir)).filter((path) => path.startsWith(".catalog/") && !path.startsWith(".catalog/evidence/")).sort()

// ---- What a reader sees, in names both toolkits share. Format 1 answers use the old names.

const part = (id: string): string => (id === "decision" ? "item" : id)
const keys = (map: Any): Any => (map ? Object.fromEntries(Object.entries(map).map(([key, value]) => [part(key), value])) : map)
const decision = (d: Any): Any =>
  d && { id: d.id.replace(/^vd_/, "dc_"), item: d.item, by: d.by, covers: d.scope ?? d.covers, verdicts: keys(d.verdicts), comment: d.comment, partComments: keys(d.partNotes ?? d.partComments), relay: d.relay ?? null }
const target = (t: Any): Any => (t.part === undefined ? t : { ...t, part: part(t.part) })
const review = (r: Any): Any => ({
  title: r.title,
  checkout: "context" in r ? r.context : r.checkout,
  brief: "note" in r ? r.note : r.brief,
  counts: r.counts,
  items: r.items.map((item: Any) => ({
    id: item.id,
    state: item.state,
    summary: item.summary,
    parts: item.parts.map((p: Any) => ({ id: part(p.id), label: p.label, reviewable: p.reviewable, verdict: p.verdict, decision: decision("event" in p ? p.event : p.decision) })),
    views: item.views.map((v: Any) => ({ id: v.id, part: part(v.part), caption: v.caption, before: v.before?.label ?? null }))
  })),
  decisions: (r.events ?? r.decisions).map(decision),
  observations: r.observations.map((n: Any) => n.id)
})
// The default scopes were renamed with the routes: content → main, assets → material.
const SCOPES: Any = { content: "main", assets: "material" }
const unit = (u: Any): Any => ({
  unit: { ...u.unit, scope: SCOPES[u.unit.scope] ?? u.unit.scope },
  organization: u.organization,
  review: { summary: u.review.summary, parts: u.review.parts.map((p: Any) => ({ id: p.id, verdict: p.verdict, changed: p.changed, decision: decision("event" in p ? p.event : p.decision) })) },
  history: u.history.map((h: Any) => ({ ...decision(h), changedParts: h.changedParts })),
  notes: u.notes.map((n: Any) => [n.id, n.body]),
  inspectors: (u.views ?? u.inspectors).map((i: Any) => i.key),
  waiting: u.waiting.map((w: Any) => [w.submission, w.item])
})
const collection = (c: Any): Any => ({
  owner: c.collection.owner === "adapter" ? "project" : c.collection.owner,
  organization: { ...c.organization, owner: c.organization.owner === "adapter" ? "project" : c.organization.owner },
  review: c.review.parts.map((p: Any) => [p.id, p.verdict, p.changed]),
  notes: c.notes.map((n: Any) => n.id)
})
const notes = (list: Any): Any => list.notes.map((n: Any) => ({ id: n.id, target: target(n.target), body: n.body, resolved: n.resolved ?? null, partLabel: n.partLabel, targetName: n.targetName }))
const inbox = (i: Any): Any => ({
  counts: i.counts,
  waiting: i.waiting.map((w: Any) => [w.submission, w.waiting]),
  notes: i.notes.map((n: Any) => [n.id, target(n.target), n.partLabel]),
  changed: i.changed.map((c: Any) => [c.target, c.parts.map((p: Any) => [part(p.id), p.verdict, p.submission])])
})

test("a dry run lists every change and writes nothing", () => {
  const dir = project()
  const before = tree(dir)
  const { report, status } = migrate(dir, "--dry-run")
  assert.equal(status, 0)
  assert.deepEqual(tree(dir), before, "not one byte changed")
  assert.equal(report.dryRun, true)
  assert.deepEqual(report.format, { from: 1, to: 2 })
  const by = (action: string) => report.changes.filter((change: Any) => change.action === action).map((change: Any) => change.file).sort()
  assert.deepEqual(by("move"), catalogFiles(dir).filter((path) => /^\.catalog\/(labels|reviews\/[^/]+\/verdicts)\//.test(path)), "every label and verdict file moves")
  assert.deepEqual(by("create"), [".catalog/format.json"])
  assert.ok(["catalog.config.json", "project.manifest.json", "content/armor_helm.json"].every((file) => by("rewrite").includes(file)))
  assert.deepEqual(report.warnings, [])
  cleanup(dir)
})

test("the migration writes the format-2 tree, configuration version 3 and manifest version 2, with every cross-reference rewritten", () => {
  const dir = project()
  const old = catalogFiles(dir)
  write(dir, ".catalog/.local/requests/0123.json", { requestId: "rq-note-1", action: "note.create", context: "x" })
  const { report, status } = migrate(dir)
  assert.equal(status, 0)
  assert.equal(report.dryRun, false)
  assert.ok(report.changes.some((change: Any) => change.file === ".catalog/.local/requests/" && change.action === "delete"))
  assert.equal(existsSync(join(dir, ".catalog/.local/requests")), false, "request ids from before cannot be replayed")

  // Files: labels/ → organization/ with the same content; verdicts/vd_ → decisions/dc_; the marker.
  const now = catalogFiles(dir)
  assert.ok(!now.some((path) => path.startsWith(".catalog/labels/") || path.includes("/verdicts/")))
  for (const path of old.filter((p) => p.startsWith(".catalog/labels/"))) {
    assert.deepEqual(read(dir, path.replace("/labels/", "/organization/")), JSON.parse(readFileSync(join(FIXTURES, "migrate-format-1", path), "utf8")))
  }
  const verdictFiles = old.filter((p) => p.includes("/verdicts/"))
  assert.deepEqual(now.filter((p) => p.includes("/decisions/")), verdictFiles.map((p) => p.replace("/verdicts/vd_", "/decisions/dc_")).sort())
  assert.deepEqual(read(dir, ".catalog/format.json"), { format: 2 })

  // Nothing anywhere under .catalog keeps an old field, id or binding.
  const text = now.map((path) => readFileSync(join(dir, path), "utf8")).join("\n")
  for (const gone of ['"context"', '"note":', '"scope"', '"partNotes"', '"vd_', '"decision"']) assert.ok(!text.includes(gone), `${gone} is gone`)

  // The work item's part is `item` in the submission, its views, the decisions and the note on it.
  const subs = now.filter((p) => p.endsWith("/submission.json")).map((p) => read(dir, p))
  const work = subs.flatMap((s: Any) => s.items.filter((i: Any) => i.target === null).map((i: Any) => ({ submission: s.id, item: i })))
  assert.equal(work.length, 1)
  assert.deepEqual(work[0].item.parts.map((p: Any) => [p.id, p.label]), [["item", "Decision"]])
  const onWork = now.filter((p) => p.includes(`${work[0].submission}/decisions/`)).map((p) => read(dir, p)).filter((d: Any) => d.item === work[0].item.id)
  assert.deepEqual(onWork.map((d: Any) => [d.covers, d.verdicts, d.partComments, d.relay.by]), [[{ kind: "parts", parts: ["item"] }, { item: "approved" }, { item: "Halve it." }, "Rae Tester"]])
  const noteOnWork = now.filter((p) => p.startsWith(".catalog/notes/")).map((p) => read(dir, p)).find((n: Any) => n.target.item === work[0].item.id)
  assert.equal(noteOnWork.target.part, "item")
  assert.equal(noteOnWork.lastRequestBinding.action, "note.edit")
  for (const s of subs) {
    assert.ok("checkout" in s && "brief" in s && !("context" in s) && !("note" in s))
    if (s.requestBinding) assert.ok(typeof s.requestBinding.checkout === "string" && !("context" in s.requestBinding))
  }
  const helm = subs.find((s: Any) => s.title === "Helm and boots pass")
  assert.equal(helm.brief, "Please check the **visor** and the boots' colour.")
  // A view whose before side is earlier frozen evidence still names it.
  const later = subs.find((s: Any) => s.items.some((i: Any) => i.views.some((v: Any) => v.before?.from)))
  const from = later.items.flatMap((i: Any) => i.views).find((v: Any) => v.before?.from).before.from
  assert.deepEqual([from.submission, from.part], [helm.id, "model"])

  // Configuration version 3 with the manifest's options in its entry; manifest version 2.
  assert.deepEqual(read(dir, "catalog.config.json"), {
    version: 3,
    plugins: [{ plugin: "manifest", options: { file: "project.manifest.json" } }],
    review: { resolver: "latest" },
    display: { pixelArt: false }
  })
  const manifest = read(dir, "project.manifest.json")
  assert.equal(manifest.version, 2)
  assert.deepEqual(manifest.types.armor.inspectors.map((i: Any) => i.key), ["turntable"])
  assert.ok(!("views" in manifest.types.armor))
  assert.deepEqual(manifest.types.armor.roles.map((r: Any) => r.mediaKinds), [["image"], ["model"], ["image"]])
  assert.deepEqual(manifest.units.find((u: Any) => u.id === "armor/coat").inspectors, [])
  assert.deepEqual(read(dir, "content/armor_helm.json").inspectors, ["turntable"])
  assert.equal(read(dir, "content/armor_boots.json").inspectors, undefined, "a unit without views is unchanged")
  cleanup(dir)
})

test("after the migration the project answers as the format-1 project did: units, review status per part, notes on the same targets", async () => {
  const dir = project()
  assert.equal(migrate(dir).status, 0)
  const app = await open(dir)
  assert.deepEqual((await app.run("problems", {})).problems, [])
  for (const [id, answer] of Object.entries(ANSWERS.reviews)) {
    assert.deepEqual(review(await app.run("review.get", { submission: id })), review(answer), `review.get ${id}`)
  }
  for (const [id, answer] of Object.entries(ANSWERS.units)) assert.deepEqual(unit(await app.run("unit.get", { id })), unit(answer), `unit.get ${id}`)
  for (const [id, answer] of Object.entries(ANSWERS.collections)) assert.deepEqual(collection(await app.run("collection.get", { id })), collection(answer), `collection.get ${id}`)
  assert.deepEqual(notes(await app.run("note.list", { state: "all", pageSize: 100 })), notes(ANSWERS.notes))
  assert.deepEqual(inbox(await app.run("inbox", {})), inbox(ANSWERS.inbox))
  assert.deepEqual((await app.run("organization.list", {})), ANSWERS.organization)
  // The boots changed after their review, and still read as changed.
  assert.deepEqual((await app.run("unit.get", { id: "armor/boots" })).review.parts.filter((p: Any) => p.changed).map((p: Any) => p.id), ["icon"])
  cleanup(dir)
})

test("a second run changes nothing", () => {
  const dir = project()
  assert.equal(migrate(dir).status, 0)
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "format 2")
  const before = tree(dir)
  const { report, status } = migrate(dir)
  assert.equal(status, 0)
  assert.deepEqual(report.changes, [])
  assert.deepEqual(report.format, { from: 2, to: 2 })
  assert.deepEqual(tree(dir), before)
  cleanup(dir)
})

test("uncommitted changes to the files it rewrites refuse the migration (exit 1, nothing written) until --force", () => {
  const dir = project()
  const note = catalogFiles(dir).find((path) => path.startsWith(".catalog/notes/"))!
  write(dir, note, { ...read(dir, note), body: "Edited by hand" })
  const before = tree(dir)
  const refused = migrate(dir)
  assert.equal(refused.status, 1)
  assert.match(refused.error!, /"code": "conflict"/)
  assert.ok(refused.error!.includes(note), refused.error!)
  assert.match(refused.error!, /commit or stash these files first, or pass --force/)
  assert.deepEqual(tree(dir), before)
  // An uncommitted change elsewhere in the project is none of its business.
  git(dir, "checkout", "--", note)
  write(dir, "README.md", "work in progress\n")
  assert.equal(migrate(dir, "--dry-run").status, 0)
  write(dir, "project.manifest.json", { ...read(dir, "project.manifest.json"), project: "Renamed" })
  assert.equal(migrate(dir).status, 1)
  const forced = migrate(dir, "--force")
  assert.equal(forced.status, 0)
  assert.equal(read(dir, "project.manifest.json").project, "Renamed")
  assert.equal(read(dir, "project.manifest.json").version, 2)
  assert.equal(migrate(dir, "--no-such-flag").status, 2, "a flag it does not know is a usage error")
  cleanup(dir)
})

test("a format-1 file merged in after the migration is a record problem, and a new run migrates it", async () => {
  const dir = project()
  assert.equal(migrate(dir).status, 0)
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "format 2")
  // A branch from before the migration labelled the boots.
  write(dir, ".catalog/labels/unit/armor-boots-x.json", { target: { kind: "unit", id: "armor/boots" }, category: null, tags: ["late"], revision: 1 })
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "merge an old branch")
  const app = await open(dir)
  const problems = (await app.run("problems", {})).problems
  assert.deepEqual(problems.map((p: Any) => [p.origin, p.subject, p.recovery]), [["records", ".catalog/labels/unit/armor-boots-x.json", "run: jam catalog migrate"]])
  assert.match(problems[0].error, /written by an older toolkit \(format 1\)/)
  const { report, status } = migrate(dir)
  assert.equal(status, 0)
  assert.deepEqual(report.changes.map((c: Any) => [c.action, c.file]), [["move", ".catalog/labels/unit/armor-boots-x.json"]])
  const reopened = await open(dir)
  assert.deepEqual((await reopened.run("problems", {})).problems, [])
  assert.deepEqual((await reopened.run("unit.get", { id: "armor/boots" })).organization.tags, ["late"])
  cleanup(dir)
})

test("a version 1 configuration migrates to version 3 with warnings for what it cannot carry; outside Git it needs --force", () => {
  const dir = project("migrate-config-v1", false)
  const refused = migrate(dir)
  assert.equal(refused.status, 1)
  assert.match(refused.error!, /not a Git checkout/)
  const { report, status } = migrate(dir, "--force")
  assert.equal(status, 0)
  assert.deepEqual(read(dir, "catalog.config.json"), {
    version: 3,
    plugins: [{ plugin: "manifest", options: { file: "content/catalog.manifest.json" } }],
    review: { resolver: "strictest", referenceRoles: ["concept"], verdicts: ["approved", "changes", "rejected"] },
    display: { pixelArt: true }
  })
  assert.deepEqual(report.warnings, ["catalog.config.json: previewModules (lineup) was dropped; declare these modules under a plugin's browserModules (check it against docs/catalog-migration.md)"])
  cleanup(dir)
})

test("a file it cannot read or that would be invalid refuses the whole migration, and nothing is written", () => {
  const dir = project()
  const verdict = catalogFiles(dir).find((p) => p.includes("/verdicts/"))!
  write(dir, verdict, { ...read(dir, verdict), scope: { kind: "sideways", parts: ["icon"] } })
  const note = catalogFiles(dir).find((p) => p.startsWith(".catalog/notes/"))!
  write(dir, note, "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n")
  git(dir, "commit", "-qam", "broken")
  const before = tree(dir)
  const refused = migrate(dir)
  assert.equal(refused.status, 1)
  assert.match(refused.error!, /"code": "malformed"/)
  assert.match(refused.error!, new RegExp(note.replace(/\./g, "\\.")))
  assert.match(refused.error!, /unresolved Git merge conflict/)
  assert.match(refused.error!, /covers\.kind/)
  assert.deepEqual(tree(dir), before)
  cleanup(dir)
})

test("a type naming an old default scope is moved to its new name, and its units answer after the migration", async () => {
  const dir = project("migrate-format-1", false)
  const manifest = read(dir, "project.manifest.json")
  write(dir, "project.manifest.json", { ...manifest, types: { ...manifest.types, armor: { ...manifest.types.armor, scope: "assets" }, lore: { ...manifest.types.lore, scope: "content" } } })
  git(dir, "init", "-q")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "format 1")
  const { report, status } = migrate(dir)
  assert.equal(status, 0)
  assert.deepEqual(report.warnings, [], "no project plugin module could define a scope named content")
  assert.match(report.changes.find((change: Any) => change.file === "project.manifest.json").why, /default scope assets → material, default scope content → main/)
  const migrated = read(dir, "project.manifest.json")
  assert.deepEqual([migrated.types.armor.scope, migrated.types.lore.scope], ["material", "main"])
  const app = await open(dir)
  assert.deepEqual((await app.run("problems", {})).problems, [])
  assert.equal((await app.run("unit.get", { id: "armor/helm" })).unit.scope, "material")
  assert.equal((await app.run("unit.get", { id: "lore/origin" })).unit.scope, "main")
  cleanup(dir)
})

test("a step that fails part-way through the writes undoes every step: the tree is as it was, with no temporary files or new folders", () => {
  const dir = project()
  // Something sits where a label record is to be moved.
  const target = ".catalog/organization/unit/armor-helm-376ed1767f.json"
  mkdirSync(join(dir, target), { recursive: true })
  const before = tree(dir)
  const beforeFolders = folders(dir)
  const refused = migrate(dir)
  assert.equal(refused.status, 1)
  assert.match(refused.error!, /"code": "unavailable"/)
  assert.match(refused.error!, new RegExp(`${target.replace(/\./g, "\\.")} is a directory`))
  assert.match(refused.error!, /nothing was changed/)
  assert.deepEqual(tree(dir), before, "every replaced file is back, byte for byte")
  assert.deepEqual(folders(dir), beforeFolders, "no folder made for a new file is left behind")
  assert.ok(!Object.keys(tree(dir)).some((path) => /\.(tmp|bak)$/.test(path)))
  cleanup(dir)
})

test("a file it may not read is named in the malformed report, also in a dry run", () => {
  const dir = project()
  const outside = tmp("migrate-outside-")
  write(outside, "note.json", { id: "nt_x" })
  symlinkSync(join(outside, "note.json"), join(dir, ".catalog/notes/nt_link.json"))
  const refused = migrate(dir, "--dry-run")
  assert.equal(refused.status, 1)
  const { error } = JSON.parse(refused.error!.slice(refused.error!.indexOf("{")))
  assert.equal(error.code, "malformed")
  assert.deepEqual(error.details.problems.map((p: Any) => p.file), [".catalog/notes/nt_link.json"])
  assert.match(error.details.problems[0].error, /symbolic link/)
  assert.ok(error.details.report.changes.length > 0, "the report of the rest is still given")
  cleanup(dir, outside)
})

test("the dirty check covers only the files the migration changes, named from the project folder", () => {
  const repo = tmp("migrate-repo-")
  const dir = join(repo, "game")
  cpSync(join(FIXTURES, "migrate-format-1"), dir, { recursive: true })
  git(repo, "init", "-q")
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "-m", "format 1")
  const note = catalogFiles(dir).find((path) => path.startsWith(".catalog/notes/"))!
  write(dir, note, { ...read(dir, note), body: "Edited by hand" })
  const refused = migrate(dir)
  assert.equal(refused.status, 1)
  const { error } = JSON.parse(refused.error!.slice(refused.error!.indexOf("{")))
  assert.deepEqual(error.details.files, [note])
  git(repo, "checkout", "--", `game/${note}`)
  // An untracked file the migration does not touch is none of its business.
  write(dir, ".catalog/scratch.json", { mine: true })
  write(dir, "content/draft.txt", "work in progress\n")
  assert.equal(migrate(dir).status, 0)
  cleanup(repo)
})

test("the summary says what changed: a configuration alone is not a format change", () => {
  const dir = tmp("migrate-config-")
  write(dir, "catalog.config.json", { version: 2, plugins: ["manifest"] })
  write(dir, "catalog.manifest.json", { version: 2, types: {}, units: [] })
  const result = spawnSync(process.execPath, [CLI, "catalog", "migrate", "--dry-run", "--root", dir], { encoding: "utf8", env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !AMBIENT.includes(key))) })
  assert.equal(result.status, 0, result.stderr)
  const text = `${result.stdout}${result.stderr}`
  assert.match(text, /Dry run, nothing written\. It would migrate catalog\.config\.json to version 3\./)
  assert.doesNotMatch(text, /format 2 to 2/)
  cleanup(dir)
})

// ---- The planner on its own: one file kind at a time.

const file = (path: string, value: unknown): SourceFile => ({ path, text: `${JSON.stringify(value, null, 2)}\n` })
const plan = (inputs: Partial<Parameters<typeof planMigration>[0]>) =>
  planMigration({ config: null, manifest: null, unitFiles: [], records: [], marker: null, journal: false, ...inputs })

test("version 2 options move into their entries; options of no listed plugin are dropped; project modules and adapters are named", () => {
  const v2 = plan({ config: file("catalog.config.json", { version: 2, plugins: ["manifest", "./catalog/storybook.ts", "jam"], options: { manifest: { file: "m.json" }, storybook: { folder: "story" }, gone: { x: 1 } } }) })
  assert.deepEqual(v2.writes[0]!.value, { version: 3, plugins: [{ plugin: "manifest", options: { file: "m.json" } }, { plugin: "./catalog/storybook.ts", options: { folder: "story" } }, "jam"] })
  assert.deepEqual(v2.warnings, [
    "catalog.config.json: options.gone was dropped: no plugin entry is named gone",
    "catalog.config.json: plugin module ./catalog/storybook.ts is project code the migration does not change (the plugin contract changed: its import path is tools/jam/catalog-plugin.ts, views and previews are browserModules, an action's kind is access, browser modules report shows); check it against docs/catalog-migration.md"
  ])
  const adapter = plan({ config: file("catalog.config.json", { version: 1, adapter: "./tools/adapter.mjs", options: { depth: 2 }, review: { resolverModule: "./tools/resolver.mjs", resolver: "mine" } }) })
  assert.deepEqual(adapter.writes[0]!.value, { version: 3, plugins: [{ plugin: "./tools/adapter.mjs", options: { depth: 2 } }], review: { resolver: "mine" } })
  assert.deepEqual(adapter.warnings.length, 2)
  assert.match(adapter.warnings[0]!, /adapter \.\/tools\/adapter\.mjs is a version 1 adapter module; rewrite it as a plugin/)
  assert.match(adapter.warnings[1]!, /review\.resolverModule \(\.\/tools\/resolver\.mjs\) was dropped/)
  assert.deepEqual(plan({ config: file("catalog.config.json", { version: 3, plugins: ["manifest"] }) }).changes, [])
})

test("request bindings name the checkout and the action's current name", () => {
  const binding = { action: "organize.set", digest: "a".repeat(64), context: "wt:main" }
  const collection = { id: "kept", name: "Kept", kind: null, category: null, tags: [], members: [], revision: 1, requestId: "r1", requestBinding: binding }
  const note = { id: "nt_a", target: { kind: "unit", id: "u" }, body: "b", by: { name: "n", kind: "human" }, at: "2026-01-01T00:00:00Z", revision: 2, lastRequestId: "r2", lastRequestBinding: { ...binding, action: "note.edit" } }
  const kept = `.catalog/collections/${fileKey("kept")}.json`
  const result = plan({ records: [file(kept, collection), file(".catalog/notes/nt_a.json", note)], marker: file(".catalog/format.json", { format: 2 }) })
  assert.deepEqual(result.writes.map((w) => [w.path, (w.value as Any).requestBinding ?? (w.value as Any).lastRequestBinding]), [
    [kept, { action: "organization.set", digest: "a".repeat(64), checkout: "wt:main" }],
    [".catalog/notes/nt_a.json", { action: "note.edit", digest: "a".repeat(64), checkout: "wt:main" }]
  ])
  assert.deepEqual(result.format, { from: 1, to: 2 })
})

test("a record in both forms after a merge: identical is dropped, different is refused", () => {
  const label = { target: { kind: "unit", id: "u" }, category: null, tags: ["a"], revision: 1 }
  const name = `${fileKey("u")}.json`
  const both = (other: unknown) => plan({
    records: [file(`.catalog/labels/unit/${name}`, label), file(`.catalog/organization/unit/${name}`, other)],
    marker: file(".catalog/format.json", { format: 2 })
  })
  const same = both(label)
  assert.deepEqual([same.errors, same.changes.map((c) => [c.action, c.file]), same.removals], [[], [["delete", `.catalog/labels/unit/${name}`]], [`.catalog/labels/unit/${name}`]])
  const different = both({ ...label, tags: ["b"] })
  assert.deepEqual(different.errors.map((e) => e.file), [`.catalog/labels/unit/${name}`])
  assert.match(different.errors[0]!.error, /exists with different content/)
})

test("old default scopes: assets is always material; content is main, with a warning when project plugin modules may define their own", () => {
  const manifest = (types: Any) => file("catalog.manifest.json", { version: 2, types })
  const types = { a: { label: "A", scope: "assets" }, c: { label: "C", scope: "content" }, m: { label: "M", scope: "main" } }
  const plain = plan({ config: file("catalog.config.json", { version: 3, plugins: ["manifest"] }), manifest: manifest(types) })
  assert.deepEqual(plain.writes.map((w) => Object.values((w.value as Any).types).map((t: Any) => t.scope)), [["material", "main", "main"]])
  assert.deepEqual(plain.warnings, [])
  const withModules = plan({ config: file("catalog.config.json", { version: 3, plugins: ["manifest", "./catalog/mine.ts"] }), manifest: manifest(types) })
  assert.deepEqual((withModules.writes.find((w) => w.as === "manifest")!.value as Any).types.c.scope, "main")
  assert.deepEqual(withModules.warnings.filter((w) => w.includes("scope")), [
    "catalog.manifest.json: types.c.scope was content and is now main; if a project plugin defines its own scope content, set it back (check it against docs/catalog-migration.md)"
  ])
  assert.deepEqual(plan({ manifest: manifest({ m: { label: "M", scope: "main" } }) }).changes, [], "main is left as it is")
})

test("a key in both its old and new form: the same value drops the old one, a different value is refused naming the field", () => {
  const manifest = (armor: Any) => plan({ manifest: file("catalog.manifest.json", { version: 1, types: { armor } }) })
  const same = manifest({ label: "A", views: [{ key: "t" }], inspectors: [{ key: "t" }] })
  assert.deepEqual(same.errors, [])
  assert.deepEqual((same.writes[0]!.value as Any).types.armor, { label: "A", inspectors: [{ key: "t" }] })
  const different = manifest({ label: "A", views: [{ key: "t" }], inspectors: [] })
  assert.deepEqual(different.errors, [{ file: "catalog.manifest.json", error: "types.armor.views and types.armor.inspectors both exist with different values; keep one and run the migration again" }])
  const decision = { id: "vd_a", submission: "s", item: "i", by: { name: "n", kind: "human" }, at: "2026-01-01T00:00:00Z", scope: { kind: "whole", parts: [] }, covers: { kind: "parts", parts: ["x"] }, verdicts: {} }
  const record = plan({ records: [file(".catalog/reviews/s/verdicts/vd_a.json", decision)] })
  assert.deepEqual(record.errors, [{ file: ".catalog/reviews/s/verdicts/vd_a.json", error: "scope and covers both exist with different values; keep one and run the migration again" }])
})

test("a migrated manifest or unit file that would still hold an old key is refused before anything is written", async () => {
  const problems = await Effect.runPromise(validatePlan({
    format: { from: 1, to: 2 },
    changes: [],
    warnings: [],
    removals: [],
    errors: [],
    writes: [
      { path: "catalog.manifest.json", as: "manifest", value: { version: 2, types: { armor: { roles: [{ key: "icon", kinds: ["image"] }] } } } },
      { path: "content/a.json", as: "unit", value: { id: "a", views: [] } }
    ]
  }))
  assert.deepEqual(problems, [
    { file: "catalog.manifest.json", error: "still holds types.armor.roles[0].kinds is now mediaKinds" },
    { file: "content/a.json", error: "still holds views is now inspectors" }
  ])
})

test("version 1: $schema is dropped with a warning; options.manifest is read as a project path with or without ./", () => {
  const v1 = plan({ config: file("catalog.config.json", { $schema: "./schemas/catalog.config.v1.json", version: 1, adapter: "manifest", options: { manifest: "./data/m.json" } }) })
  assert.deepEqual(v1.warnings, ["catalog.config.json: $schema (./schemas/catalog.config.v1.json) was dropped: it described version 1; the version 3 schema is tools/jam/schemas/catalog.config.schema.json"])
  assert.equal(manifestPathOf({ version: 1, adapter: "manifest", options: { manifest: "./data/m.json" } }), "data/m.json")
  assert.equal(manifestPathOf({ version: 1, options: { manifest: "data/m.json" } }), "data/m.json")
})
