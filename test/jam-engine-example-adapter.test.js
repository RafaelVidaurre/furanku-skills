"use strict";

// The example adapter in the jam-engine skill is the starting point for new adapters: its commands must keep
// returning receipts that follow the contract (one JSON object, project-relative paths, a stable id on reimport).
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ADAPTER = path.join(__dirname, "..", "skills", "jam-engine", "assets", "example-adapter");

function glb(json) {
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jam-engine-example-"));
  fs.mkdirSync(path.join(dir, "Art"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Art", "barrel.glb"), glb({
    asset: { version: "2.0" },
    accessors: [{ count: 24, type: "VEC3", componentType: 5126, min: [-0.3, 0, -0.3], max: [0.3, 0.9, 0.3] }, { count: 36, type: "SCALAR", componentType: 5123 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: "Oak" }],
  }));
  return dir;
}

function run(dir, script, ...args) {
  const done = spawnSync(process.execPath, [path.join(ADAPTER, "commands", script), ...args], {
    cwd: dir, encoding: "utf8", env: { ...process.env, JAM_PROJECT_ROOT: dir, JAM_ADAPTER_DIR: ADAPTER },
  });
  const lines = done.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `one JSON object on standard output, got: ${done.stdout}`);
  return { status: done.status, receipt: JSON.parse(lines[0]), stderr: done.stderr };
}

test("import returns ids with source and hash, and the same id on reimport", () => {
  const dir = project();
  const first = run(dir, "import.mjs", "--kind", "static", "Art/barrel.glb");
  assert.equal(first.status, 0, first.stderr);
  const [asset] = first.receipt.assets;
  assert.deepEqual(Object.keys(asset).sort(), ["id", "kind", "sha256", "source"]);
  assert.equal(asset.id, "assets/static/barrel.glb");
  assert.equal(asset.source, "Art/barrel.glb");
  assert.match(asset.sha256, /^[0-9a-f]{64}$/);
  assert.equal(run(dir, "import.mjs", "--kind", "static", "Art/barrel.glb").receipt.assets[0].id, asset.id);
});

test("import refuses a path outside the project with a non-zero exit and one JSON object", () => {
  const refused = run(project(), "import.mjs", "--kind", "static", "/tmp/barrel.glb");
  assert.equal(refused.status, 1);
  assert.match(refused.receipt.error.message, /project-relative/);
});

test("inspect reads bounds in meters, counts and material slots from the imported file", () => {
  const dir = project();
  run(dir, "import.mjs", "--kind", "static", "Art/barrel.glb");
  const { status, receipt } = run(dir, "inspect.mjs", "assets/static/barrel.glb");
  assert.equal(status, 0);
  assert.deepEqual(receipt, { id: "assets/static/barrel.glb", kind: "static", bounds: { min: [-0.3, 0, -0.3], max: [0.3, 0.9, 0.3] }, pivot: [0, 0, 0], triangles: 12, vertices: 24, materials: ["Oak"] });
});

test("references lists the game data that names an asset", () => {
  const dir = project();
  run(dir, "import.mjs", "--kind", "static", "Art/barrel.glb");
  fs.writeFileSync(path.join(dir, "game", "saloon.json"), JSON.stringify({ props: ["assets/static/barrel.glb"] }));
  fs.writeFileSync(path.join(dir, "game", "bank.json"), JSON.stringify({ props: [] }));
  assert.deepEqual(run(dir, "references.mjs", "assets/static/barrel.glb").receipt, { references: [{ id: "assets/static/barrel.glb", referencers: ["game/saloon.json"] }] });
});

test("check passes after import and reports an asset changed behind its source record", () => {
  const dir = project();
  run(dir, "import.mjs", "--kind", "static", "Art/barrel.glb");
  assert.deepEqual(run(dir, "check.mjs").receipt, { problems: [] });
  fs.appendFileSync(path.join(dir, "game", "assets", "static", "barrel.glb"), "x");
  const { status, receipt } = run(dir, "check.mjs");
  assert.equal(status, 0);
  assert.match(receipt.problems[0].message, /no longer matches its source Art\/barrel.glb/);
});

test("adapter.json names a script or a guide for every verb", () => {
  const adapter = JSON.parse(fs.readFileSync(path.join(ADAPTER, "adapter.json"), "utf8"));
  for (const [verb, command] of Object.entries(adapter.commands)) {
    if (command === null) continue;
    assert.ok(fs.existsSync(path.join(ADAPTER, command.run[1])), `${verb}: ${command.run[1]}`);
  }
  for (const file of Object.values(adapter.docs)) assert.ok(fs.existsSync(path.join(ADAPTER, file)), file);
  assert.ok(adapter.docs.capture, "a verb without a command has its by-hand guide");
});
