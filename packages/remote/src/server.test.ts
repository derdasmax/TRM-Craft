import { createHash, randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { mkdtempSync, existsSync, readFileSync, createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import archiver from 'archiver'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { CommandName, ServerRecord } from '@trm/core'
import { DeviceStore, PairingCodes, SessionStore } from './devices'
import { RemoteServer, type ServerConfig } from './server'
import { UploadManager } from './uploads'

const tmp = (p = 'trm-rs-') => mkdtempSync(join(tmpdir(), p))
const ORIGIN = 'https://trm.example.net'
const rec = (): ServerRecord => ({
  id: 's1', name: 'Test', edition: 'java', loader: 'fabric', mcVersion: '1.20.1', port: 25565, ramMb: 2048, jvmPreset: 'aikar', javaMajor: 17, launch: { type: 'jar', jar: 'server.jar' },
  crossplay: false, limits: { priority: 'normal' }, backup: { keep: 10 }, notify: { desktop: true, discord: false, joins: false }, autoRestart: true, autostart: false, eulaAcceptedAt: null, createdAt: 'x',
})
async function zip(files: Record<string, string>): Promise<Buffer> {
  const p = join(tmp(), 'f.zip')
  await new Promise<void>((resolve) => { const o = createWriteStream(p); o.on('close', () => resolve()); const a = archiver('zip'); a.pipe(o); for (const [n, c] of Object.entries(files)) a.append(c, { name: n }); void a.finalize() })
  return readFileSync(p)
}

const running: RemoteServer[] = []
afterEach(async () => { for (const s of running.splice(0)) await s.stop() })

async function boot(over: Partial<ServerConfig> = {}) {
  const cfg: ServerConfig = { enabled: true, mode: 'tunnel', port: 0, allowedOrigins: [ORIGIN], publicHost: 'craft.example.net', maxRole: 'admin', ...over }
  const dataDir = tmp(), srvDir = tmp('trm-srv-')
  const devices = new DeviceStore(join(dataDir, 'devices.json'))
  const sessions = new SessionStore()
  const pairing = new PairingCodes()
  const calls: [string, unknown][] = []
  let server!: RemoteServer
  const uploads = new UploadManager({
    dir: dataDir, limitBytes: () => 10 * 1048576, canUpload: () => true,
    server: (id) => (id === 's1' ? { rec: rec(), dir: srvDir, running: false, name: 'Test', levelName: () => 'world', backup: async () => 'b.zip', restart: async () => {} } : null),
    send: (m) => server.uploadSend(m), emit: () => {}, restore: async () => {},
  })
  server = new RemoteServer({
    config: () => cfg, uploads, devices, sessions, pairing,
    exec: async (c: CommandName, a: unknown) => { calls.push([c, a]); return c === 'servers.list' ? [{ id: 's1' }] : null },
    known: (c): c is CommandName => ['servers.list', 'servers.start', 'shell.openExternal'].includes(c),
    summaries: () => [{ id: 's1', name: 'Test', edition: 'java', loader: 'fabric', mcVersion: '1.20.1', status: 'stopped', players: 0, maxPlayers: 20 } as never],
    info: () => ({ appVersion: '1.0.0', deviceName: 'Laptop', tunnel: true }),
  })
  running.push(server)
  const { port } = await server.start()
  const base = `http://127.0.0.1:${port}/api/v1`
  const call = (path: string, init: RequestInit & { json?: unknown; token?: string; origin?: string | null; host?: string } = {}) => {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
    if (init.token) headers.authorization = `Bearer ${init.token}`
    if (init.json !== undefined) headers['content-type'] = 'application/json'
    if (init.origin !== null) headers.origin = init.origin ?? ORIGIN
    if (init.host) headers.host = init.host
    return fetch(`${base}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body })
  }
  /** Kopplung + Sitzung. */
  const login = async (role = 'admin', upload = true) => {
    const offer = pairing.start({ upload })
    const p = await (await call('/pair', { method: 'POST', json: { code: offer.code, siteName: 'Test' } })).json() as { deviceToken: string }
    const s = await (await call('/sessions', { method: 'POST', token: p.deviceToken, json: { user: 'Maxi', role } })).json() as { sessionToken: string }
    return { device: p.deviceToken, session: s.sessionToken }
  }
  return { cfg, call, login, port, calls, srvDir, devices, sessions, pairing, server, uploads }
}

describe('Remote-API: Grundschutz', () => {
  it('info ist öffentlich, Fremd-Origin und falscher Host werden abgewiesen', async () => {
    const t = await boot()
    const ok = await t.call('/info')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(await ok.json()).toMatchObject({ name: 'TRM-Craft', protocolVersion: 2 })
    const bad = await t.call('/info', { origin: 'https://evil.example' })
    expect(bad.status).toBe(403)
    expect(await bad.json()).toMatchObject({ code: 'origin_not_allowed' })
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
    const withHost = (host: string) => new Promise<number>((r) => { const q = request({ host: '127.0.0.1', port: t.port, path: '/api/v1/info', headers: { host } }, (res) => { res.resume(); r(res.statusCode ?? 0) }); q.end() })
    expect(await withHost('evil.example')).toBe(421)
    expect(await withHost('craft.example.net')).toBe(200)
  })

  it('beantwortet Preflight nur für erlaubte Origins', async () => {
    const t = await boot()
    const r = await t.call('/cmd', { method: 'OPTIONS' })
    expect(r.status).toBe(204)
    expect(r.headers.get('access-control-allow-headers')).toContain('authorization')
    expect((await t.call('/cmd', { method: 'OPTIONS', origin: 'https://evil.example' })).status).toBe(403)
  })

  it('ist ausgeschaltet nicht erreichbar', async () => {
    const t = await boot()
    t.cfg.enabled = false
    expect((await t.call('/info')).status).toBe(503)
  })
})

describe('Remote-API: Kopplung und Sitzungen', () => {
  it('Code ist einmalig, falsche Codes werden gedrosselt', async () => {
    const t = await boot()
    const offer = t.pairing.start({ upload: false })
    const first = await t.call('/pair', { method: 'POST', json: { code: offer.code } })
    expect(first.status).toBe(200)
    expect((await t.call('/pair', { method: 'POST', json: { code: offer.code } })).status).toBe(401)
    t.pairing.start({ upload: false })
    let last = 401
    for (let i = 0; i < 12; i++) last = (await t.call('/pair', { method: 'POST', json: { code: 'AAAA-BBBB' } })).status
    expect(last).toBe(429)
  })

  it('Sitzung: Rolle wird durch Gerät und Obergrenze begrenzt', async () => {
    const t = await boot({ maxRole: 'moderator' })
    const { device, session } = await t.login('owner')
    const me = await (await t.call('/me', { token: session })).json() as { role: string }
    expect(me.role).toBe('moderator')
    expect((await t.call('/cmd', { method: 'POST', token: device, json: { command: 'servers.list' } })).status).toBe(401) // Geräte-Token ist kein Sitzungs-Token
    expect((await t.call('/sessions', { method: 'POST', json: { user: 'x', role: 'viewer' } })).status).toBe(401)
    expect((await t.call('/sessions/current', { method: 'DELETE', token: session })).status).toBe(200)
    expect((await t.call('/me', { token: session })).status).toBe(401)
  })

  it('Widerruf beendet Sitzungen', async () => {
    const t = await boot()
    const { session } = await t.login()
    const id = t.devices.info(() => 0)[0]!.id
    t.devices.revoke(id); t.server.closeDevice(id)
    expect((await t.call('/cmd', { method: 'POST', token: session, json: { command: 'servers.list' } })).status).toBe(401)
  })
})

describe('Remote-API: Befehle', () => {
  it('führt erlaubte Befehle aus und prüft Rollen und Nur-lokal-Befehle', async () => {
    const t = await boot()
    const { session } = await t.login('viewer')
    const list = await t.call('/cmd', { method: 'POST', token: session, json: { command: 'servers.list' } })
    expect(await list.json()).toMatchObject({ ok: true, result: [{ id: 's1' }] })
    const forb = await t.call('/cmd', { method: 'POST', token: session, json: { command: 'servers.start', args: 's1' } })
    expect(forb.status).toBe(403)
    expect(await forb.json()).toMatchObject({ code: 'forbidden' })
    const admin = (await t.login('admin')).session
    const local = await t.call('/cmd', { method: 'POST', token: admin, json: { command: 'shell.openExternal', args: 'https://example.com' } })
    expect(await local.json()).toMatchObject({ ok: false, code: 'local_only' })
    expect(await (await t.call('/cmd', { method: 'POST', token: admin, json: { command: 'gibt.es.nicht' } })).json()).toMatchObject({ code: 'unknown_command' })
    expect(t.calls.map((c) => c[0])).toEqual(['servers.list'])
  })
})

describe('Remote-API: WebSocket', () => {
  const open = (t: Awaited<ReturnType<typeof boot>>, origin: string | null = ORIGIN) => new Promise<{ ws: WebSocket; msgs: Record<string, unknown>[]; next: (type: string) => Promise<Record<string, unknown>> }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${t.port}/api/v1/ws`, { headers: origin ? { origin } : {} })
    const msgs: Record<string, unknown>[] = []
    const waiters: { type: string; r: (m: Record<string, unknown>) => void }[] = []
    ws.on('message', (d) => { const m = JSON.parse(d.toString()) as Record<string, unknown>; if (process.env.DBG) console.log('WS', JSON.stringify(m).slice(0, 150)); const i = waiters.findIndex((w) => w.type === m.type); if (i >= 0) waiters.splice(i, 1)[0]!.r(m); else msgs.push(m) })
    const next = (type: string) => new Promise<Record<string, unknown>>((r) => { const hit = msgs.find((m) => m.type === type); if (hit) { msgs.splice(msgs.indexOf(hit), 1); r(hit) } else waiters.push({ type, r }) })
    ws.on('open', () => resolve({ ws, msgs, next }))
    ws.on('error', reject)
    ws.on('unexpected-response', (_q, res) => reject(new Error(`HTTP ${res.statusCode}`)))
  })

  it('meldet an, beantwortet Befehle und leitet Ereignisse weiter', async () => {
    const t = await boot()
    const { session } = await t.login('moderator')
    const c = await open(t)
    c.ws.send(JSON.stringify({ type: 'auth', token: session }))
    const hello = await c.next('hello')
    expect(hello).toMatchObject({ protocolVersion: 2, role: 'moderator', user: 'Maxi' })
    c.ws.send(JSON.stringify({ type: 'cmd', id: 'req-1', command: 'servers.list' }))
    expect(await c.next('res')).toMatchObject({ id: 'req-1', ok: true })
    c.ws.send(JSON.stringify({ type: 'cmd', id: 'req-2', command: 'shell.openExternal', args: 'x' }))
    expect(await c.next('res')).toMatchObject({ id: 'req-2', ok: false, code: 'local_only' })
    c.ws.send(JSON.stringify({ type: 'ping' }))
    await c.next('pong')
    t.server.forward('servers.event', { id: 's1', type: 'players', players: 3 })
    expect(await c.next('event')).toMatchObject({ event: 'servers.event' })
    // Nicht abonnierte Ereignisse kommen nicht an, abonnierte schon (Logs gebündelt).
    t.server.forward('servers.log', { id: 's1', line: 'a' })
    c.ws.send(JSON.stringify({ type: 'subscribe', events: ['servers.log'] }))
    await new Promise((r) => setTimeout(r, 50))
    t.server.forward('servers.log', { id: 's1', line: 'b' })
    t.server.forward('servers.log', { id: 's1', line: 'c' })
    expect(await c.next('event')).toMatchObject({ event: 'servers.log', payload: { id: 's1', lines: ['b', 'c'] } })
    c.ws.close()
  })

  it('weist falsche Origin, falsches Token und fehlende Anmeldung ab', async () => {
    const t = await boot()
    await expect(open(t, 'https://evil.example')).rejects.toThrow(/403/)
    const c = await open(t)
    const closed = new Promise<number>((r) => c.ws.on('close', (code) => r(code)))
    c.ws.send(JSON.stringify({ type: 'auth', token: 'trs_falsch12345' }))
    expect(await closed).toBe(4401)
    const d = await open(t)
    const closed2 = new Promise<number>((r) => d.ws.on('close', (code) => r(code)))
    d.ws.send(JSON.stringify({ type: 'ping' }))
    expect(await closed2).toBe(4401)
  })
})

