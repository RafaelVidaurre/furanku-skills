"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const {
  loadCatalog,
  categoryMap,
  entryMap,
  resolveIds,
  filterEntries,
  conflictPairs,
  injectLines,
  CATALOG_PATH,
} = require("./catalog");
const {
  findManagedRegion,
  bulletsFromInterior,
  matchCatalogIds,
  mergeInject,
  ensureAgentsPointer,
  detectAgentInstructionFile,
} = require("./merge");
const {
  defaultGlobalRoot,
  discoverHarnessTargets,
  resolveHarnessSelection,
  knownHarnessIds,
} = require("./harnesses");

const style = require(path.join(__dirname, "../../../lib/style"));
const {
  confirm: rootConfirm,
  selectWithCursor,
  hierarchicalMultiSelect,
  collectLeafIds,
} = require(path.join(__dirname, "../../../lib/prompt"));

/**
 * Resolve inject scope and filesystem root.
 * - project (default): cwd or --root
 * - global: ~/.codex (Codex user AGENTS.md parent), or --root when overriding
 *
 * Global instruction **files** are harness-native only (see harnesses.js):
 * Codex $CODEX_HOME/AGENTS.md, Claude ~/.claude/CLAUDE.md, Gemini ~/.gemini/GEMINI.md.
 * Cursor User Rules are app settings (not file-writable). No shared ~/.agents store.
 *
 * @param {{ scope?: string, root?: string }} flags
 * @returns {{ scope: "project" | "global", root: string, defaultInstructionName: string }}
 */
function resolveScopeAndRoot(flags = {}) {
  const raw = String(flags.scope || "project").toLowerCase();
  if (raw !== "project" && raw !== "global") {
    die(`unknown --scope: ${flags.scope} (use project|global)`);
  }
  if (raw === "global") {
    return {
      scope: "global",
      root: path.resolve(flags.root || defaultGlobalRoot()),
      defaultInstructionName: "AGENTS.md",
    };
  }
  return {
    scope: "project",
    root: path.resolve(flags.root || process.cwd()),
    defaultInstructionName: "AGENTS.md",
  };
}

function instructionFileFor(root, _scope) {
  return detectAgentInstructionFile(root, fs, path, {
    defaultName: "AGENTS.md",
  });
}

function sectionHeadingFor(scope) {
  return scope === "global" ? "## User guidance" : "## Project guidance";
}

function linkedIntroFor(scope) {
  if (scope === "global") {
    return "# User guidance\n\nEngineering principles selected for this machine. Agents must follow them across projects.";
  }
  return "# Project guidance\n\nEngineering principles selected for this repository. Agents must follow them.";
}

function linkedDefaultPath(scope) {
  return scope === "global" ? "agent-guidance.md" : "docs/agent-guidance.md";
}

function print(text) {
  if (text === undefined || text === null) {
    process.stdout.write("\n");
    return;
  }
  const s = String(text);
  process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
}

function die(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    command: null,
    positionals: [],
    flags: {},
  };
  const tokens = argv.slice(2);
  if (tokens.length === 0) {
    args.command = "interactive";
    return args;
  }
  args.command = tokens[0];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--") continue;
    if (t === "-y") {
      args.flags.yes = true;
      continue;
    }
    if (t === "-h") {
      args.flags.help = true;
      continue;
    }
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      if (eq !== -1) {
        args.flags[t.slice(2, eq)] = t.slice(eq + 1);
        continue;
      }
      const key = t.slice(2);
      const next = tokens[i + 1];
      if (
        next &&
        !next.startsWith("-") &&
        // bare boolean flags never consume the next token
        ![
          "yes",
          "y",
          "json",
          "replace",
          "force",
          "dry-run",
          "no-pointer",
          "pointer",
          "help",
          "create-agents-md",
          "verbose",
        ].includes(key)
      ) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args.positionals.push(t);
    }
  }
  return args;
}

function formatEntryLine(entry, cats) {
  const cat = cats.get(entry.category);
  const catLabel = cat ? cat.id : entry.category;
  return `${style.purple(entry.id)} — ${entry.title} ${style.dim(`[${catLabel}]`)} — ${style.dim(entry.picker)}`;
}

