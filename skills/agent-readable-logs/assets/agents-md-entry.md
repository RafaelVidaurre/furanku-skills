## Logs

<!-- Fill from the survey; delete lines that do not apply. -->
- `<emitter>`: `<destination>` (`<JSON Lines | logfmt>`; fields `ts`, `level`, `msg`, `<correlation-field>`). Bounded read: `<tail command>`.
- Filter by level or correlation id: `<filter command>`.
- Test runner: detail at `<destination>`, summary on stdout; on failure read `<failed-tests command>`.
- Verbose logging: `<variable-or-flag>`; default level `<level>`. Level mapping: `<library level> -> <contract level>`.
- CI failure logs: `<provider command, e.g. gh run view <run-id> --log-failed --exit-status>`.
- Benign non-zero exits: `<tool: status meaning>`.
- Read only bounded windows (tail, filtered query, line-limited platform query). Never print an entire log.
