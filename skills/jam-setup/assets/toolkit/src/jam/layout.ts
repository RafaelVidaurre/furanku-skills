// Where the toolkit keeps its own files inside a project. Content roots (scratch, delivered) are
// configuration, never constants here.
export const CONFIG_FILE = "jam.config.json"
export const LOCAL_FILE = "jam.local.json"
export const RUN_FILE = "run.json"
export const RECIPES_DIR = "jam/recipes"
export const ENGINES_DIR = "jam/engines"
export const PROVIDERS_DIR = "jam/providers"
/** Machine-local state (hash cache, ledger lock), kept under the scratch root, which Git ignores. */
export const LOCAL_STATE_DIR = ".jam"
/** A reference to a recipe the toolkit ships, as opposed to the project's own of the same id. */
export const BUILTIN_PREFIX = "builtin:"
