import archiver from 'archiver'
import { createWriteStream, mkdirSync, mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('installiert Forge über den Installer und startet per Argument-Datei', async () => {
    const calls: string[][] = []
    const { m, dataDir } = setup({
      installerRunner: async ({ args, cwd }) => {
        calls.push(args)
        const lib = join(cwd, 'libraries/net/minecraftforge/forge/1.20.1-47.2.0')
        mkdirSync(lib, { recursive: true })
        writeFileSync(join(lib, 'unix_args.txt'), '')
      },
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('promotions_slim')) return new Response(JSON.stringify({ promos: { '1.20.1-recommended': '47.2.0' } }))
        if (url.includes('version_manifest')) return new Response(JSON.stringify({ latest: { release: '1.20.1', snapshot: 'x' }, versions: [{ id: '1.20.1', type: 'release', url: 'https://piston-meta.mojang.com/v.json', releaseTime: '2023-06-12T00:00:00+00:00' }] }))
        if (url.endsWith('/v.json')) return new Response(JSON.stringify({ id: '1.20.1', downloads: { server: { url: 'https://piston-data.mojang.com/s.jar', sha1: 'a', size: 1 } }, javaVersion: { majorVersion: 17 } }))
        return new Response('{}', { status: 404 })
      }) as typeof fetch,
    })
    const r = await m.create('t', { ...input, loader: 'forge', mcVersion: '1.20.1' })
    expect(calls[0]).toEqual(['-jar', 'forge-installer.jar', '--installServer'])
    expect(r.javaMajor).toBe(17)
    expect(r.build).toBe('47.2.0')
    expect(r.launch).toEqual({ type: 'args', argsFile: 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/{platform}_args.txt' })
    expect(existsSync(join(dataDir, 'servers', r.id, 'mods'))).toBe(true)
    expect(existsSync(join(dataDir, 'servers', r.id, 'forge-installer.jar'))).toBe(false)
  })

  it('legt Proxys ohne EULA und Properties an, aber nur auf Port 25577', async () => {
    const proxyFetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/v3/projects/velocity/versions/3.4.0-SNAPSHOT/builds')) return new Response(JSON.stringify([{ id: 1, channel: 'STABLE', downloads: { 'server:default': { name: 'v.jar', url: 'https://fill-data.papermc.io/v.jar', checksums: { sha256: 'x' } } } }]))
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const { m, dataDir, used } = setup({ fetchImpl: proxyFetch })
    const r = await m.create('t', { name: 'Netzwerk', loader: 'velocity', mcVersion: '3.4.0-SNAPSHOT', ramMb: 512, acceptEula: true })
    expect(r.port).toBe(25577)
    expect(r.javaMajor).toBe(21)
    expect(r.eulaAcceptedAt).toBeNull()
    expect(existsSync(join(dataDir, 'servers', r.id, 'eula.txt'))).toBe(false)
    expect(existsSync(join(dataDir, 'servers', r.id, 'server.properties'))).toBe(false)
    expect(() => m.update(r.id, { port: 25999 })).toThrow(/Proxys/)
    used.add(25577)
    const { m: m2, used: u2 } = setup({ fetchImpl: proxyFetch })
    u2.add(25577)
    await expect(m2.create('t2', { name: 'Zweiter', loader: 'velocity', mcVersion: '3.4.0-SNAPSHOT', ramMb: 512, acceptEula: true })).rejects.toThrow(/25577/)
  })

  it('legt einen Bedrock-Server ohne Java an und behält die Standard-Properties', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes('download/links')) return new Response(JSON.stringify({ result: { links: [{ downloadType: 'serverBedrockWindows', downloadUrl: 'https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.21.50.7.zip' }] } }))
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const { m, dataDir } = setup({
      fetchImpl,
      ensureJavaImpl: async () => { throw new Error('Java darf nicht geladen werden') },
      downloadImpl: async (o) => {
        await new Promise<void>((resolve) => {
          mkdirSync(join(o.dest, '..'), { recursive: true })
          const out = createWriteStream(o.dest)
          out.on('close', () => resolve())
          const a = archiver('zip')
          a.pipe(out)
          a.append('exe', { name: 'bedrock_server.exe' })
          a.append('server-name=Dedicated Server\nserver-port=19132\nallow-cheats=false\n', { name: 'server.properties' })
          void a.finalize()
        })
      },
    })
    const r = await m.create('b', { name: 'Handy-Welt', loader: 'bedrock', mcVersion: '1.21.50.7', ramMb: 1024, acceptEula: true, motd: 'Hallo', gamemode: 'creative' })
    expect(r.edition).toBe('bedrock')
    expect(r.port).toBe(19132)
    expect(r.javaMajor).toBeUndefined()
    expect(r.launch).toEqual({ type: 'exe', exe: 'bedrock_server.exe' })
    expect(r.eulaAcceptedAt).not.toBeNull()
    expect(m.getProperties(r.id)).toMatchObject({ 'server-name': 'Hallo', gamemode: 'creative', 'server-port': '19132', 'allow-cheats': 'false' })
    expect(existsSync(join(dataDir, 'servers', r.id, 'eula.txt'))).toBe(false)
    expect(existsSync(join(dataDir, 'servers', r.id, 'bedrock-server.zip'))).toBe(false)
  })

  it('richtet Crossplay mit Geyser und Floodgate ein und trennt die Bedrock-Ports', async () => {
    const downloaded: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('download.geysermc.org')) return new Response(JSON.stringify({ downloads: { spigot: { name: 'x.jar', sha256: 'abc' } } }))
      if (url.includes('/v3/projects/paper/versions/1.21.4/builds')) return new Response(JSON.stringify([{ id: 9, channel: 'STABLE', downloads: { 'server:default': { name: 'p.jar', url: 'https://fill-data.papermc.io/p.jar', checksums: { sha256: 'x' } } } }]))
      if (url.includes('version_manifest')) return new Response(JSON.stringify({ latest: { release: '1.21.4', snapshot: 'x' }, versions: [{ id: '1.21.4', type: 'release', url: 'https://piston-meta.mojang.com/v.json', releaseTime: '2024-12-03T00:00:00+00:00' }] }))
      if (url.endsWith('/v.json')) return new Response(JSON.stringify({ id: '1.21.4', downloads: { server: { url: 'https://piston-data.mojang.com/s.jar', sha1: 'a', size: 1 } }, javaVersion: { majorVersion: 21 } }))
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const { m, dataDir } = setup({ fetchImpl, downloadImpl: async (o) => { downloaded.push(o.dest); mkdirSync(join(o.dest, '..'), { recursive: true }); writeFileSync(o.dest, 'jar') } })
    const paper = { ...input, loader: 'paper' as const, crossplay: true }
    const a = await m.create('a', paper)
    const b = await m.create('b', { ...paper, name: 'Zweiter' })
    expect(a.crossplay).toBe(true)
    expect([a.port, a.bedrockPort]).toEqual([25565, 19132])
    expect([b.port, b.bedrockPort]).toEqual([25566, 19133])
    const plugins = join(dataDir, 'servers', a.id, 'plugins')
    expect(existsSync(join(plugins, 'Geyser-Spigot.jar'))).toBe(true)
    expect(existsSync(join(plugins, 'floodgate-Spigot.jar'))).toBe(true)
    const cfg = readFileSync(join(plugins, 'Geyser-Spigot', 'config.yml'), 'utf8')
    expect(cfg).toContain('port: 19132')
    expect(cfg).toContain('auth-type: floodgate')
    // Vanilla kennt keine Plugins: Crossplay wird dort ignoriert.
    const v = await m.create('v', { ...input, name: 'Pur', loader: 'vanilla', crossplay: true })
    expect(v.crossplay).toBe(false)
    expect(downloaded.some((d) => d.includes('Geyser'))).toBe(true)
  })
})

