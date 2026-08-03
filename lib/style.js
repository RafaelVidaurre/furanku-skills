"use strict";

const enabled =
  Boolean(process.stdout.isTTY) &&
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb";

const codes = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  white: "\x1b[37m",
};

function paint(code, text) {
  if (!enabled) return String(text);
  return `${code}${text}${codes.reset}`;
}

const bold = (t) => paint(codes.bold, t);
const dim = (t) => paint(codes.dim, t);
const cyan = (t) => paint(codes.cyan, t);
const green = (t) => paint(codes.green, t);
const yellow = (t) => paint(codes.yellow, t);
const magenta = (t) => paint(codes.magenta, t);
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
  const art = BANNER_LINES.map((line) => cyan(bold(line))).join("\n");
  const tagline = dim("  agent skills  ·  project guidance  ·  furanku-skills");
  return `${art}\n${tagline}\n`;
}

function step(n, total, title) {
  const label = total ? `${n}/${total}` : String(n);
  return `\n${cyan(bold(`── ${label}  ${title} `))}${dim("─".repeat(Math.max(4, 36 - title.length)))}\n`;
}

function ok(message) {
  return `${green("✓")} ${message}`;
}

function warn(message) {
  return `${yellow("!")} ${message}`;
}

function info(message) {
  return `${cyan("→")} ${message}`;
}

function bullet(message) {
  return `  ${dim("•")} ${message}`;
}

function sectionTitle(title) {
  return bold(title);
}

module.exports = {
  enabled,
  bold,
  dim,
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
};
