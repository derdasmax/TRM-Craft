import type { CommandName, Role } from '@trm/core'
import { authorizeRemote } from './guard'
import { InboundSchema, PROTOCOL_VERSION } from './protocol'
import { validateRemoteUrl } from './pairing'
import type { UploadManager } from './uploads'

export interface SocketLike {
  send(data: string): void
  close(): void
  terminate?(): void
  ping?(): void
  on(event: 'open' | 'message' | 'close' | 'error' | 'pong', cb: (...a: any[]) => void): void
}

export interface ClientConfig { enabled: boolean; url: string; maxRole: Role }

export interface RemoteState { connected: boolean; error?: string; sessions: { id: string; name: string; role: Role; since: number }[] }

export interface ClientDeps {
  config: () => ClientConfig
  token: () => string | null
  create: (url: string, token: string) => SocketLike
  exec: (command: CommandName, args: unknown) => Promise<unknown>
  known: (c: string) => c is CommandName
  hello: () => Record<string, unknown>
  uploads: Pick<UploadManager, 'begin' | 'chunk' | 'end' | 'cancel' | 'fetch'>
  onState: (s: RemoteState) => void
  random?: () => number
  log?: (msg: string) => void
}

const MAX_MESSAGE = 8 * 1024 * 1024
const HEARTBEAT_MS = 25_000
const DEAD_AFTER_MS = 70_000
const FATAL_CLOSE = new Set([4401, 4403])

/** Zerlegt einen Fehler in eine für Menschen lesbare Meldung. */
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Welche Server-ID gehört zu einem Ereignis? (für den Abo-Filter) */
export function eventServerId(event: string, payload: unknown): string | null {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object' && 'id' in payload && typeof (payload as { id: unknown }).id === 'string') return (payload as { id: string }).id
  return event === 'servers.progress' ? null : null
}

export class RemoteClient {
  private ws: SocketLike | null = null
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private beat: ReturnType<typeof setInterval> | null = null
  private flush: ReturnType<typeof setTimeout> | null = null
  private lastSeen = 0
  private state: RemoteState = { connected: false, sessions: [] }
  private sub = { events: new Set<string>(), serverIds: null as Set<string> | null }
  private logBuf = new Map<string, string[]>()
  private fatal = false

  constructor(private readonly d: ClientDeps) {}

  private set(p: Partial<RemoteState>) { this.state = { ...this.state, ...p }; this.d.onState(this.state) }
  get connected() { return this.state.connected }

  /** (Neu) starten, z. B. nach Änderung der Einstellungen oder Kopplung. */
  start(): void {
    this.stop(false)
    this.fatal = false
    const c = this.d.config()
    const token = this.d.token()
    if (!c.enabled || !c.url || !token) return this.set({ connected: false, error: undefined })
    this.connect(c.url, token)
  }

  stop(report = true): void {
    if (this.retry) clearTimeout(this.retry)
    if (this.beat) clearInterval(this.beat)
    if (this.flush) clearTimeout(this.flush)
    this.retry = this.beat = this.flush = null
    const ws = this.ws
    this.ws = null
    try { ws?.close() } catch { /* ignore */ }
    this.sub = { events: new Set(), serverIds: null }
    if (report) this.set({ connected: false, sessions: [] })
  }

