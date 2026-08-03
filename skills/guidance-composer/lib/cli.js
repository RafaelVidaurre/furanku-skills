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
  hasAgentInstructionFile,
} = require("./merge");

const style = require(path.join(__dirname, "../../../lib/style"));
const {
  confirm: rootConfirm,
  selectWithCursor,
  hierarchicalMultiSelect,
  collectLeafIds,
} = require(path.join(__dirname, "../../../lib/prompt"));

function loadAgentsMdHelper() {
  try {
    return require(path.join(__dirname, "../../../lib/agents-md"));
  } catch {
    return null;
  }
}

function print(text) {
  process.stdout.write(String(text).endsWith("\n") ? text : `${text}\n`);
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
  return `${entry.id} — ${entry.title} [${catLabel}] — ${entry.picker}`;
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
    print(`\n## ${cat.title} (${cat.id})`);
    print(cat.description);
    if (list.length === 0) {
      print("  (no entries)");
      continue;
    }
    for (const e of list) {
      print(`  ${formatEntryLine(e, cats)}`);
    }
  }
  // entries in unknown categories (should not happen)
  for (const [cid, list] of byCat) {
    if (cats.has(cid)) continue;
    print(`\n## (unknown category: ${cid})`);
    for (const e of list) print(`  ${formatEntryLine(e, cats)}`);
  }
}

function cmdCategories(catalog, flags) {
  if (flags.json) {
    print(JSON.stringify(catalog.categories, null, 2));
    return;
  }
  for (const c of catalog.categories) {
    const count = catalog.entries.filter((e) => e.category === c.id).length;
    print(`${c.id} — ${c.title} (${count}) — ${c.description}`);
  }
}

function cmdShow(catalog, id, flags) {
  const entry = entryMap(catalog).get(id);
  if (!entry) die(`unknown id: ${id}`);
  if (flags.json) {
    print(JSON.stringify(entry, null, 2));
    return;
  }
  print(`id: ${entry.id}`);
  print(`title: ${entry.title}`);
  print(`category: ${entry.category}`);
  print(`picker: ${entry.picker}`);
  print(`tags: ${(entry.tags || []).join(", ") || "(none)"}`);
  print(`conflicts: ${(entry.conflicts || []).join(", ") || "none"}`);
  print("inject:");
  for (const line of entry.inject) print(`  - ${line}`);
}

function cmdSearch(catalog, query, flags) {
  flags.query = query;
  cmdList(catalog, flags);
}

function projectState(root, catalog) {
  const agentsPath = detectAgentInstructionFile(root, fs, path);
  const linkedDefault = path.join(root, "docs", "agent-guidance.md");
  const candidates = [];
  if (fs.existsSync(agentsPath)) candidates.push(agentsPath);
  if (fs.existsSync(linkedDefault)) candidates.push(linkedDefault);

  // Also scan agents file for markdown links that look like guidance files
  if (fs.existsSync(agentsPath)) {
    const text = fs.readFileSync(agentsPath, "utf8");
    const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = linkRe.exec(text))) {
      const rel = m[1];
      if (!rel || rel.startsWith("http")) continue;
      if (!/\.md$/i.test(rel)) continue;
      const abs = path.resolve(path.dirname(agentsPath), rel);
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
  const root = path.resolve(flags.root || process.cwd());
  const { found } = projectState(root, catalog);
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
  print(`root: ${root}`);
  if (found.length === 0) {
    print("No managed guidance region found.");
  } else {
    for (const f of report.managed_files) {
      print(
        `managed: ${f.file} (closed=${f.closed}) ids=[${f.ids.join(", ") || "—"}]`
      );
    }
  }
  print(`present: ${report.present.join(", ") || "—"}`);
  print(`not injected: ${report.not_injected.join(", ") || "—"}`);
  if (unknownBullets.length) {
    print("non-catalog bullets inside managed region:");
    for (const u of unknownBullets) {
      print(`  ${path.relative(root, u.file)}: ${u.bullet}`);
    }
  }
}

