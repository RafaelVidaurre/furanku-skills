import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, it } from "node:test"
import { diagnose, type DoctorLine } from "../../src/jam/doctor.ts"
import { openJob } from "../../src/jam/runs/jobs.ts"
import { Toolkit } from "../../src/jam/Toolkit.ts"
import { tempProject } from "../support.ts"
import { cli, jam, jamProject, TOOLKIT, write } from "./fixtures.ts"
import { start } from "./flow.ts"

const report = async (root: string, options?: Parameters<typeof jam>[2]): Promise<Record<string, DoctorLine>> =>
  Object.fromEntries((await jam(root, diagnose, options)).map((line) => [line.check, line]))

describe("doctor", () => {
  it("reports every dependency in one list, each line with a status, and a fix wherever something is wrong", async () => {
    const root = jamProject({ git: true })
    const lines = await jam(root, diagnose)
    const checks = lines.map((line) => line.check)
    for (const expected of ["toolkit", "node", "packages", "python", "blender", "ffmpeg", "git", "configuration", "machine paths", "recipes", "provider meshy", "provider scenario", "provider codex", "engine", "jobs", "locks"]) {
      assert.ok(checks.includes(expected), `${expected} in ${checks.join(", ")}`)
    }
    for (const line of lines) {
      assert.ok(["ok", "info", "warn", "fail"].includes(line.status))
      if (line.status === "warn" || line.status === "fail") assert.ok(line.fix, `${line.check} (${line.status}) says what to do`)
    }
    const byCheck = Object.fromEntries(lines.map((line) => [line.check, line]))
    assert.deepEqual([byCheck["toolkit"]!.status, byCheck["node"]!.status, byCheck["packages"]!.status, byCheck["configuration"]!.status, byCheck["recipes"]!.status, byCheck["jobs"]!.status, byCheck["locks"]!.status], ["ok", "ok", "ok", "ok", "ok", "ok", "ok"])
    assert.match(byCheck["packages"]!.detail, /npm packages installed \(measurement and the catalog need them\)/)
    assert.match(byCheck["engine"]!.detail, /gltf \(no engine chosen\); engine steps are skipped or done by hand/)
    assert.match(byCheck["provider meshy"]!.detail, /installed (yes|no), authenticated unknown, reachable unknown; per run 10, total 25 Meshy credits; routed|installed/)
    const printed = cli(root, "doctor")
    assert.equal(printed.status, 0)
    assert.match(printed.stdout, /^\s+check\s+detail\nOK\s+toolkit\s+version \d/)
  })

  it("names missing measurement dependencies: npm packages and the Python imaging packages", { skip: process.platform === "win32" ? "uses a shell script as the stand-in Python" : false }, async () => {
    const root = jamProject({ files: { "bin/python": `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Python 3.12.1"; exit 0; fi\necho "ModuleNotFoundError: No module named 'PIL'" >&2\nexit 1\n`, "jam.local.json": JSON.stringify({ python: "bin/python", blender: "bin/absent-blender" }) } })
    chmodSync(join(root, "bin/python"), 0o755)
    const lines = await report(root)
    assert.deepEqual([lines["python"]!.status, lines["python"]!.detail], ["ok", `${join(root, "bin/python")}: Python 3.12.1`])
    assert.equal(lines["python imaging"]!.status, "warn")
    assert.match(lines["python imaging"]!.detail, /Pillow or numpy is missing; turnaround cropping and the side-view check cannot run/)
    assert.match(lines["python imaging"]!.fix!, /-m pip install -r .*requirements\.txt/)
    assert.deepEqual([lines["blender"]!.status, /set "blender" in jam\.local\.json/.test(lines["blender"]!.fix!)], ["warn", true])
    // A toolkit folder whose packages were never installed.
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "jam-toolkit-")))
    after(() => rmSync(bare, { recursive: true, force: true }))
    write(bare, "package.json", JSON.stringify({ version: "2.0.0", dependencies: { effect: "4.1.4", "some-decoder": "1.0.0" } }))
    const missing = await report(root, { toolkit: Toolkit.layerAt(bare) })
    assert.equal(missing["packages"]!.status, "fail")
    assert.match(missing["packages"]!.detail, /not installed: effect@4\.1\.4, some-decoder@1\.0\.0; models cannot be measured without them/)
    assert.match(missing["packages"]!.fix!, /npm ci --ignore-scripts/)
  })

  it("flags a missing or version 1 configuration, broken recipes, unsettled jobs, stale locks and unreadable run files", async () => {
    const unconfigured = await report(tempProject())
    assert.deepEqual([unconfigured["configuration"]!.status, unconfigured["engine"], unconfigured["jobs"]], ["fail", undefined, undefined])
    assert.match(unconfigured["configuration"]!.fix!, /jam setup/)
    const old = await report(tempProject({ files: { "jam.config.json": JSON.stringify({ version: 1 }) } }))
    assert.match(old["configuration"]!.fix!, /jam config migrate/)

    const root = jamProject({ files: { "work/request.json": "{}", "jam/recipes/broken.json": JSON.stringify({ version: 1, id: "broken", steps: [{ id: "a", needs: ["ghost"] }] }) } })
    await start(root, "asset", "barrel")
    await jam(root, openJob({ run: "barrel", step: "concept", provider: "meshy", operation: "image", estimate: 1, request: "work/request.json", price: "estimate", priceSource: "page", authorized: "Sam" }))
    write(root, "work/.scratch/barrel/1/run.json.lock", JSON.stringify({ pid: 2 ** 22 + 13, host: hostname(), at: "2026-11-15T08:00:00.000Z" }))
    write(root, "work/.scratch/chair/1/run.json", "{ not json")
    const lines = await jam(root, diagnose)
    const find = (check: string) => lines.filter((line) => line.check === check)
    assert.match(find("recipes")[0]!.detail, /1 problem: recipe project:broken: step a needs ghost/)
    assert.deepEqual([find("jobs")[0]!.status, find("jobs")[0]!.detail], ["warn", "1 unsettled: barrel:1 j1 (open)"])
    assert.match(find("lock")[0]!.detail, /run\.json\.lock was left by process \d+, which is gone/)
    assert.equal(find("lock")[0]!.fix, "jam run unlock barrel:1")
    assert.match(find("run file")[0]!.detail, /work\/\.scratch\/chair\/1\/run\.json: .*not valid JSON/)
    const result = cli(root, "doctor", "--json").json<{ ok: boolean; failing: number }>()
    assert.deepEqual([result.ok, result.failing >= 2], [false, true])
    assert.ok(TOOLKIT.length > 0)
  })
})
