import archiver from 'archiver'
import extract from 'extract-zip'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { BackupInfo, ServerStatus } from '@trm/core'
import { safeJoin, sanitizeFilename } from './sanitize'

/** Was für Backups/Welt-Export von einem Server gebraucht wird. */
export interface SaveHost {
  dir: string
  edition: 'java' | 'bedrock'
  status: () => ServerStatus
  command: (cmd: string) => void
  /** Registriert einen Zeilen-Listener, gibt die Abmeldung zurück. */
  onLine: (fn: (line: string) => void) => () => void
}

/** Ordner/Dateien, die nicht ins Backup gehören (Cache, Logs, interne Daten). */
const EXCLUDE_TOP = new Set(['.trm', 'logs', 'cache', 'crash-reports', '.world-import', 'bedrock-server.zip'])

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}
const slugLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)

function waitForLine(host: SaveHost, re: RegExp, ms: number): Promise<boolean> {
  return new Promise((res) => {
    const off = host.onLine((l) => { if (re.test(l)) { off(); clearTimeout(t); res(true) } })
    const t = setTimeout(() => { off(); res(false) }, ms)
  })
}

/**
 * Hält das Speichern an, damit die Dateien konsistent sind, führt `fn` aus und gibt das Speichern wieder frei.
 * Läuft der Server nicht, wird `fn` direkt ausgeführt.
 */
export async function withSaveLock<T>(host: SaveHost, fn: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  if (host.status() !== 'running') return fn()
  if (host.edition === 'bedrock') {
    host.command('save hold')
    // Bedrock meldet erst nach "save query", wann die Dateien bereit sind.
    const ready = waitForLine(host, /Data saved\. Files are now ready to be copied/i, timeoutMs)
    const poll = setInterval(() => { try { host.command('save query') } catch { /* Server weg */ } }, 1000)
    await ready
    clearInterval(poll)
    try { return await fn() } finally { try { host.command('save resume') } catch { /* ignore */ } }
  }
  host.command('save-off')
  const saved = waitForLine(host, /Saved the (game|world)|All dimensions are saved|Saved the world/i, timeoutMs)
  host.command('save-all flush')
  await saved
  try { return await fn() } finally { try { host.command('save-on') } catch { /* ignore */ } }
}

export function zipDirectory(src: string, dest: string, opts: { excludeTop?: Set<string>; skipPath?: string; only?: string[] } = {}): Promise<void> {
  return new Promise((resolveP, reject) => {
    mkdirSync(resolve(dest, '..'), { recursive: true })
    const tmp = `${dest}.part`
    const out = createWriteStream(tmp)
    const arc = archiver('zip', { zlib: { level: 6 } })
    out.on('close', () => { renameSync(tmp, dest); resolveP() })
    out.on('error', reject)
    arc.on('error', (e) => { rmSync(tmp, { force: true }); reject(e) })
    arc.pipe(out)
    const skip = opts.skipPath ? resolve(opts.skipPath) : null
    const excl = opts.excludeTop ?? EXCLUDE_TOP
    arc.directory(src, false, (entry) => {
      const top = entry.name.split('/')[0] ?? ''
      if (excl.has(top)) return false
      if (opts.only && !opts.only.includes(top)) return false
      if (skip && resolve(src, entry.name).startsWith(skip)) return false
      return entry
    })
    void arc.finalize()
  })
}

export class BackupService {
  list(backupDir: string): BackupInfo[] {
    if (!existsSync(backupDir)) return []
    return readdirSync(backupDir)
      .filter((f) => f.endsWith('.zip'))
      .map((file) => {
        const st = statSync(join(backupDir, file))
        const label = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_(.+))?\.zip$/.exec(file)?.[1]
        return { file, size: st.size, created: st.mtimeMs, label }
      })
      .sort((a, b) => b.created - a.created)
  }

  async create(host: SaveHost, backupDir: string, keep: number, label?: string, now = new Date()): Promise<BackupInfo> {
    mkdirSync(backupDir, { recursive: true })
    const file = `${stamp(now)}${label && slugLabel(label) ? `_${slugLabel(label)}` : ''}.zip`
    const dest = safeJoin(backupDir, file)
    await withSaveLock(host, () => zipDirectory(host.dir, dest, { skipPath: backupDir }))
    this.prune(backupDir, keep, file)
    const st = statSync(dest)
    return { file, size: st.size, created: st.mtimeMs, label: label ? slugLabel(label) : undefined }
  }

  /** Behält die neuesten `keep` Backups. Manuell benannte "pre-"-Sicherungen zählen mit. */
  prune(backupDir: string, keep: number, protect?: string): void {
    const all = this.list(backupDir)
    for (const b of all.slice(Math.max(keep, 1))) if (b.file !== protect) rmSync(join(backupDir, b.file), { force: true })
  }

  delete(backupDir: string, file: string): void {
    rmSync(safeJoin(backupDir, sanitizeFilename(file, ['.zip'])), { force: true })
  }

  /** Stellt ein Backup wieder her. Der Server muss gestoppt sein. Vorher entsteht eine Sicherung des aktuellen Stands. */
  async restore(host: SaveHost, backupDir: string, keep: number, file: string): Promise<void> {
    if (host.status() !== 'stopped' && host.status() !== 'crashed') throw new Error('Stoppe den Server, bevor du ein Backup wiederherstellst.')
    const zip = safeJoin(backupDir, sanitizeFilename(file, ['.zip']))
    if (!existsSync(zip)) throw new Error('Backup nicht gefunden.')
    await this.create(host, backupDir, keep + 1, 'vor-wiederherstellung')
    const tmp = join(host.dir, '.trm', 'restore-tmp')
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    try {
      await extract(zip, { dir: resolve(tmp) })
      for (const e of readdirSync(host.dir)) if (e !== '.trm') rmSync(join(host.dir, e), { recursive: true, force: true })
      for (const e of readdirSync(tmp)) renameSync(join(tmp, e), join(host.dir, e))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

export const isInside = (child: string, parent: string) => resolve(child).startsWith(resolve(parent) + sep)
