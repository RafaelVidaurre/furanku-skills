// How an image is cut into the frames of one animation: a sprite sheet. A source gives it on a
// link (`sheet`); the catalog checks it here, the page plays it, and a review freezes it with the
// image's bytes, so a change of timing or frames is a change of what was reviewed.
//
// Two forms, both relative to the image's top-left corner, in its pixels:
//   grid    equal cells in rows: { columns, rows?, start?, count?, cell?, origin?, gap? }, and
//           optional per-frame `durations`
//   frames  one rectangle per frame: { region: [x, y, w, h], offset?: [x, y], size?: [w, h], duration? }
//           `size` is the frame's full size and `offset` where the region sits in it, so trimmed
//           frames keep their place (the region's empty border was cut away when packing).
// A frame is shown for `duration / fps` seconds (`duration` defaults to 1).
import { digest, isRecord } from "../../kernel/hash.ts"

export type Pair = readonly [number, number]

export interface SheetGrid {
  readonly columns: number
  readonly rows: number
  /** The first cell, counted along rows from the top-left one. */
  readonly start: number
  readonly count: number
  /** A cell's size; without it the image is divided evenly into columns and rows. */
  readonly cell?: Pair
  readonly origin: Pair
  readonly gap: Pair
}

export interface SheetFrame {
  readonly region: readonly [number, number, number, number]
  readonly offset?: Pair
  readonly size?: Pair
  readonly duration?: number
}

export interface Sheet {
  readonly fps: number
  readonly loop: boolean
  readonly grid?: SheetGrid
  readonly frames?: ReadonlyArray<SheetFrame>
  /** Per-frame durations of a grid, when not all are 1. */
  readonly durations?: ReadonlyArray<number>
}

export const MAX_FRAMES = 10000
const MAX_FPS = 1000
const MAX_PIXELS = 1 << 20

const isCount = (value: unknown, min = 0): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= MAX_PIXELS
const isDuration = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1000
const pair = (value: unknown, min: number): Pair | null =>
  Array.isArray(value) && value.length === 2 && isCount(value[0], min) && isCount(value[1], min) ? [value[0], value[1]] : null

const unknownKeys = (value: Record<string, unknown>, known: ReadonlyArray<string>): string | null => {
  const extra = Object.keys(value).filter((key) => !known.includes(key))
  return extra.length === 0 ? null : extra.join(", ")
}

type Parsed<A> = { readonly ok: A } | { readonly error: string }

const parseGrid = (value: unknown): Parsed<SheetGrid> => {
  if (!isRecord(value)) return { error: "grid must be an object" }
  const extra = unknownKeys(value, ["columns", "rows", "start", "count", "cell", "origin", "gap"])
  if (extra !== null) return { error: `grid has unknown fields: ${extra}` }
  if (!isCount(value["columns"], 1)) return { error: "grid.columns must be a whole number of at least 1" }
  const columns = value["columns"]
  const rows = value["rows"] ?? 1
  if (!isCount(rows, 1)) return { error: "grid.rows must be a whole number of at least 1" }
  const cells = columns * rows
  const start = value["start"] ?? 0
  if (!isCount(start) || start >= cells) return { error: `grid.start must be a cell of the grid (0 to ${cells - 1})` }
  const count = value["count"] ?? cells - start
  if (!isCount(count, 1) || start + count > cells) return { error: `grid.count must be at least 1 and fit the grid (at most ${cells - start} from cell ${start})` }
  if (count > MAX_FRAMES) return { error: `a sheet has at most ${MAX_FRAMES} frames` }
  const cell = value["cell"] === undefined ? undefined : pair(value["cell"], 1)
  if (cell === null) return { error: "grid.cell must be [width, height] in whole pixels" }
  const origin = value["origin"] === undefined ? [0, 0] as const : pair(value["origin"], 0)
  if (origin === null) return { error: "grid.origin must be [x, y] in whole pixels" }
  const gap = value["gap"] === undefined ? [0, 0] as const : pair(value["gap"], 0)
  if (gap === null) return { error: "grid.gap must be [x, y] in whole pixels" }
  return { ok: { columns, rows, start, count, ...(cell === undefined ? {} : { cell }), origin, gap } }
}

