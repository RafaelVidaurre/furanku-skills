"use strict";

// jam-setup's installer vendors the toolkit into a project. Hermetic: --no-deps --no-lfs, temp projects only.
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const INSTALL = path.join(__dirname, "..", "skills", "jam-setup", "scripts", "install.mjs");

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-setup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function install(root, ...args) {
  const result = spawnSync(process.execPath, [INSTALL, "--project", root, "--no-deps", "--no-lfs", ...args], { encoding: "utf8", env: { ...process.env, HOME: root } });
  return { ...result, json: result.status === 0 ? JSON.parse(result.stdout) : null };
}
const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");

test("fresh install vendors the toolkit and project wiring; a rerun changes nothing", (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
  const first = install(root);
  assert.strictEqual(first.status, 0, first.stderr);
  assert.strictEqual(first.json.installed, "installed");
  for (const file of ["jam.mjs", "core.mjs", "catalog/bin/catalog.mjs", "catalog-adapter.mjs", "docs/contracts.md", ".jam-toolkit.json", ".gitignore"]) {
    assert.ok(fs.existsSync(path.join(root, "tools/jam", file)), file);
  }
  assert.ok(!fs.existsSync(path.join(root, "tools/jam/test")), "toolkit tests stay in the skill");
  assert.strictEqual(JSON.parse(read(root, "catalog.config.json")).adapter, "./tools/jam/catalog-adapter.mjs");
  assert.ok(JSON.parse(read(root, "Art/catalog.json")).types["external-asset"]);
  assert.match(read(root, ".gitignore"), /^dist\/\n\n# >>> jam toolkit\n\/Art\/\.scratch\//);
  assert.strictEqual(first.json.doctor.configuration, "missing");

  const before = read(root, ".gitignore");
  const second = install(root);
  assert.strictEqual(second.status, 0, second.stderr);
  assert.strictEqual(second.json.installed, "reinstalled (unchanged)");
  assert.strictEqual(read(root, ".gitignore"), before);
});

test("upgrade refuses to overwrite local toolkit edits unless forced", (t) => {
  const root = project(t);
  assert.strictEqual(install(root).status, 0);
  const core = path.join(root, "tools/jam/core.mjs");
  const original = fs.readFileSync(core, "utf8");
  fs.appendFileSync(core, "// local change\n");
  const check = spawnSync(process.execPath, [INSTALL, "--project", root, "--check"], { encoding: "utf8" });
  assert.deepStrictEqual(JSON.parse(check.stdout).locallyModified, ["core.mjs"]);
  const refused = install(root);
  assert.strictEqual(refused.status, 1);
  assert.match(refused.stderr, /locally edited toolkit files would be overwritten: core\.mjs/);
  assert.notStrictEqual(fs.readFileSync(core, "utf8"), original);
  assert.strictEqual(install(root, "--force").status, 0);
  assert.strictEqual(fs.readFileSync(core, "utf8"), original);
});

test("a tools/jam folder the installer did not create is left alone", (t) => {
  const root = project(t);
  fs.mkdirSync(path.join(root, "tools/jam"), { recursive: true });
  fs.writeFileSync(path.join(root, "tools/jam/mine.txt"), "someone else's");
  const result = install(root);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /not installed by jam-setup/);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, "tools/jam")), ["mine.txt"]);
});

test("a built-in manifest adapter moves to the jam adapter keeping its manifest and settings", (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, "catalog.config.json"), JSON.stringify({ version: 1, adapter: "manifest", options: { manifest: "content.json" }, review: { resolver: "strictest" } }));
  fs.writeFileSync(path.join(root, "content.json"), '{"version":1}\n');
  const result = install(root);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.json.catalogConfig, /switched from the built-in manifest adapter/);
  assert.deepStrictEqual(JSON.parse(read(root, "catalog.config.json")), { version: 1, adapter: "./tools/jam/catalog-adapter.mjs", options: { manifest: "content.json" }, review: { resolver: "strictest" } });
  assert.strictEqual(read(root, "content.json"), '{"version":1}\n');
  assert.ok(!fs.existsSync(path.join(root, "Art/catalog.json")), "no second manifest");
});

test("a custom catalog adapter is kept and reported as incomplete", (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, "catalog.config.json"), '{"version":1,"adapter":"./mine.mjs"}\n');
  const result = install(root);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.json.catalogConfig, /^incomplete: custom adapter \.\/mine\.mjs kept/);
  assert.strictEqual(read(root, "catalog.config.json"), '{"version":1,"adapter":"./mine.mjs"}\n');
  assert.ok(result.json.next.some((step) => step.includes("custom catalog adapter")));
});

test("files the toolkit newly ships never overwrite someone else's file, and user ignore lines survive", (t) => {
  const root = project(t);
  assert.strictEqual(install(root).status, 0);
  const markerFile = path.join(root, "tools/jam/.jam-toolkit.json");
  const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
  delete marker.files["pack-glb.mjs"]; marker.digest = "older";   // an older toolkit that did not ship this file
  fs.writeFileSync(markerFile, JSON.stringify(marker));
  fs.writeFileSync(path.join(root, "tools/jam/pack-glb.mjs"), "// mine\n");
  fs.appendFileSync(path.join(root, "tools/jam/.gitignore"), "my-cache/\n");
  const refused = install(root);
  assert.strictEqual(refused.status, 1);
  assert.match(refused.stderr, /already exist with other content: pack-glb\.mjs/);
  assert.strictEqual(read(root, "tools/jam/pack-glb.mjs"), "// mine\n");
  fs.rmSync(path.join(root, "tools/jam/pack-glb.mjs"));
  const upgraded = install(root);
  assert.strictEqual(upgraded.status, 0, upgraded.stderr);
  assert.strictEqual(upgraded.json.installed, "upgraded");
  assert.match(read(root, "tools/jam/.gitignore"), /my-cache\//);
  assert.match(read(root, "tools/jam/.gitignore"), /node_modules\//);
});

test("--check reports without writing", (t) => {
  const root = project(t);
  const result = spawnSync(process.execPath, [INSTALL, "--project", root, "--check"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(JSON.parse(result.stdout).installed, "absent");
  assert.deepStrictEqual(fs.readdirSync(root), []);
});
