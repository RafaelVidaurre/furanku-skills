"use strict";

const readline = require("readline");

function createRl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

/**
 * @param {import("readline").Interface} rl
 * @param {string} prompt
 * @param {boolean} [defaultYes=true]
 */
async function confirm(rl, prompt, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  const raw = (await question(rl, `${prompt} [${hint}]: `)).trim().toLowerCase();
  if (!raw) return defaultYes;
  return raw === "y" || raw === "yes";
}

/**
 * @param {import("readline").Interface} rl
 * @param {string} prompt
 * @param {string[]} choices labels
 * @param {number} [defaultIndex=0]
 * @returns {Promise<number>} zero-based index
 */
async function chooseIndex(rl, prompt, choices, defaultIndex = 0) {
  for (let i = 0; i < choices.length; i++) {
    process.stdout.write(`  ${i + 1}) ${choices[i]}\n`);
  }
  const def = defaultIndex + 1;
  const raw = (
    await question(rl, `${prompt} [${def}]: `)
  ).trim();
  if (!raw) return defaultIndex;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > choices.length) {
    return defaultIndex;
  }
  return n - 1;
}

/**
 * Multi-select by numbers or ids.
 * @param {import("readline").Interface} rl
 * @param {string} prompt
 * @param {{ id: string, label: string }[]} items
 * @returns {Promise<string[]>} selected ids
 */
async function multiSelect(rl, prompt, items) {
  items.forEach((item, i) => {
    process.stdout.write(`  [${i + 1}] ${item.id}  ${item.label ? `— ${item.label}` : ""}\n`);
  });
  const raw = (await question(rl, `${prompt} (numbers or ids, comma-separated): `)).trim();
  if (!raw) return [];
  const tokens = raw.split(/[, \n]+/).map((s) => s.trim()).filter(Boolean);
  const selected = new Set();
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      const idx = Number(t) - 1;
      if (items[idx]) selected.add(items[idx].id);
    } else if (items.some((it) => it.id === t)) {
      selected.add(t);
    }
  }
  return [...selected];
}

module.exports = {
  createRl,
  question,
  confirm,
  chooseIndex,
  multiSelect,
};
