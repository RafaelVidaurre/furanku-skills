"use strict";

const enabled =
  Boolean(process.stdout.isTTY) &&
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb";

/** Truecolor where available; 256-color fallbacks keep gold/purple readable. */
const codes = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  // Gold (primary highlight)
  gold: "\x1b[38;2;212;175;55m",
  gold256: "\x1b[38;5;178m",
  // Soft gold for secondary text
  softGold: "\x1b[38;2;232;200;110m",
  softGold256: "\x1b[38;5;221m",
  // Purple (brand accent)
  purple: "\x1b[38;2;155;89;182m",
  purple256: "\x1b[38;5;141m",
  // Deep purple for stronger emphasis
  deepPurple: "\x1b[38;2;108;52;131m",
  deepPurple256: "\x1b[38;5;97m",
  // Muted steel-blue for filesystem paths / CWD (distinct from gold/purple/dim)
  path: "\x1b[38;2;122;158;172m",
  path256: "\x1b[38;5;109m",
  // Status (kept semantic)
  green: "\x1b[32m",
  red: "\x1b[31m",
  // Legacy aliases used across the codebase
  cyan: "\x1b[38;2;155;89;182m",
  cyan256: "\x1b[38;5;141m",
  yellow: "\x1b[38;2;212;175;55m",
  yellow256: "\x1b[38;5;178m",
  magenta: "\x1b[38;2;155;89;182m",
  magenta256: "\x1b[38;5;141m",
  white: "\x1b[37m",
};

function colorCode(name) {
  // Prefer truecolor; terminals that don't support it still usually render fine,
  // and NO_COLOR / non-TTY short-circuit before paint.
  return codes[name] || codes.purple;
}

function paint(code, text) {
  if (!enabled) return String(text);
  return `${code}${text}${codes.reset}`;
}

const bold = (t) => paint(codes.bold, t);
const dim = (t) => paint(codes.dim, t);
const gold = (t) => paint(colorCode("gold"), t);
const softGold = (t) => paint(colorCode("softGold"), t);
const purple = (t) => paint(colorCode("purple"), t);
const deepPurple = (t) => paint(colorCode("deepPurple"), t);
/** Filesystem paths and CWD — muted steel-blue, not dim grey. */
const path = (t) => paint(colorCode("path"), t);
/** Primary accent — purple. */
const accent = purple;
/** Secondary accent — gold. */
const highlight = gold;
// Back-compat aliases (now gold/purple palette)
const cyan = purple;
const green = (t) => paint(codes.green, t);
const yellow = gold;
const magenta = purple;
const red = (t) => paint(codes.red, t);

/** Figlet-style wordmark — designed to stay ~50 columns. */
const BANNER_LINES = [
  "  ███████╗██╗   ██╗██████╗  █████╗ ███╗   ██╗██╗  ██╗██╗   ██╗",
  "  ██╔════╝██║   ██║██╔══██╗██╔══██╗████╗  ██║██║ ██╔╝██║   ██║",
  "  █████╗  ██║   ██║██████╔╝███████║██╔██╗ ██║█████╔╝ ██║   ██║",
  "  ██╔══╝  ██║   ██║██╔══██╗██╔══██║██║╚██╗██║██╔═██╗ ██║   ██║",
  "  ██║     ╚██████╔╝██║  ██║██║  ██║██║ ╚████║██║  ██╗╚██████╔╝",
  "  ╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝ ╚═════╝ ",
  "   ███████╗██╗  ██╗██╗██╗     ██╗     ███████╗",
  "   ██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝",
  "   ███████╗█████╔╝ ██║██║     ██║     ███████╗",
  "   ╚════██║██╔═██╗ ██║██║     ██║     ╚════██║",
  "   ███████║██║  ██╗██║███████╗███████╗███████║",
  "   ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝",
];

function banner() {
  const furanku = BANNER_LINES.slice(0, 6)
    .map((line) => gold(bold(line)))
    .join("\n");
  const skills = BANNER_LINES.slice(6)
    .map((line) => purple(bold(line)))
    .join("\n");
  return `${furanku}\n${skills}\n`;
}

function step(n, total, title) {
  const label = total ? `${n}/${total}` : String(n);
  return `\n${purple(bold(`── ${label}  ${title} `))}${dim("─".repeat(Math.max(4, 36 - title.length)))}\n`;
}

function ok(message) {
  return `${green("✓")} ${message}`;
}

function warn(message) {
  return `${gold("!")} ${message}`;
}

function info(message) {
  return `${purple("→")} ${message}`;
}

function bullet(message) {
  return `  ${dim("•")} ${message}`;
}

function sectionTitle(title) {
  return bold(title);
}

/** Cursor marker for interactive menus. */
function cursor(selected) {
  return selected ? gold(bold("›")) : dim(" ");
}

/** Shared keyboard footer for arrow menus. */
function keyHints(extra = "") {
  const base = "↑/↓  ·  Enter select  ·  Esc cancel";
  const text = extra ? `${base}  ·  ${extra}` : base;
  return dim(`  ${text}`);
}

module.exports = {
  enabled,
  bold,
  dim,
  gold,
  softGold,
  purple,
  deepPurple,
  path,
  accent,
  highlight,
  cyan,
  green,
  yellow,
  magenta,
  red,
  banner,
  step,
  ok,
  warn,
  info,
  bullet,
  sectionTitle,
  cursor,
  keyHints,
};
