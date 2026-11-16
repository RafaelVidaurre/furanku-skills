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
    for (const file of ["jam.mjs", "package.json", "package-lock.json", ".npmrc", "src/cli/main.ts", "src/jam/cli.ts", "recipes/prop.json", "providers/meshy.json", "engines/web.json", "schemas/recipe.schema.json", "defaults/config.json", "scripts/crop_turnaround.py", "docs/cli.md", ".jam-toolkit.json", ".gitignore"]) {
      assert.ok(existsSync(join(root, "tools/jam", file)), file)
    }
    assert.ok(!existsSync(join(root, "tools/jam/test")), "toolkit tests stay in the skill")
    assert.ok(!existsSync(join(root, "tools/jam/node_modules")))
    assert.ok(!existsSync(join(root, "tools/jam/core.mjs")), "nothing of version 1 is shipped")
    assert.deepEqual(readJson(root, "catalog.config.json"), { version: 2, plugins: ["manifest", "jam"], options: { manifest: { file: "Art/catalog.json" } } })
    assert.deepEqual(readJson<{ assetRoots: unknown }>(root, "Art/catalog.json").assetRoots, ["Art"])
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
    assert.equal(readJson<{ options: { manifest: { file: string } } }>(root, "catalog.config.json").options.manifest.file, "content/catalog.json")
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
  const v1Layout = (): string => {
    const files = { "core.mjs": "// v1 ledger", "measure.mjs": "// v1 measure", "catalog/bin/catalog.mjs": "// v1 catalog", "jam.mjs": "// v1 cli" }
    const root = tempProject({
      git: true,
      files: {
        ...Object.fromEntries(Object.entries(files).map(([path, text]) => [`tools/jam/${path}`, text])),
        "tools/jam/.jam-toolkit.json": JSON.stringify({ source: "furanku-skills jam-setup", digest: "v1", files: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, sha(text)])) }),
        "tools/jam/catalog/node_modules/left/index.js": "",
        "jam.config.json": read(TOOLKIT, "test/jam/fixtures/v1-config.json"),
        "catalog.config.json": JSON.stringify({ version: 1, adapter: "./tools/jam/catalog-adapter.mjs", review: { referenceRoles: ["evidence"] } }),
        "Art/style.md": "style",
        ".gitignore": "# >>> jam toolkit\n/Art/.scratch/\n/Art/.jam-jobs.lock\n/jam.local.json\n.catalog/.local/\n# <<< jam toolkit\n"
      }
    })
    return root
  }

  it("replaces the toolkit, drops what version 1 shipped, and moves catalog.config.json to plugins", () => {
    const root = v1Layout()
    const result = install(root, "--no-lfs")
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.json["installed"], "upgraded")
    for (const gone of ["core.mjs", "measure.mjs", "catalog/node_modules"]) assert.ok(!existsSync(join(root, "tools/jam", gone)), gone)
    assert.match(read(root, "tools/jam/jam.mjs"), /src\/cli\/main\.ts/)
    assert.deepEqual(readJson(root, "catalog.config.json"), { version: 2, plugins: ["manifest", "jam"], options: { manifest: { file: "Art/catalog.json" } }, review: { referenceRoles: ["evidence"] } })
    assert.match(result.json["catalogConfig"], /migrated to version 2: plugins manifest, jam \(keeps manifest Art\/catalog\.json\)/)
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
    assert.deepEqual(result.json["configuration"].recipes, ["asset", "character", "player-base", "prop", "npc", "set-piece"].map((id) => `jam/recipes/${id}.json`))
    const config = readJson<{ version: number; toolkit: string; budgets: Record<string, unknown> }>(root, "jam.config.json")
    assert.deepEqual([config.version, config.toolkit, Object.keys(config.budgets).length], [2, "tools/jam", 5])
    const doctor = result.json["doctor"] as { lines: Array<{ check: string; status: string }> }
    assert.equal(doctor.lines.find((line) => line.check === "configuration")!.status, "ok")
    assert.equal(doctor.lines.find((line) => line.check === "recipes")!.status, "ok")
    assert.ok((result.json["next"] as Array<string>).at(-1)!.includes("jam/, "), "the written recipes are named among what to commit")
    assert.match(read(root, "tools/jam/.gitignore"), /^node_modules\/$/m, "the toolkit's packages are ignored")
  })

  it("keeps a project's own catalog adapter as a plugin, a manifest adapter's file, and a version 2 file as it is", () => {
    const custom = tempProject({ files: { "catalog.config.json": JSON.stringify({ version: 1, adapter: "./tools/catalog/project.mjs", options: { strict: true } }) } })
    const kept = install(custom, "--no-lfs")
    assert.deepEqual(readJson(custom, "catalog.config.json"), { version: 2, plugins: ["./tools/catalog/project.mjs", "jam"], options: { "./tools/catalog/project.mjs": { strict: true } } })
    assert.match(kept.json["catalogConfig"], /adapter \.\/tools\/catalog\/project\.mjs is kept as a plugin beside jam/)
    assert.equal(kept.json["catalogManifest"], undefined)

    const manifest = tempProject({ files: { "catalog.config.json": JSON.stringify({ version: 1, adapter: "manifest", options: { manifest: "content/library.json" } }), "content/library.json": "{}" } })
    install(manifest, "--no-lfs")
    assert.deepEqual(readJson(manifest, "catalog.config.json"), { version: 2, plugins: ["manifest", "jam"], options: { manifest: { file: "content/library.json" } } })
    assert.equal(read(manifest, "content/library.json"), "{}")

    const current = JSON.stringify({ version: 2, plugins: ["jam", "./jam/catalog/game.ts"] })
    const v2 = tempProject({ files: { "catalog.config.json": current } })
    assert.equal(install(v2, "--no-lfs").json["catalogConfig"], "present")
    assert.equal(read(v2, "catalog.config.json"), current)
    writeFileSync(join(v2, "catalog.config.json"), JSON.stringify({ version: 2, plugins: ["manifest"] }))
    assert.equal(install(v2, "--no-lfs").json["catalogConfig"], "added the jam plugin")
    assert.deepEqual(readJson<{ plugins: unknown }>(v2, "catalog.config.json").plugins, ["manifest", "jam"])
  })
})
