import { createHash } from 'node:crypto'
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { downloadFile, allowHost } from '@trm/servers'
import type { UploadRecord } from '@trm/core'
import { UPLOAD_EXTENSIONS } from './protocol'
import { placeUpload, undoUpload, type PlaceHost, type Undo } from './place'

export interface UploadServer extends PlaceHost {
  name: string
  restart: (warnSeconds: number) => Promise<void>
}

export interface UploadDeps {
  dir: string
  limitBytes: () => number
  canUpload: () => boolean
  server: (id: string) => UploadServer | null
  /** Host der konfigurierten Webseite. Nur von dort darf die App Dateien selbst abholen. */
  siteHost: () => string | null
  send: (msg: Record<string, unknown>) => void
  emit: (r: UploadRecord) => void
  restore: (serverId: string, file: string) => Promise<void>
  download?: typeof downloadFile
  fetchImpl?: typeof fetch
  now?: () => number
}

interface State { id: string; serverId: string; fileName: string; size: number; sha256: string; restartAfter: boolean; uploader: string; received: number; part: string; lastEmit: number }
interface Stored { rec: UploadRecord; undo?: Undo }

const MAX_HISTORY = 200
const sha256File = (p: string) => new Promise<string>((res, rej) => { const h = createHash('sha256'); createReadStream(p).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej) })

export class UploadManager {
  private states = new Map<string, State>()
  private items: Stored[] = []
  private readonly partsDir: string
  private readonly histFile: string

  constructor(private readonly d: UploadDeps) {
    this.partsDir = join(d.dir, 'parts')
    this.histFile = join(d.dir, 'uploads.json')
    mkdirSync(this.partsDir, { recursive: true })
    try { this.items = (JSON.parse(readFileSync(this.histFile, 'utf8')) as { items: Stored[] }).items ?? [] } catch { this.items = [] }
    // Nicht beendete Uploads aus einer früheren Sitzung gelten als Teil-Übertragung (Fortsetzen möglich).
    for (const it of this.items) if (it.rec.status === 'receiving') it.rec.status = 'failed', (it.rec.error = 'Unterbrochen. Wird bei erneuter Verbindung fortgesetzt.')
  }

  private now() { return (this.d.now ?? Date.now)() }
  private save() { writeFileSync(this.histFile, JSON.stringify({ items: this.items.slice(0, MAX_HISTORY) })) }
  history(): UploadRecord[] { return this.items.map((i) => i.rec) }

  private upsert(rec: UploadRecord, undo?: Undo) {
    const i = this.items.findIndex((x) => x.rec.id === rec.id)
    const stored: Stored = { rec, undo: undo ?? (i >= 0 ? this.items[i]!.undo : undefined) }
    if (i >= 0) this.items[i] = stored
    else this.items.unshift(stored)
    this.save()
    this.d.emit(rec)
  }

  private record(s: State, patch: Partial<UploadRecord>, undo?: Undo, serverName = ''): void {
    const prev = this.items.find((x) => x.rec.id === s.id)?.rec
    this.upsert({ id: s.id, time: prev?.time ?? this.now(), uploader: s.uploader, serverId: s.serverId, serverName: serverName || prev?.serverName || s.serverId, fileName: s.fileName, kind: prev?.kind ?? '', size: s.size, status: 'receiving', warnings: [], undoable: false, ...prev, ...patch }, undo)
  }

  private fail(s: State, msg: string, serverName = ''): void {
    rmSync(s.part, { force: true })
    this.states.delete(s.id)
    this.record(s, { status: 'failed', error: msg, undoable: false }, undefined, serverName)
    this.d.send({ type: 'upload.failed', uploadId: s.id, error: msg })
  }

