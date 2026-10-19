"use strict";

// Timing-map rules shared by the browser player (window.TimingMap) and the Node checker (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimingMap = api;
})(typeof self !== "undefined" ? self : this, function () {
  const STATUSES = ["estimated", "listened", "reviewed"];
  const MARKER_LISTS = ["downbeats", "hits"];

  function isTime(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  function mapDuration(map, duration) {
    if (isTime(duration)) return duration;
    return map && map.mix && isTime(map.mix.duration) ? map.mix.duration : undefined;
  }

  // Structural problems only: whether a time matches the voice is a listening question.
  function validateMap(map, options = {}) {
    const issues = [];
    const add = (path, message) => issues.push({ path, message });
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      add("", "timing map must be a JSON object");
      return issues;
    }
    const limit = mapDuration(map, options.duration);

    function checkTime(value, path) {
      if (!isTime(value)) add(path, "must be a finite, non-negative number of seconds");
      else if (limit !== undefined && value > limit) add(path, `${value} is past the end of the audio (${limit})`);
    }
    function checkSpan(item, path) {
      checkTime(item.start, `${path}.start`);
      checkTime(item.end, `${path}.end`);
      if (isTime(item.start) && isTime(item.end) && item.start >= item.end) add(path, "start must be before end");
    }
    function checkStatus(status, path) {
      if (!STATUSES.includes(status)) add(`${path}.status`, `must be one of ${STATUSES.join(", ")}`);
    }
    function checkOrder(values, path) {
      for (let i = 1; i < values.length; i++) {
        if (isTime(values[i]) && isTime(values[i - 1]) && values[i] < values[i - 1]) {
          add(`${path}[${i}]`, "is earlier than the entry before it");
        }
      }
    }

    if (!Array.isArray(map.phrases)) add("phrases", "must be an array");
    const phrases = Array.isArray(map.phrases) ? map.phrases : [];
    const ids = new Set();
    phrases.forEach((phrase, i) => {
      const at = `phrases[${i}]`;
      if (!phrase || typeof phrase !== "object") return add(at, "must be an object");
      checkSpan(phrase, at);
      if (phrase.id === undefined || phrase.id === "") add(`${at}.id`, "is missing");
      else if (ids.has(phrase.id)) add(`${at}.id`, `duplicates ${JSON.stringify(phrase.id)}`);
      else ids.add(phrase.id);
      if (typeof phrase.text !== "string" || !phrase.text.trim()) add(`${at}.text`, "is missing");
      checkStatus(phrase.status, at);
      if (phrase.words === undefined) return;
      if (!Array.isArray(phrase.words)) return add(`${at}.words`, "must be an array");
      phrase.words.forEach((word, j) => {
        const wat = `${at}.words[${j}]`;
        if (!word || typeof word !== "object") return add(wat, "must be an object");
        checkSpan(word, wat);
        if (typeof word.text !== "string" || !word.text.trim()) add(`${wat}.text`, "is missing");
        if (word.status !== undefined) checkStatus(word.status, wat);
        if (isTime(word.start) && isTime(phrase.start) && word.start < phrase.start) add(`${wat}.start`, "is before its phrase starts");
        if (isTime(word.end) && isTime(phrase.end) && word.end > phrase.end) add(`${wat}.end`, "is after its phrase ends");
      });
      checkOrder(phrase.words.map((w) => w && w.start), `${at}.words`);
    });
    checkOrder(phrases.map((p) => p && p.start), "phrases");

    if (map.beats !== undefined) {
      if (!Array.isArray(map.beats)) add("beats", "must be an array of seconds");
      else {
        map.beats.forEach((t, i) => checkTime(t, `beats[${i}]`));
        checkOrder(map.beats, "beats");
      }
    }
    for (const list of MARKER_LISTS) {
      if (map[list] === undefined) continue;
      if (!Array.isArray(map[list])) {
        add(list, "must be an array");
        continue;
      }
      map[list].forEach((marker, i) => {
        if (!marker || typeof marker !== "object") return add(`${list}[${i}]`, "must be an object");
        checkTime(marker.time, `${list}[${i}].time`);
        checkStatus(marker.status, `${list}[${i}]`);
      });
      checkOrder(map[list].map((m) => m && m.time), list);
    }
    if (map.sections !== undefined) {
      if (!Array.isArray(map.sections)) add("sections", "must be an array");
      else {
        map.sections.forEach((section, i) => {
          const at = `sections[${i}]`;
          if (!section || typeof section !== "object") return add(at, "must be an object");
          checkSpan(section, at);
          if (typeof section.label !== "string" || !section.label.trim()) add(`${at}.label`, "is missing");
          checkStatus(section.status, at);
        });
        checkOrder(map.sections.map((s) => s && s.start), "sections");
      }
    }
    return issues;
  }

  // Every reviewable entry (phrases and marker objects; bare beat times carry no status).
  function reviewables(map) {
    const out = [];
    (map.phrases || []).forEach((p, i) => out.push({ path: `phrases[${i}]`, status: p && p.status }));
    for (const list of [...MARKER_LISTS, "sections"]) {
      (map[list] || []).forEach((m, i) => out.push({ path: `${list}[${i}]`, status: m && m.status }));
    }
    return out;
  }

  function statusCounts(map) {
    const counts = { estimated: 0, listened: 0, reviewed: 0 };
    for (const { status } of reviewables(map)) if (status in counts) counts[status]++;
    return counts;
  }

  // Entries ranked below `minimum`; a `held: true` entry is an explicit hold and passes.
  function belowStatus(map, minimum) {
    const rank = STATUSES.indexOf(minimum);
    if (rank < 0) throw new Error(`unknown status ${minimum}`);
    return reviewables(map).filter((entry) => {
      const item = itemAt(map, entry.path);
      return !(item && item.held === true) && STATUSES.indexOf(entry.status) < rank;
    });
  }

  function itemAt(map, path) {
    const m = path.match(/^(\w+)\[(\d+)\]$/);
    return m && map[m[1]] ? map[m[1]][Number(m[2])] : undefined;
  }

  // Index of the span sounding at `time`; with overlapping voices the latest start wins.
  function activeIndex(spans, time) {
    let found = -1;
    if (!Array.isArray(spans)) return found;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      if (s && s.start <= time && time < s.end && (found < 0 || s.start >= spans[found].start)) found = i;
    }
    return found;
  }

  return { STATUSES, validateMap, statusCounts, belowStatus, activeIndex };
});
