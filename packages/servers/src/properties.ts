/** Parser/Serializer für server.properties, der Kommentare und Reihenfolge erhält. */
export function parseProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const KEY = /^[a-zA-Z0-9._-]+$/

/** Setzt Werte in einer bestehenden Datei (oder hängt sie an). Zeilenumbrüche in Werten sind verboten. */
export function updateProperties(text: string, values: Record<string, string>): string {
  for (const [k, v] of Object.entries(values)) {
    if (!KEY.test(k)) throw new Error(`Ungültiger Schlüssel: ${k}`)
    if (/[\r\n]/.test(v)) throw new Error(`Ungültiger Wert für ${k}`)
  }
  const lines = text.replace(/\r/g, '').split('\n')
  const pending = new Map(Object.entries(values))
  const next = lines.map((raw) => {
    const t = raw.trim()
    if (!t || t.startsWith('#')) return raw
    const i = t.indexOf('=')
    if (i < 0) return raw
    const key = t.slice(0, i).trim()
    if (pending.has(key)) {
      const v = pending.get(key)!
      pending.delete(key)
      return `${key}=${v}`
    }
    return raw
  })
  while (next.length && next[next.length - 1] === '') next.pop()
  for (const [k, v] of pending) next.push(`${k}=${v}`)
  return `${next.join('\n')}\n`
}
