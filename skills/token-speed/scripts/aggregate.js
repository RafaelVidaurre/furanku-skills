// Chart math for token speed. A pooled rate is total output tokens divided by
// total model-active seconds. Median and p90 describe the per-call rates.
// token_speed.py's summary uses this same percentile.

function percentile(values, p) {
  if (!values.length) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  if (ordered.length === 1) return ordered[0];
  const rank = p * (ordered.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, ordered.length - 1);
  const frac = rank - lo;
  return ordered[lo] * (1 - frac) + ordered[hi] * frac;
}

function selectCalls(calls, opts) {
  const models = opts.models;
  const efforts = opts.efforts;
  return calls.filter((call) => {
    if (opts.harness && opts.harness !== "all" && call.h !== opts.harness) return false;
    if (Array.isArray(models) && !models.includes(call.m)) return false;
    if (Array.isArray(efforts) && !efforts.includes(call.e)) return false;
    if (call.t < opts.since || call.t > opts.until) return false;
    return true;
  });
}

function summarize(calls) {
  let out = 0;
  let sec = 0;
  const rates = [];
  for (const call of calls) {
    out += call.out;
    sec += call.sec;
    rates.push(call.out / call.sec);
  }
  return {
    calls: calls.length,
    out,
    sec,
    pooled: sec ? out / sec : null,
    median: percentile(rates, 0.5),
    p90: percentile(rates, 0.9),
  };
}

function tableRows(calls) {
  const groups = new Map();
  for (const call of calls) {
    const key = call.h + "\0" + call.m + "\0" + call.e;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  }
  const rows = [];
  for (const [key, group] of groups) {
    const [h, m, e] = key.split("\0");
    const stats = summarize(group);
    rows.push({ harness: h, model: m, effort: e, ...stats });
  }
  rows.sort((a, b) => (b.pooled || 0) - (a.pooled || 0) || b.calls - a.calls || a.model.localeCompare(b.model));
  return rows;
}

function seriesKey(call, multipleHarnesses) {
  const name = call.m + " · " + call.e;
  if (!multipleHarnesses) return name;
  const label = { codex: "Codex", claude: "Claude", grok: "Grok" }[call.h] || call.h;
  return label + " · " + name;
}

function seriesFor(calls, stepMs, stat, multipleHarnesses) {
  const buckets = new Map();
  for (const call of calls) {
    const start = Math.floor(call.t / stepMs) * stepMs;
    const key = seriesKey(call, multipleHarnesses);
    const id = key + "\0" + start;
    if (!buckets.has(id)) buckets.set(id, { key, t: start, calls: [] });
    buckets.get(id).calls.push(call);
  }
  const byKey = new Map();
  for (const bucket of buckets.values()) {
    const stats = summarize(bucket.calls);
    const value = stat === "median" ? stats.median : stat === "p90" ? stats.p90 : stats.pooled;
    if (!byKey.has(bucket.key)) byKey.set(bucket.key, []);
    byKey.get(bucket.key).push({ t: bucket.t, value, calls: stats.calls, out: stats.out, sec: stats.sec });
  }
  const series = [];
  for (const [key, points] of byKey) {
    points.sort((a, b) => a.t - b.t);
    series.push({ key, points });
  }
  series.sort((a, b) => a.key.localeCompare(b.key));
  return series;
}

function segments(points, stepMs) {
  const runs = [];
  let current = [];
  let previous = null;
  for (const point of points) {
    if (previous !== null && point.t - previous > stepMs * 1.5) {
      if (current.length) runs.push(current);
      current = [];
    }
    current.push(point);
    previous = point.t;
  }
  if (current.length) runs.push(current);
  return runs;
}

function autoStep(spanMs) {
  const choices = [60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3, 6 * 60 * 60e3, 24 * 60 * 60e3];
  for (const step of choices) {
    if (spanMs / step <= 48) return step;
  }
  return choices[choices.length - 1];
}
