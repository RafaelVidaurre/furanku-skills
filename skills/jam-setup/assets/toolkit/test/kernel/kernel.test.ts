import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { edgeArgs, launcherArgv, projectRoot } from "../../src/kernel/cli.ts"
import { decode, jsonSchemaOf } from "../../src/kernel/decode.ts"
import { Git } from "../../src/kernel/Git.ts"
import { canonical, digest, portableProblem } from "../../src/kernel/hash.ts"
import { Ids } from "../../src/kernel/Ids.ts"
import { Process } from "../../src/kernel/Process.ts"
import { ProjectFiles } from "../../src/kernel/ProjectFiles.ts"
import { failure, git, run, tempProject, write } from "../support.ts"

describe("project files", () => {
  it("reads and writes inside the project and replaces files atomically", async () => {
    const root = tempProject()
    await run(root, Effect.gen(function*() {
      const files = yield* ProjectFiles
      yield* files.writeJson("a/b/c.json", { n: 1 })
      yield* files.writeJson("a/b/c.json", { n: 2 })
      assert.deepEqual(yield* files.readJson("a/b/c.json"), { n: 2 })
      assert.deepEqual(readdirSync(join(root, "a", "b")), ["c.json"], "no temporary file is left behind")
      assert.equal((yield* files.stat("a/b/c.json"))?.kind, "file")
      assert.equal(yield* files.stat("a/missing.json"), null)
    }))
  })

  it("refuses paths that are absolute, backslashed, unnormalized or outside the project", async () => {
    const root = tempProject()
    for (const path of ["/etc/passwd", "a\\b", "C:/x", "a/../b", "./a", "a//b", "..", ""]) {
      const error = await failure(root, Effect.flatMap(ProjectFiles, (files) => files.readText(path)))
      assert.equal(error.code, "forbidden", path)
    }
  })

  it("refuses a symbolic link that leaves the project, and any link when noFollow is asked", async () => {
    const outside = tempProject({ files: { "secret.txt": "secret" } })
    const root = tempProject({ files: { "real/inner.txt": "inner" } })
    symlinkSync(outside, join(root, "escape"))
    symlinkSync(join(root, "real"), join(root, "alias"))
    const escaped = await failure(root, Effect.flatMap(ProjectFiles, (files) => files.readText("escape/secret.txt")))
    assert.equal(escaped.code, "forbidden")
    const created = await failure(root, Effect.flatMap(ProjectFiles, (files) => files.writeText("escape/new.txt", "x")))
    assert.equal(created.code, "forbidden")
    assert.equal(existsSync(join(outside, "new.txt")), false)
    await run(root, Effect.gen(function*() {
      const files = yield* ProjectFiles
      assert.equal(yield* files.readText("alias/inner.txt"), "inner", "a link that stays inside is followed")
    }))
    const strict = await failure(root, Effect.flatMap(ProjectFiles, (files) => files.readText("alias/inner.txt", { noFollow: true })))
    assert.equal(strict.code, "forbidden")
  })

  it("walks files in order without entering linked folders, and honours skip", async () => {
    const root = tempProject({ files: { "art/b.png": "b", "art/a.png": "a", "art/sub/c.png": "c", "art/.scratch/d.png": "d" } })
    mkdirSync(join(root, "elsewhere"))
    writeFileSync(join(root, "elsewhere", "e.png"), "e")
    symlinkSync(join(root, "elsewhere"), join(root, "art", "linked"))
    await run(root, Effect.gen(function*() {
      const files = yield* ProjectFiles
      assert.deepEqual(yield* files.walk("art"), ["art/.scratch/d.png", "art/a.png", "art/b.png", "art/sub/c.png"])
      assert.deepEqual(yield* files.walk("art", { skip: (path) => path.endsWith(".scratch") }), ["art/a.png", "art/b.png", "art/sub/c.png"])
      assert.deepEqual(yield* files.walk("missing"), [])
      // With sizes and times: a linked file counts only when it stays inside the project.
      const outside = `${root}-outside.png`
      writeFileSync(outside, "far away")
      symlinkSync(join(root, "elsewhere", "e.png"), join(root, "art", "inside-link.png"))
      symlinkSync(outside, join(root, "art", "outside-link.png"))
      const stats = yield* files.walkStats("art", { skip: (path) => path.endsWith(".scratch") })
      assert.deepEqual(stats.map((file) => [file.path, file.size]), [["art/a.png", 1], ["art/b.png", 1], ["art/inside-link.png", 1], ["art/sub/c.png", 1]])
      assert.ok(stats.every((file) => file.mtimeMs > 0))
      rmSync(outside)
    }))
  })

  it("hashes a file and notices when its bytes change", async () => {
    const root = tempProject({ files: { "x.bin": "one" } })
    await run(root, Effect.gen(function*() {
      const files = yield* ProjectFiles
      const first = yield* files.sha256("x.bin")
      assert.equal(first, "7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed")
      assert.equal(yield* files.sha256("x.bin"), first)
      yield* files.writeText("x.bin", "two!")
      assert.notEqual(yield* files.sha256("x.bin"), first)
    }))
    assert.equal((await failure(root, Effect.flatMap(ProjectFiles, (files) => files.sha256("nope.bin")))).code, "not_found")
  })

  it("holds a lock for a scope, refuses a second holder, and breaks only a dead owner's lock", async () => {
    const root = tempProject()
    await run(root, Effect.gen(function*() {
      const files = yield* ProjectFiles
      yield* Effect.scoped(Effect.gen(function*() {
        yield* files.lock("locks/run.lock")
        const second = yield* Effect.flip(Effect.scoped(files.lock("locks/run.lock")))
        assert.equal(second.code, "locked")
        const live = yield* Effect.flip(files.breakLock("locks/run.lock"))
        assert.equal(live.code, "locked", "the owner is this running process")
      }))
      assert.equal(yield* files.lockHolder("locks/run.lock"), null, "released when the scope closed")
    }))
    // A lock left by a process that no longer exists on this machine.
    write(root, "locks/dead.lock", JSON.stringify({ pid: 2 ** 22 + 7, host: hostname(), at: "2026-01-01T00:00:00.000Z" }))
    write(root, "locks/far.lock", JSON.stringify({ pid: 1, host: "another-machine", at: "2026-01-01T00:00:00.000Z" }))
    await run(root, Effect.gen(function*() {
      const files = yield* ProjectFiles
      assert.equal((yield* files.breakLock("locks/dead.lock")).host, hostname())
      assert.equal(yield* files.lockHolder("locks/dead.lock"), null)
    }))
    assert.equal((await failure(root, Effect.flatMap(ProjectFiles, (files) => files.breakLock("locks/far.lock")))).code, "locked")
  })
})

