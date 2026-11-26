import { basename, resolve, sep } from 'node:path'

/** Erlaubt nur harmlose Dateinamen (keine Pfade, keine Steuerzeichen, keine reservierten Windows-Namen). */
export function sanitizeFilename(name: string, allowedExt: string[] = ['.jar']): string {
  const base = basename(name.replace(/\\/g, '/')).normalize('NFC')
  const cleaned = base.replace(/[^\w.+()\[\] \-]/g, '_').replace(/^\.+/, '').replace(/\.{2,}/g, '.').trim()
  if (!cleaned || cleaned.length > 150) throw new Error('Ungültiger Dateiname.')
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(cleaned)) throw new Error('Ungültiger Dateiname.')
  if (!allowedExt.some((e) => cleaned.toLowerCase().endsWith(e))) throw new Error(`Dateityp nicht erlaubt: ${cleaned}`)
  return cleaned
}

/** Fügt Pfadteile zusammen und stellt sicher, dass das Ergebnis innerhalb von `root` liegt. */
export function safeJoin(root: string, ...parts: string[]): string {
  const base = resolve(root)
  const full = resolve(base, ...parts)
  if (full !== base && !full.startsWith(base + sep)) throw new Error('Pfad liegt außerhalb des Server-Ordners.')
  return full
}

/** Relative Pfade aus Modpacks: keine absoluten Pfade, kein "..", keine Laufwerksbuchstaben. */
export function safeRelativePath(p: string): string {
  const norm = p.replace(/\\/g, '/')
  if (!norm || norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || norm.split('/').some((s) => s === '..' || s === '')) throw new Error(`Unzulässiger Pfad: ${p}`)
  return norm
}
