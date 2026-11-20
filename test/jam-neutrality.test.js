"use strict";

// The jam skills, recipes and toolkit sources work with any engine or none and with any provider.
// This fails when an engine or a vendor is named outside the places that exist to name one:
// engine adapters and presets, provider descriptors and provider pages, and a provider's own skill,
// which may name its own vendor (and no other vendor, and no engine).
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
  /(^|\/)(test|tests|fixtures)\//, // test code and fixtures
  /(^|\/)test_[^/]+\.py$/,
  /\.test\.[a-z]+$/
];
const descriptors = () => {
  const dir = path.join(ROOT, TOOLKIT, "providers");
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
};
// A provider's own skill, named by a skill transport of a shipped descriptor, is to its provider what an
// adapter is to its engine: it may name that provider's vendor. By provider id.
const providerSkills = () => new Map(descriptors().map((descriptor) => [descriptor.id, (descriptor.transports ?? [])
  .filter((transport) => transport.kind === "skill" && typeof transport.name === "string")
  .map((transport) => new RegExp(`^skills/${transport.name.replace(/[^a-z0-9-]/g, "")}/`))]));
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
  ["MetaHuman", /\bmetahuman/i],
  // The catalog's own model viewer reports the library it draws with; that is not a target runtime.
  ["three.js", /\bthree\.js\b/i, [new RegExp(`^${TOOLKIT}/catalog/web/`), /\/server\/renderer\.[a-z]+$/i]]
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Motion and rigging vendors and products the animation provider survey (docs/research) names, which
// ship no descriptor. The survey may name them; the jam skills, recipes and toolkit docs may not.
const SURVEYED = ["NVIDIA", "Uthana", "Viggle", "Kimodo", "GEM-X", "Cartwheel", "Move AI", "Plask", "DeepMotion", "QuickMagic",
  "Adobe", "Mixamo", "Autodesk", "Maya", "MotionMaker", "Flow Studio", "Wonder Studio", "Rokoko", "Cascadeur",
  "Tencent", "Hunyuan", "HY-Motion", "Rodin", "Deemos", "Anything World", "Everything Universe"];

// Vendor names are data: the id and label of every shipped provider that is reached through something
// other than the running agent's own tools, and the surveyed vendors. Each term lists the providers it
// belongs to: those whose own skill may name it (a surveyed vendor belongs to the descriptor whose label names it).
function vendors() {
  const terms = [];
  const shipped = descriptors().filter((descriptor) => !((descriptor.transports ?? []).length > 0 && descriptor.transports.every((transport) => transport.kind === "agent")));
  for (const descriptor of shipped) {
    terms.push([descriptor.id, new RegExp(`\\b${escape(descriptor.id)}\\b`, "i"), [], [descriptor.id]]);
    if (descriptor.label && descriptor.label.toLowerCase() !== descriptor.id) terms.push([descriptor.label, new RegExp(escape(descriptor.label), "i"), [], [descriptor.id]]);
  }
  for (const name of SURVEYED) {
    const pattern = new RegExp(`\\b${escape(name).replace(/ /g, "\\s+")}\\b`, "i");
    terms.push([name, pattern, [], shipped.filter((descriptor) => pattern.test(descriptor.label ?? "")).map((descriptor) => descriptor.id)]);
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
  const skills = providerSkills();
  const ownSkill = (file, providers) => providers.some((id) => (skills.get(id) ?? []).some((pattern) => pattern.test(file)));
  const found = [];
  for (const file of files()) {
    const lenient = presetExamples && PRESET_EXAMPLES.some((pattern) => pattern.test(file));
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (lenient && /\bpresets?\b/i.test(line)) return;
      for (const [name, pattern, elsewhere = [], providers = []] of terms) {
        if (pattern.test(line) && !elsewhere.some((allowed) => allowed.test(file)) && !ownSkill(file, providers)) found.push(`${file}:${index + 1}: ${name}: ${line.trim().slice(0, 140)}`);
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
  for (const expected of ["skills/jam-3d-motionbricks/SKILL.md", "skills/jam-3d-animate/references/validation.md", `${TOOLKIT}/docs/providers.md`]) {
    assert.ok(scanned.includes(expected), `${expected} is scanned`);
  }
  assert.ok(vendors().length >= 2, "vendor names are read from the provider descriptors");
});

test("a provider's own skill may name its own vendor, and only that vendor", () => {
  const own = (file, name) => {
    const [, , , providers] = vendors().find(([term]) => term === name);
    return providers.some((id) => (providerSkills().get(id) ?? []).some((pattern) => pattern.test(file)));
  };
  assert.ok(own("skills/jam-3d-motionbricks/SKILL.md", "NVIDIA MotionBricks") && own("skills/jam-3d-motionbricks/SKILL.md", "NVIDIA"));
  assert.ok(!own("skills/jam-3d-motionbricks/SKILL.md", "Uthana") && !own("skills/jam-3d-motionbricks/SKILL.md", "meshy"));
  assert.ok(!own("skills/jam-3d-animate/SKILL.md", "NVIDIA"));
});

test("every surveyed vendor is one the survey names", () => {
  const research = fs.readdirSync(path.join(ROOT, "docs", "research")).map((name) => fs.readFileSync(path.join(ROOT, "docs", "research", name), "utf8")).join("\n");
  for (const name of SURVEYED) assert.ok(research.includes(name), `${name} is named in docs/research`);
});

test("no engine is named in a jam skill, recipe or toolkit source", () => {
  const found = hits(ENGINES, { presetExamples: true });
  assert.strictEqual(found.length, 0, report("engine", found));
});

test("no vendor is named in a jam skill, recipe or toolkit source", () => {
  const found = hits(vendors(), { presetExamples: false });
  assert.strictEqual(found.length, 0, report("vendor", found));
});