function cmdList(catalog, flags) {
  const entries = filterEntries(catalog, {
    category: flags.category || null,
    tag: flags.tag || null,
    query: flags.query || null,
  });
  if (flags.json) {
    print(JSON.stringify(entries, null, 2));
    return;
  }
  const cats = categoryMap(catalog);
  const byCat = new Map(catalog.categories.map((c) => [c.id, []]));
  for (const e of entries) {
    if (!byCat.has(e.category)) byCat.set(e.category, []);
    byCat.get(e.category).push(e);
  }
  for (const cat of catalog.categories) {
    const list = byCat.get(cat.id) || [];
    if (list.length === 0 && (flags.category || flags.tag || flags.query)) {
      continue;
    }
    print();
    print(style.sectionTitle(`${cat.title} ${style.dim(`(${cat.id})`)}`));
    print(style.dim(`  ${cat.description}`));
    if (list.length === 0) {
      print(style.dim("  (no entries)"));
      continue;
    }
    for (const e of list) {
      print(`  ${formatEntryLine(e, cats)}`);
    }
  }
  // entries in unknown categories (should not happen)
  for (const [cid, list] of byCat) {
    if (cats.has(cid)) continue;
    print();
    print(style.warn(`unknown category: ${cid}`));
    for (const e of list) print(`  ${formatEntryLine(e, cats)}`);
  }
  print();
}

function cmdCategories(catalog, flags) {
  if (flags.json) {
    print(JSON.stringify(catalog.categories, null, 2));
    return;
  }
  for (const c of catalog.categories) {
    const count = catalog.entries.filter((e) => e.category === c.id).length;
    print(
      `${style.purple(c.id)} — ${c.title} ${style.dim(`(${count})`)} — ${style.dim(c.description)}`
    );
  }
}

function cmdShow(catalog, id, flags) {
  const entry = entryMap(catalog).get(id);
  if (!entry) die(`unknown id: ${id}`);
  if (flags.json) {
    print(JSON.stringify(entry, null, 2));
    return;
  }
  print(style.sectionTitle(entry.title));
  print(style.bullet(`${style.dim("id")}       ${style.purple(entry.id)}`));
  print(style.bullet(`${style.dim("category")} ${entry.category}`));
  print(style.bullet(`${style.dim("picker")}   ${entry.picker}`));
  print(
    style.bullet(
      `${style.dim("tags")}     ${(entry.tags || []).join(", ") || "(none)"}`
    )
  );
  print(
    style.bullet(
      `${style.dim("conflicts")} ${(entry.conflicts || []).join(", ") || "none"}`
    )
  );
  print(style.dim("  inject:"));
  for (const line of entry.inject) print(style.bullet(line));
}

function cmdSearch(catalog, query, flags) {
  flags.query = query;
  cmdList(catalog, flags);
}

function projectState(root, catalog, scope = "project") {
  const { targets } = discoverHarnessTargets(scope, root);
  const agentsPath =
    targets.find((t) => t.id === "agents")?.path ||
    instructionFileFor(root, scope);
  const linkedDefault = path.join(root, ...linkedDefaultPath(scope).split("/"));
  const candidates = [];
  for (const t of targets) {
    if (fs.existsSync(t.path) && !candidates.includes(t.path)) {
      candidates.push(t.path);
    }
  }
  if (fs.existsSync(linkedDefault) && !candidates.includes(linkedDefault)) {
    candidates.push(linkedDefault);
  }

  // Scan instruction files for markdown links that look like guidance files
  for (const scanPath of [...candidates]) {
    if (!fs.existsSync(scanPath)) continue;
    const text = fs.readFileSync(scanPath, "utf8");
    const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = linkRe.exec(text))) {
      const rel = m[1];
      if (!rel || rel.startsWith("http")) continue;
      if (!/\.md$/i.test(rel)) continue;
      const abs = path.resolve(path.dirname(scanPath), rel);
      if (fs.existsSync(abs) && !candidates.includes(abs)) candidates.push(abs);
    }
  }

  const found = [];
  for (const file of candidates) {
    const text = fs.readFileSync(file, "utf8");
    const region = findManagedRegion(text);
    if (!region) continue;
    const bullets = bulletsFromInterior(region.interior);
    const ids = matchCatalogIds(bullets, catalog);
    found.push({
      file,
      closed: region.closed,
      ids,
      bullets,
    });
  }
  return { agentsPath, found };
}