function resolveDestination(flags, root) {
  const mode = flags.mode || flags.destination || null;
  if (!mode && flags.path) {
    return { mode: "custom", targetPath: path.resolve(root, flags.path) };
  }
  if (!mode) return null;
  if (mode === "inline") {
    return {
      mode: "inline",
      targetPath: detectAgentInstructionFile(root, fs, path),
      pointer: false,
    };
  }
  if (mode === "linked") {
    const rel = flags.path || "docs/agent-guidance.md";
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

function writeInject(catalog, ids, dest, { root, replace, dryRun }) {
  const lines = injectLines(catalog, ids);
  const existing = fs.existsSync(dest.targetPath)
    ? fs.readFileSync(dest.targetPath, "utf8")
    : "";
  const linkedIntro =
    dest.mode === "linked"
      ? "# Project guidance\n\nEngineering principles selected for this repository. Agents must follow them."
      : null;
  const next = mergeInject({
    existingText: existing,
    injectBulletLines: lines,
    mode: replace ? "replace" : "add",
    linkedIntro,
  });

  const writes = [{ path: dest.targetPath, content: next }];
  if (dest.pointer && dest.relativeLink) {
    const agentsPath = detectAgentInstructionFile(root, fs, path);
    const agentsText = fs.existsSync(agentsPath)
      ? fs.readFileSync(agentsPath, "utf8")
      : "";
    writes.push({
      path: agentsPath,
      content: ensureAgentsPointer(agentsText, dest.relativeLink),
    });
  }

  if (dryRun) {
    for (const w of writes) {
      print(`--- dry-run would write ${path.relative(root, w.path) || w.path} ---`);
      print(w.content);
    }
    return writes;
  }

  for (const w of writes) {
    fs.mkdirSync(path.dirname(w.path), { recursive: true });
    fs.writeFileSync(w.path, w.content, "utf8");
    print(`wrote ${path.relative(root, w.path) || w.path}`);
  }
  return writes;
}

function parseIdList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[, \n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Ensure AGENTS.md (and ideally CLAUDE.md symlink) exist before inject writes.
 * Offers furanku-skills agents-md setup when missing.
 * @returns {Promise<boolean>} false if user declined and we should abort
 */
async function ensureAgentInstructions(root, flags, rl) {
  if (hasAgentInstructionFile(root, fs, path)) return true;

  print("No AGENTS.md or CLAUDE.md found in this project.");
  print("Guidance is written into agent instruction files.");
  print("Recommended: create AGENTS.md and link CLAUDE.md → AGENTS.md.\n");

  const helper = loadAgentsMdHelper();
  const canCreate = Boolean(helper && helper.createAgentsMd);
  const wantCreate = Boolean(flags["create-agents-md"]);

  // Non-interactive: --create-agents-md and/or --yes auto-create when possible.
  if (!process.stdin.isTTY || !rl) {
    if ((wantCreate || flags.yes || flags.y) && canCreate) {
      print("Creating AGENTS.md + CLAUDE.md symlink…");
      const result = helper.createAgentsMd({
        root,
        dryRun: Boolean(flags["dry-run"]),
      });
      for (const m of result.messages) print(`  ${m}`);
      return true;
    }
    if (wantCreate && !canCreate) {
      die(
        "cannot create agents files from this entrypoint; run: furanku-skills agents-md --yes"
      );
    }
    die(
      "No AGENTS.md/CLAUDE.md. Create them first:\n" +
        "  furanku-skills agents-md --yes\n" +
        "or re-run inject with --create-agents-md --yes"
    );
  }

  if (!canCreate) {
    const go = (
      await question(
        rl,
        "Continue anyway (inject may create AGENTS.md without CLAUDE.md link)? [y/N]: "
      )
    )
      .trim()
      .toLowerCase();
    return go === "y" || go === "yes";
  }

  const go = (
    await question(
      rl,
      "Create AGENTS.md + CLAUDE.md → AGENTS.md now? [Y/n]: "
    )
  )
    .trim()
    .toLowerCase();
  if (go === "n" || go === "no") {
    print("Aborted. Run: furanku-skills agents-md");
    return false;
  }
  const result = helper.createAgentsMd({
    root,
    dryRun: Boolean(flags["dry-run"]),
  });
  for (const m of result.messages) print(`  ${m}`);
  print("");
  return true;
}

async function cmdInject(catalog, flags, positionals) {
  const root = path.resolve(flags.root || process.cwd());
  const rawIds = flags.ids || flags.id || positionals.join(",");
  if (!rawIds) {
    return interactiveInject(catalog, flags);
  }
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

  const dest = resolveDestination(flags, root);
  if (!dest) {
    die("non-interactive inject requires --mode inline|linked|custom (and --path for custom)");
  }
  if (!flags.yes && !flags.y && process.stdin.isTTY) {
    die("refusing to write without --yes in interactive terminal; re-run with --yes or use interactive mode");
  }

  // For inline/linked (or custom with pointer), ensure instruction files exist.
  const needsAgents =
    dest.mode === "inline" || dest.mode === "linked" || dest.pointer;
  if (needsAgents) {
    const ok = await ensureAgentInstructions(root, flags, null);
    if (!ok) return;
  }

  writeInject(catalog, ids, dest, {
    root,
    replace: Boolean(flags.replace),
    dryRun: Boolean(flags["dry-run"]),
  });
  print(`injected: ${ids.join(", ")}`);
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

async function interactiveInject(catalog, flags) {
  if (!process.stdin.isTTY) {
    die("interactive mode requires a TTY; pass --ids and --mode for non-interactive inject");
  }
  const root = path.resolve(flags.root || process.cwd());

  print(style.bold("Guidance composer — interactive inject"));
  print(
    style.dim(
      "  Browse categories, mark snippets (Enter/Space), All selects everything under a level.\n"
    )
  );

  // Pre-flight agents files with readline, then release stdin for the cursor UI
  {
    const rl = createRl();
    try {
      const ready = await ensureAgentInstructions(root, flags, rl);
      if (!ready) return;
    } finally {
      rl.close();
    }
  }

  const tree = catalogBrowseTree(catalog);
  const picked = await hierarchicalMultiSelect(tree, {
    title: "Guidance catalog",
    description: "Open a category, or use All to mark every snippet under this level",
  });

  if (picked == null) {
    print(style.warn("Cancelled."));
    return;
  }
  if (picked.length === 0) {
    print(style.dim("Nothing selected; exiting without write."));
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
        footer: style.dim("  ↑/↓  ·  Enter select"),
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
      print(style.dim("Nothing left selected; exiting without write."));
      return;
    }
  }

  const destIdx = await selectWithCursor(
    [
      "inline  — Project guidance section in AGENTS.md",
      "linked  — Separate file + AGENTS.md pointer",
      "custom  — Path you name",
      "Cancel",
    ],
    {
      prompt: "Where should guidance be written?",
      footer: style.dim("  ↑/↓  ·  Enter select"),
    }
  );

  let dest;
  if (destIdx === 0) {
    dest = resolveDestination({ mode: "inline" }, root);
  } else if (destIdx === 1) {
    const rl = createRl();
    try {
      const p = (
        await question(rl, "Linked path [docs/agent-guidance.md]: ")
      ).trim();
      dest = resolveDestination(
        { mode: "linked", path: p || "docs/agent-guidance.md" },
        root
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
        "Add AGENTS.md pointer to this file?",
        false
      );
      dest = resolveDestination(
        { mode: "custom", path: p, pointer: addPointer },
        root
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
  print(
    style.dim(
      `  Into: ${path.relative(root, dest.targetPath) || dest.targetPath}`
    )
  );
  if (dest.pointer) {
    print(style.dim(`  Pointer: AGENTS.md → ${dest.relativeLink}`));
  }

  const writeIdx = await selectWithCursor(
    ["Write guidance now", "Cancel"],
    {
      prompt: "Confirm write",
      footer: style.dim("  ↑/↓  ·  Enter select"),
    }
  );
  if (writeIdx !== 0) {
    print(style.warn("Aborted."));
    return;
  }

  writeInject(catalog, [...selected], dest, {
    root,
    replace: Boolean(flags.replace),
    dryRun: Boolean(flags["dry-run"]),
  });
  print(style.ok("Done."));
}

const PROGRAM = "furanku-skills guidance-composer";

function usage() {
  return `furanku-skills guidance-composer — compose project guidance from a curated catalog

Usage:
  ${PROGRAM}                     Interactive inject wizard
  ${PROGRAM} list [options]      List catalog (grouped by category)
  ${PROGRAM} categories          List categories
  ${PROGRAM} show <id>           Show one entry
  ${PROGRAM} search <query>      Search id/title/picker/tags/inject
  ${PROGRAM} diff [--root DIR]   Compare project managed region vs catalog
  ${PROGRAM} inject [options]    Inject entries (interactive if no --ids)

list options:
  --category <id>   Filter by category
  --tag <tag>       Filter by tag
  --query <text>    Substring filter
  --json            Machine-readable output

inject options:
  --ids <id,id>     Entry ids (or titles)
  --mode <mode>     inline | linked | custom
  --path <path>     Target path (linked default docs/agent-guidance.md; required for custom)
  --root <dir>      Project root (default: cwd)
  --replace         Replace managed region interior instead of union-add
  --force           Allow known conflicting ids
  --yes, -y         Required for non-interactive write on a TTY
  --dry-run         Print writes without saving
  --no-pointer      Linked mode: do not update AGENTS.md
  --pointer         Custom mode: also write AGENTS.md pointer
  --create-agents-md  If no AGENTS.md/CLAUDE.md, create AGENTS.md + CLAUDE.md symlink

Global:
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
};
