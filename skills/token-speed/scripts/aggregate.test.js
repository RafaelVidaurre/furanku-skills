"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const code = fs.readFileSync(path.join(__dirname, "aggregate.js"), "utf8");
const api = new Function(code + "\nreturn { percentile, selectCalls, summarize, tableRows, seriesFor, segments, autoStep };")();

test("pooled rate is total tokens over total seconds, and the median of two rates is their midpoint", () => {
  const stats = api.summarize([
    { out: 100, sec: 1 },
    { out: 300, sec: 1 },
  ]);
  assert.equal(stats.pooled, 200);
  assert.equal(stats.median, 200);
  assert.equal(stats.out, 400);
  assert.equal(stats.sec, 2);
});

test("a time step pools each bucket and does not connect across an empty step", () => {
  const hour = 60 * 60 * 1000;
  const calls = [
    { h: "codex", m: "sol", e: "high", t: hour + 10, out: 100, sec: 1 },
    { h: "codex", m: "sol", e: "high", t: hour + 20, out: 300, sec: 1 },
    { h: "codex", m: "sol", e: "high", t: 4 * hour, out: 50, sec: 2 },
  ];
  const series = api.seriesFor(calls, hour, "pooled", false);
  assert.equal(series.length, 1);
  assert.deepEqual(series[0].points.map((point) => point.value), [200, 25]);
  const runs = api.segments(series[0].points, hour);
  assert.equal(runs.length, 2);
});

test("filters keep the named model and the calls inside the range", () => {
  const calls = [
    { h: "claude", m: "opus", e: "high", t: 10, out: 10, sec: 1 },
    { h: "claude", m: "haiku", e: "high", t: 10, out: 10, sec: 1 },
    { h: "claude", m: "opus", e: "low", t: 50, out: 10, sec: 1 },
    { h: "codex", m: "opus", e: "high", t: 10, out: 10, sec: 1 },
  ];
  const selected = api.selectCalls(calls, { harness: "claude", models: ["opus"], efforts: null, since: 0, until: 20 });
  assert.deepEqual(selected.map((call) => call.e), ["high"]);
});

test("auto step keeps a week near a handful of dozen buckets", () => {
  const week = 7 * 24 * 60 * 60 * 1000;
  const step = api.autoStep(week);
  assert.ok(week / step <= 48);
  assert.ok(week / step >= 12);
});
