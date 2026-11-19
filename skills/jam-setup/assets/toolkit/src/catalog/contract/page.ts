// How the page is laid out.

/** One side of the top-level split of units (which a type selects with `scope`). */
export interface ScopeInput {
  /** A section of the page and a segment of its addresses: lower-case letters, digits and hyphens. */
  readonly id: string
  readonly label: string
  readonly description: string
}
