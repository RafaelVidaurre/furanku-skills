"use strict";

// The clip spec has one definition: the jam toolkit's schema and its filter (src/jam/animation/clip.ts).
// jam-3d-animate reads the same file without the toolkit, so its reader must accept and refuse exactly
// what the toolkit does. Both are held to the fixtures in test/fixtures/clip-specs: the toolkit by its
// own suite (test/jam/animation.test.ts), the reader here.
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures", "clip-specs");
const READER = path.join(ROOT, "skills", "jam-3d-animate", "scripts", "clip_spec.py");

const fixtures = (kind) => fs.readdirSync(path.join(FIXTURES, kind)).filter((name) => name.endsWith(".json")).sort();
const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
const noPython = python.error || python.status !== 0 ? "python3 is not available" : false;

test("the shared fixtures cover the cases both readers must agree on", () => {
  assert.ok(fixtures("valid").includes("poses-at-the-same-time.json"), "poses may share a time");
  for (const name of ["duplicate-pose-names", "poses-out-of-time-order", "pose-past-length-max", "fps-overflows-to-infinity", "threshold-nan",
    "length-infinity", "detect-null", "key-poses-null", "contacts-null", "planted-null", "root-bone-null", "unknown-top-key", "unknown-accept-key",
    "unknown-rig-key", "unknown-pose-key", "unknown-detect-key", "planted-from-after-to", "id-trailing-newline", "path-trailing-newline",
    "schema-not-a-string", "loop-seam-without-loop", "loop-without-loop-seam", "bone-with-in-place"]) {
    assert.ok(fixtures("invalid").includes(`${name}.json`), `invalid/${name}.json exists`);
  }
});

for (const kind of ["valid", "invalid"]) {
  test(`jam-3d-animate's clip_spec.py ${kind === "valid" ? "accepts" : "refuses"} every ${kind} fixture`, { skip: noPython }, () => {
    const wrong = [];
    for (const name of fixtures(kind)) {
      const run = spawnSync("python3", ["-I", READER, "--no-files", path.join(FIXTURES, kind, name)], { cwd: ROOT, encoding: "utf8" });
      if ((run.status === 0) !== (kind === "valid")) wrong.push(`${name}: exit ${run.status} ${(run.stdout + run.stderr).trim().split("\n").slice(-2).join(" ")}`);
    }
    assert.deepStrictEqual(wrong, []);
  });
}
