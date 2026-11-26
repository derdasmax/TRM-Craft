export interface UpdateYml {
  version: string
  path: string
  sha512: string
}

/** Liest die für einen Rollback nötigen Felder aus latest.yml / beta.yml (electron-builder-Format). */
export function parseUpdateYml(text: string): UpdateYml | null {
  const get = (key: string) => {
    const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text)
    return m ? m[1]!.trim().replace(/^['"]|['"]$/g, '') : null
  }
  const version = get('version')
  const path = get('path')
  const sha512 = get('sha512')
  if (!version || !path || !sha512) return null
  // Pfad darf keine Verzeichnisse enthalten, sonst könnte eine manipulierte Datei woanders hin schreiben.
  if (/[\\/]/.test(path)) return null
  return { version, path, sha512 }
}

export function releaseNotesToText(notes: unknown): string {
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (n && typeof n === 'object' && 'note' in n ? String((n as { note: unknown }).note ?? '') : ''))
      .filter(Boolean)
      .join('\n\n')
  }
  return ''
}
