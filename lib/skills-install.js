"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SKILLS_SOURCE = "rafaelvidaurre/furanku-skills";

/**
 * Discover skill ids shipped in this collection (dirs with SKILL.md).
 * @param {string} [skillsDir]
 */
function listCollectionSkills(skillsDir = path.join(ROOT, "skills")) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, "SKILL.md"))
    )
    .map((d) => d.name)
    .sort();
}

/**
 * Build argv for: npx skills@latest add <source> ...
 *
 * Interactive (default for the wizard): bare `add <source>` so the skills CLI
 * runs its own picker/prompts. Non-interactive: pass -y and --skill.
 *
 * @param {{
 *   skills?: string[] | "all",
 *   global?: boolean,
 *   agentAll?: boolean,
 *   interactive?: boolean,
 * }} opts
 */
function buildInstallArgs(opts = {}) {
  // npx --yes: auto-install the skills package itself without a prompt
  const args = ["--yes", "skills@latest", "add", SKILLS_SOURCE];

  if (opts.interactive) {
    // Let `skills add` own scope / skill / agent prompts.
    if (opts.global) args.push("-g");
    return args;
  }

  // Non-interactive / CI
  args.push("-y");

  if (opts.global) args.push("-g");

  if (opts.agentAll) {
    args.push("-a", "*");
  }

  if (opts.skills === "all" || !opts.skills || opts.skills.length === 0) {
    args.push("--skill", "*");
  } else {
    args.push("--skill", ...opts.skills);
  }

  return args;
}

/**
 * @param {{
 *   skills?: string[] | "all",
 *   global?: boolean,
 *   agentAll?: boolean,
 *   interactive?: boolean,
 *   root?: string,
 *   dryRun?: boolean,
 *   spawn?: typeof spawnSync,
 * }} opts
 */
function installSkills(opts = {}) {
  const root = path.resolve(opts.root || process.cwd());
  const dryRun = Boolean(opts.dryRun);
  const interactive = Boolean(opts.interactive);
  const spawn = opts.spawn || spawnSync;
  const npxArgs = buildInstallArgs({
    skills: opts.skills,
    global: opts.global,
    agentAll: interactive ? false : opts.agentAll !== false,
    interactive,
  });
  const command = ["npx", ...npxArgs].join(" ");

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      interactive,
      command,
      cwd: root,
      status: 0,
      stdout: "",
      stderr: "",
    };
  }

  const result = spawn("npx", npxArgs, {
    cwd: root,
    encoding: "utf8",
    // Interactive: full TTY so skills can run its own picker.
    // Non-interactive: capture output for logging.
    stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  return {
    ok: result.status === 0,
    dryRun: false,
    interactive,
    command,
    cwd: root,
    status: result.status == null ? 1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
  };
}

module.exports = {
  SKILLS_SOURCE,
  listCollectionSkills,
  buildInstallArgs,
  installSkills,
};