function cmdDiff(catalog, flags) {
  const { scope, root } = resolveScopeAndRoot(flags);
  const { found } = projectState(root, catalog, scope);
  const present = new Set();
  for (const f of found) for (const id of f.ids) present.add(id);
  const available = catalog.entries.map((e) => e.id);
  const missing = available.filter((id) => !present.has(id));
  const unknownBullets = [];
  for (const f of found) {
    const known = new Set();
    for (const id of f.ids) {
      const entry = entryMap(catalog).get(id);
      for (const inj of entry.inject) {
        known.add(inj.replace(/^\s*-\s+/, "").trim());
      }
    }
    for (const b of f.bullets) {
      const n = b.replace(/^\s*-\s+/, "").trim();
      if (!known.has(n)) unknownBullets.push({ file: f.file, bullet: b });
    }
  }
  const report = {
    scope,
    root,
    present: [...present].sort(),
    available,
    not_injected: missing,
    managed_files: found.map((f) => ({
      file: path.relative(root, f.file) || f.file,
      closed: f.closed,
      ids: f.ids,
    })),
    non_catalog_bullets_in_managed: unknownBullets,
  };
  if (flags.json) {
    print(JSON.stringify(report, null, 2));
    return;
  }
  print(style.bullet(`${style.dim("scope")}  ${scope}`));
  print(style.bullet(`${style.dim("root")}   ${style.path(root)}`));
  if (found.length === 0) {
    print(style.warn("No managed guidance region found."));
  } else {
    for (const f of report.managed_files) {
      print(
        style.bullet(
          `${style.dim("managed")} ${style.path(f.file)} ${style.dim(`(closed=${f.closed})`)} ids=[${f.ids.join(", ") || "—"}]`
        )
      );
    }
  }
  print(
    style.bullet(
      `${style.dim("present")} ${report.present.join(", ") || "—"}`
    )
  );
  print(
    style.bullet(
      `${style.dim("not injected")} ${report.not_injected.join(", ") || "—"}`
    )
  );
  if (unknownBullets.length) {
    print(style.dim("  non-catalog bullets inside managed region:"));
    for (const u of unknownBullets) {
      print(
        style.bullet(
          `${style.path(path.relative(root, u.file) || u.file)}: ${u.bullet}`
        )
      );
    }
  }
}

function resolveDestination(flags, root, scope = "project") {
  const mode = flags.mode || flags.destination || null;
  if (!mode && flags.path) {
    return { mode: "custom", targetPath: path.resolve(root, flags.path) };
  }
  if (!mode) return null;
  if (mode === "inline") {
    return {
      mode: "inline",
      targetPath: instructionFileFor(root, scope),
      pointer: false,
    };
  }
  if (mode === "linked") {
    const rel = flags.path || linkedDefaultPath(scope);
    return {
      mode: "linked",
      targetPath: path.resolve(root, rel),
      relativeLink: rel.replace(/\\/g, "/"),
      pointer: flags.pointer !== false && flags["no-pointer"] !== true,
    };
  }
  if (mode === "custom") {
    if (!flags.path) die("custom mode requires --path");
    return {
      mode: "custom",
      targetPath: path.resolve(root, flags.path),
      pointer: flags.pointer === true,
      relativeLink: flags.path.replace(/\\/g, "/"),
    };
  }
  die(`unknown --mode: ${mode} (use inline|linked|custom)`);
}

function displayPath(filePath, root) {
  const rel = path.relative(root, filePath);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  return filePath;
}

/**
 * @param {object} catalog
 * @param {string[]} ids
 * @param {object} dest
 * @param {{
 *   root: string,
 *   scope?: string,
 *   replace?: boolean,
 *   dryRun?: boolean,
 *   targetPaths?: string[],
 *   pointerTargets?: string[],
 * }} opts
 * targetPaths: inline mode — write managed region into each path.
 * pointerTargets: linked/custom — instruction files that get a pointer line.
 */
