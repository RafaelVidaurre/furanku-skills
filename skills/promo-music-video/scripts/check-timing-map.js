#!/usr/bin/env node
"use strict";

// Structural check of a timing map, optionally gated on review status (see references/song-timing.md).
const fs = require("fs");
const path = require("path");
const { STATUSES, validateMap, statusCounts, belowStatus } = require(path.join(__dirname, "..", "assets", "timing-player", "timing-map.js"));

const USAGE = `usage: check-timing-map.js <map.json> [--duration <seconds>] [--min-status ${STATUSES.join("|")}]`;

function main(argv) {
  const args = { file: undefined, duration: undefined, minStatus: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--duration") args.duration = Number(argv[++i]);
    else if (arg === "--min-status") args.minStatus = argv[++i];
    else if (arg === "-h" || arg === "--help") return usage(0);
    else if (!args.file && !arg.startsWith("-")) args.file = arg;
    else return usage(2, `unexpected argument ${arg}`);
  }
  if (!args.file) return usage(2, "missing map file");
  if (args.duration !== undefined && !(Number.isFinite(args.duration) && args.duration > 0)) return usage(2, "--duration needs a positive number of seconds");
  if (args.minStatus !== undefined && !STATUSES.includes(args.minStatus)) return usage(2, `--min-status must be one of ${STATUSES.join(", ")}`);

  let map;
  try {
    map = JSON.parse(fs.readFileSync(args.file, "utf8"));
  } catch (e) {
    console.error(`${args.file}: ${e.message}`);
    return 1;
  }
  const issues = validateMap(map, { duration: args.duration });
  for (const { path: at, message } of issues) console.log(`issue  ${at} ${message}`);
  const pending = issues.length || !args.minStatus ? [] : belowStatus(map, args.minStatus);
  for (const { path: at, status } of pending) console.log(`below  ${at} is ${status}, needs ${args.minStatus} or held: true`);
  const counts = statusCounts(map);
  console.log(`${issues.length} structural issue(s); status: ${STATUSES.map((s) => `${counts[s]} ${s}`).join(", ")}`);
  return issues.length || pending.length ? 1 : 0;
}

function usage(code, message) {
  if (message) console.error(message);
  (code ? console.error : console.log)(USAGE);
  return code;
}

process.exitCode = main(process.argv.slice(2));
