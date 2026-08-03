"use strict";

const readline = require("readline");
const style = require("./style");

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
 * Number-based picker (fallback / non-TTY).
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
  const raw = (await question(rl, `${prompt} [${def}]: `)).trim();
  if (!raw) return defaultIndex;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > choices.length) {
    return defaultIndex;
  }
  return n - 1;
}

/**
 * Arrow-key cursor menu. Requires a TTY.
 * @param {string[]} choices plain labels (may include ANSI)
 * @param {{
 *   prompt?: string,
 *   defaultIndex?: number,
 *   footer?: string,
 * }} [opts]
 * @returns {Promise<number>} zero-based index
 */
async function selectWithCursor(choices, opts = {}) {
  if (!choices.length) {
    throw new Error("selectWithCursor requires at least one choice");
  }

  const prompt = opts.prompt || "Select";
  const defaultIndex = Math.min(
    Math.max(0, opts.defaultIndex || 0),
    choices.length - 1
  );
  const footer =
    opts.footer ||
    style.dim("  ↑/↓ move  ·  Enter select  ·  Esc exit");

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const rl = createRl();
    try {
      return await chooseIndex(rl, prompt, choices, defaultIndex);
    } finally {
      rl.close();
    }
  }

  return new Promise((resolve, reject) => {
    let index = defaultIndex;
    let cleaned = false;
    // Header (1) + blank (1) + choices + footer (1) + blank after footer (0)
    // We print: prompt line, blank, N choices, blank, footer
    const totalLines = 2 + choices.length + 2;

    readline.emitKeypressEvents(process.stdin);
    const previousRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    if (process.stdin.isPaused()) process.stdin.resume();

    // Hide terminal cursor while the menu is open
    process.stdout.write("\x1b[?25l");

    function formatChoice(text, on) {
      const sep = "  — ";
      const at = text.indexOf(sep);
      if (at === -1) {
        return on ? style.softGold(text) : text;
      }
      const main = text.slice(0, at);
      const hint = text.slice(at + sep.length);
      if (on) {
        return `${style.softGold(main)}  ${style.dim(`— ${hint}`)}`;
      }
      return `${main}  ${style.dim(`— ${hint}`)}`;
    }

    function paint() {
      const lines = [];
      lines.push(style.bold(`  ${prompt}`));
      lines.push("");
      for (let i = 0; i < choices.length; i++) {
        const on = i === index;
        const mark = style.cursor(on);
        lines.push(`  ${mark} ${formatChoice(choices[i], on)}`);
      }
      lines.push("");
      lines.push(footer);
      return lines;
    }

    function render(first) {
      if (!first) {
        // Move to top of previous menu block and clear downward
        process.stdout.write(`\x1b[${totalLines}A`);
        process.stdout.write("\x1b[0J");
      }
      const lines = paint();
      process.stdout.write(lines.join("\n") + "\n");
    }

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      process.stdin.removeListener("keypress", onKeypress);
      try {
        process.stdin.setRawMode(previousRaw);
      } catch {
        /* ignore */
      }
      process.stdout.write("\x1b[?25h"); // show cursor
    }

    function finish(value) {
      cleanup();
      resolve(value);
    }

    function onKeypress(_str, key) {
      if (!key) return;

      if (key.ctrl && key.name === "c") {
        cleanup();
        process.stdout.write("\n");
        process.exit(130);
      }

      if (key.name === "escape") {
        // Treat Esc as "pick Exit" when present, else cancel → last item
        const exitIdx = choices.findIndex((c) =>
          /\bexit\b/i.test(String(c).replace(/\x1b\[[0-9;]*m/g, ""))
        );
        finish(exitIdx >= 0 ? exitIdx : choices.length - 1);
        return;
      }

      if (key.name === "up" || key.name === "k") {
        index = (index - 1 + choices.length) % choices.length;
        render(false);
        return;
      }

      if (key.name === "down" || key.name === "j") {
        index = (index + 1) % choices.length;
        render(false);
        return;
      }

      // Number hotkeys 1–9
      if (key.name && /^[1-9]$/.test(key.name)) {
        const n = Number(key.name) - 1;
        if (n < choices.length) {
          index = n;
          render(false);
        }
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        finish(index);
      }
    }

    process.stdin.on("keypress", onKeypress);
    try {
      render(true);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
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
  selectWithCursor,
  multiSelect,
};