describe('ServerManager: Betrieb', () => {
  it('führt Spielerverlauf und Aktionen', async () => {
    const { m } = setup()
    const r = await m.create('t', input)
    await m.start(r.id)
    await waitFor(() => m.view(r.id).status === 'running')
    m.command(r.id, 'join Alex')
    await waitFor(() => m.playersList(r.id).some((p) => p.name === 'Alex' && p.online))
    m.playerAction(r.id, 'say', 'Hallo Welt')
    await waitFor(() => m.logs(r.id).some((l) => l.includes('Hallo Welt')))
    expect(() => m.playerAction(r.id, 'op', 'x\nstop')).toThrow()
    m.command(r.id, 'leave Alex')
    await waitFor(() => m.playersList(r.id)[0]?.online === false)
    await m.stop(r.id)
    expect(m.playersList(r.id)[0]).toMatchObject({ name: 'Alex', sessions: 1 })
  })

  it('erstellt Backups im Standardordner, listet sie und löscht den Server samt Daten sauber', async () => {
    const { m, dataDir } = setup()
    const r = await m.create('t', input)
    const b = await m.backupCreate(r.id, 'Test')
    expect(existsSync(join(dataDir, 'backups', r.id, b.file))).toBe(true)
    expect(m.backupsList(r.id)).toHaveLength(1)
    m.update(r.id, { backup: { keep: 1 } })
    await m.backupCreate(r.id)
    expect(m.backupsList(r.id)).toHaveLength(1)
    expect(() => m.update(r.id, { backup: { dir: 'relativ', keep: 3 } })).not.toThrow()
    expect(() => m.backupDir(r.id)).toThrow(/absolut/)
  })

  it('verwaltet Welten und erzwingt gestoppten Server', async () => {
    const { m, dataDir } = setup()
    const r = await m.create('t', input)
    const w = join(dataDir, 'servers', r.id, 'zweite')
    mkdirSync(w, { recursive: true })
    writeFileSync(join(w, 'level.dat'), 'x')
    expect((await m.worldsList(r.id)).map((x) => x.name)).toEqual(['zweite'])
    await m.setActiveWorld(r.id, 'zweite')
    expect(m.getProperties(r.id)['level-name']).toBe('zweite')
    await expect(m.setActiveWorld(r.id, '../x')).rejects.toThrow(/nicht gefunden/)
    await m.resetWorld(r.id, 'zweite')
    expect(existsSync(w)).toBe(false)
    expect(m.backupsList(r.id).some((b) => b.label?.startsWith('vor-reset'))).toBe(true)
  })

  it('misst Leistung und fragt keine TPS bei Vanilla ab', async () => {
    const reader = async (pids: number[]) => new Map(pids.map((p) => [p, { cpuMs: Date.now() % 1000, rssBytes: 512 * 1048576 }]))
    const { m } = setup({ statReader: reader })
    const r = await m.create('t', input)
    await m.start(r.id)
    await waitFor(() => m.view(r.id).status === 'running')
    await m.sample(1000)
    await m.sample(6000)
    const h = m.statsHistory(r.id)
    expect(h).toHaveLength(2)
    expect(h[1]).toMatchObject({ ramMb: 512, players: 0 })
    await m.kill(r.id)
  })

  it('warnt vor einem Neustart in Stufen', async () => {
    const { m } = setup()
    const r = await m.create('t', input)
    await m.start(r.id)
    await waitFor(() => m.view(r.id).status === 'running')
    const waits: number[] = []
    await m.restartWithWarning(r.id, 60, async (ms) => void waits.push(ms / 1000))
    expect(waits).toEqual([30, 20, 10])
    expect(m.logs(r.id).length).toBeGreaterThanOrEqual(0)
    await waitFor(() => m.view(r.id).status === 'running')
    await m.kill(r.id)
  })
})

