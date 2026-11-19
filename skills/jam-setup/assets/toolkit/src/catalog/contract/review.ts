// Reviews as plugin code sees them: who acts, the decisions a resolver chooses between, and the
// resolver itself.

/** Who acts. A declaration, not proof of identity. */
export interface Actor {
  readonly name: string
  readonly kind: "human" | "agent"
}

/** One reviewer's immutable verdicts on one submission item, as a resolver receives it. */
export interface Decision {
  readonly id: string
  readonly submission: string
  readonly item: string
  readonly by: Actor
  /** UTC time it was recorded. */
  readonly at: string
  /** Which parts it decides: the `whole` item (one verdict plus `exceptions`), or the named `parts` (`verdicts`). */
  readonly covers: { readonly kind: "whole" | "parts"; readonly parts: ReadonlyArray<string> }
  readonly verdict?: string
  readonly exceptions?: Readonly<Record<string, string>>
  readonly verdicts?: Readonly<Record<string, string>>
  /** The decision's text on the whole item. */
  readonly comment?: string
  /** Its text per decided part. */
  readonly partComments?: Readonly<Record<string, string>>
  /** An agent recording a person's decision given outside the catalog, in their words. */
  readonly relay?: { readonly by: string; readonly channel: string; readonly words: string }
}

/**
 * Picks the deciding decision among the time-ordered decisions (recorded time, then id) that
 * address one part. It returns one of them, or nothing when none decides.
 */
export type Resolver = (decisions: ReadonlyArray<Decision>, part: string) => Decision | null | undefined
