"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * Harness instruction targets — paths from official docs (not a shared store).
 *
 * Project (agents.md standard + tool adapters):
 * - AGENTS.md at repo root is the portable default (agents.md; Codex; Cursor; …).
 * - CLAUDE.md: Claude Code only (does not read AGENTS.md unless @import / symlink).
 * - GEMINI.md: Gemini CLI default context name (can be reconfigured to AGENTS.md).
 *
 * Global (no universal path — each tool has its own):
 * - Codex:  $CODEX_HOME/AGENTS.md (default ~/.codex/AGENTS.md)
 * - Claude: ~/.claude/CLAUDE.md
 * - Gemini: ~/.gemini/GEMINI.md
 * - Cursor: User Rules live in app settings — not a file this CLI can write.
 *
 * Sources: agents.md; OpenAI Codex AGENTS.md docs; Claude Code memory docs;
 * Gemini CLI GEMINI.md docs; Cursor Rules docs.
 */

/**
 * @typedef {object} HarnessDef
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {boolean} alwaysOffer
 * @property {boolean} globalAlwaysOffer  Offer for global even if missing (create-on-select)
 * @property {boolean} defaultSelected
 * @property {(root: string) => string} projectPath
 * @property {(root: string) => string} globalPath
 * @property {string} [projectDescription]
 * @property {string} [globalDescription]
 */

/** @type {HarnessDef[]} */
const HARNESS_DEFS = [
  {
    id: "agents",
    label: "AGENTS.md",
    description: "Portable project instructions (agents.md standard)",
    alwaysOffer: true,
    globalAlwaysOffer: true,
    defaultSelected: true,
    projectPath(root) {
      return path.join(root, "AGENTS.md");
    },
    /**
     * Codex global AGENTS.md lives under Codex home (root defaults to that dir).
     * @param {string} root
     */
    globalPath(root) {
      return path.join(root, "AGENTS.md");
    },
    projectDescription:
      "Portable — Codex, Cursor, and other AGENTS.md tools (repo root)",
    globalDescription:
      "Codex only — $CODEX_HOME/AGENTS.md (default ~/.codex). Not Cursor/Claude/Gemini global.",
  },
  {
    id: "claude",
    label: "CLAUDE.md",
    description: "Claude Code memory file",
    alwaysOffer: false,
    globalAlwaysOffer: true,
    defaultSelected: true,
    projectPath(root) {
      return path.join(root, "CLAUDE.md");
    },
    globalPath() {
      return path.join(os.homedir(), ".claude", "CLAUDE.md");
    },
    projectDescription:
      "Claude Code — real file only (not a symlink to AGENTS.md). Claude does not read AGENTS.md natively.",
    globalDescription: "Claude Code user memory — ~/.claude/CLAUDE.md",
  },
  {
    id: "gemini",
    label: "GEMINI.md",
    description: "Gemini CLI context file",
    alwaysOffer: false,
    globalAlwaysOffer: true,
    defaultSelected: true,
    projectPath(root) {
      return path.join(root, "GEMINI.md");
    },
    globalPath() {
      return path.join(os.homedir(), ".gemini", "GEMINI.md");
    },
    projectDescription:
      "Gemini CLI default context name (settings can add AGENTS.md instead)",
    globalDescription: "Gemini CLI user context — ~/.gemini/GEMINI.md",
  },
];

/**
 * Codex home directory for global AGENTS.md parent.
 * Respects CODEX_HOME when set (official Codex config).
 */
function defaultGlobalRoot() {
  if (process.env.CODEX_HOME && String(process.env.CODEX_HOME).trim()) {
    return path.resolve(String(process.env.CODEX_HOME).trim());
  }
  return path.join(os.homedir(), ".codex");
}

/**
 * Human-readable notes that never become inject targets (UI / settings only).
 * @param {"project" | "global"} scope
 * @returns {string[]}
 */
function harnessLimitations(scope) {
  if (scope === "global") {
    return [
      "Cursor global rules are Customize → Rules (app settings), not a file this CLI can write.",
      "Project AGENTS.md is still what Cursor (and the agents.md standard) load per repo.",
      "There is no shared ~/.agents/AGENTS.md that all tools auto-load.",
    ];
  }
  return [
    "Cursor User Rules (global) are app settings — for machine-wide Cursor prefs use Customize → Rules.",
    "Claude Code reads CLAUDE.md only; use agents-md symlink or @AGENTS.md import to share one source.",
  ];
}

/**
 * @param {string} filePath
 * @param {string | null} agentsPath
 * @param {{ existsSync?: Function, lstatSync?: Function, readlinkSync?: Function }} [fsLike]
 * @returns {{ status: "missing" | "standalone" | "symlink-to-agents" | "symlink-other", target?: string | null }}
 */
function inspectInstructionFile(filePath, agentsPath, fsLike = fs) {
  if (!fsLike.existsSync(filePath)) {
    return { status: "missing" };
  }
  let st;
  try {
    st = fsLike.lstatSync(filePath);
  } catch {
    return { status: "missing" };
  }
  if (!st.isSymbolicLink()) {
    return { status: "standalone" };
  }
  let target = null;
  try {
    target = fsLike.readlinkSync(filePath);
  } catch {
    return { status: "symlink-other", target: null };
  }
  const resolved = path.resolve(path.dirname(filePath), target);
  if (agentsPath && path.resolve(agentsPath) === resolved) {
    return { status: "symlink-to-agents", target };
  }
  return { status: "symlink-other", target };
}

