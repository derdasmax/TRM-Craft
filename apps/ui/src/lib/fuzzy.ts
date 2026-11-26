/** Einfache Fuzzy-Suche: Zeichen der Suche müssen der Reihe nach vorkommen. Je zusammenhängender und früher, desto besser. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const t = text.toLowerCase()
  const sub = t.indexOf(q)
  if (sub >= 0) return 1000 - sub * 2 - (t.length - q.length) // zusammenhängender Treffer schlägt verstreute
  let ti = 0, score = 0, streak = 0
  for (const ch of q) {
    const i = t.indexOf(ch, ti)
    if (i < 0) return -1
    streak = i === ti ? streak + 1 : 0
    score += 10 + streak * 5 - Math.min(i - ti, 8)
    ti = i + 1
  }
  return score
}

export function rank<T>(items: T[], query: string, text: (i: T) => string): T[] {
  if (!query.trim()) return items
  return items.map((i) => ({ i, s: fuzzyScore(query, text(i)) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.i)
}
