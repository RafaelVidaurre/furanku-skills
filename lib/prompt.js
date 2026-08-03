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

/** Visible terminal columns (fallback 80). */
function termColumns() {
  const c = process.stdout.columns;
  return Number.isInteger(c) && c > 20 ? c : 80;
}

/**
 * Truncate a possibly-ANSI string to at most `width` visible columns.
 * Drops ANSI when truncating (labels stay readable).
 */
function fitVisible(text, width) {
  const plain = stripAnsi(text);
  if (plain.length <= width) return text;
  if (width <= 1) return "…";
  return `${plain.slice(0, width - 1)}…`;
}

/**
 * Arrow-key cursor menu. Redraws in place via DECSC/DECRC so wrapped lines
 * and dynamic labels don't leave scrollback garbage.
 *
 * @param {string[] | (() => string[])} choicesOrFn
 * @param {{
 *   prompt?: string | (() => string),
 *   defaultIndex?: number,
 *   footer?: string | (() => string),
 *   onSpace?: (index: number) => void,
 *   onEnter?: (index: number) => boolean | false | { stay: true, index?: number } | void,
 *     // return false or { stay:true } to keep the session open and redraw
 *   onEscape?: (index: number) => number | false | void,
 * }} [opts]
 * @returns {Promise<number>}
 */