function writeInject(catalog, ids, dest, opts) {
  const {
    root,
    scope = "project",
    replace,
    dryRun,
    targetPaths,
    pointerTargets,
  } = opts;
  const lines = injectLines(catalog, ids);
  const sectionHeading = sectionHeadingFor(scope);
  const linkedIntro = dest.mode === "linked" ? linkedIntroFor(scope) : null;

  /** @type {{ path: string, content: string }[]} */
  const writes = [];

  if (dest.mode === "inline" && targetPaths && targetPaths.length > 0) {
    for (const targetPath of targetPaths) {
      const existing = fs.existsSync(targetPath)
        ? fs.readFileSync(targetPath, "utf8")
        : "";
      writes.push({
        path: targetPath,
        content: mergeInject({
          existingText: existing,
          injectBulletLines: lines,
          mode: replace ? "replace" : "add",
          sectionHeading,
          linkedIntro: null,
        }),
      });
    }
  } else {
    const existing = fs.existsSync(dest.targetPath)
      ? fs.readFileSync(dest.targetPath, "utf8")
      : "";
    writes.push({
      path: dest.targetPath,
      content: mergeInject({
        existingText: existing,
        injectBulletLines: lines,
        mode: replace ? "replace" : "add",
        sectionHeading,
        linkedIntro,
      }),
    });
  }

  if (dest.pointer && dest.relativeLink) {
    const ptrs =
      pointerTargets && pointerTargets.length
        ? pointerTargets
        : [instructionFileFor(root, scope)];
    for (const agentsPath of ptrs) {
      const agentsText = fs.existsSync(agentsPath)
        ? fs.readFileSync(agentsPath, "utf8")
        : "";
      writes.push({
        path: agentsPath,
        content: ensureAgentsPointer(agentsText, dest.relativeLink, {
          sectionHeading,
        }),
      });
    }
  }

  if (dryRun) {
    for (const w of writes) {
      print(style.info(`[dry-run] would write ${style.path(displayPath(w.path, root))}`));
      print(w.content);
    }
    return writes;
  }

  for (const w of writes) {
    fs.mkdirSync(path.dirname(w.path), { recursive: true });
    fs.writeFileSync(w.path, w.content, "utf8");
    print(style.ok(`wrote ${style.path(displayPath(w.path, root))}`));
  }
  return writes;
}

function defaultBodyForInstructionFile(filePath, scope) {
  const base = path.basename(filePath);
  if (scope === "global") {
    return `# ${base}\n\nUser-level instructions for AI coding agents (all projects on this machine).\n`;
  }
  return `# ${base}\n\nProject instructions for AI coding agents.\n`;
}

/**
 * Ensure each selected harness instruction file exists.
 * @param {{ path: string, label: string }[]} targets
 * @param {"project"|"global"} scope
 * @param {object} flags
 * @param {import("readline").Interface | null} rl
 * @returns {Promise<boolean>}
 */
async function ensureHarnessFiles(targets, scope, flags, rl) {
  const missing = targets.filter((t) => !fs.existsSync(t.path));
  if (missing.length === 0) return true;

  print(style.warn("Missing instruction file(s):"));
  for (const t of missing) {
    print(style.bullet(`${t.label}  ${style.path(t.path)}`));
  }
  print();

  const createAll = () => {
    for (const t of missing) {
      if (flags["dry-run"]) {
        print(style.info(`[dry-run] would create ${style.path(t.path)}`));
        continue;
      }
      fs.mkdirSync(path.dirname(t.path), { recursive: true });
      fs.writeFileSync(
        t.path,
        defaultBodyForInstructionFile(t.path, scope),
        "utf8"
      );
      print(style.ok(`created ${style.path(t.path)}`));
    }
    return true;
  };

  if (!process.stdin.isTTY || !rl) {
    if (flags.yes || flags.y || flags["create-agents-md"]) {
      return createAll();
    }
    die(
      "Instruction file(s) missing. Re-run with --yes to create them, or create them yourself."
    );
  }

  const go = await rootConfirm(
    rl,
    `Create ${missing.length === 1 ? "this file" : "these files"} now?`,
    true
  );
  if (!go) {
    print(style.warn("Aborted."));
    return false;
  }
  createAll();
  print();
  return true;
}

/**
 * Interactive multi-select of harness targets.
 * @returns {Promise<ReturnType<typeof discoverHarnessTargets>["targets"] | null>}
 */
function printHarnessContext(notes, limitations, { interactive = false } = {}) {
  for (const n of notes) print(style.info(n));
  // Limitations are educational (Cursor settings, no shared store). Show in
  // interactive wizards; keep non-interactive output quiet unless --verbose.
  if (interactive) {
    for (const n of limitations) print(style.dim(`  Note: ${n}`));
  }
}

