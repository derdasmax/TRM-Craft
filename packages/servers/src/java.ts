import { extractTrusted } from './unzip'
import { createReadStream, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { execFile } from 'node:child_process'
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

/** Hauptversion aus der Ausgabe von `java -version` (z. B. `"21.0.1"` oder `"1.8.0_402"`). */
export function parseJavaMajor(out: string): number | null {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(out)
  if (!m) return null
  const a = Number(m[1])
  return a === 1 ? Number(m[2] ?? 0) : a
}

/** Sucht ein installiertes Java, das mindestens `major` ist (JAVA_HOME, dann PATH). */
export async function findSystemJava(major: number, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Promise<{ path: string; version: number } | null> {
  const exe = platform === 'win32' ? 'java.exe' : 'java'
  const candidates = [env.JAVA_HOME ? join(env.JAVA_HOME, 'bin', exe) : '', 'java'].filter(Boolean)
  for (const c of candidates) {
    if (c !== 'java' && !existsSync(c)) continue
    const out = await new Promise<string>((ok) => execFile(c, ['-version'], { timeout: 8000, windowsHide: true }, (_e, so, se) => ok(`${se}${so}`)))
    const v = parseJavaMajor(out)
    if (v !== null && v >= major) return { path: c, version: v }
  }
  return null
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
  // Endung `.zip` ist nötig: PowerShell Expand-Archive nimmt nur .zip-Dateien an.
  const zip = join(o.runtimesDir, `dl-${process.pid}-${asset.name.replace(/[^\w.-]/g, '_')}${/\.zip$/i.test(asset.name) ? '' : '.zip'}`)
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
  if (lastError) {
    // Ausweg: ein bereits installiertes Java, das neu genug ist.
    const own = await findSystemJava(o.major, platform)
    if (own) {
      o.onProgress?.(`Vorhandenes Java wird genutzt (${own.version}).`, null)
      return own.path
    }
    throw new Error(`${lastError.message} (Ein passendes Java ist auf diesem PC nicht installiert. Du kannst Java ${o.major} oder neuer selbst installieren, z. B. von adoptium.net.)`)
  }
  const final = findJavaBinary(dir)
  if (!final) throw new Error('Java konnte nicht installiert werden.')
  return final
}
