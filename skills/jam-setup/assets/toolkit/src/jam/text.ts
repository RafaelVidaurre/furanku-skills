// Plain-text rendering for people: aligned columns and key/value lines. No colour, no box drawing,
// so output reads the same in every terminal and in an agent's transcript.

export const table = (headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string => {
  if (rows.length === 0) return "(none)"
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)))
  const line = (cells: ReadonlyArray<string>): string =>
    cells.map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0))).join("  ").trimEnd()
  return [line(headers), ...rows.map(line)].join("\n")
}

export const lines = (...parts: ReadonlyArray<string | false | null | undefined>): string =>
  parts.filter((part): part is string => typeof part === "string" && part !== "").join("\n")

export const pairs = (entries: ReadonlyArray<readonly [string, string | number | null | undefined]>): string => {
  const shown = entries.filter((entry): entry is readonly [string, string | number] => entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
  const width = Math.max(0, ...shown.map(([key]) => key.length))
  return shown.map(([key, value]) => `${key.padEnd(width)}  ${value}`).join("\n")
}
