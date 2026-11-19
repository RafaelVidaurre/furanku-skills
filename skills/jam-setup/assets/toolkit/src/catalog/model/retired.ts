// Keys that source outputs, enrich patches and manifests used before the catalog API overhaul.
// Their data is read leniently (unknown keys are not refused), so an old key would be ignored
// without a word; each one found is named with its field path and the key that replaced it.
// Pure: nothing here reads a file.
import { isRecord } from "../../kernel/hash.ts"

export interface RetiredKey {
  /** Where the old key sits, as a field path (`types.thing.views`). */
  readonly path: string
  /** The key that replaced it. */
  readonly now: string
}

/** One problem message: `<path> is now <new key>`. */
export const retiredMessage = (key: RetiredKey): string => `${key.path} is now ${key.now}`

const at = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`)

/** A type: `views` is `inspectors`, a role's `kinds` is `mediaKinds`. */
export const retiredInType = (type: unknown, path: string): Array<RetiredKey> => {
  if (!isRecord(type)) return []
  const found: Array<RetiredKey> = Object.hasOwn(type, "views") ? [{ path: at(path, "views"), now: "inspectors" }] : []
  const roles = type["roles"]
  if (Array.isArray(roles)) {
    roles.forEach((role, index) => {
      if (isRecord(role) && Object.hasOwn(role, "kinds")) found.push({ path: at(path, `roles[${index}].kinds`), now: "mediaKinds" })
    })
  }
  return found
}

/** A unit: `views` is `inspectors`. */
export const retiredInUnit = (unit: unknown, path: string): Array<RetiredKey> =>
  isRecord(unit) && Object.hasOwn(unit, "views") ? [{ path: at(path, "views"), now: "inspectors" }] : []

/** A unit in a list, named by its index and, when it has one, its id: `units[0] (thing/a)`. */
export const unitPath = (list: string, index: number, unit: unknown): string =>
  `${list}[${index}]${isRecord(unit) && typeof unit["id"] === "string" ? ` (${unit["id"]})` : ""}`

const typesOf = (types: unknown, path: string): Array<RetiredKey> =>
  isRecord(types) ? Object.entries(types).flatMap(([key, type]) => retiredInType(type, `${path}.${key}`)) : []

/**
 * The old keys in a source output or an enrich patch: type `views` and role `kinds`, unit `views`
 * (a list of units in an output, units by id in a patch) and a problem's `source`.
 */
export const retiredKeys = (output: unknown): Array<RetiredKey> => {
  if (!isRecord(output)) return []
  const found = typesOf(output["types"], "types")
  const units = output["units"]
  if (Array.isArray(units)) units.forEach((unit, index) => found.push(...retiredInUnit(unit, unitPath("units", index, unit))))
  else if (isRecord(units)) for (const [id, unit] of Object.entries(units)) found.push(...retiredInUnit(unit, `units[${JSON.stringify(id)}]`))
  const problems = output["problems"]
  if (Array.isArray(problems)) {
    problems.forEach((problem, index) => {
      if (isRecord(problem) && Object.hasOwn(problem, "source")) found.push({ path: `problems[${index}].source`, now: "subject" })
    })
  }
  return found
}

/** The old keys in a manifest (version 2 or later): its types and its own units. */
export const retiredInManifest = (manifest: unknown): Array<RetiredKey> => {
  if (!isRecord(manifest)) return []
  const found = typesOf(manifest["types"], "types")
  const units = manifest["units"]
  if (Array.isArray(units)) units.forEach((unit, index) => found.push(...retiredInUnit(unit, unitPath("units", index, unit))))
  return found
}

/** The old keys in one unit file: a unit, or `{ units: [...] }`. */
export const retiredInUnitFile = (value: unknown): Array<RetiredKey> =>
  isRecord(value) && Array.isArray(value["units"])
    ? value["units"].flatMap((unit, index) => retiredInUnit(unit, unitPath("units", index, unit)))
    : retiredInUnit(value, "")

/** A type or unit without its old keys, so a problem already named is not named again downstream. */
export const withoutRetired = {
  type: <T>(type: T): T => {
    if (!isRecord(type)) return type
    const { views: _views, ...rest } = type
    return (Array.isArray(rest["roles"])
      ? { ...rest, roles: rest["roles"].map((role) => (isRecord(role) ? (({ kinds: _kinds, ...kept }) => kept)(role) : role)) }
      : rest) as T
  },
  unit: <U>(unit: U): U => {
    if (!isRecord(unit)) return unit
    const { views: _views, ...rest } = unit
    return rest as U
  }
}
