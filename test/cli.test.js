"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BIN = path.join(ROOT, "bin", "furanku-skills.js");

function run(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    cwd: opts.cwd || ROOT,
    env: { ...process.env, NO_COLOR: "1", ...(opts.env || {}) },
    input: opts.input,
  });
}

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`ok ${name}\n`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("root help shows banner and init", () => {
  const result = run(["help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FURANKU|Furanku|██████/);
  assert.match(result.stdout, /furanku-skills/);
  assert.match(result.stdout, /\binit\b/);
  assert.match(result.stdout, /agents-md/);
  assert.match(result.stdout, /guidance-composer/);
});

test("no-args without TTY shows help (not hang on menu)", () => {
  const result = run([], { env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /furanku-skills/);
  assert.match(result.stdout, /init/);
  // spawnSync has no TTY, so menu is skipped in favor of help
  assert.match(result.stdout, /No TTY|Interactive menu|Get started/i);
});

test("menu entries include setup paths", () => {
  const { menuEntries } = require("../lib/cli");
  const ids = menuEntries([process.execPath, BIN]).map((e) => e.id);
  assert.deepEqual(ids, [
    "init",
    "agents-md",
    "guidance-composer",
    "help",
    "exit",
  ]);
});

test("menu selection runs agents-md via dispatch path", () => {
  // Simulate choosing option 2 (agents-md) then confirming isn't needed with --yes
  // Direct command still works; menu is covered by menuEntries + no-args fallback.
  const dir = tmpDir("fs-menu-");
  const result = run(["agents-md", "--root", dir, "--yes", "--no-banner"]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));
});

test("version prints package version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("unknown command fails with known list", () => {
  const result = run(["not-a-namespace"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown command/);
  assert.match(result.stderr, /guidance-composer/);
  assert.match(result.stderr, /init/);
});

test("guidance-composer list via namespace", () => {
  const result = run(["guidance-composer", "list"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /simplicity/);
  assert.match(result.stdout, /no-backward-compat/);
});

test("guidance-composer help mentions namespaced program", () => {
  const result = run(["guidance-composer", "help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /furanku-skills guidance-composer/);
  assert.match(result.stdout, /create-agents-md/);
});

test("guidance-composer show via namespace", () => {
  const result = run(["guidance-composer", "show", "prefer-libraries", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.id, "prefer-libraries");
});

test("agents-md creates AGENTS.md and CLAUDE.md symlink", () => {
  const dir = tmpDir("fs-agents-");
  const result = run(["agents-md", "--root", dir, "--yes", "--no-banner"]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const agents = path.join(dir, "AGENTS.md");
  const claude = path.join(dir, "CLAUDE.md");
  assert.ok(fs.existsSync(agents), "AGENTS.md");
  assert.ok(fs.lstatSync(claude).isSymbolicLink(), "CLAUDE.md symlink");
  assert.equal(fs.readlinkSync(claude), "AGENTS.md");
  assert.match(fs.readFileSync(agents, "utf8"), /AGENTS\.md/);
});

test("agents-md is idempotent", () => {
  const dir = tmpDir("fs-agents2-");
  run(["agents-md", "--root", dir, "--yes", "--no-banner"]);
  const result = run(["agents-md", "--root", dir, "--yes", "--no-banner"]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /already/i);
});

test("agents-md dry-run does not write", () => {
  const dir = tmpDir("fs-agents-dry-");
  const result = run(["agents-md", "--root", dir, "--dry-run", "--no-banner"]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(!fs.existsSync(path.join(dir, "AGENTS.md")));
  assert.match(result.stdout, /dry-run/i);
});

test("init --help documents non-interactive flags", () => {
  const result = run(["init", "--help", "--no-banner"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--agents-md/);
  assert.match(result.stdout, /--skills/);
  assert.match(result.stdout, /--guidance/);
  assert.match(result.stdout, /--yes/);
});

test("init non-interactive agents-md only (dry-run)", () => {
  const dir = tmpDir("fs-init-");
  const result = run([
    "init",
    "--yes",
    "--root",
    dir,
    "--agents-md",
    "--no-skills",
    "--no-guidance",
    "--dry-run",
    "--no-banner",
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /agents-md|AGENTS/);
  assert.ok(!fs.existsSync(path.join(dir, "AGENTS.md")));
});

test("init non-interactive agents-md writes files", () => {
  const dir = tmpDir("fs-init-w-");
  const result = run([
    "init",
    "--yes",
    "--root",
    dir,
    "--agents-md",
    "--no-skills",
    "--no-guidance",
    "--no-banner",
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));
  assert.ok(fs.lstatSync(path.join(dir, "CLAUDE.md")).isSymbolicLink());
});

test("init non-interactive skills dry-run prints npx command", () => {
  const dir = tmpDir("fs-init-sk-");
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# AGENTS.md\n", "utf8");
  const result = run([
    "init",
    "--yes",
    "--root",
    dir,
    "--no-agents-md",
    "--skills",
    "guidance-composer,testing-best-practices",
    "--no-guidance",
    "--dry-run",
    "--no-banner",
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /npx .*skills@latest add rafaelvidaurre\/furanku-skills/);
  assert.match(result.stdout, /guidance-composer/);
  assert.match(result.stdout, /testing-best-practices/);
});

test("init rejects unknown skill ids", () => {
  const dir = tmpDir("fs-init-bad-");
  const result = run([
    "init",
    "--yes",
    "--root",
    dir,
    "--no-agents-md",
    "--skills",
    "not-a-real-skill",
    "--no-guidance",
    "--no-banner",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown skill/);
});

test("init with guidance injects into fresh project", () => {
  const dir = tmpDir("fs-init-g-");
  const result = run([
    "init",
    "--yes",
    "--root",
    dir,
    "--agents-md",
    "--no-skills",
    "--guidance",
    "simplest-current",
    "--guidance-mode",
    "inline",
    "--no-banner",
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /managed-by: guidance-composer/);
  assert.match(agents, /simplest implementation/);
  assert.ok(fs.lstatSync(path.join(dir, "CLAUDE.md")).isSymbolicLink());
});

test("guidance-composer inject creates agents files when missing", () => {
  const dir = tmpDir("fs-gc-agents-");
  const result = run([
    "guidance-composer",
    "inject",
    "--ids",
    "prefer-libraries",
    "--mode",
    "inline",
    "--root",
    dir,
    "--yes",
    "--create-agents-md",
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));
  assert.ok(fs.lstatSync(path.join(dir, "CLAUDE.md")).isSymbolicLink());
  const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /prefer|libraries|maintained/i);
});

test("listCollectionSkills discovers skill dirs", () => {
  const { listCollectionSkills } = require("../lib/skills-install");
  const skills = listCollectionSkills();
  assert.ok(skills.includes("guidance-composer"));
  assert.ok(skills.includes("testing-best-practices"));
  assert.ok(skills.length >= 5);
});

test("buildInstallArgs shapes npx invocation", () => {
  const { buildInstallArgs } = require("../lib/skills-install");
  const all = buildInstallArgs({ skills: "all" });
  assert.deepEqual(all.slice(0, 4), ["--yes", "skills@latest", "add", "rafaelvidaurre/furanku-skills"]);
  assert.ok(all.includes("-y"));
  assert.ok(all.includes("--skill"));
  assert.ok(all.includes("*"));

  const some = buildInstallArgs({
    skills: ["crew", "council"],
    global: true,
  });
  assert.ok(some.includes("-g"));
  assert.ok(some.includes("crew"));
  assert.ok(some.includes("council"));

  // Interactive: bare add so `skills` runs its own picker (no -y / --skill)
  const interactive = buildInstallArgs({ interactive: true });
  assert.deepEqual(interactive, [
    "--yes",
    "skills@latest",
    "add",
    "rafaelvidaurre/furanku-skills",
  ]);
  assert.ok(!interactive.includes("-y"));
  assert.ok(!interactive.includes("--skill"));
});

process.stdout.write("\nAll root CLI tests passed.\n");
