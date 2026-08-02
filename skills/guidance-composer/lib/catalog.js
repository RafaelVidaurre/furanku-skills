"use strict";

const fs = require("fs");
const path = require("path");

const CATALOG_PATH = path.join(__dirname, "..", "references", "catalog.json");

function loadCatalog(catalogPath = CATALOG_PATH) {
  const raw = fs.readFileSync(catalogPath, "utf8");
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.entries)) {
    throw new Error("catalog must be version 1 with categories[] and entries[]");
  }
  const categoryIds = new Set(data.categories.map((c) => c.id));
  const entryIds = new Set();
  for (const entry of data.entries) {
    if (!entry.id || entryIds.has(entry.id)) {
      throw new Error(`invalid or duplicate entry id: ${entry?.id}`);
    }
    entryIds.add(entry.id);
    if (!categoryIds.has(entry.category)) {
      throw new Error(`entry ${entry.id} references unknown category ${entry.category}`);
    }
    if (!Array.isArray(entry.inject) || entry.inject.length === 0) {
      throw new Error(`entry ${entry.id} needs non-empty inject[]`);
    }
    if (!Array.isArray(entry.conflicts)) {
      throw new Error(`entry ${entry.id} needs conflicts[]`);
    }
  }
  return data;
}

function categoryMap(catalog) {
  return new Map(catalog.categories.map((c) => [c.id, c]));
}

function entryMap(catalog) {
  return new Map(catalog.entries.map((e) => [e.id, e]));
}

function resolveIds(catalog, tokens) {
  const byId = entryMap(catalog);
  const byTitle = new Map(
    catalog.entries.map((e) => [e.title.toLowerCase(), e.id])
  );
  const resolved = [];
  const unknown = [];
  for (const token of tokens) {
    const key = String(token).trim();
    if (!key) continue;
    if (byId.has(key)) {
      resolved.push(key);
      continue;
    }
    const viaTitle = byTitle.get(key.toLowerCase());
    if (viaTitle) {
      resolved.push(viaTitle);
      continue;
    }
    unknown.push(key);
  }
  return { ids: [...new Set(resolved)], unknown };
}

function filterEntries(catalog, { category, tag, query } = {}) {
  let entries = catalog.entries;
  if (category) {
    entries = entries.filter((e) => e.category === category);
  }
  if (tag) {
    entries = entries.filter((e) => (e.tags || []).includes(tag));
  }
  if (query) {
    const q = query.toLowerCase();
    entries = entries.filter((e) => {
      const hay = [
        e.id,
        e.title,
        e.picker,
        e.category,
        ...(e.tags || []),
        ...e.inject,
      ]
        .join("\n")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return entries;
}

function conflictPairs(catalog, ids) {
  const set = new Set(ids);
  const byId = entryMap(catalog);
  const pairs = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) continue;
    for (const other of entry.conflicts || []) {
      if (set.has(other) && id < other) {
        pairs.push([id, other]);
      }
    }
  }
  return pairs;
}

function injectLines(catalog, ids) {
  const byId = entryMap(catalog);
  const lines = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) {
      throw new Error(`unknown entry id: ${id}`);
    }
    for (const line of entry.inject) {
      lines.push(line.startsWith("- ") ? line : `- ${line}`);
    }
  }
  return lines;
}

module.exports = {
  CATALOG_PATH,
  loadCatalog,
  categoryMap,
  entryMap,
  resolveIds,
  filterEntries,
  conflictPairs,
  injectLines,
};
