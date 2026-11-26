// Vertragstest gegen die ECHTEN APIs. Läuft nur mit LIVE_API=1 (siehe .github/workflows/api-check.yml).
import { describe, expect, it } from 'vitest'
import { fetchManifest, listFromManifest, resolveVanilla } from './mojang'
import { listPaperVersions, resolvePaperBuild } from './paper'
import { resolveJre } from './adoptium'
import { resolveBedrock } from './bedrock'
import { resolveGeyser } from './geyser'
import { searchHangar } from './hangar'
import { compatibleVersion, searchModrinth } from './modrinth'
import { listMetaGameVersions, resolveFabric, resolveQuilt } from './fabric'
import { listForgeVersions, listNeoForgeVersions, resolveForge, resolveNeoForge } from './forge'
import { listPurpurVersions, resolvePurpur } from './purpur'

const live = process.env.LIVE_API === '1'

describe.runIf(live)('Live-APIs', () => {
  it('Mojang: Manifest und Server-Download', async () => {
    const list = listFromManifest(await fetchManifest())
    expect(list.length).toBeGreaterThan(50)
    const v = await resolveVanilla(list[0]!.id)
    expect(v.url).toMatch(/^https:\/\/piston-data\.mojang\.com\//)
    expect(v.javaMajor).toBeGreaterThanOrEqual(8)
  }, 30_000)

  it('Paper: Versionen und Build', async () => {
    const list = await listPaperVersions()
    expect(list.length).toBeGreaterThan(10)
    const b = await resolvePaperBuild(list[0]!.id)
    expect(b.url).toMatch(/^https:\/\//)
    expect(b.sha256).toMatch(/^[0-9a-f]{64}$/)
  }, 30_000)

  it('Adoptium: Java 21 JRE für Windows', async () => {
    const j = await resolveJre(21)
    expect(j.url).toMatch(/^https:\/\//)
    expect(j.name).toMatch(/\.zip$/)
  }, 30_000)

  it('Fabric und Quilt', async () => {
    const v = await listMetaGameVersions('fabric')
    expect(v.length).toBeGreaterThan(10)
    expect((await resolveFabric(v[0]!.id)).url).toContain('/server/jar')
    expect((await resolveQuilt()).installerUrl).toMatch(/quilt-installer-.*\.jar$/)
    expect((await listMetaGameVersions('quilt')).length).toBeGreaterThan(5)
  }, 30_000)

  it('Forge und NeoForge', async () => {
    const f = await listForgeVersions()
    expect(f.length).toBeGreaterThan(10)
    expect((await resolveForge(f[0]!.id)).installerUrl).toContain('-installer.jar')
    const n = await listNeoForgeVersions()
    expect(n.length).toBeGreaterThan(3)
    expect((await resolveNeoForge(n[0]!.id)).installerUrl).toContain('-installer.jar')
  }, 30_000)

  it('Purpur', async () => {
    const v = await listPurpurVersions()
    expect(v.length).toBeGreaterThan(10)
    const r = await resolvePurpur(v[0]!.id)
    expect(r.md5).toMatch(/^[0-9a-f]{32}$/)
  }, 30_000)

  it('Folia, Velocity, Waterfall über die PaperMC-API', async () => {
    for (const project of ['folia', 'velocity', 'waterfall']) {
      const list = await listPaperVersions(project)
      expect(list.length, project).toBeGreaterThan(0)
      expect((await resolvePaperBuild(list[0]!.id, project)).url, project).toMatch(/^https:\/\//)
    }
  }, 60_000)

  it('Bedrock Dedicated Server und Geyser/Floodgate', async () => {
    const b = await resolveBedrock()
    expect(b.version).toMatch(/^\d+\.\d+\.\d+/)
    for (const p of ['geyser', 'floodgate'] as const) expect((await resolveGeyser(p)).sha256).toMatch(/^[0-9a-f]{64}$/)
  }, 30_000)

  it('Modrinth: Suche und kompatible Version', async () => {
    const r = await searchModrinth({ query: 'sodium', kind: 'mod', loaders: ['fabric'], mcVersion: '1.21.4', offset: 0 })
    expect(r.hits.length).toBeGreaterThan(0)
    const v = await compatibleVersion(r.hits[0]!.id, ['fabric'], '1.21.4')
    expect(v?.files[0]?.hashes.sha512).toMatch(/^[0-9a-f]{128}$/)
    const packs = await searchModrinth({ query: '', kind: 'modpack', loaders: [], offset: 0 })
    expect(packs.hits.length).toBeGreaterThan(0)
  }, 30_000)

  it('Hangar: Suche', async () => {
    const r = await searchHangar('worldedit', 'PAPER', undefined, 0)
    expect(r.hits.length).toBeGreaterThan(0)
  }, 30_000)
})
