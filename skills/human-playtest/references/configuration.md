# Configuration

Run from the installed skill directory:

```sh
python3 scripts/playtest.py config resolve --path /path/to/project
python3 scripts/playtest.py config read
python3 scripts/playtest.py config read --scope /path/to/project
printf '%s\n' '{"interval":0.5,"max_bytes":null}' |
  python3 scripts/playtest.py config write --scope /path/to/project
```

Omit `--scope` to write machine-global settings. Use `--file settings.json` instead
of stdin if convenient. `config write` replaces that layer; omitted fields resume
inheritance, and `{}` clears its overrides. Other scopes are preserved.

## Location and precedence

Settings live at `$FURANKU_SKILLS_HOME/human-playtest/config.json`, or
`~/.furanku-skills/human-playtest/config.json` when the variable is unset.
Project/path scopes are entries in this machine file, not project-owned files.

Each field resolves from defaults → global settings → matching ancestor paths
from broadest to most specific → invocation flags. Paths are canonicalized.
`config resolve` shows effective values and their provenance, and accepts the
same setting flags as `start`.

An absent field inherits; `null` disables a cap. See the
[configuration schema](config.schema.json) and [layered example](config.example.json).

| Setting | Default | Values |
| --- | --- | --- |
| `interval` | `0.25` seconds | Positive finite number |
| `max_seconds` | `3600` | Positive finite number or `null` |
| `max_bytes` | `2147483648` | Positive signed 64-bit integer or `null` |
| `audio` | `"microphone"` | `"microphone"` or `"none"` |
| `target` | `null` | `{"type":"window","id":123}` or display equivalent |
| `output_root` | Machine namespace's `sessions/` | Absolute directory |

Saved window/display IDs still need verification against current `targets`.
For changes to an active recording, use `limits` in [capture.md](capture.md);
editing defaults affects future sessions.

Retention is a session choice, not a JSON setting: results plus selected images,
or results with sources kept. State the plan before capture and obtain source
deletion authorization as described in [review.md](review.md). There is no
automatic deletion or hidden retention setting.
