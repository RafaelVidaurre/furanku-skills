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
    env: opts.env || process.env,
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

test("catalogBrowseTree nests entries under categories", () => {
  const { loadCatalog, CATALOG_PATH } = require("../lib/catalog");
  const { catalogBrowseTree, collectLeafIds } = require("../lib/cli");
  const catalog = loadCatalog(CATALOG_PATH);
  const tree = catalogBrowseTree(catalog);
  assert.ok(tree.length >= 1);
  const simplicity = tree.find((n) => n.id === "simplicity");
  assert.ok(simplicity);
  assert.ok(simplicity.children.some((c) => c.id === "simplest-current"));
  const allLeaves = tree.flatMap(collectLeafIds);
  assert.ok(allLeaves.includes("prefer-libraries"));
  assert.ok(allLeaves.includes("no-backward-compat"));
  assert.equal(new Set(allLeaves).size, catalog.entries.length);
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
      "--harness",
      "agents",
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
      "--harness",
      "agents",
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

test("resolveScopeAndRoot defaults to project cwd", () => {
  const { resolveScopeAndRoot } = require("../lib/cli");
  const r = resolveScopeAndRoot({});
  assert.equal(r.scope, "project");
  assert.equal(r.root, path.resolve(process.cwd()));
  assert.equal(r.defaultInstructionName, "AGENTS.md");
});

test("resolveScopeAndRoot global uses ~/.codex", () => {
  const { resolveScopeAndRoot, defaultGlobalRoot } = require("../lib/cli");
  const r = resolveScopeAndRoot({ scope: "global" });
  assert.equal(r.scope, "global");
  assert.equal(r.root, defaultGlobalRoot());
  assert.equal(r.defaultInstructionName, "AGENTS.md");
  // $CODEX_HOME relocates the Codex home (lib/harnesses.js), so the ~/.codex
  // layout only holds when it is unset.
  if (!process.env.CODEX_HOME) {
    assert.ok(r.root.endsWith(".codex") || r.root.endsWith(`${path.sep}.codex`));
  }
});

test("cli inject --scope global into temp HOME/.codex/AGENTS.md", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gc-home-"));
  const agentsDir = path.join(home, ".codex");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, "AGENTS.md"),
    "# AGENTS.md\n\nUser rules.\n",
    "utf8"
  );
  const result = run(
    [
      "inject",
      "--ids",
      "ui-descriptions",
      "--mode",
      "inline",
      "--scope",
      "global",
      "--harness",
      "agents",
      "--yes",
    ],
    {
      cwd: home,
      // CODEX_HOME must be pinned to the temp dir: the CLI honors it over
      // $HOME/.codex, so inheriting a real one writes to the user's own config.
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CODEX_HOME: agentsDir,
      },
    }
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /scope\s+global|scope: global/);
  const agents = fs.readFileSync(path.join(agentsDir, "AGENTS.md"), "utf8");
  assert.match(agents, /managed-by: guidance-composer/);
  assert.match(agents, /Do not add subtitles, helper text/);
  assert.match(agents, /## User guidance/);
  assert.match(agents, /User rules/);
});

test("cli diff --scope global reports scope", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gc-diff-global-"));
  const agentsDir = path.join(home, ".codex");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, "AGENTS.md"), "# AGENTS.md\n", "utf8");
  run(
    [
      "inject",
      "--ids",
      "prefer-libraries",
      "--mode",
      "inline",
      "--scope",
      "global",
      "--harness",
      "agents",
      "--yes",
    ],
    {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CODEX_HOME: agentsDir,
      },
    }
  );
  const diff = run(["diff", "--scope", "global", "--json"], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: agentsDir,
    },
  });
  assert.equal(diff.status, 0, diff.stderr);
  const report = JSON.parse(diff.stdout);
  assert.equal(report.scope, "global");
  assert.deepEqual(report.present, ["prefer-libraries"]);
});

test("discoverHarnessTargets global maps Codex/Claude/Gemini; Cursor is limitations-only", () => {
  const {
    discoverHarnessTargets,
    defaultGlobalRoot,
  } = require("../lib/harnesses");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gc-global-map-"));
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  const prevCodex = process.env.CODEX_HOME;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEX_HOME;
  try {
    const codexRoot = path.join(home, ".codex");
    assert.equal(defaultGlobalRoot(), codexRoot);

    const found = discoverHarnessTargets("global", codexRoot);
    const agents = found.targets.find((t) => t.id === "agents");
    assert.ok(agents);
    assert.equal(agents.path, path.join(codexRoot, "AGENTS.md"));
    assert.equal(agents.defaultSelected, true);
    // Global always offers createable Claude + Gemini (opt-in, not default)
    const claudeMissing = found.targets.find((t) => t.id === "claude");
    const geminiMissing = found.targets.find((t) => t.id === "gemini");
    assert.ok(claudeMissing);
    assert.ok(geminiMissing);
    assert.equal(claudeMissing.path, path.join(home, ".claude", "CLAUDE.md"));
    assert.equal(geminiMissing.path, path.join(home, ".gemini", "GEMINI.md"));
    assert.equal(claudeMissing.defaultSelected, false);
    assert.equal(geminiMissing.defaultSelected, false);
    assert.ok(found.limitations.some((n) => /Cursor/i.test(n)));
    assert.ok(found.limitations.some((n) => /shared|~\.?\/?agents/i.test(n)));

    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "CLAUDE.md"),
      "# CLAUDE.md\n",
      "utf8"
    );
    const withClaude = discoverHarnessTargets("global", codexRoot);
    const claude = withClaude.targets.find((t) => t.id === "claude");
    assert.ok(claude);
    assert.equal(claude.exists, true);
    assert.equal(claude.defaultSelected, true);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    if (prevCodex === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodex;
  }
});

