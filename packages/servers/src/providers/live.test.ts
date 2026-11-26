// Vertragstest gegen die ECHTEN APIs. Läuft nur mit LIVE_API=1 (siehe .github/workflows/api-check.yml).
import { describe, expect, it } from 'vitest'
import { fetchManifest, listFromManifest, resolveVanilla } from './mojang'
import { listPaperVersions, resolvePaperBuild } from './paper'
import { resolveJre } from './adoptium'

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
})
