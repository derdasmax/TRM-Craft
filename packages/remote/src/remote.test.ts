import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandRoles, type CommandName } from '@trm/core'
import { RemoteClient, type SocketLike } from './client'
import { httpBase, pairDevice, startPairing, validateRemoteUrl, waitForPairing } from './pairing'
import { LongPollSocket } from './poll'
import { classifyError, ERROR_CODES, OutboundSchema, RemoteError } from './protocol'

class FakeSocket extends EventEmitter implements SocketLike {
  sent: any[] = []
  closed = false
  send(d: string) { this.sent.push(JSON.parse(d)) }
  close() { this.closed = true }
  terminate() { this.closed = true }
  ping() { this.emit('pingsent') }
  recv(m: unknown) { this.emit('message', JSON.stringify(m)) }
}

const known = (c: string): c is CommandName => c in commandRoles

function setup(cfg: Partial<{ enabled: boolean; url: string; maxRole: 'viewer' | 'moderator' | 'admin' }> = {}, token: string | null = 'tok') {
  const sockets: FakeSocket[] = []
  const pollSockets: FakeSocket[] = []
  const states: any[] = []
  const exec = vi.fn(async (c: string, a: unknown) => ({ c, a }))
  const uploads = { begin: vi.fn(), chunk: vi.fn(), end: vi.fn(async () => {}), cancel: vi.fn(), fetch: vi.fn(async () => {}) }
  const config = { enabled: true, url: 'wss://trm.example/agent', maxRole: 'admin' as const, ...cfg }
  const c = new RemoteClient({
    config: () => config, token: () => token, known, exec: exec as never, uploads: uploads as never, random: () => 1,
    create: () => { const s = new FakeSocket(); sockets.push(s); return s },
    createPoll: () => { const s = new FakeSocket(); pollSockets.push(s); return s },
    snapshot: () => [{ id: 's1', name: 'S', edition: 'java', loader: 'paper', mcVersion: '1.21.4', status: 'running', players: ['A'], port: 25565, uptimeMs: 5 }],
    hello: () => ({ deviceId: 'd1', deviceName: 'PC', appVersion: '1.0.0', platform: 'win32', canUpload: true, servers: [] }), onState: (s) => states.push(s),
  })
  return { c, sockets, pollSockets, states, exec, uploads, config }
}
const open = (s: FakeSocket) => s.emit('open')

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Pairing', () => {
  it('erlaubt nur verschlüsselte Adressen (wss) und lokale Entwicklung', () => {
    expect(validateRemoteUrl('wss://trm.example/agent').host).toBe('trm.example')
    expect(validateRemoteUrl('ws://localhost:8787/agent').hostname).toBe('localhost')
    for (const bad of ['ws://trm.example/agent', 'https://trm.example', 'wss://u:p@trm.example', 'nonsense']) expect(() => validateRemoteUrl(bad), bad).toThrow()
    expect(httpBase('wss://trm.example/agent')).toBe('https://trm.example')
  })
  it('tauscht den Code gegen ein Token und erklärt Fehler', async () => {
    let body = ''
    const ok = (async (_u: string, i?: RequestInit) => { body = String(i?.body); return new Response(JSON.stringify({ deviceToken: 'x'.repeat(40), deviceId: 'd1', perms: { upload: true } })) }) as unknown as typeof fetch
    const r = await pairDevice('wss://trm.example/agent', ' ab12-CD34 ', 'Laptop', '1.0.0', ok)
    expect(r.perms.upload).toBe(true)
    expect(JSON.parse(body)).toMatchObject({ code: 'ab12-CD34', deviceName: 'Laptop', protocolVersion: 1 })
    await expect(pairDevice('wss://trm.example/agent', 'a b', 'L', '1', ok)).rejects.toThrow(/ungültig/)
    await expect(pairDevice('wss://trm.example/agent', 'ABCD-1234', 'L', '1', (async () => new Response('{}', { status: 410 })) as unknown as typeof fetch)).rejects.toThrow(/abgelaufen/)
    await expect(pairDevice('wss://trm.example/agent', 'ABCD-1234', 'L', '1', (async () => new Response(JSON.stringify({ deviceToken: 'kurz' }))) as unknown as typeof fetch)).rejects.toThrow()
  })
})