describe("hash and paths", () => {
  it("digests do not depend on key order or undefined members", () => {
    assert.equal(canonical({ b: 1, a: [2, { d: undefined, c: 3 }] }), "{\"a\":[2,{\"c\":3}],\"b\":1}")
    assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }))
  })
  it("names why a path is not portable", () => {
    assert.equal(portableProblem("Art/Assets/table/model.glb"), null)
    assert.match(portableProblem("Art\\x") ?? "", /forward slashes/)
    assert.match(portableProblem("a/../b") ?? "", /normalized/)
  })
})

describe("decode", () => {
  const Budget = Schema.Struct({
    kind: Schema.Literals(["static", "deforming"]),
    triangles: Schema.Struct({ target: Schema.Int, max: Schema.Int }),
    note: Schema.optionalKey(Schema.String)
  })

  it("accepts a valid value", async () => {
    const value = await Effect.runPromise(decode(Budget, { what: "budget prop" })({ kind: "static", triangles: { target: 1, max: 2 } }))
    assert.equal(value.triangles.max, 2)
  })

  it("reports every problem with its field path in one message", async () => {
    const error = await Effect.runPromise(Effect.flip(decode(Budget, { what: "budget prop", fix: "see docs/settings.md" })({
      kind: "rigid",
      triangles: { target: "many" },
      extra: true
    })))
    assert.equal(error.code, "invalid")
    assert.equal(error.fix, "see docs/settings.md")
    assert.match(error.message, /^budget prop: /)
    assert.match(error.message, /kind: expected "static" \| "deforming"/)
    assert.match(error.message, /triangles\.target: /)
    assert.match(error.message, /triangles\.max: /)
    assert.match(error.message, /extra: /)
  })

  it("publishes a JSON Schema", () => {
    const schema = jsonSchemaOf(Budget, "https://example.invalid/budget.schema.json")
    assert.equal(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
    assert.equal(schema["type"], "object")
  })
})

describe("git and processes", () => {
  it("describes a folder that is not a repository", async () => {
    const root = tempProject()
    const checkout = await run(root, Effect.flatMap(Git, (g) => g.checkout))
    assert.equal(checkout.git, false)
    assert.match(checkout.key, /^nogit:/)
    assert.deepEqual(await run(root, Effect.flatMap(Git, (g) => g.ignored(["a.txt"]))), [])
  })

  it("describes a checkout, counts changes and finds ignored paths", async () => {
    const root = tempProject({ git: true, files: { ".gitignore": "scratch/\n", "kept.txt": "k", "scratch/tmp.txt": "t", ".catalog/notes/n.json": "{}" } })
    await run(root, Effect.gen(function*() {
      const g = yield* Git
      const checkout = yield* g.checkout
      assert.equal(checkout.branch, "main")
      assert.equal(checkout.detached, false)
      assert.equal(yield* g.dirtyCount(), 3)
      assert.equal(yield* g.dirtyCount([".catalog/"]), 2)
      assert.deepEqual(yield* g.ignored(["kept.txt", "scratch/tmp.txt"]), ["scratch/tmp.txt"])
      assert.equal(yield* g.userName, "Test Person")
    }))
    git(root, "checkout", "-q", "--detach")
    const detached = await run(root, Effect.flatMap(Git, (g) => g.checkout))
    assert.equal(detached.detached, true)
    assert.match(detached.key, /:detached@[0-9a-f]{12}$/)
  })

  it("reads the checkout from Git's files: no process, linked worktrees, packed refs, nested folders", async () => {
    const root = tempProject({ git: true, files: { "nested/keep.txt": "k" } })
    const expected = git(root, "rev-parse", "HEAD")
    let spawned = 0
    const counting = Layer.succeed(Process, {
      run: () => Effect.sync(() => { spawned++; return { code: 1, stdout: new Uint8Array(), stderr: "" } }),
      text: () => Effect.die("unused")
    })
    const checkoutOf = (folder: string) =>
      Effect.runPromise(Effect.flatMap(Git, (g) => g.checkout).pipe(
        Effect.provide(Git.layerNoDeps.pipe(Layer.provide(Layer.mergeAll(ProjectFiles.layer(folder), counting))))
      ))
    const main = await checkoutOf(root)
    assert.deepEqual([main.git, main.branch, main.head, main.detached], [true, "main", expected, false])
    git(root, "pack-refs", "--all")
    assert.equal((await checkoutOf(root)).head, expected, "a packed branch still resolves")
    const linked = join(tempProject(), "wt")
    git(root, "worktree", "add", "-q", "-b", "feature/x", linked)
    const other = await checkoutOf(linked)
    assert.deepEqual([other.git, other.branch, other.head], [true, "feature/x", expected])
    assert.notEqual(other.worktree, main.worktree)
    assert.equal((await checkoutOf(join(root, "nested"))).git, false, "a folder inside a repository is not its checkout")
    assert.equal(spawned, 0)
  })

  it("runs a program with an argv array and reports a missing program plainly", async () => {
    const root = tempProject()
    await run(root, Effect.gen(function*() {
      const proc = yield* Process
      const result = yield* proc.run(process.execPath, ["-e", "process.stdout.write(process.argv[1]); process.exit(3)", "a b \"c\" $HOME"])
      assert.equal(result.code, 3)
      assert.equal(Buffer.from(result.stdout).toString(), "a b \"c\" $HOME")
      const missing = yield* Effect.flip(proc.run("jam-no-such-program", []))
      assert.equal(missing.code, "unavailable")
      assert.match(missing.message, /not installed or not on PATH/)
    }))
  })

  it("gives counting ids in tests", async () => {
    const root = tempProject()
    assert.deepEqual(
      await run(root, Effect.gen(function*() {
        const ids = yield* Ids
        return [yield* ids.next("nt"), yield* ids.next("sub"), yield* ids.uuid]
      })),
      ["nt_0001", "sub_0002", "00000000-0000-4000-8000-000000000003"]
    )
  })
})

describe("command edge", () => {
  it("reads --root and --json before parsing, and stops at --", () => {
    assert.deepEqual(edgeArgs(["run", "status", "--root", "/p", "--json"], {}), { root: "/p", json: true })
    assert.deepEqual(edgeArgs(["--root=/q", "x"], {}), { root: "/q", json: false })
    assert.deepEqual(edgeArgs(["blender", "--", "--json"], { JAM_ROOT: "/env" }), { root: "/env", json: false })
  })

  it("passes everything after a launcher's script to the script, dashes included", () => {
    assert.deepEqual(launcherArgv(["python", "s.py", "--out", "x"]), ["python", "s.py", "--", "--out", "x"])
    assert.deepEqual(launcherArgv(["--root", "/p", "blender", "--factory-startup", "s.py", "a", "--b"]), ["--root", "/p", "blender", "--factory-startup", "s.py", "--", "a", "--b"])
    assert.deepEqual(launcherArgv(["python", "s.py", "--", "--out"]), ["python", "s.py", "--", "--out"], "an explicit -- is kept as typed")
    assert.deepEqual(launcherArgv(["python", "s.py"]), ["python", "s.py"])
    assert.deepEqual(launcherArgv(["run", "record", "a", "concept", "--note", "x"]), ["run", "record", "a", "concept", "--note", "x"])
  })

  it("finds the project from a nested folder by its configuration file", () => {
    const root = tempProject({ files: { "jam.config.json": "{}", "Art/deep/x.txt": "x" } })
    assert.equal(projectRoot(undefined, join(root, "Art", "deep")), root)
    assert.equal(projectRoot("Art", root), join(root, "Art"))
    assert.throws(() => projectRoot("nowhere", root), /does not exist/)
  })
})
