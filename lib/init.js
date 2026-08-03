"use strict";

const path = require("path");

const style = require("./style");
const {
  createAgentsMd,
  findAgentInstructionFile,
  inspectAgentsSetup,
} = require("./agents-md");
const {
  SKILLS_SOURCE,
  listCollectionSkills,
  installSkills,
} = require("./skills-install");
const { createRl, confirm } = require("./prompt");

function print(text) {
  process.stdout.write(String(text).endsWith("\n") ? text : `${text}\n`);
}

function die(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseInitFlags(tokens) {
  const flags = {
    root: process.cwd(),
    yes: false,
    dryRun: false,
    force: false,
    agentsMd: null, // null = ask / default, true/false = explicit
    skills: null, // null | "all" | string[] | false
    skillsGlobal: false,
    guidance: null, // null | false | string[] (ids)
    guidanceMode: null,
    guidancePath: null,
    noBanner: false,
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--") continue;
    if (t === "-y" || t === "--yes") {
      flags.yes = true;
      continue;
    }
    if (t === "-h" || t === "--help" || t === "help") {
      flags.help = true;
      continue;
    }
    if (t === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (t === "--force") {
      flags.force = true;
      continue;
    }
    if (t === "--no-banner") {
      flags.noBanner = true;
      continue;
    }
    if (t === "--agents-md") {
      flags.agentsMd = true;
      continue;
    }
    if (t === "--no-agents-md") {
      flags.agentsMd = false;
      continue;
    }
    if (t === "--no-skills") {
      flags.skills = false;
      continue;
    }
    if (t === "--skills-global" || t === "--global") {
      flags.skillsGlobal = true;
      continue;
    }
    if (t === "--no-guidance") {
      flags.guidance = false;
      continue;
    }
    if (t === "--root") {
      const next = tokens[++i];
      if (!next) die("--root requires a directory");
      flags.root = path.resolve(next);
      continue;
    }
    if (t.startsWith("--root=")) {
      flags.root = path.resolve(t.slice("--root=".length));
      continue;
    }
    if (t === "--skills") {
      const next = tokens[++i];
      if (!next) die("--skills requires a value (all or comma-separated ids)");
      flags.skills = next === "all" ? "all" : parseList(next);
      continue;
    }
    if (t.startsWith("--skills=")) {
      const v = t.slice("--skills=".length);
      flags.skills = v === "all" ? "all" : parseList(v);
      continue;
    }
    if (t === "--guidance" || t === "--guidance-ids") {
      const next = tokens[++i];
      if (!next) die(`${t} requires comma-separated entry ids`);
      flags.guidance = parseList(next);
      continue;
    }
    if (t.startsWith("--guidance=") || t.startsWith("--guidance-ids=")) {
      const v = t.includes("=") ? t.slice(t.indexOf("=") + 1) : "";
      flags.guidance = parseList(v);
      continue;
    }
    if (t === "--guidance-mode") {
      const next = tokens[++i];
      if (!next) die("--guidance-mode requires inline|linked|custom");
      flags.guidanceMode = next;
      continue;
    }
    if (t.startsWith("--guidance-mode=")) {
      flags.guidanceMode = t.slice("--guidance-mode=".length);
      continue;
    }
    if (t === "--guidance-path") {
      const next = tokens[++i];
      if (!next) die("--guidance-path requires a path");
      flags.guidancePath = next;
      continue;
    }
    if (t.startsWith("--guidance-path=")) {
      flags.guidancePath = t.slice("--guidance-path=".length);
      continue;
    }
    die(`unknown init option: ${t}\n\n${usage()}`);
  }

  return flags;
}

function parseList(raw) {
  return String(raw)
    .split(/[, \n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function usage() {
  return `${style.bold("furanku-skills init")} — set up agent skills and project guidance

${style.dim("Interactive (recommended):")}
  furanku-skills init
  furanku-skills init --root ~/Code/my-app

${style.dim("Non-interactive (agents / CI):")}
  furanku-skills init --yes --agents-md --skills all --no-guidance
  furanku-skills init --yes --no-skills --guidance simplest-current,prefer-libraries --guidance-mode inline
  furanku-skills init --yes --agents-md --skills guidance-composer,testing-best-practices \\
    --guidance simplest-current --guidance-mode linked

${style.dim("Options:")}
  --root <dir>              Project root (default: cwd)
  --yes, -y                 Non-interactive; required when flags drive writes on a TTY
  --agents-md               Create AGENTS.md + CLAUDE.md symlink
  --no-agents-md            Skip agent instruction setup
  --skills all|<id,id>      Install skills from ${SKILLS_SOURCE} (non-interactive)
  --no-skills               Skip skill install
  --skills-global, --global Pass -g to skills (user-level; interactive still uses skills prompts unless set)
  --guidance <id,id>        Inject guidance entry ids via guidance-composer
  --no-guidance             Skip guidance setup
  --guidance-mode <mode>    inline | linked | custom (required with --guidance)
  --guidance-path <path>    Path for linked/custom modes
  --force                   Replace CLAUDE.md if it blocks symlink setup
  --dry-run                 Print actions without writing or installing
  --no-banner               Skip the ASCII header
  --help                    Show this help

${style.dim("Related:")}
  furanku-skills agents-md              Only create AGENTS.md + CLAUDE.md symlink
  furanku-skills guidance-composer      Only compose project guidance
`;
}

function isNonInteractive(flags) {
  return (
    flags.yes ||
    flags.agentsMd !== null ||
    flags.skills !== null ||
    flags.guidance !== null ||
    !process.stdin.isTTY
  );
}

function validateSkillIds(ids) {
  const known = new Set(listCollectionSkills());
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) {
    die(
      `unknown skill id(s): ${unknown.join(", ")}\nKnown: ${[...known].join(", ")}`
    );
  }
}

async function runGuidanceInteractive(root) {
  const { main } = require("../skills/guidance-composer/lib/cli");
  await main([
    process.execPath,
    "furanku-skills",
    "interactive",
    "--root",
    root,
  ]);
}

async function runGuidanceNonInteractive(root, flags) {
  const ids = flags.guidance;
  if (!ids || ids.length === 0) return { skipped: true };

  const mode = flags.guidanceMode || "inline";
  const args = [
    process.execPath,
    "furanku-skills",
    "inject",
    "--ids",
    ids.join(","),
    "--mode",
    mode,
    "--root",
    root,
    "--yes",
  ];
  if (flags.guidancePath) {
    args.push("--path", flags.guidancePath);
  }
  if (flags.dryRun) {
    args.push("--dry-run");
  }
  // Ensure agents file exists for inject destinations that need it
  if (!findAgentInstructionFile(root)) {
    const result = createAgentsMd({ root, dryRun: flags.dryRun, force: flags.force });
    for (const m of result.messages) print(style.info(m));
  }
  const { main } = require("../skills/guidance-composer/lib/cli");
  await main(args);
  return { ids, mode };
}

/**
 * Top-level: furanku-skills agents-md
 */
async function agentsMdCommand(tokens) {
  const flags = {
    root: process.cwd(),
    yes: false,
    dryRun: false,
    force: false,
    noBanner: false,
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "-y" || t === "--yes") flags.yes = true;
    else if (t === "--dry-run") flags.dryRun = true;
    else if (t === "--force") flags.force = true;
    else if (t === "--no-banner") flags.noBanner = true;
    else if (t === "-h" || t === "--help" || t === "help") {
      print(agentsMdUsage());
      return;
    } else if (t === "--root") {
      const next = tokens[++i];
      if (!next) die("--root requires a directory");
      flags.root = path.resolve(next);
    } else if (t.startsWith("--root=")) {
      flags.root = path.resolve(t.slice("--root=".length));
    } else {
      die(`unknown agents-md option: ${t}\n\n${agentsMdUsage()}`);
    }
  }

  if (!flags.noBanner) print(style.banner());

  const status = inspectAgentsSetup(flags.root);
  print(style.sectionTitle("Agent instruction files"));
  print(style.dim(`  root: ${flags.root}`));
  if (status.complete) {
    print(style.ok(`Already set up: ${style.bold("AGENTS.md")} + ${style.bold("CLAUDE.md")} → AGENTS.md`));
    return;
  }

  if (process.stdin.isTTY && !flags.yes && !flags.dryRun) {
    print();
    print("This creates:");
    print(style.bullet(`${style.bold("AGENTS.md")} — empty project instructions for agents`));
    print(style.bullet(`${style.bold("CLAUDE.md")} → AGENTS.md symlink (Claude Code reads this name)`));
    print();
    const rl = createRl();
    try {
      const go = await confirm(rl, "Create them now?", true);
      if (!go) {
        print(style.warn("Skipped."));
        return;
      }
    } finally {
      rl.close();
    }
  } else if (!flags.yes && !flags.dryRun && process.stdin.isTTY === false) {
    die("non-interactive agents-md requires --yes (or --dry-run)");
  }

  const result = createAgentsMd({
    root: flags.root,
    dryRun: flags.dryRun,
    force: flags.force,
  });
  for (const m of result.messages) {
    print(result.dryRun ? style.info(`[dry-run] ${m}`) : style.ok(m));
  }
}

function agentsMdUsage() {
  return `${style.bold("furanku-skills agents-md")} — create AGENTS.md + CLAUDE.md symlink

Usage:
  furanku-skills agents-md
  furanku-skills agents-md --root <dir> --yes
  furanku-skills agents-md --dry-run
  furanku-skills agents-md --force     # replace CLAUDE.md if present

Creates an empty AGENTS.md (if missing) and links CLAUDE.md → AGENTS.md so
both agent ecosystems share one instruction file.
`;
}

async function interactiveInit(flags) {
  if (!flags.noBanner) print(style.banner());

  const root = flags.root;
  print(style.bold("  Project setup wizard"));
  print(style.dim(`  ${root}\n`));

  const summary = [];
  /** @type {import("readline").Interface | null} */
  let rl = createRl();

  try {
    // ── 1 agents-md
    print(style.step(1, 3, "Agent instructions"));
    const status = inspectAgentsSetup(root);
    let doAgents = flags.agentsMd;
    if (status.complete) {
      print(style.ok("AGENTS.md and CLAUDE.md symlink already in place."));
      summary.push("agents-md: already complete");
    } else if (doAgents === false) {
      print(style.dim("Skipped (--no-agents-md)."));
      summary.push("agents-md: skipped");
    } else {
      if (status.hasAgentsMd) {
        print(style.info("AGENTS.md exists; CLAUDE.md symlink may still be needed."));
      } else if (status.existingInstructionFile) {
        print(
          style.info(
            `Found ${path.basename(status.existingInstructionFile)}; will still offer standard AGENTS.md + symlink.`
          )
        );
      } else {
        print(style.warn("No AGENTS.md or CLAUDE.md found."));
      }
      print(style.bullet("AGENTS.md — shared project instructions"));
      print(style.bullet("CLAUDE.md → AGENTS.md — so Claude Code picks them up too"));
      const go =
        doAgents === true
          ? true
          : await confirm(rl, "Create / complete agent instruction files?", true);
      if (go) {
        const result = createAgentsMd({
          root,
          dryRun: flags.dryRun,
          force: flags.force,
        });
        for (const m of result.messages) {
          print(flags.dryRun ? style.info(`[dry-run] ${m}`) : style.ok(m));
        }
        summary.push("agents-md: updated");
      } else {
        print(style.dim("Skipped."));
        summary.push("agents-md: skipped");
      }
    }

    // ── 2 skills — hand off to `npx skills` (it owns the interactive picker)
    print(style.step(2, 3, "Install skills"));
    if (flags.skills === false) {
      print(style.dim("Skipped (--no-skills)."));
      summary.push("skills: skipped");
    } else if (flags.skills != null) {
      // Explicit --skills on the wizard: non-interactive install with those ids
      if (Array.isArray(flags.skills)) validateSkillIds(flags.skills);
      print(style.info(flags.dryRun ? "Would run:" : "Running:"));
      const result = installSkills({
        skills: flags.skills,
        global: flags.skillsGlobal,
        root,
        dryRun: flags.dryRun,
      });
      print(style.dim(`  ${result.command}`));
      if (!result.dryRun) {
        if (result.stdout) print(result.stdout.trimEnd());
        if (result.stderr) process.stderr.write(result.stderr);
        if (!result.ok) {
          print(style.warn(`skills install exited with status ${result.status}`));
          summary.push(`skills: failed (${result.status})`);
        } else {
          print(style.ok("Skills install finished."));
          summary.push(
            `skills: ${flags.skills === "all" ? "all" : flags.skills.join(",")}`
          );
        }
      } else {
        summary.push(
          `skills: dry-run ${flags.skills === "all" ? "all" : flags.skills.join(",")}`
        );
      }
    } else {
      print(
        style.dim(
          `Opens the official skills installer for ${SKILLS_SOURCE}.`
        )
      );
      const want = await confirm(
        rl,
        "Install skills with npx skills (interactive)?",
        true
      );
      if (!want) {
        print(style.dim("Skipped."));
        summary.push("skills: skipped");
      } else {
        // Release stdin so the nested skills CLI can use the TTY
        rl.close();
        rl = null;

        print();
        print(style.info(flags.dryRun ? "Would run:" : "Running:"));
        const result = installSkills({
          interactive: true,
          global: flags.skillsGlobal,
          root,
          dryRun: flags.dryRun,
        });
        print(style.dim(`  ${result.command}`));
        if (result.dryRun) {
          summary.push("skills: dry-run interactive npx skills");
        } else if (!result.ok) {
          print();
          print(style.warn(`skills install exited with status ${result.status}`));
          summary.push(`skills: failed (${result.status})`);
        } else {
          print();
          print(style.ok("Skills install finished."));
          summary.push("skills: interactive npx skills");
        }

        // Recreate readline for the guidance step
        rl = createRl();
      }
    }

    // ── 3 guidance
    print(style.step(3, 3, "Project guidance"));
    if (flags.guidance === false) {
      print(style.dim("Skipped (--no-guidance)."));
      summary.push("guidance: skipped");
    } else if (Array.isArray(flags.guidance)) {
      print(style.info(`Injecting: ${flags.guidance.join(", ")}`));
      await runGuidanceNonInteractive(root, {
        ...flags,
        guidance: flags.guidance,
        guidanceMode: flags.guidanceMode || "inline",
      });
      summary.push(`guidance: ${flags.guidance.join(",")}`);
    } else {
      print(
        style.dim(
          "Pick engineering principles from a catalog and write them into the project."
        )
      );
      const want = await confirm(rl, "Set up project guidance now?", true);
      if (!want) {
        print(style.dim("Skipped."));
        summary.push("guidance: skipped");
      } else {
        if (!findAgentInstructionFile(root)) {
          print(style.warn("Guidance needs AGENTS.md (or CLAUDE.md)."));
          const make = await confirm(
            rl,
            "Create AGENTS.md + CLAUDE.md symlink first?",
            true
          );
          if (make) {
            const result = createAgentsMd({
              root,
              dryRun: flags.dryRun,
              force: flags.force,
            });
            for (const m of result.messages) {
              print(flags.dryRun ? style.info(`[dry-run] ${m}`) : style.ok(m));
            }
          } else {
            print(
              style.warn(
                "Continuing without instruction files; guidance-composer will ask again."
              )
            );
          }
        }
        // Close readline before nested interactive CLI steals stdin
        if (rl) {
          rl.close();
          rl = null;
        }
        if (!flags.dryRun) {
          await runGuidanceInteractive(root);
        } else {
          print(style.info("[dry-run] would open guidance-composer interactive wizard"));
        }
        summary.push("guidance: interactive");
        printSummary(summary);
        return;
      }
    }
  } finally {
    if (rl) {
      try {
        rl.close();
      } catch {
        /* already closed */
      }
    }
  }

  printSummary(summary);
}

function printSummary(summary) {
  print(style.step("✓", null, "Done"));
  if (summary.length === 0) {
    print(style.dim("  Nothing changed."));
  } else {
    for (const line of summary) print(style.bullet(line));
  }
  print();
  print(style.dim("  Next: talk to your agent as usual — skills load when they fit."));
  print(style.dim("  Re-run: furanku-skills init   ·   furanku-skills guidance-composer"));
  print();
}

async function nonInteractiveInit(flags) {
  if (!flags.noBanner && process.stdout.isTTY) print(style.banner());

  const root = flags.root;
  const summary = [];

  // Defaults when --yes alone: agents-md + all skills, skip guidance
  // (guidance needs explicit ids). Partial flags only run what's specified.
  const anyExplicit =
    flags.agentsMd !== null || flags.skills !== null || flags.guidance !== null;

  let agentsMd = flags.agentsMd;
  let skills = flags.skills;
  let guidance = flags.guidance;

  if (flags.yes && !anyExplicit) {
    agentsMd = true;
    skills = "all";
    guidance = false;
  }

  // If guidance requested and agents not explicitly denied, create agents file when missing
  if (
    Array.isArray(guidance) &&
    agentsMd !== false &&
    !findAgentInstructionFile(root)
  ) {
    agentsMd = true;
  }

  print(style.bold("  Non-interactive init"));
  print(style.dim(`  ${root}\n`));

  if (agentsMd) {
    print(style.step(1, 3, "Agent instructions"));
    const result = createAgentsMd({
      root,
      dryRun: flags.dryRun,
      force: flags.force,
    });
    for (const m of result.messages) {
      print(flags.dryRun ? style.info(`[dry-run] ${m}`) : style.ok(m));
    }
    summary.push("agents-md: done");
  } else {
    print(style.step(1, 3, "Agent instructions"));
    print(style.dim("Skipped."));
    summary.push("agents-md: skipped");
  }

  if (skills && skills !== false) {
    print(style.step(2, 3, "Install skills"));
    if (Array.isArray(skills)) validateSkillIds(skills);
    const result = installSkills({
      skills,
      global: flags.skillsGlobal,
      root,
      dryRun: flags.dryRun,
    });
    print(style.dim(`  ${result.command}`));
    if (!result.dryRun) {
      if (result.stdout) print(result.stdout.trimEnd());
      if (result.stderr) process.stderr.write(result.stderr);
      if (!result.ok) die(`skills install failed with status ${result.status}`);
      print(style.ok("Skills install finished."));
    }
    summary.push(`skills: ${skills === "all" ? "all" : skills.join(",")}`);
  } else {
    print(style.step(2, 3, "Install skills"));
    print(style.dim("Skipped."));
    summary.push("skills: skipped");
  }

  if (Array.isArray(guidance) && guidance.length) {
    print(style.step(3, 3, "Project guidance"));
    if (!flags.guidanceMode && !flags.yes) {
      die("--guidance requires --guidance-mode inline|linked|custom");
    }
    const mode = flags.guidanceMode || "inline";
    print(style.info(`Injecting ${guidance.join(", ")} (${mode})`));
    await runGuidanceNonInteractive(root, {
      ...flags,
      guidance,
      guidanceMode: mode,
    });
    summary.push(`guidance: ${guidance.join(",")}`);
  } else {
    print(style.step(3, 3, "Project guidance"));
    print(style.dim("Skipped."));
    summary.push("guidance: skipped");
  }

  printSummary(summary);
}

/**
 * @param {string[]} tokens argv after `init`
 */
async function initCommand(tokens) {
  const flags = parseInitFlags(tokens);
  if (flags.help) {
    if (!flags.noBanner) print(style.banner());
    print(usage());
    return;
  }

  // Non-interactive path when --yes or explicit skip/include flags without TTY wizard
  if (flags.yes || (!process.stdin.isTTY && isNonInteractive(flags))) {
    if (!flags.yes && !flags.dryRun) {
      die("non-interactive init requires --yes (or run in a TTY for the wizard)");
    }
    await nonInteractiveInit(flags);
    return;
  }

  if (!process.stdin.isTTY) {
    die(
      "init requires a TTY for the interactive wizard.\n" +
        "Use flags + --yes for agents/CI, e.g.:\n" +
        "  furanku-skills init --yes --agents-md --skills all --no-guidance"
    );
  }

  await interactiveInit(flags);
}

module.exports = {
  initCommand,
  agentsMdCommand,
  parseInitFlags,
  usage,
  agentsMdUsage,
};