  private connect(url: string, token: string) {
    let ws: SocketLike
    try { validateRemoteUrl(url); ws = this.d.create(url, token) } catch (e) { return this.set({ connected: false, error: msg(e) }) }
    this.ws = ws
    ws.on('open', () => {
      this.attempt = 0
      this.lastSeen = Date.now()
      this.set({ connected: true, error: undefined })
      this.send({ type: 'hello', protocol: PROTOCOL_VERSION, ...this.d.hello() })
      this.beat = setInterval(() => {
        if (Date.now() - this.lastSeen > DEAD_AFTER_MS) { this.d.log?.('Verbindung tot, wird neu aufgebaut.'); try { (ws.terminate ?? ws.close).call(ws) } catch { /* ignore */ } return }
        try { ws.ping?.() } catch { /* ignore */ }
      }, HEARTBEAT_MS)
    })
    ws.on('pong', () => { this.lastSeen = Date.now() })
    ws.on('message', (raw: unknown) => { this.lastSeen = Date.now(); void this.onMessage(raw) })
    ws.on('error', (e: unknown) => this.d.log?.(`Verbindungsfehler: ${msg(e)}`))
    ws.on('close', (code?: number) => {
      if (this.ws !== ws) return // veralteter Socket
      this.ws = null
      if (this.beat) clearInterval(this.beat)
      this.beat = null
      this.set({ connected: false, sessions: [] })
      if (code !== undefined && FATAL_CLOSE.has(code)) {
        this.fatal = true
        return this.set({ error: 'Die Webseite hat das Gerät abgelehnt. Koppel es bitte neu.' })
      }
      this.scheduleRetry()
    })
  }

  private scheduleRetry() {
    const c = this.d.config()
    if (this.fatal || !c.enabled) return
    const base = Math.min(60_000, 1000 * 2 ** this.attempt++)
    const delay = Math.round(base * (0.5 + (this.d.random ?? Math.random)() / 2))
    this.retry = setTimeout(() => this.start(), delay)
  }

  private send(m: Record<string, unknown>) {
    try { this.ws?.send(JSON.stringify(m)) } catch (e) { this.d.log?.(`Senden fehlgeschlagen: ${msg(e)}`) }
  }

  /** Für Upload-Antworten (vom UploadManager). */
  reply = (m: Record<string, unknown>) => this.send(m)

  private async onMessage(raw: unknown) {
    const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
    if (text.length > MAX_MESSAGE) return this.d.log?.('Nachricht zu groß, ignoriert.')
    let json: unknown
    try { json = JSON.parse(text) } catch { return }
    const parsed = InboundSchema.safeParse(json)
    if (!parsed.success) return this.d.log?.('Ungültige Nachricht, ignoriert.')
    const m = parsed.data
    switch (m.type) {
      case 'ping': return this.send({ type: 'pong' })
      case 'subscribe': this.sub = { events: new Set(m.events), serverIds: m.serverIds ? new Set(m.serverIds) : null }; return
      case 'sessions': return this.set({ sessions: m.list })
      case 'upload.begin': return this.d.uploads.begin(m)
      case 'upload.chunk': return this.d.uploads.chunk(m)
      case 'upload.end': return void (await this.d.uploads.end(m))
      case 'upload.cancel': return this.d.uploads.cancel(m.uploadId)
      case 'upload.fetch': return void (await this.d.uploads.fetch(m))
      case 'cmd': {
        try {
          authorizeRemote(m.command, m.args, m.role, { ...this.d.config() }, this.d.known)
          const result = await this.d.exec(m.command as CommandName, m.args)
          this.send({ type: 'res', id: m.id, ok: true, result: result ?? null })
        } catch (e) {
          this.send({ type: 'res', id: m.id, ok: false, error: msg(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
        }
      }
    }
  }

  /** Leitet App-Ereignisse an die Webseite weiter, soweit sie abonniert wurden. Log-Zeilen werden gebündelt. */
  forward(event: string, payload: unknown): void {
    if (!this.state.connected || !this.sub.events.has(event)) return
    const sid = eventServerId(event, payload)
    if (this.sub.serverIds && sid && !this.sub.serverIds.has(sid)) return
    if (event === 'servers.log') {
      const { id, line } = payload as { id: string; line: string }
      const buf = this.logBuf.get(id) ?? []
      if (buf.length < 500) buf.push(line)
      this.logBuf.set(id, buf)
      if (!this.flush) this.flush = setTimeout(() => {
        this.flush = null
        for (const [sid2, lines] of this.logBuf) this.send({ type: 'event', event: 'servers.log', payload: { id: sid2, lines } })
        this.logBuf.clear()
      }, 250)
      return
    }
    this.send({ type: 'event', event, payload })
  }
}
