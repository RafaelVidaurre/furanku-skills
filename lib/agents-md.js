"use strict";

const fs = require("fs");
const path = require("path");

const AGENTS_NAME = "AGENTS.md";
const CLAUDE_NAME = "CLAUDE.md";

const AGENT_FILE_CANDIDATES = [
  "AGENTS.md",
  "Agents.md",
  "agents.md",
  "CLAUDE.md",
  "Claude.md",
  "claude.md",
];

const DEFAULT_AGENTS_BODY = `# AGENTS.md

Project instructions for AI coding agents.

`;

/**
 * @param {string} root
 * @param {{ existsSync?: Function }} [fsLike=fs]
 */
function findAgentInstructionFile(root, fsLike = fs) {
  for (const name of AGENT_FILE_CANDIDATES) {
    const p = path.join(root, name);
    if (fsLike.existsSync(p)) return p;
  }
  return null;
}

/**
 * Preferred write target: existing AGENTS* if present, else CLAUDE*, else AGENTS.md path.
 * @param {string} root
 * @param {{ existsSync?: Function }} [fsLike=fs]
 */
function resolveAgentInstructionPath(root, fsLike = fs) {
  const agentsFirst = ["AGENTS.md", "Agents.md", "agents.md"];
  for (const name of agentsFirst) {
    const p = path.join(root, name);
    if (fsLike.existsSync(p)) return p;
  }
  for (const name of ["CLAUDE.md", "Claude.md", "claude.md"]) {
    const p = path.join(root, name);
    if (fsLike.existsSync(p)) return p;
  }
  return path.join(root, AGENTS_NAME);
}

/**
 * @param {string} root
 * @param {{ existsSync?: Function, lstatSync?: Function, readlinkSync?: Function }} [fsLike=fs]
 */
function inspectAgentsSetup(root, fsLike = fs) {
  const agentsPath = path.join(root, AGENTS_NAME);
  const claudePath = path.join(root, CLAUDE_NAME);
  const existing = findAgentInstructionFile(root, fsLike);

  let claude = { exists: false, isSymlink: false, target: null, pointsToAgents: false };
  if (fsLike.existsSync(claudePath)) {
    const st = fsLike.lstatSync(claudePath);
    claude.exists = true;
    claude.isSymlink = st.isSymbolicLink();
    if (claude.isSymlink) {
      try {
        claude.target = fsLike.readlinkSync(claudePath);
        const resolved = path.resolve(path.dirname(claudePath), claude.target);
        claude.pointsToAgents = path.resolve(agentsPath) === resolved;
      } catch {
        claude.target = null;
      }
    }
  }

  return {
    root,
    agentsPath,
    claudePath,
    existingInstructionFile: existing,
    hasAgentsMd: fsLike.existsSync(agentsPath),
    claude,
    complete:
      fsLike.existsSync(agentsPath) && claude.exists && claude.isSymlink && claude.pointsToAgents,
  };
}

/**
 * Create empty AGENTS.md (if missing) and CLAUDE.md → AGENTS.md symlink.
 *
 * @param {{
 *   root?: string,
 *   dryRun?: boolean,
 *   force?: boolean,
 *   body?: string,
 *   fsLike?: typeof fs,
 * }} [opts]
 * @returns {{ created: string[], skipped: string[], messages: string[] }}
 */
function createAgentsMd(opts = {}) {
  const root = path.resolve(opts.root || process.cwd());
  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);
  const fsLike = opts.fsLike || fs;
  const body = opts.body != null ? opts.body : DEFAULT_AGENTS_BODY;

  const agentsPath = path.join(root, AGENTS_NAME);
  const claudePath = path.join(root, CLAUDE_NAME);
  const created = [];
  const skipped = [];
  const messages = [];

  if (!fsLike.existsSync(agentsPath)) {
    if (!dryRun) {
      fsLike.writeFileSync(agentsPath, body, "utf8");
    }
    created.push(AGENTS_NAME);
    messages.push(`created ${AGENTS_NAME}`);
  } else {
    skipped.push(AGENTS_NAME);
    messages.push(`${AGENTS_NAME} already exists`);
  }

  if (fsLike.existsSync(claudePath)) {
    const st = fsLike.lstatSync(claudePath);
    if (st.isSymbolicLink()) {
      let target = null;
      try {
        target = fsLike.readlinkSync(claudePath);
      } catch {
        target = null;
      }
      const resolved = target
        ? path.resolve(path.dirname(claudePath), target)
        : null;
      if (resolved === path.resolve(agentsPath)) {
        skipped.push(CLAUDE_NAME);
        messages.push(`${CLAUDE_NAME} already links to ${AGENTS_NAME}`);
      } else if (force) {
        if (!dryRun) {
          fsLike.unlinkSync(claudePath);
          fsLike.symlinkSync(AGENTS_NAME, claudePath);
        }
        created.push(CLAUDE_NAME);
        messages.push(`replaced ${CLAUDE_NAME} symlink → ${AGENTS_NAME}`);
      } else {
        skipped.push(CLAUDE_NAME);
        messages.push(
          `${CLAUDE_NAME} is a symlink to ${target || "?"} (use --force to replace)`
        );
      }
    } else if (force) {
      if (!dryRun) {
        fsLike.unlinkSync(claudePath);
        fsLike.symlinkSync(AGENTS_NAME, claudePath);
      }
      created.push(CLAUDE_NAME);
      messages.push(`replaced ${CLAUDE_NAME} file with symlink → ${AGENTS_NAME}`);
    } else {
      skipped.push(CLAUDE_NAME);
      messages.push(
        `${CLAUDE_NAME} already exists as a regular file (use --force to replace with symlink)`
      );
    }
  } else {
    if (!dryRun) {
      fsLike.symlinkSync(AGENTS_NAME, claudePath);
    }
    created.push(CLAUDE_NAME);
    messages.push(`linked ${CLAUDE_NAME} → ${AGENTS_NAME}`);
  }

  return { root, created, skipped, messages, dryRun };
}

module.exports = {
  AGENTS_NAME,
  CLAUDE_NAME,
  AGENT_FILE_CANDIDATES,
  DEFAULT_AGENTS_BODY,
  findAgentInstructionFile,
  resolveAgentInstructionPath,
  inspectAgentsSetup,
  createAgentsMd,
};