async function askHarnessTargets(scope, root) {
  const { targets, notes, limitations } = discoverHarnessTargets(scope, root);
  printHarnessContext(notes, limitations, { interactive: true });

  if (targets.length === 0) {
    die("No harness instruction targets available.");
  }

  // Single option: no need to ask
  if (targets.length === 1) {
    print(
      style.bullet(
        `${style.dim("Harness")} ${targets[0].label}  ${style.path(targets[0].path)}`
      )
    );
    print();
    return targets;
  }

  const tree = targets.map((t) => ({
    id: t.id,
    label: t.label,
    description: `${t.description} · ${t.path}`,
  }));
  const picked = await hierarchicalMultiSelect(tree, {
    title: "Which harnesses should receive this guidance?",
    description:
      scope === "global"
        ? "Each tool has its own user file: Codex ~/.codex, Claude ~/.claude, Gemini ~/.gemini. Cursor User Rules are not a file."
        : "AGENTS.md is portable. CLAUDE.md / GEMINI.md appear only when they are real files (not symlinks to AGENTS.md).",
    initialSelected: targets.filter((t) => t.defaultSelected).map((t) => t.id),
  });
  if (picked == null) return null;
  if (picked.length === 0) {
    print(style.dim("  Nothing selected; exiting without write."));
    return [];
  }
  const { selected, unknown } = resolveHarnessSelection(targets, picked);
  if (unknown.length) die(`unknown harness: ${unknown.join(", ")}`);
  print(
    style.bullet(
      `${style.dim("Harnesses")} ${selected.map((t) => t.label).join(", ")}`
    )
  );
  print();
  return selected;
}

/**
 * Resolve harness targets for non-interactive inject.
 * --harness / --harnesses is **required** so scripts do not depend on which
 * vendor files happen to exist on the machine.
 */
function harnessTargetsFromFlags(scope, root, flags) {
  const { targets, notes, limitations } = discoverHarnessTargets(scope, root);
  printHarnessContext(notes, limitations, {
    interactive: Boolean(flags.verbose),
  });

  const raw = flags.harness || flags.harnesses || null;
  if (!raw) {
    const offered = targets.map((t) => t.id).join(", ") || "(none)";
    die(
      "non-interactive inject requires --harness <ids> " +
        `(e.g. --harness agents). Offered here: ${offered}. ` +
        `Known ids: ${knownHarnessIds().join(", ")}`
    );
  }
  const { selected, unknown, notOffered } = resolveHarnessSelection(
    targets,
    parseIdList(raw)
  );
  if (unknown.length) die(`unknown --harness id(s): ${unknown.join(", ")}`);
  if (notOffered.length) {
    die(
      `harness not available here: ${notOffered.join(", ")} ` +
        `(project: file missing or symlink→AGENTS.md; known ids: ${knownHarnessIds().join(", ")})`
    );
  }
  if (selected.length === 0) die("no harnesses selected");
  return selected;
}

