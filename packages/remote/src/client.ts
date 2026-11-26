import type { CommandName, Role } from '@trm/core'
import { authorizeRemote } from './guard'
import { classifyError, InboundSchema, MIN_PROTOCOL_VERSION, PROTOCOL_VERSION, type ServerSummary } from './protocol'
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
export type Transport = 'websocket' | 'polling'

export interface RemoteState {
  connected: boolean
  transport: Transport
  error?: string
  sessions: { id: string; name: string; role: Role; since: number }[]
  siteName?: string
}

export interface ClientDeps {
  config: () => ClientConfig
  token: () => string | null
  create: (url: string, token: string) => SocketLike
  /** HTTPS-Long-Polling als Fallback. */
  createPoll: (url: string, token: string) => SocketLike
  exec: (command: CommandName, args: unknown) => Promise<unknown>
  known: (c: string) => c is CommandName
  hello: () => Record<string, unknown>
  snapshot: () => ServerSummary[]
  uploads: Pick<UploadManager, 'begin' | 'chunk' | 'end' | 'cancel' | 'fetch'>
  onState: (s: RemoteState) => void
  random?: () => number
  now?: () => number
  log?: (msg: string) => void
}

const MAX_MESSAGE = 8 * 1024 * 1024
export const HEARTBEAT_MS = 30_000
const DEAD_AFTER_MS = 90_000
export const SNAPSHOT_MS = 15_000
/** Nach so vielen WebSocket-Versuchen ohne Verbindung wird auf Polling umgeschaltet. */
export const WS_FAILS_BEFORE_POLLING = 3
/** Im Polling-Betrieb wird nach dieser Zeit wieder ein WebSocket versucht. */
export const RETRY_WS_AFTER_MS = 5 * 60_000
const FATAL_CLOSE = new Set([4401, 4403])
/** Ereignisse, die ohne Abo immer gesendet werden. */
const DEFAULT_EVENTS = new Set(['servers.event'])

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Welche Server-ID gehört zu einem Ereignis? (für den Abo-Filter) */
export function eventServerId(_event: string, payload: unknown): string | null {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object' && 'id' in payload && typeof (payload as { id: unknown }).id === 'string') return (payload as { id: string }).id
  return null
}

export class RemoteClient {
  private ws: SocketLike | null = null
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private beat: ReturnType<typeof setInterval> | null = null
  private snap: ReturnType<typeof setInterval> | null = null
  private flush: ReturnType<typeof setTimeout> | null = null
  private lastSeen = 0
  private state: RemoteState = { connected: false, transport: 'websocket', sessions: [] }
  private sub = { events: new Set<string>(), serverIds: null as Set<string> | null }
  private logBuf = new Map<string, string[]>()
  private fatal = false
  private wsFails = 0
  private pollUntil = 0

  constructor(private readonly d: ClientDeps) {}

  private now() { return (this.d.now ?? Date.now)() }
  private set(p: Partial<RemoteState>) { this.state = { ...this.state, ...p }; this.d.onState(this.state) }
  get connected() { return this.state.connected }
  get transport() { return this.state.transport }

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
    for (const t of [this.retry, this.flush]) if (t) clearTimeout(t)
    for (const t of [this.beat, this.snap]) if (t) clearInterval(t)
    this.retry = this.beat = this.snap = this.flush = null
    const ws = this.ws
    this.ws = null
    try { ws?.close() } catch { /* ignore */ }
    this.sub = { events: new Set(), serverIds: null }
    if (report) this.set({ connected: false, sessions: [] })
  }

  private connect(url: string, token: string) {
    const polling = this.now() < this.pollUntil
    let ws: SocketLike
    try { validateRemoteUrl(url); ws = polling ? this.d.createPoll(url, token) : this.d.create(url, token) } catch (e) { return this.set({ connected: false, error: msg(e) }) }
    this.ws = ws
    let opened = false
    ws.on('open', () => {
      opened = true
      this.attempt = 0
      if (!polling) this.wsFails = 0
      this.lastSeen = this.now()
      this.set({ connected: true, error: undefined, transport: polling ? 'polling' : 'websocket' })
      this.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION, minProtocolVersion: MIN_PROTOCOL_VERSION, transport: this.state.transport, ...this.d.hello() })
      this.sendSnapshot()
      this.beat = setInterval(() => {
        if (this.now() - this.lastSeen > DEAD_AFTER_MS) { this.d.log?.('Verbindung tot, wird neu aufgebaut.'); try { (ws.terminate ?? ws.close).call(ws) } catch { /* ignore */ } return }
        try { ws.ping?.() } catch { /* ignore */ }
      }, HEARTBEAT_MS)
      this.snap = setInterval(() => this.sendSnapshot(), SNAPSHOT_MS)
    })
    ws.on('pong', () => { this.lastSeen = this.now() })
    ws.on('message', (raw: unknown) => { this.lastSeen = this.now(); void this.onMessage(raw) })
    ws.on('error', (e: unknown) => this.d.log?.(`Verbindungsfehler: ${msg(e)}`))
    ws.on('close', (code?: number) => {
      if (this.ws !== ws) return // veralteter Socket
      this.ws = null
      for (const t of [this.beat, this.snap]) if (t) clearInterval(t)
      this.beat = this.snap = null
      this.set({ connected: false, sessions: [] })
      if (code !== undefined && FATAL_CLOSE.has(code)) {
        this.fatal = true
        return this.set({ error: 'Die Webseite hat das Gerät abgelehnt. Koppel es bitte neu.' })
      }
      // WebSocket kommt nicht zustande (blockiert?): nach mehreren Versuchen auf Polling umschalten.
      if (!polling && !opened && ++this.wsFails >= WS_FAILS_BEFORE_POLLING) {
        this.wsFails = 0
        this.pollUntil = this.now() + RETRY_WS_AFTER_MS
        this.d.log?.('WebSocket nicht erreichbar, wechsle auf HTTPS-Polling.')
        this.attempt = 0
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

  /** Regelmäßiger Überblick über alle Server (Status, Spieler, RAM/CPU/TPS), damit die Webseite alles live zeigen kann. */
  sendSnapshot(): void {
    if (!this.state.connected) return
    this.send({ type: 'snapshot', at: this.now(), servers: this.d.snapshot() })
  }

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
      case 'welcome': {
        // Ist die Webseite neuer als diese App versteht, oder verlangt sie eine neuere App: nicht weitermachen.
        if ((m.minProtocolVersion ?? 0) > PROTOCOL_VERSION || m.protocolVersion < MIN_PROTOCOL_VERSION) {
          this.fatal = true
          this.set({ error: 'App und Webseite sprechen unterschiedliche Protokollversionen. Bitte TRM-Craft aktualisieren.' })
          return void this.ws?.close()
        }
        return this.set({ siteName: m.siteName ?? this.state.siteName })
      }
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
          this.send({ type: 'res', id: m.id, ok: false, error: msg(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), code: classifyError(e) })
        }
      }
    }
  }

  /** Leitet App-Ereignisse an die Webseite weiter (abonnierte, dazu immer `servers.event`). Log-Zeilen werden gebündelt. */
  forward(event: string, payload: unknown): void {
    if (!this.state.connected) return
    if (!DEFAULT_EVENTS.has(event) && !this.sub.events.has(event)) return
    const sid = eventServerId(event, payload)
    if (this.sub.serverIds && sid && !this.sub.serverIds.has(sid) && !DEFAULT_EVENTS.has(event)) return
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
