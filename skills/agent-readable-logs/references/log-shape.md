# Log record shape

The shape every event follows so an agent can filter it with `jq`, `grep`, or a platform query and read a bounded window that still carries signal. The bounded-access requirement is research-backed; the exact field names, level strings, and encoding rules below are this skill's interoperability convention, not measured claims about agent performance.

Field names map one-to-one onto the [OpenTelemetry log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/). They are not OTLP JSON: shipping them to a collector needs a parser or logging bridge that maps each local field to its OTel field.

## One event per line

A line is one event. Newlines inside a value are escaped (`\n` in JSON, `\n` inside a quoted logfmt value). A stack trace is the value of `exception.stacktrace`, never a run of bare lines. Banners, progress bars, spinner frames, and blank lines do not belong in the file.

## Fields

| Field | OTel mapping | Required | Shape |
| --- | --- | --- | --- |
| `ts` | `Timestamp` | yes | RFC 3339, UTC, `Z` suffix, at least millisecond precision: `2026-09-04T12:03:45.123Z` |
| `level` | `SeverityText` | yes | exactly one of `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL` |
| `msg` | `Body` | yes | short, human-readable; prefer a stable message template with values in attributes |
| `severity_number` | `SeverityNumber` | optional | integer inside the level's OTel range (see below) |
| `trace_id` | `TraceId` | inside a trace | 32 lowercase hex chars, not all zero; stable across the trace |
| `span_id` | `SpanId` | inside a span | 16 lowercase hex chars, not all zero; requires `trace_id` |
| `trace_flags` | `TraceFlags` | optional | 2 lowercase hex chars |
| `request_id`, `run_id`, `job_id` | attribute | one per unit of work when no trace exists | opaque string, carried on every line of that unit; process-wide events may have none |
| `logger` | source logger name; a bridge maps it to `InstrumentationScope.name` | recommended | stable component name: `http.server`, `db.pool`, `scripts/migrate` |
| `exception.type`, `exception.message`, `exception.stacktrace` | OTel exception attributes | when an exception is recorded | strings; stack trace escaped into the single line |
| anything else | `Attributes` | optional | scalar values only; keys per the naming rule |

**Levels.** The six strings are mandatory so filters are predictable. Normalize a library's own names (`WARNING` to `WARN`, `CRITICAL` to `FATAL`, `NOTICE` to `INFO`) in the formatter and note the mapping in the Logs block. OTel ranges for `severity_number`: TRACE 1 to 4, DEBUG 5 to 8, INFO 9 to 12, WARN 13 to 16, ERROR 17 to 20, FATAL 21 to 24; a source with one value per level uses the low end.

**Severity choice.** Pick from the impact of the event: `WARN` for a degraded or handled condition worth attention, `ERROR` for a failed operation, `FATAL` only when the process is expected to exit. Outer work continuing does not downgrade a failed operation. A line that fires per iteration of a hot loop is `TRACE`, or one aggregated `INFO` line with a count.

**Message.** Keep `msg` a constant template where the library supports one (`"request finished"`) and put the varying parts in attributes (`http.route`, `http.response.status_code`, `duration_ms`), so a filter on `msg` counts events of one kind.

**Keys.** Reuse OpenTelemetry semantic-convention names where one applies (`http.request.method`, `http.response.status_code`, `db.system.name`). Otherwise use lowercase dotted namespaces with underscores between words inside a component: `payment.retry_count`. Values are scalars (string, number, boolean, null); nest with dots, never with objects or arrays.

**Errors.** `error.type` belongs only where an operation semantic convention defines it; exceptions use the `exception.*` attributes above.

## Encodings

A file uses one encoding throughout; mixed encodings and free-text lines fail validation. Files are UTF-8 without a byte-order mark; `\n` or `\r\n` line endings both parse.

**JSON Lines** (default). One JSON object per line, no duplicate keys, no pretty-printing:

```
{"ts":"2026-09-04T12:03:45.123Z","level":"INFO","msg":"request finished","logger":"http.server","request_id":"9f2c1a","http.request.method":"GET","http.route":"/users/:id","http.response.status_code":200,"duration_ms":12}
{"ts":"2026-09-04T12:03:46.001Z","level":"ERROR","msg":"query failed","logger":"db.pool","request_id":"9f2c1a","exception.type":"TimeoutError","exception.message":"connection acquire timed out after 5000ms","exception.stacktrace":"TimeoutError: ...\n    at Pool.acquire (pool.js:88)"}
```

Query JSON structurally rather than by substring, so serializer whitespace does not matter:

```sh
jq -c 'select(.level == "ERROR")' logs/dev.log | tail -n 20
jq -c 'select(.request_id == "9f2c1a")' logs/dev.log | tail -n 50
```

**logfmt**, where the ecosystem prefers it. Grammar: `key=value` pairs separated by one or more spaces; a bare value contains no space, quote, or `=`; any other value is double-quoted and uses only the escapes `\"`, `\\`, `\n`, `\t`; keys are unique within a line; an empty value is `key=` or `key=""`.

```
ts=2026-09-04T12:03:45.123Z level=INFO msg="request finished" logger=http.server request_id=9f2c1a http.request.method=GET http.route=/users/:id http.response.status_code=200 duration_ms=12
```

## Volume

- Default level `INFO`. A 100-line tail at `INFO` shows what the process did, not what every function did.
- `DEBUG` and `TRACE` are enabled by one documented variable or flag, named in the Logs block.
- Local files use the project's rotation or retention mechanism with a stated maximum size or age. Detail goes to the destination; stdout carries a one-line summary (`42 passed, 1 failed, detail in logs/test.log`).

## Redaction

Secrets, tokens, cookies, passwords, and personal data are removed or masked at the emitter, before the line is written, using the library's redaction feature or a formatter step. Masked values are `***`, `[REDACTED]`, `<redacted>`, empty, or null. The validator's secret-key check is a heuristic over key names; it does not prove redaction, and values inside `msg` are checked by reading.

## Validator

`scripts/check_log_shape.py <file>...` detects the encoding from each file's first event and checks every line: strict UTF-8, no BOM, parseable in that encoding, no duplicate keys, the required fields, `ts` a valid UTC timestamp with at least millisecond precision, `level` in the set, `severity_number` inside the level's range, key grammar, scalar-only values, trace and span id rules, and unmasked values under secret-looking keys (`password`, `passwd`, `secret`, `token`, `access_token`, `refresh_token`, `authorization`, `cookie`, `set_cookie`, `api_key`, `apikey`, `secret_key`, `private_key`, `access_key`, as the last component of a key). A file with no events fails unless `--allow-empty` is passed; a physical line over `--max-line-bytes` (default 1 MiB) fails. Violations print as `<file>:<line>: <reason>`; the last line is `read N lines, validated M events, K failed`; exit 1 on any failure, 2 on usage error, 0 otherwise.