  /** Prüft Anfrage und bereitet den Empfang vor. Antwortet mit `upload.ready` oder `upload.failed`. */
  begin(m: { uploadId: string; serverId: string; fileName: string; size: number; sha256: string; restartAfter?: boolean; uploader?: string }): void {
    const fileName = basename(m.fileName.replace(/\\/g, '/'))
    const s: State = { id: m.uploadId, serverId: m.serverId, fileName, size: m.size, sha256: m.sha256.toLowerCase(), restartAfter: !!m.restartAfter, uploader: m.uploader ?? 'unbekannt', received: 0, part: join(this.partsDir, `${m.uploadId}.part`), lastEmit: 0 }
    const srv = this.d.server(m.serverId)
    const reject = (msg: string) => this.fail(s, msg, srv?.name)
    if (!this.d.canUpload()) return reject('Dieses Gerät hat kein Upload-Recht.')
    if (!srv) return reject('Server nicht gefunden.')
    if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(extname(fileName).toLowerCase())) return reject(`Dateityp nicht erlaubt: ${extname(fileName) || fileName}`)
    if (m.size > this.d.limitBytes()) return reject(`Die Datei ist größer als das Limit von ${Math.round(this.d.limitBytes() / 1048576)} MB.`)
    // Fortsetzen: gleiche ID, Größe und Prüfsumme und eine vorhandene Teil-Datei
    const meta = `${s.part}.json`
    let resumed = 0
    if (existsSync(s.part) && existsSync(meta)) {
      try { const k = JSON.parse(readFileSync(meta, 'utf8')) as { size: number; sha256: string }; if (k.size === s.size && k.sha256 === s.sha256) resumed = Math.min(statSync(s.part).size, s.size) } catch { /* neu starten */ }
    }
    if (!resumed) { rmSync(s.part, { force: true }); writeFileSync(s.part, '') }
    writeFileSync(meta, JSON.stringify({ size: s.size, sha256: s.sha256 }))
    s.received = resumed
    this.states.set(s.id, s)
    this.record(s, { status: 'receiving', received: resumed, error: undefined, warnings: [] }, undefined, srv.name)
    this.d.send({ type: 'upload.ready', uploadId: s.id, received: resumed })
  }

  chunk(m: { uploadId: string; offset: number; data: string }): void {
    const s = this.states.get(m.uploadId)
    if (!s) return this.d.send({ type: 'upload.failed', uploadId: m.uploadId, error: 'Unbekannter Upload.' })
    // Bei Versatz: aktuellen Stand melden, die Webseite sendet ab dort erneut.
    if (m.offset !== s.received) return this.d.send({ type: 'upload.ack', uploadId: s.id, received: s.received })
    const buf = Buffer.from(m.data, 'base64')
    if (!buf.length || s.received + buf.length > s.size) return this.fail(s, 'Ungültige Datenmenge.')
    const fd = openSync(s.part, 'r+')
    try { writeSync(fd, buf, 0, buf.length, s.received) } finally { closeSync(fd) }
    s.received += buf.length
    const t = this.now()
    if (t - s.lastEmit > 250 || s.received === s.size) { s.lastEmit = t; this.record(s, { received: s.received }) }
    this.d.send({ type: 'upload.ack', uploadId: s.id, received: s.received })
  }

  async end(m: { uploadId: string }): Promise<void> {
    const s = this.states.get(m.uploadId)
    if (!s) return this.d.send({ type: 'upload.failed', uploadId: m.uploadId, error: 'Unbekannter Upload.' })
    if (s.received !== s.size) return this.d.send({ type: 'upload.ack', uploadId: s.id, received: s.received })
    await this.finish(s)
  }

  cancel(id: string): void {
    const s = this.states.get(id)
    if (s) this.fail(s, 'Abgebrochen.')
  }

  /** Alternative für große Dateien: Die App lädt die Datei selbst von der Webseite (nur von deren Host). */
  async fetch(m: { uploadId: string; serverId: string; fileName: string; size: number; sha256: string; url: string; restartAfter?: boolean; uploader?: string }): Promise<void> {
    this.begin({ ...m })
    const s = this.states.get(m.uploadId)
    if (!s) return
    try {
      const u = new URL(m.url)
      const site = this.d.siteHost()
      if (u.protocol !== 'https:' || !site || u.hostname !== site) throw new Error('Downloads sind nur von der verbundenen Webseite erlaubt.')
      allowHost(u.host)
      rmSync(s.part, { force: true })
      await (this.d.download ?? downloadFile)({ url: m.url, dest: s.part, sha256: s.sha256, fetchImpl: this.d.fetchImpl })
      if (statSync(s.part).size !== s.size) throw new Error('Die Dateigröße stimmt nicht.')
      s.received = s.size
    } catch (e) {
      return this.fail(s, (e as Error).message)
    }
    await this.finish(s, true)
  }

  private async finish(s: State, verified = false): Promise<void> {
    const srv = this.d.server(s.serverId)
    if (!srv) return this.fail(s, 'Server nicht gefunden.')
    try {
      if (!verified && (await sha256File(s.part)) !== s.sha256) throw new Error('Die Prüfsumme stimmt nicht überein. Die Datei wurde nicht installiert.')
      const placed = await placeUpload(srv, s.part, s.fileName)
      rmSync(s.part, { force: true })
      rmSync(`${s.part}.json`, { force: true })
      this.states.delete(s.id)
      const warnings = [...placed.warnings]
      if (s.restartAfter) {
        if (srv.running) { await srv.restart(30).catch((e: Error) => warnings.push(`Neustart fehlgeschlagen: ${e.message}`)); warnings.push('Server wurde neu gestartet.') }
        else warnings.push('Der Server lief nicht, daher kein Neustart.')
      }
      this.record(s, { status: 'done', kind: placed.kind, warnings, error: undefined, undoable: true, received: s.size }, placed.undo, srv.name)
      this.d.send({ type: 'upload.done', uploadId: s.id, kind: placed.kind, warnings })
    } catch (e) {
      this.fail(s, (e as Error).message, srv.name)
    }
  }

  async undo(id: string): Promise<void> {
    const it = this.items.find((x) => x.rec.id === id)
    if (!it || it.rec.status !== 'done' || !it.undo) throw new Error('Dieser Upload kann nicht rückgängig gemacht werden.')
    const srv = this.d.server(it.rec.serverId)
    if (!srv) throw new Error('Der Server existiert nicht mehr.')
    if (srv.running && (it.undo.type === 'backup' || it.rec.kind === 'world')) throw new Error('Stoppe den Server, um diesen Upload rückgängig zu machen.')
    await undoUpload(srv.dir, it.undo, (f) => this.d.restore(it.rec.serverId, f))
    this.upsert({ ...it.rec, status: 'undone', undoable: false })
  }
}
