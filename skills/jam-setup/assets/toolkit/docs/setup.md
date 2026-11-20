# Setup reference

Depth for the `jam-setup` skill: reading the installer's summary, this machine's tools, handing a sign-in to the person, and what an upgrade changes. `jam doctor` is the one command that says what is missing; each of its lines has a status and a fix.

## Installer summary

The installer prints one JSON object and exits 2 when the toolkit's npm packages failed to install.

| Field | Read it as |
| --- | --- |
| `installed` | `installed`, `upgraded` or `reinstalled (unchanged)` |
| `dependencies.jam` | `installed`, or `failed: <reason>`: fix the reason and run the installer again |
| `dependencies.imaging` | `available`, `installed in private venv`, or `missing: <reason>`. Needed only for cropping turnarounds |
| `configuration` | `missing` (run `jam setup`), `version 2`, or the result of migrating a version 1 file |
| `roots` | The content folders `.gitignore` and Git LFS rules were written for. After choosing other folders in `jam setup`, run the installer again |
| `catalogConfig`, `catalogManifest` | What was created for the catalog: `created`, `present`, `added the jam plugin`, or `left as it is` for a `catalog.config.json` that is not version 3 |
| `catalogMigration` | What the toolkit's own `jam catalog migrate --dry-run` answered: `current`; `needs migration: run jam catalog migrate` for files an older toolkit wrote, which the catalog refuses until they are migrated with [catalog-migration.md](catalog-migration.md); `dry run refused: <why>` naming files to repair; or `not checked` while the toolkit's packages are not installed |
| `lfs` | Whether content binaries are tracked in Git LFS, or why not |
| `dcc.blender` | The Blender found, or `null`: needed only for local Blender steps |
| `doctor` | `jam doctor`'s report |
| `fixes` | Missing tools, each with what it is for and the install command for this operating system |
| `next` | What remains, in order |

The installer stops with a message instead of a summary when:

- **the toolkit folder exists and was not installed by jam-setup:** it belongs to something else. Report it, or install elsewhere with `--dir <folder>`.
- **locally edited toolkit files would be overwritten:** show the person the listed files. Project recipes, adapters and providers belong under `jam/`, where upgrades leave them alone. `--force` discards the edits, on their say only.
- **files the toolkit now ships already exist with other content:** the same choice.

For each entry in `fixes`, say what the tool is for, recommend installing the ones the next task needs, run what the person approves, and run the installer again. An installer that needs administrator rights or a new terminal goes to the person as the exact command and what to do afterwards.

## This machine

| Tool | Needed for | When missing |
| --- | --- | --- |
| Node.js 22.20+ | Everything | Install it first; the toolkit installs its own npm packages on first use |
| Git, Git LFS | Versioning content binaries | Work continues; binaries are not tracked in LFS until it is installed and the installer is run again |
| Python 3.10+ with Pillow and numpy | `jam crop` (turnaround views) | The installer makes a private environment when the system Python lacks the packages. By hand: `jam python -- -m pip install -r <toolkit>/requirements.txt` (arguments that start with a dash go after `--`) |
| Blender | Local model steps and FBX conversion | Optional until such a step is chosen |
| ffmpeg | Audio processing | Optional until sound or voice work |

`jam.local.json` (ignored by Git) holds a path only when a tool is not on PATH: `python`, `blender`, `ffmpeg`, `providers.<id>`. Use paths found on this machine. `jam python` and `jam blender` run those tools without a shell, so one command line works in every terminal.

## Handing a sign-in to the person

The agent prepares and verifies; the person signs in. Credentials never pass through the conversation, a command line or a project file. One provider at a time.

