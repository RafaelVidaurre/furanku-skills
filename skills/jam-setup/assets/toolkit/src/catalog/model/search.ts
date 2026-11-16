// Search ranking: exact > prefix > alias > word > substring > member > fact > fuzzy.

/** Lower case, accents removed, punctuation other than `: . /` turned into spaces. */
export const norm = (text: unknown): string =>
  String(text ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9:./]+/g, " ").trim()

const words = (text: unknown): Array<string> => norm(text).split(/[\s/.]+/).filter(Boolean)

/** Damerau-Levenshtein distance, giving up (max + 1) once it must exceed `max`. */
const damerau = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: Array<Array<number>> = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  const at = (i: number, j: number): number => d[i]?.[j] ?? 0
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, at(i - 2, j - 2) + 1)
      d[i]![j] = value
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > max) return max + 1
  }
  return at(a.length, b.length)
}

export interface SearchDoc {
  readonly name: string
  readonly id: string
  readonly aliases?: ReadonlyArray<string>
  readonly facts?: ReadonlyArray<string>
  readonly members?: ReadonlyArray<{ readonly id: string; readonly name: string }>
}

export interface Rank {
  readonly score: number
  /** The member that made a collection match, when no fact of the collection itself did. */
  readonly member?: { readonly id: string; readonly name: string } | null
}

/** Rank a document against a query; null when some query word matches nothing. */
export const rankDoc = (query: string, doc: SearchDoc): Rank | null => {
  const q = norm(query)
  if (!q) return { score: 0 }
  const name = norm(doc.name)
  const id = norm(doc.id)
  if (q === name || q === id) return { score: 1000 }
  if (name.startsWith(q) || id.startsWith(q)) return { score: 800 }
  const aliases = (doc.aliases ?? []).map(norm)
  if (aliases.some((alias) => alias === q || alias.startsWith(q))) return { score: 700 }
  const queryWords = words(query)
  const nameWords = new Set([...words(doc.name), ...words(doc.id)])
  const aliasWords = new Set(aliases.flatMap((alias) => alias.split(/[\s/.]+/)))
  const factText = (doc.facts ?? []).map(norm).join(" ")
  const memberDocs = (doc.members ?? []).map((member) => ({
    ...member,
    words: new Set([...words(member.name), ...words(member.id)]),
    text: `${norm(member.name)} ${norm(member.id)}`
  }))
  let score = 0
  let member: Rank["member"] = null
  for (const word of queryWords) {
    const fuzzyMax = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0
    const near = (set: ReadonlySet<string>): boolean => fuzzyMax > 0 && [...set].some((other) => damerau(word, other, fuzzyMax) <= fuzzyMax)
    const starts = (set: ReadonlySet<string>): boolean => [...set].some((other) => other.startsWith(word))
    let s = 0
    if (nameWords.has(word)) s = 600
    else if (starts(nameWords)) s = 500
    else if (aliasWords.has(word) || starts(aliasWords)) s = 450
    else if (name.includes(word) || id.includes(word)) s = 400
    else {
      const hit = memberDocs.find((m) => m.words.has(word) || starts(m.words) || m.text.includes(word))
      if (hit) {
        s = 300
        member ??= { id: hit.id, name: hit.name }
      } else if (factText.includes(word)) s = 200
      else if (near(nameWords) || near(aliasWords)) s = 150
      else {
        const fuzzy = memberDocs.find((m) => near(m.words))
        if (fuzzy) {
          s = 120
          member ??= { id: fuzzy.id, name: fuzzy.name }
        }
      }
    }
    if (!s) return null
    score += s
  }
  return { score: Math.round(score / queryWords.length), member }
}