/**
 * Whether a missing file should still be offered (create-on-select).
 * @param {HarnessDef} def
 * @param {"project" | "global"} scope
 */
function offerWhenMissing(def, scope) {
  if (def.alwaysOffer) return true;
  if (scope === "global" && def.globalAlwaysOffer) return true;
  return false;
}

/**
 * Discover which harness instruction files to offer for inject.
 *
 * - AGENTS.md is always offered (create if missing). Project = portable standard;
 *   global = Codex $CODEX_HOME/AGENTS.md only.
 * - CLAUDE.md / GEMINI.md: project — only when a real file exists (not symlink→AGENTS.md).
 *   global — always offered at their native user paths (create if missing).
 * - Default selection: agents always; vendor files only when they already exist
 *   (global create is opt-in so we do not invent ~/.claude or ~/.gemini by surprise).
 * - Symlink → AGENTS.md is covered by selecting agents; returned as a note.
 * - Cursor global is never a target; see limitations.
 *
 * @param {"project" | "global"} scope
 * @param {string} root  project root, or global working root (default ~/.codex)
 * @param {{ existsSync?: Function, lstatSync?: Function, readlinkSync?: Function }} [fsLike]
 * @returns {{
 *   targets: {
 *     id: string,
 *     label: string,
 *     description: string,
 *     path: string,
 *     exists: boolean,
 *     status: string,
 *     defaultSelected: boolean,
 *   }[],
 *   notes: string[],
 *   limitations: string[],
 * }}
 */
function discoverHarnessTargets(scope, root, fsLike = fs) {
  const agentsDef = HARNESS_DEFS.find((h) => h.id === "agents");
  const agentsPath =
    scope === "global"
      ? agentsDef.globalPath(root)
      : agentsDef.projectPath(root);

  /** @type {ReturnType<typeof discoverHarnessTargets>["targets"]} */
  const targets = [];
  /** @type {string[]} */
  const notes = [];
  const limitations = harnessLimitations(scope);

  for (const def of HARNESS_DEFS) {
    const filePath =
      scope === "global" ? def.globalPath(root) : def.projectPath(root);
    const info = inspectInstructionFile(filePath, agentsPath, fsLike);
    const exists = info.status !== "missing";
    const baseDesc =
      scope === "global"
        ? def.globalDescription || def.description
        : def.projectDescription || def.description;
    // Agents always defaults on; vendor files only when already present.
    const defaultSelected =
      Boolean(def.defaultSelected) && (def.id === "agents" || exists);

    if (def.id === "agents") {
      targets.push({
        id: def.id,
        label: scope === "global" ? "Codex AGENTS.md" : def.label,
        description: baseDesc,
        path: filePath,
        exists,
        status: exists ? "standalone" : "missing",
        defaultSelected,
      });
      continue;
    }

    // Vendor-specific files (Claude, Gemini, …)
    if (info.status === "symlink-to-agents") {
      notes.push(
        `${def.label} → AGENTS.md already; selecting AGENTS.md covers this harness.`
      );
      continue;
    }
    if (info.status === "standalone" || info.status === "symlink-other") {
      targets.push({
        id: def.id,
        label: def.label,
        description:
          info.status === "symlink-other"
            ? `${baseDesc} (symlink → ${info.target || "?"}, not AGENTS.md)`
            : baseDesc,
        path: filePath,
        exists: true,
        status: info.status,
        defaultSelected,
      });
      continue;
    }
    // missing
    if (offerWhenMissing(def, scope)) {
      targets.push({
        id: def.id,
        label: def.label,
        description: `${baseDesc} (will create)`,
        path: filePath,
        exists: false,
        status: "missing",
        defaultSelected: false,
      });
    }
  }

  return { targets, notes, limitations };
}

/**
 * Resolve harness ids from flags against discovered targets.
 * Unknown ids that refer to known defs but were not offered become explicit errors.
 *
 * @param {ReturnType<typeof discoverHarnessTargets>["targets"]} offered
 * @param {string[]} requestedIds
 */
function resolveHarnessSelection(offered, requestedIds) {
  const byId = new Map(offered.map((t) => [t.id, t]));
  const known = new Set(HARNESS_DEFS.map((h) => h.id));
  const selected = [];
  const unknown = [];
  const notOffered = [];
  for (const id of requestedIds) {
    const key = String(id).trim().toLowerCase();
    if (!key) continue;
    if (byId.has(key)) {
      selected.push(byId.get(key));
      continue;
    }
    if (known.has(key)) {
      notOffered.push(key);
      continue;
    }
    unknown.push(key);
  }
  const seen = new Set();
  const unique = [];
  for (const t of selected) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    unique.push(t);
  }
  return { selected: unique, unknown, notOffered };
}

/**
 * Default non-interactive selection: defaultSelected targets that were offered
 * (agents + any existing standalone vendor files; global also offers createable Claude/Gemini).
 */
function defaultHarnessSelection(offered) {
  return offered.filter((t) => t.defaultSelected);
}

/**
 * Stable id list for help text / errors.
 */
function knownHarnessIds() {
  return HARNESS_DEFS.map((h) => h.id);
}

module.exports = {
  HARNESS_DEFS,
  defaultGlobalRoot,
  harnessLimitations,
  inspectInstructionFile,
  discoverHarnessTargets,
  resolveHarnessSelection,
  defaultHarnessSelection,
  knownHarnessIds,
  offerWhenMissing,
};