1. **Check what is there.** `jam provider probe <id>`, then the provider's own status call from its page, because the probe prints `unknown` for what it cannot see (it holds no credentials and makes no network calls). Installed, signed in (the probe says `authenticated`) and reachable are three separate facts. Access that verifies is reused, and the person is not asked to sign in again.
2. **Start the provider's own sign-in** as its page in `docs/providers/` says, and read the instructions it prints, including on standard error. A running command does not mean a browser opened or the person saw anything.
3. **Give the person the instruction packet before any "done?" question:** which provider, where to act (browser, terminal, a named client), the exact steps or link, what success looks like, and what you will check next.

   > Open [the link the tool printed], sign in to [the provider], enter [the code] if asked, and approve. The page should confirm it. I will then check the connection and your balance without generating anything.

   Asking "have you signed in?" without this is the failure this procedure exists to prevent. Asked ahead of time what signing in will involve, describe it from the provider's page without starting a flow.
4. **Keep the flow you started.** When the host hides progress until the turn ends, use the provider's resumable sign-in, end the turn on the instructions, and resume the same flow on the answer. Start a new flow only after a confirmed expiry or failure.
5. **Keep sign-in material local.** Show only what the provider intends the person to see, on a surface only they see. Codes, code-bearing links and tokens never go into notifications, synced questions, screenshots or files; a notification points to the instructions instead. When the host cannot show them privately, give the command the person runs in their own terminal.
6. **Verify, then report** each provider as verified, waiting on a named action by the person, or failed with the real reason. "Done" from the person is a signal to verify, not proof.

A sign-in proves access. It does not prove a plan allows generation, and it generates nothing.

## Upgrading from version 1

Running the installer in a version 1 project:

- replaces the toolkit folder with version 2 (files it installed before; anything edited there stops the upgrade as described above);
- runs `jam config migrate` once the packages are installed. Preview it with `jam config migrate --dry-run`. It prints a note for everything it could not carry over exactly;
- leaves `catalog.config.json`, the manifest and `.catalog/` to `jam catalog migrate` ([catalog-migration.md](catalog-migration.md)).

What migration does to `jam.config.json`:

| Version 1 | Version 2 |
| --- | --- |
| `profiles` | `budgets`. An incomplete profile is kept as written under `engine.facts.extra.v1Profiles` |
| Units, axes and pivot in a profile | Kept under `engine.facts.authoring` until an engine adapter is chosen; the adapter's facts then replace them |
| A profile's skeleton description | `skeletons.<id>.notes`, to be completed with bone names or replaced by an adapter's skeleton |
| `review` policy per stage and profile | Project recipes under `jam/recipes/` that carry those gates; change one with `jam recipe set` |
| `spend.<provider>.limit` and `unit` | `spend.<provider>.perRun`, no total cap; the unit comes from the provider descriptor |
| `providers` | `routes` |

Version 1 runs stay readable as runs of the `asset` recipe. Version 1 commands map to: `init` → `jam run start`, `status` → `jam run status`, `register` → `jam run record`, `review` → `jam run review`, `job-intent` → `jam job open`, `job-update` → `jam job submitted|done|failed|cancelled|lost`, `settings` → `jam config set`, `check-delivery` → `jam run deliver`. No command takes a hand-written JSON record any more.

After an upgrade: `jam doctor`, `jam recipe check`, and `jam run status` to see how open runs read.

## Renamed skills

The skills that work only on 3D models carry `3d` in their names, so 2D skills can sit beside them:

| Before | Now |
| --- | --- |
| `jam-model` | `jam-3d-model` |
| `jam-retopo` | `jam-3d-retopo` |
| `jam-uv` | `jam-3d-uv` |
| `jam-texture` | `jam-3d-texture` |
| `jam-rig` | `jam-3d-rig` |

The shipped recipes name the new skills. `jam doctor`'s `skill names` line lists the old ones a project still has, installed or named in its own recipes. For each:

1. Install the new skill: `npx skills add rafaelvidaurre/furanku-skills --skill <new name>`.
2. Remove the old skill's folder, which the doctor line names, and reload skills.
3. In a project recipe under `jam/recipes/`, change the step's `"skill"` to the new name.

Runs recorded before the rename keep the old names in their history; nothing needs changing there.

Done when `jam doctor` shows `skill names` as `ok`.
