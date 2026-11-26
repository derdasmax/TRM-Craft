import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ServerManager, type ManagerDeps } from './manager'

const fake = fileURLToPath(new URL('../test/fake-server.mjs', import.meta.url))
const waitFor = async (cond: () => boolean, ms = 4000) => {
  const t = Date.now()
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('Zeitüberschreitung')
    await new Promise((r) => setTimeout(r, 20))
  }
}

function setup(over: Partial<ManagerDeps> = {}, env: NodeJS.ProcessEnv = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'trm-mgr-'))
  const events: { e: string; p: unknown }[] = []
  const used = new Set<number>()
  const m = new ServerManager({
    dataDir,
    emit: (e, p) => events.push({ e, p }),
    // Offline: Download und Java werden ersetzt, Start nutzt den Fake-Server.
    downloadImpl: async (o) => { mkdirSync(join(o.dest, '..'), { recursive: true }); writeFileSync(o.dest, 'jar') },
    ensureJavaImpl: async () => 'java',
    launcher: () => ({ command: process.execPath, args: [fake], cwd: dataDir, env: { ...process.env, ...env } }),
    portCheck: async (p) => !used.has(p),
    restartDelayMs: () => 20,
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('version_manifest')) return new Response(JSON.stringify({ latest: { release: '1.21.4', snapshot: 'x' }, versions: [{ id: '1.21.4', type: 'release', url: 'https://piston-meta.mojang.com/v.json', releaseTime: '2024-12-03T00:00:00+00:00' }] }))
      if (url.endsWith('/v.json')) return new Response(JSON.stringify({ id: '1.21.4', downloads: { server: { url: 'https://piston-data.mojang.com/s.jar', sha1: 'a', size: 1 } }, javaVersion: { majorVersion: 21 } }))
      return new Response('{}', { status: 404 })
    }) as typeof fetch,
    ...over,
  })
  return { m, dataDir, events, used }
}
const input = { name: 'Mein Server', loader: 'vanilla' as const, mcVersion: '1.21.4', ramMb: 2048, acceptEula: true as const }

describe('ServerManager', () => {
  it('erstellt einen Server mit EULA, Properties und Port', async () => {
    const { m, dataDir } = setup()
    const r = await m.create('t1', { ...input, motd: 'Hallo', seed: '42' })
    expect(r.id).toMatch(/^mein-server-[0-9a-f]{4}$/)
    expect(r.port).toBe(25565)
    expect(r.javaMajor).toBe(21)
    const dir = join(dataDir, 'servers', r.id)
    expect(readFileSync(join(dir, 'eula.txt'), 'utf8')).toContain('eula=true')
    expect(m.getProperties(r.id)).toMatchObject({ motd: 'Hallo', 'level-seed': '42', 'server-port': '25565' })
    expect(JSON.parse(readFileSync(join(dataDir, 'servers.json'), 'utf8')).servers).toHaveLength(1)
  })

  it('verweigert das Erstellen ohne EULA-Zustimmung', async () => {
    const { m } = setup()
    await expect(m.create('t', { ...input, acceptEula: false as never })).rejects.toThrow()
    expect(m.list()).toHaveLength(0)
  })

  it('vergibt freie Ports und erkennt Konflikte', async () => {
    const { m, used } = setup()
    const a = await m.create('a', input)
    const b = await m.create('b', { ...input, name: 'Zweiter' })
    expect([a.port, b.port]).toEqual([25565, 25566])
    await expect(m.create('c', { ...input, name: 'Dritter', port: 25565 })).rejects.toThrow(/bereits dem Server/)
    used.add(30000)
    await expect(m.create('d', { ...input, name: 'Vierter', port: 30000 })).rejects.toThrow(/belegt/)
  })

  it('räumt bei einem Fehler auf', async () => {
    const { m, dataDir } = setup({ downloadImpl: async () => { throw new Error('offline') } })
    await expect(m.create('t', input)).rejects.toThrow('offline')
    expect(existsSync(join(dataDir, 'servers'))).toBe(true)
    expect(m.list()).toHaveLength(0)
  })

  it('startet, trackt Spieler, stoppt und löscht', async () => {
    const { m, dataDir } = setup()
    const r = await m.create('t', input)
    await m.start(r.id)
    await waitFor(() => m.view(r.id).status === 'running')
    m.command(r.id, 'join Alex')
    await waitFor(() => m.view(r.id).players.includes('Alex'))
    await expect(m.remove(r.id)).rejects.toThrow(/Stoppe/)
    await m.stop(r.id)
    expect(m.view(r.id).status).toBe('stopped')
    expect(m.logs(r.id).some((l) => l.includes('Alex joined'))).toBe(true)
    await m.remove(r.id)
    expect(existsSync(join(dataDir, 'servers', r.id))).toBe(false)
  })

  it('startet nach einem Absturz automatisch neu', async () => {
    const { m } = setup()
    const r = await m.create('t', input)
    await m.start(r.id)
    await waitFor(() => m.view(r.id).status === 'running')
    m.command(r.id, 'crash')
    await waitFor(() => m.view(r.id).restarts === 1)
    await waitFor(() => m.view(r.id).status === 'running')
    await m.kill(r.id)
  })

  it('meldet Port-Konflikte beim Start und startet bei Konfigurationsfehlern nicht neu', async () => {
    const { m, used } = setup({}, { FAKE_FAIL: 'immediately' })
    const r = await m.create('t', input)
    used.add(r.port)
    await expect(m.start(r.id)).rejects.toThrow(/belegt/)
    used.clear()
    await m.start(r.id)
    await waitFor(() => m.view(r.id).status === 'crashed')
    expect(m.view(r.id).lastCrash?.kind).toBe('port-in-use')
    await new Promise((r) => setTimeout(r, 150))
    expect(m.view(r.id).restarts).toBe(0)
  })

  it('merkt sich laufende Server für den Neustart nach einem Update', async () => {
    const { m, dataDir } = setup()
    const r = await m.create('t', input)
    await m.start(r.id)
    await waitFor(() => m.view(r.id).status === 'running')
    await m.shutdownAll(true)
    expect(m.view(r.id).status).toBe('stopped')
    const again = new ServerManager({ dataDir, emit: () => {}, ensureJavaImpl: async () => 'java', portCheck: async () => true, launcher: () => ({ command: process.execPath, args: [fake], cwd: dataDir }) })
    await again.resume()
    await waitFor(() => again.view(r.id).status === 'running')
    await again.kill(r.id)
  })

  it('startet ohne resume nach dem Beenden nichts automatisch', async () => {
    const { m, dataDir } = setup()
    const r = await m.create('t', input)
    await m.start(r.id)
    await waitFor(() => m.view(r.id).status === 'running')
    await m.shutdownAll(false)
    const again = new ServerManager({ dataDir, emit: () => {}, ensureJavaImpl: async () => 'java', portCheck: async () => true })
    await again.resume()
    expect(again.view(r.id).status).toBe('stopped')
  })

  it('blockt Path-Traversal über die Server-ID', () => {
    const { m } = setup()
    for (const bad of ['../etc', 'a/../b', '..', '/abs']) expect(() => m.serverDir(bad)).toThrow()
  })

  it('übernimmt Port-Änderungen in server.properties', async () => {
    const { m } = setup()
    const r = await m.create('t', input)
    m.update(r.id, { port: 25999 })
    expect(m.getProperties(r.id)['server-port']).toBe('25999')
  })
})