test("defaultGlobalRoot respects CODEX_HOME", () => {
  const { defaultGlobalRoot } = require("../lib/harnesses");
  const custom = fs.mkdtempSync(path.join(os.tmpdir(), "gc-codex-home-"));
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = custom;
  try {
    assert.equal(defaultGlobalRoot(), path.resolve(custom));
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
  }
});

test("project offers gemini only when real GEMINI.md exists", () => {
  const { discoverHarnessTargets } = require("../lib/harnesses");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-gemini-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# AGENTS.md\n", "utf8");
  let found = discoverHarnessTargets("project", dir);
  assert.ok(found.targets.some((t) => t.id === "agents"));
  assert.ok(!found.targets.some((t) => t.id === "gemini"));

  fs.writeFileSync(path.join(dir, "GEMINI.md"), "# GEMINI.md\n", "utf8");
  found = discoverHarnessTargets("project", dir);
  const gem = found.targets.find((t) => t.id === "gemini");
  assert.ok(gem);
  assert.equal(gem.path, path.join(dir, "GEMINI.md"));
  assert.equal(gem.defaultSelected, true);
});

test("cli inject --scope global --harness gemini writes ~/.gemini/GEMINI.md", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gc-gemini-home-"));
  const result = run(
    [
      "inject",
      "--ids",
      "prefer-libraries",
      "--mode",
      "inline",
      "--scope",
      "global",
      "--harness",
      "gemini",
      "--yes",
    ],
    { env: { ...process.env, HOME: home, USERPROFILE: home } }
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const gemini = fs.readFileSync(
    path.join(home, ".gemini", "GEMINI.md"),
    "utf8"
  );
  assert.match(gemini, /managed-by: guidance-composer/);
  assert.match(gemini, /well-maintained libraries/);
});

test("discoverHarnessTargets offers standalone CLAUDE.md, not symlink", () => {
  const {
    discoverHarnessTargets,
    inspectInstructionFile,
  } = require("../lib/harnesses");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-harness-"));
  const agents = path.join(dir, "AGENTS.md");
  const claude = path.join(dir, "CLAUDE.md");
  fs.writeFileSync(agents, "# AGENTS.md\n", "utf8");
  fs.writeFileSync(claude, "# CLAUDE.md\nstandalone\n", "utf8");

  const found = discoverHarnessTargets("project", dir);
  assert.ok(found.targets.some((t) => t.id === "agents"));
  assert.ok(found.targets.some((t) => t.id === "claude"));
  assert.equal(found.notes.length, 0);

  fs.unlinkSync(claude);
  fs.symlinkSync("AGENTS.md", claude);
  const linked = discoverHarnessTargets("project", dir);
  assert.ok(linked.targets.some((t) => t.id === "agents"));
  assert.ok(!linked.targets.some((t) => t.id === "claude"));
  assert.ok(linked.notes.some((n) => /CLAUDE\.md/i.test(n)));
  assert.equal(
    inspectInstructionFile(claude, agents).status,
    "symlink-to-agents"
  );
});

test("cli inject requires --harness non-interactively", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-need-harness-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# AGENTS.md\n", "utf8");
  const result = run(
    [
      "inject",
      "--ids",
      "simplest-current",
      "--mode",
      "inline",
      "--root",
      dir,
      "--yes",
    ],
    { cwd: dir }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /requires --harness/);
});

test("cli inject writes both AGENTS.md and standalone CLAUDE.md when both listed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-both-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# AGENTS.md\n", "utf8");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# CLAUDE.md\n", "utf8");
  const result = run(
    [
      "inject",
      "--ids",
      "simplest-current",
      "--mode",
      "inline",
      "--harness",
      "agents,claude",
      "--root",
      dir,
      "--yes",
    ],
    { cwd: dir }
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /harnesses\s+agents, claude/);
  const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  const claude = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
  assert.match(agents, /simplest implementation/);
  assert.match(claude, /simplest implementation/);
});

test("cli inject --harness agents skips standalone CLAUDE.md", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-agents-only-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# AGENTS.md\n", "utf8");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# CLAUDE.md\nkeep me\n", "utf8");
  const result = run(
    [
      "inject",
      "--ids",
      "prefer-libraries",
      "--mode",
      "inline",
      "--harness",
      "agents",
      "--root",
      dir,
      "--yes",
    ],
    { cwd: dir }
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /harnesses\s+agents\b/);
  assert.match(
    fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"),
    /well-maintained libraries/
  );
  assert.match(
    fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"),
    /keep me/
  );
  assert.ok(
    !fs
      .readFileSync(path.join(dir, "CLAUDE.md"), "utf8")
      .includes("well-maintained libraries")
  );
});

process.stdout.write("\nAll tests passed.\n");
