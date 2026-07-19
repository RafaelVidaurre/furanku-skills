#!/usr/bin/env bash
# Append one safe row to a decision-trail TSV log.
# Usage: log.sh <logfile> <phase> <decision> <why> <evidence> <result>
set -euo pipefail

readonly header='ts	phase	decision	why	evidence	result'

if [ "$#" -ne 6 ]; then
	printf 'usage: log.sh <logfile> <phase> <decision> <why> <evidence> <result>\n' >&2
	exit 64
fi

logfile="$1"
shift

if [ -d "$logfile" ]; then
	printf 'error: logfile is a directory: %s\n' "$logfile" >&2
	exit 73
fi

logdir="$(dirname -- "$logfile")"
if [ "$logdir" != "." ]; then
	mkdir -p -- "$logdir"
fi

if [ ! -s "$logfile" ]; then
	printf '%s\n' "$header" > "$logfile"
else
	IFS= read -r existing_header < "$logfile" || true
	if [ "$existing_header" != "$header" ]; then
		printf 'error: unexpected decision-trail header in %s\n' "$logfile" >&2
		exit 65
	fi
fi

clean_cell() {
	local value
	value="$(printf '%s' "$1" | tr '\t\n\r' '   ')"
	case "$value" in
		[=+@-]*) printf "'%s" "$value" ;;
		*) printf '%s' "$value" ;;
	esac
}

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
	"$timestamp" \
	"$(clean_cell "$1")" \
	"$(clean_cell "$2")" \
	"$(clean_cell "$3")" \
	"$(clean_cell "$4")" \
	"$(clean_cell "$5")" \
	>> "$logfile"
