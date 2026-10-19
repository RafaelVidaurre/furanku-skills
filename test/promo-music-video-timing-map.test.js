"use strict";

const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SKILL = path.join(__dirname, "..", "skills", "promo-music-video");
const { validateMap, belowStatus, activeIndex } = require(path.join(SKILL, "assets", "timing-player", "timing-map.js"));
const CHECK = path.join(SKILL, "scripts", "check-timing-map.js");

function docExample() {
  const doc = fs.readFileSync(path.join(SKILL, "references", "song-timing.md"), "utf8");
  return JSON.parse(doc.match(/```json\n([\s\S]*?)```/)[1]);
}
const paths = (issues) => issues.map((i) => i.path);

test("the documented example map is structurally valid", () => {
  assert.deepStrictEqual(validateMap(docExample()), []);
});

test("broken spans, order, containment, and statuses are each reported", () => {
  const map = docExample();
  map.phrases.push(
    { id: "p01", start: 0.5, end: 0.4, text: "late", status: "done" },
    { id: "p03", start: 3, end: 4, text: "x", status: "listened", words: [{ text: "x", start: 2.9, end: 4.2 }] },
  );
  map.beats.push(Number.NaN);
  const found = paths(validateMap(map));
  for (const expected of ["phrases[1].id", "phrases[1]", "phrases[1].status", "phrases[1]", "phrases[2].words[0].start", "phrases[2].words[0].end", "beats[5]"]) {
    assert.ok(found.includes(expected), `${expected} missing from ${found}`);
  }
});

test("times past the real audio fail even when the map claims a longer mix", () => {
  const found = paths(validateMap(docExample(), { duration: 2 }));
  assert.ok(found.includes("phrases[0].end") && found.includes("beats[3]"), String(found));
});

test("a status gate passes reviewed or explicitly held entries only", () => {
  const map = docExample();
  assert.deepStrictEqual(belowStatus(map, "listened").map((e) => e.path).sort(), ["hits[0]", "phrases[0]", "sections[0]"]);
  map.phrases[0].held = true;
  assert.ok(!belowStatus(map, "listened").some((e) => e.path === "phrases[0]"));
});

test("overlapping voices resolve to the latest-starting span", () => {
  const spans = [{ start: 0, end: 4 }, { start: 1, end: 2 }];
  assert.strictEqual(activeIndex(spans, 1.5), 1);
  assert.strictEqual(activeIndex(spans, 3), 0);
  assert.strictEqual(activeIndex(spans, 4), -1);
});

test("the checker exits nonzero on a failed gate and zero on a clean map", (t) => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "timing-map-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "map.json");
  fs.writeFileSync(file, JSON.stringify(docExample()));
  assert.match(execFileSync(process.execPath, [CHECK, file], { encoding: "utf8" }), /0 structural issue/);
  assert.throws(() => execFileSync(process.execPath, [CHECK, file, "--min-status", "reviewed"], { stdio: "pipe" }), (e) => e.status === 1);
  assert.throws(() => execFileSync(process.execPath, [CHECK], { stdio: "pipe" }), (e) => e.status === 2);
});
