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

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Arrow-key cursor menu. Requires a TTY for the nice path.
 *
 * @param {string[] | (() => string[])} choicesOrFn labels (may include ANSI);
 *   pass a function when labels change (e.g. after Space toggles)
 * @param {{
 *   prompt?: string,
 *   defaultIndex?: number,
 *   footer?: string,
 *   onSpace?: (index: number) => void,
 *   onEscape?: (index: number) => number | void,
 * }} [opts]
 * @returns {Promise<number>} zero-based index (or value from onEscape)
 */
async function selectWithCursor(choicesOrFn, opts = {}) {
  const getChoices = () => {
    const c = typeof choicesOrFn === "function" ? choicesOrFn() : choicesOrFn;
    if (!Array.isArray(c) || c.length === 0) {
      throw new Error("selectWithCursor requires at least one choice");
    }
    return c;
  };

  let choices = getChoices();
  const prompt = opts.prompt || "Select";
  let index = Math.min(Math.max(0, opts.defaultIndex || 0), choices.length - 1);
  const footer =
    opts.footer ||
    style.dim("  ↑/↓ move  ·  Enter select  ·  Esc exit");

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const rl = createRl();
    try {
      // Flatten multi-line prompt for the fallback question
      const flatPrompt = stripAnsi(prompt).split("\n")[0] || "Select";
      return await chooseIndex(rl, flatPrompt, choices.map(stripAnsi), index);
    } finally {
      rl.close();
    }
  }

  return new Promise((resolve, reject) => {
    let cleaned = false;
    let paintedLines = 0;

    readline.emitKeypressEvents(process.stdin);
    const previousRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    if (process.stdin.isPaused()) process.stdin.resume();

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
      choices = getChoices();
      if (index >= choices.length) index = choices.length - 1;
      if (index < 0) index = 0;

      const lines = [];
      for (const line of String(prompt).split("\n")) {
        lines.push(style.bold(`  ${line}`));
      }
      lines.push("");
      for (let i = 0; i < choices.length; i++) {
        const on = i === index;
        lines.push(`  ${style.cursor(on)} ${formatChoice(choices[i], on)}`);
      }
      lines.push("");
      lines.push(footer);
      return lines;
    }

    function render(first) {
      if (!first && paintedLines > 0) {
        process.stdout.write(`\x1b[${paintedLines}A`);
        process.stdout.write("\x1b[0J");
      }
      const lines = paint();
      paintedLines = lines.length;
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
      process.stdout.write("\x1b[?25h");
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
        if (typeof opts.onEscape === "function") {
          const v = opts.onEscape(index);
          if (typeof v === "number") {
            finish(v);
            return;
          }
        }
        const exitIdx = choices.findIndex((c) =>
          /\b(exit|cancel)\b/i.test(stripAnsi(c))
        );
        finish(exitIdx >= 0 ? exitIdx : choices.length - 1);
        return;
      }

      if (key.name === "up" || key.name === "k") {
        choices = getChoices();
        index = (index - 1 + choices.length) % choices.length;
        render(false);
        return;
      }

      if (key.name === "down" || key.name === "j") {
        choices = getChoices();
        index = (index + 1) % choices.length;
        render(false);
        return;
      }

      if (key.name === "space") {
        if (typeof opts.onSpace === "function") {
          opts.onSpace(index);
          choices = getChoices();
          if (index >= choices.length) index = Math.max(0, choices.length - 1);
          render(false);
          return;
        }
      }

      if (key.name && /^[1-9]$/.test(key.name)) {
        const n = Number(key.name) - 1;
        choices = getChoices();
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
 * Collect selectable leaf ids under a browse node (recursive).
 * @param {{ id?: string, children?: any[] }} node
 * @returns {string[]}
 */
function collectLeafIds(node) {
  if (!node) return [];
  if (node.children && node.children.length) {
    return node.children.flatMap(collectLeafIds);
  }
  return node.id != null ? [String(node.id)] : [];
}

/**
 * Hierarchical multi-select browser with cursor navigation.
 *
 * Each folder/root level offers **All** (select/clear every leaf under this
 * level). Enter a folder to dive; toggle leaves with Enter or Space.
 *
 * @param {{
 *   id?: string,
 *   label: string,
 *   description?: string,
 *   children?: { id?: string, label: string, description?: string, children?: any[] }[],
 * }[]} tree  top-level folders (or leaves)
 * @param {{
 *   title?: string,
 *   description?: string,
 *   initialSelected?: string[],
 * }} [opts]
 * @returns {Promise<string[] | null>} selected leaf ids, or null if cancelled
 */
async function hierarchicalMultiSelect(tree, opts = {}) {
  if (!tree || tree.length === 0) {
    throw new Error("hierarchicalMultiSelect requires a non-empty tree");
  }

  const selected = new Set(
    (opts.initialSelected || []).map(String).filter(Boolean)
  );
  /** @type {{ title: string, description?: string, nodes: typeof tree }[]} */
  const stack = [];
  let level = {
    title: opts.title || "Select",
    description: opts.description || "",
    nodes: tree,
  };
  let cursor = 0;

  function levelLeafIds(nodes) {
    return nodes.flatMap(collectLeafIds);
  }

  function toggleIds(ids) {
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    if (allOn) {
      for (const id of ids) selected.delete(id);
    } else {
      for (const id of ids) selected.add(id);
    }
  }

  while (true) {
    const atRoot = stack.length === 0;
    const leafIdsHere = levelLeafIds(level.nodes);

    /** @type {{ type: string, node?: any, label: () => string }[]} */
    const items = [];

    items.push({
      type: "all",
      label: () => {
        const ids = levelLeafIds(level.nodes);
        const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
        return allOn
          ? `All  — clear all ${ids.length} at this level`
          : `All  — select all ${ids.length} at this level`;
      },
    });

    for (const node of level.nodes) {
      if (node.children && node.children.length) {
        items.push({
          type: "folder",
          node,
          label: () => {
            const ids = collectLeafIds(node);
            const n = ids.filter((id) => selected.has(id)).length;
            const desc = node.description ? ` · ${node.description}` : "";
            return `${node.label}  — ${n}/${ids.length}${desc}`;
          },
        });
      } else {
        items.push({
          type: "leaf",
          node,
          label: () => {
            const on = selected.has(String(node.id));
            const mark = on ? "☑" : "☐";
            const hint = node.description || node.id || "";
            return `${mark} ${node.label}  — ${hint}`;
          },
        });
      }
    }

    if (!atRoot) {
      items.push({ type: "back", label: () => "← Back" });
    } else {
      items.push({
        type: "done",
        label: () =>
          selected.size
            ? `Done — continue with ${selected.size} selected`
            : "Done — nothing selected",
      });
      items.push({ type: "cancel", label: () => "Cancel" });
    }

    const selectedPreview = [...selected].join(", ") || "(none)";
    const promptLines = [level.title];
    if (level.description) promptLines.push(level.description);
    promptLines.push(`Selected: ${selectedPreview}`);

    const idx = await selectWithCursor(
      () => items.map((it) => it.label()),
      {
        prompt: promptLines.join("\n"),
        defaultIndex: Math.min(cursor, items.length - 1),
        footer: style.dim(
          atRoot
            ? "  ↑/↓  ·  Enter open/toggle  ·  Space toggle  ·  Esc cancel"
            : "  ↑/↓  ·  Enter open/toggle  ·  Space toggle  ·  Esc back"
        ),
        onSpace: (i) => {
          const it = items[i];
          if (!it) return;
          if (it.type === "all") {
            toggleIds(levelLeafIds(level.nodes));
          } else if (it.type === "folder") {
            toggleIds(collectLeafIds(it.node));
          } else if (it.type === "leaf") {
            toggleIds([String(it.node.id)]);
          }
        },
        onEscape: () => {
          // Signal via special indices handled below by mapping cancel/back
          if (!atRoot) {
            // Will be handled after by returning a synthetic - use item index
            return items.findIndex((it) => it.type === "back");
          }
          return items.findIndex((it) => it.type === "cancel");
        },
      }
    );

    cursor = idx;
    const chosen = items[idx];
    if (!chosen) return null;

    if (chosen.type === "all") {
      toggleIds(leafIdsHere);
      // stay on this level; reset cursor to All
      cursor = 0;
      continue;
    }

    if (chosen.type === "folder") {
      // Enter dives; Space already toggled without leaving
      stack.push(level);
      level = {
        title: chosen.node.label,
        description: chosen.node.description || "",
        nodes: chosen.node.children,
      };
      cursor = 0;
      continue;
    }

    if (chosen.type === "leaf") {
      toggleIds([String(chosen.node.id)]);
      continue;
    }

    if (chosen.type === "back") {
      level = stack.pop() || level;
      cursor = 0;
      continue;
    }

    if (chosen.type === "done") {
      return [...selected];
    }

    if (chosen.type === "cancel") {
      return null;
    }
  }
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
  hierarchicalMultiSelect,
  collectLeafIds,
  multiSelect,
};
