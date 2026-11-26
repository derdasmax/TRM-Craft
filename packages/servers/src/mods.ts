import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import {
  LOADER_INFO, extensionKind,
  type InstalledMod, type ModHit, type ModInstallResult, type ModSearchArgs, type ModSearchResult, type ModSource, type ModUpdate, type ServerRecord, type ServerStatus,
} from '@trm/core'
import { downloadFile, type FetchLike } from './download'
import { inspectJar, isCompatible } from './jarinfo'
import { cfFilesById, cfLatestFile, cfModInfo, cfSha1, searchCurseForge } from './providers/curseforge'
import { hangarPlatform, resolveHangar, searchHangar } from './providers/hangar'
import { compatibleVersion, getProjectInfo, getVersion, latestByHash, modrinthLoaders, primaryFile, searchModrinth, type ModrinthVersion } from './providers/modrinth'
import { safeJoin, sanitizeFilename } from './sanitize'

export interface ModsDeps {
  servers: { recordOf(id: string): ServerRecord; serverDir(id: string): string; statusOf(id: string): ServerStatus }
  fetchImpl?: FetchLike
  download?: typeof downloadFile
  curseKey: () => string | null
  maxFileBytes?: number
}

interface Meta {
  source: ModSource | 'manual'
  projectId?: string
  versionId?: string
  title?: string
  iconUrl?: string
  version?: string
  sha1?: string
}
interface Index { version: 1; files: Record<string, Meta> }

const DISABLED = '.disabled'

export class ModManager {
  constructor(private readonly d: ModsDeps) {}

  private get dl() { return this.d.download ?? downloadFile }

  private ext(id: string): { dir: string; rec: ServerRecord } {
    const rec = this.d.servers.recordOf(id)
    const folder = LOADER_INFO[rec.loader].extFolder
    if (!folder || !extensionKind(rec.loader)) throw new Error(`${LOADER_INFO[rec.loader].label} unterstützt keine Mods oder Plugins.`)
    const dir = safeJoin(this.d.servers.serverDir(id), folder)
    mkdirSync(dir, { recursive: true })
    return { dir, rec }
  }

  private idxPath(id: string) { return join(this.d.servers.serverDir(id), '.trm', 'mods.json') }
  private readIndex(id: string): Index {
    try { const i = JSON.parse(readFileSync(this.idxPath(id), 'utf8')) as Index; return i.files ? i : { version: 1, files: {} } } catch { return { version: 1, files: {} } }
  }
  private writeIndex(id: string, i: Index) {
    mkdirSync(join(this.d.servers.serverDir(id), '.trm'), { recursive: true })
    writeFileSync(this.idxPath(id), JSON.stringify(i, null, 2))
  }

  // ---------- Suche ----------
  async search(a: ModSearchArgs): Promise<ModSearchResult> {
    const rec = a.serverId ? this.d.servers.recordOf(a.serverId) : null
    const loaders = rec ? modrinthLoaders(rec.loader) : []
    const mc = rec?.mcVersion
    if (a.source === 'modrinth') return searchModrinth({ query: a.query, kind: a.kind, loaders, mcVersion: mc, category: a.category, offset: a.offset }, this.d.fetchImpl)
    if (a.source === 'hangar') {
      const platform = rec ? hangarPlatform(rec.loader) : 'PAPER'
      if (!platform) throw new Error('Hangar bietet nur Plugins für Paper, Velocity und Waterfall.')
      return searchHangar(a.query, platform, mc, a.offset, this.d.fetchImpl)
    }
    const key = this.d.curseKey()
    if (!key) throw new Error('Für CurseForge ist ein API-Key nötig. Trage ihn in den Einstellungen ein.')
    return searchCurseForge(key, { query: a.query, kind: a.kind, loader: rec?.loader, mcVersion: mc, offset: a.offset }, this.d.fetchImpl)
  }

