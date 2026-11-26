import { z } from 'zod'
import type { VersionInfo } from '@trm/core'
import { fetchJson, type FetchLike } from '../download'
import { compareVersionsDesc } from './paper'

const API = 'https://api.purpurmc.org/v2/purpur'
const ProjectSchema = z.object({ versions: z.array(z.string()) })
const VersionSchema = z.object({ builds: z.object({ latest: z.string(), all: z.array(z.string()) }) })
const BuildSchema = z.object({ result: z.string().optional(), md5: z.string() })

export async function listPurpurVersions(f?: FetchLike): Promise<VersionInfo[]> {
  const p = ProjectSchema.parse(await fetchJson(API, f))
  return [...p.versions].sort(compareVersionsDesc).map((id) => ({ id, type: 'release' as const }))
}

export async function resolvePurpur(version: string, f?: FetchLike): Promise<{ build: string; url: string; md5: string }> {
  const v = VersionSchema.parse(await fetchJson(`${API}/${encodeURIComponent(version)}`, f))
  const b = BuildSchema.parse(await fetchJson(`${API}/${encodeURIComponent(version)}/${v.builds.latest}`, f))
  return { build: v.builds.latest, url: `${API}/${encodeURIComponent(version)}/${v.builds.latest}/download`, md5: b.md5 }
}
