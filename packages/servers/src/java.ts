import extract from 'extract-zip'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { downloadFile, type FetchLike } from './download'
import { resolveJre } from './providers/adoptium'

export interface EnsureJavaOptions {
  runtimesDir: string
  major: number
  platform?: NodeJS.Platform
  fetchImpl?: FetchLike
  onProgress?: (label: string, percent: number | null) => void
}

function findJavaBinary(dir: string, depth = 3): string | null {
  if (!existsSync(dir)) return null
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isFile() && e.name === 'java.exe') return p
    if (e.isDirectory() && depth > 0) {
      const r = findJavaBinary(p, depth - 1)
      if (r) return r
    }
  }
  return null
}

/** Liefert den Pfad zu einer passenden Java-Laufzeit und lädt sie bei Bedarf automatisch herunter. */
export async function ensureJava(o: EnsureJavaOptions): Promise<string> {
  const platform = o.platform ?? process.platform
  // Außerhalb von Windows (Entwicklung) wird das System-Java genutzt.
  if (platform !== 'win32') return 'java'
  const dir = join(o.runtimesDir, `java-${o.major}`)
  const existing = findJavaBinary(dir)
  if (existing) return existing

  o.onProgress?.(`Java ${o.major} wird gesucht …`, null)
  const asset = await resolveJre(o.major, o.fetchImpl)
  mkdirSync(o.runtimesDir, { recursive: true })
  const zip = join(o.runtimesDir, `${asset.name}.download`)
  await downloadFile({
    url: asset.url,
    dest: zip,
    sha256: asset.sha256,
    fetchImpl: o.fetchImpl,
    onProgress: (d, t) => o.onProgress?.(`Java ${o.major} wird geladen …`, t ? Math.round((d / t) * 100) : null),
  })
  o.onProgress?.(`Java ${o.major} wird entpackt …`, null)
  const tmp = `${dir}.tmp`
  rmSync(tmp, { recursive: true, force: true })
  try {
    await extract(zip, { dir: tmp })
    const bin = findJavaBinary(tmp)
    if (!bin) throw new Error('Die heruntergeladene Java-Laufzeit enthält keine java.exe.')
    rmSync(dir, { recursive: true, force: true })
    renameSync(tmp, dir)
  } finally {
    rmSync(zip, { force: true })
    rmSync(tmp, { recursive: true, force: true })
  }
  const final = findJavaBinary(dir)
  if (!final) throw new Error('Java konnte nicht installiert werden.')
  return final
}
