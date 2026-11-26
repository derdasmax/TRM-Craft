import { z } from 'zod'
import type { Loader, ModHit, ModKind } from '@trm/core'
import { assertAllowedUrl, type FetchLike } from '../download'

const API = 'https://api.curseforge.com/v1'
const GAME_ID = 432
export const CLASS_ID: Record<ModKind, number> = { mod: 6, plugin: 5, modpack: 4471 }

const ModSchema = z.object({
  id: z.number(), slug: z.string(), name: z.string(), summary: z.string(), downloadCount: z.number(),
  logo: z.object({ thumbnailUrl: z.string() }).nullable().optional(), authors: z.array(z.object({ name: z.string() })).default([]),
})
const SearchSchema = z.object({ data: z.array(ModSchema), pagination: z.object({ totalCount: z.number() }) })
export const FileSchema = z.object({
  id: z.number(), displayName: z.string(), fileName: z.string(), downloadUrl: z.string().nullable(),
  hashes: z.array(z.object({ value: z.string(), algo: z.number() })).default([]),
  dependencies: z.array(z.object({ modId: z.number(), relationType: z.number() })).default([]),
  gameVersions: z.array(z.string()).default([]),
})
export type CfFile = z.infer<typeof FileSchema>

/** CurseForge: 1 Forge, 4 Fabric, 5 Quilt, 6 NeoForge. */
export const cfLoaderType = (l: Loader): number | undefined => ({ forge: 1, fabric: 4, quilt: 5, neoforge: 6 } as Record<string, number>)[l]

async function cf<T>(path: string, key: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, f?: FetchLike, init?: RequestInit): Promise<T> {
  const url = `${API}${path}`
  assertAllowedUrl(url)
  const res = await (f ?? fetch)(url, { ...init, headers: { accept: 'application/json', 'x-api-key': key, 'user-agent': 'TRM-Craft', ...(init?.headers ?? {}) } })
  if (res.status === 401 || res.status === 403) throw new Error('CurseForge hat den API-Key abgelehnt. Prüfe ihn in den Einstellungen.')
  if (!res.ok) throw new Error(`CurseForge-Anfrage fehlgeschlagen (${res.status})`)
  return schema.parse(await res.json())
}

export async function searchCurseForge(key: string, a: { query: string; kind: ModKind; loader?: Loader; mcVersion?: string; offset: number }, f?: FetchLike): Promise<{ hits: ModHit[]; total: number }> {
  const p = new URLSearchParams({ gameId: String(GAME_ID), classId: String(CLASS_ID[a.kind]), searchFilter: a.query, pageSize: '20', index: String(a.offset), sortField: a.query ? '2' : '6', sortOrder: 'desc' })
  if (a.mcVersion) p.set('gameVersion', a.mcVersion)
  const lt = a.loader && a.kind !== 'plugin' ? cfLoaderType(a.loader) : undefined
  if (lt && a.kind === 'mod') p.set('modLoaderType', String(lt))
  const r = await cf(`/mods/search?${p}`, key, SearchSchema, f)
  return { total: r.pagination.totalCount, hits: r.data.map((m) => ({ source: 'curseforge' as const, id: String(m.id), slug: m.slug, title: m.name, description: m.summary, iconUrl: m.logo?.thumbnailUrl, downloads: m.downloadCount, author: m.authors?.[0]?.name, categories: [] })) }
}

export async function cfLatestFile(key: string, modId: string, mcVersion: string, loader: Loader | undefined, f?: FetchLike): Promise<CfFile | null> {
  const p = new URLSearchParams({ gameVersion: mcVersion, pageSize: '5' })
  const lt = loader ? cfLoaderType(loader) : undefined
  if (lt) p.set('modLoaderType', String(lt))
  const r = await cf(`/mods/${encodeURIComponent(modId)}/files?${p}`, key, z.object({ data: z.array(FileSchema) }), f)
  return r.data[0] ?? null
}

export async function cfFilesById(key: string, ids: number[], f?: FetchLike): Promise<CfFile[]> {
  const r = await cf('/mods/files', key, z.object({ data: z.array(FileSchema) }), f, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileIds: ids }) })
  return r.data
}

export async function cfModInfo(key: string, modId: string, f?: FetchLike) {
  const r = await cf(`/mods/${encodeURIComponent(modId)}`, key, z.object({ data: ModSchema }), f)
  return { id: String(r.data.id), title: r.data.name, iconUrl: r.data.logo?.thumbnailUrl }
}

/** CurseForge nennt SHA-1 `algo: 1`. */
export const cfSha1 = (f: CfFile) => f.hashes.find((h) => h.algo === 1)?.value
