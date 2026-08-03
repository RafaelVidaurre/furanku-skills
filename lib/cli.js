"use strict";

const path = require("path");

const style = require("./style");
const { createRl, chooseIndex } = require("./prompt");
const { initCommand, agentsMdCommand } = require("./init");
const PKG = require("../package.json");

const ROOT = path.join(__dirname, "..");

/** @type {Record<string, { description: string, load: () => { main: Function } }>} */
const NAMESPACES = {
  "guidance-composer": {
    description: "Compose project engineering guidance from a curated catalog",
    load: () => require("../skills/guidance-composer/lib/cli"),
  },
};

/** Top-level commands (not skill namespaces). */
const COMMANDS = new Set(["init", "agents-md", "help", "version", "menu"]);

function print(text) {
  process.stdout.write(String(text).endsWith("\n") ? text : `${text}\n`);
}

function die(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function usage({ withBanner = true } = {}) {
  const names = Object.keys(NAMESPACES);
  const nsLines = names
    .map((name) => {
      const desc = NAMESPACES[name].description;
      return `  ${style.cyan(name.padEnd(20))} ${desc}`;
    })
    .join("\n");

  const body = `${style.bold("furanku-skills")} — CLI for the furanku-skills collection

${style.dim("Get started:")}
  ${style.cyan("furanku-skills")}                      Interactive menu (TTY)
  ${style.cyan("furanku-skills init")}                 Full project setup wizard
  ${style.cyan("furanku-skills init --help")}          Non-interactive flags for agents/CI

${style.dim("Commands:")}
  ${style.cyan("init".padEnd(20))} Set up AGENTS.md, install skills, compose guidance
  ${style.cyan("agents-md".padEnd(20))} Create AGENTS.md + CLAUDE.md → AGENTS.md symlink
  ${style.cyan("menu".padEnd(20))} Show the interactive menu
  ${style.cyan("help".padEnd(20))} Show this help
  ${style.cyan("version".padEnd(20))} Print version

${style.dim("Namespaces:")}
${nsLines}

${style.dim("Examples:")}
  furanku-skills
  furanku-skills init
  furanku-skills init --yes --agents-md --skills all --no-guidance
  furanku-skills agents-md --yes
  furanku-skills guidance-composer
  furanku-skills guidance-composer list
  furanku-skills guidance-composer inject --ids simplest-current --mode inline --yes

Run ${style.cyan("furanku-skills <namespace> --help")} for namespace help.
`;

  return withBanner ? `${style.banner()}\n${body}` : body;
}

function isHelpToken(token) {
  return token === "help" || token === "--help" || token === "-h";
}

function isVersionToken(token) {
  return token === "--version" || token === "-V" || token === "version";
}

/**
 * Menu entries shown when the CLI is launched with no command.
 * @returns {{ id: string, label: string, hint: string, run: () => Promise<void> }[]}
 */
function menuEntries(argv) {
  return [
    {
      id: "init",
      label: "Project setup wizard",
      hint: "AGENTS.md, install skills, compose guidance",
      // Banner already shown by the menu
      run: () => initCommand(["--no-banner"]),
    },
    {
      id: "agents-md",
      label: "Create agent instruction files",
      hint: "AGENTS.md + CLAUDE.md → AGENTS.md",
      run: () => agentsMdCommand(["--no-banner"]),
    },
    {
      id: "guidance-composer",
      label: "Compose project guidance",
      hint: "Pick principles from the catalog",
      run: async () => {
        const { main: skillMain } = NAMESPACES["guidance-composer"].load();
        await skillMain([argv[0], argv[1]]);
      },
    },
    {
      id: "help",
      label: "Show help",
      hint: "Commands, flags, and examples",
      run: async () => {
        print(usage({ withBanner: false }));
      },
    },
    {
      id: "exit",
      label: "Exit",
      hint: "",
      run: async () => {
        print(style.dim("Bye."));
      },
    },
  ];
}

/**
 * Interactive main menu when run with no args on a TTY.
 * @param {string[]} argv
 */
async function runMenu(argv = process.argv) {
  print(style.banner());
  print(style.bold("  What would you like to do?"));
  print(style.dim(`  ${process.cwd()}\n`));

  const entries = menuEntries(argv);
  const labels = entries.map((e) => {
    if (!e.hint) return e.label;
    return `${e.label}  ${style.dim(`— ${e.hint}`)}`;
  });

  const rl = createRl();
  let index;
  try {
    index = await chooseIndex(rl, "Choose", labels, 0);
  } finally {
    rl.close();
  }

  const chosen = entries[index];
  if (!chosen) return;

  print();
  print(style.info(`${chosen.label}`));
  print();
  await chosen.run();
}

/**
 * Dispatch a known command / namespace from argv tokens (after node + script).
 * @param {string[]} tokens
 * @param {string[]} argv
 */
async function dispatch(tokens, argv = process.argv) {
  if (tokens.length === 0) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await runMenu(argv);
      return;
    }
    // Non-interactive: print help so agents/scripts still get a usable surface
    print(usage({ withBanner: true }));
    print(
      style.dim(
        "\n(No TTY — showing help. Run in a terminal for the interactive menu, or pass a command.)\n"
      )
    );
    return;
  }

  if (isHelpToken(tokens[0])) {
    print(usage({ withBanner: true }));
    return;
  }

  if (isVersionToken(tokens[0])) {
    print(PKG.version || "0.0.0");
    return;
  }

  const head = tokens[0];

  if (head === "menu") {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      die("menu requires an interactive TTY");
    }
    await runMenu(argv);
    return;
  }

  if (head === "init") {
    await initCommand(tokens.slice(1));
    return;
  }

  if (head === "agents-md") {
    await agentsMdCommand(tokens.slice(1));
    return;
  }

  const entry = NAMESPACES[head];
  if (!entry) {
    die(
      `${style.red("unknown command:")} ${head}\n\n` +
        `Commands: init, agents-md, menu, help, version\n` +
        `Namespaces: ${Object.keys(NAMESPACES).join(", ")}\n\n` +
        usage({ withBanner: false })
    );
  }

  const { main: skillMain } = entry.load();
  // Peel off the namespace so skill parseArgs sees its own command tokens.
  await skillMain([argv[0], argv[1], ...tokens.slice(1)]);
}

/**
 * @param {string[]} [argv=process.argv]
 */
async function main(argv = process.argv) {
  await dispatch(argv.slice(2), argv);
}

module.exports = {
  main,
  usage,
  runMenu,
  menuEntries,
  NAMESPACES,
  COMMANDS,
  ROOT,
};
