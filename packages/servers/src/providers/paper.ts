import { z } from 'zod'
import type { VersionInfo } from '@trm/core'
import { fetchJson, type FetchLike } from '../download'

const V3 = 'https://fill.papermc.io/v3/projects'
const V2 = 'https://api.papermc.io/v2/projects'

export const V3ProjectSchema = z.object({ versions: z.record(z.array(z.string())) })
export const V3BuildSchema = z.object({
  id: z.number(),
  channel: z.string(),
  downloads: z.record(z.object({ name: z.string(), url: z.string().url(), size: z.number().optional(), checksums: z.object({ sha256: z.string() }) })),
})
export const V2ProjectSchema = z.object({ versions: z.array(z.string()) })
export const V2BuildsSchema = z.object({
  builds: z.array(z.object({ build: z.number(), channel: z.string(), downloads: z.object({ application: z.object({ name: z.string(), sha256: z.string() }) }) })),
})

/** Vergleicht Versionen wie 1.21.4 numerisch (neueste zuerst). */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d) return d
  }
  return 0
}

export async function listPaperVersions(project = 'paper', f?: FetchLike): Promise<VersionInfo[]> {
  let ids: string[]
  try {
    const p = V3ProjectSchema.parse(await fetchJson(`${V3}/${project}`, f))
    ids = Object.values(p.versions).flat()
  } catch {
    ids = V2ProjectSchema.parse(await fetchJson(`${V2}/${project}`, f)).versions
  }
  return [...new Set(ids)].sort(compareVersionsDesc).map((id) => ({ id, type: /-(pre|rc)/i.test(id) ? ('snapshot' as const) : ('release' as const) }))
}

export interface ResolvedBuild {
  build: string
  url: string
  sha256: string
}

export async function resolvePaperBuild(version: string, project = 'paper', f?: FetchLike): Promise<ResolvedBuild> {
  try {
    const builds = z.array(V3BuildSchema).parse(await fetchJson(`${V3}/${project}/versions/${encodeURIComponent(version)}/builds`, f))
    const stable = builds.filter((b) => b.channel === 'STABLE')
    const pick = (stable.length ? stable : builds).sort((a, b) => b.id - a.id)[0]
    const dl = pick && (pick.downloads['server:default'] ?? Object.values(pick.downloads)[0])
    if (!pick || !dl) throw new Error('kein Build')
    return { build: String(pick.id), url: dl.url, sha256: dl.checksums.sha256 }
  } catch {
    const b = V2BuildsSchema.parse(await fetchJson(`${V2}/${project}/versions/${encodeURIComponent(version)}/builds`, f)).builds
    const stable = b.filter((x) => x.channel === 'default')
    const pick = (stable.length ? stable : b).sort((x, y) => y.build - x.build)[0]
    if (!pick) throw new Error(`Kein Build für ${project} ${version}`)
    const d = pick.downloads.application
    return { build: String(pick.build), url: `${V2}/${project}/versions/${encodeURIComponent(version)}/builds/${pick.build}/downloads/${d.name}`, sha256: d.sha256 }
  }
}
