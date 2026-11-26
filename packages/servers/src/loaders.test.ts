import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOADERS, LOADER_INFO, ServerRecordSchema } from '@trm/core'
import { jvmArgs } from './jvm'
import { detectForgeLaunch, LOADER_DEFS } from './loaders'
import { listMetaGameVersions, resolveFabric, resolveQuilt } from './providers/fabric'
import { listForgeVersions, listNeoForgeVersions, neoForgeToMc, resolveForge, resolveNeoForge } from './providers/forge'
import { listPurpurVersions, resolvePurpur } from './providers/purpur'

const json = (d: unknown) => new Response(JSON.stringify(d))
const router = (routes: Record<string, unknown>): typeof fetch => async (input) => {
  const url = String(input)
  const hit = Object.entries(routes).sort((a, b) => b[0].length - a[0].length).find(([k]) => url.includes(k))
  return hit ? json(hit[1]) : new Response('{}', { status: 404 })
}

describe('Fabric und Quilt', () => {
  it('listet nur stabile Spielversionen', async () => {
    const f = router({ '/versions/game': [{ version: '1.21.4', stable: true }, { version: '25w01a', stable: false }] })
    expect((await listMetaGameVersions('fabric', f)).map((v) => v.id)).toEqual(['1.21.4'])
  })
  it('baut die Fabric-Server-URL aus Loader und Installer', async () => {
    const f = router({ '/versions/loader': [{ version: '0.17.0-beta', stable: false }, { version: '0.16.9', stable: true }], '/versions/installer': [{ version: '1.0.1', stable: true }] })
    const r = await resolveFabric('1.21.4', f)
    expect(r.url).toBe('https://meta.fabricmc.net/v2/versions/loader/1.21.4/0.16.9/1.0.1/server/jar')
  })
  it('findet den Quilt-Installer', async () => {
    const f = router({ '/versions/installer': [{ version: '0.9.2', stable: true }] })
    expect((await resolveQuilt(f)).installerUrl).toContain('quilt-installer-0.9.2.jar')
  })
})

describe('Forge und NeoForge', () => {
  const promos = { promos: { '1.20.1-latest': '47.3.0', '1.20.1-recommended': '47.2.0', '1.21.4-latest': '54.0.1', '1.7.10_pre4-latest': '10.0' } }
  it('listet Minecraft-Versionen mit Forge', async () => {
    expect((await listForgeVersions(router({ promotions_slim: promos }))).map((v) => v.id)).toEqual(['1.21.4', '1.20.1'])
  })
  it('bevorzugt die empfohlene Forge-Version', async () => {
    const r = await resolveForge('1.20.1', router({ promotions_slim: promos }))
    expect(r.forgeVersion).toBe('47.2.0')
    expect(r.installerUrl).toBe('https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-installer.jar')
    expect((await resolveForge('1.21.4', router({ promotions_slim: promos }))).forgeVersion).toBe('54.0.1')
    await expect(resolveForge('1.2.3', router({ promotions_slim: promos }))).rejects.toThrow()
  })
  it('ordnet NeoForge-Versionen Minecraft zu', async () => {
    expect(neoForgeToMc('21.1.77')).toBe('1.21.1')
    expect(neoForgeToMc('21.0.5')).toBe('1.21')
    expect(neoForgeToMc('20.4.237')).toBe('1.20.4')
    const f = router({ '/neoforge': { versions: ['20.4.1', '21.1.5', '21.1.77', '21.1.80-beta', '21.0.9'] } })
    expect((await listNeoForgeVersions(f)).map((v) => v.id)).toEqual(['1.21.1', '1.21', '1.20.4'])
    expect((await resolveNeoForge('1.21.1', f)).neoVersion).toBe('21.1.77')
  })
})

describe('Purpur', () => {
  it('löst den neuesten Build samt MD5 auf', async () => {
    const f = router({ '/v2/purpur/1.21.4/2300': { md5: 'abc' }, '/v2/purpur/1.21.4': { builds: { latest: '2300', all: ['2299', '2300'] } }, '/v2/purpur': { versions: ['1.20.4', '1.21.4'] } })
    expect((await listPurpurVersions(f)).map((v) => v.id)).toEqual(['1.21.4', '1.20.4'])
    expect(await resolvePurpur('1.21.4', f)).toEqual({ build: '2300', url: 'https://api.purpurmc.org/v2/purpur/1.21.4/2300/download', md5: 'abc' })
  })
})

describe('Start-Erkennung und Argumente', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'trm-forge-'))
  it('erkennt moderne Forge-Installationen mit args-Datei', () => {
    const d = dir()
    const lib = join(d, 'libraries/net/minecraftforge/forge/1.20.1-47.2.0')
    mkdirSync(lib, { recursive: true })
    writeFileSync(join(lib, 'win_args.txt'), '')
    expect(detectForgeLaunch(d, 'net/minecraftforge/forge', '1.20.1-47.2.0')).toEqual({ type: 'args', argsFile: 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/{platform}_args.txt' })
  })
  it('erkennt alte Forge-Installationen mit JAR', () => {
    const d = dir()
    writeFileSync(join(d, 'forge-1.12.2-14.23.5.2860.jar'), '')
    writeFileSync(join(d, 'forge-installer.jar'), '')
    expect(detectForgeLaunch(d, 'net/minecraftforge/forge', 'x')).toEqual({ type: 'jar', jar: 'forge-1.12.2-14.23.5.2860.jar' })
  })
  it('wirft, wenn nichts startbar ist', () => expect(() => detectForgeLaunch(dir(), 'a/b', 'c')).toThrow())
  it('baut JVM-Argumente für beide Startarten', () => {
    const base = { ramMb: 2048, jvmPreset: 'none' as const }
    expect(jvmArgs({ ...base, launch: { type: 'jar', jar: 'server.jar' } })).toEqual(['-Xms2048M', '-Xmx2048M', '-jar', 'server.jar', 'nogui'])
    expect(jvmArgs({ ...base, launch: { type: 'args', argsFile: 'libraries/x/{platform}_args.txt' } }, 'win32')).toEqual(['-Xms2048M', '-Xmx2048M', '@libraries/x/win_args.txt', 'nogui'])
    expect(jvmArgs({ ...base, launch: { type: 'args', argsFile: 'libraries/x/{platform}_args.txt' } }, 'linux').at(-2)).toBe('@libraries/x/unix_args.txt')
  })
})

describe('Registry', () => {
  it('hat zu jedem Loader eine Definition und Metadaten', () => {
    for (const l of LOADERS) {
      expect(LOADER_DEFS[l], l).toBeDefined()
      expect(LOADER_INFO[l], l).toBeDefined()
    }
    expect(LOADERS).toEqual(expect.arrayContaining(['forge', 'neoforge', 'fabric', 'quilt', 'purpur', 'folia', 'spigot', 'velocity', 'waterfall', 'bungeecord']))
  })
  it('alte Server-Einträge ohne launch bleiben lesbar', () => {
    const r = ServerRecordSchema.parse({ id: 'a', name: 'A', loader: 'paper', mcVersion: '1.21.4', port: 25565, ramMb: 2048, javaMajor: 21, eulaAcceptedAt: null, createdAt: 'x' })
    expect(r.launch).toEqual({ type: 'jar', jar: 'server.jar' })
  })
})
