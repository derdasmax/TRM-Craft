import { describe, expect, it } from 'vitest'
import { listFromManifest, ManifestSchema, resolveVanilla } from './mojang'
import { compareVersionsDesc, listPaperVersions, resolvePaperBuild } from './paper'
import { javaForMinecraft, resolveJre } from './adoptium'
import { resolveBedrock } from './bedrock'
import { geyserConfig, resolveGeyser } from './geyser'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const router = (routes: Record<string, unknown>): typeof fetch => async (input) => {
  const url = String(input)
  for (const [k, v] of Object.entries(routes)) if (url.includes(k)) return v instanceof Response ? v.clone() : json(v)
  return json({}, 404)
}

const manifest = {
  latest: { release: '1.21.4', snapshot: '25w01a' },
  versions: [
    { id: '1.21.4', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/a/1.21.4.json', releaseTime: '2024-12-03T10:00:00+00:00' },
    { id: '25w01a', type: 'snapshot', url: 'https://piston-meta.mojang.com/v1/packages/b/25w01a.json', releaseTime: '2025-01-01T10:00:00+00:00' },
    { id: 'b1.7.3', type: 'old_beta', url: 'https://piston-meta.mojang.com/v1/packages/c/b1.7.3.json', releaseTime: '2011-07-01T00:00:00+00:00' },
    { id: '1.2.4', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/d/1.2.4.json', releaseTime: '2012-03-21T00:00:00+00:00' },
  ],
}

describe('mojang', () => {
  it('filtert auf Releases mit Server-Download', () => {
    const list = listFromManifest(ManifestSchema.parse(manifest))
    expect(list.map((v) => v.id)).toEqual(['1.21.4'])
    expect(listFromManifest(ManifestSchema.parse(manifest), true).map((v) => v.id)).toEqual(['1.21.4', '25w01a'])
  })
  it('löst Server-JAR und Java-Version auf', async () => {
    const f = router({
      'version_manifest_v2.json': manifest,
      '1.21.4.json': { id: '1.21.4', downloads: { server: { url: 'https://piston-data.mojang.com/s.jar', sha1: 'abc', size: 5 } }, javaVersion: { majorVersion: 21 } },
    })
    expect(await resolveVanilla('1.21.4', f)).toEqual({ url: 'https://piston-data.mojang.com/s.jar', sha1: 'abc', size: 5, javaMajor: 21 })
    await expect(resolveVanilla('9.9.9', f)).rejects.toThrow(/Unbekannte/)
  })
  it('nimmt Java 8, wenn javaVersion fehlt', async () => {
    const f = router({
      'version_manifest_v2.json': manifest,
      '1.21.4.json': { id: '1.21.4', downloads: { server: { url: 'https://piston-data.mojang.com/s.jar', sha1: 'a', size: 1 } } },
    })
    expect((await resolveVanilla('1.21.4', f)).javaMajor).toBe(8)
  })
})

describe('paper', () => {
  const v3build = (id: number, channel: string) => ({ id, channel, downloads: { 'server:default': { name: `paper-${id}.jar`, url: `https://fill-data.papermc.io/p${id}.jar`, checksums: { sha256: `h${id}` } } } })
  it('sortiert Versionen numerisch, neueste zuerst', async () => {
    expect(['1.9', '1.21.4', '1.21', '1.20.6'].sort(compareVersionsDesc)).toEqual(['1.21.4', '1.21', '1.20.6', '1.9'])
    const f = router({ '/v3/projects/paper': { versions: { '1.20': ['1.20.6', '1.20.4'], '1.21': ['1.21.4', '1.21.1'] } } })
    expect((await listPaperVersions('paper', f)).map((v) => v.id)).toEqual(['1.21.4', '1.21.1', '1.20.6', '1.20.4'])
  })
  it('wählt den neuesten STABLE-Build (v3)', async () => {
    const f = router({ '/v3/projects/paper/versions/1.21.4/builds': [v3build(10, 'STABLE'), v3build(12, 'BETA'), v3build(11, 'STABLE')] })
    expect(await resolvePaperBuild('1.21.4', 'paper', f)).toEqual({ build: '11', url: 'https://fill-data.papermc.io/p11.jar', sha256: 'h11' })
  })
  it('fällt auf die v2-API zurück', async () => {
    const f = router({
      '/v3/': new Response('nope', { status: 500 }),
      '/v2/projects/paper/versions/1.21.4/builds': { builds: [{ build: 5, channel: 'default', downloads: { application: { name: 'paper-1.21.4-5.jar', sha256: 'x' } } }] },
    })
    const r = await resolvePaperBuild('1.21.4', 'paper', f)
    expect(r).toMatchObject({ build: '5', sha256: 'x' })
    expect(r.url).toContain('/builds/5/downloads/paper-1.21.4-5.jar')
  })
})

describe('adoptium', () => {
  it('löst die JRE auf', async () => {
    const f = router({ '/assets/latest/21/': [{ binary: { package: { link: 'https://github.com/adoptium/x.zip', checksum: 'c', name: 'x.zip' } } }] })
    expect(await resolveJre(21, f)).toEqual({ url: 'https://github.com/adoptium/x.zip', sha256: 'c', name: 'x.zip' })
    await expect(resolveJre(8, router({ '/assets/latest/8/': [] }))).rejects.toThrow()
  })
  it('kennt die Java-Version je Minecraft-Version', () => {
    expect(javaForMinecraft('1.21.4')).toBe(21)
    expect(javaForMinecraft('1.20.5')).toBe(21)
    expect(javaForMinecraft('1.20.4')).toBe(17)
    expect(javaForMinecraft('1.18.2')).toBe(17)
    expect(javaForMinecraft('1.16.5')).toBe(8)
  })
})

describe('bedrock und geyser', () => {
  it('liest die Windows-Version aus dem Download-Link', async () => {
    const f = router({ 'download/links': { result: { links: [{ downloadType: 'serverBedrockLinux', downloadUrl: 'https://www.minecraft.net/x/bedrock-server-1.21.0.zip' }, { downloadType: 'serverBedrockWindows', downloadUrl: 'https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.21.50.7.zip' }] } } })
    expect(await resolveBedrock(f)).toEqual({ version: '1.21.50.7', url: 'https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.21.50.7.zip' })
    await expect(resolveBedrock(router({ 'download/links': { result: { links: [] } } }))).rejects.toThrow()
  })
  it('löst Geyser auf und erzeugt eine Konfiguration', async () => {
    const f = router({ '/projects/geyser/': { downloads: { spigot: { name: 'Geyser-Spigot.jar', sha256: 'h' } } } })
    expect(await resolveGeyser('geyser', f)).toEqual({ url: 'https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot', sha256: 'h', name: 'Geyser-Spigot.jar' })
    expect(geyserConfig(19133, 25566)).toMatch(/port: 19133[\s\S]*port: 25566[\s\S]*auth-type: floodgate/)
  })
})