describe('Remote-API: Uploads', () => {
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
  const put = (t: Awaited<ReturnType<typeof boot>>, token: string, id: string, data: Buffer, offset: number) => t.call(`/uploads/${id}?offset=${offset}`, { method: 'PUT', token, body: data, headers: { 'content-type': 'application/octet-stream' } })

  it('lädt in Chunks hoch, setzt fort und installiert die Mod', async () => {
    const t = await boot()
    const { session } = await t.login()
    const jar = await zip({ 'fabric.mod.json': '{}', 'a.class': randomBytes(6000).toString('base64') })
    const b = await (await t.call('/uploads', { method: 'POST', token: session, json: { serverId: 's1', fileName: 'cool.jar', size: jar.length, sha256: sha(jar) } })).json() as { uploadId: string; received: number }
    expect(b.received).toBe(0)
    const half = Math.floor(jar.length / 2)
    expect(await (await put(t, session, b.uploadId, jar.subarray(0, half), 0)).json()).toEqual({ received: half })
    // Falscher Offset → conflict mit received
    const wrong = await put(t, session, b.uploadId, jar.subarray(half), 5)
    expect(wrong.status).toBe(409)
    // Fortsetzen: neu beginnen liefert den Stand
    const again = await (await t.call('/uploads', { method: 'POST', token: session, json: { uploadId: b.uploadId, serverId: 's1', fileName: 'cool.jar', size: jar.length, sha256: sha(jar) } })).json() as { received: number }
    expect(again.received).toBe(half)
    expect((await put(t, session, b.uploadId, jar.subarray(half), half)).status).toBe(200)
    const fin = await t.call(`/uploads/${b.uploadId}/finish`, { method: 'POST', token: session })
    expect(await fin.json()).toMatchObject({ kind: 'mod' })
    expect(existsSync(join(t.srvDir, 'mods', 'cool.jar'))).toBe(true)
  })

  it('lehnt falsche Prüfsumme, fehlendes Recht und unbekannten Server ab', async () => {
    const t = await boot()
    const { session } = await t.login()
    const jar = await zip({ 'fabric.mod.json': '{}' })
    const b = await (await t.call('/uploads', { method: 'POST', token: session, json: { serverId: 's1', fileName: 'x.jar', size: jar.length, sha256: 'a'.repeat(64) } })).json() as { uploadId: string }
    await put(t, session, b.uploadId, jar, 0)
    const fin = await t.call(`/uploads/${b.uploadId}/finish`, { method: 'POST', token: session })
    expect(await fin.json()).toMatchObject({ code: 'checksum_mismatch' })
    expect(existsSync(join(t.srvDir, 'mods', 'x.jar'))).toBe(false)
    const nope = await t.call('/uploads', { method: 'POST', token: session, json: { serverId: 'nope', fileName: 'x.jar', size: 5, sha256: 'a'.repeat(64) } })
    expect(nope.status).toBe(404)
    const viewer = (await t.login('admin', false)).session
    const denied = await t.call('/uploads', { method: 'POST', token: viewer, json: { serverId: 's1', fileName: 'x.jar', size: 5, sha256: 'a'.repeat(64) } })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'no_permission' })
  })
})
