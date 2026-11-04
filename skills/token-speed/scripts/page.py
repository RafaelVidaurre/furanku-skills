"""Render the token-speed chart.

The page embeds aggregate.js, which owns pooling, median, and p90. Call records
are {h, m, e, t, out, sec}: harness, model, effort, end time in epoch
milliseconds, output tokens, and model-active seconds.
"""

import json
from pathlib import Path

def render(payload):
    aggregate = Path(__file__).with_name("aggregate.js").read_text(encoding="utf-8")
    data = json.dumps(payload, separators=(",", ":")).replace("<", "\\u003c")
    return PAGE.replace("/*__AGG__*/", aggregate).replace("__DATA__", data)


PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Token speed</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0c0f12;
    --card: #14191e;
    --line: #2a323b;
    --text: #e7edf2;
    --muted: #8b98a5;
    --brass: #e0b15a;
    --ink: #1c160c;
    --danger: #e08b7a;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text); }
  body {
    font: 15px/1.45 ui-sans-serif, "SF Pro Text", system-ui, sans-serif;
    min-height: 100vh;
    padding: 28px 32px 48px;
  }
  header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; margin-bottom: 22px; }
  .kicker { margin: 0 0 4px; color: var(--brass); letter-spacing: 0.14em; text-transform: uppercase; font-size: 11px; }
  h1 { margin: 0; font-size: 32px; font-weight: 560; letter-spacing: -0.03em; }
  .scanned { margin: 0; color: var(--muted); text-align: right; max-width: 36ch; }
  .clock { margin: 0 0 14px; color: var(--muted); max-width: 88ch; }
  .controls { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; margin-bottom: 14px; max-width: 100%; }
  .filters { margin-bottom: 14px; max-width: 100%; }
  #models, #efforts { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; margin-bottom: 8px; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
  button, select, input { font: inherit; color: var(--text); background: transparent; }
  .seg button, .chip { border: 0; padding: 6px 12px; cursor: pointer; color: var(--muted); }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button[aria-pressed="true"] { background: var(--brass); color: var(--ink); }
  .chip { border: 1px solid var(--line); border-radius: 999px; }
  .chip[aria-pressed="true"] { border-color: transparent; color: var(--ink); }
  .chip.all { color: var(--text); }
  label.field { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); }
  select, input[type="datetime-local"] {
    border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; background: var(--card);
  }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 12px 12px 4px; position: relative; max-width: 100%; }
  svg { width: 100%; height: auto; display: block; }
  .tip {
    position: absolute; pointer-events: none; background: #0c0f12; border: 1px solid var(--line);
    border-radius: 10px; padding: 8px 10px; font-size: 13px; min-width: 180px;
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
  }
  .tip b { display: block; margin-bottom: 2px; }
  .tip span { color: var(--muted); }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 8px 8px 12px; width: 100%; }
  .legend button { display: inline-flex; align-items: center; gap: 8px; border: 0; background: transparent; cursor: pointer; color: var(--text); padding: 2px 0; white-space: normal; text-align: left; max-width: 100%; }
  .legend button[aria-pressed="false"] { color: var(--muted); }
  .swatch { width: 18px; height: 3px; border-radius: 2px; display: inline-block; }
  .table-wrap { overflow: auto; margin-top: 18px; width: 100%; max-width: 100%; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; min-width: 640px; }
  th, td { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  th:first-child, td:first-child, th:nth-child(2), td:nth-child(2), th:nth-child(3), td:nth-child(3) { text-align: left; }
  th { color: var(--muted); font-weight: 550; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; }
  .untimed { margin: 14px 0 0; color: var(--muted); }
  .empty { color: var(--muted); padding: 48px 0; text-align: center; }
  @media (max-width: 800px) {
    body { padding: 18px 14px 32px; }
    header { flex-direction: column; align-items: flex-start; }
    .scanned { text-align: left; max-width: none; }
    .field { width: 100%; }
    .field input, .field select { flex: 1; min-width: 0; width: auto; max-width: none; }
    h1 { font-size: 26px; }
    th, td { padding: 8px 8px; }
  }
  @media (min-width: 801px) {
    .filters { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; }
    #models, #efforts { width: auto; max-width: 100%; min-width: 0; flex: 1 1 280px; margin-bottom: 0; }
  }
</style>
</head>
<body>
<header>
  <div>
    <p class="kicker">Local session logs</p>
    <h1>Token speed</h1>
  </div>
  <p class="scanned" id="scanned"></p>
</header>
<div class="controls">
  <div class="seg" id="harness"></div>
  <div class="seg" id="presets"></div>
</div>
<div class="controls">
  <label class="field">From <input id="from" type="datetime-local"></label>
  <label class="field">To <input id="to" type="datetime-local"></label>
  <label class="field">Step <select id="step"></select></label>
  <label class="field">Show <select id="stat"></select></label>
</div>
<div class="filters">
  <div id="models"></div>
  <div id="efforts"></div>
</div>
<p class="clock" id="clock"></p>
<div class="card">
  <svg id="chart" viewBox="0 0 960 380" role="img" aria-label="Tokens per second over time"></svg>
  <div class="tip" id="tip" hidden></div>
  <div class="legend" id="legend"></div>
</div>
<div class="table-wrap">
<table>
  <thead>
    <tr>
      <th>Harness</th><th>Model</th><th>Effort</th>
      <th>Calls</th><th>Pooled tok/s</th><th>Median</th><th>p90</th>
      <th>Output</th><th>Active</th>
    </tr>
  </thead>
  <tbody id="rows"></tbody>
</table>
</div>
<p class="untimed" id="untimed"></p>
<script>
/*__AGG__*/
const DATA = __DATA__;
const PALETTE = ["#6cb6ff", "#e0b15a", "#3dcc9a", "#ff7a59", "#c792ea", "#7fd0d0", "#f2e394", "#ff8fb8", "#b5e48c", "#9aa7b5"];
const STEPS = [
  ["auto", "Auto"],
  ["60000", "1 min"],
  ["300000", "5 min"],
  ["900000", "15 min"],
  ["3600000", "1 hour"],
  ["21600000", "6 hours"],
  ["86400000", "1 day"],
];
const PRESETS = [["6h", 6 * 3600e3], ["24h", 24 * 3600e3], ["7d", 7 * 86400e3], ["30d", 30 * 86400e3], ["All", null]];
const HARNESS_LABEL = { codex: "Codex", claude: "Claude", grok: "Grok" };

const state = {
  harness: "all",
  since: DATA.since,
  until: DATA.until,
  step: "auto",
  stat: "pooled",
  modelsOff: new Set(),
  effortsOff: new Set(),
  hidden: new Set(),
};

const svg = document.getElementById("chart");
const tip = document.getElementById("tip");
let drawn = [];
let chartW = 960;
let chartH = 380;

function chartBox() {
  const measured = Math.round(svg.clientWidth || 0);
  const width = measured >= 280 ? measured : 960;
  const height = Math.max(220, Math.round(width * (width < 640 ? 0.78 : 380 / 960)));
  chartW = width;
  chartH = height;
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  return { width, height };
}

function pad(n) { return String(n).padStart(2, "0"); }
function localValue(ms) {
  const d = new Date(ms);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function fmtRate(n) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 100) return Math.round(n).toLocaleString();
  return n.toFixed(1);
}
function fmtInt(n) { return Math.round(n).toLocaleString(); }
function fmtDur(sec) {
  if (sec < 60) return sec.toFixed(1) + "s";
  if (sec < 3600) return Math.round(sec / 60) + "m";
  return (sec / 3600).toFixed(1) + "h";
}
function fmtStamp(ms) {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtTime(ms, span, step) {
  const d = new Date(ms);
  if (step >= 86400e3) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (span >= 36 * 3600e3) return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtAxis(value, maxV) {
  if (maxV >= 50) return Math.round(value).toLocaleString();
  const digits = maxV >= 8 ? 1 : 2;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function harnessesPresent() {
  return [...new Set(DATA.calls.map((call) => call.h))];
}

function visibleCalls() {
  const models = [...new Set(DATA.calls.filter((call) => state.harness === "all" || call.h === state.harness).map((call) => call.m))]
    .filter((model) => !state.modelsOff.has(model));
  const efforts = [...new Set(DATA.calls.map((call) => call.e))].filter((effort) => !state.effortsOff.has(effort));
  return selectCalls(DATA.calls, {
    harness: state.harness,
    models: state.modelsOff.size ? models : null,
    efforts: state.effortsOff.size ? efforts : null,
    since: state.since,
    until: state.until,
  });
}

function stepMs(span) {
  if (state.step !== "auto") return Number(state.step);
  return autoStep(Math.max(span, 1));
}

function paintChips(container, values, off, prefix) {
  container.replaceChildren();
  const all = document.createElement("button");
  all.className = "chip all";
  all.type = "button";
  all.textContent = prefix;
  all.setAttribute("aria-pressed", off.size ? "false" : "true");
  all.addEventListener("click", () => { off.clear(); draw(); });
  container.append(all);
  for (const value of values) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = value;
    const on = !off.has(value);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) chip.style.background = "var(--brass)";
    chip.addEventListener("click", () => {
      if (off.has(value)) off.delete(value);
      else off.add(value);
      draw();
    });
    container.append(chip);
  }
}

function buildControls() {
  const harness = document.getElementById("harness");
  const present = harnessesPresent();
  const choices = present.length > 1 ? [["all", "All"], ...present.map((name) => [name, HARNESS_LABEL[name] || name])] : present.map((name) => [name, HARNESS_LABEL[name] || name]);
  if (present.length < 2) state.harness = present[0] || "all";
  for (const [id, label] of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.id = id;
    button.addEventListener("click", () => { state.harness = id; state.hidden.clear(); draw(); });
    harness.append(button);
  }
  const presets = document.getElementById("presets");
  for (const [label, span] of PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.span = span == null ? "" : String(span);
    button.addEventListener("click", () => {
      state.until = DATA.until;
      state.since = span == null ? DATA.since : Math.max(DATA.since, DATA.until - span);
      syncInputs();
      draw();
    });
    presets.append(button);
  }
  const step = document.getElementById("step");
  for (const [value, label] of STEPS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    step.append(option);
  }
  step.addEventListener("change", () => { state.step = step.value; draw(); });
  const stat = document.getElementById("stat");
  for (const [value, label] of [["pooled", "Pooled tok/s"], ["median", "Median call"], ["p90", "p90 call"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    stat.append(option);
  }
  stat.addEventListener("change", () => { state.stat = stat.value; draw(); });
  const from = document.getElementById("from");
  const to = document.getElementById("to");
  const applyRange = () => {
    const start = new Date(from.value).getTime();
    const end = new Date(to.value).getTime();
    if (!Number.isNaN(start)) state.since = start;
    if (!Number.isNaN(end)) state.until = end;
    if (state.since > state.until) { const swap = state.since; state.since = state.until; state.until = swap; syncInputs(); }
    draw();
  };
  from.addEventListener("change", applyRange);
  to.addEventListener("change", applyRange);
  syncInputs();
}

function syncInputs() {
  document.getElementById("from").value = localValue(state.since);
  document.getElementById("to").value = localValue(state.until);
}

function markPressed() {
  for (const button of document.getElementById("harness").children) {
    button.setAttribute("aria-pressed", button.dataset.id === state.harness ? "true" : "false");
  }
  const span = state.until - state.since;
  const atEnd = Math.abs(state.until - DATA.until) < 60e3;
  for (const button of document.getElementById("presets").children) {
    const preset = button.dataset.span ? Number(button.dataset.span) : null;
    const on = atEnd && (preset == null ? state.since <= DATA.since : Math.abs(span - preset) < preset * 0.02);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function drawChart(calls) {
  const box = chartBox();
  const width = box.width;
  const height = box.height;
  const pad = { l: width < 560 ? 48 : 58, r: 16, t: 16, b: 34 };
  const font = width < 560 ? "12" : "13";
  svg.replaceChildren();
  drawn = [];
  const span = Math.max(state.until - state.since, 1);
  const step = stepMs(span);
  const multiple = state.harness === "all" && harnessesPresent().length > 1;
  const series = seriesFor(calls, step, state.stat, multiple).filter((item) => !state.hidden.has(item.key));
  const legend = document.getElementById("legend");
  legend.replaceChildren();
  const allSeries = seriesFor(calls, step, state.stat, multiple);
  allSeries.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    const on = !state.hidden.has(item.key);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    const swatch = document.createElement("i");
    swatch.className = "swatch";
    swatch.style.background = PALETTE[index % PALETTE.length];
    button.append(swatch, document.createTextNode(item.key));
    button.addEventListener("click", () => {
      if (state.hidden.has(item.key)) state.hidden.delete(item.key);
      else state.hidden.add(item.key);
      draw();
    });
    legend.append(button);
  });
  if (!series.length || !series.some((item) => item.points.length)) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", width / 2);
    text.setAttribute("y", height / 2);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#8b98a5");
    text.setAttribute("font-size", font);
    text.textContent = "No timed calls in this range.";
    svg.append(text);
    return;
  }
  const values = series.flatMap((item) => item.points.map((point) => point.value));
  const times = series.flatMap((item) => item.points.map((point) => point.t));
  let minT = Math.min(...times);
  let maxT = Math.max(...times.map((t) => t + step));
  if (minT === maxT) maxT = minT + step;
  const maxV = Math.max(...values, 1) * 1.12;
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const xOf = (t) => pad.l + ((t - minT) / (maxT - minT)) * innerW;
  const yOf = (v) => pad.t + (1 - v / maxV) * innerH;
  const ns = "http://www.w3.org/2000/svg";
  function el(name, attrs) {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  for (let i = 0; i <= 4; i++) {
    const value = (maxV * i) / 4;
    const y = yOf(value);
    svg.append(el("line", { x1: pad.l, x2: width - pad.r, y1: y, y2: y, stroke: "#2a323b" }));
    const label = el("text", { x: pad.l - 8, y: y + 4, "text-anchor": "end", fill: "#8b98a5", "font-size": font });
    label.textContent = fmtAxis(value, maxV);
    svg.append(label);
  }
  let ticks = 6;
  if (width < 560) ticks = span >= 36 * 3600e3 ? 2 : 3;
  for (let i = 0; i <= ticks; i++) {
    const t = minT + ((maxT - minT) * i) / ticks;
    const anchor = i === 0 ? "start" : i === ticks ? "end" : "middle";
    const x = i === 0 ? pad.l : i === ticks ? width - pad.r : xOf(t);
    const label = el("text", { x, y: height - 12, "text-anchor": anchor, fill: "#8b98a5", "font-size": font });
    label.textContent = fmtTime(t, maxT - minT, step);
    svg.append(label);
  }
  allSeries.forEach((item, index) => {
    if (state.hidden.has(item.key)) return;
    const color = PALETTE[index % PALETTE.length];
    for (const run of segments(item.points, step)) {
      const d = run.map((point, i) => (i ? "L" : "M") + xOf(point.t + step / 2).toFixed(1) + " " + yOf(point.value).toFixed(1)).join(" ");
      svg.append(el("path", { d, fill: "none", stroke: color, "stroke-width": "2.2", "stroke-linejoin": "round", "stroke-linecap": "round" }));
      for (const point of run) {
        const thin = point.calls < 3;
        const dot = el("circle", {
          cx: xOf(point.t + step / 2), cy: yOf(point.value), r: thin ? 3.5 : 2.4,
          fill: thin ? "#14191e" : color, stroke: color, "stroke-width": thin ? "1.6" : "0",
        });
        svg.append(dot);
        drawn.push({ x: xOf(point.t + step / 2), y: yOf(point.value), color, key: item.key, point });
      }
    }
  });
}

function drawTable(calls) {
  const body = document.getElementById("rows");
  body.replaceChildren();
  for (const row of tableRows(calls)) {
    const tr = document.createElement("tr");
    const cells = [
      HARNESS_LABEL[row.harness] || row.harness,
      row.model,
      row.effort,
      fmtInt(row.calls),
      fmtRate(row.pooled),
      fmtRate(row.median),
      fmtRate(row.p90),
      fmtInt(row.out),
      fmtDur(row.sec),
    ];
    for (const value of cells) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
}

function drawClock() {
  const names = state.harness === "all" ? harnessesPresent() : [state.harness];
  document.getElementById("clock").textContent = names.map((name) => DATA.clocks[name]).filter(Boolean).join(" ");
  const notes = [];
  for (const name of names) {
    const count = DATA.untimed[name] || 0;
    if (count) notes.push(count + " " + (HARNESS_LABEL[name] || name) + " span" + (count === 1 ? "" : "s") + " left out as too short or too long");
  }
  if (names.includes("grok") && DATA.mixed_turns) notes.push(DATA.mixed_turns + " Grok turns used more than one model and are left out");
  document.getElementById("untimed").textContent = notes.join(". ") + (notes.length ? "." : "");
}

function draw() {
  markPressed();
  const calls = visibleCalls();
  const inHarness = DATA.calls.filter((call) => state.harness === "all" || call.h === state.harness);
  paintChips(document.getElementById("models"), [...new Set(inHarness.map((call) => call.m))].sort(), state.modelsOff, "Models");
  paintChips(document.getElementById("efforts"), [...new Set(inHarness.map((call) => call.e))].sort(), state.effortsOff, "Effort");
  drawChart(calls);
  drawTable(calls);
  drawClock();
  const scanned = fmtStamp(DATA.since) + " – " + fmtStamp(DATA.until);
  document.getElementById("scanned").textContent = "Scanned " + scanned;
}

svg.addEventListener("pointermove", (event) => {
  if (!drawn.length) { tip.hidden = true; return; }
  const rect = svg.getBoundingClientRect();
  const vx = ((event.clientX - rect.left) / rect.width) * chartW;
  const vy = ((event.clientY - rect.top) / rect.height) * chartH;
  let best = null;
  for (const item of drawn) {
    const dist = (item.x - vx) ** 2 + (item.y - vy) ** 2;
    if (!best || dist < best.dist) best = { dist, item };
  }
  if (!best || best.dist > 28 ** 2) { tip.hidden = true; return; }
  const point = best.item.point;
  tip.hidden = false;
  tip.replaceChildren();
  const title = document.createElement("b");
  title.textContent = best.item.key;
  const detail = document.createElement("span");
  const callWord = point.calls === 1 ? "call" : "calls";
  detail.textContent = " · " + point.calls + " " + callWord + " · " + fmtInt(point.out) + " output · " + fmtDur(point.sec);
  tip.append(title, document.createTextNode(fmtRate(point.value) + " tok/s"), detail);
  const card = svg.parentElement.getBoundingClientRect();
  tip.style.left = Math.min(event.clientX - card.left + 14, card.width - 200) + "px";
  tip.style.top = Math.max(event.clientY - card.top - 48, 8) + "px";
});
svg.addEventListener("pointerleave", () => { tip.hidden = true; });

buildControls();
draw();
let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(draw, 80);
});
</script>
</body>
</html>
"""
