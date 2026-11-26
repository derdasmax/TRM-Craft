import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandRoles, type CommandName } from '@trm/core'
import { RemoteClient, type SocketLike } from './client'
import { httpBase, pairDevice, validateRemoteUrl } from './pairing'

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
  const states: any[] = []
  const exec = vi.fn(async (c: string, a: unknown) => ({ c, a }))
  const uploads = { begin: vi.fn(), chunk: vi.fn(), end: vi.fn(async () => {}), cancel: vi.fn(), fetch: vi.fn(async () => {}) }
  const config = { enabled: true, url: 'wss://trm.example/agent', maxRole: 'admin' as const, ...cfg }
  const c = new RemoteClient({
    config: () => config, token: () => token, known, exec: exec as never, uploads: uploads as never, random: () => 1,
    create: () => { const s = new FakeSocket(); sockets.push(s); return s }, hello: () => ({ deviceId: 'd1', servers: [] }), onState: (s) => states.push(s),
  })
  return { c, sockets, states, exec, uploads, config }
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
    expect(JSON.parse(body)).toMatchObject({ code: 'ab12-CD34', deviceName: 'Laptop', protocol: 1 })
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
    expect(s.sent[0]).toMatchObject({ type: 'hello', protocol: 1, deviceId: 'd1' })
    s.recv({ type: 'cmd', id: 'req-1', command: 'servers.list', role: 'viewer' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.at(-1)).toMatchObject({ type: 'res', id: 'req-1', ok: true })
    s.recv({ type: 'cmd', id: 'req-2', command: 'servers.start', args: 's1', role: 'viewer' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.at(-1)).toMatchObject({ id: 'req-2', ok: false, error: expect.stringMatching(/Berechtigung/) })
    s.recv({ type: 'cmd', id: 'req-3', command: 'shell.openExternal', args: 'https://x', role: 'owner' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.at(-1)).toMatchObject({ id: 'req-3', ok: false, error: expect.stringMatching(/nicht erlaubt/) })
    expect(t.exec).toHaveBeenCalledTimes(1)
  })

  it('meldet Fehler beim Ausführen und ignoriert Müll', async () => {
    const t = setup(); t.exec.mockRejectedValueOnce(new Error("Error invoking remote method 'trm:invoke': Error: Server nicht gefunden.")); t.c.start(); const s = t.sockets[0]!; open(s)
    s.recv({ type: 'cmd', id: 'req-1', command: 'servers.start', args: 'x', role: 'admin' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.at(-1)).toMatchObject({ ok: false, error: 'Server nicht gefunden.' })
    const n = s.sent.length
    s.emit('message', 'kein json'); s.recv({ type: 'unbekannt' }); s.recv({ type: 'cmd', id: '!', command: 'x', role: 'god' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.sent.length).toBe(n)
  })

  it('leitet nur abonnierte Ereignisse und Server weiter und bündelt Logs', async () => {
    const t = setup(); t.c.start(); const s = t.sockets[0]!; open(s)
    t.c.forward('servers.status', { id: 's1' })
    expect(s.sent).toHaveLength(1) // nur hello
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
    await vi.advanceTimersByTimeAsync(80_000)
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
