import { createHash, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { CommandName, Role } from '@trm/core'
import { authorizeRemote } from './guard'
import { DeviceStore, minRole, PairingCodes, SessionStore, type Device, type Session } from './devices'
import {
  API_BASE, CHUNK_SIZE, classifyError, CmdRequestSchema, ERROR_CODES, HTTP_STATUS, MAX_CHUNK, MIN_PROTOCOL_VERSION, PairRequestSchema, PROTOCOL_VERSION, RemoteError,
  SessionRequestSchema, UploadBeginRequestSchema, WsInboundSchema, type ErrorCode, type ServerSummary,
} from './protocol'
import type { UploadManager } from './uploads'

export interface ServerConfig {
  enabled: boolean
  mode: 'tunnel' | 'direct'
  port: number
  allowedOrigins: string[]
  publicHost: string
  tls?: { cert: string | Buffer; key: string | Buffer }
  maxRole: Extract<Role, 'viewer' | 'moderator' | 'admin'>
}

export interface ServerDeps {
  config: () => ServerConfig
  exec: (command: CommandName, args: unknown) => Promise<unknown>
  known: (c: string) => c is CommandName
  summaries: () => ServerSummary[]
  uploads: Pick<UploadManager, 'begin' | 'chunk' | 'end' | 'cancel' | 'history'>
  devices: DeviceStore
  sessions: SessionStore
  pairing: PairingCodes
  info: () => { appVersion: string; deviceName: string; tunnel: boolean }
  onChange?: () => void
  log?: (m: string) => void
  now?: () => number
}

interface Conn { ws: WebSocket; session: Session; token: string; events: Set<string>; serverIds: Set<string> | null; logs: Map<string, string[]>; flush: ReturnType<typeof setTimeout> | null; alive: number }

const DEFAULT_EVENTS = new Set(['servers.event'])
const AUTH_TIMEOUT_MS = 5000
const HEARTBEAT_MS = 30_000
const DEAD_MS = 90_000
export const SNAPSHOT_MS = 15_000
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const sameToken = (a: string, b: string) => { const x = createHash('sha256').update(a).digest(); const y = createHash('sha256').update(b).digest(); return timingSafeEqual(x, y) }
void sameToken

/** Die App-eigene API (HTTPS-REST + WebSocket). Lauscht im Tunnel-Modus nur auf 127.0.0.1. */
export class RemoteServer {
  private app: FastifyInstance | null = null
  private wss: WebSocketServer | null = null
  private conns = new Set<Conn>()
  private timers: ReturnType<typeof setInterval>[] = []
  private captures = new Map<string, Record<string, unknown>[]>()
  private buckets = new Map<string, { n: number; reset: number }>()
  private port = 0

  constructor(private readonly d: ServerDeps) {}

  private now() { return (this.d.now ?? Date.now)() }
  get listening() { return !!this.app }
  get boundPort() { return this.port }

  // ---------- Prüfungen ----------
  private hostAllowed(host: string | undefined, c: ServerConfig): boolean {
    if (!host) return false
    const h = host.toLowerCase().replace(/:\d+$/, '')
    if (['127.0.0.1', 'localhost', '[::1]'].includes(h)) return true
    if (c.publicHost && h === c.publicHost.toLowerCase()) return true
    return c.mode === 'direct' && !c.publicHost // im Direktmodus ohne festen Host: jeder Host (Zertifikat schützt)
  }

  private originAllowed(origin: string | undefined, c: ServerConfig): boolean {
    return !origin || c.allowedOrigins.includes(origin)
  }

  /** Echte Client-IP: Hinter dem Tunnel kommt die Verbindung von 127.0.0.1, dann gilt `CF-Connecting-IP`. */
  private clientIp(req: { ip: string; headers: Record<string, string | string[] | undefined> }): string {
    const loop = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1'
    const cf = req.headers['cf-connecting-ip']
    return loop && typeof cf === 'string' && cf.length < 64 ? cf : req.ip
  }

  private limit(key: string, max: number): boolean {
    const t = this.now()
    const b = this.buckets.get(key)
    if (!b || b.reset <= t) { this.buckets.set(key, { n: 1, reset: t + 60_000 }); return true }
    return ++b.n <= max
  }

  private fail(reply: FastifyReply, code: ErrorCode, error: string, extra: Record<string, unknown> = {}) {
    return reply.code(HTTP_STATUS[code]).send({ ok: false, error, code, ...extra })
  }

  private bearer(req: FastifyRequest): string | null {
    const h = req.headers.authorization
    return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : null
  }

  private session(req: FastifyRequest, reply: FastifyReply): Session | null {
    const t = this.bearer(req)
    const s = t ? this.d.sessions.verify(t) : null
    if (!s) { this.fail(reply, 'unauthorized', 'Sitzung fehlt oder ist abgelaufen. Hole mit dem Geräte-Token eine neue.'); return null }
    if (!this.limit(`s:${s.id}`, 1500)) { this.fail(reply, 'rate_limited', 'Zu viele Anfragen.'); return null }
    return s
  }

  // ---------- Start/Stopp ----------
  async start(): Promise<{ port: number }> {
    const c = this.d.config()
    if (!c.enabled) throw new RemoteError('disabled', 'Fernzugriff ist ausgeschaltet.')
    if (this.app) await this.stop()
    const direct = c.mode === 'direct'
    if (direct && !c.tls) throw new Error('Für den Direktmodus ist ein Zertifikat nötig.')
    const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024, ...(direct && c.tls ? { https: { cert: c.tls.cert, key: c.tls.key } } : {}) } as never) as unknown as FastifyInstance
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_CHUNK }, (_r, body, done) => done(null, body))

    app.addHook('onRequest', async (req, reply) => {
      const cfg = this.d.config()
      reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
      if (!cfg.enabled) return this.fail(reply, 'disabled', 'Fernzugriff ist ausgeschaltet.')
      if (!this.hostAllowed(req.headers.host, cfg)) return this.fail(reply, 'host_not_allowed', 'Unerwarteter Host.')
      const origin = req.headers.origin
      if (!this.originAllowed(origin, cfg)) return this.fail(reply, 'origin_not_allowed', 'Diese Origin ist nicht freigegeben. Trage sie in der App unter Fernzugriff ein.')
      if (origin) reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin')
      if (req.method === 'OPTIONS') return reply.code(204).header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS').header('Access-Control-Allow-Headers', 'authorization,content-type').header('Access-Control-Max-Age', '600').send()
    })
    app.setNotFoundHandler((_r, reply) => this.fail(reply, 'not_found', 'Unbekannter Pfad.'))
    app.setErrorHandler((e, _r, reply) => {
      const err = e as { statusCode?: number; message?: string }
      if (err.statusCode === 413) return this.fail(reply, 'too_large', 'Die Anfrage ist zu groß.')
      if (err.statusCode && err.statusCode < 500) return this.fail(reply, 'invalid_args', 'Ungültige Anfrage.')
      this.d.log?.(`API-Fehler: ${msg(e)}`)
      return this.fail(reply, 'internal', 'Interner Fehler.')
    })

    this.routes(app)
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 })
    app.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head))

    await app.listen({ host: direct ? '0.0.0.0' : '127.0.0.1', port: c.port })
    this.app = app
    const addr = app.server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : c.port
    this.timers.push(setInterval(() => this.broadcastSnapshot(), SNAPSHOT_MS), setInterval(() => this.heartbeat(), HEARTBEAT_MS))
    this.d.onChange?.()
    return { port: this.port }
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    for (const c of this.conns) { try { c.ws.close(1001) } catch { /* ignore */ } }
    this.conns.clear()
    this.wss?.close()
    this.wss = null
    const app = this.app
    this.app = null
    this.port = 0
    await app?.close().catch(() => {})
    this.d.onChange?.()
  }

  // ---------- REST ----------
  private routes(app: FastifyInstance) {
    const base = API_BASE

    app.get(`${base}/info`, async () => ({ name: 'TRM-Craft', appVersion: this.d.info().appVersion, protocolVersion: PROTOCOL_VERSION, minProtocolVersion: MIN_PROTOCOL_VERSION, deviceName: this.d.info().deviceName, tunnel: this.d.info().tunnel }))

    // Kopplung Weg A: Die Webseite sendet den Code, den die App anzeigt.
    app.post(`${base}/pair`, async (req, reply) => {
      const ip = this.clientIp(req)
      if (!this.limit(`pair:${ip}`, 30)) return this.fail(reply, 'rate_limited', 'Zu viele Anfragen.')
      const body = PairRequestSchema.safeParse(req.body)
      if (!body.success) return this.fail(reply, 'invalid_args', 'Ungültige Anfrage.')
      const r = this.d.pairing.attempt(body.data.code, ip)
      if (r === 'limited') return this.fail(reply, 'rate_limited', 'Zu viele Fehlversuche. Warte einige Minuten.')
      if (!r) return this.fail(reply, 'unauthorized', 'Der Code ist falsch oder abgelaufen.')
      const cfg = this.d.config()
      const { device, token } = this.d.devices.add(body.data.siteName ?? 'Webseite', r.perms, cfg.maxRole, req.headers.origin)
      this.d.onChange?.()
      return { deviceToken: token, deviceId: device.id, deviceName: this.d.info().deviceName, perms: device.perms, maxRole: device.role }
    })

    // Mit dem Geräte-Token holt die Webseite (Backend) kurzlebige Sitzungs-Tokens für Browser.
    app.post(`${base}/sessions`, async (req, reply) => {
      const dev = this.deviceAuth(req, reply)
      if (!dev) return
      const body = SessionRequestSchema.safeParse(req.body)
      if (!body.success) return this.fail(reply, 'invalid_args', 'Ungültige Anfrage.')
      const { token, session } = this.d.sessions.mint(dev, body.data.user, body.data.role, this.d.config().maxRole, body.data.ttlSec)
      this.d.onChange?.()
      return { sessionToken: token, expiresAt: session.expiresAt, role: session.role, perms: session.perms }
    })

    app.get(`${base}/me`, async (req, reply) => {
      const t = this.bearer(req)
      const s = t ? this.d.sessions.verify(t) : null
      if (s) return { kind: 'session', role: s.role, perms: s.perms, user: s.user, expiresAt: s.expiresAt }
      const dev = this.deviceAuth(req, reply)
      if (dev) return { kind: 'device', role: minRole(dev.role, this.d.config().maxRole), perms: dev.perms }
    })

    app.delete(`${base}/sessions/current`, async (req, reply) => {
      const t = this.bearer(req)
      if (!t || !this.d.sessions.verify(t)) return this.fail(reply, 'unauthorized', 'Sitzung fehlt oder ist abgelaufen.')
      this.d.sessions.revoke(t)
      this.d.onChange?.()
      return { ok: true }
    })

    app.post(`${base}/cmd`, async (req, reply) => {
      const s = this.session(req, reply)
      if (!s) return
      const body = CmdRequestSchema.safeParse(req.body)
      if (!body.success) return this.fail(reply, 'invalid_args', 'Ungültige Anfrage.')
      try {
        const cfg = this.d.config()
        authorizeRemote(body.data.command, body.data.args, s.role, { enabled: cfg.enabled, maxRole: cfg.maxRole }, this.d.known)
        return { ok: true, result: (await this.d.exec(body.data.command as CommandName, body.data.args)) ?? null }
      } catch (e) {
        const code = classifyError(e)
        return this.fail(reply, code, msg(e))
      }
    })

    // ---- Uploads (rohe Chunks, Fortsetzen, SHA-256) ----
    const uploadAuth = (req: FastifyRequest, reply: FastifyReply) => {
      const s = this.session(req, reply)
      if (!s) return null
      if (!s.perms.upload) { this.fail(reply, 'no_permission', 'Dieses Gerät hat kein Upload-Recht.'); return null }
      return s
    }

    app.post(`${base}/uploads`, async (req, reply) => {
      const s = uploadAuth(req, reply)
      if (!s) return
      const b = UploadBeginRequestSchema.safeParse(req.body)
      if (!b.success) return this.fail(reply, 'invalid_args', 'Ungültige Anfrage.')
      const uploadId = b.data.uploadId ?? `upl-${createHash('sha256').update(`${s.id}${b.data.sha256}${b.data.fileName}${b.data.serverId}`).digest('hex').slice(0, 24)}`
      const out = this.capture(uploadId, () => this.d.uploads.begin({ uploadId, serverId: b.data.serverId, fileName: b.data.fileName, size: b.data.size, sha256: b.data.sha256, restartAfter: b.data.restartAfter, uploader: `${s.user} (${this.d.devices.get(s.deviceId)?.name ?? '?'})` }))
      const failed = out.find((m) => m.type === 'upload.failed')
      if (failed) return this.fail(reply, failed.code as ErrorCode, String(failed.error))
      const ready = out.find((m) => m.type === 'upload.ready')
      return { uploadId, received: Number(ready?.received ?? 0), chunkSize: CHUNK_SIZE }
    })

    app.put<{ Params: { id: string }; Querystring: { offset?: string } }>(`${base}/uploads/:id`, { bodyLimit: MAX_CHUNK }, async (req, reply) => {
      const s = uploadAuth(req, reply)
      if (!s) return
      const offset = Number(req.query.offset)
      if (!Number.isInteger(offset) || offset < 0 || !Buffer.isBuffer(req.body) || !req.body.length) return this.fail(reply, 'invalid_args', 'Offset oder Daten fehlen. Sende application/octet-stream.')
      const out = this.capture(req.params.id, () => this.d.uploads.chunk({ uploadId: req.params.id, offset, data: req.body as Buffer }))
      const failed = out.find((m) => m.type === 'upload.failed')
      if (failed) return this.fail(reply, failed.code as ErrorCode, String(failed.error))
      const ack = out.find((m) => m.type === 'upload.ack')
      const received = Number(ack?.received ?? 0)
      // Versatz: Der Client muss ab `received` neu senden.
      if (received !== offset + (req.body as Buffer).length) return this.fail(reply, 'conflict', 'Der Offset passt nicht. Sende ab `received` erneut.', { received })
      return { received }
    })

    app.get<{ Params: { id: string } }>(`${base}/uploads/:id`, async (req, reply) => {
      if (!uploadAuth(req, reply)) return
      const r = this.d.uploads.history().find((u) => u.id === req.params.id)
      if (!r) return this.fail(reply, 'not_found', 'Upload nicht gefunden.')
      return { uploadId: r.id, status: r.status, received: r.received ?? (r.status === 'done' ? r.size : 0), size: r.size, error: r.error }
    })

    app.post<{ Params: { id: string } }>(`${base}/uploads/:id/finish`, async (req, reply) => {
      if (!uploadAuth(req, reply)) return
      const out = await this.captureAsync(req.params.id, () => this.d.uploads.end({ uploadId: req.params.id }))
      const failed = out.find((m) => m.type === 'upload.failed')
      if (failed) return this.fail(reply, failed.code as ErrorCode, String(failed.error))
      const done = out.find((m) => m.type === 'upload.done')
      if (done) return { kind: String(done.kind), warnings: (done.warnings as string[]) ?? [] }
      const ack = out.find((m) => m.type === 'upload.ack')
      return this.fail(reply, 'conflict', 'Die Datei ist noch nicht vollständig.', { received: Number(ack?.received ?? 0) })
    })

    app.delete<{ Params: { id: string } }>(`${base}/uploads/:id`, async (req, reply) => {
      if (!uploadAuth(req, reply)) return
      this.capture(req.params.id, () => this.d.uploads.cancel(req.params.id))
      return { ok: true }
    })
  }

  private deviceAuth(req: FastifyRequest, reply: FastifyReply): Device | null {
    const t = this.bearer(req)
    const dev = t ? this.d.devices.verify(t) : null
    if (!dev) { this.fail(reply, 'unauthorized', 'Geräte-Token fehlt oder ist ungültig.'); return null }
    if (!this.limit(`d:${dev.id}`, 600)) { this.fail(reply, 'rate_limited', 'Zu viele Anfragen.'); return null }
    return dev
  }

  // ---------- Upload-Antworten einsammeln ----------
  /** Der UploadManager meldet Ergebnisse über `send`. Für REST sammeln wir sie je Upload ein. */
  uploadSend = (m: Record<string, unknown>) => { this.captures.get(String(m.uploadId))?.push(m) }
  private capture(id: string, fn: () => void): Record<string, unknown>[] {
    const buf: Record<string, unknown>[] = []
    this.captures.set(id, buf)
    try { fn() } finally { this.captures.delete(id) }
    return buf
  }
  private async captureAsync(id: string, fn: () => Promise<void>): Promise<Record<string, unknown>[]> {
    const buf: Record<string, unknown>[] = []
    this.captures.set(id, buf)
    try { await fn() } finally { this.captures.delete(id) }
    return buf
  }

  // ---------- WebSocket ----------
  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const cfg = this.d.config()
    const reject = (status: string) => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); socket.destroy() }
    if (!cfg.enabled) return reject('503 Service Unavailable')
    if (new URL(req.url ?? '/', 'http://x').pathname !== `${API_BASE}/ws`) return reject('404 Not Found')
    if (!this.hostAllowed(req.headers.host, cfg)) return reject('421 Misdirected Request')
    if (!this.originAllowed(req.headers.origin, cfg)) return reject('403 Forbidden')
    this.wss?.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws))
  }

  private send(ws: WebSocket, m: Record<string, unknown>) { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)) } catch { /* ignore */ } }

  private onSocket(ws: WebSocket) {
    let conn: Conn | null = null
    const timer = setTimeout(() => { this.send(ws, { type: 'error', error: 'Anmeldung fehlt.', code: 'unauthorized' }); ws.close(4401) }, AUTH_TIMEOUT_MS)
    ws.on('message', async (raw) => {
      let json: unknown
      try { json = JSON.parse(raw.toString()) } catch { return }
      const m = WsInboundSchema.safeParse(json)
      if (!m.success) return this.send(ws, { type: 'error', error: 'Ungültige Nachricht.', code: 'invalid_args' })
      if (!conn) {
        if (m.data.type !== 'auth') { this.send(ws, { type: 'error', error: 'Zuerst anmelden.', code: 'unauthorized' }); return void ws.close(4401) }
        const s = this.d.sessions.verify(m.data.token)
        if (!s) { this.send(ws, { type: 'error', error: 'Sitzung fehlt oder ist abgelaufen.', code: 'unauthorized' }); return void ws.close(4401) }
        clearTimeout(timer)
        conn = { ws, session: s, token: m.data.token, events: new Set(), serverIds: null, logs: new Map(), flush: null, alive: this.now() }
        this.conns.add(conn)
        this.d.onChange?.()
        const info = this.d.info()
        return this.send(ws, { type: 'hello', protocolVersion: PROTOCOL_VERSION, minProtocolVersion: MIN_PROTOCOL_VERSION, appVersion: info.appVersion, deviceName: info.deviceName, role: s.role, perms: s.perms, user: s.user, servers: this.d.summaries() })
      }
      conn.alive = this.now()
      switch (m.data.type) {
        case 'ping': return this.send(ws, { type: 'pong' })
        case 'subscribe': conn.events = new Set(m.data.events); conn.serverIds = m.data.serverIds ? new Set(m.data.serverIds) : null; return
        case 'cmd': {
          try {
            const cfg = this.d.config()
            authorizeRemote(m.data.command, m.data.args, conn.session.role, { enabled: cfg.enabled, maxRole: cfg.maxRole }, this.d.known)
            const result = await this.d.exec(m.data.command as CommandName, m.data.args)
            this.send(ws, { type: 'res', id: m.data.id, ok: true, result: result ?? null })
          } catch (e) { this.send(ws, { type: 'res', id: m.data.id, ok: false, error: msg(e), code: classifyError(e) }) }
        }
      }
    })
    ws.on('pong', () => { if (conn) conn.alive = this.now() })
    ws.on('close', () => { clearTimeout(timer); if (conn) { if (conn.flush) clearTimeout(conn.flush); this.conns.delete(conn); this.d.onChange?.() } })
    ws.on('error', () => {})
  }

  private heartbeat() {
    const t = this.now()
    for (const c of [...this.conns]) {
      if (t - c.alive > DEAD_MS || !this.d.sessions.verify(c.token)) { try { c.ws.close(this.d.sessions.verify(c.token) ? 1001 : 4401) } catch { /* ignore */ } continue }
      try { c.ws.ping() } catch { /* ignore */ }
    }
  }

  broadcastSnapshot() {
    if (!this.conns.size) return
    const m = { type: 'snapshot', at: this.now(), servers: this.d.summaries() }
    for (const c of this.conns) this.send(c.ws, m)
  }

  /** Leitet App-Ereignisse an verbundene Browser weiter (abonnierte, dazu immer `servers.event`). Logs werden gebündelt. */
  forward(event: string, payload: unknown): void {
    if (!this.conns.size) return
    const sid = typeof payload === 'string' ? payload : payload && typeof payload === 'object' && 'id' in payload ? String((payload as { id: unknown }).id) : null
    for (const c of this.conns) {
      if (!DEFAULT_EVENTS.has(event) && !c.events.has(event)) continue
      if (c.serverIds && sid && !c.serverIds.has(sid) && !DEFAULT_EVENTS.has(event)) continue
      if (event === 'servers.log') {
        const { id, line } = payload as { id: string; line: string }
        const buf = c.logs.get(id) ?? []
        if (buf.length < 500) buf.push(line)
        c.logs.set(id, buf)
        if (!c.flush) c.flush = setTimeout(() => { c.flush = null; for (const [i, lines] of c.logs) this.send(c.ws, { type: 'event', event: 'servers.log', payload: { id: i, lines } }); c.logs.clear() }, 250)
        continue
      }
      this.send(c.ws, { type: 'event', event, payload })
    }
  }

  /** Aktive Verbindungen für die Anzeige in der App. */
  connections(): Session[] { return [...this.conns].map((c) => c.session) }

  /** Trennt alle Verbindungen und Sitzungen eines Geräts (nach dem Widerrufen). */
  closeDevice(deviceId: string) {
    this.d.sessions.revokeDevice(deviceId)
    for (const c of [...this.conns]) if (c.session.deviceId === deviceId) { try { c.ws.close(4401) } catch { /* ignore */ } }
  }
}

export { ERROR_CODES }