  // ---------- Liste ----------
  installed(id: string): InstalledMod[] {
    const { dir } = this.ext(id)
    const idx = this.readIndex(id).files
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && (e.name.endsWith('.jar') || e.name.endsWith(`.jar${DISABLED}`)))
      .map((e) => {
        const enabled = !e.name.endsWith(DISABLED)
        const base = enabled ? e.name : e.name.slice(0, -DISABLED.length)
        const m = idx[base]
        return { file: base, enabled, size: statSync(join(dir, e.name)).size, source: m?.source ?? 'manual', projectId: m?.projectId, title: m?.title, iconUrl: m?.iconUrl, version: m?.version }
      })
      .sort((a, b) => (a.title ?? a.file).localeCompare(b.title ?? b.file))
  }

  private diskName(dir: string, file: string): { path: string; enabled: boolean } {
    const name = sanitizeFilename(file)
    const on = safeJoin(dir, name)
    if (existsSync(on)) return { path: on, enabled: true }
    const off = `${on}${DISABLED}`
    if (existsSync(off)) return { path: off, enabled: false }
    throw new Error('Datei nicht gefunden.')
  }

  toggle(id: string, file: string, enabled: boolean): void {
    const { dir } = this.ext(id)
    const cur = this.diskName(dir, file)
    if (cur.enabled === enabled) return
    renameSync(cur.path, enabled ? cur.path.slice(0, -DISABLED.length) : `${cur.path}${DISABLED}`)
  }

  remove(id: string, file: string): void {
    const { dir } = this.ext(id)
    rmSync(this.diskName(dir, file).path, { force: true })
    const idx = this.readIndex(id)
    delete idx.files[sanitizeFilename(file)]
    this.writeIndex(id, idx)
  }

  // ---------- Installation ----------
  private async fetchTo(dir: string, fileName: string, url: string, hashes: { sha1?: string; sha256?: string; sha512?: string }): Promise<string> {
    const name = sanitizeFilename(fileName)
    await this.dl({ url, dest: safeJoin(dir, name), ...hashes, fetchImpl: this.d.fetchImpl })
    return name
  }

  async install(id: string, source: ModSource, projectId: string): Promise<ModInstallResult> {
    const { dir, rec } = this.ext(id)
    const res: ModInstallResult = { installed: [], warnings: [] }
    const idx = this.readIndex(id)
    const note = (title: string, file: string, meta: Meta) => { idx.files[file] = meta; res.installed.push({ title, file }) }
    try {
      if (source === 'modrinth') await this.installModrinth(dir, rec, projectId, idx, res, note, new Set())
      else if (source === 'hangar') await this.installHangar(dir, rec, projectId, res, note)
      else await this.installCurse(dir, rec, projectId, idx, res, note, new Set())
    } finally {
      this.writeIndex(id, idx)
    }
    return res
  }

  private async installModrinth(dir: string, rec: ServerRecord, projectId: string, idx: Index, res: ModInstallResult, note: (t: string, f: string, m: Meta) => void, seen: Set<string>, isDep = false): Promise<void> {
    if (seen.has(projectId)) return
    seen.add(projectId)
    if (Object.values(idx.files).some((m) => m.source === 'modrinth' && m.projectId === projectId)) return
    const loaders = modrinthLoaders(rec.loader)
    const ver = await compatibleVersion(projectId, loaders, rec.mcVersion, this.d.fetchImpl)
    if (!ver) {
      if (isDep) return void res.warnings.push(`Eine benötigte Abhängigkeit (${projectId}) ist nicht für ${rec.mcVersion} verfügbar.`)
      throw new Error(`Keine Version für ${rec.loader} ${rec.mcVersion} gefunden.`)
    }
    for (const dep of ver.dependencies) {
      let pid = dep.project_id ?? undefined
      if (!pid && dep.version_id) pid = (await getVersion(dep.version_id, this.d.fetchImpl)).project_id
      if (!pid) continue
      if (dep.dependency_type === 'incompatible' && Object.values(idx.files).some((m) => m.projectId === pid)) res.warnings.push(`${ver.name} ist nicht mit einem installierten Mod kompatibel (${pid}).`)
      else if (dep.dependency_type === 'required') await this.installModrinth(dir, rec, pid, idx, res, note, seen, true)
      else if (dep.dependency_type === 'optional') res.warnings.push(`Optionale Ergänzung verfügbar: ${pid}`)
    }
    const f = primaryFile(ver)
    if (!f) throw new Error('Die Version enthält keine Datei.')
    const name = await this.fetchTo(dir, f.filename, f.url, { sha512: f.hashes.sha512 })
    const info = await getProjectInfo(projectId, this.d.fetchImpl).catch(() => null)
    note(info?.title ?? ver.name, name, { source: 'modrinth', projectId, versionId: ver.id, title: info?.title ?? ver.name, iconUrl: info?.iconUrl, version: ver.version_number, sha1: f.hashes.sha1 })
  }

  private async installHangar(dir: string, rec: ServerRecord, projectId: string, res: ModInstallResult, note: (t: string, f: string, m: Meta) => void): Promise<void> {
    const platform = hangarPlatform(rec.loader)
    if (!platform) throw new Error('Hangar unterstützt diesen Server-Typ nicht.')
    const [owner, slug] = projectId.split('/')
    if (!owner || !slug) throw new Error('Ungültige Hangar-Projekt-ID.')
    const f = await resolveHangar(owner, slug, platform, rec.mcVersion, this.d.fetchImpl)
    if (!f) throw new Error(`Keine Version für ${rec.mcVersion} gefunden.`)
    const name = await this.fetchTo(dir, f.fileName, f.url, { sha256: f.sha256 })
    for (const dep of f.requiredPlugins) res.warnings.push(`Benötigt zusätzlich das Plugin „${dep}“. Installiere es separat.`)
    note(slug, name, { source: 'hangar', projectId, title: slug, version: f.version })
  }

  private async installCurse(dir: string, rec: ServerRecord, modId: string, idx: Index, res: ModInstallResult, note: (t: string, f: string, m: Meta) => void, seen: Set<string>, isDep = false): Promise<void> {
    const key = this.d.curseKey()
    if (!key) throw new Error('Für CurseForge ist ein API-Key nötig.')
    if (seen.has(modId)) return
    seen.add(modId)
    if (Object.values(idx.files).some((m) => m.source === 'curseforge' && m.projectId === modId)) return
    const file = await cfLatestFile(key, modId, rec.mcVersion, rec.loader, this.d.fetchImpl)
    if (!file) {
      if (isDep) return void res.warnings.push(`Eine Abhängigkeit (${modId}) ist nicht für ${rec.mcVersion} verfügbar.`)
      throw new Error(`Keine Datei für ${rec.loader} ${rec.mcVersion} gefunden.`)
    }
    if (!file.downloadUrl) throw new Error('Der Autor erlaubt keinen Download außerhalb von CurseForge. Lade die Datei dort manuell herunter und ziehe sie ins Fenster.')
    for (const dep of file.dependencies) if (dep.relationType === 3) await this.installCurse(dir, rec, String(dep.modId), idx, res, note, seen, true)
    const name = await this.fetchTo(dir, file.fileName, file.downloadUrl, { sha1: cfSha1(file) })
    const info = await cfModInfo(key, modId, this.d.fetchImpl).catch(() => null)
    note(info?.title ?? file.displayName, name, { source: 'curseforge', projectId: modId, versionId: String(file.id), title: info?.title ?? file.displayName, iconUrl: info?.iconUrl, version: file.displayName, sha1: cfSha1(file) })
  }

  /** Dateien per Drag & Drop. Passt die Datei nicht zum Server, wird sie NICHT installiert, sondern gemeldet (außer mit `force`). */
  async addFiles(id: string, paths: string[], force = false): Promise<ModInstallResult> {
    const { dir, rec } = this.ext(id)
    const res: ModInstallResult = { installed: [], warnings: [] }
    const idx = this.readIndex(id)
    const limit = this.d.maxFileBytes ?? 512 * 1024 * 1024
    for (const p of paths) {
      let name: string
      try {
        name = sanitizeFilename(basename(p))
      } catch (e) {
        res.warnings.push(`${basename(p)}: ${(e as Error).message}`)
        continue
      }
      const st = statSync(p)
      if (!st.isFile() || st.size > limit) { res.warnings.push(`${name}: Datei ist zu groß oder keine Datei.`); continue }
      try {
        const info = await inspectJar(p)
        if (!isCompatible(rec.loader, info) && !force) {
          res.warnings.push(`${name} ist für ${info.kinds.join('/')} gebaut, dein Server nutzt ${LOADER_INFO[rec.loader].label}. Nicht installiert.`)
          continue
        }
        if (info.kinds.includes('unknown')) res.warnings.push(`${name}: Der Typ konnte nicht erkannt werden. Prüfe, ob die Datei zu deinem Server passt.`)
      } catch {
        res.warnings.push(`${name}: Keine gültige JAR-Datei.`)
        continue
      }
      const dest = safeJoin(dir, name)
      if (existsSync(dest) || existsSync(`${dest}${DISABLED}`)) { res.warnings.push(`${name} existiert bereits.`); continue }
      copyFileSync(p, dest)
      idx.files[name] = { source: 'manual', title: name.replace(/\.jar$/i, ''), sha1: createHash('sha1').update(readFileSync(dest)).digest('hex') }
      res.installed.push({ title: name, file: name })
    }
    this.writeIndex(id, idx)
    return res
  }

  // ---------- Updates ----------
  async checkUpdates(id: string): Promise<ModUpdate[]> {
    const { rec } = this.ext(id)
    const idx = this.readIndex(id).files
    const tracked = Object.entries(idx).filter(([, m]) => m.source === 'modrinth' && m.sha1)
    const latest = await latestByHash(tracked.map(([, m]) => m.sha1!), modrinthLoaders(rec.loader), rec.mcVersion, this.d.fetchImpl)
    const out: ModUpdate[] = []
    for (const [file, m] of tracked) {
      const v = latest[m.sha1!]
      if (v && v.id !== m.versionId) out.push({ file, title: m.title ?? file, from: m.version ?? '?', to: v.version_number })
    }
    return out
  }

  async update(id: string, file: string): Promise<void> {
    const { dir, rec } = this.ext(id)
    const idx = this.readIndex(id)
    const key = sanitizeFilename(file)
    const m = idx.files[key]
    if (m?.source !== 'modrinth' || !m.projectId) throw new Error('Für diese Datei sind keine automatischen Updates möglich.')
    const ver: ModrinthVersion | null = await compatibleVersion(m.projectId, modrinthLoaders(rec.loader), rec.mcVersion, this.d.fetchImpl)
    const f = ver && primaryFile(ver)
    if (!ver || !f) throw new Error('Keine neuere Version gefunden.')
    const old = this.diskName(dir, key)
    const newName = await this.fetchTo(dir, f.filename, f.url, { sha512: f.hashes.sha512 })
    if (newName !== key || !old.enabled) {
      if (newName !== key) rmSync(old.path, { force: true })
      if (!old.enabled) renameSync(safeJoin(dir, newName), `${safeJoin(dir, newName)}${DISABLED}`)
    }
    delete idx.files[key]
    idx.files[newName] = { ...m, versionId: ver.id, version: ver.version_number, sha1: f.hashes.sha1 }
    this.writeIndex(id, idx)
  }
}

export type { ModHit }