async function selectWithCursor(choicesOrFn, opts = {}) {
  const getChoices = () => {
    const c = typeof choicesOrFn === "function" ? choicesOrFn() : choicesOrFn;
    if (!Array.isArray(c) || c.length === 0) {
      throw new Error("selectWithCursor requires at least one choice");
    }
    return c;
  };

  const getPrompt = () => {
    const p = typeof opts.prompt === "function" ? opts.prompt() : opts.prompt;
    return p == null || p === "" ? "Select" : String(p);
  };

  const getFooter = () => {
    const f = typeof opts.footer === "function" ? opts.footer() : opts.footer;
    return f == null
      ? style.dim("  ↑/↓ move  ·  Enter select  ·  Esc exit")
      : f;
  };

  let choices = getChoices();
  let index = Math.min(Math.max(0, opts.defaultIndex || 0), choices.length - 1);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const rl = createRl();
    try {
      const flatPrompt = stripAnsi(getPrompt()).split("\n")[0] || "Select";
      return await chooseIndex(rl, flatPrompt, choices.map(stripAnsi), index);
    } finally {
      rl.close();
    }
  }

  return new Promise((resolve, reject) => {
    let cleaned = false;
    let originSaved = false;

    readline.emitKeypressEvents(process.stdin);
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
      if (index >= choices.length) index = Math.max(0, choices.length - 1);
      if (index < 0) index = 0;

      const cols = termColumns();
      // Leave a little margin; cursor mark + padding ≈ 4 cols
      const maxChoice = Math.max(16, cols - 4);

      const lines = [];
      for (const line of getPrompt().split("\n")) {
        lines.push(style.bold(`  ${fitVisible(line, cols - 2)}`));
      }
      lines.push("");
      for (let i = 0; i < choices.length; i++) {
        const on = i === index;
        const body = fitVisible(formatChoice(choices[i], on), maxChoice);
        lines.push(`  ${style.cursor(on)} ${body}`);
      }
      lines.push("");
      lines.push(fitVisible(getFooter(), cols - 2));
      return lines;
    }

    /**
     * In-place redraw: restore to the first frame's origin, erase everything
     * below, then repaint. Avoids the classic "count lines / move up" bug when
     * labels wrap or change height.
     */
    function render() {
      if (originSaved) {
        process.stdout.write("\x1b8"); // DECRC — restore cursor
        process.stdout.write("\x1b[J"); // erase from cursor to end of screen
      } else {
        process.stdout.write("\x1b7"); // DECSC — save cursor
        originSaved = true;
      }
      const lines = paint();
      process.stdout.write(`${lines.join("\n")}\n`);
    }

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      process.stdin.removeListener("keypress", onKeypress);
      try {
        // Always leave cooked mode so nested sessions don't leave raw on
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      // Pause so a finished menu does not keep the event loop (and Exit) alive
      try {
        process.stdin.pause();
      } catch {
        /* ignore */
      }
      process.stdout.write("\x1b[?25h");
    }

    function finish(value) {
      cleanup();
      // Leave the last frame visible; advance a blank line for following output
      process.stdout.write("\n");
      resolve(value);
    }

    function onKeypress(_str, key) {
      if (!key || cleaned) return;

      if (key.ctrl && key.name === "c") {
        cleanup();
        process.stdout.write("\n");
        process.exit(130);
      }

      if (key.name === "escape") {
        if (typeof opts.onEscape === "function") {
          const v = opts.onEscape(index);
          const stay =
            v === false ||
            (v && typeof v === "object" && v.stay === true);
          if (stay) {
            if (v && typeof v === "object" && typeof v.index === "number") {
              index = v.index;
            }
            choices = getChoices();
            if (index >= choices.length) index = Math.max(0, choices.length - 1);
            if (index < 0) index = 0;
            render();
            return;
          }
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
        render();
        return;
      }

      if (key.name === "down" || key.name === "j") {
        choices = getChoices();
        index = (index + 1) % choices.length;
        render();
        return;
      }

      if (key.name === "space") {
        if (typeof opts.onSpace === "function") {
          opts.onSpace(index);
          choices = getChoices();
          if (index >= choices.length) index = Math.max(0, choices.length - 1);
          render();
          return;
        }
      }

      if (key.name && /^[1-9]$/.test(key.name)) {
        const n = Number(key.name) - 1;
        choices = getChoices();
        if (n < choices.length) {
          index = n;
          render();
        }
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        if (typeof opts.onEnter === "function") {
          const result = opts.onEnter(index);
          const stay =
            result === false ||
            (result && typeof result === "object" && result.stay === true);
          if (stay) {
            if (
              result &&
              typeof result === "object" &&
              typeof result.index === "number"
            ) {
              index = result.index;
            }
            choices = getChoices();
            if (index >= choices.length) index = Math.max(0, choices.length - 1);
            if (index < 0) index = 0;
            render();
            return;
          }
        }
        finish(index);
      }
    }

    process.stdin.on("keypress", onKeypress);
    try {
      render();
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
 * One continuous TTY session (no stacked frames). Each level has **All** to
 * select/clear every descendant leaf. Enter opens folders; Enter/Space toggles
 * leaves.
 *
 * @param {{
 *   id?: string,
 *   label: string,
 *   description?: string,
 *   children?: { id?: string, label: string, description?: string, children?: any[] }[],
 * }[]} tree
 * @param {{
 *   title?: string,
 *   description?: string,
 *   initialSelected?: string[],
 * }} [opts]
 * @returns {Promise<string[] | null>}
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
  /** @type {string[] | null | undefined} */
  let outcome;

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

  /** @type {{ type: string, node?: any, label: () => string }[]} */
  let items = [];

  function rebuildItems() {
    const atRoot = stack.length === 0;
    items = [];

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
            // Keep folder rows short — full description is in the header when open
            return `${node.label}  — ${n}/${ids.length}`;
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
    return items;
  }

  function activate(i) {
    const chosen = items[i];
    if (!chosen) {
      outcome = null;
      return true; // finish
    }

    if (chosen.type === "all") {
      toggleIds(levelLeafIds(level.nodes));
      cursor = 0;
      return false; // stay
    }

    if (chosen.type === "folder") {
      stack.push(level);
      level = {
        title: chosen.node.label,
        description: chosen.node.description || "",
        nodes: chosen.node.children,
      };
      cursor = 0;
      return false;
    }

    if (chosen.type === "leaf") {
      toggleIds([String(chosen.node.id)]);
      return false;
    }

    if (chosen.type === "back") {
      level = stack.pop() || level;
      cursor = 0;
      return false;
    }

    if (chosen.type === "done") {
      outcome = [...selected];
      return true;
    }

    if (chosen.type === "cancel") {
      outcome = null;
      return true;
    }

    return false;
  }

  rebuildItems();

  await selectWithCursor(
    () => {
      rebuildItems();
      return items.map((it) => it.label());
    },
    {
      prompt: () => {
        const selectedPreview = [...selected].join(", ") || "(none)";
        const lines = [level.title];
        if (level.description) lines.push(level.description);
        lines.push(`Selected: ${selectedPreview}`);
        return lines.join("\n");
      },
      defaultIndex: cursor,
      footer: () =>
        style.dim(
          stack.length === 0
            ? "  ↑/↓  ·  Enter open/toggle  ·  Space toggle  ·  Esc cancel"
            : "  ↑/↓  ·  Enter open/toggle  ·  Space toggle  ·  Esc back"
        ),
      onSpace: (i) => {
        const it = items[i];
        if (!it) return;
        if (it.type === "all") toggleIds(levelLeafIds(level.nodes));
        else if (it.type === "folder") toggleIds(collectLeafIds(it.node));
        else if (it.type === "leaf") toggleIds([String(it.node.id)]);
      },
      onEnter: (i) => {
        cursor = i;
        const shouldFinish = activate(i);
        if (shouldFinish) return true;
        // Stay open; jump cursor after folder dive / back
        return { stay: true, index: cursor };
      },
      onEscape: () => {
        if (stack.length > 0) {
          level = stack.pop() || level;
          cursor = 0;
          return { stay: true, index: 0 };
        }
        outcome = null;
        rebuildItems();
        const cancelIdx = items.findIndex((it) => it.type === "cancel");
        return cancelIdx >= 0 ? cancelIdx : items.length - 1;
      },
    }
  );

  // If user finished via Cancel index without setting outcome, treat as cancel
  if (outcome === undefined) {
    // Enter on cancel/done should have set outcome; guard anyway
    return null;
  }
  return outcome;
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
    process.stdout.write(
      `  [${i + 1}] ${item.id}  ${item.label ? `— ${item.label}` : ""}\n`
    );
  });
  const raw = (
    await question(rl, `${prompt} (numbers or ids, comma-separated): `)
  ).trim();
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
  fitVisible,
  stripAnsi,
};