const parseFrame = (value: unknown, index: number): Parsed<SheetFrame> => {
  const at = `frames[${index}]`
  if (!isRecord(value)) return { error: `${at} must be an object` }
  const extra = unknownKeys(value, ["region", "offset", "size", "duration"])
  if (extra !== null) return { error: `${at} has unknown fields: ${extra}` }
  const region = value["region"]
  if (!Array.isArray(region) || region.length !== 4 || !isCount(region[0]) || !isCount(region[1]) || !isCount(region[2], 1) || !isCount(region[3], 1)) {
    return { error: `${at}.region must be [x, y, width, height] in whole pixels, with width and height at least 1` }
  }
  const offset = value["offset"] === undefined ? undefined : pair(value["offset"], 0)
  if (offset === null) return { error: `${at}.offset must be [x, y] in whole pixels` }
  const size = value["size"] === undefined ? undefined : pair(value["size"], 1)
  if (size === null) return { error: `${at}.size must be [width, height] in whole pixels` }
  const [ox, oy] = offset ?? [0, 0]
  if (size !== undefined && (ox + region[2] > size[0] || oy + region[3] > size[1])) return { error: `${at}: the region placed at its offset does not fit the frame's size` }
  const duration = value["duration"]
  if (duration !== undefined && !isDuration(duration)) return { error: `${at}.duration must be a number above 0` }
  return {
    ok: {
      region: [region[0], region[1], region[2], region[3]],
      ...(offset === undefined || (ox === 0 && oy === 0) ? {} : { offset }),
      ...(size === undefined ? {} : { size }),
      ...(duration === undefined || duration === 1 ? {} : { duration })
    }
  }
}

/**
 * A sheet as the catalog keeps it: checked, with defaults written out, so two ways of saying the
 * same layout have one digest. Returns the reason when the value is not a sheet.
 */
export const parseSheet = (value: unknown): Parsed<Sheet> => {
  if (!isRecord(value)) return { error: "a sheet must be an object" }
  const extra = unknownKeys(value, ["fps", "loop", "grid", "frames", "durations"])
  if (extra !== null) return { error: `the sheet has unknown fields: ${extra}` }
  const fps = value["fps"]
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0 || fps > MAX_FPS) return { error: `fps must be a number above 0 and at most ${MAX_FPS}` }
  const loop = value["loop"] ?? true
  if (typeof loop !== "boolean") return { error: "loop must be true or false" }
  if ((value["grid"] === undefined) === (value["frames"] === undefined)) return { error: "a sheet has either grid or frames" }
  if (value["grid"] !== undefined) {
    const grid = parseGrid(value["grid"])
    if ("error" in grid) return grid
    const durations = value["durations"]
    if (durations === undefined) return { ok: { fps, loop, grid: grid.ok } }
    if (!Array.isArray(durations) || durations.length !== grid.ok.count || !durations.every(isDuration)) {
      return { error: `durations must list one number above 0 for each of the ${grid.ok.count} frames` }
    }
    return { ok: { fps, loop, grid: grid.ok, ...(durations.every((d) => d === 1) ? {} : { durations: durations as ReadonlyArray<number> }) } }
  }
  if (value["durations"] !== undefined) return { error: "durations belongs to a grid; give each frame its own duration" }
  const input = value["frames"]
  if (!Array.isArray(input) || input.length === 0) return { error: "frames must list at least one frame" }
  if (input.length > MAX_FRAMES) return { error: `a sheet has at most ${MAX_FRAMES} frames` }
  const frames: Array<SheetFrame> = []
  for (const [index, frame] of input.entries()) {
    const parsed = parseFrame(frame, index)
    if ("error" in parsed) return parsed
    frames.push(parsed.ok)
  }
  return { ok: { fps, loop, frames } }
}

/** Whether a stored value is a sheet exactly as `parseSheet` writes it. */
export const isSheet = (value: unknown): value is Sheet => {
  const parsed = parseSheet(value)
  return "ok" in parsed && digest(parsed.ok) === digest(value)
}

/** How many frames a sheet plays. */
export const frameCount = (sheet: Sheet): number => sheet.grid?.count ?? sheet.frames?.length ?? 0

/** How long one pass of the animation takes, in seconds. */
export const sheetDuration = (sheet: Sheet): number => {
  const weights = sheet.frames?.map((frame) => frame.duration ?? 1) ?? sheet.durations ?? Array.from({ length: frameCount(sheet) }, () => 1)
  return weights.reduce((sum, weight) => sum + weight, 0) / sheet.fps
}

/**
 * The digest of media as a reviewer sees it: its bytes alone, or its bytes and the sheet that
 * cuts them into an animation. One function, so a frozen part and the current one always agree.
 */
export const mediaDigest = (sha256: string, sheet: Sheet | undefined): string =>
  sheet === undefined ? sha256 : digest({ sha256, sheet })
