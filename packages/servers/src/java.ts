import { extractTrusted } from './unzip'
import { createReadStream, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

/** SHA-256 einer Datei auf der Platte. */
export function sha256File(path: string): Promise<string> {
  return new Promise((ok, fail) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (c) => h.update(c)).on('error', fail).on('end', () => ok(h.digest('hex')))
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Verschiebt einen Ordner. Unter Windows scheitert `rename` oft mit EPERM/EBUSY/EACCES, solange Virenscanner oder Indexer die frisch entpackten Dateien prüfen. Deshalb mehrere Versuche, zuletzt Kopieren. */
export async function moveDir(from: string, to: string): Promise<void> {
  let last: unknown
  for (let i = 0; i < 6; i++) {
    try { renameSync(from, to); return } catch (e) {
      last = e
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES' && code !== 'ENOTEMPTY') throw e
      await sleep(400 * (i + 1))
    }
  }
  try { cpSync(from, to, { recursive: true }) } catch (e) { throw new Error(`Der Ordner konnte nicht verschoben werden (${(last as Error).message}; Kopieren: ${(e as Error).message}).`) }
}

const running = new Map<string, Promise<string>>()

/** Liefert den Pfad zu einer passenden Java-Laufzeit und lädt sie bei Bedarf automatisch herunter.
 * Gleichzeitige Aufrufe für dieselbe Java-Version teilen sich einen Lauf (sonst schreiben zwei Downloads in dieselbe Datei). */
export function ensureJava(o: EnsureJavaOptions): Promise<string> {
  const key = `${o.runtimesDir}|${o.major}`
  const cur = running.get(key)
  if (cur) return cur
  const p = installJava(o).finally(() => running.delete(key))
  running.set(key, p)
  return p
}

async function installJava(o: EnsureJavaOptions): Promise<string> {
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
  const tmp = `${dir}.tmp`
  let lastError: Error | null = null
  // Zwei Versuche: Eine beschädigte Datei (abgebrochener oder doppelter Download) wird verworfen und neu geladen.
  for (let attempt = 1; attempt <= 2; attempt++) {
    rmSync(zip, { force: true, maxRetries: 5, retryDelay: 300 })
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    try {
      await downloadFile({
        url: asset.url,
        dest: zip,
        sha256: asset.sha256,
        fetchImpl: o.fetchImpl,
        onProgress: (d, t) => o.onProgress?.(`Java ${o.major} wird geladen${attempt > 1 ? ' (zweiter Versuch)' : ''} …`, t ? Math.round((d / t) * 100) : null),
      })
      // Die Prüfsumme beim Laden gilt für die empfangenen Daten. Hier wird die Datei auf der Platte noch einmal geprüft.
      if ((await sha256File(zip)) !== asset.sha256.toLowerCase()) throw new Error('Die gespeicherte Java-Datei ist beschädigt (Prüfsumme stimmt nicht).')
      o.onProgress?.(`Java ${o.major} wird entpackt …`, null)
      try { await extractTrusted(zip, tmp, platform) } catch (e) { throw new Error(`Java konnte nicht entpackt werden: ${(e as Error).message}`) }
      if (!findJavaBinary(tmp)) throw new Error('Die heruntergeladene Java-Laufzeit enthält keine java.exe.')
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
      await moveDir(tmp, dir)
      lastError = null
      break
    } catch (e) {
      lastError = e as Error
    } finally {
      rmSync(zip, { force: true, maxRetries: 5, retryDelay: 300 })
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    }
  }
  if (lastError) throw lastError
  const final = findJavaBinary(dir)
  if (!final) throw new Error('Java konnte nicht installiert werden.')
  return final
}