describe('Server-Icon', () => {
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(33)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(b)
    b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
    return b.toString('base64')
  }
  it('akzeptiert nur 64x64-PNGs', async () => {
    const { m, dataDir } = setup()
    const r = await m.create('t', input)
    expect(m.getIcon(r.id)).toBeNull()
    m.setIcon(r.id, png(64, 64))
    expect(existsSync(join(dataDir, 'servers', r.id, 'server-icon.png'))).toBe(true)
    expect(m.getIcon(r.id)).toMatch(/^data:image\/png;base64,/)
    expect(() => m.setIcon(r.id, png(128, 64))).toThrow(/64 x 64/)
    expect(() => m.setIcon(r.id, Buffer.from('keinpng-keinpng-keinpng-keinpng').toString('base64'))).toThrow(/PNG/)
  })
})

describe('ServerManager: Limits, Software-Updates, Klonen, Import', () => {
  it('begrenzt CPU-Kerne über die JVM', async () => {
    const { jvmArgs } = await import('./jvm')
    const base = { ramMb: 2048, jvmPreset: 'none' as const, launch: { type: 'jar' as const, jar: 'server.jar' } }
    expect(jvmArgs({ ...base, limits: { cores: 2, priority: 'low' } })).toContain('-XX:ActiveProcessorCount=2')
    expect(jvmArgs({ ...base, limits: { priority: 'normal' } }).some((a) => a.includes('ActiveProcessorCount'))).toBe(false)
    const { m } = setup()
    const r = await m.create('t', input)
    expect(m.update(r.id, { limits: { cores: 2, priority: 'low' } }).limits).toEqual({ cores: 2, priority: 'low' })
    expect(() => m.update(r.id, { limits: { cores: 0, priority: 'low' } })).toThrow()
  })

  it('erkennt neue Builds und ersetzt server.jar nach einem Backup', async () => {
    const paper = { ...input, loader: 'paper' as const }
    let latest = '10'
    const loaderDefs = {
      ...(await import('./loaders')).LOADER_DEFS,
      paper: {
        versions: async () => [], javaMajor: async () => 21, latest: async () => latest,
        install: async (c: { dir: string }) => { writeFileSync(join(c.dir, 'server.jar'), `build-${latest}`); return { build: latest, launch: { type: 'jar' as const, jar: 'server.jar' } } },
      },
    }
    const { m, dataDir } = setup({ loaderDefs: loaderDefs as never })
    const r = await m.create('t', paper)
    expect(r.build).toBe('10')
    expect(await m.softwareStatus(r.id)).toMatchObject({ supported: true, available: false })
    await expect(m.updateSoftware(r.id)).rejects.toThrow(/bereits aktuell/)
    latest = '12'
    expect(await m.softwareStatus(r.id)).toMatchObject({ available: true, current: '10', latest: '12' })
    await m.start(r.id)
    await waitFor(() => m.view(r.id).status === 'running')
    await expect(m.updateSoftware(r.id)).rejects.toThrow(/Stoppe/)
    await m.stop(r.id)
    await m.updateSoftware(r.id)
    expect(readFileSync(join(dataDir, 'servers', r.id, 'server.jar'), 'utf8')).toBe('build-12')
    expect(readFileSync(join(dataDir, 'servers', r.id, '.trm', 'server.jar.alt'), 'utf8')).toBe('build-10')
    expect(m.view(r.id).build).toBe('12')
    expect(m.backupsList(r.id).some((b) => b.label === 'vor-update')).toBe(true)
    expect(readdirSync(join(dataDir, 'servers', r.id)).some((f) => f.startsWith('.trm-sw-'))).toBe(false)
  })

  it('meldet, wenn Software nicht automatisch aktualisiert werden kann', async () => {
    const { m } = setup()
    const r = await m.create('t', input) // vanilla: kein latest()
    expect(await m.softwareStatus(r.id)).toMatchObject({ supported: false })
  })

  it('klont einen Server mit neuer ID, freiem Port und ohne Logs', async () => {
    const { m, dataDir } = setup()
    const r = await m.create('t', input)
    const src = join(dataDir, 'servers', r.id)
    mkdirSync(join(src, 'logs'), { recursive: true })
    writeFileSync(join(src, 'logs', 'latest.log'), 'x')
    mkdirSync(join(src, 'world'), { recursive: true })
    writeFileSync(join(src, 'world', 'level.dat'), 'welt')
    const c = await m.clone(r.id, 'Kopie')
    expect(c.id).not.toBe(r.id)
    expect(c.port).toBe(r.port + 1)
    expect(c.autostart).toBe(false)
    const dst = join(dataDir, 'servers', c.id)
    expect(readFileSync(join(dst, 'world', 'level.dat'), 'utf8')).toBe('welt')
    expect(existsSync(join(dst, 'logs'))).toBe(false)
    expect(m.getProperties(c.id)['server-port']).toBe(String(c.port))
    await m.start(r.id)
    await waitFor(() => m.view(r.id).status === 'running')
    await expect(m.clone(r.id, 'Nochmal')).rejects.toThrow(/Stoppe/)
    await m.kill(r.id)
  })

  it('importiert einen vorhandenen Ordner, vermeidet Port-Konflikte und verlangt die EULA', async () => {
    const { m, dataDir } = setup()
    const a = await m.create('t', input)
    const folder = mkdtempSync(join(tmpdir(), 'trm-imp-'))
    writeFileSync(join(folder, 'paper-1.21.4-100.jar'), 'jar')
    writeFileSync(join(folder, 'server.properties'), `server-port=${a.port}\nmotd=Alt\n`)
    mkdirSync(join(folder, 'world'))
    writeFileSync(join(folder, 'world', 'level.dat'), 'x')
    const imp = { path: folder, name: 'Importiert', loader: 'paper' as const, mcVersion: '1.21.4', ramMb: 2048, acceptEula: true as const }
    await expect(m.importFolder({ ...imp, acceptEula: false as never })).rejects.toThrow()
    const r = await m.importFolder(imp)
    expect(r.launch).toEqual({ type: 'jar', jar: 'paper-1.21.4-100.jar' })
    expect(r.port).toBe(a.port + 1)
    expect(m.getProperties(r.id)).toMatchObject({ 'server-port': String(r.port), motd: 'Alt' })
    expect(readFileSync(join(dataDir, 'servers', r.id, 'eula.txt'), 'utf8')).toContain('eula=true')
    expect(existsSync(join(folder, 'eula.txt'))).toBe(false) // Quelle bleibt unverändert
    await expect(m.importFolder({ ...imp, path: join(dataDir, 'servers', a.id) })).rejects.toThrow(/nicht importiert/)
    const leer = mkdtempSync(join(tmpdir(), 'trm-leer-'))
    await expect(m.importFolder({ ...imp, path: leer })).rejects.toThrow(/keine Server-JAR/)
    await expect(m.importFolder({ ...imp, path: 'relativ/pfad' })).rejects.toThrow(/existiert nicht/)
  })

  it('erkennt Forge-Startdateien beim Import', async () => {
    const { detectLaunch } = await import('./manager')
    const d = mkdtempSync(join(tmpdir(), 'trm-fg-'))
    mkdirSync(join(d, 'libraries/net/minecraftforge/forge/1.20.1-47.2.0'), { recursive: true })
    writeFileSync(join(d, 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/win_args.txt'), '')
    expect(detectLaunch(d)).toEqual({ type: 'args', argsFile: 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/{platform}_args.txt' })
    writeFileSync(join(d, 'a.jar'), ''); writeFileSync(join(d, 'b.jar'), '')
    expect(detectLaunch(mkdtempSync(join(tmpdir(), 'trm-2jar-')))).toBeNull()
  })
})
