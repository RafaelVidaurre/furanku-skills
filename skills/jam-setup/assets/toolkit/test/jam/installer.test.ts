// jam-setup's installer vendors the toolkit into a project. Hermetic: temporary projects, no
// network (packages are never downloaded here), no Git LFS changes outside the project.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { tempProject } from "../support.ts"
import { CONFIG, readJson, TOOLKIT, write } from "./fixtures.ts"

const INSTALL = join(TOOLKIT, "../../scripts/install.mjs")
const sha = (text: string): string => createHash("sha256").update(text).digest("hex")
const read = (root: string, path: string): string => readFileSync(join(root, path), "utf8")

const install = (root: string, ...args: ReadonlyArray<string>) => {
  const result = spawnSync(process.execPath, [INSTALL, "--project", root, "--no-deps", ...args], { encoding: "utf8", env: { ...process.env, HOME: root } })
  return { status: result.status, stderr: result.stderr, json: (result.status === 0 ? JSON.parse(result.stdout) : null) as Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Make an installed toolkit runnable without downloading anything: lend it this checkout's packages. */
const lendPackages = (root: string, toolkit = "tools/jam"): void => {
  symlinkSync(join(TOOLKIT, "node_modules"), join(root, toolkit, "node_modules"), "dir")
  assert.equal(read(TOOLKIT, "node_modules/.jam-installed"), read(root, `${toolkit}/package-lock.json`), "run any jam command once in this checkout so its packages carry the install stamp")
}

describe("installing", () => {
  it("a fresh install vendors one package with its launcher and wires the project from the default roots; a rerun changes nothing", () => {
    const root = tempProject({ files: { ".gitignore": "dist/\n" } })
    const first = install(root, "--no-lfs")
    assert.equal(first.status, 0, first.stderr)
    assert.equal(first.json["installed"], "installed")
    for (const file of ["jam.mjs", "package.json", "package-lock.json", ".npmrc", "catalog-plugin.ts", "catalog-plugin-web.d.ts", "src/cli/main.ts", "src/jam/cli.ts", "recipes/prop.json", "providers/meshy.json", "engines/web.json", "schemas/recipe.schema.json", "defaults/config.json", "scripts/crop_turnaround.py", "docs/cli.md", "docs/catalog-migration.md", ".jam-toolkit.json", ".gitignore"]) {
      assert.ok(existsSync(join(root, "tools/jam", file)), file)
    }
    assert.ok(!existsSync(join(root, "tools/jam/test")), "toolkit tests stay in the skill")
    assert.ok(!existsSync(join(root, "tools/jam/node_modules")))
    assert.ok(!existsSync(join(root, "tools/jam/core.mjs")), "nothing of version 1 is shipped")
    assert.deepEqual(readJson(root, "catalog.config.json"), { version: 3, plugins: [{ plugin: "manifest", options: { file: "Art/catalog.json" } }, "jam"] })
    assert.deepEqual(readJson<{ version: number; assetRoots: unknown }>(root, "Art/catalog.json"), { ...readJson(join(TOOLKIT, ".."), "project/catalog.json"), assetRoots: ["Art"] })
    assert.equal(readJson<{ version: number }>(root, "Art/catalog.json").version, 2)
    assert.equal(read(root, ".gitignore"), "dist/\n\n# >>> jam toolkit\n/Art/.scratch/\n/jam.local.json\n.catalog/.local/\n# <<< jam toolkit\n")
    assert.deepEqual([first.json["configuration"], first.json["dependencies"], first.json["complete"]], ["missing", "skipped (--no-deps)", true])
    assert.match(first.json["next"][0], /node tools\/jam\/jam\.mjs setup --from <choices\.json>/)
    const second = install(root, "--no-lfs")
    assert.deepEqual([second.json["installed"], second.json["gitignore"], second.json["catalogConfig"], second.json["catalogManifest"]], ["reinstalled (unchanged)", "present", "present", "present"])
  })

  it("--check reports the state and writes nothing", () => {
    const root = tempProject()
    const check = install(root, "--check")
    assert.deepEqual([check.json["installed"], check.json["configuration"], check.json["toolkit"]], ["absent", "missing", "tools/jam/"])
    assert.ok(!existsSync(join(root, "tools")) && !existsSync(join(root, "catalog.config.json")) && !existsSync(join(root, ".gitignore")))
    install(root, "--no-lfs")
    write(root, "tools/jam/jam.mjs", "// edited")
    write(root, "jam.config.json", JSON.stringify(CONFIG))
    const after = install(root, "--check")
    assert.deepEqual([after.json["installed"], after.json["locallyModified"], after.json["configuration"]], ["current", ["jam.mjs"], "version 2"])
    assert.equal(read(root, "tools/jam/jam.mjs"), "// edited")
  })

  it("never overwrites local edits, a folder it did not create, or someone else's file, unless forced", () => {
    const edited = tempProject()
    install(edited, "--no-lfs")
    write(edited, "tools/jam/jam.mjs", "// local edit")
    const refused = install(edited, "--no-lfs")
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /locally edited toolkit files would be overwritten: jam\.mjs\. .*project recipes, adapters and providers live under jam\//)
    assert.equal(install(edited, "--no-lfs", "--force").status, 0)
    assert.notEqual(read(edited, "tools/jam/jam.mjs"), "// local edit")

    const foreign = tempProject({ files: { "tools/jam/readme.txt": "ours" } })
    const left = install(foreign, "--no-lfs")
    assert.match(left.stderr, /tools\/jam\/ exists and was not installed by jam-setup; move it aside, or install elsewhere with --dir/)
    assert.equal(read(foreign, "tools/jam/readme.txt"), "ours")

    // A marker from an older version that did not own a path the toolkit now ships.
    const taken = tempProject({ files: { "tools/jam/.jam-toolkit.json": JSON.stringify({ digest: "old", files: {} }), "tools/jam/recipes/prop.json": "{\"mine\": true}", ".gitignore": "keep-me\n" } })
    assert.match(install(taken, "--no-lfs").stderr, /already exist with other content: recipes\/prop\.json/)
    assert.equal(read(taken, "tools/jam/recipes/prop.json"), "{\"mine\": true}")
    assert.equal(install(taken, "--no-lfs", "--force").status, 0)
    assert.match(read(taken, ".gitignore"), /^keep-me\n\n# >>> jam toolkit/)
  })

  it("--dir installs somewhere else, records it as the toolkit of the configuration, and derives ignore and LFS entries from the configured roots", () => {
    const config = { ...CONFIG, roots: { scratch: "content/.work", delivered: "content/final", scan: ["content", "audio"] } }
    const root = tempProject({ git: true, files: { "jam.config.json": JSON.stringify(config) } })
    const result = install(root, "--dir", "vendor/jam-toolkit")
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.json["toolkit"], "vendor/jam-toolkit/")
    assert.ok(existsSync(join(root, "vendor/jam-toolkit/jam.mjs")) && !existsSync(join(root, "tools")))
    assert.equal(readJson<{ toolkit: string }>(root, "jam.config.json").toolkit, "vendor/jam-toolkit")
    assert.deepEqual(result.json["roots"], { scratch: "content/.work", tracked: ["content", "audio"], from: "jam.config.json" })
    assert.match(read(root, ".gitignore"), /# >>> jam toolkit\n\/content\/\.work\/\n\/jam\.local\.json\n/)
    assert.deepEqual(readJson<{ plugins: unknown }>(root, "catalog.config.json").plugins, [{ plugin: "manifest", options: { file: "content/catalog.json" } }, "jam"])
    if (spawnSync("git", ["lfs", "version"]).status === 0) {
      const attributes = read(root, ".gitattributes")
      assert.match(attributes, /content\/\*\*\/\*\.glb filter=lfs diff=lfs merge=lfs -text\n/)
      assert.match(attributes, /audio\/\*\*\/\*\.wav filter=lfs/)
      assert.doesNotMatch(attributes, /Art\//)
    } else assert.match(result.json["lfs"], /git-lfs is not installed/)
    // The next run finds the toolkit where the configuration says it is.
    assert.equal(install(root, "--no-lfs").json["toolkit"], "vendor/jam-toolkit/")
    assert.match(install(root, "--no-lfs", "--dir", "../outside").stderr, /--dir \.\.\/outside: expected a folder inside the project/)
  })
})

describe("upgrading from version 1", () => {
  const V1_CATALOG = { version: 1, adapter: "./tools/jam/catalog-adapter.mjs", review: { referenceRoles: ["evidence"] } }
  const v1Layout = (): string => {
    const files = { "core.mjs": "// v1 ledger", "measure.mjs": "// v1 measure", "catalog/bin/catalog.mjs": "// v1 catalog", "jam.mjs": "// v1 cli" }
    const root = tempProject({
      git: true,
      files: {
        ...Object.fromEntries(Object.entries(files).map(([path, text]) => [`tools/jam/${path}`, text])),
        "tools/jam/.jam-toolkit.json": JSON.stringify({ source: "furanku-skills jam-setup", digest: "v1", files: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, sha(text)])) }),
        "tools/jam/catalog/node_modules/left/index.js": "",
        "jam.config.json": read(TOOLKIT, "test/jam/fixtures/v1-config.json"),
        "catalog.config.json": JSON.stringify(V1_CATALOG),
        "Art/style.md": "style",
        ".gitignore": "# >>> jam toolkit\n/Art/.scratch/\n/Art/.jam-jobs.lock\n/jam.local.json\n.catalog/.local/\n# <<< jam toolkit\n"
      }
    })
    return root
  }

  it("replaces the toolkit, drops what version 1 shipped, and leaves catalog.config.json for the catalog's migration", () => {
    const root = v1Layout()
    const result = install(root, "--no-lfs")
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.json["installed"], "upgraded")
    for (const gone of ["core.mjs", "measure.mjs", "catalog/node_modules"]) assert.ok(!existsSync(join(root, "tools/jam", gone)), gone)
    assert.match(read(root, "tools/jam/jam.mjs"), /src\/cli\/main\.ts/)
    assert.equal(read(root, "catalog.config.json"), JSON.stringify(V1_CATALOG), "the catalog's files are left for jam catalog migrate")
    assert.equal(result.json["catalogConfig"], "left as it is")
    // Without the toolkit's packages it cannot ask the toolkit whether the catalog's files need migrating.
    assert.equal(result.json["catalogMigration"], 'not checked: the toolkit\'s packages are not installed; run "node tools/jam/jam.mjs catalog migrate --dry-run" afterwards')
    assert.ok((result.json["next"] as Array<string>).some((line) => line.includes('"node tools/jam/jam.mjs catalog migrate --dry-run"')))
    assert.equal(read(root, ".gitignore"), "# >>> jam toolkit\n/Art/.scratch/\n/jam.local.json\n.catalog/.local/\n# <<< jam toolkit\n")
    // Without the toolkit's packages the configuration cannot be migrated yet; the summary says how.
    assert.match(result.json["configuration"], /version 1: run "node tools\/jam\/jam\.mjs config migrate"/)
    assert.equal(readJson<{ version: number }>(root, "jam.config.json").version, 1)
    assert.ok((result.json["next"] as Array<string>).some((line) => /config migrate/.test(line)))
  })

  it("migrates the configuration and reports the doctor's findings once the toolkit's packages are installed", () => {
    const root = v1Layout()
    install(root, "--no-lfs")
    lendPackages(root)
    const result = install(root, "--no-lfs")
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.json["configuration"].migrated, true)
    assert.equal(result.json["catalogMigration"], "needs migration: run jam catalog migrate", "the toolkit's own dry run plans the version 1 catalog configuration's migration")
    assert.ok((result.json["next"] as Array<string>).some((line) => line.includes('"node tools/jam/jam.mjs catalog migrate"')))
    assert.deepEqual(result.json["configuration"].recipes, ["asset", "character", "player-base", "prop", "npc", "set-piece"].map((id) => `jam/recipes/${id}.json`))
    const config = readJson<{ version: number; toolkit: string; budgets: Record<string, unknown> }>(root, "jam.config.json")
    assert.deepEqual([config.version, config.toolkit, Object.keys(config.budgets).length], [2, "tools/jam", 5])
    const doctor = result.json["doctor"] as { lines: Array<{ check: string; status: string }> }
    assert.equal(doctor.lines.find((line) => line.check === "configuration")!.status, "ok")
    assert.equal(doctor.lines.find((line) => line.check === "recipes")!.status, "ok")
    assert.ok((result.json["next"] as Array<string>).at(-1)!.includes("jam/, "), "the written recipes are named among what to commit")
    assert.match(read(root, "tools/jam/.gitignore"), /^node_modules\/$/m, "the toolkit's packages are ignored")
  })

  it("leaves an older catalog.config.json to the catalog's migration, keeps a version 3 file, and adds jam when no entry names it", () => {
    for (const older of [{ version: 1, adapter: "manifest", options: { manifest: "content/library.json" } }, { version: 2, plugins: ["manifest"], options: { manifest: { file: "content/library.json" } } }]) {
      const root = tempProject({ files: { "catalog.config.json": JSON.stringify(older) } })
      install(root, "--no-lfs")
      lendPackages(root)
      const result = install(root, "--no-lfs")
      assert.deepEqual([result.json["catalogConfig"], result.json["catalogManifest"], result.json["catalogMigration"]], ["left as it is", undefined, "needs migration: run jam catalog migrate"])
      assert.equal(read(root, "catalog.config.json"), JSON.stringify(older))
      assert.ok(!existsSync(join(root, "content/library.json")), "no manifest is created beside a configuration that is not migrated")
    }

    const current = JSON.stringify({ version: 3, plugins: [{ plugin: "jam", options: {} }, "./jam/catalog/game.ts"] })
    const v3 = tempProject({ files: { "catalog.config.json": current } })
    assert.equal(install(v3, "--no-lfs").json["catalogConfig"], "present", "an object entry naming jam lists it")
    assert.equal(read(v3, "catalog.config.json"), current)
    writeFileSync(join(v3, "catalog.config.json"), JSON.stringify({ version: 3, plugins: [{ plugin: "manifest", options: { file: "content/library.json" } }] }))
    const added = install(v3, "--no-lfs")
    assert.deepEqual([added.json["catalogConfig"], added.json["catalogManifest"]], ["added the jam plugin", "created content/library.json (hand-registered external content)"])
    assert.deepEqual(readJson<{ plugins: unknown }>(v3, "catalog.config.json").plugins, [{ plugin: "manifest", options: { file: "content/library.json" } }, "jam"])
  })

  it("asks the toolkit whether the catalog's files need migrating: a version 1 manifest, records without the format 2 marker, a manifest option without a file", () => {
    const config = JSON.stringify({ version: 3, plugins: [{ plugin: "manifest", options: { file: "content/library.json" } }, "jam"] })
    const root = tempProject({ files: { "catalog.config.json": config, "content/library.json": JSON.stringify({ version: 1, units: [] }), ".catalog/categories.json": JSON.stringify({ categories: ["Lore"], revision: 1 }) } })
    install(root, "--no-lfs")
    lendPackages(root)
    const result = install(root, "--no-lfs")
    assert.deepEqual([result.json["catalogConfig"], result.json["catalogManifest"], result.json["catalogMigration"]], ["present", "present", "needs migration: run jam catalog migrate"])
    assert.ok((result.json["next"] as Array<string>).some((line) => line.includes('"node tools/jam/jam.mjs catalog migrate"')))
    assert.equal(read(root, "content/library.json"), JSON.stringify({ version: 1, units: [] }), "the installer rewrites no catalog file")

    write(root, "content/library.json", JSON.stringify({ version: 2, units: [] }))
    write(root, ".catalog/format.json", JSON.stringify({ format: 2 }))
    const migrated = install(root, "--no-lfs")
    assert.equal(migrated.json["catalogMigration"], "current")
    assert.ok(!(migrated.json["next"] as Array<string>).some((line) => line.includes("catalog migrate")))

    // A plain "manifest" entry reads catalog.manifest.json, which may still be version 1.
    write(root, "catalog.config.json", JSON.stringify({ version: 3, plugins: ["manifest", "jam"] }))
    write(root, "catalog.manifest.json", JSON.stringify({ version: 1, units: [] }))
    assert.equal(install(root, "--no-lfs").json["catalogMigration"], "needs migration: run jam catalog migrate")
  })

  it("an unreadable catalog file is not taken as current: the installer passes on the dry run's refusal naming the file", () => {
    const root = tempProject({ files: { "catalog.config.json": JSON.stringify({ version: 3, plugins: ["manifest", "jam"] }), "catalog.manifest.json": JSON.stringify({ version: 2, units: [] }), ".catalog/format.json": "{ not json" } })
    install(root, "--no-lfs")
    lendPackages(root)
    const result = install(root, "--no-lfs")
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.json["catalogMigration"], /^dry run refused: cannot migrate: \.catalog\/format\.json/)
    assert.ok((result.json["next"] as Array<string>).some((line) => line.startsWith("Check the catalog's files: dry run refused")))
    writeFileSync(join(root, "catalog.config.json"), "{ not json")
    const broken = install(root, "--no-lfs")
    assert.equal(broken.status, 0, broken.stderr)
    assert.deepEqual([broken.json["catalogConfig"], broken.json["catalogMigration"].startsWith("dry run refused: ")], ["left as it is", true])
  })
})