function parseIdList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[, \n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function cmdInject(catalog, flags, positionals) {
  const rawIds = flags.ids || flags.id || positionals.join(",");
  if (!rawIds) {
    return interactiveInject(catalog, flags);
  }
  const { scope, root } = resolveScopeAndRoot(flags);
  const { ids, unknown } = resolveIds(catalog, parseIdList(rawIds));
  if (unknown.length) die(`unknown ids: ${unknown.join(", ")}`);
  if (ids.length === 0) die("no ids to inject");

  const conflicts = conflictPairs(catalog, ids);
  if (conflicts.length && !flags.force) {
    die(
      `conflicting ids: ${conflicts
        .map(([a, b]) => `${a} vs ${b}`)
        .join("; ")} (pass --force to inject anyway)`
    );
  }

  const dest = resolveDestination(flags, root, scope);
  if (!dest) {
    die("non-interactive inject requires --mode inline|linked|custom (and --path for custom)");
  }
  if (!flags.yes && !flags.y && process.stdin.isTTY) {
    die("refusing to write without --yes in interactive terminal; re-run with --yes or use interactive mode");
  }

  const harnesses = harnessTargetsFromFlags(scope, root, flags);
  const harnessPaths = harnesses.map((t) => t.path);

  const needsFiles =
    dest.mode === "inline" || dest.mode === "linked" || dest.pointer;
  if (needsFiles) {
    const ok = await ensureHarnessFiles(harnesses, scope, flags, null);
    if (!ok) return;
  }

  writeInject(catalog, ids, dest, {
    root,
    scope,
    replace: Boolean(flags.replace),
    dryRun: Boolean(flags["dry-run"]),
    targetPaths: dest.mode === "inline" ? harnessPaths : undefined,
    pointerTargets:
      dest.pointer || dest.mode === "linked" ? harnessPaths : undefined,
  });
  print(style.bullet(`${style.dim("scope")}     ${scope}`));
  print(
    style.bullet(
      `${style.dim("harnesses")} ${harnesses.map((t) => t.id).join(", ")}`
    )
  );
  print(style.bullet(`${style.dim("injected")}  ${ids.join(", ")}`));
}

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
 * Build hierarchical tree for the catalog browser:
 * categories (folders) → entries (leaves).
 * @param {ReturnType<typeof loadCatalog>} catalog
 */
function catalogBrowseTree(catalog) {
  return catalog.categories.map((cat) => {
    const entries = catalog.entries.filter((e) => e.category === cat.id);
    return {
      id: cat.id,
      label: cat.title,
      description: cat.description,
      children: entries.map((e) => ({
        id: e.id,
        label: e.title,
        description: e.picker,
      })),
    };
  });
}

/**
 * Ask project vs global before catalog pick. Default is project.
 * Honors flags.scope when already set (non-interactive flag on interactive path).
 * @returns {Promise<"project" | "global" | null>} null = cancelled
 */
async function askInjectScope(flags) {
  if (flags.scope) {
    const raw = String(flags.scope).toLowerCase();
    if (raw !== "project" && raw !== "global") {
      die(`unknown --scope: ${flags.scope} (use project|global)`);
    }
    return raw;
  }

  const projectRoot = path.resolve(flags.root || process.cwd());
  const globalRoot = defaultGlobalRoot();

  const scopeIdx = await selectWithCursor(
    [
      `This project  — ${projectRoot}`,
      `Global        — per-tool user files (Codex ${globalRoot}/AGENTS.md, Claude ~/.claude, Gemini ~/.gemini)`,
      "Cancel",
    ],
    {
      prompt: "Where should this guidance apply?",
      defaultIndex: 0,
      footer: style.keyHints("default: this project"),
    }
  );
  if (scopeIdx === 0) return "project";
  if (scopeIdx === 1) return "global";
  return null;
}

/**
 * Interactive scope pick uses ~/.codex for global even if --root was set for project.
 * Explicit `--scope global --root DIR` still overrides the global root (AGENTS.md parent).
 */
function rootFlagsForScope(flags, scope) {
  const scopeWasExplicit = Boolean(flags.scope);
  if (scope === "global" && !scopeWasExplicit) {
    return { scope };
  }
  return { ...flags, scope };
}

async function interactiveInject(catalog, flags) {
  if (!process.stdin.isTTY) {
    die("interactive mode requires a TTY; pass --ids and --mode for non-interactive inject");
  }

  print(style.sectionTitle("Guidance composer"));
  print(
    style.dim(
      "  Scope → harnesses → catalog. Mark snippets with Enter/Space; All selects a whole level.\n"
    )
  );

  // 1) Scope first (project default)
  print(style.step(1, 4, "Scope"));
  const scope = await askInjectScope(flags);
  if (!scope) {
    print(style.warn("Cancelled."));
    return;
  }
  const { root } = resolveScopeAndRoot(rootFlagsForScope(flags, scope));
  print(
    style.bullet(
      `${style.dim("Scope")} ${scope}  ${style.path(root)}`
    )
  );
  print();

  // 2) Harness targets (AGENTS.md always; CLAUDE.md if standalone real file)
  print(style.step(2, 4, "Harnesses"));
  let harnesses;
  if (flags.harness || flags.harnesses) {
    harnesses = harnessTargetsFromFlags(scope, root, flags);
    print(
      style.bullet(
        `${style.dim("Harnesses")} ${harnesses.map((t) => t.label).join(", ")}`
      )
    );
    print();
  } else {
    harnesses = await askHarnessTargets(scope, root);
    if (harnesses == null) {
      print(style.warn("Cancelled."));
      return;
    }
    if (harnesses.length === 0) return;
  }
  const harnessPaths = harnesses.map((t) => t.path);

  // 3) Ensure selected instruction files exist
  {
    const rl = createRl();
    try {
      const ready = await ensureHarnessFiles(harnesses, scope, flags, rl);
      if (!ready) return;
    } finally {
      rl.close();
    }
  }

  // 4) Catalog pick
  print(style.step(3, 4, "Catalog"));
  const tree = catalogBrowseTree(catalog);
  const picked = await hierarchicalMultiSelect(tree, {
    title: "Guidance catalog",
    description:
      "Open a category, or use All to mark every snippet under this level",
  });

  if (picked == null) {
    print(style.warn("Cancelled."));
    return;
  }
  if (picked.length === 0) {
    print(style.dim("  Nothing selected; exiting without write."));
    return;
  }

  const selected = new Set(picked);

  const conflicts = conflictPairs(catalog, [...selected]);
  if (conflicts.length) {
    print(
      style.warn(
        `Conflicts: ${conflicts.map(([a, b]) => `${a} vs ${b}`).join("; ")}`
      )
    );
    /** @type {{ id: string, label: string }[]} */
    const conflictChoices = [
      { id: "keep", label: "Keep both (inject anyway)" },
    ];
    for (const [a, b] of conflicts) {
      conflictChoices.push({ id: `drop:${a}`, label: `Drop ${a} (keep ${b})` });
      conflictChoices.push({ id: `drop:${b}`, label: `Drop ${b} (keep ${a})` });
    }
    conflictChoices.push({ id: "abort", label: "Abort" });

    const howIdx = await selectWithCursor(
      conflictChoices.map((c) => c.label),
      {
        prompt: "How to resolve conflicts?",
        footer: style.keyHints(),
      }
    );
    const choice = conflictChoices[howIdx];
    if (!choice || choice.id === "abort") {
      print(style.warn("Aborted."));
      return;
    }
    if (choice.id.startsWith("drop:")) {
      selected.delete(choice.id.slice("drop:".length));
    }
    if (selected.size === 0) {
      print(style.dim("  Nothing left selected; exiting without write."));
      return;
    }
  }

  print(style.step(4, 4, "Destination"));
  const harnessSummary = harnesses.map((t) => t.label).join(" + ");
  const destIdx = await selectWithCursor(
    scope === "global"
      ? [
          `inline  — User guidance section in ${harnessSummary}`,
          `linked  — Separate file + pointer in ${harnessSummary}`,
          "custom  — Path you name",
          "Cancel",
        ]
      : [
          `inline  — Project guidance section in ${harnessSummary}`,
          `linked  — Separate file + pointer in ${harnessSummary}`,
          "custom  — Path you name",
          "Cancel",
        ],
    {
      prompt: "Where should guidance be written?",
      footer: style.keyHints(),
    }
  );

  const defaultLinked = linkedDefaultPath(scope);
  let dest;
  if (destIdx === 0) {
    dest = resolveDestination({ mode: "inline" }, root, scope);
    // Prefer first harness path as dest.targetPath for display; writeInject uses targetPaths
    dest.targetPath = harnessPaths[0];
  } else if (destIdx === 1) {
    const rl = createRl();
    try {
      const p = (
        await question(rl, `Linked path [${defaultLinked}]: `)
      ).trim();
      dest = resolveDestination(
        { mode: "linked", path: p || defaultLinked },
        root,
        scope
      );
    } finally {
      rl.close();
    }
  } else if (destIdx === 2) {
    const rl = createRl();
    try {
      const p = (await question(rl, "Path: ")).trim();
      if (!p) {
        print(style.warn("Aborted (no path)."));
        return;
      }
      const addPointer = await rootConfirm(
        rl,
        `Add pointer in ${harnessSummary}?`,
        false
      );
      dest = resolveDestination(
        { mode: "custom", path: p, pointer: addPointer },
        root,
        scope
      );
      if (dest.pointer) dest.relativeLink = p.replace(/\\/g, "/");
    } finally {
      rl.close();
    }
  } else {
    print(style.warn("Cancelled."));
    return;
  }

  print();
  print(style.info(`Will inject: ${[...selected].join(", ")}`));
  print(style.bullet(`${style.dim("Scope")}     ${scope}`));
  print(
    style.bullet(
      `${style.dim("Harnesses")} ${harnesses.map((t) => t.id).join(", ")}`
    )
  );
  if (dest.mode === "inline") {
    for (const p of harnessPaths) {
      print(style.bullet(`${style.dim("Into")}     ${style.path(displayPath(p, root))}`));
    }
  } else {
    print(
      style.bullet(
        `${style.dim("Into")}     ${style.path(displayPath(dest.targetPath, root))}`
      )
    );
  }
  if (dest.pointer) {
    for (const p of harnessPaths) {
      print(
        style.bullet(
          `${style.dim("Pointer")}  ${path.basename(p)} → ${dest.relativeLink}`
        )
      );
    }
  }
  print();

  const writeIdx = await selectWithCursor(["Write guidance now", "Cancel"], {
    prompt: "Confirm write",
    footer: style.keyHints(),
  });
  if (writeIdx !== 0) {
    print(style.warn("Aborted."));
    return;
  }

  writeInject(catalog, [...selected], dest, {
    root,
    scope,
    replace: Boolean(flags.replace),
    dryRun: Boolean(flags["dry-run"]),
    targetPaths: dest.mode === "inline" ? harnessPaths : undefined,
    pointerTargets:
      dest.pointer || dest.mode === "linked" ? harnessPaths : undefined,
  });
  print(style.ok("Done."));
}

const PROGRAM = "furanku-skills guidance-composer";

function usage() {
  return `${style.bold("furanku-skills guidance-composer")} — compose project or machine-wide guidance from a curated catalog

${style.dim("Usage:")}
  ${PROGRAM}                     Interactive inject wizard (asks scope first)
  ${PROGRAM} list [options]      List catalog (grouped by category)
  ${PROGRAM} categories          List categories
  ${PROGRAM} show <id>           Show one entry
  ${PROGRAM} search <query>      Search id/title/picker/tags/inject
  ${PROGRAM} diff [options]      Compare managed region vs catalog
  ${PROGRAM} inject [options]    Inject entries (interactive if no --ids)

${style.dim("list options:")}
  --category <id>   Filter by category
  --tag <tag>       Filter by tag
  --query <text>    Substring filter
  --json            Machine-readable output

${style.dim("inject / diff options:")}
  --scope <scope>   project (default) | global
                    project → cwd or --root (AGENTS.md standard + vendor files)
                    global  → each tool’s own user file (no shared ~/.agents path):
                              agents → $CODEX_HOME/AGENTS.md (default ~/.codex)
                              claude → ~/.claude/CLAUDE.md
                              gemini → ~/.gemini/GEMINI.md
                              Cursor User Rules = app settings (not injectable)
  --ids <id,id>     Entry ids (or titles) — inject only
  --mode <mode>     inline | linked | custom — inject only
  --path <path>     Target path (linked default: docs/agent-guidance.md project,
                    agent-guidance.md under Codex home for global; required for custom)
  --root <dir>      Override root (project: cwd; global: Codex home for AGENTS.md / linked)
  --replace         Replace managed region interior instead of union-add
  --force           Allow known conflicting ids
  --yes, -y         Required for non-interactive write on a TTY
  --dry-run         Print writes without saving
  --no-pointer      Linked mode: do not update the instruction file pointer
  --pointer         Custom mode: also write instruction-file pointer
  --harness <ids>   Required for non-interactive inject: agents, claude, gemini.
                    Project: claude/gemini only if a real file exists (not symlink→AGENTS).
                    Global: all three offered (create missing when selected).
  --create-agents-md  Create missing selected instruction files (same as --yes for create)
  --verbose         Print harness path notes (Cursor limitations, etc.)

${style.dim("Global:")}
  --help            Show this help
`;
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.flags.help || args.command === "help" || args.command === "-h") {
    print(usage());
    return;
  }

  const catalog = loadCatalog(
    args.flags.catalog ? path.resolve(args.flags.catalog) : CATALOG_PATH
  );

  switch (args.command) {
    case "interactive":
    case "i":
      await interactiveInject(catalog, args.flags);
      break;
    case "list":
    case "ls":
      cmdList(catalog, args.flags);
      break;
    case "categories":
    case "cats":
      cmdCategories(catalog, args.flags);
      break;
    case "show":
      if (!args.positionals[0]) die("show requires an id");
      cmdShow(catalog, args.positionals[0], args.flags);
      break;
    case "search":
      if (!args.positionals[0]) die("search requires a query");
      cmdSearch(catalog, args.positionals.join(" "), args.flags);
      break;
    case "diff":
      cmdDiff(catalog, args.flags);
      break;
    case "inject":
    case "add":
      await cmdInject(catalog, args.flags, args.positionals);
      break;
    default:
      die(`unknown command: ${args.command}\n\n${usage()}`);
  }
}

module.exports = {
  main,
  parseArgs,
  catalogBrowseTree,
  collectLeafIds,
  resolveScopeAndRoot,
  defaultGlobalRoot,
  sectionHeadingFor,
  linkedDefaultPath,
  discoverHarnessTargets,
  harnessTargetsFromFlags,
};