describe('RemoteClient', () => {
  it('verbindet nur, wenn aktiviert, gekoppelt und die Adresse gültig ist', () => {
    expect(setup({ enabled: false }).sockets).toHaveLength(0)
    const a = setup({}, null); a.c.start(); expect(a.sockets).toHaveLength(0)
    const b = setup({ url: 'ws://evil.example' }); b.c.start(); expect(b.sockets).toHaveLength(0)
    expect(b.states.at(-1).error).toMatch(/wss/)
  })

  it('sendet hello und führt Befehle mit Rollenprüfung aus', async () => {
    const t = setup(); t.c.start(); const s = t.sockets[0]!; open(s)
    expect(s.sent[0]).toMatchObject({ type: 'hello', protocolVersion: 1, minProtocolVersion: 1, deviceId: 'd1', transport: 'websocket' })
    expect(OutboundSchema.safeParse(s.sent[0]).success).toBe(true)
    s.recv({ type: 'cmd', id: 'req-1', command: 'servers.list', role: 'viewer' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.at(-1)).toMatchObject({ type: 'res', id: 'req-1', ok: true })
    s.recv({ type: 'cmd', id: 'req-2', command: 'servers.start', args: 's1', role: 'viewer' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.at(-1)).toMatchObject({ id: 'req-2', ok: false, code: 'forbidden', error: expect.stringMatching(/Berechtigung/) })
    s.recv({ type: 'cmd', id: 'req-3', command: 'shell.openExternal', args: 'https://x', role: 'owner' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.at(-1)).toMatchObject({ id: 'req-3', ok: false, code: 'local_only', error: expect.stringMatching(/nicht erlaubt/) })
    expect(t.exec).toHaveBeenCalledTimes(1)
  })

  it('meldet Fehler beim Ausführen und ignoriert Müll', async () => {
    const t = setup(); t.exec.mockRejectedValueOnce(new Error("Error invoking remote method 'trm:invoke': Error: Server nicht gefunden.")); t.c.start(); const s = t.sockets[0]!; open(s)
    s.recv({ type: 'cmd', id: 'req-1', command: 'servers.start', args: 'x', role: 'admin' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.at(-1)).toMatchObject({ ok: false, error: 'Server nicht gefunden.', code: 'not_found' })
    const n = s.sent.length
    s.emit('message', 'kein json'); s.recv({ type: 'unbekannt' }); s.recv({ type: 'cmd', id: '!', command: 'x', role: 'god' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.length).toBe(n)
  })

  it('leitet nur abonnierte Ereignisse und Server weiter und bündelt Logs', async () => {
    const t = setup(); t.c.start(); const s = t.sockets[0]!; open(s)
    t.c.forward('servers.status', { id: 's1' })
    expect(s.sent).toHaveLength(2) // nur hello und snapshot
    s.recv({ type: 'subscribe', events: ['servers.status', 'servers.log'], serverIds: ['s1'] })
    await vi.advanceTimersByTimeAsync(0)
    t.c.forward('servers.status', { id: 's1', status: 'running' })
    t.c.forward('servers.status', { id: 's2', status: 'running' })
    t.c.forward('servers.stats', { id: 's1' })
    expect(s.sent.filter((x) => x.type === 'event')).toHaveLength(1)
    t.c.forward('servers.log', { id: 's1', line: 'a' }); t.c.forward('servers.log', { id: 's1', line: 'b' })
    await vi.advanceTimersByTimeAsync(300)
    expect(s.sent.at(-1)).toEqual({ type: 'event', event: 'servers.log', payload: { id: 's1', lines: ['a', 'b'] } })
  })

  it('verbindet nach Verbindungsabbruch mit wachsender Wartezeit neu', async () => {
    const t = setup(); t.c.start(); open(t.sockets[0]!)
    t.sockets[0]!.emit('close', 1006)
    expect(t.states.at(-1).connected).toBe(false)
    await vi.advanceTimersByTimeAsync(1000); expect(t.sockets).toHaveLength(2)
    t.sockets[1]!.emit('close', 1006)
    await vi.advanceTimersByTimeAsync(1500); expect(t.sockets).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(600); expect(t.sockets).toHaveLength(3)
    open(t.sockets[2]!)
    t.sockets[2]!.emit('close', 1006)
    await vi.advanceTimersByTimeAsync(1000); expect(t.sockets).toHaveLength(4) // Zähler nach erfolgreichem Aufbau zurückgesetzt
  })

  it('gibt bei abgelehntem Gerät auf', async () => {
    const t = setup(); t.c.start(); open(t.sockets[0]!)
    t.sockets[0]!.emit('close', 4401)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(t.sockets).toHaveLength(1)
    expect(t.states.at(-1).error).toMatch(/neu/)
  })

  it('beendet tote Verbindungen und lässt sich abschalten', async () => {
    const t = setup(); t.c.start(); const s = t.sockets[0]!; open(s)
    await vi.advanceTimersByTimeAsync(125_000)
    expect(s.closed).toBe(true)
    const u = setup(); u.c.start(); open(u.sockets[0]!)
    u.c.stop()
    expect(u.sockets[0]!.closed).toBe(true)
    expect(u.states.at(-1).connected).toBe(false)
    u.sockets[0]!.emit('close', 1000)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(u.sockets).toHaveLength(1)
  })

  it('reicht Uploads an den Upload-Manager weiter und beantwortet Pings', async () => {
    const t = setup(); t.c.start(); const s = t.sockets[0]!; open(s)
    s.recv({ type: 'ping' })
    s.recv({ type: 'upload.begin', uploadId: 'up-12345', serverId: 's1', fileName: 'a.jar', size: 5, sha256: 'a'.repeat(64) })
    s.recv({ type: 'upload.chunk', uploadId: 'up-12345', offset: 0, data: 'QUJD' })
    s.recv({ type: 'upload.end', uploadId: 'up-12345' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.at(-1)).toEqual({ type: 'pong' })
    expect(t.uploads.begin).toHaveBeenCalled()
    expect(t.uploads.chunk).toHaveBeenCalledWith({ type: 'upload.chunk', uploadId: 'up-12345', offset: 0, data: 'QUJD' })
    expect(t.uploads.end).toHaveBeenCalled()
  })
})

describe('RemoteClient: Fallback, Schnappschüsse, Version', () => {
  it('schaltet nach drei fehlgeschlagenen WebSocket-Versuchen auf HTTPS-Polling um und probiert später wieder WebSocket', async () => {
    const t = setup(); t.c.start()
    for (let i = 0; i < 3; i++) { t.sockets[i]!.emit('close', 1006); await vi.advanceTimersByTimeAsync(70_000) }
    expect(t.sockets).toHaveLength(3)
    expect(t.pollSockets).toHaveLength(1)
    open(t.pollSockets[0]!)
    expect(t.c.transport).toBe('polling')
    expect(t.pollSockets[0]!.sent[0]).toMatchObject({ type: 'hello', transport: 'polling' })
    // Polling bleibt bestehen, bis die Frist abgelaufen ist, danach wird wieder WebSocket versucht.
    for (let i = 0; i < 8; i++) { t.pollSockets.at(-1)!.emit('close', 1006); await vi.advanceTimersByTimeAsync(70_000) }
    expect(t.sockets.length).toBeGreaterThan(3)
  })

  it('ein Verbindungsabbruch nach erfolgreichem Aufbau löst keinen Fallback aus', async () => {
    const t = setup(); t.c.start()
    for (let i = 0; i < 5; i++) { open(t.sockets[i]!); t.sockets[i]!.emit('close', 1006); await vi.advanceTimersByTimeAsync(70_000) }
    expect(t.pollSockets).toHaveLength(0)
  })

  it('sendet Schnappschüsse beim Verbinden und alle 15 Sekunden', async () => {
    const t = setup(); t.c.start(); const s = t.sockets[0]!; open(s)
    expect(s.sent.map((x) => x.type)).toEqual(['hello', 'snapshot'])
    expect(OutboundSchema.safeParse(s.sent[1]).success).toBe(true)
    await vi.advanceTimersByTimeAsync(31_000)
    expect(s.sent.filter((x) => x.type === 'snapshot')).toHaveLength(3)
  })

  it('sendet Server-Ereignisse (Joins, Abstürze) immer, andere nur nach Abo', async () => {
    const t = setup(); t.c.start(); const s = t.sockets[0]!; open(s)
    t.c.forward('servers.event', { id: 's1', name: 'S', kind: 'join', player: 'Alex' })
    t.c.forward('servers.status', { id: 's1' })
    const ev = s.sent.filter((x) => x.type === 'event')
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ event: 'servers.event', payload: { kind: 'join', player: 'Alex' } })
  })

  it('beendet die Verbindung bei unverträglicher Protokollversion', async () => {
    const t = setup(); t.c.start(); const s = t.sockets[0]!; open(s)
    s.recv({ type: 'welcome', protocolVersion: 2, minProtocolVersion: 2, siteName: 'TRM' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.closed).toBe(true)
    expect(t.states.at(-1).error).toMatch(/Protokollversion/)
    s.emit('close', 1000)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(t.sockets).toHaveLength(1)
    const u = setup(); u.c.start(); open(u.sockets[0]!)
    u.sockets[0]!.recv({ type: 'welcome', protocolVersion: 1, siteName: 'TRM' })
    await vi.advanceTimersByTimeAsync(0)
    expect(u.states.at(-1).siteName).toBe('TRM')
  })
})

describe('Fehlercodes', () => {
  it('ordnet Meldungen Codes zu', () => {
    const c = (m: string) => classifyError(new Error(m))
    expect(c('Server nicht gefunden.')).toBe('not_found')
    expect(c('Stoppe den Server zuerst.')).toBe('server_running')
    expect(c('Die Prüfsumme stimmt nicht überein.')).toBe('checksum_mismatch')
    expect(c('Die Datei ist größer als das Limit von 10 MB.')).toBe('too_large')
    expect(c('Die Datei ist für fabric gebaut, dieser Server nutzt Forge.')).toBe('wrong_loader')
    expect(c('Dateityp nicht erlaubt: .exe')).toBe('unsupported_type')
    expect(c('Dieses Gerät hat kein Upload-Recht.')).toBe('no_permission')
    expect(c('fetch failed')).toBe('network')
    expect(c('irgendwas Unbekanntes')).toBe('internal')
    expect(classifyError(new RemoteError('forbidden', 'x'))).toBe('forbidden')
    expect(ERROR_CODES).toContain('local_only')
  })
})

describe('LongPollSocket', () => {
  it('öffnet eine Sitzung, liefert Nachrichten, sendet gebündelt und meldet Ablehnung', async () => {
    vi.useRealTimers()
    const calls: string[] = []
    let polls = 0
    const f = (async (url: string, init?: RequestInit) => {
      const u = new URL(url)
      calls.push(`${init?.method ?? 'GET'} ${u.pathname}`)
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer TOK')
      if (u.pathname.endsWith('/session')) return new Response(JSON.stringify({ sessionId: 'sess-12345678' }))
      if (u.pathname.endsWith('/poll')) { polls++; if (polls > 1) await new Promise((r) => setTimeout(r, 25)); return new Response(JSON.stringify({ messages: polls === 1 ? [{ type: 'ping' }] : [] })) }
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    const s = new LongPollSocket('https://trm.example', 'TOK', f, 1)
    const got: string[] = []
    let opened = false
    s.on('open', () => (opened = true)); s.on('message', (m) => got.push(m))
    await new Promise((r) => setTimeout(r, 60))
    expect(opened).toBe(true)
    expect(JSON.parse(got[0]!)).toEqual({ type: 'ping' })
    s.send('{"type":"pong"}'); s.send('{"type":"pong"}')
    await new Promise((r) => setTimeout(r, 30))
    s.close()
    expect(calls[0]).toBe('POST /api/agent/session')
    expect(calls.some((c) => c === 'POST /api/agent/send')).toBe(true)

    const closes: unknown[] = []
    const denied = new LongPollSocket('https://trm.example', 'x', (async () => new Response('', { status: 401 })) as unknown as typeof fetch)
    denied.on('close', (c) => closes.push(c))
    await new Promise((r) => setTimeout(r, 20))
    expect(closes).toEqual([4401])
  })
})

describe('Kopplung von der App aus', () => {
  it('zeigt einen Code und wartet auf die Bestätigung der Webseite', async () => {
    vi.useRealTimers()
    let status = 0
    const f = (async (url: string) => {
      if (url.endsWith('/pair/start')) return new Response(JSON.stringify({ code: 'ABCD-1234', pollId: 'poll-123456', expiresInSec: 600 }))
      status++
      return new Response(JSON.stringify(status < 3 ? { status: 'pending' } : { status: 'paired', deviceToken: 'x'.repeat(40), deviceId: 'd9', siteName: 'TRM', perms: { upload: true } }))
    }) as unknown as typeof fetch
    const p = await startPairing('wss://trm.example/agent', 'Laptop', '1.0.0', f, () => 1000)
    expect(p).toMatchObject({ code: 'ABCD-1234', expiresAt: 601_000 })
    const r = await waitForPairing('wss://trm.example/agent', p, f, { sleep: async () => {}, now: () => 2000 })
    expect(r).toMatchObject({ deviceId: 'd9', perms: { upload: true } })
  })
  it('bricht bei Ablauf oder Abbruch ab', async () => {
    const p = { code: 'ABCD-1234', pollId: 'poll-123456', expiresAt: 5000 }
    const pending = (async () => new Response(JSON.stringify({ status: 'pending' }))) as unknown as typeof fetch
    let t = 0
    await expect(waitForPairing('wss://trm.example/agent', p, pending, { sleep: async () => { t += 3000 }, now: () => t })).rejects.toThrow(/abgelaufen/)
    await expect(waitForPairing('wss://trm.example/agent', p, (async () => new Response('', { status: 410 })) as unknown as typeof fetch, { sleep: async () => {}, now: () => 0 })).rejects.toThrow(/abgelaufen/)
    const ac = new AbortController(); ac.abort()
    await expect(waitForPairing('wss://trm.example/agent', p, pending, { signal: ac.signal, now: () => 0 })).rejects.toThrow(/abgebrochen/)
  })
})
