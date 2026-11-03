# Capture and control

Run commands from the installed skill directory, or use absolute script paths.
Capture requires macOS 15+, Python 3.9+ and Xcode command-line tools. Final media
inspection requires `ffprobe`. Windows/Linux capture is unsupported.

## Start

```sh
python3 scripts/playtest.py targets
python3 scripts/playtest.py config resolve --path /path/to/project
python3 scripts/playtest.py start --path /path/to/project --window 12345
```

Match the selected ID to its current title, process and dimensions. Use
`--display ID` for a whole-display request. `start` returns the session ID/path
and waits for a stored image, recording start and requested microphone samples.
If it fails, inspect that session's status instead of launching a duplicate.

Invocation options override saved settings:

```sh
python3 scripts/playtest.py start --path /path/to/project --window 12345 \
  --interval 0.5 --max-seconds 1800 --max-bytes 1073741824 \
  --output-root /path/to/recordings
```

Audio uses the default microphone; system/application audio is not captured.
Use `--audio none` only for an explicitly silent session. If OS permissions are
missing, these commands request access without starting a recording:

```sh
python3 scripts/playtest.py permissions screen
python3 scripts/playtest.py permissions microphone
```

Capture runs without activating or changing the target application. It stores
`screen.mov` (H.264, up to 30 FPS, with requested audio), live PNGs and
`frames/index.jsonl`. The index distinguishes screenshot sampling time from the
source frame's time, including repeated frames and missed intervals.

Native pixel scale is retained, with even output dimensions for H.264. A resize,
scale or display change stops capture with `target_geometry_changed`; inspect
that transition's tail before treating it as reliable visual evidence.

## Status and limits

```sh
python3 scripts/playtest.py status SESSION
python3 scripts/playtest.py limits SESSION --max-bytes none
python3 scripts/playtest.py limits SESSION --max-seconds 7200
```

Use the returned session ID or absolute directory for `SESSION`. `none` removes
a cap; omitted flags leave it unchanged. Limits update the existing recording
without restarting it. Check `status` until the reported native caps match the
request; acknowledgment can lag by about one second.

Limits apply to total session duration/bytes, not a fresh allowance from the
update. Lowering a cap below current usage stops capture. Caps are soft:
encoding and finalization can overshoot. At 90%, a warning is recorded once.
Evidence is retained when a cap stops recording. Keep the session tree unchanged
while capture is active so live storage accounting remains accurate.

## Stop

```sh
python3 scripts/playtest.py stop SESSION
python3 scripts/review.py inspect /absolute/path/to/session
```

A successful final receipt reports `stopped`; `failed` includes the reason.
If `stop_complete` is false, preserve the session and check `status` again.
Controls verify process ownership; use them rather than signaling remembered PIDs.
The default start/stop wait is 30 seconds (`--wait-seconds` accepts up to 60).

Continue with [review.md](review.md) to transcribe, inspect frames and organize
feedback. For saved defaults and project overrides, use
[configuration.md](configuration.md).
