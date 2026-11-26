import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import extract from 'extract-zip'
import type { FileContent, FileEntry } from '@trm/core'
import { safeJoin, safeRelativePath } from './sanitize'

const MAX_EDIT_BYTES = 2 * 1024 * 1024
const HIDDEN = new Set(['.trm', '.world-import'])
/** Diese Ordner darf man nicht komplett löschen oder verschieben. */
const PROTECTED = new Set(['', 'server.jar'])

/** Dateizugriff innerhalb EINES Server-Ordners. Jeder Pfad wird gegen Ausbruch geprüft. */
export class ServerFiles {
  constructor(private readonly root: string, private readonly maxUploadBytes = 2 * 1024 ** 3) {}

  private p(rel: string): string {
    const n = rel.replace(/\\/g, '/').replace(/^\/+/, '')
    if (n === '') return safeJoin(this.root)
    const full = safeJoin(this.root, safeRelativePath(n))
    if (n.split('/').some((s) => HIDDEN.has(s))) throw new Error('Dieser Ordner ist geschützt.')
    return full
  }

  list(rel: string): FileEntry[] {
    const dir = this.p(rel)
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => !HIDDEN.has(e.name))
      .map((e) => {
        const st = statSync(join(dir, e.name))
        return { name: e.name, dir: e.isDirectory(), size: e.isDirectory() ? 0 : st.size, modified: st.mtimeMs }
      })
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
  }

  read(rel: string): FileContent {
    const f = this.p(rel)
    const st = statSync(f)
    if (!st.isFile()) throw new Error('Keine Datei.')
    if (st.size > MAX_EDIT_BYTES) throw new Error('Die Datei ist zu groß zum Bearbeiten (über 2 MB).')
    const buf = readFileSync(f)
    if (buf.includes(0)) throw new Error('Binärdateien können nicht bearbeitet werden.')
    return { content: buf.toString('utf8'), size: st.size }
  }

  write(rel: string, content: string): void {
    const f = this.p(rel)
    if (Buffer.byteLength(content) > MAX_EDIT_BYTES) throw new Error('Inhalt ist zu groß.')
    mkdirSync(dirname(f), { recursive: true })
    const tmp = `${f}.trm-tmp`
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, f)
  }

  mkdir(rel: string): void {
    mkdirSync(this.p(rel), { recursive: true })
  }

  delete(rel: string): void {
    const n = rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (PROTECTED.has(n)) throw new Error('Das kann nicht gelöscht werden.')
    rmSync(this.p(n), { recursive: true, force: true })
  }

  rename(from: string, to: string): void {
    const a = this.p(from)
    const b = this.p(to)
    if (PROTECTED.has(from.replace(/^\/+|\/+$/g, ''))) throw new Error('Das kann nicht verschoben werden.')
    if (existsSync(b)) throw new Error('Das Ziel existiert bereits.')
    mkdirSync(dirname(b), { recursive: true })
    renameSync(a, b)
  }

  /** Entpackt eine ZIP in einen gleichnamigen Ordner neben der Datei (extract-zip verhindert Zip-Slip). */
  async unzip(rel: string): Promise<void> {
    const zip = this.p(rel)
    if (!/\.zip$/i.test(zip)) throw new Error('Nur ZIP-Dateien können entpackt werden.')
    const dest = join(dirname(zip), basename(zip).replace(/\.zip$/i, ''))
    if (existsSync(dest)) throw new Error('Der Zielordner existiert bereits.')
    mkdirSync(dest, { recursive: true })
    try { await extract(zip, { dir: dest }) } catch (e) { rmSync(dest, { recursive: true, force: true }); throw e }
  }

  /** Kopiert lokale Dateien in einen Server-Unterordner. Gibt die Anzahl zurück. */
  upload(dirRel: string, paths: string[]): number {
    const dir = this.p(dirRel)
    mkdirSync(dir, { recursive: true })
    let n = 0
    for (const src of paths) {
      const name = basename(src).replace(/[<>:"|?*\x00-\x1f]/g, '_')
      if (!name || name.startsWith('.')) continue
      const st = statSync(src)
      if (!st.isFile() || st.size > this.maxUploadBytes) continue
      const dest = safeJoin(dir, name)
      if (existsSync(dest)) throw new Error(`${name} existiert bereits.`)
      copyFileSync(src, dest)
      n++
    }
    return n
  }
}
