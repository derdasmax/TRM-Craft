import { z } from 'zod'
import type { Loader, ModHit } from '@trm/core'
import { fetchJson, type FetchLike } from '../download'

const API = 'https://hangar.papermc.io/api/v1'

const ProjectSchema = z.object({
  name: z.string(), description: z.string().default(''), avatarUrl: z.string().optional(),
  namespace: z.object({ owner: z.string(), slug: z.string() }), stats: z.object({ downloads: z.number() }).partial().optional(), category: z.string().optional(),
})
const SearchSchema = z.object({ pagination: z.object({ count: z.number() }), result: z.array(ProjectSchema) })
const VersionSchema = z.object({
  name: z.string(),
  downloads: z.record(z.object({ fileInfo: z.object({ name: z.string(), sha256Hash: z.string() }).optional(), downloadUrl: z.string().nullable().optional(), externalUrl: z.string().nullable().optional() })),
  pluginDependencies: z.record(z.array(z.object({ name: z.string(), required: z.boolean() }))).default({}),
})
const VersionsSchema = z.object({ result: z.array(VersionSchema) })

export function hangarPlatform(loader: Loader): 'PAPER' | 'VELOCITY' | 'WATERFALL' | null {
  if (loader === 'paper' || loader === 'purpur' || loader === 'folia' || loader === 'spigot') return 'PAPER'
  if (loader === 'velocity') return 'VELOCITY'
  if (loader === 'waterfall' || loader === 'bungeecord') return 'WATERFALL'
  return null
}

export async function searchHangar(query: string, platform: string, mcVersion: string | undefined, offset: number, f?: FetchLike): Promise<{ hits: ModHit[]; total: number }> {
  const url = `${API}/projects?q=${encodeURIComponent(query)}&limit=20&offset=${offset}&platform=${platform}${mcVersion && platform === 'PAPER' ? `&version=${encodeURIComponent(mcVersion)}` : ''}&sort=-downloads`
  const r = SearchSchema.parse(await fetchJson(url, f))
  return {
    total: r.pagination.count,
    hits: r.result.map((p) => ({ source: 'hangar' as const, id: `${p.namespace.owner}/${p.namespace.slug}`, slug: p.namespace.slug, title: p.name, description: p.description, iconUrl: p.avatarUrl, downloads: p.stats?.downloads ?? 0, author: p.namespace.owner, categories: p.category ? [p.category] : [] })),
  }
}

export interface HangarFile { version: string; url: string; fileName: string; sha256: string; requiredPlugins: string[] }

/** Neueste Version für die Plattform. Externe Downloads (nicht bei Hangar gehostet) werden abgelehnt. */
export async function resolveHangar(owner: string, slug: string, platform: string, mcVersion: string | undefined, f?: FetchLike): Promise<HangarFile | null> {
  const url = `${API}/projects/${encodeURIComponent(slug)}/versions?limit=1&platform=${platform}${mcVersion && platform === 'PAPER' ? `&platformVersion=${encodeURIComponent(mcVersion)}` : ''}`
  const v = VersionsSchema.parse(await fetchJson(url, f)).result[0]
  if (!v) return null
  const dl = v.downloads[platform]
  if (!dl?.fileInfo) throw new Error('Dieses Plugin wird extern gehostet und kann nicht automatisch installiert werden.')
  return {
    version: v.name,
    url: `${API}/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(v.name)}/${platform}/download`,
    fileName: dl.fileInfo.name, sha256: dl.fileInfo.sha256Hash,
    requiredPlugins: (v.pluginDependencies[platform] ?? []).filter((d) => d.required).map((d) => d.name),
  }
}
