"use strict";

// Every skill must install: installers parse SKILL.md frontmatter as strict YAML and silently skip a skill
// whose plain (unquoted) scalar contains ": " or " #", or starts with a YAML indicator.
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SKILLS = path.join(__dirname, "..", "skills");
const INDICATOR = /^[-?:,\[\]{}#&*!|>'"%@`]/;

for (const dir of fs.readdirSync(SKILLS).sort()) {
  const file = path.join(SKILLS, dir, "SKILL.md");
  if (!fs.existsSync(file)) continue;
  test(`${dir}: SKILL.md frontmatter is installable YAML`, () => {
    const text = fs.readFileSync(file, "utf8");
    const match = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(match, "frontmatter delimited by --- lines");
    const fields = {};
    const lines = match[1].split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([a-z][a-z0-9_-]*):\s?(.*)$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (/^[|>][+-]?$/.test(raw.trim())) {  // a block scalar: its indented lines are the value, and any text is allowed
        const body = [];
        while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) body.push(lines[++i].trim());
        fields[key] = body.join(" ");
        continue;
      }
      const quoted = /^(".*"|'.*')$/.test(raw.trim());
      if (!quoted && raw.trim()) {
        assert.ok(!raw.includes(": "), `${key}: an unquoted value may not contain ": " (quote it or reword)`);
        assert.ok(!raw.includes(" #"), `${key}: an unquoted value may not contain " #"`);
        assert.ok(!INDICATOR.test(raw.trim()), `${key}: an unquoted value may not start with a YAML indicator`);
      }
      fields[key] = quoted ? raw.trim().slice(1, -1) : raw.trim();
    }
    assert.strictEqual(fields.name, dir, "name equals the directory name");
    assert.ok(fields.description && fields.description.length <= 1024, "description present and at most 1024 characters");
  });
}
