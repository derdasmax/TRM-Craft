import { z } from 'zod'
import type { Loader, ModHit, ModKind } from '@trm/core'
import { fetchJson, assertAllowedUrl, type FetchLike } from '../download'

const API = 'https://api.modrinth.com/v2'

export const HitSchema = z.object({
  project_id: z.string(), slug: z.string(), title: z.string(), description: z.string(),
  icon_url: z.string().nullable().optional(), downloads: z.number(), author: z.string().optional(), categories: z.array(z.string()).default([]),
})
export const SearchSchema = z.object({ hits: z.array(HitSchema), total_hits: z.number() })
export const FileSchema = z.object({ hashes: z.object({ sha1: z.string(), sha512: z.string() }), url: z.string().url(), filename: z.string(), primary: z.boolean(), size: z.number().optional() })
export const DependencySchema = z.object({ version_id: z.string().nullable().optional(), project_id: z.string().nullable().optional(), dependency_type: z.string() })
export const VersionSchema = z.object({
  id: z.string(), project_id: z.string(), name: z.string(), version_number: z.string(), version_type: z.string().optional(),
  files: z.array(FileSchema), dependencies: z.array(DependencySchema).default([]), game_versions: z.array(z.string()).default([]), loaders: z.array(z.string()).default([]),
})
export type ModrinthVersion = z.infer<typeof VersionSchema>
const ProjectSchema = z.object({ id: z.string(), title: z.string(), icon_url: z.string().nullable().optional() })

/** Welche Modrinth-Loader-Kategorien ein Server akzeptiert. */
export function modrinthLoaders(loader: Loader): string[] {
  switch (loader) {
    case 'fabric': return ['fabric']
    case 'quilt': return ['quilt', 'fabric']
    case 'forge': return ['forge']
    case 'neoforge': return ['neoforge']
    case 'paper': return ['paper', 'spigot', 'bukkit']
    case 'purpur': return ['purpur', 'paper', 'spigot', 'bukkit']
    case 'folia': return ['folia']
    case 'spigot': return ['spigot', 'bukkit']
    case 'velocity': return ['velocity']
    case 'waterfall': case 'bungeecord': return ['bungeecord', 'waterfall']
    default: return []
  }
}

const q = (v: unknown) => encodeURIComponent(JSON.stringify(v))

export interface ModrinthSearch { query: string; kind: ModKind; loaders: string[]; mcVersion?: string; category?: string; offset: number }

export async function searchModrinth(a: ModrinthSearch, f?: FetchLike): Promise<{ hits: ModHit[]; total: number }> {
  const facets: string[][] = [[`project_type:${a.kind}`]]
  // Modpacks bringen ihren eigenen Loader mit, hier nur nach Loader filtern, wenn es kein Modpack ist.
  if (a.kind !== 'modpack' && a.loaders.length) facets.push(a.loaders.map((l) => `categories:${l}`))
  else if (a.kind === 'modpack' && a.loaders.length) facets.push(a.loaders.map((l) => `categories:${l}`))
  if (a.mcVersion) facets.push([`versions:${a.mcVersion}`])
  if (a.category) facets.push([`categories:${a.category}`])
  const url = `${API}/search?query=${encodeURIComponent(a.query)}&facets=${q(facets)}&limit=20&offset=${a.offset}&index=${a.query ? 'relevance' : 'downloads'}`
  const r = SearchSchema.parse(await fetchJson(url, f))
  return {
    total: r.total_hits,
    hits: r.hits.map((h) => ({ source: 'modrinth' as const, id: h.project_id, slug: h.slug, title: h.title, description: h.description, iconUrl: h.icon_url ?? undefined, downloads: h.downloads, author: h.author, categories: h.categories })),
  }
}

/** Neueste kompatible Version, bevorzugt Release vor Beta/Alpha. */
export async function compatibleVersion(projectId: string, loaders: string[], mcVersion: string | null, f?: FetchLike): Promise<ModrinthVersion | null> {
  const params = [loaders.length ? `loaders=${q(loaders)}` : '', mcVersion ? `game_versions=${q([mcVersion])}` : ''].filter(Boolean).join('&')
  const list = z.array(VersionSchema).parse(await fetchJson(`${API}/project/${encodeURIComponent(projectId)}/version${params ? `?${params}` : ''}`, f))
  return list.find((v) => v.version_type === 'release') ?? list[0] ?? null
}

export async function getVersion(id: string, f?: FetchLike): Promise<ModrinthVersion> {
  return VersionSchema.parse(await fetchJson(`${API}/version/${encodeURIComponent(id)}`, f))
}

export async function getProjectInfo(id: string, f?: FetchLike) {
  const p = ProjectSchema.parse(await fetchJson(`${API}/project/${encodeURIComponent(id)}`, f))
  return { id: p.id, title: p.title, iconUrl: p.icon_url ?? undefined }
}

/** Neueste kompatible Version je installierter Datei (per SHA-1). */
export async function latestByHash(sha1s: string[], loaders: string[], mcVersion: string, f?: FetchLike): Promise<Record<string, ModrinthVersion>> {
  if (!sha1s.length) return {}
  const url = `${API}/version_files/update`
  assertAllowedUrl(url)
  const res = await (f ?? fetch)(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'TRM-Craft', accept: 'application/json' },
    body: JSON.stringify({ hashes: sha1s, algorithm: 'sha1', loaders, game_versions: [mcVersion] }),
  })
  if (!res.ok) throw new Error(`Update-Prüfung fehlgeschlagen (${res.status})`)
  return z.record(VersionSchema).parse(await res.json())
}

export const primaryFile = (v: ModrinthVersion) => v.files.find((f) => f.primary) ?? v.files[0]
