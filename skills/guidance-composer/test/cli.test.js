"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BIN = path.join(ROOT, "bin", "guidance-composer.js");
const {
  loadCatalog,
  resolveIds,
  conflictPairs,
  injectLines,
} = require("../lib/catalog");
const {
  findManagedRegion,
  mergeInject,
  matchCatalogIds,
  bulletsFromInterior,
} = require("../lib/merge");

function run(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    cwd: opts.cwd || ROOT,
    input: opts.input,
    env: process.env,
  });
}

function test(name, fn) {
  try {
    fn();
    printOk(name);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

function printOk(name) {
  process.stdout.write(`ok ${name}\n`);
}

test("catalog loads with categories", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.version, 1);
  assert.ok(catalog.categories.length >= 1);
  assert.ok(catalog.entries.length >= 1);
  for (const e of catalog.entries) {
    assert.ok(
      catalog.categories.some((c) => c.id === e.category),
      e.id
    );
  }
});

test("resolveIds accepts titles", () => {
  const catalog = loadCatalog();
  const { ids, unknown } = resolveIds(catalog, [
    "no-backward-compat",
    "Prefer maintained libraries",
  ]);
  assert.deepEqual(unknown, []);
  assert.ok(ids.includes("no-backward-compat"));
  assert.ok(ids.includes("prefer-libraries"));
});

test("closed managed region round-trip", () => {
  const catalog = loadCatalog();
  const lines = injectLines(catalog, ["simplest-current"]);
  const text = mergeInject({
    existingText: "",
    injectBulletLines: lines,
    mode: "replace",
  });
  const region = findManagedRegion(text);
  assert.ok(region);
  assert.equal(region.closed, true);
  assert.ok(text.includes("<!-- managed-by: guidance-composer -->"));
  assert.ok(text.includes("<!-- /managed-by: guidance-composer -->"));
  const present = matchCatalogIds(bulletsFromInterior(region.interior), catalog);
  assert.deepEqual(present, ["simplest-current"]);
});

test("add does not duplicate; leaves trailing notes", () => {
  const catalog = loadCatalog();
  const first = mergeInject({
    existingText: "",
    injectBulletLines: injectLines(catalog, ["simplest-current"]),
  });
  const withNote = first.replace(
    "<!-- /managed-by: guidance-composer -->",
    "<!-- /managed-by: guidance-composer -->\n\nProject-specific: keep the monolith for now.\n"
  );
  const second = mergeInject({
    existingText: withNote,
    injectBulletLines: injectLines(catalog, [
      "simplest-current",
      "no-backward-compat",
    ]),
    mode: "add",
  });
  assert.ok(second.includes("Project-specific: keep the monolith for now."));
  assert.equal(
    (second.match(/Do not preserve backward compatibility/g) || []).length,
    1
  );
  assert.equal(
    (second.match(/simplest implementation that fully meets/g) || []).length,
    1
  );
});

test("legacy open-only region upgrades on write", () => {
  const catalog = loadCatalog();
  const legacy = `## Project guidance\n\n<!-- managed-by: project-guidance -->\n- Do not preserve backward compatibility.\n\n## Other\n\nstuff\n`;
  const next = mergeInject({
    existingText: legacy,
    injectBulletLines: injectLines(catalog, ["simplest-current"]),
    mode: "add",
  });
  assert.ok(next.includes("<!-- managed-by: guidance-composer -->"));
  assert.ok(next.includes("<!-- /managed-by: guidance-composer -->"));
  assert.ok(next.includes("## Other"));
  assert.ok(next.includes("stuff"));
});

test("cli list and show", () => {
  const list = run(["list"]);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /simplicity/);
  assert.match(list.stdout, /no-backward-compat/);

  const show = run(["show", "prefer-libraries", "--json"]);
  assert.equal(show.status, 0, show.stderr);
  const data = JSON.parse(show.stdout);
  assert.equal(data.id, "prefer-libraries");
});

test("cli inject non-interactive into temp project", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-"));
  fs.writeFileSync(
    path.join(dir, "AGENTS.md"),
    "# AGENTS.md\n\nRepo rules.\n",
    "utf8"
  );
  const result = run(
    [
      "inject",
      "--ids",
      "simplest-current,no-backward-compat",
      "--mode",
      "inline",
      "--root",
      dir,
      "--yes",
    ],
    { cwd: dir }
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /managed-by: guidance-composer/);
  assert.match(agents, /\/managed-by: guidance-composer/);
  assert.match(agents, /Do not preserve backward compatibility/);
  assert.match(agents, /simplest implementation/);
  assert.match(agents, /Repo rules/);
});

test("cli diff json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-diff-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# AGENTS.md\n", "utf8");
  run(
    [
      "inject",
      "--ids",
      "long-term-architecture",
      "--mode",
      "inline",
      "--root",
      dir,
      "--yes",
    ],
    { cwd: dir }
  );
  const diff = run(["diff", "--root", dir, "--json"]);
  assert.equal(diff.status, 0, diff.stderr);
  const report = JSON.parse(diff.stdout);
  assert.deepEqual(report.present, ["long-term-architecture"]);
  assert.ok(report.not_injected.includes("simplest-current"));
});

test("conflictPairs empty for current catalog", () => {
  const catalog = loadCatalog();
  assert.deepEqual(
    conflictPairs(
      catalog,
      catalog.entries.map((e) => e.id)
    ),
    []
  );
});

process.stdout.write("\nAll tests passed.\n");
