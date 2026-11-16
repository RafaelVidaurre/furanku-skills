# Writing an engine adapter

Start from `assets/example-adapter/` in this skill: a complete adapter for a made-up runtime that loads `.glb` files from a `game/assets/` folder. Its four commands are small Node scripts that return valid receipts, so you can install it in a scratch project and watch each verb work before changing anything. [contract.md](contract.md) is the reference for every field and rule used below.

1. **Copy the example** to a folder named for your engine and set `id`, `label` and `versions` in `adapter.json`. Done when `jam engine install <folder>` succeeds in a scratch project and `jam engine show` names it.
2. **State the facts from the engine's own documentation.** Open the vendor's pages for units, axes, import formats, texture conventions, collision authoring, audio and naming; write each fact with the page it came from in the adapter's `docs/`. Leave out a fact you found no source for: a missing fact makes a skill ask, a wrong one makes it deliver the wrong file. Put what the project decides (content folders, sample rate) under `extra` with no default, so a project must state it. Done when `jam engine facts` prints them and each has a source.
3. **Decide which verbs get a command.** A command is worth writing when the engine can be driven without a person (a command-line tool, a scripting interface, a file drop). For each verb you leave `null`, write `docs/<verb>.md`: the steps by hand, each ending on something the reader can check. Done when every verb has a command or a guide.
4. **Write `import` first.** It takes `--kind <kind>` and project-relative files, puts them in the engine, and prints `{"assets": [...]}`. Make it idempotent: derive the asset's id from the source's name and destination, so a second import of the same file replaces content and returns the same id. Report the source and its SHA-256. Refuse a source outside the project. Done when two runs on one file print the same id.
5. **Write `inspect`.** It prints what the engine holds for one id, in meters. Report only what you read back from the engine or the imported file; this receipt is what the toolkit's check compares with the budget and the facts, so a guessed value hides a real fault. Done when its bounds for a cube of known size are that size.
6. **Add `references`, `capture`, `check` and `conform-skeleton`** where the engine supports them. `check` prints `{"problems": [...]}` and exits 0 whether or not it found any; a non-zero exit means the check itself could not run.
7. **Take machine settings from `JAM_ENGINE_SETTINGS`.** Document the fields in `docs/` and fail with the name of the missing field. Nothing about one machine (a path, a host name, a port) belongs in the adapter's files.
8. **Test without the engine.** Keep everything that does not need the engine (argument handling, path and id mapping, receipt building) in plain functions with tests, and run the commands against a temporary project. The example's commands are tested this way in this repository.
9. **Try each verb in a real project** on a throwaway asset, then compare `jam engine inspect` with what you see in the engine.
10. **Say what is validated.** List, per command, what was run against the engine, on which version, and what was not. An adapter that states this is one others can trust and extend.

Done when `jam engine show` lists the commands you wrote, each prints one JSON object and exits 0 on a real asset, and every other verb has a guide.

## Keeping it small

- A command is a thin script. If it grows past argument handling and one call into the engine, move the engine-side work to its own file and keep the receipt building testable without the engine.
- Guidance holds what no command can know: why a step is done a certain way, and what went wrong when it was not.
