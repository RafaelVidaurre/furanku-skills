"use strict";

// The jam skills, recipes and toolkit sources work with any engine or none and with any provider.
// This fails when an engine or a vendor is named outside the places that exist to name one:
// engine adapters and presets, provider descriptors and provider pages.
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SKILLS = path.join(ROOT, "skills");
const TOOLKIT = "skills/jam-setup/assets/toolkit";

const TEXT = new Set([".md", ".json", ".ts", ".mts", ".js", ".mjs", ".cjs", ".py", ".txt", ".html", ".css", ".sh", ".yaml", ".yml", ".toml"]);
const SKIP_DIRS = new Set(["node_modules", "__pycache__", ".venv", ".pytest_cache", "test-output"]);
const SKIP_FILES = new Set(["package-lock.json"]);

// Whole files where naming an engine or a vendor is the point.
const ALLOWED = [
  /^skills\/jam-engine-[^/]+\//, // an engine's own adapter skill
  /^skills\/jam-engine\/assets\/example-adapter\//,
  new RegExp(`^${TOOLKIT}/engines/`),
  new RegExp(`^${TOOLKIT}/providers/`),
  new RegExp(`^${TOOLKIT}/docs/providers/`),
  /(^|\/)references\/validation\.md$/,
  /(^|\/)(test|tests|fixtures)\//, // test code and fixtures
  /(^|\/)test_[^/]+\.py$/,
  /\.test\.[a-z]+$/
];
// Files that may name an engine on a line that presents it as an example of a preset.
const PRESET_EXAMPLES = [/^skills\/jam-engine\/(SKILL\.md|references\/)/, new RegExp(`^${TOOLKIT}/docs/recipes/`)];

// Each term: name, pattern, and optionally the files where the word means something else.
const ENGINES = [
  ["Unreal", /\bunreal\b/i],
  ["UE4/UE5", /\bUE[45]\b/],
  // The proper noun, or the common noun used of a skeleton. A display dummy in sample content is not an engine.
  ["Mannequin", /\bMannequin\b|^(?=.*\bmannequin\b)(?=.*(?:[Ss]kelet|\b[Bb]ones?\b|\b[Rr]ig))/],
  ["Manny", /\bManny\b/],
  ["UCX", /\bUCX\b/],
  ["uasset", /\buasset\b/i],
  ["Nanite", /\bnanite\b/i],
  ["Godot", /\bgodot\b/i],
  ["Unity", /\bUnity\b|["'`]unity["'`]/],
  // The catalog's own model viewer reports the library it draws with; that is not a target runtime.
  ["three.js", /\bthree\.js\b/i, [new RegExp(`^${TOOLKIT}/catalog/web/`), /\/server\/renderer\.[a-z]+$/i]]
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Vendor names are data: the id and label of every shipped provider that is reached through
// something other than the running agent's own tools.
function vendors() {
  const dir = path.join(ROOT, TOOLKIT, "providers");
  const terms = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    const descriptor = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const transports = descriptor.transports ?? [];
    if (transports.length > 0 && transports.every((transport) => transport.kind === "agent")) continue;
    terms.push([descriptor.id, new RegExp(`\\b${escape(descriptor.id)}\\b`, "i")]);
    if (descriptor.label && descriptor.label.toLowerCase() !== descriptor.id) terms.push([descriptor.label, new RegExp(escape(descriptor.label), "i")]);
  }
  return terms;
}

function files() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile() && TEXT.has(path.extname(entry.name)) && !SKIP_FILES.has(entry.name)) {
        out.push(path.relative(ROOT, full).split(path.sep).join("/"));
      }
    }
  };
  for (const name of fs.readdirSync(SKILLS).sort()) {
    if (name.startsWith("jam-") && fs.statSync(path.join(SKILLS, name)).isDirectory()) walk(path.join(SKILLS, name));
  }
  return out.filter((file) => !ALLOWED.some((pattern) => pattern.test(file)));
}

function hits(terms, { presetExamples }) {
  const found = [];
  for (const file of files()) {
    const lenient = presetExamples && PRESET_EXAMPLES.some((pattern) => pattern.test(file));
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (lenient && /\bpresets?\b/i.test(line)) return;
      for (const [name, pattern, elsewhere = []] of terms) {
        if (pattern.test(line) && !elsewhere.some((allowed) => allowed.test(file))) found.push(`${file}:${index + 1}: ${name}: ${line.trim().slice(0, 140)}`);
      }
    });
  }
  return found;
}

const report = (kind, found) => `${found.length} ${kind} name${found.length === 1 ? "" : "s"} outside the allowed places:\n${found.join("\n")}`;

test("the scan covers the jam skills, the recipes and the toolkit sources", () => {
  const scanned = files();
  for (const expected of ["skills/jam-recipe/SKILL.md", `${TOOLKIT}/recipes/prop.json`, `${TOOLKIT}/src/cli/main.ts`]) {
    assert.ok(scanned.includes(expected), `${expected} is scanned`);
  }
  assert.ok(vendors().length >= 2, "vendor names are read from the provider descriptors");
});

test("no engine is named in a jam skill, recipe or toolkit source", () => {
  const found = hits(ENGINES, { presetExamples: true });
  assert.strictEqual(found.length, 0, report("engine", found));
});

test("no vendor is named in a jam skill, recipe or toolkit source", () => {
  const found = hits(vendors(), { presetExamples: false });
  assert.strictEqual(found.length, 0, report("vendor", found));
});
