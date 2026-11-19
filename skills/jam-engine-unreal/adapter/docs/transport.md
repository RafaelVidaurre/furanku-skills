# Reaching the editor

Every command that touches the engine sends a Python script to the Unreal editor. How it gets there is this machine's setting, `engine` in `jam.local.json` (Git-ignored):

```json
"engine": {
  "project": "Game.uproject",
  "transport": { "kind": "command", "run": ["node", "tools/editor-python.mjs", "{script}"], "await": true },
  "work": "Saved/JamEngine",
  "locks": "take",
  "editorProject": "D:/work/game"
}
```

| Field | Meaning | Default |
| --- | --- | --- |
| `project` | The `.uproject`, relative to the project root | the only `*.uproject` in the root |
| `transport` | One of the three routes below | `handoff` |
| `work` | Project-relative, Git-ignored folder for prepared scripts and results | `Saved/JamEngine` |
| `locks` | `off`, `check` or `take` ([locking.md](locking.md)) | `off` |
| `editorProject` | The project folder as the editor's machine names it. When set, every script first confirms the editor has that project open and stops with "Editor checkout mismatch" otherwise | not checked |

Keep host names, addresses and credentials out of tracked files; this file is the only place they belong.

## Routes

**`commandlet`** starts its own headless editor process for each script:

```json
{ "kind": "commandlet", "editor": "<path to UnrealEditor-Cmd>", "args": ["-unattended", "-nosplash", "-nullrhi", "-stdout"] }
```

It runs `<editor> <project> -run=pythonscript -script=<file>` (Epic: "runs quickly and can run your scripts in headless mode"; it "does not load levels automatically", and the editor exits after the script). It needs the Python Editor Script Plugin enabled and no resident editor holding the project. `-nullrhi` removes the renderer, so nothing run this way is visual evidence.

A script that needs a renderer (the previews' baked materials, [previews.md](previews.md)) starts the commandlet with `args` minus `-nullrhi`, plus `-AllowCommandletRendering -RenderOffscreen`: the editor renders on the GPU with no window. Set `"renderArgs": [...]` to give that launch its own full argument list. Scripts that wait across editor frames or call editor tools are refused on this route: collision measure and fit, random-variant sound sources, bones in play.

**`command`** hands the script to a program of the project's own that reaches a running editor:

```json
{ "kind": "command", "run": ["<program>", "<args>", "{script}"], "await": true, "timeoutSeconds": 1800 }
```

`{script}`, `{result}` and `{project}` are replaced with absolute paths; without `{script}` the script path is appended. The program runs the file's text in the editor's Python tool and prints the value the tool returned (the script's last expression, a JSON string) on standard output. Set `"await": true` only when that tool accepts top-level `await`; the scripts named above need it, and the random-variant script also needs the tool's `call_tool` function for reaching other editor toolsets. This is the route the jam used: the editor's own Python scripting tool, reached through an editor MCP server by a small client script.

Two things a bridge should do, learned in the jam: retry once when the connection fails before the call reaches the editor (an editor drops an idle connection, and the first call after a long pause fails), and keep each call short (the tool timed out on long ones, which is why a skinned import is three calls).

**`handoff`** (no transport) is for an agent that holds the editor's Python tool itself. The command writes each script under `work`, exits 3 and lists them:

```json
{ "error": { "code": "editor-handoff", "message": "...", "fix": "..." },
  "handoff": { "steps": [{ "name": "textures", "script": "Saved/JamEngine/import-skinned-textures-1a2b3c4d5e6f.py",
                           "result": "Saved/JamEngine/import-skinned-textures-1a2b3c4d5e6f.result.json", "await": false, "done": false }] } }
```

1. Run each script's text, in order, in the editor's Python tool.
2. When the editor is on this machine it writes each `result` file itself. When it is on another machine, save the JSON text each call returned to that step's `result` path here.
3. Run the same command again with the same arguments. It reads the results, prints the receipt and deletes them.

Done when the second run exits 0 with the receipt.

## An editor on another machine

Sources are named relative to the project and opened from the editor's own checkout, so the asset stores a project-relative path. Put the files there first (sync, or upload them to the same relative path). Each script compares the file's SHA-256 with the one computed here and stops with "source differs in the editor's checkout" or "source is missing" instead of importing an older file. An upload onto a staging file that already exists failed in the jam: upload under a new name.

Engine binaries the editor saved live in the editor's checkout: commit them from there.
